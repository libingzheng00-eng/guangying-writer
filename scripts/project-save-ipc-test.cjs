'use strict';

// Execute the real main.js handlers in a VM, with only synthetic in-memory FS,
// dialogs and Electron objects. No native window or userData is accessed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let checks = 0;
function eq(actual, expected, message) { assert.equal(actual, expected, message || 'expected values to match'); checks++; }
function deep(actual, expected, message) { assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message); checks++; }
function ok(value, message) { assert.ok(value, message || 'expected truthy value'); checks++; }

function harness(platform = 'darwin') {
  const handlers = new Map();
  const state = {
    disk: new Map(), writes: [], helperCalls: [], pdfCalls: [], errors: [], dialogs: [], warnings: [],
    saves: [], choice: 0, closeDialogs: [], windows: [], menus: [], appEvents: new Map(),
    nextHelper: null, nextPdf: null, throwOnWarn: false,
  };
  class Window {
    constructor(options) {
      this.options = options;
      this.events = new Map();
      this.webEvents = new Map();
      this.webContents = { on: (event, callback) => this.webEvents.set(event, callback), send() {} };
      state.windows.push(this);
    }
    once(event, callback) { this.events.set(event, callback); }
    on(event, callback) { this.events.set(event, callback); }
    show() {}
    focus() {}
    isDestroyed() { return false; }
    isMinimized() { return false; }
    loadFile(file) { this.loadedFile = file; return Promise.resolve(); }
    loadURL(url) { this.loadedUrl = url; return Promise.resolve(); }
    static getAllWindows() { return state.windows; }
  }
  const fakeFs = {
    readFileSync(file) {
      if (!state.disk.has(file)) throw Object.assign(new Error('synthetic missing'), { code: 'ENOENT' });
      return state.disk.get(file);
    },
    writeFileSync(file, data, encoding) {
      state.writes.push({ file, data, encoding });
      state.disk.set(file, data);
    },
  };
  const electron = {
    app: {
      getPath: () => '/synthetic-qa-userData', getVersion: () => 'synthetic-test',
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then: callback => callback() }),
      on: (event, callback) => state.appEvents.set(event, callback), quit() {},
    },
    BrowserWindow: Window,
    Menu: { buildFromTemplate: template => template, setApplicationMenu: menu => state.menus.push(menu) },
    dialog: {
      showSaveDialog: async (_window, options) => {
        state.dialogs.push(options);
        return state.saves.shift() || { canceled: true };
      },
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showErrorBox: (title, message) => state.errors.push({ title, message }),
      showMessageBoxSync: (_window, options) => { state.closeDialogs.push(options); return state.choice; },
    },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    shell: { showItemInFolder() {} },
  };
  const moduleObject = { exports: {} };
  const mainFile = path.join(__dirname, '../electron/main.js');
  vm.runInNewContext(fs.readFileSync(mainFile, 'utf8'), {
    module: moduleObject, exports: moduleObject.exports, __dirname: path.dirname(mainFile),
    process: { env: {}, platform, on() {} },
    console: { ...console, warn: (...args) => {
      if (state.throwOnWarn) throw new Error('synthetic logging unavailable');
      state.warnings.push(args);
    } }, Buffer,
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'node:fs') return fakeFs;
      if (name === 'node:path') return platform === 'win32' ? path.win32 : path.posix;
      if (name === './platform') return require('../electron/platform');
      if (name === './projectSave') return {
        saveProjectFile(file, content) {
          state.helperCalls.push({ file, content });
          if (state.nextHelper) { const pending = state.nextHelper; state.nextHelper = null; return pending; }
          return Promise.resolve({ path: '/synthetic-canonical.zhsp', backupPath: `${file}.guangying-backup` });
        },
      };
      if (name === './pdf') return {
        renderPdf(window, opts) {
          state.pdfCalls.push({ window, opts });
          if (state.nextPdf) { const pending = state.nextPdf; state.nextPdf = null; return pending; }
          return Promise.resolve(Buffer.from('synthetic-pdf-bytes'));
        },
      };
      throw new Error(`Unexpected dependency in synthetic main harness: ${name}`);
    },
  }, { filename: mainFile });
  return { state, invoke: (name, payload) => handlers.get(name)({}, payload), handlers };
}

