/** Fixed characters mode. Production main/preload/renderer and real file IPC;
 * only owned synthetic picker results and folder reveal are stubbed. */
'use strict';
const { app, Menu, dialog, shell } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const stage = process.env.GUANGYING_CHARACTER_STAGE;
const configFile = process.env.GUANGYING_CHARACTER_CONFIG;
assert.equal(process.env.GUANGYING_QA_MODE, 'characters'); assert.equal(process.env.GUANGYING_QA_HIDDEN, '1');
assert.ok(['edit-save', 'restart-reopen'].includes(stage));
assert.ok(configFile && path.isAbsolute(configFile)); assert.ok(!fs.lstatSync(configFile).isSymbolicLink());
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const real = file => fs.realpathSync(file), hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(config.root, root);
const relative = path.relative(real(os.tmpdir()), real(config.temporary));
assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
assert.ok(path.basename(config.temporary).startsWith('guangying-character-native-'));
assert.equal(configFile, path.join(config.temporary, 'config.json'));
assert.equal(config.userData, path.join(config.temporary, 'userData'));
assert.equal(config.fixture, path.join(config.temporary, '合成 人物线.zhsp'));
assert.equal(config.expected, path.join(config.temporary, 'expected.json'));
assert.deepEqual(config.pdfs, ['characters-creative.pdf', 'characters-a4.pdf'].map(name => path.join(config.temporary, name)));
assert.equal(real(app.getAppPath()), real(config.shell)); assert.equal(real(process.execPath), real(config.runtime));
assert.equal(JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'))).name, 'guangying-native-acceptance-qa');
assert.equal(app.isReady(), false);
app.setPath('userData', config.userData); app.setPath('sessionData', config.userData);
for (const [name, expected] of Object.entries(config.sourceHashes)) assert.equal(hash(path.join(root, name)), expected, `Source changed before stage: ${name}`);
const report = { status: 'running', stage, pid: process.pid, platform: process.platform, electron: process.versions.electron,
  checks: [], errors: [], dialogs: [], saves: [], reveals: [], inputScope: 'Synthetic DOM events through real React; no physical input claim',
  isolation: { userData: config.userData, sessionData: config.userData, main: path.join(root, 'electron/main.js'), seeded: false } };
const journal = () => fs.writeFileSync(path.join(config.output, `${stage}.json`), JSON.stringify(report, null, 2));
const pass = label => { report.checks.push(label); journal(); console.log('PASS', label); };
const q = JSON.stringify, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, failedTeardown = false;
const opens = [], saves = [], closes = [];
const run = expression => win.webContents.executeJavaScript(expression);
async function until(condition, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await (typeof condition === 'string' ? run(condition) : condition())) return; await pause(60); }
  throw Error('Timeout: ' + label);
}
const rawRecovery = () => run("localStorage.getItem('guangying:autosave')");
const snapshot = async () => JSON.parse(await rawRecovery());
const model = async () => (await snapshot())?.project;
const homeReady = () => until(`!!document.querySelector('.startup')&&document.querySelector('.startup__recent-content')?.getAttribute('aria-busy')==='false'&&!document.querySelector('.startup__action:disabled')`, 'startup ready');
const button = (scope, label) => `Array.from(document.querySelectorAll(${q(scope + ' button')})).find(node=>node.textContent.trim()===${q(label)})`;
async function click(expression) {
  await until(`(() => {const node=${expression};if(!node||node.disabled)return false;node.click();return true;})()`, 'click synthetic control: ' + expression);
  assert.equal(win.isVisible(), false); await pause(50);
}
async function input(label, value) {
  await run(`(() => {const node=document.querySelector('[aria-label='+CSS.escape(${q(label)})+']');if(!node)throw Error('Missing labeled field');node.focus();
    const proto=node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:node instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(node,${q(value)});node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
  await pause(50);
}
function menu(label) {
  const matches = []; const visit = items => { for (const item of items) { if (item.label === label) matches.push(item); if (item.submenu) visit(item.submenu.items); } };
  visit(Menu.getApplicationMenu().items); assert.equal(matches.length, 1); assert.ok(matches[0].enabled && typeof matches[0].click === 'function');
  matches[0].click({}, win, win.webContents);
}
dialog.showOpenDialog = async (_window, options) => {
  assert.ok(opens.length && options.properties.includes('openFile')); const file = opens.shift(); assert.equal(file, config.fixture);
  report.dialogs.push({ kind: 'open', file, stubbed: true }); journal(); return { canceled: false, filePaths: [file] };
};
dialog.showSaveDialog = async (_window, options) => {
  assert.ok(saves.length, 'Unexpected file destination request'); const file = saves.shift(); assert.ok(config.pdfs.includes(file));
  assert.ok(options.filters.some(filter => filter.extensions.includes('pdf')));
  report.dialogs.push({ kind: 'pdf', file, stubbed: true }); journal(); return { canceled: false, filePath: file };
};
dialog.showMessageBoxSync = (_window, options) => {
  assert.equal(options.title, '关闭前确认保存'); assert.deepEqual(options.buttons, ['继续写作', '仍然离开']);
  assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0); assert.ok(closes.length || failedTeardown);
  const choice = closes.length ? closes.shift() : 1; report.dialogs.push({ kind: 'close', choice, stubbed: true, failedTeardown }); journal(); return choice;
};
dialog.showErrorBox = (title, message) => { report.errors.push({ title, message }); journal(); };
shell.showItemInFolder = file => { assert.ok(config.pdfs.includes(file)); report.reveals.push(file); journal(); };
async function save() {
  const beforeHash = hash(config.fixture), beforeSavedAt = JSON.parse(fs.readFileSync(config.fixture, 'utf8')).savedAt;
  await click(button('.toolbar', '保存'));
  await until(() => { const data = JSON.parse(fs.readFileSync(config.fixture, 'utf8')); return data.savedAt > beforeSavedAt && hash(config.fixture) !== beforeHash; }, 'real atomic Save reaches synthetic file');
  await until(`!document.querySelector('.dot-dirty')`, 'save clears only current dirty state');
  const disk = JSON.parse(fs.readFileSync(config.fixture, 'utf8')).project;
  await until(async () => JSON.stringify((await snapshot())?.project) === JSON.stringify(disk), 'recovery has exact saved project');
  assert.equal(hash(config.fixture + '.guangying-backup'), beforeHash, 'Backup is the exact prior file');
  report.saves.push({ beforeHash, afterHash: hash(config.fixture), backupHash: hash(config.fixture + '.guangying-backup') }); journal(); return disk;
}
async function openLines() {
  menu('人物线');
  await until(`!!document.querySelector('[aria-label="人物线"]')`, 'character reading surface');
}
async function first() {
  await homeReady(); assert.equal(await rawRecovery(), null);
  opens.push(config.fixture); await click(`Array.from(document.querySelectorAll('.startup__action')).find(node=>node.textContent.includes('打开工程'))`);
  await until(async () => (await model())?.id === config.project.id, 'production Open admits synthetic identity fixture');
  assert.equal(hash(config.fixture), config.initialHash, 'Opening never implicitly rewrites the input file');
  const admitted = await model(); assert.deepEqual(admitted.characterWorkspace, config.project.characterWorkspace);
  assert.equal(admitted.characterWorkspace.profiles.filter(profile => profile.canonicalName === '阿明').length, 2);
  pass('Production Open preserves two same-name identities, prefix-distinct name and conflicting aliases without merging');
  await openLines(); await input('阅读人物', 'qa-person-main');
  await click(button('[aria-label="人物线"]', '完整场景'));
  assert.ok(await run(`document.querySelector('[aria-label="人物线"]').textContent.includes('PUBLIC_CHARACTER_DIALOGUE')`));
  await click(button('[aria-label="人物线"]', '台词聚焦'));
  assert.ok(await run(`document.querySelector('[aria-label="人物线"]').textContent.includes('PUBLIC_CHARACTER_DIALOGUE')`));
  await click(button('[aria-label="人物线"]', '完整场景'));
  const beforeNote = await model();
  await click(button('[aria-label="人物线"]', '添加人物笔记'));
  await input('人物笔记内容', 'PRIVATE_CHARACTER_NOTE');
  await input('笔记类别', 'knowledge');
  await click(button('.character-dialog', '保存人物笔记'));
  await until(async () => (await model())?.annotations?.some(note => note.body === 'PRIVATE_CHARACTER_NOTE'), 'character note commits to existing annotation store');
  let current = await model();
  assert.deepEqual(current.elements, beforeNote.elements, 'Author notes never become script text');
  assert.equal(current.annotations.filter(note => note.body === 'PRIVATE_CHARACTER_NOTE').length, 1);
  assert.equal(current.characterWorkspace.noteLinks.length, beforeNote.characterWorkspace.noteLinks.length + 1);
  const withNote = current;
  menu('撤销'); await until(async () => !(await model())?.annotations?.some(note => note.body === 'PRIVATE_CHARACTER_NOTE'), 'one undo removes note and link');
  assert.deepEqual((await model()).characterWorkspace.noteLinks, beforeNote.characterWorkspace.noteLinks);
  menu('重做'); await until(async () => (await model())?.annotations?.some(note => note.body === 'PRIVATE_CHARACTER_NOTE'), 'redo restores original note');
  assert.deepEqual((await model()).characterWorkspace, withNote.characterWorkspace);
  pass('Character note reuses one annotation; real menu undo/redo restores exact linked record without editing screenplay');
  for (const [width, height, theme] of [[1440, 960, 'day'], [1024, 680, 'night']]) {
    win.setSize(width, height); await run(`document.querySelector('.app-shell').dataset.theme=${q(theme)}`); await pause(150);
    const bounds = await run(`(() => {const n=document.querySelector('[aria-label="人物线"]');const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`);
    assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= bounds.width + 1 && bounds.bottom <= bounds.height + 1);
    fs.writeFileSync(path.join(config.output, `characters-${width}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
  }
  pass('Hidden built character UI produces wide/minimum-window day/night captures');
  const saved = await save();
  assert.deepEqual(saved.elements, config.project.elements);
  assert.deepEqual(saved.revisionWorkspace, config.project.revisionWorkspace);
  pass('Production Save writes complete identities/notes and preserves existing versions/stash with exact previous-file backup');
  // Export uses production file grants and renderPdf; only destinations/reveal are stubbed.
  saves.push(config.pdfs[0]); menu('导出创作版 PDF（原位卡片）…');
  await until(() => fs.existsSync(config.pdfs[0]) && report.reveals.includes(config.pdfs[0]), 'actual creative PDF', 60000);
  saves.push(config.pdfs[1]); menu('导出 A4 纯文本 PDF…');
  await until(() => fs.existsSync(config.pdfs[1]) && report.reveals.includes(config.pdfs[1]), 'actual A4 PDF', 60000);
  assert.deepEqual(await model(), saved, 'PDF export leaves every project field unchanged');
  pass('Production PDF IPC generates both files for mandatory independent text-leak inspection');
  fs.writeFileSync(config.expected, JSON.stringify({ project: saved, recovery: await rawRecovery(), fileHash: hash(config.fixture), pid: process.pid }), { flag: 'wx' });
}
async function restarted() {
  const expected = JSON.parse(fs.readFileSync(config.expected, 'utf8')); assert.notEqual(process.pid, expected.pid);
  await homeReady(); assert.equal(await rawRecovery(), expected.recovery); await pause(1000); assert.equal(await rawRecovery(), expected.recovery);
  assert.equal(hash(config.fixture), expected.fileHash);
  await click('document.querySelector(".startup__continue button")');
  await until(`!document.querySelector('.startup')&&!!document.querySelector('.dot-dirty')`, 'conservative recovered draft');
  assert.deepEqual(await model(), expected.project);
  await openLines(); await input('阅读人物', 'qa-person-main');
  assert.ok(await run(`document.querySelector('[aria-label="人物线"]').textContent.includes('PRIVATE_CHARACTER_NOTE')`));
  const resaved = await save(); assert.deepEqual(resaved, expected.project);
  menu('启动页 / 最近项目'); await homeReady();
  await click(`Array.from(document.querySelectorAll('.startup__project')).find(node=>node.querySelector('.startup__path')?.textContent===${q(config.fixture)})?.querySelector('.startup__project-open')`);
  await until(`!document.querySelector('.startup')&&!document.querySelector('.dot-dirty')`, 'real recent reopen is clean');
  await until(async () => (await snapshot())?.filePath === config.fixture, 'disk reopen recovery association');
  assert.deepEqual(await model(), expected.project);
  pass('Independent process preserves recovery on home, restores conservative dirty state, saves, then production recent-open reloads the complete identical disk project');
}
async function finish(error) {
  if (error) { failedTeardown = true; report.status = 'failed'; report.error = error.stack || String(error); console.error(report.error); }
  assert.ok(win && !win.isDestroyed());
  if (await run(`!!document.querySelector('.dot-dirty')||!!document.querySelector('[data-project-draft-pending="true"]')`)) closes.push(1);
  win.once('closed', () => {
    try {
      assert.deepEqual(opens, []); assert.deepEqual(saves, []); assert.deepEqual(closes, []); assert.deepEqual(report.errors, []);
      if (!error) { report.status = 'passed'; report.checks.push('Owned hidden QA window closes through unchanged production lifecycle'); }
    } catch (closeError) { report.status = 'failed'; report.error ||= closeError.stack || String(closeError); }
    journal(); app.quit();
  }); journal(); win.close();
}
app.on('browser-window-created', (_event, candidate) => {
  assert.equal(candidate.isVisible(), false);
  // The launcher owns visibility instrumentation for every window, including PDF.
  // Only the first production window is our interaction target.
  if (!win) win = candidate;
  candidate.webContents.setBackgroundThrottling(false);
  candidate.webContents.on('render-process-gone', (_event, details) => { report.errors.push({ rendererGone: details.reason }); journal(); });
  candidate.webContents.on('preload-error', (_event, _file, error) => { report.errors.push({ preload: error.message }); journal(); });
  candidate.webContents.on('console-message', (details, level, message) => {
    if (details.level === 'error' || (details.level === undefined && level >= 3)) { report.errors.push({ renderer: details.message ?? message }); journal(); }
  });
});
journal(); require(path.join(root, 'electron/main.js'));
app.whenReady().then(async () => {
  try {
    assert.equal(app.getPath('userData'), config.userData); assert.equal(app.getPath('sessionData'), config.userData);
    await until(() => !!win, 'production window'); await until(`!!window.api?.isElectron&&!!document.querySelector('.app-shell')`, 'production preload and renderer');
    assert.equal(win.webContents.getURL(), pathToFileURL(path.join(root, 'dist-renderer/index.html')).href);
    assert.equal(win.isVisible(), false);
    pass('Fixed QA manifest starts unmodified production main/preload/renderer in temporary userData/sessionData without showing a window');
    if (stage === 'edit-save') await first(); else await restarted();
    await finish();
  } catch (error) { try { await finish(error); } catch (closeError) { report.status = 'failed'; report.error = error.stack || String(error); report.closeError = closeError.message; journal(); app.exit(1); } }
});
