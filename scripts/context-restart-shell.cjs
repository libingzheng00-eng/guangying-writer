/** QA-only cold-start entry. Real production main/preload/renderer, no seeds. */
'use strict';
const { app, Menu, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const configPath = process.env.GUANGYING_CONTEXT_RESTART_CONFIG;
const stage = process.env.GUANGYING_CONTEXT_RESTART_STAGE;
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const real = file => fs.realpathSync(file);
const inside = (parent, file) => {
  const relative = path.relative(real(parent), real(file));
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
assert.ok(['prepare', 'restart'].includes(stage));
assert.ok(['offscreen-scroll', 'visible-scroll', 'board', 'missing-scene'].includes(config.name));
assert.equal(config.root, root);
assert.ok(inside(os.tmpdir(), config.temporary));
assert.ok(path.basename(config.temporary).startsWith('guangying-context-restart-'));
assert.equal(config.directory, path.join(config.temporary, config.name));
assert.equal(config.userData, path.join(config.directory, 'userData'));
assert.equal(config.fixture, path.join(config.directory, '合成 长文工程.zhsp'));
assert.equal(config.expected, path.join(config.directory, 'expected.json'));
assert.equal(real(configPath), real(path.join(config.directory, 'config.json')));
assert.equal(real(process.execPath), real(config.runtime));
assert.equal(real(app.getAppPath()), real(config.shell));
assert.equal(JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'))).name, 'guangying-native-acceptance-qa');
assert.equal(app.isReady(), false, 'Isolation must precede Electron ready and production main');
app.setPath('userData', config.userData);
app.setPath('sessionData', config.userData);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const [relative, expected] of Object.entries(config.sourceHashes)) assert.equal(hash(path.join(root, relative)), expected, 'Source/build changed before phase: ' + relative);

const report = { status: 'running', case: config.name, stage, pid: process.pid,
  platform: process.platform, electron: process.versions.electron, checks: [], errors: [], dialogs: [], input: [],
  isolation: { userData: app.getPath('userData'), sessionData: app.getPath('sessionData'),
    appPath: app.getAppPath(), execPath: process.execPath, main: path.join(root, 'electron/main.js'),
    renderer: path.join(root, 'dist-renderer/index.html'), storeSeeded: false, recoverySeeded: false } };
const journal = () => fs.writeFileSync(path.join(config.output, `${config.name}-${stage}.json`), JSON.stringify(report, null, 2));
const pass = message => { report.checks.push(message); journal(); console.log('PASS', message); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const q = JSON.stringify;
let win;
const bounded = async (promise, timeout, label) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timeout: ' + label)), timeout); })]); }
  finally { clearTimeout(timer); }
};
const run = expression => bounded(win.webContents.executeJavaScript(expression), 10000, 'renderer read/selection');
async function until(condition, label, timeout = 18000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await (typeof condition === 'string' ? run(condition) : condition())) return;
    await pause(80);
  }
  throw new Error('Timeout: ' + label);
}
const openChoices = [], closeChoices = [], confirmChoices = [];
dialog.showOpenDialog = async (_window, options) => {
  assert.ok(openChoices.length, 'Unexpected native open picker');
  assert.ok(options.properties.includes('openFile'));
  const file = openChoices.shift(); assert.equal(file, config.fixture);
  report.dialogs.push({ kind: 'open', stubbed: true, path: file }); journal();
  return { canceled: false, filePaths: [file] };
};
dialog.showSaveDialog = async () => { throw new Error('Unexpected save picker: fixture must use its real granted path'); };
dialog.showMessageBoxSync = (_window, options) => {
  assert.equal(options.title, '关闭前确认保存');
  assert.deepEqual(options.buttons, ['继续写作', '仍然离开']);
  assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
  assert.ok(closeChoices.length, 'Unplanned production close confirmation');
  const choice = closeChoices.shift();
  report.dialogs.push({ kind: 'close', choice, defaultId: options.defaultId, cancelId: options.cancelId, stubbed: true }); journal();
  return choice;
};
dialog.showErrorBox = (title, message) => { report.errors.push({ title, message }); journal(); };

