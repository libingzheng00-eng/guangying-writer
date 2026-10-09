/** Hidden QA-only production-entry harness. Never receives a private-file path. */
'use strict';
const { app, Menu, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(process.env.GUANGYING_LEGACY_LINKS_CONFIG, 'utf8'));
const stage = process.env.GUANGYING_LEGACY_LINKS_STAGE;
const real = file => fs.realpathSync(file), hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.ok(['open-save', 'restart-recent'].includes(stage)); assert.equal(config.root, root);
const relative = path.relative(real(os.tmpdir()), real(config.temporary));
assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
assert.ok(path.basename(config.temporary).startsWith('guangying-legacy-links-'));
assert.equal(config.userData, path.join(config.temporary, 'userData'));
assert.equal(config.fixture, path.join(config.temporary, '合成 旧连线.zhsp'));
assert.equal(config.expected, path.join(config.temporary, 'expected.json'));
for (const file of config.invalidFiles) assert.equal(path.dirname(file), config.temporary);
assert.equal(real(app.getAppPath()), real(config.shell)); assert.equal(real(process.execPath), real(config.runtime));
assert.equal(JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'))).name, 'guangying-native-acceptance-qa');
assert.equal(app.isReady(), false);
app.setPath('userData', config.userData); app.setPath('sessionData', config.userData);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (process.platform === 'darwin') { app.setActivationPolicy('prohibited'); app.dock?.hide(); }
for (const [name, expected] of Object.entries(config.sourceHashes)) assert.equal(hash(path.join(root, name)), expected, 'Source/build changed before stage: ' + name);
const report = { status: 'running', stage, pid: process.pid, platform: process.platform, electron: process.versions.electron,
  checks: [], errors: [], dialogs: [], saves: [], rejected: [], hidden: { showSuppressed: 0, focusSuppressed: 0, actualShowEvents: 0 },
  isolation: { userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), appPath: app.getAppPath(),
    main: path.join(root, 'electron/main.js'), renderer: path.join(root, 'dist-renderer/index.html'), seeded: false } };
