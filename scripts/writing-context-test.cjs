/** Synthetic writing-position regression. esbuild runs in memory; jsdom and
 * storage are isolated. Never reads user projects, userData or native storage.
 * UI checks cover event/state timing, not real browser layout or system IME.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: 'http://writing-context-test.invalid/', pretendToBeVisual: true,
});
const previousGlobals = new Map();
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'NodeFilter', 'Element', 'Event', 'InputEvent', 'MouseEvent', 'KeyboardEvent', 'DOMParser', 'Range', 'Selection', 'getComputedStyle', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? dom.window : dom.window[key] });
}
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
let root;
let checks = 0, groups = 0;
const cleanup = new Set();
const check = (label, actual, ...expected) => { assert.deepEqual(actual, expected.length ? expected[0] : true, label); checks++; };
const same = (label, actual, expected) => { assert.strictEqual(actual, expected, label); checks++; };
const group = (label, run) => { run(); groups++; console.log(`PASS ${label}`); };
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, writes: [], readsFail: false, writesFail: false,
    getItem(key) { if (this.readsFail) throw new Error('Synthetic unavailable storage'); return values.get(key) ?? null; },
    setItem(key, value) { if (this.writesFail) throw new Error('Synthetic full storage'); values.set(key, String(value)); this.writes.push([key, String(value)]); },
    clear() { values.clear(); this.writes.length = 0; },
  };
}
function timerClock() {
  let time = 0, id = 0;
  const jobs = new Map();
  return { jobs, now: () => time, get sequence() { return id; },
    set(fn, delay = 900) { jobs.set(++id, { fn, due: time + delay }); return id; },
    clear(timer) { jobs.delete(timer); },
    deadline() { assert.equal(jobs.size, 1); return [...jobs.values()][0].due; },
    advance(ms) { const until = time + ms;
      while (true) { const next = [...jobs].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > until) break;
        time = next[1].due; jobs.delete(next[0]); next[1].fn();
      } time = until;
    },
  };
}

(async () => {
  const storage = memoryStorage();
  globalThis.localStorage = storage;
  const built = await esbuild.build({
    stdin: { contents: `export {useStore} from './src/store/store';
      export {createProject} from './src/model/project'; export {serializeProject, parseProject} from './src/io/zhsp';
      export * from './src/app/writingContext'; export * from './src/app/autosaveStorage';
      export {subscribeAutosave} from './src/app/autosaveSubscription';
      export {Editor} from './src/components/Editor'; export {setCaret, caretOffset} from './src/utils/dom';`,
      resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
    loader: { '.css': 'empty', '.png': 'dataurl' },
    plugins: [{ name: 'controlled-pagination', setup(build) {
      build.onResolve({ filter: /hooks\/PaginationProvider$/ }, () => ({ path: 'writing-test-pagination', namespace: 'writing-test' }));
      build.onLoad({ filter: /.*/, namespace: 'writing-test' }, () => ({ contents:
        'export const usePagination = () => globalThis.__writingContextPagination;', loader: 'js' }));
    } }],
  });
  const loadBundle = () => {
    const filename = path.join(repo, '.writing-context-memory.cjs');
    const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(repo);
    mod._compile(built.outputFiles[0].text, filename); return mod.exports;
  };
  const api = loadBundle();
  const { useStore, createProject, serializeProject, parseProject, validateWritingContext, resolveWritingContext,
    readWritingContext, writeWritingContext, subscribeWritingContextPersistence, WRITING_CONTEXT_KEY,
    MAX_WRITING_CONTEXTS, readRecovery, writeRecovery, AUTOSAVE_KEY, subscribeAutosave } = api;
  const state = () => useStore.getState();
  const fixture = (id = 'synthetic-context-project') => {
    const p = createProject('合成位置工程'); p.id = id; p.titlePage.show = false;
    p.elements = [
      { id: 'context-s1', type: 'scene_heading', text: '内景 合成一号棚 日' },
      { id: 'context-a1', type: 'action', text: '合成首段。' },
      { id: 'context-s2', type: 'scene_heading', text: '外景 合成二号棚 夜' },
      { id: 'context-a2', type: 'action', text: '合成<b>格式</b>与<br>换行。' },
    ];
    p.sceneMeta = [
      { id: 'context-meta1', elementId: 'context-s1', title: '', synopsis: '', color: '#cfe4ff' },
      { id: 'context-meta2', elementId: 'context-s2', title: '', synopsis: '', color: '#cfe4ff' },
    ];
    p.beats = [{ id: 'context-image', kind: 'image', title: '合成图', text: '合成备注', x: 810, y: 220,
      color: '#fff', img: 'data:image/png;base64,AA==', boardX: 28, boardY: 56 }];
    return p;
  };
  const context = (p, patch = {}) => ({ version: 1, projectId: p.id, view: 'write', activeId: 'context-a2',
    sceneId: 'context-s2', caret: 5, writeScrollTop: 640, cardsScrollTop: 240,
    board: { panX: -128, panY: 256, zoom: 1.25 }, ...patch });
  const snapshot = () => ({ project: state().project, past: state().past, future: state().future,
    version: state().version, documentEpoch: state().documentEpoch, dirty: state().dirty });
  const unchanged = (label, before) => {
    for (const key of Object.keys(before)) same(`${label}: ${key}`, state()[key], before[key]);
  };
  const start = stop => { cleanup.add(stop); return () => { stop(); cleanup.delete(stop); }; };

  group('metadata admission rejects foreign documents and strips unsafe fields', () => {
    const p = fixture(), valid = context(p);
    check('valid writing positions round-trip', validateWritingContext(valid, p.id), valid);
    for (const value of [null, [], '', 1, {}, { ...valid, version: 2 }, { ...valid, projectId: 'foreign' }, { ...valid, view: 'preview' }, { ...valid, view: 'reports' }]) {
      check('malformed envelope cannot restore', validateWritingContext(value, p.id), null);
    }
    const bad = validateWritingContext({ ...valid, activeId: {}, sceneId: 12, caret: Infinity,
      writeScrollTop: NaN, cardsScrollTop: -1, board: { panX: 0, panY: 0, zoom: Infinity },
      project: p, text: 'Synthetic unwanted payload', html: '<img src=x>' }, p.id);
    check('optional invalid fields and payload are omitted', bad, { version: 1, projectId: p.id, view: 'write' });
    for (const board of [[], null, { panX: NaN, panY: 0, zoom: 1 }, { panX: 0, panY: Infinity, zoom: 1 }, { panX: 0, panY: 0, zoom: 0 }]) {
      check('bad board geometry is excluded', validateWritingContext({ ...valid, board }, p.id).board, undefined);
    }
    check('validation does not change supplied metadata', valid, context(p));
  });

  group('missing paragraph resolves to scene or first paragraph without a stale caret', () => {
    const p = fixture(), before = JSON.stringify(p);
    check('live paragraph and caret survive load', resolveWritingContext(p, context(p)), context(p));
    const scene = resolveWritingContext(p, context(p, { activeId: 'deleted' }));
    check('missing paragraph falls back to remembered scene', [scene.activeId, scene.sceneId, scene.caret], ['context-s2', 'context-s2', undefined]);
    check('removed paragraph does not retain unrelated absolute scroll', scene.writeScrollTop, undefined);
    const first = resolveWritingContext(p, context(p, { activeId: 'deleted', sceneId: 'also-deleted' }));
    check('missing paragraph and scene fall back to first paragraph', [first.activeId, first.sceneId, first.caret], ['context-s1', undefined, undefined]);
    check('non-scene element cannot masquerade as scene', resolveWritingContext(p, context(p, { activeId: 'deleted', sceneId: 'context-a2' })).activeId, 'context-s1');
    check('live paragraph recomputes its scene instead of retaining a stale scene bookmark',
      resolveWritingContext(p, context(p, { sceneId: 'context-s1' })).sceneId, 'context-s2');
    const reordered = fixture();
    reordered.elements = [p.elements[0], p.elements[3], p.elements[1], p.elements[2]];
    check('paragraph moved into another scene restores its current scene', resolveWritingContext(reordered, context(p)).sceneId, 'context-s1');
    check('foreign project context cannot restore foreign view or caret',
      [resolveWritingContext(p, context(fixture('foreign'), { view: 'board' })).view, resolveWritingContext(p, context(fixture('foreign'))).caret], ['write', undefined]);
    const empty = fixture(); empty.elements = [];
    check('empty project resolves without invented paragraph', resolveWritingContext(empty, context(empty)).activeId, undefined);
    check('resolving never changes project', JSON.stringify(p), before);
  });

  group('exact path plus project identity isolates same-name copies and bounded metadata', () => {
    const s = memoryStorage(), p = fixture(), first = context(p), second = context(p, { view: 'board', caret: 2 });
    writeWritingContext(s, first, '/synthetic/one/shared.zhsp');
    writeWritingContext(s, second, '/synthetic/two/shared.zhsp');
    writeWritingContext(s, context(p, { view: 'cards' }), null);
    check('same basename and project ID retain independent positions', [readWritingContext(s, p.id, '/synthetic/one/shared.zhsp'),
      readWritingContext(s, p.id, '/synthetic/two/shared.zhsp')], [first, second]);
    check('unsaved project identity is separate from file identity', readWritingContext(s, p.id, null).view, 'cards');
    check('same file cannot restore different project ID', readWritingContext(s, 'foreign', '/synthetic/one/shared.zhsp'), null);
    check('path match never falls back to same basename', readWritingContext(s, p.id, '/synthetic/three/shared.zhsp'), null);
    writeWritingContext(s, context(p, { caret: 7 }), '/synthetic/one/shared.zhsp');
    check('latest position replaces same identity', readWritingContext(s, p.id, '/synthetic/one/shared.zhsp').caret, 7);
    const raw = s.values.get(WRITING_CONTEXT_KEY);
    check('metadata contains no text, card image, or project object', /合成|data:image|"elements"|"project"/.test(raw), false);
    check('metadata uses only its dedicated key', [...s.values.keys()], [WRITING_CONTEXT_KEY]);
    const bounded = memoryStorage();
    for (let i = 0; i <= MAX_WRITING_CONTEXTS; i++) writeWritingContext(bounded, context(p, { caret: i }), `/synthetic/${i}.zhsp`);
    check('oldest distinct identity is evicted at configured cap', readWritingContext(bounded, p.id, '/synthetic/0.zhsp'), null);
    for (let i = 1; i <= MAX_WRITING_CONTEXTS; i++) check('recent identities survive bounded storage', readWritingContext(bounded, p.id, `/synthetic/${i}.zhsp`).caret, i);
    const escaped = memoryStorage();
    for (let i = 0; i < MAX_WRITING_CONTEXTS; i++) {
      const filePath = `/synthetic/${'"'.repeat(4060)}${i}.zhsp`;
      writeWritingContext(escaped, context(p, { caret: i }), filePath);
      check('JSON escaping cannot make the newest valid metadata unreadable', readWritingContext(escaped, p.id, filePath)?.caret, i);
    }
  });

  group('bad or unavailable metadata does not make a valid project unavailable', () => {
    const p = fixture();
    for (const raw of ['{broken', 'null', '[]', '{}', '{"version":99,"entries":[]}', 'x'.repeat(300000)]) {
      const s = memoryStorage({ [WRITING_CONTEXT_KEY]: raw });
      check('unreadable metadata falls back safely', readWritingContext(s, p.id, null), null);
      check('reading leaves unreadable metadata unchanged', s.values.get(WRITING_CONTEXT_KEY), raw);
    }
    const s = memoryStorage(); s.readsFail = true;
    check('metadata read failure returns no restoration', readWritingContext(s, p.id, null), null);
    s.readsFail = false; writeWritingContext(s, context(p), null); const before = s.values.get(WRITING_CONTEXT_KEY);
    s.writesFail = true;
    assert.throws(() => writeWritingContext(s, context(p, { caret: 8 }), null)); checks++;
    check('failed metadata write keeps old position', s.values.get(WRITING_CONTEXT_KEY), before);
  });

  group('position updates preserve project snapshots, history, dirty, and zhsp format', () => {
    storage.clear(); const p = fixture(); state().loadProject(p, '/synthetic/store.zhsp');
    state().setText('context-a1', '合成可撤销正文'); state().undo();
    const before = snapshot(), projectBefore = JSON.stringify(state().project);
    state().updateWritingContext(context(p, { view: 'cards' }));
    state().setActive('context-a2'); state().setView('board');
    state().updateWritingContext({ caret: 4, writeScrollTop: 333, cardsScrollTop: 777, board: { panX: 42, panY: -31, zoom: .75 } });
    unchanged('UI metadata preserves document references and flags', before);
    check('project JSON has no position fields', JSON.stringify(state().project), projectBefore);
    check('view action remembers board', state().writingContext.view, 'board');
    state().setView('reports'); state().setView('preview');
    check('temporary/non-writing views do not replace last writing view', state().writingContext.view, 'board');
    const file = JSON.parse(serializeProject(state().project));
    check('saved zhsp project matches unchanged document', file.project, JSON.parse(projectBefore));
    check('saved project excludes UI metadata', ['writingContext', 'activeId', 'writeScrollTop', 'cardsScrollTop', 'view', 'caret'].some(key => Object.hasOwn(file.project, key)), false);
    check('zhsp reopens with same screenplay and cards', [parseProject(JSON.stringify(file)).elements, parseProject(JSON.stringify(file)).beats], [state().project.elements, state().project.beats]);
    state().redo(); check('UI updates leave redo usable', state().project.elements[1].text, '合成可撤销正文');
  });

  group('load and cold restart restore exact metadata; new project starts at write', () => {
    storage.clear(); const p = fixture(), saved = context(p, { view: 'board' });
    writeWritingContext(storage, saved, '/synthetic/restart.zhsp');
    state().loadProject(p, '/synthetic/restart.zhsp');
    check('load restores writing view and active paragraph', [state().view, state().activeId, state().writingContext], ['board', 'context-a2', saved]);
    const restarted = loadBundle(); restarted.useStore.getState().loadProject(fixture(), '/synthetic/restart.zhsp');
    check('fresh module uses persistent metadata, not old in-memory store', restarted.useStore.getState().writingContext, saved);
    state().loadProject(fixture(), '/synthetic/other/restart.zhsp');
    check('same project ID at different path starts at its own default', [state().view, state().activeId, state().writingContext.caret], ['write', 'context-s1', undefined]);
    state().loadProject(fixture(), '/synthetic/restart.zhsp', context(p, { view: 'cards', caret: 2 }));
    check('explicit recovery context reaches store', [state().view, state().writingContext.caret], ['cards', 2]);
    state().newProject();
    check('new project does not inherit previous view, scroll, board or caret', [state().view, state().filePath, state().writingContext.projectId,
      state().writingContext.writeScrollTop, state().writingContext.board, state().writingContext.caret], ['write', null, state().project.id, undefined, undefined, undefined]);
    check('new project remains clean and history-free', [state().dirty, state().past.length, state().future.length], [false, 0, 0]);
    check('new project has no template screenplay text or title', [state().project.elements.every(element => element.text === ''), state().project.titlePage.title], [true, '']);
    check('new project has no leftover scene metadata, material cards or links',
      [state().project.sceneMeta, state().project.beats, state().project.boardLinks], [[], [], []]);
  });

  group('fresh unassociated loads reset transient zoom; explicit draft recovery restores it', () => {
    const p = fixture('context-unassociated-boundary');
    state().loadProject(p, null, null);
    state().setView('board');
    state().updateWritingContext({ board: { panX: 48, panY: -24, zoom: 1.1 } });
    const draftContext = state().writingContext;
    state().loadProject(structuredClone(p));
    check('same-ID unassociated model load starts with default board geometry', state().writingContext.board, undefined);
    check('same-ID unassociated model load starts with write view', state().view, 'write');
    state().loadProject(structuredClone(p), null, draftContext);
    check('explicit unsaved draft restores its board geometry', state().writingContext.board, { panX: 48, panY: -24, zoom: 1.1 });
    check('explicit unsaved draft restores its board view', state().view, 'board');
  });

  group('stale document callbacks and PDF rendering cannot overwrite writer position', () => {
    storage.clear(); const p = fixture(); state().loadProject(p, '/synthetic/epoch.zhsp', context(p));
    const oldEpoch = state().documentEpoch; state().loadProject(p, '/synthetic/epoch.zhsp', context(p, { caret: 2 }));
    const current = state().writingContext, before = snapshot();
    state().updateWritingContext({ caret: 9, writeScrollTop: 999 }, oldEpoch);
    same('same-ID reload rejects old epoch callback', state().writingContext, current);
    state().updateWritingContext({ caret: 3 }, state().documentEpoch);
    check('current epoch callback is accepted', state().writingContext.caret, 3);
    const writerPosition = state().writingContext;
    for (const mode of ['creative', 'print']) {
      state().setPdfExportMode(mode); state().setView(mode === 'creative' ? 'write' : 'preview');
      state().setActive('context-s1'); state().updateWritingContext({ activeId: 'context-s1', caret: 0, writeScrollTop: 0, view: 'write' });
      same('PDF temporary state leaves persistent writer position untouched', state().writingContext, writerPosition);
      state().setPdfExportMode(null);
    }
    unchanged('epoch and PDF checks do not edit project', before);
  });

  group('metadata persistence has an independent bounded timer and explicit flush', () => {
    storage.clear(); const p = fixture(); state().loadProject(p, '/synthetic/metadata.zhsp', context(p));
    const clock = timerClock(), stop = subscribeWritingContextPersistence(useStore, () => storage, clock), done = start(stop);
    const originalDeadline = clock.deadline(); clock.advance(100);
    state().updateWritingContext({ writeScrollTop: 1000 }); clock.advance(100);
    state().updateWritingContext({ writeScrollTop: 1200 });
    check('continuous UI motion cannot defer metadata indefinitely', clock.deadline(), originalDeadline);
    clock.advance(1000);
    check('metadata timer writes latest position', readWritingContext(storage, p.id, '/synthetic/metadata.zhsp').writeScrollTop, 1200);
    check('metadata timer writes no full recovery snapshot', storage.values.has(AUTOSAVE_KEY), false);
    state().updateWritingContext({ caret: 8 }); check('explicit flush succeeds', stop.flush());
    check('flush persists latest caret and clears timer', [readWritingContext(storage, p.id, '/synthetic/metadata.zhsp').caret, clock.jobs.size], [8, 0]);
    const writes = storage.writes.length; done(); done(); state().updateWritingContext({ caret: 9 }); clock.advance(1000);
    check('stopped subscription cannot write later state', storage.writes.length, writes);
  });

  group('failed metadata flush retries and document switches preserve correct association', () => {
    storage.clear(); const p = fixture(); state().loadProject(p, '/synthetic/before.zhsp', context(p));
    let errors = 0;
    const clock = timerClock(), stop = subscribeWritingContextPersistence(useStore, () => storage, clock, () => { errors++; }), done = start(stop);
    storage.writesFail = true; check('failure is not reported as a successful metadata flush', stop.flush(), false);
    check('first metadata write failure reports the problem', errors, 1);
    check('repeated failed flush still returns failure', stop.flush(), false);
    state().updateWritingContext({ cardsScrollTop: 999 }); clock.advance(1000);
    check('continuous failed writes do not repeat the same warning', errors, 1);
    storage.writesFail = false; check('failed position can be retried', stop.flush());
    state().updateWritingContext({ caret: 6 }); storage.writesFail = true;
    check('later independent failure is visible after a successful retry', [stop.flush(), errors], [false, 2]);
    storage.writesFail = false; check('second failure also permits successful retry', stop.flush());
    state().updateWritingContext({ caret: 7 });
    state().loadProject(fixture(), '/synthetic/after.zhsp', context(p, { caret: 1 }));
    check('old document last position is persisted at replacement boundary', readWritingContext(storage, p.id, '/synthetic/before.zhsp').caret, 7);
    stop.flush();
    check('new document has its own position under its own path', readWritingContext(storage, p.id, '/synthetic/after.zhsp').caret, 1);
    const saved = { project: state().project, documentEpoch: state().documentEpoch };
    state().markSaved('/synthetic/save-as.zhsp', saved); stop.flush();
    check('save-as writes new path without losing old path', [readWritingContext(storage, p.id, '/synthetic/after.zhsp').caret,
      readWritingContext(storage, p.id, '/synthetic/save-as.zhsp').caret], [1, 1]);
    state().updateWritingContext({ writeScrollTop: 900 });
    state().loadProject(fixture(), '/synthetic/save-as.zhsp');
    check('immediate same-file reload retains position pending in memory', state().writingContext.writeScrollTop, 900);
    stop.flush();
    check('same-file reload cannot overwrite latest position with old disk metadata', readWritingContext(storage, p.id, '/synthetic/save-as.zhsp').writeScrollTop, 900);
    done();
  });

  group('UI movement never reschedules or triggers a full autosave', () => {
    storage.clear(); const p = fixture(); state().loadProject(p, '/synthetic/timer.zhsp', context(p));
    const clock = timerClock(), writes = [];
    const stop = subscribeAutosave(useStore, saved => writes.push(saved), clock), done = start(stop);
    clock.advance(300); const deadline = clock.deadline(), sequence = clock.sequence;
    state().setActive('context-a1'); state().setView('cards'); state().updateWritingContext({ cardsScrollTop: 540, caret: 2 });
    check('UI updates retain original 900ms full-snapshot deadline', [clock.deadline(), clock.sequence], [deadline, sequence]);
    clock.advance(600);
    check('scheduled full snapshot includes latest small context', [writes.length, writes[0].context], [1, state().writingContext]);
    state().setView('board'); state().updateWritingContext({ board: { panX: 1, panY: 2, zoom: 1.5 } }); clock.advance(1500);
    check('metadata-only interaction does not serialize full project again', [writes.length, clock.jobs.size], [1, 0]);
    state().setText('context-a1', '合成正文保存'); clock.advance(500); const contentDeadline = clock.deadline(), contentSequence = clock.sequence;
    state().updateWritingContext({ caret: 6, writeScrollTop: 321 });
    check('caret cannot restart an in-flight content save', [clock.deadline(), clock.sequence], [contentDeadline, contentSequence]);
    clock.advance(400); check('text autosave retains latest content and position', [writes[1].project.elements[1].text, writes[1].context.caret], ['合成正文保存', 6]);
    done();
  });

  group('restart recovery merges latest small metadata without rewriting the screenplay', () => {
    const s = memoryStorage(), p = fixture(), filePath = '/synthetic/recover.zhsp';
    writeRecovery(s, { project: p, filePath, context: context(p, { caret: 1 }) });
    const savedRaw = s.values.get(AUTOSAVE_KEY);
    writeWritingContext(s, context(p, { view: 'cards', caret: 8, cardsScrollTop: 900 }), filePath);
    const recovered = readRecovery(s).snapshot;
    check('newer UI position overlays older full recovery context', [recovered.context.view, recovered.context.caret, recovered.context.cardsScrollTop], ['cards', 8, 900]);
    check('UI-only storage leaves full recovery bytes unchanged', s.values.get(AUTOSAVE_KEY), savedRaw);
    check('recovery retains all synthetic text and image coordinates', [recovered.project.elements, recovered.project.beats, recovered.filePath], [p.elements, p.beats, filePath]);
    const embeddedOnly = memoryStorage({ [AUTOSAVE_KEY]: savedRaw, [WRITING_CONTEXT_KEY]: '{broken' });
    check('bad separate metadata falls back to valid embedded context', readRecovery(embeddedOnly).snapshot.context.caret, 1);
    const oldFormat = memoryStorage({ [AUTOSAVE_KEY]: JSON.stringify({ project: p, filePath }) });
    check('old recovery without optional context still restores screenplay', readRecovery(oldFormat).snapshot.project.elements, p.elements);
    const foreign = memoryStorage({ [AUTOSAVE_KEY]: JSON.stringify({ project: p, filePath, context: context(fixture('foreign')) }) });
    check('foreign embedded context cannot cross project boundary', readRecovery(foreign).snapshot.context == null);
    const olderSeparate = memoryStorage({ [AUTOSAVE_KEY]: JSON.stringify({ project: p, filePath, context: context(p, { caret: 9, updatedAt: 200 }) }) });
    writeWritingContext(olderSeparate, context(p, { caret: 1, updatedAt: 100 }), filePath);
    check('older independent metadata cannot replace newer snapshot position', readRecovery(olderSeparate).snapshot.context.caret, 9);
  });

  // Only pagination readiness is controlled. Render the real Editor and real
  // ScriptBlock, leaving caret capture, cancellation and epoch guards intact.
  const frames = new Map(); let frameId = 0;
  globalThis.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const pagination = readyKey => ({ pages: [], pageOf: {}, breaks: [], lineHeightPx: 24,
    contentWidthPx: 650, contentHeightPx: 900, readyKey });
  const node = (id = 'context-a2') => document.querySelector(`.script-flow [data-id="${id}"]`);
  const host = () => document.querySelector('.editor');
  const render = async ready => {
    globalThis.__writingContextPagination = pagination(ready ? `${state().version}:${state().project.settings.paper}` : undefined);
    await act(async () => root.render(React.createElement(api.Editor)));
  };
  const drainFrames = async () => {
    await act(async () => {
      for (let count = 0; frames.size && count < 10; count++) {
        const current = [...frames]; frames.clear();
        for (const [, fn] of current) fn(count * 16);
      }
    });
  };
  const mount = async (patch = {}, ready = false) => {
    if (root) { await act(async () => root.unmount()); root = null; }
    frames.clear(); document.getElementById('root').innerHTML = '';
    storage.clear(); const p = fixture();
    state().loadProject(p, '/synthetic/ui.zhsp', context(p, patch));
    root = createRoot(document.getElementById('root'));
    await render(ready);
    // jsdom does not make contentEditable natively focusable.
    for (const element of document.querySelectorAll('.script-flow [contenteditable]')) element.tabIndex = 0;
    return p;
  };
  const emit = async (target, type, options = {}) => {
    await act(async () => target.dispatchEvent(new dom.window.Event(type, { bubbles: true, ...options })));
  };
  const readyAndDrain = async () => { await render(true); await drainFrames(); };

  await mount();
  const uiBefore = snapshot();
  check('pending pagination leaves initial scroll untouched', host().scrollTop, 0);
  check('pending pagination does not focus an editor paragraph', document.activeElement?.classList.contains('sc-el'), false);
  await readyAndDrain();
  check('ready editor restores saved scroll and active paragraph', [host().scrollTop, document.activeElement?.dataset.id], [640, 'context-a2']);
  check('ready editor restores UTF-16 caret through inline formatting', api.caretOffset(node()), 5);
  unchanged('restoring editor position never edits document', uiBefore);
  await act(async () => { host().scrollTop = 810; node().focus(); api.setCaret(node(), 7); });
  await emit(document, 'selectionchange'); await emit(host(), 'scroll');
  check('selection and scroll persist exact current paragraph, scene and offset', [state().writingContext.activeId,
    state().writingContext.sceneId, state().writingContext.caret, state().writingContext.writeScrollTop], ['context-a2', 'context-s2', 7, 810]);
  await act(async () => state().setText('context-a1', '合成分页后正文'));
  await readyAndDrain();
  check('later pagination cannot reapply old caret or scroll', [api.caretOffset(node()), host().scrollTop], [7, 810]);
  groups++; console.log('PASS editor restores only after pagination and captures current position');

  await mount({ caret: 999 }); await readyAndDrain();
  check('saved caret beyond edited paragraph clamps to current DOM length', api.caretOffset(node()), '合成格式与\n换行。'.length);
  await mount({ activeId: 'deleted', caret: 999 }); await readyAndDrain();
  check('missing paragraph UI fallback does not apply an orphan caret', [state().activeId, state().writingContext.caret, document.activeElement === document.body], ['context-s2', undefined, true]);
  groups++; console.log('PASS editor clamps stale offsets and does not apply an orphan caret');

  for (const type of ['pointerdown', 'mousedown', 'keydown', 'beforeinput', 'wheel']) {
    await mount(); host().scrollTop = 73;
    await emit(document, type); await readyAndDrain();
    check(`${type} while layout pending cancels old scroll and focus restoration`, [host().scrollTop, document.activeElement === document.body], [73, true]);
  }
  await mount(); host().scrollTop = 88;
  await emit(dom.window, 'guangying:find'); await readyAndDrain();
  check('find command before readiness cancels restoration', [host().scrollTop, document.activeElement === document.body], [88, true]);
  groups++; console.log('PASS user actions before pagination readiness cancel delayed restoration');

  for (const blocker of ['modal', 'find', 'inert', 'hidden']) {
    await mount(); host().scrollTop = 62;
    let overlay;
    if (blocker === 'modal' || blocker === 'find') {
      overlay = document.createElement('div');
      if (blocker === 'modal') overlay.setAttribute('aria-modal', 'true'); else overlay.className = 'find-panel';
      document.body.appendChild(overlay);
    } else host().setAttribute(blocker, '');
    await readyAndDrain();
    check(`${blocker} prevents delayed editor restoration`, [host().scrollTop, document.activeElement === document.body], [62, true]);
    overlay?.remove(); host().removeAttribute(blocker);
  }
  await mount(); const toolbarButton = document.createElement('button'); document.body.appendChild(toolbarButton); toolbarButton.focus();
  await readyAndDrain(); same('late restoration does not steal toolbar focus', document.activeElement, toolbarButton); toolbarButton.remove();
  groups++; console.log('PASS modal, find, hidden content and toolbar focus are protected');

  for (const mode of ['creative', 'print']) {
    await mount(); const savedContext = state().writingContext;
    await act(async () => state().setPdfExportMode(mode));
    await readyAndDrain();
    check(`${mode} export never restores editor focus or scroll`, [document.activeElement === document.body, host().scrollTop], [true, 0]);
    await act(async () => { node().focus(); api.setCaret(node(), 1); host().scrollTop = 10; });
    await emit(document, 'selectionchange'); await emit(host(), 'scroll');
    same(`${mode} export ignores position capture events`, state().writingContext, savedContext);
    await act(async () => state().setPdfExportMode(null));
  }
  groups++; console.log('PASS PDF render readiness and events leave stored writer position intact');

  await mount(); await render(true);
  const beforeEpoch = state().documentEpoch;
  await act(async () => state().loadProject(fixture(), '/synthetic/replacement.zhsp', context(fixture(), { caret: 2, writeScrollTop: 321 })));
  check('same-ID replacement establishes a new UI epoch', state().documentEpoch, beforeEpoch + 1);
  await drainFrames(); check('old pending animation cannot restore into new document', host().scrollTop, 0);
  await readyAndDrain();
  check('new document restores only its own position', [host().scrollTop, api.caretOffset(node())], [321, 2]);
  groups++; console.log('PASS same-ID document replacement invalidates a pending restore frame');

  console.log(`writing context: ${checks} checks / ${groups} groups passed (synthetic memory/jsdom only)`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => {
  for (const stop of cleanup) stop();
  if (root) await act(async () => root.unmount());
  dom.window.close();
  delete globalThis.__writingContextPagination;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  for (const [key, previous] of previousGlobals) {
    if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key];
  }
});