const control = selector => `document.querySelector(${q(selector)})`;
const button = (scope, label) => `Array.from(document.querySelectorAll(${q(scope + ' button')})).find(node=>node.textContent.trim()===${q(label)})`;
async function click(expression) {
  const point = await run(`(() => {const node=${expression}; if(!node||node.disabled)throw Error('Missing/disabled QA pointer target');
    const rect=node.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2,hit=document.elementFromPoint(x,y);
    return {x,y,visible:rect.width>0&&rect.height>0&&x>0&&y>0&&x<innerWidth&&y<innerHeight,hit:!!hit&&(hit===node||node.contains(hit))};})()`);
  assert.ok(point.visible && point.hit, 'Pointer target must already be visible/topmost: ' + expression + ' ' + JSON.stringify(point));
  await pointer(point.x, point.y);
}
async function pointer(x, y) {
  win.show(); win.focus();
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({
    type, x: Math.round(x), y: Math.round(y), ...(type === 'mouseMove' ? {} : { button: 'left', clickCount: 1 }),
  });
  await pause(120);
}
async function key(keyCode, modifiers = []) {
  for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers });
  await pause(100);
}
async function paint() {
  await run(`document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
  await pause(250);
}
async function screenshot(label) {
  await paint();
  const name = `${config.name}-${stage}-${label}.png`;
  fs.writeFileSync(path.join(config.output, name), (await bounded(win.webContents.capturePage(), 10000, 'screenshot')).toPNG());
  (report.screenshots ||= []).push(name); journal();
}
const rawRecovery = () => run(`localStorage.getItem('guangying:autosave')`);
const snapshot = async () => JSON.parse(await rawRecovery());
const context = () => run(`(() => {const entries=JSON.parse(localStorage.getItem('guangying:writing-contexts')||'null')?.entries||[];
  return entries.slice().reverse().find(entry=>entry.filePath===${q(config.fixture)}&&entry.context.projectId===${q(config.projectId)})?.context||null;})()`);
const readyHome = () => until(`!!document.querySelector('.startup')&&document.querySelector('.startup__recent-content')?.getAttribute('aria-busy')==='false'&&!document.querySelector('.startup__action:disabled')`, 'startup ready');
const readyEditor = async () => { await until(`!!document.querySelector('.editor__scroll[data-ready=true]')`, 'real editor pagination ready'); await paint(); };
function productionView(label) {
  // At 1200px the renderer uses a native select instead of visible view buttons.
  // Exercise the existing production MenuItem without synthesizing menu IPC or
  // setting the store. This does not claim physical Cocoa accelerator dispatch.
  const matches = [];
  const visit = items => { for (const item of items) { if (item.label === label) matches.push(item); if (item.submenu) visit(item.submenu.items); } };
  visit(Menu.getApplicationMenu().items);
  assert.equal(matches.length, 1); assert.ok(matches[0].enabled && matches[0].visible && typeof matches[0].click === 'function');
  report.input.push({ kind: 'production-MenuItem-callback', label });
  matches[0].click({}, win, win.webContents);
}
async function writeState(activeId) {
  return run(`(() => {const host=document.querySelector('.editor'),node=document.querySelector('.script-flow [data-id="${activeId}"]'),s=getSelection();
    if(!host||!node)return null; const r=node.getBoundingClientRect(),h=host.getBoundingClientRect();let caret=null;
    if(s?.rangeCount&&node.contains(s.focusNode)){const range=document.createRange();range.selectNodeContents(node);range.setEnd(s.focusNode,s.focusOffset);caret=range.toString().length;}
    return {scrollTop:host.scrollTop,scrollHeight:host.scrollHeight,clientHeight:host.clientHeight,activeId:document.activeElement?.dataset.id||null,caret,
      nodeVisible:r.bottom>h.top&&r.top<h.bottom,nodeTop:r.top,hostTop:h.top,hostBottom:h.bottom,selected:node.classList.contains('is-selected'),
      viewport:{width:innerWidth,height:innerHeight,devicePixelRatio}};})()`);
}
async function boardState() {
  return run(`(() => {const world=document.querySelector('.board__world'),canvas=document.querySelector('.board__canvas');if(!world||!canvas)return null;
    const m=new DOMMatrix(getComputedStyle(world).transform),style=getComputedStyle(canvas);return {panX:m.e,panY:m.f,zoom:m.a,scaleY:m.d,
      transform:world.style.transform,backgroundPosition:style.backgroundPosition,backgroundSize:style.backgroundSize,
      scrollLeft:canvas.scrollLeft,scrollTop:canvas.scrollTop,view:!!document.querySelector('.board')&&!document.querySelector('.editor')};})()`);
}
const near = (actual, expected, label, tolerance = 1) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  `${label}: expected ${expected}, actual ${actual}`);

async function nativeWheel(x, y, deltaY) {
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
  win.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaY, deltaX: 0, hasPreciseScrollingDeltas: true });
  report.input.push({ kind: 'native-wheel', x: Math.round(x), y: Math.round(y), deltaY });
  await pause(160);
}
async function wheelTo(id) {
  // The only scroll mutation here is native wheel input, not scrollTop assignment
  // or scrollIntoView. It deliberately leaves the old writing caret untouched.
  for (let attempt = 0; attempt < 45; attempt++) {
    const point = await run(`(() => {const host=document.querySelector('.editor'),node=document.querySelector('.script-flow [data-id="${id}"]');
      const h=host.getBoundingClientRect(),n=node.getBoundingClientRect();return {x:h.left+35,y:h.top+h.height*.55,delta:n.top-(h.top+h.height*.4)};})()`);
    if (Math.abs(point.delta) < 4) { await pause(250); return; }
    await nativeWheel(point.x, point.y, -Math.max(-650, Math.min(650, point.delta)));
  }
  throw new Error('Native wheel did not reach synthetic paragraph ' + id);
}
async function caretAt(id, offset = 4) {
  await click(control(`.script-flow [data-id="${id}"]`));
  // A DOM Range prepares a known plain-text insertion position, then a real
  // native Right key must move it before persistence is asserted. No store data.
  await run(`(() => {const node=document.querySelector('.script-flow [data-id="${id}"]');const r=document.createRange();
    if(node.firstChild?.nodeType!==Node.TEXT_NODE)throw Error('Expected synthetic plain text');
    r.setStart(node.firstChild,${offset - 1});r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);})()`);
  await key('Right');
  assert.equal((await writeState(id)).caret, offset, 'Native Right moved the real DOM caret');
  await until(async () => { const c = await context(); return c?.activeId === id && c.caret === offset; }, 'real caret context persisted');
}
async function save() {
  const before = { hash: hash(config.fixture), savedAt: JSON.parse(fs.readFileSync(config.fixture, 'utf8')).savedAt };
  assert.ok(Number.isFinite(before.savedAt), 'Synthetic fixture has a numeric prior savedAt');
  const evidence = { sequence: (report.saves?.length || 0) + 1, before, after: null, status: 'waiting-for-new-disk-save' };
  (report.saves ||= []).push(evidence); journal();
  await click(button('.toolbar', '保存'));
  await until(() => {
    const current = JSON.parse(fs.readFileSync(config.fixture, 'utf8'));
    const currentHash = hash(config.fixture);
    if (!Number.isFinite(current.savedAt) || current.savedAt <= before.savedAt || currentHash === before.hash) return false;
    evidence.after = { hash: currentHash, savedAt: current.savedAt }; journal(); return true;
  }, 'this Save changes disk bytes and advances savedAt, independently of an old toast/backup or clean state');
  await until(`!document.querySelector('.dot-dirty')&&document.body.textContent.includes('已保存：')`, 'real Save completes');
  await until(() => fs.existsSync(config.fixture + '.guangying-backup'), 'production atomic save backup');
  evidence.backupHash = hash(config.fixture + '.guangying-backup');
  assert.equal(evidence.backupHash, before.hash, 'This Save backs up the exact file version read before its click');
  const disk = JSON.parse(fs.readFileSync(config.fixture, 'utf8')).project;
  await until(async () => (await snapshot())?.project?.elements?.[1]?.text === disk.elements[1].text, 'saved text reaches real recovery snapshot');
  evidence.status = 'passed'; journal();
  return disk;
}
async function openFixture() {
  await readyHome(); assert.equal(await rawRecovery(), null, 'fresh profile must not contain a seed');
  const preference = config.name === 'missing-scene' ? 'home' : 'resume';
  await click(control(`.startup__preference input[value="${preference}"]`));
  assert.equal(await run(`localStorage.getItem('guangying:startup-preference')||'home'`), preference);
  openChoices.push(config.fixture);
  await click(`Array.from(document.querySelectorAll('.startup__action')).find(node=>node.textContent.includes('打开工程'))`);
  await readyEditor();
  await until(async () => (await snapshot())?.project.id === config.projectId, 'actual Open populates recovery');
  await click(control('.script-flow [data-id="context-s1-a0"]'));
  await win.webContents.insertText('原生保存验证。');
  await until(`!!document.querySelector('.dot-dirty')`, 'native text input changes real document');
  const project = await save();
  assert.ok(project.elements[1].text.includes('原生保存验证。'));
  assert.equal((await run('window.api.getRecent()')).filter(item => item.path === config.fixture).length, 1);
  pass('fresh profile opens only its synthetic fixture through production picker IPC; native editing and production Save create a real backup and recent record');
  return project;
}
async function prepare() {
  const openedProject = await openFixture();
  let activeId;
  if (config.name === 'visible-scroll' || config.name === 'missing-scene') {
    activeId = 'context-s3-a0'; await wheelTo(activeId); await caretAt(activeId);
  } else {
    activeId = 'context-s1-a0'; await caretAt(activeId);
    if (config.name === 'offscreen-scroll') {
      await wheelTo('context-s3-a0');
      const observation = await writeState(activeId);
      assert.equal(observation.activeId, activeId); assert.equal(observation.caret, 4);
      assert.equal(observation.nodeVisible, false, 'Old first-scene caret must remain outside the third-scene viewport');
      assert.ok(observation.scrollTop > observation.clientHeight, 'Scrolling must be substantial');
    }
  }
  if (config.name === 'board') {
    productionView('自由板');
    await until(`!!document.querySelector('.board__canvas')`, 'real board view');
    const point = await run(`(() => {const node=document.querySelector('.board__canvas'),r=node.getBoundingClientRect();return {x:r.left+r.width*.45,y:r.top+r.height*.68};})()`);
    await pointer(point.x, point.y); // Real canvas focus before holding Space.
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    await until(`document.querySelector('.board__canvas').dataset.panning==='on'`, 'Space holds native board pan mode');
    const before = await boardState();
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 });
    for (let step = 1; step <= 5; step++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(point.x + 120 * step / 5), y: Math.round(point.y - 70 * step / 5), buttons: ['left'] });
      await pause(45);
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(point.x + 120), y: Math.round(point.y - 70), button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' }); await pause(160);
    const dragged = await boardState(); near(dragged.panX - before.panX, 120, 'Space-drag pan X'); near(dragged.panY - before.panY, -70, 'Space-drag pan Y');
    await nativeWheel(point.x, point.y, -120);
    const zoomed = await boardState(); assert.notEqual(zoomed.zoom, dragged.zoom, 'Real wheel must change board zoom');
    assert.ok(zoomed.zoom >= .4 && zoomed.zoom <= 2); assert.equal(zoomed.scrollTop, 0); assert.equal(zoomed.scrollLeft, 0);
    report.boardInput = { before, dragged, zoomed, method: 'Chromium Space + pointer drag and wheel; no transform/store assignment' };
    pass('native Space+pointer pan and native wheel alter board DOM transform without browser scrolling');
  }
  assert.equal(await run(`!!document.querySelector('.dot-dirty')`), false, 'Writing position and board transform must not dirty the saved screenplay');
  assert.deepEqual((await snapshot()).project, openedProject, 'Context-only interactions must preserve the complete recovery project');
  const project = await save();
  assert.deepEqual(project, openedProject, 'Production Save must not put view/scroll/board context into screenplay data');
  await until(async () => {
    const c = await context(); if (!c || c.activeId !== activeId || c.caret !== 4) return false;
    if (config.name === 'board') {
      const b = await boardState(); return c.view === 'board' && c.board && Math.abs(c.board.panX - b.panX) < .01 && Math.abs(c.board.panY - b.panY) < .01 && Math.abs(c.board.zoom - b.zoom) < .00001;
    }
    return c.view === 'write' && Math.abs(c.writeScrollTop - (await writeState(activeId)).scrollTop) < 1;
  }, 'real context persistence matches visible geometry');
  const expected = { context: await context(), writing: config.name === 'board' ? null : await writeState(activeId),
    board: config.name === 'board' ? await boardState() : null, project, diskHash: hash(config.fixture), pid: process.pid };
  if (config.name === 'visible-scroll') assert.equal(expected.writing.nodeVisible, true, 'Normal case caret remains in its visible viewport');
  if (config.name === 'offscreen-scroll') assert.equal(expected.writing.nodeVisible, false, 'Save must not turn the offscreen-caret case into the visible-caret case');
  fs.writeFileSync(config.expected, JSON.stringify(expected, null, 2), { flag: 'wx' });
  report.prepared = expected; journal();
  await screenshot('prepared');
  pass('context is generated only by production UI events, persisted beside the unchanged saved project, and recorded before a normal clean close');
}
async function closeAndStay() {
  const prior = report.dialogs.filter(item => item.kind === 'close').length;
  closeChoices.push(0); win.close();
  await until(() => report.dialogs.filter(item => item.kind === 'close').length === prior + 1, 'real close guard');
  await pause(150); assert.equal(win.isDestroyed(), false);
  pass('production beforeunload/will-prevent-unload conservatively protects recovered work and default continue-writing keeps the same window');
}
async function restart() {
  const expected = JSON.parse(fs.readFileSync(config.expected, 'utf8'));
  assert.notEqual(process.pid, expected.pid, 'Recovery requires a genuinely independent process');
  if (config.name === 'missing-scene') {
    await readyHome();
    const oldRaw = await rawRecovery(); const old = JSON.parse(oldRaw);
    assert.deepEqual(old.project, expected.project, 'Home starts with old full recovery, not the externally edited disk project');
    assert.ok(old.project.elements.some(element => element.id === 'context-s3'));
    await pause(1000); assert.equal(await rawRecovery(), oldRaw, 'Waiting on home retains the old recovery bytes');
    const changed = JSON.parse(fs.readFileSync(path.join(config.directory, 'external-change.json'), 'utf8'));
    assert.equal(hash(config.fixture), changed.hash);
    const recent = (await run('window.api.getRecent()')).find(item => item.path === config.fixture);
    assert.ok(recent && !recent.missing && !recent.needsAuthorization, 'Same synthetic file identity preserves explicit native authorization');
    confirmChoices.push(true);
    await click(`Array.from(document.querySelectorAll('.startup__project')).find(node=>node.querySelector('.startup__path')?.textContent===${q(config.fixture)})?.querySelector('.startup__project-open')`);
    await readyEditor();
    await until(() => confirmChoices.length === 0, 'real replacement confirm accepted through CDP');
    await until(async () => {
      const saved = await snapshot(); return saved?.project.elements.length === changed.project.elements.length;
    }, 'recent reopen commits modified disk project through production loader');
    assert.deepEqual((await snapshot()).project, changed.project, 'Complete loaded project equals only the edited disk fixture');
    await until(async () => (await context())?.activeId === changed.project.elements[0].id, 'fallback anchor persists');
    const actual = { context: await context(), writing: await writeState(changed.project.elements[0].id), project: (await snapshot()).project };
    report.restored = actual; journal(); await screenshot('fallback');
    assert.ok(!actual.project.elements.some(element => changed.removed.includes(element.id)));
    assert.equal(actual.context.activeId, changed.project.elements[0].id);
    assert.equal(actual.context.caret, undefined, 'Missing target must drop orphan caret');
    assert.ok(actual.context.writeScrollTop === undefined || actual.context.writeScrollTop < expected.context.writeScrollTop - 100,
      'Missing target must drop old absolute scroll; real fallback onScroll may subsequently persist the new top');
    assert.ok(actual.writing.nodeVisible && actual.writing.scrollTop < 100, 'First valid paragraph is safely visible');
    assert.equal(hash(config.fixture), changed.hash, 'Reopen/fallback never rewrites the synthetic disk file');
    assert.equal(await run(`!!document.querySelector('.dot-dirty')`), false, 'Explicit disk reopen is clean');
    pass('recent reopen explicitly replaces the retained old recovery with the externally shortened disk project, clears orphan caret/old scroll and displays its valid first anchor');
    return;
  }
  await until(`!document.querySelector('.startup')&&!!document.querySelector('.toolbar')`, 'real automatic resume');
  if (config.name === 'board') await until(`!!document.querySelector('.board__world')&&!document.querySelector('.editor')`, 'board restored at cold startup');
  else await readyEditor();
  await paint();
  const actual = { context: await context(), writing: config.name === 'board' ? null : await writeState(expected.context.activeId),
    board: config.name === 'board' ? await boardState() : null };
  report.restored = actual; report.expected = expected; journal(); await screenshot('restored');
  assert.deepEqual((await snapshot()).project, expected.project, 'Full recovery project survives independently of UI metadata');
  assert.equal(hash(config.fixture), expected.diskHash, 'Recovery cannot write the saved project');
  assert.equal(await run(`!!document.querySelector('.dot-dirty')`), true, 'Recovered document remains conservatively dirty');
  if (config.name === 'board') {
    assert.equal(actual.context.view, 'board'); assert.ok(actual.board.view);
    for (const field of ['panX', 'panY', 'zoom']) {
      near(actual.board[field], expected.board[field], 'Cold-restarted board ' + field, .001);
      near(actual.context.board[field], expected.context.board[field], 'Persistent board ' + field, .001);
    }
    assert.equal(actual.board.scrollLeft, 0); assert.equal(actual.board.scrollTop, 0);
    pass('new process restores free-board view, pan and zoom to the prior real native input transform and persistent metadata');
  } else {
    assert.equal(actual.context.view, 'write');
    assert.equal(actual.writing.activeId, expected.context.activeId); assert.equal(actual.writing.caret, expected.context.caret);
    near(actual.writing.scrollTop, expected.writing.scrollTop, 'Cold-restarted editor browsing scroll');
    near(actual.context.writeScrollTop, expected.context.writeScrollTop, 'Persisted editor browsing scroll');
    assert.equal(actual.writing.nodeVisible, expected.writing.nodeVisible, 'Offscreen old caret must remain offscreen when restoring a saved browsing viewport');
    pass(config.name === 'offscreen-scroll'
      ? 'new process preserves third-scene browsing scroll while the first-scene caret stays offscreen and unchanged'
      : 'new process restores the visible third-scene caret and its exact saved editor scroll');
  }
  await closeAndStay();
}
async function finish(error) {
  if (error) { report.status = 'failed'; report.error = error.stack || String(error); console.error(report.error); }
  assert.ok(win && !win.isDestroyed(), 'Only the QA-owned live production window may be closed');
  const dirty = await run(`!!document.querySelector('.dot-dirty')`);
  if (dirty) closeChoices.push(1);
  win.once('closed', () => {
    try {
      assert.deepEqual(openChoices, []); assert.deepEqual(closeChoices, []); assert.deepEqual(confirmChoices, []);
      assert.deepEqual(report.errors, []);
      if (!error) { report.status = 'passed'; report.checks.push(dirty ? 'normal close completes only through explicit production leave choice' : 'clean document closes normally through production lifecycle'); }
      journal(); app.quit();
    } catch (closeError) {
      report.status = 'failed'; report.error ||= closeError.stack || String(closeError); journal(); app.quit();
    }
  });
  journal(); win.close();
}

app.on('browser-window-created', (_event, candidate) => {
  assert.equal(win, undefined, 'This harness expects only the one production editor window'); win = candidate;
  // Set identical geometry before either renderer's layout/restoration runs.
  candidate.setSize(1200, 780);
  const wc = candidate.webContents;
  wc.on('render-process-gone', (_event, details) => { report.errors.push({ rendererGone: details.reason }); journal(); });
  wc.on('preload-error', (_event, _file, error) => { report.errors.push({ preload: error.message }); journal(); });
  wc.on('console-message', (details, legacyLevel, legacyMessage) => {
    if (details.level === 'error' || (details.level === undefined && legacyLevel >= 3)) {
      report.errors.push({ renderer: details.message ?? legacyMessage }); journal();
    }
  });
  wc.debugger.attach('1.3');
  wc.debugger.on('message', (_event, method, parameters) => {
    if (method !== 'Page.javascriptDialogOpening') return;
    if (parameters.type === 'beforeunload') return; // Production close handler owns this.
    (async () => {
      assert.equal(config.name, 'missing-scene'); assert.equal(stage, 'restart');
      assert.equal(parameters.type, 'confirm'); assert.ok(parameters.message.includes('打开其他剧本将放弃这些内容'));
      assert.ok(confirmChoices.length, 'Unexpected renderer confirm');
      const accept = confirmChoices.shift();
      report.dialogs.push({ kind: 'renderer-confirm', accept, stubbed: false, method: 'CDP Page.handleJavaScriptDialog' }); journal();
      await wc.debugger.sendCommand('Page.handleJavaScriptDialog', { accept });
    })().catch(error => { report.errors.push({ dialog: error.message }); journal(); });
  });
  wc.debugger.sendCommand('Page.enable').catch(error => { report.errors.push({ debugger: error.message }); journal(); });
});
journal();
// Production main resolves its renderer/preload from __dirname, so the tiny
// temporary app.getAppPath() shell does not substitute any production modules.
require(path.join(root, 'electron/main.js'));
app.whenReady().then(async () => {
  try {
    assert.equal(app.getPath('userData'), config.userData); assert.equal(app.getPath('sessionData'), config.userData);
    await until(() => !!win, 'production BrowserWindow');
    await until(`!!window.api?.isElectron&&!!document.querySelector('.app-shell')`, 'real production preload/renderer');
    assert.equal(win.webContents.getURL(), pathToFileURL(path.join(root, 'dist-renderer/index.html')).href);
    win.show(); win.focus(); await paint();
    report.geometry = { bounds: win.getBounds(), contentBounds: win.getContentBounds(), viewport: await run('({width:innerWidth,height:innerHeight,devicePixelRatio})') };
    pass('dedicated temp shell and same-case userData/sessionData load unchanged production main/preload/renderer in a fresh real process');
    if (stage === 'prepare') await prepare(); else await restart();
    await finish();
  } catch (error) {
    try { if (win && !win.isDestroyed()) await screenshot('failure'); } catch { /* Keep the original diagnostic. */ }
    try { await finish(error); }
    catch (closeError) { report.status = 'failed'; report.error = error.stack || String(error); report.closeError = closeError.message; journal(); app.exit(1); }
  }
});
