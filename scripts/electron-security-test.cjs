'use strict';

// Real main.js IPC/window policies in a VM, then real filesystem capability and
// project-backup operations confined to one newly-created synthetic directory.
// This does not launch Electron, access real userData or use personal projects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./project-save-ipc-test.cjs');
const { createFileAccess, LEDGER_NAME } = require('../electron/fileAccess');
const { createProjectSaver } = require('../electron/projectSave');
const { savePayload, pdfPayload } = require('../electron/security');
let checks = 0;
const eq = (value, expected, label) => { assert.deepEqual(value, expected, label); checks++; };
const ok = (value, label) => { assert.ok(value, label); checks++; };
const denied = async (operation, label) => { await assert.rejects(operation, /请求未获授权或参数无效/, label); checks++; };
const rejected = (operation, label) => { assert.throws(operation, /请求未获授权或参数无效/, label); checks++; };
const body = '{"synthetic":"合成安全测试"}';

async function ipcTests() {
  const h = harness();
  const s = h.state;
  const window = s.windows[0];
  const contents = window.webContents;
  const channels = ['dialog:open', 'dialog:save', 'dialog:saveAs', 'pdf:export', 'file:show', 'app:recent', 'app:info'];
  for (const event of [{}, { sender: {}, senderFrame: contents.mainFrame }, { sender: contents, senderFrame: null },
    { sender: contents, senderFrame: { url: contents.mainFrame.url, parent: contents.mainFrame } }]) {
    for (const channel of channels) await denied(() => h.invoke(channel, {}, event), `${channel} rejects unknown window or subframe`);
  }
  eq([s.dialogs.length, s.helperCalls.length, s.pdfCalls.length, s.writes.length], [0, 0, 0, 0], 'rejected senders cause no privileged effects');
  const trustedURL = contents.mainFrame.url;
  for (const url of ['https://attacker.invalid/', 'file:///tmp/other.html', `${trustedURL}?privileged=1`]) {
    contents.mainFrame.url = url;
    await denied(() => h.invoke('app:info'), 'main frame navigation invalidates native capability');
  }
  contents.mainFrame.url = `${trustedURL}#same-document`;
  eq((await h.invoke('app:info')).version, 'synthetic-test', 'same-document fragment preserves the trusted entry');
  contents.mainFrame.url = trustedURL;
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview', 'session:will-download']) {
    let prevented = false;
    window.webEvents.get(name)({ preventDefault() { prevented = true; } });
    eq(prevented, true, `${name} is blocked`);
  }
  eq(window.openHandler({ url: 'https://attacker.invalid/' }).action, 'deny');
  eq(window.permissionCheck(contents, 'media'), false);
  let permission;
  window.permissionRequest(contents, 'clipboard-read', value => { permission = value; });
  eq(permission, false);
  for (const [name, expected] of Object.entries({ sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false })) {
    eq(window.options.webPreferences[name], expected, `${name} is explicit`);
  }

  for (const payload of [null, [], {}, { content: 4 }, { content: body, path: '' }, { content: body, name: {} }, { content: body, path: '../escape.zhsp' }, { content: body, path: '/synthetic/app.js' }]) {
    await denied(() => h.invoke('dialog:save', payload), 'invalid save shape/path rejected before dialog');
  }
  for (const ext of ['js', '../zhsp', 'pdf', '', 4]) await denied(() => h.invoke('dialog:saveAs', { content: body, name: '合成', ext }));
  for (const opts of [undefined, {}, { mode: 'other' }, { mode: 'creative', html: '<script>bad</script>' },
    { mode: 'creative', html: '<section class="export-sheet"></section>', pageSize: { width: Infinity, height: 200000 } },
    { mode: 'creative', html: '<section class="export-sheet"></section>', pageSize: { width: 210000, height: 5000001 } }]) {
    if (opts && !Object.keys(opts).length) continue; // Empty options preserve the legacy A4 print route.
    await denied(() => h.invoke('pdf:export', opts), 'invalid PDF request rejected before native dialog');
  }
  eq(s.dialogs.length, 0, 'invalid inputs never show native dialogs');

  const stale = '/synthetic/old-recovery.zhsp';
  s.disk.set('/synthetic-qa-userData/recent.json', JSON.stringify([{ path: stale, name: '旧记录', updatedAt: 1 }]));
  eq(await h.invoke('dialog:save', { content: body, path: stale }), null, 'old recovery/recent path requires native confirmation; cancellation is null');
  eq(s.dialogs.at(-1).title, '确认恢复工程的保存位置');
  eq(s.dialogs.at(-1).defaultPath, stale, 'old path is a dialog suggestion, not permission');
  eq([s.helperCalls.length, s.disk.has(stale)], [0, false], 'cancel does not save or create a recovery target');
  await denied(() => h.invoke('file:show', stale), 'recent path does not grant shell access');
  s.saves.push({ canceled: false, filePath: stale });
  eq(await h.invoke('dialog:save', { content: body, path: stale }), stale);
  const dialogs = s.dialogs.length;
  eq(await h.invoke('dialog:save', { content: body, path: stale }), stale, 'confirmed project supports ordinary Save');
  eq(s.dialogs.length, dialogs, 'ordinary Save does not repeatedly prompt');
  const restarted = harness('darwin', s.disk);
  eq(await restarted.invoke('dialog:save', { content: body, path: stale }), stale, 'main-process persisted grant survives restart');
  eq(restarted.state.dialogs.length, 0, 'authorized recovery after restart does not require Save As');
  await restarted.invoke('file:show', stale);
  eq(restarted.state.shown, [stale]);
  await denied(() => restarted.invoke('file:show', '/synthetic/unrelated.txt'));
  for (const ext of ['fdx', 'txt', 'md', 'html']) {
    const file = `/synthetic/export.${ext}`;
    restarted.state.saves.push({ canceled: false, filePath: file });
    eq(await restarted.invoke('dialog:saveAs', { content: body, name: '合成', ext }), file);
    await restarted.invoke('file:show', file);
    eq(restarted.state.shown.at(-1), file, 'successfully exported file can be revealed');
  }
  restarted.state.saves.push({ canceled: false, filePath: '/synthetic/not-script.js' });
  await denied(() => restarted.invoke('dialog:saveAs', { content: body, name: '合成', ext: 'txt' }), 'native output extension must match allowed export type');
  eq(restarted.state.disk.has('/synthetic/not-script.js'), false);

  // A dialog completing after navigation cannot grant authority or write. This
  // includes a reload of the same trusted URL, not just a foreign destination.
  let finishDialog;
  const pendingDialog = new Promise(resolve => { finishDialog = resolve; });
  s.saves.push(pendingDialog);
  const pending = h.invoke('dialog:saveAs', { content: body, name: '合成', ext: 'zhsp' });
  window.webEvents.get('did-start-navigation')({ isMainFrame: true });
  finishDialog({ canceled: false, filePath: '/synthetic/stale-dialog.zhsp' });
  await denied(() => pending, 'same-entry reload invalidates an in-flight dialog');
  eq(s.helperCalls.some(call => call.file === '/synthetic/stale-dialog.zhsp'), false);

  let finishPdf;
  s.nextPdf = new Promise(resolve => { finishPdf = resolve; });
  s.saves.push({ canceled: false, filePath: '/synthetic/stale.pdf' });
  const pendingPdf = h.invoke('pdf:export', { mode: 'print' });
  await Promise.resolve(); await Promise.resolve();
  contents.mainFrame.url = 'https://attacker.invalid/';
  finishPdf(Buffer.from('synthetic PDF'));
  await denied(() => pendingPdf, 'PDF completion cannot write for a navigated sender');
  eq(s.disk.has('/synthetic/stale.pdf'), false);
  contents.mainFrame.url = trustedURL;
  const windows = harness('win32');
  for (const file of ['C:relative.zhsp', '\\rooted.zhsp', 'C:\\temp\\data.zhsp:stream', '\\\\?\\C:\\temp\\data.zhsp', 'C:\\temp\\CON.zhsp']) {
    await denied(() => windows.invoke('dialog:save', { content: body, path: file }), 'Windows device/ADS/drive-relative target is rejected');
  }
}

