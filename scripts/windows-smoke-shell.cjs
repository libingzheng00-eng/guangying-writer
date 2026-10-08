/** Shared QA-only entry copied into a temporary Mac/Windows package by desktop-smoke.cjs. */
const { app, BrowserWindow, Menu, dialog, shell, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { runSecurityChecks, verifySanitizedProject, verifyDisplaySafety, verifyHtmlExport, observeRequests, hostileHtml, safeHtml, hostileMetadata, hostileImage, hostileColor } = require('./desktop-security-qa.cjs');

const config = JSON.parse(fs.readFileSync(process.env.GUANGYING_WINDOWS_SMOKE_CONFIG, 'utf8'));
const phase = process.env.GUANGYING_WINDOWS_SMOKE_PHASE;
assert.ok(['first-launch', 'recovery'].includes(phase));
assert.equal(process.platform, config.expectedPlatform);
const root = app.getAppPath();
const { entryURL } = require(path.join(root, 'electron', 'security.js'));
const realpath = file => (fs.realpathSync.native || fs.realpathSync)(file);
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name, 'guangying-native-acceptance-qa');
assert.ok(root.split(path.sep).includes('qa~entry'), 'Real production IPC must be exercised from the intentional tilde-path fixture');
const tempRelative = path.relative(realpath(os.tmpdir()), realpath(config.temporary));
assert.ok(tempRelative && tempRelative !== '..' && !tempRelative.startsWith('..' + path.sep) && !path.isAbsolute(tempRelative));
assert.equal(path.dirname(config.userData), config.temporary);
fs.mkdirSync(config.userData, { recursive: true });
app.setPath('userData', config.userData);
app.setPath('sessionData', config.userData);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const report = { status: 'running', phase, platform: process.platform, architecture: process.arch, electron: process.versions.electron, commit: config.commit, sourceManifestSHA256: config.sourceManifestSHA256, checks: [], dialogs: [], errors: [], nativeCalls: { save: 0, open: 0, reveal: 0 } };
const modifier = process.platform === 'darwin' ? 'meta' : 'control';
report.commandInput = { method: process.platform === 'darwin' ? 'production MenuItem callback with exact accelerator validation' : 'Chromium Control keyboard input', commands: [],
  limitation: process.platform === 'darwin' ? 'sendInputEvent has no Cocoa NSEvent; physical Command accelerator dispatch is not verified' : null };
