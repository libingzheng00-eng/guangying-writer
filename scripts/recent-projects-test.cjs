'use strict';

// Registry and capability tests use newly created synthetic directories only.
// Main-process integration uses the same in-memory VM as project-save-ipc.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRecentProjects, MAX_RECENT, MAX_RECENT_BYTES } = require('../electron/recentProjects');
const { createFileAccess } = require('../electron/fileAccess');
const { harness } = require('./project-save-ipc-test.cjs');

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const rejected = (operation, message) => { assert.throws(operation, /请求未获授权或参数无效/, message); checks++; };
const denied = async (operation, message) => { await assert.rejects(operation, /请求未获授权或参数无效/, message); checks++; };
const body = '{"title":"合成最近项目","elements":[]}';

function registryTests() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-recent-synthetic-'));
  let sequence = 0;
  function fixture(label) {
    const home = path.join(root, label), data = path.join(home, 'userData'), docs = path.join(home, 'documents');
    fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(docs);
    let timestamp = 1000;
    const fileAccess = createFileAccess({ userData: () => data });
    const options = { userData: () => data, fileAccess, now: () => timestamp, token: () => `synthetic-${++sequence}` };
    const api = createRecentProjects(options);
    return { api, fileAccess, options, data, docs, recent: path.join(data, 'recent.json'),
      time: value => { timestamp = value; },
      file: (name = '工程.zhsp') => { const file = path.join(docs, name); fs.writeFileSync(file, body); return file; } };
  }
  try {
    const f = fixture('ordinary');
    eq(f.api.list(), [], 'fresh userData has no recent projects');
    eq(fs.readdirSync(f.data), [], 'reading empty recent metadata does not create files');
    const a = f.file('工程甲.zhsp'), b = f.file('工程乙.zhsp');
    const first = f.api.commit({ path: a, name: '合成标题甲', opened: false });
    eq(first.updatedAt, 1000, 'first save initializes a recent timestamp');
    eq(first.name, '合成标题甲');
    eq(first.pinned, false);
    eq(f.fileAccess.authorizedProject(a), null, 'recent metadata never grants project writes');
    eq(f.api.list()[0].needsAuthorization, true, 'existing unauthorized path is identified separately');
    eq(f.api.list()[0].missing, false);
    f.time(2000); f.api.commit({ path: b, name: '合成标题乙' });
    f.time(3000); f.api.commit({ path: a, name: '修改后的合成标题', opened: false });
    eq(f.api.list().map(item => item.path), [b, a], 'ordinary save does not move a previously opened project to the top');
    eq(f.api.find(first.id).updatedAt, 1000, 'ordinary save preserves last-open time');
    eq(f.api.find(first.id).name, '修改后的合成标题', 'ordinary save may refresh the display name');
    f.api.pin(first.id, true);
    eq(f.api.list().map(item => item.path), [a, b], 'pinned projects sort before newer unpinned projects');
    eq(f.api.find(first.id).updatedAt, 1000, 'pinning is not a project open');
    const restarted = createRecentProjects(f.options);
    eq(restarted.find(first.id).pinned, true, 'pin and stable ID survive registry restart');
    f.time(4000); restarted.commit({ path: a });
    eq(restarted.find(first.id).updatedAt, 4000, 'successful reopen refreshes last-open time');
    eq(restarted.find(first.id).name, '修改后的合成标题', 'opening without a name preserves its display name');
    f.fileAccess.readSelected(a);
    eq(restarted.list().find(item => item.id === first.id).needsAuthorization, false, 'independent native selection grants safe reopen');
    fs.unlinkSync(a);
    eq(restarted.list().find(item => item.id === first.id).missing, true, 'missing file remains visible');
    eq(restarted.list().find(item => item.id === first.id).needsAuthorization, true);
    const moved = f.file('移动后.zhsp');
    f.time(5000); restarted.commit({ path: moved, replaceId: first.id, name: '移动后的合成标题' });
    eq(restarted.find(first.id).path, moved, 'relocation preserves the record identity');
    eq(restarted.find(first.id).pinned, true, 'relocation preserves pin state');
    eq(restarted.list().length, 2, 'relocation replaces the missing record');
    const second = restarted.list().find(item => item.path === b);
    restarted.commit({ path: b, replaceId: first.id });
    eq(restarted.list().length, 1, 'relocating to an existing recent path merges duplicate metadata');
    eq(restarted.find(first.id).pinned, true);
    rejected(() => restarted.find(second.id), 'merged duplicate does not remain addressable');
    const bBefore = fs.readFileSync(b, 'utf8');
    restarted.remove(first.id);
    eq(restarted.list(), [], 'remove deletes only the recent record');
    eq(fs.readFileSync(b, 'utf8'), bBefore, 'remove never deletes or changes the project file');
    rejected(() => restarted.commit({ path: moved, replaceId: first.id }), 'a stale relocation cannot resurrect a removed record');

    const migration = fixture('migration');
    const legacy = migration.file('旧工程.zhsp'), imported = migration.file('导入原稿.txt');
    const legacyRaw = JSON.stringify([{ path: legacy, name: '旧工程', updatedAt: 17 },
      { path: imported, name: '导入原稿', updatedAt: 20 }]);
    fs.writeFileSync(migration.recent, legacyRaw);
    const migrated = migration.api.list();
    eq(migrated.length, 1, 'legacy imports do not become recent project associations');
    eq(migrated[0].path, legacy); eq(migrated[0].updatedAt, 17); eq(migrated[0].pinned, false);
    ok(/^[a-zA-Z0-9-]+$/.test(migrated[0].id), 'legacy path receives an opaque stable ID');
    eq(createRecentProjects(migration.options).list()[0].id, migrated[0].id, 'legacy IDs are stable before migration is persisted');
    eq(fs.readFileSync(migration.recent, 'utf8'), legacyRaw, 'read-only migration does not silently rewrite old metadata');
    eq(migration.fileAccess.authorizedProject(legacy), null, 'legacy recent paths do not migrate into the permission ledger');
    rejected(() => migration.api.commit({ path: imported }), 'imported text cannot be committed as a recent project');
    migration.api.pin(migrated[0].id, true);
    eq(JSON.parse(fs.readFileSync(migration.recent, 'utf8'))[0].id, migrated[0].id, 'first explicit mutation persists migration');

    const malformed = fixture('malformed');
    const sample = { id: 'synthetic-valid', path: malformed.file(), name: '合成', updatedAt: 1, pinned: false };
    for (const invalid of ['not JSON', '{}', JSON.stringify([null]), JSON.stringify([{ ...sample, path: '../relative.zhsp' }]),
      JSON.stringify([{ ...sample, id: '../bad' }]), JSON.stringify([{ ...sample, name: '\u0000bad' }]),
      JSON.stringify([{ ...sample, pinned: 1 }]), JSON.stringify([{ ...sample, updatedAt: -1 }]),
      JSON.stringify([sample, { ...sample, path: path.join(malformed.docs, 'duplicate-id.zhsp') }]),
      JSON.stringify(Array.from({ length: MAX_RECENT + 1 }, (_entry, index) => ({ ...sample, id: `entry-${index}`, path: path.join(malformed.docs, `${index}.zhsp`) })))]) {
      fs.writeFileSync(malformed.recent, invalid);
      assert.throws(() => malformed.api.list()); checks++;
      assert.throws(() => malformed.api.commit({ path: sample.path })); checks++;
      eq(fs.readFileSync(malformed.recent, 'utf8'), invalid, 'invalid metadata is preserved instead of overwritten');
    }
    fs.writeFileSync(malformed.recent, ' '.repeat(MAX_RECENT_BYTES + 1));
    rejected(() => malformed.api.list(), 'oversized metadata is rejected before parsing');
    fs.unlinkSync(malformed.recent);
    for (const operation of [() => malformed.api.find(''), () => malformed.api.remove('../x'),
      () => malformed.api.pin('id', 'true'), () => malformed.api.commit({ path: sample.path, name: {} }),
      () => malformed.api.commit({ path: sample.path, name: 'x'.repeat(4097) })]) rejected(operation);

    const capacity = fixture('capacity');
    const items = Array.from({ length: MAX_RECENT }, (_item, index) => ({
      id: `capacity-${index}`, path: path.join(capacity.docs, `${index}.zhsp`), name: `合成${index}`, updatedAt: index + 1, pinned: index === 0,
    }));
    fs.writeFileSync(capacity.recent, JSON.stringify(items));
    capacity.time(MAX_RECENT + 10);
    capacity.api.commit({ path: capacity.file('新工程.zhsp') });
    eq(capacity.api.list().length, MAX_RECENT, 'recent registry is bounded');
    eq(capacity.api.find('capacity-0').pinned, true, 'capacity cleanup preserves the oldest pinned record');
    rejected(() => capacity.api.find('capacity-1'), 'capacity cleanup evicts the oldest unpinned record');
    const allPinned = capacity.api.list().map(({ missing, needsAuthorization, ...item }) => ({ ...item, pinned: true }));
    fs.writeFileSync(capacity.recent, JSON.stringify(allPinned));
    const pinnedRaw = fs.readFileSync(capacity.recent, 'utf8');
    rejected(() => capacity.api.commit({ path: capacity.file('容量已满.zhsp') }), 'new records do not evict an all-pinned registry');
    eq(fs.readFileSync(capacity.recent, 'utf8'), pinnedRaw, 'all pinned records survive rejected admission');

    const atomic = fixture('atomic');
    const file = atomic.file(); atomic.api.commit({ path: file });
    const raw = fs.readFileSync(atomic.recent, 'utf8');
    const events = [];
    const observedFs = new Proxy(fs, { get(api, property) {
      const member = api[property];
      if (['openSync', 'writeFileSync', 'fsyncSync', 'closeSync', 'renameSync', 'unlinkSync'].includes(property)) {
        return (...args) => { events.push({ operation: property, args }); return member(...args); };
      }
      return typeof member === 'function' ? member.bind(api) : member;
    } });
    createRecentProjects({ ...atomic.options, fileSystem: observedFs }).pin(atomic.api.list()[0].id, true);
    const temporaryOpen = events.find(event => event.operation === 'openSync' && String(event.args[0]).includes('.recent-projects-'));
    ok(temporaryOpen, 'metadata uses a sibling temporary file');
    ok((temporaryOpen.args[1] & fs.constants.O_EXCL) !== 0, 'temporary creation is exclusive');
    eq(temporaryOpen.args[2], 0o600, 'temporary metadata has private permissions');
    const renameIndex = events.findIndex(event => event.operation === 'renameSync');
    const syncIndex = events.findIndex(event => event.operation === 'fsyncSync');
    ok(syncIndex >= 0 && syncIndex < renameIndex, 'metadata is synced before the atomic replacement');
    eq(events[renameIndex].args, [temporaryOpen.args[0], atomic.recent]);
    eq(events.some(event => event.operation === 'writeFileSync' && event.args[0] === atomic.recent), false, 'existing metadata is never directly truncated');
    for (const operation of ['writeFileSync', 'renameSync']) {
      fs.writeFileSync(atomic.recent, raw);
      const failureFs = new Proxy(fs, { get(api, property) {
        if (property === operation) return () => { throw Object.assign(new Error('synthetic metadata failure'), { code: 'ENOSPC' }); };
        const member = api[property]; return typeof member === 'function' ? member.bind(api) : member;
      } });
      assert.throws(() => createRecentProjects({ ...atomic.options, fileSystem: failureFs }).pin(atomic.api.list()[0].id, true), /synthetic metadata failure/); checks++;
      eq(fs.readFileSync(atomic.recent, 'utf8'), raw, `${operation} failure preserves previous metadata`);
      eq(fs.readdirSync(atomic.data).filter(name => name.startsWith('.recent-projects-')), [], `${operation} failure cleans only the owned temporary file`);
      eq(fs.readFileSync(file, 'utf8'), body, `${operation} metadata failure leaves the project untouched`);
    }
    const foreign = path.join(atomic.data, '.recent-projects-collision.tmp'); fs.writeFileSync(foreign, 'unrelated temporary');
    assert.throws(() => createRecentProjects({ ...atomic.options, token: () => 'collision' }).pin(atomic.api.list()[0].id, true), error => error.code === 'EEXIST'); checks++;
    eq(fs.readFileSync(foreign, 'utf8'), 'unrelated temporary', 'exclusive-create collision does not delete an unowned file');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function ipcTests() {
  const h = harness(), s = h.state;
  const recentPath = '/synthetic-qa-userData/recent.json';
  const a = '/synthetic-recent/甲.zhsp', b = '/synthetic-recent/乙.zhsp';
  s.disk.set(a, body); s.disk.set(b, body);
  const choose = file => s.opens.push({ canceled: false, filePaths: [file] });
  eq(await h.invoke('app:recent'), []);
  choose(a);
  const opened = await h.invoke('dialog:open');
  eq(opened.path, a); eq(opened.content, body);
  ok(typeof opened.openToken === 'string', 'native project read returns an opaque completion token');
  eq(Object.hasOwn(opened, 'previousPath'), false, 'ordinary native open does not claim a previous project association');
  eq(await h.invoke('app:recent'), [], 'native selection does not record a project before renderer validation');
  eq(await h.invoke('recent:commitOpen', { token: opened.openToken, name: '合成标题甲' }), true);
  const first = (await h.invoke('app:recent'))[0];
  eq(first.name, '合成标题甲'); eq(first.path, a); eq(first.missing, false); eq(first.needsAuthorization, false);
  await denied(() => h.invoke('recent:commitOpen', { token: opened.openToken }), 'a completion token is single-use');
  await denied(() => h.invoke('recent:open', { id: first.id, path: b }), 'renderer cannot replace a registry path in an ID-scoped open');
  await denied(() => h.invoke('recent:open', { id: first.id, previousPath: b }), 'renderer cannot forge a previous project path in a recent-open request');
  await denied(() => h.invoke('recent:open', { id: 'missing-record' }), 'unrecognized IDs cannot read files');
  await denied(() => h.invoke('recent:open', { id: 'missing-record', allowPrompt: false }), 'automatic mode does not hide an invalid record ID');
  for (const allowPrompt of [0, 1, null, 'false', {}, []]) {
    await denied(() => h.invoke('recent:open', { id: first.id, allowPrompt }), 'allowPrompt requires a boolean when provided');
  }
  await denied(() => h.invoke('recent:open', { id: first.id, allowPrompt: false, arbitrary: true }), 'automatic mode retains the strict payload whitelist');
  const dialogsBefore = s.openDialogs.length;
  const beforeCommit = s.disk.get(recentPath);
  const reopened = await h.invoke('recent:open', { id: first.id, allowPrompt: false });
  eq(reopened.path, a); eq(s.openDialogs.length, dialogsBefore, 'independently authorized recent project opens without a new dialog');
  eq(Object.hasOwn(reopened, 'previousPath'), false, 'authorized automatic recent open does not create a relocation context');
  eq(s.disk.get(recentPath), beforeCommit, 'reading a recent project does not mutate registry metadata');
  await h.invoke('recent:commitOpen', { token: reopened.openToken });
  await h.invoke('recent:pin', { id: first.id, pinned: true });
  eq((await h.invoke('app:recent'))[0].pinned, true);
  const restart = harness('darwin', s.disk);
  eq((await restart.invoke('app:recent'))[0].pinned, true, 'pin survives main-process restart');
  eq((await restart.invoke('recent:open', { id: first.id })).path, a, 'file identity grant survives main-process restart');
  eq(restart.state.openDialogs.length, 0);

  const oldEntry = JSON.parse(s.disk.get(recentPath))[0];
  oldEntry.updatedAt = 1; s.disk.set(recentPath, JSON.stringify([oldEntry]));
  await h.invoke('dialog:save', { path: a, content: body });
  eq((await h.invoke('app:recent'))[0].updatedAt, 1, 'ordinary Save does not change last-open ordering');
  s.saves.push({ canceled: false, filePath: a });
  await h.invoke('dialog:saveAs', { content: body, name: '合成甲', ext: 'zhsp' });
  eq((await h.invoke('app:recent'))[0].updatedAt, 1, 'Save As to an existing recent path preserves last-open time');
  eq((await h.invoke('app:recent'))[0].pinned, true, 'save routes preserve the pin');

  choose(a); const superseded = await h.invoke('dialog:open');
  choose(b); const latest = await h.invoke('dialog:open');
  await denied(() => h.invoke('recent:commitOpen', { token: superseded.openToken }), 'a new open invalidates the previous uncommitted selection');
  eq(await h.invoke('recent:commitOpen', { token: latest.openToken, name: '合成标题乙' }), true);
  const second = (await h.invoke('app:recent')).find(item => item.path === b);
  ok(second, 'only the latest successful load is recorded');
  for (const extension of ['txt', 'md', 'fdx']) {
    const imported = `/synthetic-recent/导入.${extension}`; s.disk.set(imported, 'synthetic import'); choose(imported);
    const before = s.disk.get(recentPath);
    const result = await h.invoke('dialog:open');
    eq(result.path, imported); eq(Object.hasOwn(result, 'openToken'), false, 'imports never receive a project commit token');
    eq(s.disk.get(recentPath), before, 'import does not change recent project associations');
  }
  const malformedProject = '/synthetic-recent/损坏工程.zhsp'; s.disk.set(malformedProject, 'not a project JSON');
  const beforeMalformed = s.disk.get(recentPath);
  choose(malformedProject); const malformedRead = await h.invoke('dialog:open');
  eq(malformedRead.content, 'not a project JSON', 'main process leaves project parsing to the renderer');
  ok(malformedRead.openToken, 'a raw read alone only offers a token');
  eq(s.disk.get(recentPath), beforeMalformed, 'a project rejected by renderer validation is absent unless it is explicitly committed');

  const pendingRemove = await h.invoke('recent:open', { id: second.id });
  const bodyBefore = s.disk.get(b);
  await h.invoke('recent:remove', { id: second.id });
  eq(s.disk.get(b), bodyBefore, 'recent remove leaves user file bytes untouched');
  await denied(() => h.invoke('recent:commitOpen', { token: pendingRemove.openToken }), 'pending read cannot resurrect a removed recent record');

  const moved = '/synthetic-recent/重新定位.zhsp'; s.disk.set(moved, body);
  s.disk.delete(a);
  eq((await h.invoke('app:recent'))[0].missing, true, 'missing paths remain actionable in the list');
  const beforeCanceledLocate = s.disk.get(recentPath);
  const missingDialogs = s.openDialogs.length;
  eq(await h.invoke('recent:open', { id: first.id, allowPrompt: false }), null, 'automatic resume safely stops when a previously listed file disappears');
  eq(s.openDialogs.length, missingDialogs, 'automatic missing-file resume never opens a native chooser');
  eq(s.disk.get(recentPath), beforeCanceledLocate, 'automatic missing-file resume does not update metadata');
  eq(await h.invoke('recent:open', { id: first.id }), null, 'canceling missing-file selection preserves the active document');
  eq(s.openDialogs.at(-1).defaultPath, a);
  eq(s.disk.get(recentPath), beforeCanceledLocate);
  choose(moved);
  const located = await h.invoke('recent:open', { id: first.id });
  eq(located.path, moved);
  eq(located.previousPath, a, 'missing recent selection supplies the original registry path when the native selection changes it');
  eq(s.disk.get(recentPath), beforeCanceledLocate, 'replacement path is not persisted until successful load is acknowledged');
  await h.invoke('recent:commitOpen', { token: located.openToken, name: '合成移动工程' });
  const relocated = (await h.invoke('app:recent'))[0];
  eq(relocated.id, first.id); eq(relocated.path, moved); eq(relocated.pinned, true); eq(relocated.missing, false);
  const beforeFailedLocate = s.disk.get(recentPath);
  eq(await h.invoke('recent:relocate', { id: first.id }), null, 'cancelled explicit relocation preserves the prior record');
  eq(s.disk.get(recentPath), beforeFailedLocate);
  choose('/synthetic-recent/不存在.zhsp');
  await denied(() => h.invoke('recent:relocate', { id: first.id }), 'an unavailable native selection cannot be committed');
  eq(s.disk.get(recentPath), beforeFailedLocate, 'failed relocation retains path, pin, display name and last-open time');
  choose(b);
  const explicitRelocate = await h.invoke('recent:relocate', { id: first.id });
  eq(explicitRelocate.path, b, 'explicit relocate offers a native selection even for an existing authorized project');
  eq(explicitRelocate.previousPath, moved, 'explicit relocation supplies the current registry path as previousPath');
  await h.invoke('recent:commitOpen', { token: explicitRelocate.openToken });
  eq((await h.invoke('app:recent'))[0].id, first.id);
  eq((await h.invoke('app:recent'))[0].path, b);
  choose(b);
  const samePathRelocate = await h.invoke('recent:relocate', { id: first.id });
  eq(Object.hasOwn(samePathRelocate, 'previousPath'), false, 'reselecting the same path during explicit relocation does not claim a path change');

  const navigated = await h.invoke('recent:open', { id: first.id });
  const beforeNavigation = s.disk.get(recentPath);
  s.windows[0].webEvents.get('did-start-navigation')({ isMainFrame: true });
  await denied(() => h.invoke('recent:commitOpen', { token: navigated.openToken }), 'same-entry navigation invalidates an outstanding open token');
  eq(s.disk.get(recentPath), beforeNavigation);
  let finishDialog;
  s.opens.push(new Promise(resolve => { finishDialog = resolve; }));
  const waiting = h.invoke('dialog:open');
  eq(await h.invoke('recent:open', { id: first.id }), null, 'concurrent open requests are serialized');
  s.windows[0].webEvents.get('did-start-navigation')({ isMainFrame: true });
  finishDialog({ canceled: false, filePaths: [moved] });
  await denied(() => waiting, 'a dialog completing after navigation cannot grant a completion token');
  eq(s.disk.get(recentPath), beforeNavigation);
  s.now = 1000;
  choose(b); const expired = await h.invoke('dialog:open');
  s.now = 1000 + 10 * 60 * 1000 + 1;
  await denied(() => h.invoke('recent:commitOpen', { token: expired.openToken }), 'an unused completion token expires after ten minutes');
  eq(s.disk.get(recentPath), beforeNavigation, 'expired tokens do not update recent metadata');
  s.now = undefined;

  const unauthorized = harness();
  const u = unauthorized.state, secret = '/synthetic-recent/未授权.zhsp';
  u.disk.set(secret, body);
  u.disk.set(recentPath, JSON.stringify([{ id: 'untrusted-history', path: secret, name: '合成旧记录', updatedAt: 1 }]));
  eq((await unauthorized.invoke('app:recent'))[0].needsAuthorization, true);
  const unauthorizedRecent = u.disk.get(recentPath);
  eq(await unauthorized.invoke('recent:open', { id: 'untrusted-history', allowPrompt: false }), null, 'automatic resume stops before asking for missing read authority');
  eq(u.openDialogs.length, 0, 'automatic unauthorized resume does not display a native dialog');
  eq(u.reads.includes(secret), false, 'automatic unauthorized resume never reads project contents');
  eq(u.disk.get(recentPath), unauthorizedRecent, 'automatic unauthorized resume preserves the recent record');
  eq(await unauthorized.invoke('recent:open', { id: 'untrusted-history' }), null, 'a recent path alone only offers a native selection');
  eq(u.openDialogs.length, 1); eq(u.openDialogs[0].defaultPath, secret);
  await denied(() => unauthorized.invoke('file:show', secret), 'cancelled recent open grants no shell reveal capability');
  u.opens.push({ canceled: false, filePaths: [secret] });
  const authorized = await unauthorized.invoke('recent:open', { id: 'untrusted-history' });
  eq(authorized.content, body);
  eq(Object.hasOwn(authorized, 'previousPath'), false, 'native reauthorization of the same recent path does not create a relocation context');
  await unauthorized.invoke('recent:commitOpen', { token: authorized.openToken });
  eq((await unauthorized.invoke('app:recent'))[0].needsAuthorization, false);
  const importPath = '/synthetic-recent/不是工程.txt'; u.disk.set(importPath, 'synthetic import');
  u.opens.push({ canceled: false, filePaths: [importPath] });
  const registryBefore = u.disk.get(recentPath);
  await denied(() => unauthorized.invoke('recent:relocate', { id: 'untrusted-history' }), 'relocation only accepts project files');
  eq(u.disk.get(recentPath), registryBefore);

  choose(b); const invalidMetadataToken = await h.invoke('dialog:open');
  s.disk.set(recentPath, 'synthetic corrupt registry');
  await denied(() => h.invoke('recent:commitOpen', { token: invalidMetadataToken.openToken }), 'metadata errors are surfaced rather than reported as successful recent updates');
  eq(s.disk.get(recentPath), 'synthetic corrupt registry');
  await denied(() => h.invoke('recent:commitOpen', { token: invalidMetadataToken.openToken }), 'failed metadata commit also consumes its token');
  await denied(() => h.invoke('recent:open', { id: first.id, allowPrompt: false }), 'automatic mode does not disguise corrupt metadata as cancellation');
  eq(await h.invoke('dialog:save', { path: b, content: body }), b, 'metadata failure does not turn a completed disk save into failure');
  eq(s.errors.at(-1).title, '最近项目更新失败');
  eq(s.disk.get(recentPath), 'synthetic corrupt registry', 'saving does not silently overwrite corrupt registry metadata');
}

(async () => {
  registryTests(); await ipcTests();
  console.log(`recent-projects: ${checks} assertions passed (real registry and isolated synthetic filesystem; main IPC VM)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
