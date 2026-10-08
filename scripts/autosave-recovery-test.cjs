/** Synthetic memory storage/clock + real React App. No personal storage/files. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://recovery-test.invalid/', pretendToBeVisual: true });
for (const key of ['window','document','navigator','HTMLElement','Node','NodeFilter','DOMParser','Event','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','MutationObserver','localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
}
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
let checks = 0;
const check = (name, actual, expected = true) => { assert.deepEqual(actual, expected, name); checks++; };
const error = name => Object.assign(new Error('synthetic failure'), { name });
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, readsFail: false, writesFail: null,
    getItem(key) { if (this.readsFail) throw error('SecurityError'); return values.get(key) ?? null; },
    setItem(key, value) { if (this.writesFail) throw error(this.writesFail); values.set(key, String(value)); },
  };
}
function timerClock() {
  let time = 0, id = 0;
  const jobs = new Map();
  return { jobs, now: () => time,
    set(fn, delay = 900) { jobs.set(++id, { fn, due: time + delay }); return id; },
    clear(id) { jobs.delete(id); },
    advance(ms) { const until = time + ms;
      while (true) { const next = [...jobs].sort((a,b) => a[1].due-b[1].due)[0];
        if (!next || next[1].due > until) break;
        time = next[1].due; jobs.delete(next[0]); next[1].fn();
      } time = until;
    },
  };
}
(async () => {
  const built = await esbuild.build({ stdin: { contents: `export {default as App} from './src/App';
    export {useStore} from './src/store/store'; export {createProject} from './src/model/project';
    export * from './src/app/autosaveStorage'; export {useRecoveryStatus} from './src/app/recoveryStatus';
    export {subscribeAutosave} from './src/app/autosaveSubscription';`, resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
    loader: { '.png': 'dataurl', '.css': 'empty' } });
  const filename = path.join(repo, '.recovery-memory.cjs');
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(repo);
  mod._compile(built.outputFiles[0].text, filename);
  const { App, useStore, createProject, readRecovery, writeRecovery, createRecoveryWriter, recoveryErrorMessage, useRecoveryStatus,
    AUTOSAVE_KEY: key, LEGACY_AUTOSAVE_KEY: legacy, UNREADABLE_AUTOSAVE_KEY: unreadable, subscribeAutosave } = mod.exports;
  const project = createProject('合成恢复测试');
  project.titlePage.show = false;
  project.elements = [{ id: 'recovery-a', type: 'action', text: '仅合成恢复文字' }];
  project.beats = [{ id: 'recover-image', kind: 'image', title: '合成图', text: '合成备注', x: 800, y: 60,
    color: '#fff', img: 'data:image/png;base64,AA==', boardX: 28, w: 300, h: 200 }];
  project.boardLinks = [{ id: 'recover-link', from: 'scene:synthetic', to: 'beat:recover-image', note: '合成关系' }];
  const snapshot = { project, filePath: '/synthetic/recovery.zhsp' };
  const raw = JSON.stringify(snapshot);
  const storage = memoryStorage({ [key]: raw });
  const restored = readRecovery(storage);
  check('current recovery keeps content/card/link/path', [restored.source, restored.snapshot.project.elements,
    restored.snapshot.project.beats, restored.snapshot.project.boardLinks, restored.snapshot.filePath],
    ['current', project.elements, project.beats, project.boardLinks, snapshot.filePath]);
  check('reads do not migrate or write', [...storage.values], [[key, raw]]);
  const old = memoryStorage({ [legacy]: raw }); old.writesFail = 'QuotaExceededError';
  check('legacy recovery is valid before any migration write', readRecovery(old).snapshot.project.name, project.name);
  assert.throws(() => writeRecovery(old, snapshot), { name: 'QuotaExceededError' }); checks++;
  check('failed migration retains legacy snapshot', old.values.get(legacy), raw);
  check('quota message tells user to save manually', recoveryErrorMessage(error('QuotaExceededError')).includes('空间不足'));
  check('other error message reveals no raw payload', recoveryErrorMessage(error('SecurityError')).includes('合成'), false);
  storage.writesFail = 'QuotaExceededError';
  assert.throws(() => writeRecovery(storage, { ...snapshot, filePath: '/synthetic/new.zhsp' })); checks++;
  check('failed new write leaves prior recovery intact', storage.values.get(key), raw);
  storage.writesFail = null;
  writeRecovery(storage, snapshot);
  check('successful write avoids redundant full-image backup', storage.values.size, 1);
  const damaged = memoryStorage({ [key]: '{damaged', [legacy]: raw });
  const fallback = readRecovery(damaged);
  check('damaged current falls back to valid legacy', [fallback.source, fallback.snapshot.project.name, !!fallback.warning], ['legacy', project.name, true]);
  writeRecovery(damaged, snapshot);
  check('unreadable payload protected before replacement', [damaged.values.get(unreadable), damaged.values.get(key)], ['{damaged', raw]);
  const collision = memoryStorage({ [key]: '{second', [unreadable]: '{first' });
  assert.throws(() => writeRecovery(collision, snapshot)); checks++;
  check('different protected raw is never overwritten', [...collision.values], [[key, '{second'], [unreadable, '{first']]);
  const protectionFailure = memoryStorage({ [key]: '{bad' }); protectionFailure.writesFail = 'QuotaExceededError';
  assert.throws(() => writeRecovery(protectionFailure, snapshot)); checks++;
  check('failed protection does not overwrite damaged original', protectionFailure.values.get(key), '{bad');
  const unavailable = memoryStorage(); unavailable.readsFail = true;
  check('storage access failure is visible and does not throw', [readRecovery(unavailable).snapshot, !!readRecovery(unavailable).warning], [null, true]);
  check('empty storage has no false corruption warning', readRecovery(memoryStorage()).warning, null);

  // JSON-valid payloads may fail the same schema/HTML admission as file open.
  // Startup still schedules a blank draft at 900ms; original bytes must first
  // reach protected storage, or the active recovery must remain untouched.
  const blank = createProject('合成启动空稿'); blank.elements = [];
  const blankSnapshot = { project: blank, filePath: null };
  const blankRaw = JSON.stringify(blankSnapshot);
  const invalidSnapshots = [
    ['unsafe geometry', p => { p.settings.lineHeight = 0.1; }],
    ['HTML resource limit', p => { p.elements[0].text = '文'.repeat(2_000_001); }],
    ['duplicate element IDs', p => { p.elements.push({ ...p.elements[0] }); }],
  ].map(([label, mutate]) => {
    const invalid = JSON.parse(raw); mutate(invalid.project);
    return { label, invalid, raw: JSON.stringify(invalid) };
  });
  for (const { label, invalid, raw: badRaw } of invalidSnapshots) {
    const rejected = memoryStorage({ [key]: badRaw });
    const read = readRecovery(rejected);
    check(`${label}: unreadable snapshot is not restored or changed`,
      [read.snapshot, !!read.warning, [...rejected.values]], [null, true, [[key, badRaw]]]);
    const recoveryClock = timerClock();
    const writer = createRecoveryWriter(() => rejected);
    const scheduled = subscribeAutosave({ getState: () => ({ ...blankSnapshot, version: 0 }), subscribe: () => () => {} }, writer, recoveryClock);
    recoveryClock.advance(899);
    check(`${label}: initial recovery remains pending until 900ms`, [...rejected.values], [[key, badRaw]]);
    recoveryClock.advance(1);
    check(`${label}: scheduled blank first protects original bytes`,
      [rejected.values.get(unreadable), rejected.values.get(key), scheduled.flush()], [badRaw, blankRaw, true]);
    scheduled();
    writer(snapshot);
    check(`${label}: later new draft replaces blank without touching protection`,
      [rejected.values.get(unreadable), rejected.values.get(key)], [badRaw, raw]);
    check(`${label}: preserved raw still receives the reader's rejection decision`,
      readRecovery(memoryStorage({ [key]: rejected.values.get(unreadable) })).snapshot, null);

    for (const failure of ['occupied', 'quota']) {
      const blocked = memoryStorage({ [key]: badRaw, ...(failure === 'occupied' ? { [unreadable]: '合成已有另一份保护载荷' } : {}) });
      if (failure === 'quota') blocked.writesFail = 'QuotaExceededError';
      const before = [...blocked.values];
      const blockedClock = timerClock();
      const waiting = subscribeAutosave({ getState: () => ({ ...blankSnapshot, version: 0 }), subscribe: () => () => {} }, createRecoveryWriter(() => blocked), blockedClock);
      blockedClock.advance(900);
      check(`${label}/${failure}: scheduled write and retry fail without replacing any raw`,
        [waiting.flush(), [...blocked.values]], [false, before]);
      if (failure === 'quota') {
        blocked.writesFail = null;
        check(`${label}: retry after quota recovery protects original then writes`,
          [waiting.flush(), blocked.values.get(unreadable), blocked.values.get(key)], [true, badRaw, blankRaw]);
      }
      waiting();
    }
    const fallbackStorage = memoryStorage({ [key]: badRaw, [legacy]: raw });
    check(`${label}: valid legacy remains readable despite current schema failure`,
      [readRecovery(fallbackStorage).source, readRecovery(fallbackStorage).snapshot.project.name], ['legacy', project.name]);
    writeRecovery(fallbackStorage, snapshot);
    check(`${label}: legacy migration protects invalid current and retains legacy original`,
      [fallbackStorage.values.get(unreadable), fallbackStorage.values.get(legacy), fallbackStorage.values.get(key)], [badRaw, raw, raw]);
    const outgoingStorage = memoryStorage({ [key]: raw });
    const outgoingWriter = createRecoveryWriter(() => outgoingStorage);
    outgoingWriter(snapshot);
    assert.throws(() => outgoingWriter(invalid), /工程/); checks++;
    check(`${label}: writer refuses an unreadable next snapshot without overwriting valid recovery`, [...outgoingStorage.values], [[key, raw]]);
  }
  const silentProtection = memoryStorage({ [key]: invalidSnapshots[0].raw });
  silentProtection.setItem = function (name, value) { if (name !== unreadable) this.values.set(name, value); };
  assert.throws(() => writeRecovery(silentProtection, blankSnapshot), /protection failed/); checks++;
  check('unconfirmed protection write cannot replace original', [...silentProtection.values], [[key, invalidSnapshots[0].raw]]);

  const mutated = JSON.parse(raw);
  const mutableStorage = memoryStorage();
  const mutableWriter = createRecoveryWriter(() => mutableStorage);
  mutableWriter(mutated);
  const validMutableRaw = mutableStorage.values.get(key);
  mutated.project.elements[0].text = '文'.repeat(2_000_001);
  assert.throws(() => mutableWriter(mutated), /过大或嵌套过深/); checks++;
  check('same element object with changed text cannot reuse a prior safe-text result', mutableStorage.values.get(key), validMutableRaw);
  mutated.project.elements[0].text = '重新有效的合成正文';
  mutated.project.settings.lineHeight = 0.1;
  assert.throws(() => mutableWriter(mutated), /工程结构格式不正确/); checks++;
  check('safe-text cache never skips schema/settings validation', mutableStorage.values.get(key), validMutableRaw);

  // Count only synchronous writer calls before mounting React. This checks a
  // single writer's actual old-raw parse work, not timings or the user's storage.
  const cachedStorage = memoryStorage({ [key]: raw });
  const cachedWriter = createRecoveryWriter(() => cachedStorage);
  const originalParse = JSON.parse;
  let oldRawParses = 0;
  JSON.parse = function (...args) {
    // Count image-heavy recovery strings, not tiny default-format cloning.
    if (typeof args[0] === 'string' && (args[0].startsWith('{"project":') || args[0].startsWith('{synthetic'))) oldRawParses++;
    return originalParse.apply(this, args);
  };
  try {
    cachedWriter({ ...snapshot, filePath: '/synthetic/cache-first.zhsp' });
    check('writer validates existing old raw exactly once', oldRawParses, 1);
    for (let i = 0; i < 8; i++) cachedWriter({ ...snapshot, filePath: `/synthetic/cache-${i}.zhsp` });
    check('writer keeps only its latest successful validation and never reparses unchanged old raw', oldRawParses, 1);
    check('normal cached writes create no secondary image-heavy backup', cachedStorage.values.size, 1);
    cachedStorage.values.set(key, '{synthetic external corruption');
    cachedWriter(snapshot);
    check('external corruption invalidates the writer cache', oldRawParses, 2);
    check('external damaged raw is protected before successful replacement',
      [cachedStorage.values.get(unreadable), cachedStorage.values.get(key)], ['{synthetic external corruption', raw]);
    cachedWriter({ ...snapshot, filePath: '/synthetic/cache-after-recovery.zhsp' });
    check('successful repair establishes a fresh single validation result', oldRawParses, 2);
    cachedStorage.values.set(key, '{synthetic different external corruption');
    assert.throws(() => cachedWriter(snapshot)); checks++;
    check('cache cannot bypass a different existing unreadable recovery collision',
      [cachedStorage.values.get(key), cachedStorage.values.get(unreadable)],
      ['{synthetic different external corruption', '{synthetic external corruption']);

    const failedStorage = memoryStorage({ [key]: '{synthetic protected-write failure' });
    const failedWriter = createRecoveryWriter(() => failedStorage);
    failedStorage.writesFail = 'QuotaExceededError';
    assert.throws(() => failedWriter(snapshot), { name: 'QuotaExceededError' }); checks++;
    check('failed protection never replaces damaged active raw or invents validation success',
      [...failedStorage.values], [[key, '{synthetic protected-write failure']]);
    failedStorage.writesFail = null;
    const parsesBeforeRetry = oldRawParses;
    failedWriter(snapshot);
    check('failed write cannot poison cache; retry validates old raw again', oldRawParses, parsesBeforeRetry + 1);
    check('retry protects original raw and then writes valid latest recovery',
      [failedStorage.values.get(unreadable), failedStorage.values.get(key)], ['{synthetic protected-write failure', raw]);

    const replacementFailure = memoryStorage({ [key]: '{synthetic replacement failure' });
    const originalSet = replacementFailure.setItem.bind(replacementFailure);
    let rejectReplacement = true;
    replacementFailure.setItem = (name, value) => {
      if (name === key && rejectReplacement) throw error('QuotaExceededError');
      originalSet(name, value);
    };
    const replacementWriter = createRecoveryWriter(() => replacementFailure);
    assert.throws(() => replacementWriter(snapshot), { name: 'QuotaExceededError' }); checks++;
    check('failure after protection retains both original and protected bytes',
      [replacementFailure.values.get(key), replacementFailure.values.get(unreadable)],
      ['{synthetic replacement failure', '{synthetic replacement failure']);
    rejectReplacement = false;
    replacementWriter(snapshot);
    check('replacement retry uses already protected bytes without overwriting them',
      [replacementFailure.values.get(key), replacementFailure.values.get(unreadable)],
      [raw, '{synthetic replacement failure']);

    const badEnvelope = '{"project":{"elements":"synthetic-invalid-array"}}';
    const envelopeStorage = memoryStorage({ [key]: raw });
    const envelopeWriter = createRecoveryWriter(() => envelopeStorage);
    envelopeWriter(snapshot);
    envelopeStorage.values.set(key, badEnvelope);
    envelopeWriter(snapshot);
    check('external parseable malformed envelope is also protected instead of bypassing validation',
      [envelopeStorage.values.get(unreadable), envelopeStorage.values.get(key)], [badEnvelope, raw]);
  } finally { JSON.parse = originalParse; }

  useStore.getState().loadProject(project, null);
  const clock = timerClock(), writes = [];
  const stop = subscribeAutosave(useStore, saved => { writes.push({ time: clock.now(), saved }); }, clock);
  for (let i = 0; i < 75; i++) {
    clock.advance(400); useStore.getState().setText('recovery-a', `合成持续输入${i}`);
    check('continuous typing keeps one timer', clock.jobs.size, 1);
  }
  check('continuous typing establishes recovery by 30s', writes[0].time, 30000);
  check('max deadline reads newest completed state', writes[0].saved.project.elements[0].text, '合成持续输入73');
  clock.advance(900);
  check('trailing save still captures final keystroke', writes.at(-1).saved.project.elements[0].text, '合成持续输入74');
  useStore.getState().setText('recovery-a', '关闭前最新合成文字');
  const history = [useStore.getState().past, useStore.getState().future, useStore.getState().dirty, useStore.getState().version];
  check('explicit flush succeeds immediately', stop.flush());
  check('flush captures pending latest text without delay', writes.at(-1).saved.project.elements[0].text, '关闭前最新合成文字');
  check('flush removes pending job', clock.jobs.size, 0);
  check('flush does not mark disk saved or alter history', [useStore.getState().past, useStore.getState().future, useStore.getState().dirty, useStore.getState().version], history);
  stop();
  let succeed = false, attempts = 0;
  const failClock = timerClock();
  const failed = subscribeAutosave(useStore, () => { attempts++; return succeed; }, failClock);
  failClock.advance(900);
  check('flush reports a failed timer and retries safely', failed.flush(), false);
  succeed = true;
  check('flush can recover after storage becomes writable', failed.flush());
  check('retry occurred without needing another edit', attempts, 3);
  failed(); failed();
  check('stopped subscription never writes on flush', [failed.flush(), attempts], [true, 3]);

  // Real App integration proves the old migration-error -> blank fallthrough is
  // fixed, and the warning/status + unload flush belong to the actual UI.
  const appStorage = memoryStorage({ [legacy]: raw }); appStorage.writesFail = 'QuotaExceededError';
  Object.defineProperty(window, 'localStorage', { configurable: true, value: appStorage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: appStorage });
  let tree = createRoot(document.getElementById('root'));
  await act(async () => tree.render(React.createElement(React.StrictMode, null, React.createElement(App))));
  check('StrictMode legacy migration failure cannot replace restored script', useStore.getState().project.elements[0].text, project.elements[0].text);
  check('recovered project remains conservatively dirty', useStore.getState().dirty);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1000)); });
  check('actual App exposes recovery failure', [useRecoveryStatus.getState().phase, document.querySelector('.statusbar__recovery').textContent], ['error', '恢复点失败']);
  check('legacy bytes still available after failed App write', appStorage.values.get(legacy), raw);
  appStorage.writesFail = null;
  await act(async () => useStore.getState().setText('recovery-a', '合成退出前最新正文'));
  const event = new window.Event('beforeunload', { cancelable: true });
  await act(async () => window.dispatchEvent(event));
  check('dirty unload is guarded', event.defaultPrevented);
  check('unload flush writes latest content before guard', JSON.parse(appStorage.values.get(key)).project.elements[0].text, '合成退出前最新正文');
  check('successful recovery write does not clear disk dirty', useStore.getState().dirty);
  await act(async () => useStore.getState().markSaved('/synthetic/saved.zhsp', { project: useStore.getState().project, documentEpoch: useStore.getState().documentEpoch }));
  const clean = new window.Event('beforeunload', { cancelable: true });
  await act(async () => window.dispatchEvent(clean));
  check('clean successful-save unload is not guarded', clean.defaultPrevented, false);
  check('path-only close flush records latest file association', JSON.parse(appStorage.values.get(key)).filePath, '/synthetic/saved.zhsp');

  // Actual BoardView components own their pending markers; do not fabricate a
  // marked input and claim its editing/commit path has been tested.
  const draftProject = createProject('合成关闭草稿边界');
  draftProject.titlePage.show = false;
  draftProject.elements = [{ id: 'draft-action', type: 'action', text: '保持不变的合成正文' }];
  draftProject.beats = [
    { id: 'draft-card-one', kind: 'beat', title: '原合成标题', text: '合成灵感一', color: '#fff', x: 20, y: 30 },
    { id: 'draft-card-two', kind: 'sound', title: '原声音标题', text: '合成声音二', color: '#fff', x: 420, y: 30 },
  ];
  draftProject.boardLinks = [{ id: 'draft-relation', from: 'beat:draft-card-one', to: 'beat:draft-card-two', note: '原合成关系' }];
  const unload = async () => {
    const event = new window.Event('beforeunload', { cancelable: true });
    await act(async () => window.dispatchEvent(event));
    return event;
  };
  const change = async (input, value) => {
    assert.ok(input, 'real component input exists');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  };
  await act(async () => {
    useStore.getState().loadProject(draftProject, '/synthetic/draft-board.zhsp');
    useStore.getState().setView('board');
    useStore.getState().setSidebar('navigator');
    useStore.getState().markSaved('/synthetic/draft-board.zhsp', { project: useStore.getState().project, documentEpoch: useStore.getState().documentEpoch });
  });
  check('clean board baseline has no false close guard', (await unload()).defaultPrevented, false);
  check('board baseline has successful recovery and clean disk state', [useRecoveryStatus.getState().phase, useStore.getState().dirty], ['saved', false]);
  const titleButton = document.querySelector('[data-card][data-id="draft-card-one"] span.bcard__media-title');
  assert.ok(titleButton, 'actual editable card title exists');
  await act(async () => titleButton.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })));
  const titleInput = document.querySelector('[data-card][data-id="draft-card-one"] input.bcard__media-title');
  await change(titleInput, '尚未确认的新合成标题');
  check('actual title draft declares pending while model remains saved',
    [titleInput.getAttribute('data-project-draft-pending'), useStore.getState().dirty, useStore.getState().project.beats[0].title],
    ['true', false, '原合成标题']);
  check('pending title blocks close even with successful recovery and clean disk state', (await unload()).defaultPrevented);
  check('close guard does not commit or discard title draft implicitly',
    [titleInput.value, useStore.getState().project.beats[0].title], ['尚未确认的新合成标题', '原合成标题']);
  await act(async () => titleInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  check('cancelling title clears pending marker without dirtying saved project',
    [!!document.querySelector('[data-project-draft-pending="true"]'), useStore.getState().dirty], [false, false]);
  check('cancelled title draft no longer blocks close', (await unload()).defaultPrevented, false);

  const relationButton = document.querySelector('.board-link__label[aria-label="关系说明：原合成关系"]');
  assert.ok(relationButton, 'actual relation label exists');
  await act(async () => relationButton.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })));
  const relationInput = document.querySelector('input.board-link__input');
  await change(relationInput, '尚未确认的新合成关系');
  check('actual relation draft declares pending while model stays saved',
    [relationInput.getAttribute('data-project-draft-pending'), useStore.getState().dirty, useStore.getState().project.boardLinks[0].note],
    ['true', false, '原合成关系']);
  check('pending relation blocks close despite successful recovery and no disk dirty flag', (await unload()).defaultPrevented);
  await act(async () => relationInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  check('confirming relation removes draft marker and commits exactly its new text',
    [!!document.querySelector('[data-project-draft-pending="true"]'), useStore.getState().dirty, useStore.getState().project.boardLinks[0].note],
    [false, true, '尚未确认的新合成关系']);
  await act(async () => useStore.getState().markSaved('/synthetic/draft-board.zhsp', { project: useStore.getState().project, documentEpoch: useStore.getState().documentEpoch }));
  check('confirmed and saved relation permits close again', (await unload()).defaultPrevented, false);

  const searchInput = document.querySelector('input.panel__search');
  await change(searchInput, '仅界面搜索的合成字眼');
  check('ordinary search input is not marked as a project draft', searchInput.hasAttribute('data-project-draft-pending'), false);
  check('ordinary search input leaves saved project clean', useStore.getState().dirty, false);
  check('ordinary search input does not block clean successful-save unload', (await unload()).defaultPrevented, false);
  await act(async () => tree.unmount());

  // Actual startup falls back to the empty template when current JSON is valid
  // but its project is not admissible. Exercise the real 900ms App subscription
  // and close guard, not just the storage helper in isolation.
  for (const occupied of [false, true]) {
    const badRaw = invalidSnapshots[0].raw;
    const startupStorage = memoryStorage({ [key]: badRaw, ...(occupied ? { [unreadable]: '合成既有保护内容' } : {}) });
    Object.defineProperty(window, 'localStorage', { configurable: true, value: startupStorage });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: startupStorage });
    tree = createRoot(document.getElementById('root'));
    await act(async () => tree.render(React.createElement(React.StrictMode, null, React.createElement(App))));
    check(`schema-invalid App startup/${occupied}: rejects recovery while retaining original before timer`,
      [useStore.getState().project.elements.every(el => !el.text), startupStorage.values.get(key)], [true, badRaw]);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1000)); });
    if (occupied) {
      check('actual App cannot overwrite either payload when protection slot belongs to another recovery',
        [startupStorage.values.get(key), startupStorage.values.get(unreadable), useRecoveryStatus.getState().phase],
        [badRaw, '合成既有保护内容', 'error']);
      check('actual empty startup still guards close when original recovery cannot be protected', (await unload()).defaultPrevented);
    } else {
      check('actual App protects schema-invalid original before its first empty-template autosave',
        [startupStorage.values.get(unreadable), JSON.parse(startupStorage.values.get(key)).project.elements.every(el => !el.text), useRecoveryStatus.getState().phase],
        [badRaw, true, 'saved']);
      await act(async () => {
        useStore.getState().newProject();
        const element = useStore.getState().project.elements[0];
        useStore.getState().setText(element.id, '保全旧载荷后的合成新稿');
      });
      await unload();
      check('actual new-draft flush works after protection and never replaces the protected original',
        [startupStorage.values.get(unreadable), JSON.parse(startupStorage.values.get(key)).project.elements[0].text],
        [badRaw, '保全旧载荷后的合成新稿']);
    }
    await act(async () => tree.unmount());
  }
  dom.window.close();
  console.log(`Autosave recovery: ${checks} assertions passed (memory/jsdom, not native close).`);
})().catch(error => { console.error(error); dom.window.close(); process.exitCode = 1; });