const journal = () => fs.writeFileSync(path.join(config.output, `${phase}.json`), JSON.stringify(report, null, 2));
const pass = name => { report.checks.push(name); journal(); console.log('PASS', name); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function bounded(task, timeout, label) {
  let timer;
  return Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), timeout); })])
    .finally(() => clearTimeout(timer));
}
let win;
const run = js => bounded(win.webContents.executeJavaScript(js), 10000, 'renderer read/focus operation');
async function until(condition, label, timeout = 12000) {
  const stop = Date.now() + timeout;
  while (Date.now() < stop) {
    if (await (typeof condition === 'string' ? run(condition) : condition())) return;
    await pause(60);
  }
  throw new Error(`Timeout: ${label}`);
}
const saveChoices = [];
const openChoices = [];
const closeChoices = [];
dialog.showSaveDialog = async (_window, options) => {
  report.nativeCalls.save++;
  assert.ok(saveChoices.length, 'Unexpected save/export dialog');
  const choice = saveChoices.shift();
  assert.ok(options.filters.some(filter => filter.extensions.includes(choice.extension)), 'Incorrect dialog extension');
  report.dialogs.push({ kind: 'save', extension: choice.extension, stubbed: true, canceled: !!choice.canceled });
  return choice.canceled ? { canceled: true } : { canceled: false, filePath: choice.path };
};
dialog.showOpenDialog = async (_window, options) => {
  report.nativeCalls.open++;
  assert.ok(openChoices.length, 'Unexpected open dialog');
  assert.ok(options.properties.includes('openFile'));
  const choice = openChoices.shift();
  report.dialogs.push({ kind: 'open', stubbed: true, canceled: !!choice.canceled });
  return choice.canceled ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [choice.path] };
};
dialog.showMessageBoxSync = (_window, options) => {
  assert.equal(options.title, '关闭前确认保存', 'Only the real production close guard may ask this dialog');
  assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
  assert.deepEqual(options.buttons, ['继续写作', '仍然离开']);
  assert.ok(closeChoices.length, 'Unexpected close prompt (e.g. save never completed)');
  const choice = closeChoices.shift();
  report.dialogs.push({ kind: 'close', defaultId: options.defaultId, cancelId: options.cancelId, choice, stubbed: true });
  return choice;
};
dialog.showErrorBox = (title, message) => { report.errors.push({ title, message }); journal(); };
// Prevent Explorer windows from taking focus. Export IPC itself remains real.
shell.showItemInFolder = file => { report.nativeCalls.reveal++; assert.ok(file.startsWith(config.temporary + path.sep)); };
const actionSelector = '.script-flow [data-id="windows-action"]';
const text = () => run(`document.querySelector(${JSON.stringify(actionSelector)}).textContent`);
async function focusEnd() {
  win.show(); win.focus();
  await run(`(() => { const e=document.querySelector(${JSON.stringify(actionSelector)});e.scrollIntoView({block:'center'});e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r); })()`);
}
async function key(keyCode, modifiers = []) {
  modifiers = modifiers.map(value => value === 'control' ? modifier : value);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await pause(160);
}
function menuItem(label) {
  const matches = [];
  const search = items => { for (const item of items) { if (item.label === label) matches.push(item); if (item.submenu) search(item.submenu.items); } };
  search(Menu.getApplicationMenu().items);
  assert.equal(matches.length, 1, `Production menu must be unique: ${label}`);
  const item = matches[0];
  assert.ok(item.enabled && item.visible && typeof item.click === 'function', `Production menu unavailable: ${label}`);
  return item;
}
function menu(label) {
  menuItem(label).click({}, win, win.webContents);
}
async function verifySettingsUi(label) {
  menu('显示简介设置…');
  await until(`!!document.querySelector('.modal input[aria-label="行距（倍）"]')`, label + ' settings opens');
  assert.deepEqual(await run(`(() => {const e=document.querySelector('.modal input[aria-label="行距（倍）"]');return {value:Number(e.value),invalid:e.getAttribute('aria-invalid'),liveLineHeight:Number(document.querySelector('.script-flow').style.lineHeight)};})()`),
    { value: 1.75, invalid: null, liveLineHeight: 1.75 }, label + ' retains accepted line height in both Settings and live writing');
  await key('Escape'); await until(`!document.querySelector('.modal[aria-modal="true"]')`, label + ' settings closes');
}
async function command(keyCode, modifiers) {
  // Electron 44.7.0 sendInputEvent forwards a Blink event without an NSEvent.
  // Cocoa performKeyEquivalent therefore cannot dispatch these native menus.
  // Keep Windows keyboard coverage and test the actual Mac MenuItem separately;
  // never synthesize menu:action or add a production DOM shortcut fallback.
  const binding = {
    'control+f': ['查找…', 'CmdOrCtrl+F'], 'control+o': ['打开…', 'CmdOrCtrl+O'],
    'control+s': ['保存', 'CmdOrCtrl+S'], 'control+shift+s': ['另存为…', 'CmdOrCtrl+Shift+S'],
    'control+z': ['撤销', 'CmdOrCtrl+Z'], 'control+shift+z': ['重做', 'CmdOrCtrl+Shift+Z'],
    'control+alt+2': ['故事板卡片', 'CmdOrCtrl+Alt+2'],
  }[[...modifiers, keyCode].join('+')];
  assert.ok(binding, 'Every QA native command needs an explicit production binding');
  const item = menuItem(binding[0]);
  assert.equal(item.accelerator, binding[1]);
  assert.ok(!item.role, 'Custom command must exercise its production callback');
  report.commandInput.commands.push({ label: binding[0], accelerator: item.accelerator });
  if (process.platform === 'darwin') { item.click({}, win, win.webContents); await pause(160); }
  else await key(keyCode, modifiers);
}
const syntheticDir = path.join(config.temporary, '中文 路径 与空格');
const sourceFile = path.join(syntheticDir, '原始 合成样例.zhsp');
const savedFile = path.join(syntheticDir, '另存 工程.zhsp');
const creativeFile = path.join(syntheticDir, '创作 图文.pdf');
const printFile = path.join(syntheticDir, 'A4 纯文本.pdf');
const expectedPath = path.join(config.temporary, 'expected.json');
const readProject = file => JSON.parse(fs.readFileSync(file, 'utf8')).project;
async function snapshot() { return run(`JSON.parse(localStorage.getItem('guangying:autosave'))`); }
async function waitSaved(expectedText) {
  await until(() => fs.existsSync(savedFile) && readProject(savedFile).elements.find(e => e.id === 'windows-action').text === expectedText, 'real save IPC writes expected .zhsp');
  await until(`document.body.textContent.includes('已保存：')`, 'save completion');
  await until(async () => {
    const saved = await snapshot();
    return saved?.filePath === savedFile && saved.project.elements.find(e => e.id === 'windows-action').text === expectedText;
  }, 'autosave latest text and file association');
}
async function screenshot(name) { fs.writeFileSync(path.join(config.output, name), (await bounded(win.webContents.capturePage(), 8000, `capture ${name}`)).toPNG()); }
async function recordWindowGeometry(label, requested) {
  const bounds = win.getBounds();
  const displays = screen.getAllDisplays().map(({ id, bounds, workArea, scaleFactor }) => ({ id, bounds, workArea, scaleFactor }));
  const fullyWithinWorkArea = displays.some(({ workArea: area }) => bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height);
  (report.windowGeometry ||= []).push({ label, requested, bounds, contentBounds: win.getContentBounds(), displays, fullyWithinWorkArea,
    viewport: await run('({width:innerWidth,height:innerHeight,devicePixelRatio})') });
  journal();
}
async function closeAndStay() {
  const count = report.dialogs.filter(d => d.kind === 'close').length;
  closeChoices.push(0); win.close();
  await until(() => report.dialogs.filter(d => d.kind === 'close').length === count + 1, 'production will-prevent-unload reaches close confirmation');
  await pause(200);
  assert.equal(win.isDestroyed(), false, 'Default continue-writing choice must preserve the window');
}
async function finishClose(leave) {
  assert.deepEqual(saveChoices, []); assert.deepEqual(openChoices, []); assert.deepEqual(closeChoices, []);
  assert.deepEqual(report.errors, [], 'Renderer/main errors');
  if (leave) closeChoices.push(1);
  win.once('closed', () => {
    // Synchronous evidence is recorded before production window-all-closed quits.
    try {
      assert.deepEqual(closeChoices, [], 'Expected guard did not execute');
      assert.deepEqual(report.errors, [], 'No renderer/main errors during production close');
      report.status = 'passed'; journal(); app.quit();
    } catch (error) {
      report.status = 'failed'; report.error = error.stack || String(error); journal(); app.exit(1);
    }
  });
  win.close();
}

