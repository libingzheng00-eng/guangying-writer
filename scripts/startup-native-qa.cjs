/** Isolated desktop-smoke helper. No store injection or close-guard bypass.
 * Buttons receive real Chromium pointer/key input. Native picker selections are
 * supplied by desktop-smoke's explicit dialog queue; file IPC remains real.
 * JavaScript only reads state/layout and prepares focus/selection/scroll.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function startupNativeQa({ win, run, key, pause, until, snapshot, screenshot: capture, pass,
  menu, command, openChoices, syntheticDir, recordWindowGeometry }) {
  const q = JSON.stringify;
  const button = (scope, label) => `Array.from(document.querySelectorAll(${q(scope + ' button')})).find(e=>e.textContent.trim()===${q(label)})`;
  const control = selector => `document.querySelector(${q(selector)})`;
  const row = file => `Array.from(document.querySelectorAll('.startup__project')).find(e=>e.querySelector('.startup__path')?.textContent===${q(file)})`;
  const rowButton = (file, label) => `Array.from((${row(file)})?.querySelectorAll('button')||[]).find(e=>e.textContent.trim()===${q(label)})`;
  const readRecent = () => run('window.api.getRecent()');
  const rawRecovery = () => run(`localStorage.getItem('guangying:autosave')`);
  const readyHome = () => until(`!!document.querySelector('.startup') && document.querySelector('.startup__recent-content')?.getAttribute('aria-busy')==='false' && !document.querySelector('.startup__action:disabled')`, 'startup page and recent list ready');
  async function screenshot(name) {
    win.show(); win.focus();
    await run(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
    await pause(160);
    if (/^(first-launch-home|recovery-home|startup-)/.test(name)) {
      const layers = await run(`(() => {const page=document.querySelector('.startup'),background=document.querySelector('.write-bg');
        if(!page||!background)return null;const p=getComputedStyle(page),b=getComputedStyle(background);
        return {pagePosition:p.position,pageZ:Number(p.zIndex),backgroundZ:Number(b.zIndex),
          modal:!!document.querySelector('.modal'),theme:document.querySelector('.app-shell')?.dataset.theme};})()`);
      assert.ok(layers && layers.pagePosition !== 'static' && layers.pageZ > layers.backgroundZ && !layers.modal,
        'Startup screenshot needs a visible foreground stacking layer above write-bg, not only successful pointer hit-testing');
      const theme = name.match(/-(day|night)\.png$/)?.[1];
      if (theme) assert.equal(layers.theme, theme, 'Screenshot filename must match the displayed startup theme');
    }
    await capture(name);
  }
  async function click(expression) {
    const point = await run(`(() => {
      const e=${expression};if(!e||e.disabled)throw Error('Missing or disabled startup QA control');
      e.scrollIntoView({block:'nearest',inline:'nearest'});
      const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
      return {x,y,visible:r.width>0&&r.height>0&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight,hit:!!hit&&(e===hit||e.contains(hit))};
    })()`);
    assert.ok(point.visible && point.hit, 'Startup QA pointer target must be visible and topmost: ' + JSON.stringify(point));
    win.show(); win.focus();
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type,
      x: Math.round(point.x), y: Math.round(point.y), ...(type === 'mouseMove' ? {} : { button: 'left', clickCount: 1 }) });
    await pause(100);
  }
  async function home() {
    await click(control('.toolbar button[aria-haspopup="menu"]'));
    await until(`!!document.querySelector('[role="menu"]')`, 'toolbar file menu');
    await click(button('[role="menu"]', '启动页 / 最近项目'));
    await readyHome();
  }
  async function continueWriting() {
    await click(control('.startup__continue button'));
    await until(`!document.querySelector('.startup') && !!document.querySelector('.toolbar')`, 'continue enters current document');
  }
  async function openFromHome(file, projectId) {
    openChoices.push({ path: file });
    await click(`Array.from(document.querySelectorAll('.startup__action')).find(e=>e.textContent.includes('打开工程'))`);
    await until(`!document.querySelector('.startup') && !!document.querySelector('.toolbar')`, 'startup Open activates parsed project');
    await until(async () => (await snapshot())?.project.id === projectId, 'opened project reaches normal automatic recovery');
    await until(async () => (await readRecent()).some(item => item.path === file), 'successful Open commits recent record');
  }
  const storedContext = (projectId, file) => run(`(() => {
    const entries=JSON.parse(localStorage.getItem('guangying:writing-contexts')||'null')?.entries||[];
    return entries.slice().reverse().find(e=>e.filePath===${q(file)}&&e.context.projectId===${q(projectId)})?.context||null;
  })()`);
  async function setCaret(selector, offset) {
    win.show(); win.focus();
    await run(`(() => {const e=document.querySelector(${q(selector)});e.scrollIntoView({block:'center'});e.focus();
      const node=e.firstChild;if(!node||node.nodeType!==Node.TEXT_NODE)throw Error('QA caret requires its known plain-text paragraph');
      const r=document.createRange();r.setStart(node,${offset});r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);})()`);
    await caretIs(selector, offset);
    // Electron's native keyCode is Right; ArrowRight is only the DOM key name.
    // Assert real selection movement before checking the persistence layer.
    await key('Right');
    await caretIs(selector, offset + 1);
  }
  async function caretIs(selector, offset) {
    await until(`(() => {const e=document.querySelector(${q(selector)}),s=getSelection();if(!e||document.activeElement!==e||!s?.rangeCount||!e.contains(s.focusNode))return false;
      const r=document.createRange();r.selectNodeContents(e);r.setEnd(s.focusNode,s.focusOffset);return r.toString().length===${offset};})()`, 'restored real DOM caret ' + offset);
  }
  async function view(label, selector) { await click(button('.toolbar__views', label)); await until(`!!document.querySelector(${q(selector)})`, label + ' view'); }
  async function firstLaunch() {
    await readyHome();
    assert.equal(await run(`document.activeElement===document.querySelector('.startup h1')`), true);
    assert.deepEqual(await readRecent(), []);
    assert.equal(await rawRecovery(), null);
    assert.equal(await run(`localStorage.getItem('mojiang:autosave')`), null);
    assert.equal(await run(`document.querySelectorAll('.script-flow,.writing-material-card,.startup__continue').length`), 0);
    await pause(1100);
    assert.equal(await rawRecovery(), null, 'Waiting on the initial home page must not generate blank recovery');
    await screenshot('first-launch-home.png');
    win.show(); win.focus();
    await key('Tab');
    assert.equal(await run(`document.activeElement?.classList.contains('startup__action') && document.activeElement.textContent.includes('新建剧本')`), true, 'Tab from the initially focused title reaches New');
    await key('Tab');
    assert.equal(await run(`document.activeElement?.textContent.includes('打开工程')`), true, 'Native Tab reaches Open');
    await key('Tab', ['shift']);
    assert.equal(await run(`document.activeElement?.textContent.includes('新建剧本')`), true, 'Native Shift+Tab returns to New');
    pass('default first launch shows focused startup page, empty recent list and no recovery writes; Chromium Tab/Shift+Tab reach real controls');
    await click(`Array.from(document.querySelectorAll('.startup__action')).find(e=>e.textContent.includes('新建剧本'))`);
    await until(`!!document.querySelector('.editor__scroll[data-ready=true]')`, 'real New button enters blank editor');
  }
  async function recentProjects(baseProject) {
    const name = '同名合成工程';
    const directoryA = path.join(syntheticDir, '甲目录 ' + '长中文路径用于显示验收'.repeat(4));
    const directoryB = path.join(syntheticDir, '乙目录');
    fs.mkdirSync(directoryA); fs.mkdirSync(directoryB);
    const a = path.join(directoryA, name + '.zhsp'), b = path.join(directoryB, name + '.zhsp');
    const moved = path.join(directoryA, '重新定位 ' + name + '.zhsp');
    const invalid = path.join(directoryB, '无效合成工程.zhsp');
    const project = suffix => ({ ...JSON.parse(JSON.stringify(baseProject)), id: 'startup-' + suffix, name,
      titlePage: { show: false, title: name }, acts: [], sceneMeta: [], boardLinks: [], beats: [],
      elements: [{ id: 'startup-scene-' + suffix, type: 'scene_heading', text: '内景 合成启动空间 日' },
        { id: 'startup-action-' + suffix, type: 'action', text: '仅供启动恢复验证的合成段落。' }] });
    for (const [file, suffix] of [[a, 'a'], [b, 'b']]) fs.writeFileSync(file, JSON.stringify({ app: 'guangying-writer', fileVersion: 1, savedAt: 1, project: project(suffix) }), { flag: 'wx' });
    fs.writeFileSync(invalid, '{invalid synthetic JSON', { flag: 'wx' });
    const bytesA = fs.readFileSync(a), bytesB = fs.readFileSync(b);
    await home(); await openFromHome(a, 'startup-a'); await home(); await openFromHome(b, 'startup-b'); await home();
    const pair = (await readRecent()).filter(item => item.name === name);
    assert.equal(pair.length, 2); assert.notEqual(pair[0].id, pair[1].id);
    assert.deepEqual(pair.map(item => item.path).sort(), [a, b].sort());
    const aRecord = pair.find(item => item.path === a), bRecord = pair.find(item => item.path === b);
    await click(rowButton(a, '置顶'));
    await until(async () => (await readRecent()).find(item => item.id === aRecord.id)?.pinned === true, 'real pin IPC persisted');
    await readyHome();
    assert.equal(await run(`document.querySelector('.startup__path')?.textContent`), a, 'Pinned older project sorts ahead of most recently opened project');
    await click(control('.startup__search input'));
    await win.webContents.insertText('乙目录');
    await until(`document.querySelectorAll('.startup__project').length===1`, 'path search filters two same-name projects');
    assert.equal(await run(`document.querySelector('.startup__path').textContent`), b);
    await click(control('.startup__clear'));
    await until(`document.querySelectorAll('.startup__project').length>=2`, 'clear search restores recent projects');
    pass('real Open commits two same-name projects by distinct paths; UI pin and path search operate the production registry');

    const beforeInvalid = await rawRecovery(), recentBeforeInvalid = await readRecent();
    openChoices.push({ path: invalid });
    await click(`Array.from(document.querySelectorAll('.startup__action')).find(e=>e.textContent.includes('打开工程'))`);
    await until(`!!document.querySelector('.startup__notice--error')`, 'invalid open visibly reports failure');
    await readyHome();
    assert.equal(await rawRecovery(), beforeInvalid); assert.deepEqual(await readRecent(), recentBeforeInvalid);
    await continueWriting();
    assert.equal(await run(`document.querySelector('[data-id="startup-action-b"]').textContent`), project('b').elements[1].text);
    assert.equal(await run(`!!document.querySelector('.dot-dirty')`), false);
    pass('invalid .zhsp Open leaves current clean document, recovery bytes and recent registry intact and reports a visible error');

    fs.renameSync(a, moved); await home();
    await until(async () => (await readRecent()).find(item => item.id === aRecord.id)?.missing === true, 'moved file marked missing');
    const beforeCancel = await rawRecovery(), recordsBeforeCancel = await readRecent();
    openChoices.push({ canceled: true }); await click(rowButton(a, '重新定位…')); await readyHome();
    assert.equal(await rawRecovery(), beforeCancel); assert.deepEqual(await readRecent(), recordsBeforeCancel);
    openChoices.push({ path: moved }); await click(rowButton(a, '重新定位…'));
    await until(`!document.querySelector('.startup') && !!document.querySelector('[data-id="startup-action-a"]')`, 'relocation activates actual selected project');
    await until(async () => (await readRecent()).find(item => item.id === aRecord.id)?.path === moved, 'successful relocation updates original ID');
    const relocated = (await readRecent()).find(item => item.id === aRecord.id);
    assert.equal(relocated.pinned, true); assert.equal(!!relocated.missing, false);
    assert.equal((await readRecent()).some(item => item.path === a), false);
    await home(); await click(rowButton(b, '移除记录')); await readyHome();
    assert.equal((await readRecent()).some(item => item.id === bRecord.id), false);
    assert.deepEqual(fs.readFileSync(b), bytesB); assert.deepEqual(fs.readFileSync(moved), bytesA);
    assert.equal(await run(`document.querySelector('.startup__recent-note').textContent.includes('不会删除工程文件')`), true);
    pass('missing recent project: canceled relocation preserves state; successful relocation preserves ID/pin; removing another record leaves its file bytes intact (picker choices stubbed)');

    const originalBounds = win.getBounds(), originalTheme = await run(`document.querySelector('.app-shell').dataset.theme`);
    for (const [width, height] of [[1024, 680], [1440, 960]]) {
      win.setSize(width, height); await pause(160); await recordWindowGeometry('startup size acceptance', { width, height });
      assert.deepEqual(win.getSize(), [width, height]);
      for (const theme of ['day', 'night']) {
        await continueWriting(); menu('显示简介设置…');
        await until(`!!document.querySelector('.modal')`, 'settings for startup theme');
        await click(button('.modal .tabs', '外观'));
        await click(button('.appearance-theme-switch', theme === 'day' ? '日间' : '夜间'));
        await key('Escape'); await until(`!document.querySelector('.modal')`, 'theme settings close'); await home();
        assert.equal(await run(`document.querySelector('.app-shell').dataset.theme`), theme);
        assert.equal(await run(`(() => {const e=document.querySelector('.startup');return e.scrollWidth<=e.clientWidth+1 && document.documentElement.scrollWidth<=innerWidth;})()`), true, 'Startup and long Chinese paths have no horizontal overflow');
        await click(control('.startup__search input')); await key('Tab');
        assert.equal(await run(`document.activeElement?.matches('.startup__project-open')`), true, 'Search Tab enters the visible recent list');
        await screenshot(`startup-${width}x${height}-${theme}.png`);
      }
    }
    await continueWriting(); menu('显示简介设置…'); await until(`!!document.querySelector('.modal')`, 'restore theme settings');
    await click(button('.modal .tabs', '外观')); await click(button('.appearance-theme-switch', originalTheme === 'day' ? '日间' : '夜间'));
    await key('Escape'); await until(`!document.querySelector('.modal')`, 'restored theme closes'); win.setBounds(originalBounds); await pause(160);
    pass('startup page renders at 1024×680 and 1440×960 in day/night themes, with long Chinese paths, visible controls, no horizontal overflow and native Tab focus (screenshots captured)');

    const selector = '.script-flow [data-id="startup-action-a"]';
    await until(`!!document.querySelector('.editor__scroll[data-ready=true]')`, 'context fixture editor ready');
    await setCaret(selector, 3);
    await until(async () => (await storedContext('startup-a', moved))?.caret === 4, 'caret metadata persisted separately');
    await home(); await continueWriting(); await caretIs(selector, 4);
    await view('故事板', '.cards'); await home(); await continueWriting();
    assert.equal(await run(`!!document.querySelector('.cards')&&!document.querySelector('.editor')`), true);
    await home(); await openFromHome(b, 'startup-b'); await home();
    await click(`(${row(moved)})?.querySelector('.startup__project-open')`);
    await until(`!document.querySelector('.startup')&&!!document.querySelector('.cards')`, 'recent reopens its stored story-board view');
    await view('写作', '.editor'); await home(); await continueWriting(); await caretIs(selector, 4);
    assert.deepEqual(fs.readFileSync(moved), bytesA); assert.deepEqual(fs.readFileSync(b), bytesB);
    assert.equal(await run(`!!document.querySelector('.dot-dirty')`), false);
    pass('return-home/continue and recent reopen restore story-board view and exact writing caret without changing project bytes or dirty state');
    await until(async () => (await snapshot())?.filePath === moved, 'reopened context fixture recovery is current before Save');
    const projectBeforeSave = (await snapshot()).project;
    await command('s', ['control']);
    await until(() => fs.existsSync(moved + '.guangying-backup'), 'context fixture Save executes production atomic write');
    await until(`document.body.textContent.includes('已保存：')&&!document.querySelector('.dot-dirty')`, 'context fixture Save completes');
    assert.deepEqual(JSON.parse(fs.readFileSync(moved, 'utf8')).project, projectBeforeSave);
    assert.deepEqual(fs.readFileSync(moved + '.guangying-backup'), bytesA);
    await caretIs(selector, 4);
    assert.equal((await storedContext('startup-a', moved)).view, 'write');
    pass('production Save preserves exact caret/view and full project content while making the normal previous-version backup');
    // Exercise the visible preference controls but leave the default-home path
    // for the independent second process. This is not automatic-resume evidence.
    await home(); await click(control('.startup__preference input[value="resume"]'));
    assert.equal(await run(`localStorage.getItem('guangying:startup-preference')`), 'resume');
    await click(control('.startup__preference input[value="home"]'));
    assert.equal(await run(`localStorage.getItem('guangying:startup-preference')`), 'home');
    await continueWriting();
    pass('visible startup preference controls persist resume/home; second process is deliberately configured for home recovery choice');
    return { sameNamePaths: [a, b], relocatedPath: moved, removedRecordFilePreserved: true,
      interaction: 'Chromium pointer/Tab input and real production IPC; native picker choices stubbed',
      automaticResumeRestartPhase: 'auto-resume' };
  }
  async function prepareRestart(projectId, file, selector) {
    await setCaret(selector, 2);
    await view('故事板', '.cards');
    await until(async () => { const value = await storedContext(projectId, file); return value?.view === 'cards' && value.caret === 3; }, 'latest view/caret metadata before process restart');
    return storedContext(projectId, file);
  }
  async function recover(context, file) {
    await readyHome();
    assert.equal(await run(`!!document.querySelector('.startup__continue')&&!document.querySelector('.editor')`), true);
    const before = await rawRecovery(); assert.ok(before);
    await pause(1100); assert.equal(await rawRecovery(), before, 'Recovery decision on home must not rewrite the previous snapshot');
    assert.equal(await run(`document.querySelector('.startup__continue').textContent.includes('继续上次写作')`), true);
    await screenshot('recovery-home.png'); await continueWriting();
    assert.equal(await run(`!!document.querySelector('.cards')&&!document.querySelector('.editor')`), true, 'Independent restart restores the last writing-related view');
    assert.equal(context.view, 'cards'); assert.equal(context.caret, 3);
    assert.equal((await storedContext(context.projectId, file)).activeId, context.activeId);
    await view('写作', '.editor'); await home(); await continueWriting();
    await caretIs(`.script-flow [data-id="${context.activeId}"]`, context.caret);
    pass('independent process restart keeps home recovery bytes untouched until explicit Continue, restores story-board view and writing caret, and leaves production dirty/close protection active');
  }
  async function prepareAutomaticResume(projectId, file, selector) {
    // This runs after the recovered document was saved through production IPC.
    // Navigation and preference changes must leave that clean document clean.
    assert.equal(await run(`!!document.querySelector('.dot-dirty')`), false);
    await setCaret(selector, 4);
    await view('故事板', '.cards');
    await home();
    await click(control('.startup__preference input[value="resume"]'));
    assert.equal(await run(`localStorage.getItem('guangying:startup-preference')`), 'resume');
    await continueWriting();
    await until(async () => { const context = await storedContext(projectId, file); return context?.view === 'cards' && context.caret === 5; }, 'automatic-resume view/caret metadata persisted');
    assert.equal(await run(`!!document.querySelector('.dot-dirty')`), false);
    await screenshot('automatic-resume-prepared.png');
    pass('real startup preference control selects resume; saved document keeps its clean state while story-board view and caret 5 are persisted before normal close');
    return storedContext(projectId, file);
  }
  async function automaticResume(context, file) {
    assert.ok(context && context.view === 'cards' && context.caret === 5, 'Prior process must supply its actual persisted resume context');
    await until(`!!document.querySelector('.cards')&&!!document.querySelector('.toolbar')&&!document.querySelector('.startup')`, 'fresh process automatically enters its stored story-board view');
    assert.equal(await run(`localStorage.getItem('guangying:startup-preference')`), 'resume');
    assert.equal(await run(`!!document.querySelector('.dot-dirty')`), true, 'Automatic recovery conservatively remains unsaved until an explicit disk save');
    const persisted = await storedContext(context.projectId, file);
    for (const field of ['projectId', 'view', 'activeId', 'sceneId', 'caret']) assert.equal(persisted?.[field], context[field], 'Automatic resume preserves ' + field);
    await screenshot('automatic-resume.png');
    // Restore writing through the same visible navigation routes as the author.
    // The intermediate home/continue releases toolbar focus, allowing us to
    // assert the editor's exact restored DOM selection rather than only storage.
    await view('写作', '.editor'); await home(); await continueWriting();
    await caretIs(`.script-flow [data-id="${context.activeId}"]`, context.caret);
    pass('third independent process automatically resumes without a startup-page choice, restores story-board view and exact writing caret from the same profile, and conservatively remains dirty');
  }
  return { firstLaunch, recentProjects, prepareRestart, recover, prepareAutomaticResume, automaticResume };
};