async function main() {
  const h = harness();
  const { state: s } = h;
  const content = '{"title":"合成IPC保存","elements":[{"text":"<b>合成文字</b>"}]}';
  const file = '/synthetic-qa/工程.zhsp';
  const recentPath = '/synthetic-qa-userData/recent.json';
  eq(s.windows.length, 1, 'VM created only a fake window');
  eq(s.windows[0].options.titleBarStyle, 'hiddenInset', 'macOS keeps its existing inset title bar');
  deep(s.windows[0].options.trafficLightPosition, { x: 16, y: 20 });
  ok(h.handlers.has('dialog:save') && h.handlers.has('dialog:saveAs') && h.handlers.has('pdf:export'));

  let finish;
  s.nextHelper = new Promise(resolve => { finish = resolve; });
  let settled = false;
  const pending = h.invoke('dialog:save', { content, path: file, name: '合成名' }).then(result => { settled = true; return result; });
  await Promise.resolve();
  eq(s.helperCalls.length, 1, 'project route calls asynchronous helper');
  deep(s.helperCalls[0], { file, content }, 'immutable payload passed through exactly');
  eq(settled, false, 'route must wait for atomic save completion');
  eq(s.writes.length, 0, 'no direct .zhsp/recent write before helper finishes');
  finish({ path: '/synthetic-canonical.zhsp' });
  eq(await pending, file, 'renderer receives chosen path, not canonical helper path');
  eq(s.writes.length, 1, 'only recent list is written by ordinary save route');
  eq(s.writes[0].file, recentPath);
  const recent = JSON.parse(s.disk.get(recentPath));
  eq(recent.length, 1);
  eq(recent[0].path, file);
  eq(recent[0].name, '工程.zhsp');
  ok(typeof recent[0].updatedAt === 'number');
  eq(s.errors.length, 0);

  const recentBefore = s.disk.get(recentPath);
  const writesBefore = s.writes.length;
  let rejectSave;
  s.nextHelper = new Promise((_resolve, reject) => { rejectSave = reject; });
  const failed = h.invoke('dialog:save', { content, path: file });
  rejectSave(new Error('工程保存未完成（替换工程 / ENOSPC）。未直接截断原文件。'));
  eq(await failed, null, 'helper failure does not masquerade as successful disk save');
  eq(s.disk.get(recentPath), recentBefore, 'failed save does not update recent list');
  eq(s.writes.length, writesBefore, 'failed project route does not directly write anywhere');
  eq(s.errors.at(-1).title, '保存失败');
  ok(!s.errors.at(-1).message.includes(content), 'dialog does not include synthetic screenplay');

  const beforeCancel = s.helperCalls.length;
  s.saves.push({ canceled: true, filePath: '/synthetic-cancel.zhsp' });
  eq(await h.invoke('dialog:save', { content, path: null, name: '合成新稿.zhsp' }), null);
  eq(s.helperCalls.length, beforeCancel, 'cancelled dialog performs no helper call');
  eq(s.dialogs.at(-1).defaultPath, '合成新稿.zhsp');
  deep(s.dialogs.at(-1).filters[0].extensions, ['zhsp']);

  s.saves.push({ canceled: false, filePath: '/synthetic-picked.zhsp' });
  eq(await h.invoke('dialog:save', { content, path: null, name: '合成新稿.zhsp' }), '/synthetic-picked.zhsp');
  eq(s.helperCalls.at(-1).file, '/synthetic-picked.zhsp');
  eq(s.helperCalls.at(-1).content, content);

  for (const ext of [undefined, 'zhsp', 'ZHSP']) {
    const picked = `/synthetic-save-as-${ext || 'default'}.zhsp`;
    const helperBefore = s.helperCalls.length, writeBefore = s.writes.length;
    s.saves.push({ canceled: false, filePath: picked });
    eq(await h.invoke('dialog:saveAs', { content, name: '合成另存为', ext }), picked);
    eq(s.helperCalls.length, helperBefore + 1, 'only zhsp Save As uses safe helper');
    eq(s.helperCalls.at(-1).file, picked);
    eq(s.helperCalls.at(-1).content, content);
    eq(s.writes.length, writeBefore, 'Save As project never direct-writes body/recent list');
    eq(s.dialogs.at(-1).defaultPath, `合成另存为.${ext || 'zhsp'}`);
  }

  for (const route of ['dialog:save', 'dialog:saveAs']) {
    for (const warning of ['directory-sync-EIO', 'directory-sync-unavailable', null, 'directory-sync-PRIVATE_PATH/data:image', 'directory-sync-' + 'A'.repeat(50)]) {
      const destination = '/synthetic-durability.zhsp';
      const warningBefore = s.warnings.length, errorBefore = s.errors.length;
      const writeBefore = s.writes.length;
      s.nextHelper = Promise.resolve({ path: destination, directorySynced: false, durabilityWarning: warning });
      if (route === 'dialog:saveAs') s.saves.push({ canceled: false, filePath: destination });
      eq(await h.invoke(route, { path: destination, content, name: '合成同步', ext: 'zhsp' }), destination,
        'post-commit sync diagnostics never return null');
      eq(s.errors.length, errorBefore, 'post-commit sync warning never opens failure dialog');
      eq(s.writes.length, writeBefore + (route === 'dialog:save' ? 1 : 0), 'successful Save recent behavior unchanged');
      eq(s.warnings.length, warningBefore + (warning === 'directory-sync-EIO' ? 1 : 0), 'only unexpected bounded sync code is logged');
      if (warning === 'directory-sync-EIO') {
        const logged = s.warnings.at(-1).join(' ');
        ok(!logged.includes(destination) && !logged.includes(content) && !/data:|base64/.test(logged), 'warning contains no project path/content');
        ok(logged.includes('directory-sync-EIO'));
      }
    }
    const destination = '/synthetic-no-log.zhsp';
    const errorBefore = s.errors.length;
    s.nextHelper = Promise.resolve({ path: destination, directorySynced: false, durabilityWarning: 'directory-sync-EIO' });
    if (route === 'dialog:saveAs') s.saves.push({ canceled: false, filePath: destination });
    s.throwOnWarn = true;
    eq(await h.invoke(route, { path: destination, content, name: '合成日志失败', ext: 'zhsp' }), destination,
      'logging itself failing cannot misreport the committed save');
    eq(s.errors.length, errorBefore);
    s.throwOnWarn = false;
  }

  const asWrites = s.writes.length;
  const asRecent = s.disk.get(recentPath);
  s.saves.push({ canceled: false, filePath: '/synthetic-failed-as.zhsp' });
  // The rejection is created only when the handler reaches the helper to avoid a
  // detached/unhandled rejected Promise in the harness itself.
  let rejectAs;
  s.nextHelper = new Promise((_resolve, reject) => { rejectAs = reject; });
  const failedAs = h.invoke('dialog:saveAs', { content, name: '合成另存为', ext: 'zhsp' });
  await Promise.resolve();
  rejectAs(new Error('工程保存未完成（准备新文件 / EACCES）。未直接截断原文件。'));
  eq(await failedAs, null);
  eq(s.writes.length, asWrites);
  eq(s.disk.get(recentPath), asRecent);
  eq(s.errors.at(-1).title, '导出失败');

  for (const ext of ['txt', 'md', 'html', 'fdx']) {
    const picked = `/synthetic-export.${ext}`;
    const helperBefore = s.helperCalls.length, writeBefore = s.writes.length;
    s.saves.push({ canceled: false, filePath: picked });
    eq(await h.invoke('dialog:saveAs', { content: 'synthetic-export-body', name: '合成导出', ext }), picked);
    eq(s.helperCalls.length, helperBefore, 'nonproject export does not enter project-save helper');
    eq(s.writes.length, writeBefore + 1);
    eq(s.writes.at(-1).file, picked);
    eq(s.writes.at(-1).data, 'synthetic-export-body');
    eq(s.writes.at(-1).encoding, 'utf8');
  }

  for (const mode of ['creative', 'print']) {
    const opts = { mode, name: '合成PDF.pdf', html: mode === 'creative' ? '<section>synthetic canvas</section>' : undefined };
    const helperBefore = s.helperCalls.length;
    const picked = `/synthetic-${mode}.pdf`;
    s.saves.push({ canceled: false, filePath: picked });
    eq(await h.invoke('pdf:export', opts), picked);
    eq(s.helperCalls.length, helperBefore, 'PDF transport remains independent from project saving');
    eq(s.pdfCalls.at(-1).opts, opts, 'PDF options/snapshot are passed through unchanged');
    eq(s.pdfCalls.at(-1).window, s.windows[0]);
    eq(s.writes.at(-1).file, picked);
    eq(s.writes.at(-1).data.toString(), 'synthetic-pdf-bytes');
    eq(s.writes.at(-1).encoding, undefined);
  }

  const pdfCallsBefore = s.pdfCalls.length, pdfWritesBefore = s.writes.length;
  s.saves.push({ canceled: true });
  eq(await h.invoke('pdf:export', { mode: 'creative', name: '合成取消.pdf' }), null);
  eq(s.pdfCalls.length, pdfCallsBefore);
  eq(s.writes.length, pdfWritesBefore);

  const unload = s.windows[0].webEvents.get('will-prevent-unload');
  ok(typeof unload === 'function', 'real createWindow installs native blocked-unload confirmation');
  for (const choice of [0, 1, undefined]) {
    s.choice = choice;
    let prevented = 0;
    unload({ preventDefault: () => { prevented++; } });
    eq(prevented, choice === 1 ? 1 : 0, 'Electron preventDefault means allow unload; cancel must not call it');
    const options = s.closeDialogs.at(-1);
    eq(options.defaultId, 0, 'staying is default');
    eq(options.cancelId, 0, 'Esc/closed confirmation stays in document');
    deep(options.buttons, ['继续写作', '仍然离开']);
    ok(options.detail.includes('自动恢复点不能替代工程文件'));
  }

  const windows = harness('win32');
  const ws = windows.state;
  eq(ws.windows[0].options.titleBarStyle, 'default', 'Windows retains native caption controls');
  eq(ws.windows[0].options.trafficLightPosition, undefined, 'macOS-only traffic light placement is absent');
  eq(ws.windows[0].options.webPreferences.contextIsolation, true);
  eq(ws.windows[0].options.webPreferences.nodeIntegration, false);
  deep(await windows.invoke('app:info'), { version: 'synthetic-test', platform: 'win32' });
  const menuItems = ws.menus[0].flatMap(menu => menu.submenu || []);
  for (const [label, accelerator] of [['保存', 'CmdOrCtrl+S'], ['撤销', 'CmdOrCtrl+Z'], ['重做', 'CmdOrCtrl+Shift+Z']]) {
    const item = menuItems.find(entry => entry.label === label);
    eq(item.accelerator, accelerator, `${label} retains the Windows Ctrl accelerator`);
    if (label !== '保存') eq(item.role, undefined, 'history stays on the renderer transaction route');
  }
  const windowsPath = 'C:\\合成文件夹 空格\\工程.zhsp';
  for (const [route, payload, expected] of [
    ['dialog:save', { content, name: '合成:第一稿?.zhsp' }, '合成_第一稿_.zhsp'],
    ['dialog:saveAs', { content, name: 'CON', ext: 'zhsp' }, '_CON.zhsp'],
    ['dialog:saveAs', { content, name: '合成/稿件', ext: 'txt' }, '合成_稿件.txt'],
    ['pdf:export', { mode: 'print', name: '合成<稿件>.pdf' }, '合成_稿件_.pdf'],
  ]) {
    ws.saves.push({ canceled: false, filePath: windowsPath });
    eq(await windows.invoke(route, payload), windowsPath, 'chosen Windows path is never rewritten');
    eq(ws.dialogs.at(-1).defaultPath, expected, 'only the suggested filename is Windows-safe');
  }
  const suggestionsBefore = ws.dialogs.length;
  eq(await windows.invoke('dialog:save', { content, path: windowsPath }), windowsPath);
  eq(ws.dialogs.length, suggestionsBefore, 'ordinary Save keeps the bound path without a new dialog');
  eq(ws.helperCalls.at(-1).file, windowsPath);
  const windowsRecent = JSON.parse(ws.writes.at(-1).data);
  eq(windowsRecent[0].name, '工程.zhsp', 'Windows recent list uses the basename, including Chinese paths');
  const windowsUnload = ws.windows[0].webEvents.get('will-prevent-unload');
  let windowsAllowed = false;
  windowsUnload({ preventDefault: () => { windowsAllowed = true; } });
  eq(windowsAllowed, false, 'Windows close protection still defaults to staying in the document');
  eq(ws.closeDialogs.at(-1).cancelId, 0);

  const { dialogFileName } = require('../electron/platform');
  for (const name of ['CON.zhsp', 'prn.pdf', 'AUX.txt', 'nul.md', 'COM1.zhsp', 'lpt9.zhsp', 'COM¹.zhsp']) {
    eq(dialogFileName(name, 'win32'), `_${name}`, 'reserved Windows device name gets a safe suggestion');
    eq(dialogFileName(name, 'darwin'), name, 'macOS suggestion is preserved');
  }
  eq(dialogFileName('合成\\路径/含:*?"<>|\u0001.zhsp', 'win32'), '合成_路径_含________.zhsp');
  eq(dialogFileName('合成.zhsp. ', 'win32'), '合成.zhsp');
  eq(dialogFileName('...', 'win32'), '未命名剧本');
  eq(dialogFileName('合成 正文.zhsp', 'win32'), '合成 正文.zhsp');
  console.log(`project-save-ipc: ${checks} assertions passed (real main.js in VM; synthetic dialogs/fs/helper; no native Electron)`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