app.on('browser-window-created', (_event, candidate) => {
  if (win) return; // Secondary production PDF window must not replace the editor.
  win = candidate;
  candidate.webContents.on('render-process-gone', (_event, details) => { report.errors.push({ rendererGone: details.reason }); journal(); });
  candidate.webContents.on('console-message', (details, legacyLevel, legacyMessage) => {
    const isError = details.level === 'error' || (details.level === undefined && legacyLevel >= 3);
    if (isError) { report.errors.push({ renderer: details.message ?? legacyMessage }); journal(); }
  });
  candidate.webContents.on('preload-error', (_event, _file, error) => { report.errors.push({ preload: error.message }); journal(); });
});
let enlargedWindow;
function loadProductionMain() {
  const mainPath = path.join(root, 'electron', 'main.js');
  if (process.platform !== 'darwin') { require(mainPath); return; }
  const Module = require('node:module');
  const originalLoad = Module._load;
  const facade = Object.create(require('electron'));
  // Electron 44.7.0 base-window-options.md: construction-only macOS geometry
  // option. Scope the dependency substitution to main.js, restore immediately,
  // and leave PDF/probe windows plus every security preference untouched.
  Object.defineProperty(facade, 'BrowserWindow', { value: new Proxy(BrowserWindow, {
    construct(Target, args) {
      assert.equal(enlargedWindow, undefined, 'Only one isolated QA primary window may receive the geometry option');
      assert.equal(args.length, 1);
      const [options] = args;
      assert.equal(options.width, 1440); assert.equal(options.height, 960);
      assert.equal(options.webPreferences.preload, path.join(root, 'electron', 'preload.js'));
      const security = { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false };
      for (const [key, expected] of Object.entries(security)) assert.equal(options.webPreferences[key], expected, `Production ${key} must remain unchanged`);
      const patched = { ...options, enableLargerThanScreen: true };
      assert.equal(patched.webPreferences, options.webPreferences);
      enlargedWindow = Reflect.construct(Target, [patched], Target);
      report.qaWindowConstruction = { option: 'enableLargerThanScreen', value: true, scope: 'isolated QA primary window only', originalSize: [options.width, options.height], security, windowId: enlargedWindow.id };
      return enlargedWindow;
    },
  }) });
  Module._load = function(request, parent, isMain) {
    if (request === 'electron' && parent?.filename === mainPath) return facade;
    return Reflect.apply(originalLoad, this, [request, parent, isMain]);
  };
  try { require(mainPath); }
  finally { Module._load = originalLoad; }
}
loadProductionMain();