async function filesystemTests() {
  const nativeRealpath = fs.realpathSync.native || fs.realpathSync;
  const requestedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-security-synthetic-'));
  const root = nativeRealpath(requestedRoot);
  const data = path.join(root, 'userData');
  const docs = path.join(root, 'documents');
  const app = path.join(root, 'application');
  for (const directory of [data, docs, app]) fs.mkdirSync(directory);
  const options = { userData: () => data, protectedRoots: [app] };
  const access = createFileAccess(options);
  const save = createProjectSaver();
  const file = path.join(docs, '合成工程.zhsp');
  try {
    const requestedDirectory = path.join(requestedRoot, 'documents');
    const legacyDirectory = fs.realpathSync(requestedDirectory);
    const nativeDirectory = nativeRealpath(requestedDirectory);
    const promiseDirectory = await fs.promises.realpath(requestedDirectory);
    const identity = (canonical, stat) => ({ path: canonical, dev: stat.dev, ino: stat.ino });
    const canonicalEvidence = {
      platform: process.platform,
      requested: identity(requestedDirectory, fs.statSync(requestedDirectory)),
      legacy: identity(legacyDirectory, fs.statSync(legacyDirectory)),
      native: identity(nativeDirectory, fs.statSync(nativeDirectory)),
      async: identity(promiseDirectory, await fs.promises.lstat(promiseDirectory)),
    };
    console.log(`synthetic-directory-canonicalization: ${JSON.stringify(canonicalEvidence)}`);
    eq(canonicalEvidence.native, canonicalEvidence.async,
      'native sync and async resolve the newly-created synthetic directory to the same path and identity');
    eq(access.authorizedProject(file), null, 'filename alone conveys no capability');
    const picked = access.selected(file, 'zhsp');
    const expectedParent = { path: path.dirname(picked.canonical), ...picked.parent };
    const asyncDirectory = await fs.promises.realpath(path.dirname(picked.canonical));
    const asyncParent = await fs.promises.lstat(asyncDirectory);
    eq({ path: asyncDirectory, dev: asyncParent.dev, ino: asyncParent.ino }, expectedParent,
      'native sync selection and async save agree on canonical directory and identity');
    await save(picked.canonical, body, expectedParent); access.grantProject(picked);
    await save(access.authorizedProject(file).canonical, 'synthetic next version', expectedParent);
    eq(fs.readFileSync(file, 'utf8'), 'synthetic next version');
    eq(fs.readFileSync(`${file}.guangying-backup`, 'utf8'), body, 'real project saver retains previous-version backup');
    const reopened = createFileAccess(options);
    eq(reopened.authorizedProject(file).canonical, file, 'real persisted grant authorizes the same project after restart');
    eq(reopened.authorizedProject(path.join(docs, 'other.zhsp')), null, 'grant does not cover its parent directory');
    rejected(() => reopened.authorizedProject(`${file}.guangying-backup`));
    rejected(() => reopened.authorizedProject('relative.zhsp'));
    rejected(() => reopened.selected(path.join(app, 'index.html'), 'html'), 'application code cannot be an export target');
    rejected(() => reopened.selected(path.join(data, 'arbitrary.zhsp'), 'zhsp'), 'renderer cannot write into internal userData');
    const text = path.join(docs, 'import.txt'); fs.writeFileSync(text, 'synthetic import');
    eq(reopened.readSelected(text).content, 'synthetic import');
    rejected(() => reopened.authorizedProject(text), 'imported text is not a writable project grant');
    eq(reopened.shownPath(text), text);
    const project2 = path.join(docs, 'opened.zhsp'); fs.writeFileSync(project2, body);
    eq(reopened.readSelected(project2).content, body);
    eq(reopened.authorizedProject(project2).canonical, project2, 'native open grants project Save');

    // Windows legacy realpathSync can preserve an 8.3 spelling while native /
    // Promise realpath expands it. Model that API difference on every platform,
    // keeping real disk identities and writes rather than weakening comparisons.
    const aliasRoot = path.join(path.dirname(root), 'GUANGY~1');
    const actualPath = input => input === aliasRoot || input.startsWith(`${aliasRoot}${path.sep}`)
      ? root + input.slice(aliasRoot.length) : input;
    const legacyRealpath = input => {
      const canonical = nativeRealpath(actualPath(input));
      return canonical === root || canonical.startsWith(`${root}${path.sep}`)
        ? aliasRoot + canonical.slice(root.length) : canonical;
    };
    legacyRealpath.native = input => nativeRealpath(actualPath(input));
    const aliasFs = new Proxy(fs, { get(api, property) {
      if (property === 'realpathSync') return legacyRealpath;
      if (property === 'statSync' || property === 'lstatSync') return (input, ...args) => api[property](actualPath(input), ...args);
      const member = api[property]; return typeof member === 'function' ? member.bind(api) : member;
    } });
    const aliasedAccess = createFileAccess({ ...options, fileSystem: aliasFs });
    const aliasedRequest = path.join(aliasRoot, 'documents', 'native-canonical.zhsp');
    const canonicalFile = path.join(docs, 'native-canonical.zhsp');
    const nativePick = aliasedAccess.selected(aliasedRequest, 'zhsp');
    eq(nativePick.canonical, canonicalFile, 'legacy short spelling is resolved natively before granting access');
    const nativeParent = { path: path.dirname(nativePick.canonical), ...nativePick.parent };
    await save(nativePick.canonical, body, nativeParent); aliasedAccess.grantProject(nativePick);
    eq(fs.readFileSync(canonicalFile, 'utf8'), body, 'native canonical grant works with actual async atomic save');
    const aliasReopened = createFileAccess({ ...options, fileSystem: aliasFs });
    eq(aliasReopened.authorizedProject(aliasedRequest).canonical, canonicalFile, 'native canonical grant survives restart and alias spelling');
    rejected(() => aliasedAccess.selected(path.join(aliasRoot, 'application', 'index.html'), 'html'),
      'native canonicalization also protects application directories through aliases');
    rejected(() => aliasedAccess.selected(path.join(aliasRoot, 'userData', 'project.zhsp'), 'zhsp'),
      'native canonicalization also protects userData through aliases');
    await assert.rejects(() => save(canonicalFile, 'must not overwrite', { ...nativeParent, path: aliasRoot }),
      error => error.code === 'EUNSAFEPATH'); checks++;
    await assert.rejects(() => save(canonicalFile, 'must not overwrite', { ...nativeParent, ino: -1 }),
      error => error.code === 'EUNSAFEPATH'); checks++;
    eq(fs.readFileSync(canonicalFile, 'utf8'), body, 'canonical spelling and inode mismatches still fail closed without changing the file');

    const outside = path.join(root, 'outside.txt'); fs.writeFileSync(outside, 'untouched');
    const hardlink = path.join(docs, 'hardlink.txt'); fs.linkSync(outside, hardlink);
    rejected(() => reopened.writeExport(reopened.selected(hardlink, 'txt'), 'bad'), 'export does not truncate a hard-linked unrelated file');
    eq(fs.readFileSync(outside, 'utf8'), 'untouched');
    const output = path.join(docs, 'fresh.txt');
    reopened.writeExport(reopened.selected(output, 'txt'), '合成导出', 'utf8');
    eq(fs.readFileSync(output, 'utf8'), '合成导出');
    eq(reopened.shownPath(output), output);
    const flags = path.join(docs, 'symlink.zhsp');
    try { fs.symlinkSync(file, flags); }
    catch (error) { if (process.platform !== 'win32' || error.code !== 'EPERM') throw error; }
    if (fs.existsSync(flags)) {
      rejected(() => reopened.authorizedProject(flags), 'final-component symlink cannot be saved');
      rejected(() => reopened.readSelected(flags), 'native read cannot follow final-component symlink');
      const race = path.join(docs, 'selected.txt');
      const selection = reopened.selected(race, 'txt'); fs.symlinkSync(outside, race);
      rejected(() => reopened.writeExport(selection, 'bad'), 'symlink appearing after a native selection cannot redirect output');
      eq(fs.readFileSync(outside, 'utf8'), 'untouched');
    } else console.log('  SKIP Windows file symlink requires OS developer/admin privilege; hardlink and parent identity checks still run');

    const oldDocs = path.join(root, 'old-documents'); fs.renameSync(docs, oldDocs); fs.mkdirSync(docs);
    rejected(() => reopened.authorizedProject(file), 'replacement parent directory invalidates persisted capability');
    const noLedger = path.join(root, 'no-ledger'); fs.mkdirSync(noLedger);
    fs.writeFileSync(path.join(noLedger, 'recent.json'), JSON.stringify([{ path: file }]));
    eq(createFileAccess({ userData: () => noLedger }).authorizedProject(file), null, 'recent list is never migrated into write grants');
    fs.writeFileSync(path.join(noLedger, LEDGER_NAME), 'broken authorization metadata');
    eq(createFileAccess({ userData: () => noLedger }).authorizedProject(file), null, 'corrupt ledger fails closed');

    for (const phase of ['admission', 'prepared']) {
      const directory = path.join(root, `race-${phase}`); fs.mkdirSync(directory);
      const target = path.join(directory, 'project.zhsp'); fs.writeFileSync(target, body);
      const selected = access.selected(target, 'zhsp');
      const expected = { path: path.dirname(selected.canonical), ...selected.parent };
      let swapped = false;
      const oldDirectory = `${directory}-original`;
      const foreignTemporary = path.join(directory, '.guangying-save-safe-race-token.tmp');
      const replaceDirectory = () => {
        if (swapped) return;
        swapped = true; fs.renameSync(directory, oldDirectory); fs.mkdirSync(directory);
        fs.writeFileSync(target, 'unrelated target must survive');
        fs.writeFileSync(foreignTemporary, 'unrelated temporary must survive');
      };
      const racedFs = new Proxy(fs.promises, { get(api, property) {
        if (property === 'realpath' && phase === 'admission') return async file => {
          replaceDirectory(); return api.realpath(file);
        };
        if (property === 'open' && phase === 'prepared') return async (...args) => {
          const handle = await api.open(...args);
          return new Proxy(handle, { get(fd, operation) {
            if (operation === 'sync') return async () => { await fd.sync(); replaceDirectory(); };
            const member = fd[operation]; return typeof member === 'function' ? member.bind(fd) : member;
          } });
        };
        const member = api[property]; return typeof member === 'function' ? member.bind(api) : member;
      } });
      const guarded = createProjectSaver({ fileSystem: racedFs, token: () => 'safe-race-token' });
      await assert.rejects(() => guarded(target, 'must not cross boundary', expected), error => error.code === 'EUNSAFEPATH'); checks++;
      eq(fs.readFileSync(target, 'utf8'), 'unrelated target must survive', `${phase}: parent swap cannot redirect project write`);
      eq(fs.readFileSync(path.join(oldDirectory, 'project.zhsp'), 'utf8'), body, `${phase}: original project is preserved`);
      eq(fs.readFileSync(foreignTemporary, 'utf8'), 'unrelated temporary must survive', `${phase}: cleanup cannot delete through an unauthorized replacement directory`);
      eq(fs.existsSync(`${target}.guangying-backup`), false, `${phase}: no backup is written in the replacement directory`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function preloadTests() {
  const source = fs.readFileSync(path.join(__dirname, '../electron/preload.js'), 'utf8');
  for (const mainFrame of [true, false]) {
    let exposed;
    let received;
    vm.runInNewContext(source, { process: { isMainFrame: mainFrame }, require(name) {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld: (key, api) => { exposed = { key, api }; } },
        ipcRenderer: { invoke() {}, on: (_name, callback) => { received = callback; }, removeListener() {} } };
    } });
    eq(!!exposed, mainFrame, 'only main frame receives bridge');
    if (exposed) {
      eq(exposed.key, 'api');
      eq(Object.isFrozen(exposed.api), true);
      eq(Object.keys(exposed.api).sort(), ['exportPdf', 'getInfo', 'getRecent', 'isElectron', 'onMenu', 'openProject', 'saveProject', 'saveProjectAs', 'showInFolder'].sort(), 'no generic invoke/fs primitive exposed');
      let values;
      exposed.api.onMenu((...args) => { values = args; });
      received({ sender: 'privileged Electron event' }, 'file:save');
      eq(values, ['file:save'], 'menu callback cannot see the Electron event');
      assert.throws(() => exposed.api.onMenu({}), /菜单监听器必须是函数/); checks++;
    }
  }
  rejected(() => savePayload({ content: body, name: '\0' }));
  rejected(() => pdfPayload({ mode: 'creative', html: '<section class="export-sheet"></section>', pageSize: { width: 0, height: 297000 } }));
}

(async () => {
  await ipcTests(); await filesystemTests(); preloadTests();
  console.log(`electron-security: ${checks} assertions passed (main/preload VM + isolated real filesystem; no native Electron)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