const journal = () => fs.writeFileSync(path.join(config.output, `${stage}.json`), JSON.stringify(report, null, 2));
const pass = name => { report.checks.push(name); journal(); console.log('PASS', name); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const q = JSON.stringify;
let win;
const run = expression => win.webContents.executeJavaScript(expression);
async function until(condition, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await (typeof condition === 'string' ? run(condition) : condition())) return; await pause(70); }
  throw new Error('Timeout: ' + label);
}
const opens = [], closes = [];
let failedTeardown = false;
dialog.showOpenDialog = async (_window, options) => {
  assert.ok(opens.length && options.properties.includes('openFile'));
  const file = opens.shift(); assert.ok([config.fixture, ...config.invalidFiles].includes(file));
  report.dialogs.push({ kind: 'open', path: file, stubbed: true }); journal();
  return { canceled: false, filePaths: [file] };
};
dialog.showSaveDialog = async () => { throw new Error('Unexpected Save dialog: opened synthetic fixture already has a real native grant'); };
dialog.showMessageBoxSync = (_window, options) => {
  assert.equal(options.title, '关闭前确认保存'); assert.deepEqual(options.buttons, ['继续写作', '仍然离开']);
  assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0); assert.ok(closes.length || failedTeardown);
  const choice = closes.length ? closes.shift() : 1;
  report.dialogs.push({ kind: 'close', choice, stubbed: true, failedTeardown }); journal(); return choice;
};
dialog.showErrorBox = (title, message) => { report.errors.push({ title, message }); journal(); };
const rawRecovery = () => run(`localStorage.getItem('guangying:autosave')`);
const snapshot = async () => JSON.parse(await rawRecovery());
const rawContext = () => run(`localStorage.getItem('guangying:writing-contexts')`);
const context = async () => JSON.parse(await rawContext())?.entries.find(e => e.filePath === config.fixture && e.context.projectId === config.project.id)?.context;
const recent = () => run('window.api.getRecent()');
const homeReady = () => until(`!!document.querySelector('.startup')&&document.querySelector('.startup__recent-content')?.getAttribute('aria-busy')==='false'&&!document.querySelector('.startup__action:disabled')`, 'home ready');
async function click(expression) {
  await run(`(() => {const node=${expression};if(!node||node.disabled)throw Error('Missing/disabled hidden QA control');node.click();})()`);
  assert.equal(win.isVisible(), false, 'DOM activation must not show QA window');
}
const button = (scope, text) => `Array.from(document.querySelectorAll(${q(scope + ' button')})).find(node=>node.textContent.trim()===${q(text)})`;
function menu(label) {
  const matches = []; const visit = items => { for (const item of items) { if (item.label === label) matches.push(item); if (item.submenu) visit(item.submenu.items); } };
  visit(Menu.getApplicationMenu().items); assert.equal(matches.length, 1); assert.ok(matches[0].enabled && matches[0].visible && typeof matches[0].click === 'function');
  matches[0].click({}, win, win.webContents);
}
async function home() { menu('启动页 / 最近项目'); await homeReady(); }
async function continueWriting() { await click('document.querySelector(".startup__continue button")'); await until(`!document.querySelector('.startup')&&!!document.querySelector('.board')`, 'continue real current board'); }
function verifyContent(project) {
  for (const field of ['id', 'name', 'createdAt', 'updatedAt', 'targetPages', 'elements', 'sceneMeta', 'beats', 'acts', 'revisions']) {
    assert.deepEqual(project[field], config.project[field], 'Complete synthetic ' + field + ' remains unchanged');
  }
  for (const [key, value] of Object.entries(config.project.titlePage)) assert.deepEqual(project.titlePage[key], value);
  for (const [key, value] of Object.entries(config.project.settings)) assert.deepEqual(project.settings[key], value);
  assert.deepEqual(project.boardLinks, config.expectedLinks, 'All four records retain notes, legacy aliases, extension metadata and exact resolved/unresolved endpoints');
}
async function verifyBoard() {
  await until(`!!document.querySelector('.board__world')`, 'production board DOM');
  const links = await run(`Array.from(new Set(Array.from(document.querySelectorAll('.board-link[data-link-id]')).map(node=>node.dataset.linkId))).sort()`);
  assert.deepEqual(links, ['current-aliases', 'current-pair', 'old-existing']);
  const notes = await run(`Array.from(document.querySelectorAll('.board-link__note')).map(node=>node.textContent)`);
  for (const link of config.expectedLinks.filter(link => link.id !== 'old-missing')) assert.ok(notes.some(note => note.includes(link.note)), 'Valid relation note renders in the real board DOM');
}
async function save() {
  const before = { hash: hash(config.fixture), savedAt: JSON.parse(fs.readFileSync(config.fixture, 'utf8')).savedAt };
  const evidence = { sequence: report.saves.length + 1, before, status: 'pending' }; report.saves.push(evidence); journal();
  await click(button('.toolbar', '保存'));
  await until(() => {
    const content = JSON.parse(fs.readFileSync(config.fixture, 'utf8')), currentHash = hash(config.fixture);
    if (content.savedAt <= before.savedAt || currentHash === before.hash) return false;
    evidence.after = { hash: currentHash, savedAt: content.savedAt }; return true;
  }, 'this exact Save advances savedAt and changes disk hash');
  await until(`!document.querySelector('.dot-dirty')&&document.body.textContent.includes('已保存：')`, 'production Save completion');
  evidence.backupHash = hash(config.fixture + '.guangying-backup'); assert.equal(evidence.backupHash, before.hash);
  const project = JSON.parse(fs.readFileSync(config.fixture, 'utf8')).project; verifyContent(project);
  assert.deepEqual(project, (await snapshot()).project, 'Disk is identical to complete current recovery project');
  evidence.status = 'passed'; journal(); return project;
}
async function rejectInvalid(file) {
  await home(); await until(`!document.querySelector('.startup__notice--error')`, 'previous home error cleared');
  const before = { recovery: await rawRecovery(), context: await rawContext(), recent: await recent(), diskHash: hash(config.fixture), badHash: hash(file) };
  opens.push(file); await click(`Array.from(document.querySelectorAll('.startup__action')).find(node=>node.textContent.includes('打开工程'))`);
  await until(`!!document.querySelector('.startup__notice--error')`, 'invalid relation visibly rejected by production loader');
  assert.ok(await run(`document.querySelector('.startup__notice--error').textContent.includes('工程结构格式不正确')`));
  assert.equal(await rawRecovery(), before.recovery); assert.equal(await rawContext(), before.context);
  assert.deepEqual(await recent(), before.recent); assert.equal(hash(config.fixture), before.diskHash); assert.equal(hash(file), before.badHash);
  assert.equal(before.badHash, config.initialHashes[file]);
  await continueWriting(); await verifyBoard(); verifyContent((await snapshot()).project);
  assert.equal(await run(`!!document.querySelector('.dot-dirty')`), false);
  report.rejected.push({ file, beforeHash: before.badHash, afterHash: hash(file), recoveryUnchanged: true, contextUnchanged: true, recentUnchanged: true, currentUnchanged: true }); journal();
}
async function first() {
  await homeReady(); assert.equal(await rawRecovery(), null); assert.deepEqual(await recent(), []);
  opens.push(config.fixture); await click(`Array.from(document.querySelectorAll('.startup__action')).find(node=>node.textContent.includes('打开工程'))`);
  await until(async () => (await snapshot())?.project?.id === config.project.id, 'real picker IPC opens synthetic legacy project');
  const normalized = (await snapshot()).project; verifyContent(normalized);
  assert.equal(hash(config.fixture), config.initialHashes[config.fixture], 'Admission/migration is in memory, not an implicit file rewrite');
  menu('自由板'); await verifyBoard();
  await until(async () => (await context())?.view === 'board', 'real board metadata persists');
  assert.equal(await run(`!!document.querySelector('.dot-dirty')`), false);
  pass('real production Open migrates two legacy relations in memory, preserves four complete records including a missing endpoint, and renders the three valid relations with notes');
  const saved = await save(); assert.deepEqual(saved, normalized);
  for (const file of config.invalidFiles) await rejectInvalid(file);
  pass('partial modern/legacy mixture and malicious endpoint are rejected without replacing current project, recovery bytes, writing metadata, recent registry or either failed file');
  const savedAgain = await save(); assert.deepEqual(savedAgain, saved);
  const expected = { project: saved, context: await context(), recovery: await rawRecovery(), fileHash: hash(config.fixture), pid: process.pid };
  fs.writeFileSync(config.expected, JSON.stringify(expected, null, 2), { flag: 'wx' });
  pass('each real Save changes its own disk hash/savedAt and backs up exactly its preceding file version; repeated Save preserves all data');
}
async function restarted() {
  const expected = JSON.parse(fs.readFileSync(config.expected, 'utf8')); assert.notEqual(process.pid, expected.pid);
  await homeReady(); assert.equal(await rawRecovery(), expected.recovery); await pause(1050); assert.equal(await rawRecovery(), expected.recovery);
  assert.equal(hash(config.fixture), expected.fileHash); assert.deepEqual(await context(), expected.context);
  const entry = (await recent()).find(item => item.path === config.fixture); assert.ok(entry && !entry.missing && !entry.needsAuthorization);
  await continueWriting(); await verifyBoard();
  assert.equal(await run(`!!document.querySelector('.dot-dirty')`), true, 'Recovered draft retains conservative dirty state');
  assert.deepEqual((await snapshot()).project, expected.project); assert.deepEqual(await context(), expected.context);
  const recoveredSaved = await save(); assert.deepEqual(recoveredSaved, expected.project);
  const reopenedHash = hash(config.fixture);
  await home();
  await click(`Array.from(document.querySelectorAll('.startup__project')).find(node=>node.querySelector('.startup__path')?.textContent===${q(config.fixture)})?.querySelector('.startup__project-open')`);
  await verifyBoard();
  await until(`!document.querySelector('.startup')&&!document.querySelector('.dot-dirty')`, 'explicit recent disk reopen is clean');
  await until(async () => (await snapshot())?.filePath === config.fixture, 'recent reopen recovery association');
  assert.deepEqual((await snapshot()).project, expected.project); verifyContent((await snapshot()).project);
  assert.deepEqual(await context(), expected.context); assert.equal(hash(config.fixture), reopenedHash);
  pass('independent process retains complete recovery on home, continues and saves the conservative dirty draft, then real recent reopen reads identical disk project/board metadata without losing aliases, notes or unresolved endpoints');
  const saved = await save(); assert.deepEqual(saved, expected.project);
  for (const file of config.invalidFiles) await rejectInvalid(file);
  pass('after restart, Save and both invalid Open rejections preserve the same complete migrated project and original failed files');
}
async function finish(error) {
  if (error) { failedTeardown = true; report.status = 'failed'; report.error = error.stack || String(error); console.error(report.error); if (win && !win.isDestroyed()) win.hide(); }
  assert.ok(win && !win.isDestroyed());
  if (await run(`!!document.querySelector('.dot-dirty')`)) closes.push(1);
  win.once('closed', () => {
    try {
      assert.deepEqual(opens, []); assert.deepEqual(closes, []); assert.deepEqual(report.errors, []);
      assert.equal(report.hidden.actualShowEvents, 0);
      for (const file of config.invalidFiles) assert.equal(hash(file), config.initialHashes[file]);
      if (!error) { report.status = 'passed'; report.checks.push('owned QA window closes normally through unchanged production lifecycle and was never shown or focused'); }
    } catch (closeError) { report.status = 'failed'; report.error ||= closeError.stack || String(closeError); }
    journal(); app.quit();
  }); journal(); win.close();
}
app.on('browser-window-created', (_event, candidate) => {
  assert.equal(win, undefined); win = candidate;
  assert.equal(candidate.isVisible(), false, 'Production main constructs its window hidden');
  // Only this process-owned test window is patched; never an existing app.
  // Security preferences, production handlers and close protection stay intact.
  candidate.show = () => { report.hidden.showSuppressed++; };
  candidate.focus = () => { report.hidden.focusSuppressed++; };
  candidate.on('show', () => { report.hidden.actualShowEvents++; journal(); });
  candidate.webContents.setBackgroundThrottling(false);
  const wc = candidate.webContents;
  wc.on('render-process-gone', (_event, details) => { report.errors.push({ rendererGone: details.reason }); journal(); });
  wc.on('preload-error', (_event, _file, error) => { report.errors.push({ preload: error.message }); journal(); });
  wc.on('console-message', (details, level, message) => { if (details.level === 'error' || (details.level === undefined && level >= 3)) { report.errors.push({ renderer: details.message ?? message }); journal(); } });
});
journal(); require(path.join(root, 'electron/main.js'));
app.whenReady().then(async () => {
  try {
    assert.equal(app.getPath('userData'), config.userData); assert.equal(app.getPath('sessionData'), config.userData);
    await until(() => !!win, 'production window'); await until(`!!window.api?.isElectron&&!!document.querySelector('.app-shell')`, 'production preload/renderer');
    assert.equal(win.webContents.getURL(), pathToFileURL(path.join(root, 'dist-renderer/index.html')).href); assert.equal(win.isVisible(), false);
    pass('existing runtime starts unchanged production main/preload/renderer with independent temporary userData/sessionData and a hidden QA-only window');
    if (stage === 'open-save') await first(); else await restarted();
    await finish();
  } catch (error) { try { await finish(error); } catch (closeError) { report.status = 'failed'; report.error = error.stack || String(error); report.closeError = closeError.message; journal(); app.exit(1); } }
});