app.whenReady().then(async () => {
  try {
    await until(() => !!win, 'production main creates BrowserWindow');
    await until('!!document.querySelector(".editor__scroll[data-ready=true]")', 'packaged renderer ready', 30000);
    const actualURL = win.webContents.getURL();
    const expectedURL = pathToFileURL(path.join(root, 'dist-renderer', 'index.html')).href;
    const canonicalURL = entryURL(expectedURL);
    assert.ok(canonicalURL, 'Expected production entry must be a valid URL');
    assert.equal(entryURL(actualURL), canonicalURL, 'Only the exact production file entry syntax is allowed; no query/path/host alias');
    report.entryURL = { actual: actualURL, expected: expectedURL, canonical: canonicalURL, fixture: 'qa~entry' };
    if (process.platform === 'darwin') assert.equal(enlargedWindow, win, 'Geometry instrumentation must belong to the actual primary window');
    const info = await run('window.api.getInfo()');
    assert.equal(info.version, config.version); assert.equal(info.platform, config.expectedPlatform);
    assert.equal(realpath(app.getPath('userData')), realpath(config.userData));
    assert.equal(realpath(app.getPath('sessionData')), realpath(config.userData));
    assert.equal(realpath(process.execPath), realpath(config.expectedExecutable));
    assert.equal(process.arch, config.expectedArch);
    assert.equal(process.versions.electron, config.expectedElectron);
    assert.equal(app.isPackaged, true);
    report.runtime = { execPath: process.execPath, appPath: app.getAppPath(), main: path.join(root, 'electron', 'main.js'), userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), isPackaged: app.isPackaged };
    await recordWindowGeometry('primary-startup', { width: 1440, height: 960 });
    journal();
    pass('packaged production main/preload/renderer start with isolated userData');
    if (phase === 'recovery') {
      const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
      await until(`!!document.querySelector(${JSON.stringify(actionSelector)})`, 'recovered action');
      assert.equal(await text(), expected.unsavedText);
      const recovered = await snapshot();
      assert.equal(recovered.filePath, savedFile);
      assert.equal(recovered.project.beats[0].img, expected.image);
      assert.equal(recovered.project.settings.lineHeight, 1.75, 'Actual process restart recovers the accepted UI setting');
      await verifySettingsUi('Process restart');
      await verifySanitizedProject(run);
      await verifyDisplaySafety(run);
      await until('document.querySelector(".writing-material-card__image")?.naturalWidth > 0', 'recovered embedded image decodes');
      pass('actual process restart recovers unsaved Chinese text, embedded image, and .zhsp association without reseeding');
      await closeAndStay();
      assert.equal(await text(), expected.unsavedText);
      pass('recovered document conservatively remains dirty and default close choice stays open');
      await focusEnd(); await command('s', ['control']); await waitSaved(expected.unsavedText);
      assert.equal(fs.readFileSync(savedFile + '.guangying-backup', 'utf8'), expected.diskBeforeRecovery);
      // Reading the old localStorage alone would not prove the live model was
      // restored. Saving it through production IPC verifies every project field.
      assert.deepEqual(readProject(savedFile), expected.project, 'Full live recovered project must survive process restart and disk save');
      pass('production Save command after process restart writes associated Chinese path and backs up previous disk version (' + report.commandInput.method + ')');
      pass('complete recovered project matches: all paragraphs, formatting, cards, coordinates, settings, and metadata');
      await screenshot('recovered.png');
      pass('saved document closes through production beforeunload without an extra prompt');
      await finishClose(false);
      return;
    }

    const blank = await run(`Array.from(document.querySelectorAll('.script-flow .sc-el')).map(e=>e.textContent)`);
    assert.equal(blank.length, 2); assert.ok(blank.every(value => value === ''));
    assert.equal(await run('document.querySelectorAll(".writing-material-card").length'), 0);
    const firstRecovery = await snapshot();
    if (firstRecovery) {
      assert.ok(firstRecovery.project.elements.every(element => element.text === ''));
      assert.deepEqual(firstRecovery.project.beats, []); assert.equal(firstRecovery.filePath, null);
    }
    assert.deepEqual(await run('window.api.getRecent()'), []);
    pass('first launch is blank: two empty editable paragraphs, no cards, prior text, associated file, or recent files');
    await screenshot('first-launch.png');
    report.security = await runSecurityChecks({ win, run, until, pause, root, temporary: config.temporary, saveChoices, report, pass });
    journal();
    win.show(); win.focus();
    await command('f', ['control']); await until('!!document.querySelector(".find-panel")', 'production Find command opens find');
    await key('Escape'); await until('!document.querySelector(".find-panel")', 'Escape closes find');
    pass('production Find command and Chromium Escape operate the find panel (' + report.commandInput.method + ')');

    fs.mkdirSync(syntheticDir);
    const smartId = await run(`(() => {
      const e=document.querySelector('.script-flow .sc-el[data-type="action"]');
      e.focus(); const r=document.createRange();r.selectNodeContents(e);r.collapse(false);
      const s=getSelection();s.removeAllRanges();s.addRange(r);return e.dataset.id;
    })()`);
    const smartState = () => run(`(() => {const e=document.querySelector('.script-flow [data-id="'+${JSON.stringify(smartId)}+'"]');return {
      text:e.textContent,type:e.dataset.type,focus:document.activeElement?.dataset.id,
      count:document.querySelectorAll('.script-flow .sc-el').length};})()`);
    await win.webContents.insertText('特');
    await until(`Array.from(document.querySelectorAll('.smarttype__label')).some(e=>e.textContent==='特写')`, 'Desktop SmartType shot candidate');
    assert.equal((await smartState()).type, 'action');
    await screenshot('smarttype-candidate.png');
    await key('Enter');
    assert.deepEqual(await smartState(), { text: '特写', type: 'shot', focus: smartId, count: 2 });
    assert.equal(await run('document.querySelectorAll(".smarttype__item").length'), 0);
    await command('z', ['control']);
    assert.deepEqual(await smartState(), { text: '特', type: 'action', focus: smartId, count: 2 });
    await command('z', ['control', 'shift']);
    assert.deepEqual(await smartState(), { text: '特写', type: 'shot', focus: smartId, count: 2 });
    await key('Enter');
    const split = await smartState();
    assert.equal(split.count, 3); assert.notEqual(split.focus, smartId);
    assert.equal(split.text, '特写'); assert.equal(split.type, 'shot');
    pass('Desktop SmartType first Enter accepts text/type in place, production Undo/Redo is atomic, second Enter creates one paragraph');
    // Save through the real command before opening the next fixture; no dirty
    // replacement prompt is bypassed or disabled by the test.
    const smartFile = path.join(syntheticDir, '快捷输入 合成验收.zhsp');
    saveChoices.push({ path: smartFile, extension: 'zhsp' });
    await command('s', ['control', 'shift']);
    await until(() => fs.existsSync(smartFile), 'SmartType synthetic project disk save');
    await until('document.body.textContent.includes("已保存：")', 'SmartType save completion');
    const smartSaved = readProject(smartFile);
    assert.equal(smartSaved.elements.length, 3);
    assert.equal(smartSaved.elements.find(e => e.id === smartId).text, '特写');
    assert.equal(smartSaved.elements.find(e => e.id === smartId).type, 'shot');
    // Generated 1x1 RGBA pixel, valid PNG chunk CRCs and zlib stream.
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMIqAj4DwAETAIY7NJ6TgAAAABJRU5ErkJggg==';
    const project = { id: 'windows-synthetic', name: 'Windows 合成验收', createdAt: 1, updatedAt: 1,
      titlePage: { show: false, title: hostileMetadata }, settings: { smartQuotes: true, fontKey: hostileMetadata }, acts: [], sceneMeta: [], boardLinks: [], revisions: [],
      elements: [{ id: 'windows-scene', type: 'scene_heading', text: '内景 合成测试房间 日' },
        { id: 'windows-action', type: 'action', text: '合成正文' }, { id: 'windows-keep', type: 'action', text: '<b>保留</b>段落' },
        { id: 'security-html', type: 'action', text: hostileHtml }],
      beats: [{ id: 'windows-image', kind: 'image', title: '合成像素', text: '仅用于测试', img: image, color: hostileColor, x: 850, y: 90, boardX: 480, boardY: 100, w: 120, h: 100 },
        { id: 'security-image', kind: 'image', title: '合成阻止外部图片', text: '外部地址必须保留为备注，不能请求资源。', img: hostileImage, color: hostileColor, x: 1090, y: 90, boardX: 780, boardY: 100, w: 120, h: 100 }] };
    fs.writeFileSync(sourceFile, JSON.stringify({ app: 'guangying-writer', fileVersion: 1, savedAt: 1, project }), { flag: 'wx' });
    const sourceBytes = fs.readFileSync(sourceFile, 'utf8');
    const displayObserver = await observeRequests(win);
    openChoices.push({ path: sourceFile }); await command('o', ['control']);
    await until(`!!document.querySelector(${JSON.stringify(actionSelector)})`, 'production Open command real IPC opens synthetic Chinese filename');
    assert.equal(await text(), '合成正文');
    await verifySanitizedProject(run);
    await verifyDisplaySafety(run);
    pass('untrusted project HTML is sanitized before live rendering; bold/italic/line breaks remain and scripts/events/foreign elements do not execute');
    await until('document.querySelector(".writing-material-card__image")?.naturalWidth > 0', 'fixture embedded image decodes');
    pass('production Open command reads .zhsp via real IPC from Chinese path with spaces (dialog choice stubbed)');
    try {
      report.uiLayers = { status: 'running', timeoutMs: config.uiTimeoutMs }; journal();
      report.uiLayers = await bounded(require('./windows-ui-layers.cjs')({ win, run, key, command, menu, pause, until, screenshot, pass, snapshot, recordWindowGeometry }), config.uiTimeoutMs, 'Desktop UI layer acceptance');
      journal();
      console.log(`Desktop UI layers: ${report.uiLayers.assertions} assertions, ${report.uiLayers.groups.length} groups, ${report.uiLayers.screenshots.length} screenshots passed.`);
    } catch (error) {
      report.uiLayers = { ...report.uiLayers, status: 'failed', error: error.message }; journal();
      // Preserve the original assertion even if Chromium is unresponsive. Only
      // this synthetic QA window is inspected; evidence collection is bounded.
      const details = await Promise.race([
        run(`(() => { const read=e=>e?{tag:e.tagName,className:e.className,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),rect:e.getBoundingClientRect().toJSON()}:null;return {viewport:{width:innerWidth,height:innerHeight},active:read(document.activeElement),modal:read(document.querySelector('[aria-modal="true"]')),menu:read(document.querySelector('[role="menu"]')),inert:Array.from(document.querySelectorAll('[inert]')).map(read)};})()`).catch(() => ({ unavailable: true })),
        pause(2500).then(() => ({ timedOut: true })),
      ]);
      fs.writeFileSync(path.join(config.output, 'ui-layer-failure.json'), JSON.stringify(details, null, 2));
      await Promise.race([screenshot('ui-layer-failure.png').catch(() => {}), pause(5000)]);
      throw error;
    } finally { report.displayRequests = displayObserver.stop(); journal(); }
    assert.deepEqual(report.displayRequests, [], 'Untrusted project image/color/HTML metadata must not attempt external or synthetic private-file requests in writing or free-board views');
    pass('real Chromium writing/free-board preserve blocked-image title/notes and safe embedded image, reject CSS URL colors, and make no external resource request');
    openChoices.push({ canceled: true }); await command('o', ['control']);
    assert.equal(await text(), '合成正文');
    pass('canceled open leaves current synthetic document intact');

    await focusEnd(); await win.webContents.insertText('键盘'); await pause(150);
    assert.equal(await text(), '合成正文键盘');
    await command('z', ['control']); assert.equal(await text(), '合成正文');
    await command('z', ['control', 'shift']); assert.equal(await text(), '合成正文键盘');
    pass('production Undo/Redo restore visible Chinese text without a native DOM-only undo (' + report.commandInput.method + ')');
    const cycle = ['action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'scene_heading', 'general', 'note'];
    for (let index = 1; index <= 11; index++) {
      await key('Tab');
      assert.equal(await run('document.activeElement.dataset.id'), 'windows-action');
      assert.equal(await run('document.activeElement.dataset.type'), cycle[index % 9]);
    }
    for (let index = 1; index <= 11; index++) {
      await key('Tab', ['shift']);
      assert.equal(await run('document.activeElement.dataset.id'), 'windows-action');
      assert.equal(await run('document.activeElement.dataset.type'), cycle[(11 - index) % 9]);
    }
    assert.equal(await text(), '合成正文键盘');
    pass('11 Tab and 11 Shift+Tab preserve the same paragraph/focus and all nine element types');
    await focusEnd();
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 });
    await win.webContents.debugger.sendCommand('Input.insertText', { text: '中文' });
    win.webContents.debugger.detach(); await pause(180);
    const firstSavedText = '合成正文键盘中文'; assert.equal(await text(), firstSavedText);
    pass('CDP Chinese composition commits once without leftover pinyin (not real system IME acceptance)');

    saveChoices.push({ canceled: true, extension: 'zhsp' }); await command('s', ['control', 'shift']);
    assert.equal(fs.existsSync(savedFile), false); assert.equal(fs.readFileSync(sourceFile, 'utf8'), sourceBytes);
    assert.equal(await text(), firstSavedText);
    await closeAndStay(); assert.equal(await text(), firstSavedText);
    pass('canceled Save As preserves current content, dirty close protection, and source .zhsp');
    saveChoices.push({ path: savedFile, extension: 'zhsp' }); await command('s', ['control', 'shift']);
    await waitSaved(firstSavedText);
    assert.equal(readProject(savedFile).settings.lineHeight, 1.75, 'Real Save As persists the accepted UI line height');
    const firstSavedBytes = fs.readFileSync(savedFile, 'utf8');
    assert.equal(fs.readFileSync(sourceFile, 'utf8'), sourceBytes);
    pass('production Save As writes a new Chinese filename through real atomic save IPC and preserves source');
    await focusEnd(); await win.webContents.insertText('第二版'); await command('s', ['control']);
    const diskText = firstSavedText + '第二版'; await waitSaved(diskText);
    assert.equal(fs.readFileSync(savedFile + '.guangying-backup', 'utf8'), firstSavedBytes);
    assert.equal(readProject(savedFile).beats[0].img, image);
    assert.equal(readProject(savedFile).elements[2].text, '<b>保留</b>段落');
    assert.equal(readProject(savedFile).elements.find(e => e.id === 'security-html').text, safeHtml);
    assert.equal(readProject(savedFile).settings.lineHeight, 1.75, 'Real subsequent Save retains the accepted UI line height');
    await verifySanitizedProject(run);
    pass('production Save atomically replaces .zhsp, preserves embedded image/formatting, and retains exact previous-version backup');

    const diskProject = readProject(savedFile);
    const opensBeforeReopen = report.nativeCalls.open;
    await until(`!document.body.textContent.includes('已打开剧本')`, 'Any earlier Open notification has ended before disk reopen');
    openChoices.push({ path: savedFile }); await command('o', ['control']);
    await until(() => report.nativeCalls.open === opensBeforeReopen + 1 && openChoices.length === 0, 'Disk reopen reaches exactly one real native Open request');
    await until(`document.body.textContent.includes('已打开剧本')`, 'Production Open reports successful disk parsing/replacement');
    await until(async () => (await snapshot())?.project.settings.lineHeight === 1.75 && (await snapshot())?.filePath === savedFile, 'Disk reopen restores saved settings and association');
    assert.equal(await text(), diskText);
    await verifySettingsUi('Saved project reopen');
    assert.deepEqual((await snapshot()).project, diskProject, 'Disk reopen retains every saved project field including accepted settings');
    pass('actual Open of the saved .zhsp restores lineHeight 1.75 in Settings/live layout and preserves every saved field');

    const beforePdf = JSON.stringify((await snapshot()).project);
    for (const [label, destination, outputName] of [['导出创作版 PDF（原位卡片）…', creativeFile, 'creative.pdf'], ['导出 A4 纯文本 PDF…', printFile, 'print-a4.pdf']]) {
      saveChoices.push({ path: destination, extension: 'pdf' }); menu(label);
      await until(() => fs.existsSync(destination), 'production PDF export', 30000);
      const bytes = fs.readFileSync(destination);
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'); assert.ok(bytes.length > 1000);
      // Chromium emits page/image dictionaries uncompressed. This is a bounded
      // fixture check, not a general PDF parser or proof of visual/text fidelity.
      const pdf = bytes.toString('latin1');
      assert.equal((pdf.match(/\/Type\s*\/Page\b/g) || []).length, 1, 'This short synthetic fixture must produce one page');
      const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
      assert.ok(boxes.length > 0, 'PDF must declare page geometry');
      // Chromium may retain unrelated raster masks in an otherwise text-only
      // PDF. Identify this fixture's 1x1 image, rather than counting all masks.
      const fixtureImages = (pdf.match(/\/Subtype\s*\/Image\b(?:(?!>>)[\s\S])*?\/Width\s+1\b\s*\/Height\s+1\b/g) || []).length;
      if (outputName === 'print-a4.pdf') {
        for (const box of boxes) assert.ok(Math.abs(Number(box[1]) - 595.28) < 1 && Math.abs(Number(box[2]) - 841.89) < 1, 'Plain-text PDF must use A4 points');
        assert.equal(fixtureImages, 0, 'Plain-text PDF must exclude the synthetic image card');
      } else {
        assert.ok(fixtureImages > 0, 'Creative PDF must embed the synthetic image');
      }
      fs.copyFileSync(destination, path.join(config.output, outputName));
      await until('!!document.querySelector(".editor__scroll[data-ready=true]")', 'return from PDF view');
    }
    // A mistaken export-side edit would reach recovery after its 900ms debounce.
    await pause(1200);
    assert.equal(JSON.stringify((await snapshot()).project), beforePdf);
    pass('both production PDFs have one page; A4 geometry excludes cards, creative PDF embeds image, project stays unchanged (visual/text review remains separate)');
    await verifyHtmlExport({ win, run, until, pause, root, temporary: config.temporary, output: config.output, saveChoices, screenshot, pass });
    await pause(1200);
    assert.equal(JSON.stringify((await snapshot()).project), beforePdf, 'HTML export cannot mutate the project or its hostile source metadata');
    await focusEnd(); await win.webContents.insertText('未保存恢复');
    const unsavedText = diskText + '未保存恢复';
    await until(async () => (await snapshot())?.project.elements.find(e => e.id === 'windows-action').text === unsavedText, 'automatic recovery writes latest text');
    assert.equal(readProject(savedFile).elements[1].text, diskText, 'Autosave must not pretend to save the disk .zhsp');
    await closeAndStay(); assert.equal(await text(), unsavedText);
    pass('dirty close reaches real beforeunload/will-prevent-unload and defaults to continue writing');
    fs.writeFileSync(expectedPath, JSON.stringify({ unsavedText, image, project: (await snapshot()).project, diskBeforeRecovery: fs.readFileSync(savedFile, 'utf8') }));
    await screenshot('before-restart.png');
    pass('explicit leave choice uses production guard; next phase restarts same QA executable/profile');
    await finishClose(true);
  } catch (error) {
    report.status = 'failed'; report.error = error.stack || String(error); journal(); console.error(error);
    // Deliberate teardown only after reporting failure; never counts as close acceptance.
    app.exit(1);
  }
});
