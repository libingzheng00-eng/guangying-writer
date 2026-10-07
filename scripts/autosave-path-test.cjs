/** Synthetic autosave association regression; memory bundle/timers only.
 * No filesystem output, user projects, userData, localStorage or Electron.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const repo = path.resolve(__dirname, '..');
// The real store loads appearance preferences on module import. Isolate that
// access from both browser storage and Node's optional localStorage backing file.
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: () => null,
  setItem: () => { throw new Error('Unexpected storage write in autosave test'); },
} });

async function load() {
  const result = await esbuild.build({
    stdin: { contents: `export {useStore} from './src/store/store';
      export {createProject} from './src/model/project';
      export {subscribeAutosave} from './src/app/autosaveSubscription';`, resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
  });
  const filename = path.join(repo, '.autosave-path-memory.cjs');
  const bundle = new Module(filename, module);
  bundle.filename = filename;
  bundle.paths = Module._nodeModulePaths(repo);
  bundle._compile(result.outputFiles[0].text, filename);
  return bundle.exports;
}

function fakeClock() {
  let now = 0, sequence = 0;
  const pending = new Map();
  return {
    pending,
    get now() { return now; },
    get sequence() { return sequence; },
    set(fn) { const id = ++sequence; pending.set(id, { due: now + 900, fn }); return id; },
    clear(id) { pending.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, job] of [...pending]) {
        if (job.due <= now && pending.has(id)) { pending.delete(id); job.fn(); }
      }
    },
    deadline() { assert.equal(pending.size, 1); return [...pending.values()][0].due; },
  };
}

(async () => {
  const { useStore, createProject, subscribeAutosave } = await load();
  const state = () => useStore.getState();
  const fixture = (name = '合成自动保存工程', text = '合成原文') => {
    const p = createProject(name);
    p.id = 'synthetic-shared-project-id';
    p.elements = [{ id: 'autosave-a', type: 'action', text }];
    return p;
  };
  let checks = 0, groups = 0;
  const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); checks++; };
  const group = (label, run) => { run(); groups++; console.log(`PASS ${label}`); };
  const begin = (project = fixture(), filePath = null, write) => {
    state().loadProject(project, filePath);
    const clock = fakeClock(), writes = [];
    const stop = subscribeAutosave(useStore, saved => { writes.push(saved); if (write) write(saved); }, clock);
    return { clock, writes, stop };
  };
  const capture = () => ({ project: state().project, documentEpoch: state().documentEpoch });
  const history = () => [state().project, state().past, state().future, state().version, state().documentEpoch, state().dirty];

  group('startup and interface updates keep the 900ms trailing deadline', () => {
    const { clock, writes, stop } = begin(fixture(), '/synthetic/initial.zhsp');
    const before = history();
    check('startup has one timer', clock.pending.size, 1);
    check('startup deadline is 900ms', clock.deadline(), 900);
    clock.advance(300);
    state().setActive('autosave-a'); state().setPageCount(4); state().setView('reports'); state().notify('合成界面状态');
    check('interface changes never replace timer', clock.sequence, 1);
    clock.advance(599); check('no early write', writes.length, 0);
    clock.advance(1); check('one startup write', writes.length, 1);
    check('write uses latest project and path', [writes[0].project, writes[0].filePath], [state().project, '/synthetic/initial.zhsp']);
    check('writing autosave changes no history or dirty', history(), before);
    stop();
  });

  group('successive typing resets only the content deadline', () => {
    const { clock, writes, stop } = begin();
    clock.advance(900); state().setText('autosave-a', '合成甲');
    check('first edit schedules a fresh timer', clock.deadline(), 1800);
    clock.advance(450); state().setText('autosave-a', '合成乙');
    check('later edit restarts trailing deadline', clock.deadline(), 2250);
    const sequence = clock.sequence;
    clock.advance(750); state().setZoom(1.2); state().setSidebar('outline');
    check('interface state does not restart content timer', clock.sequence, sequence);
    clock.advance(149); check('content not saved early', writes.length, 1);
    clock.advance(1); check('latest content saved once', [writes.length, writes[1].project.elements[0].text], [2, '合成乙']);
    stop();
  });

  group('save completion after a completed autosave persists the new path', () => {
    const { clock, writes, stop } = begin();
    state().setText('autosave-a', '合成停笔后正文'); clock.advance(900);
    check('completed timer leaves no pending job', clock.pending.size, 0);
    const saved = capture(), before = history();
    check('save belongs to current document', state().markSaved('/synthetic/first-save.zhsp', saved));
    check('path-only save does not bump document version or alter history', [state().project, state().past, state().future, state().version, state().documentEpoch], before.slice(0, 5));
    check('path schedules one new trailing save', [clock.pending.size, clock.deadline()], [1, 1800]);
    check('old autosave retains old path until new deadline', writes[0].filePath, null);
    clock.advance(899); check('path-only save not early', writes.length, 1);
    clock.advance(1); check('new association saved without further typing', [writes.length, writes[1].filePath, writes[1].project], [2, '/synthetic/first-save.zhsp', saved.project]);
    const sequence = clock.sequence;
    state().markSaved('/synthetic/first-save.zhsp', capture());
    check('same-path save creates no extra timer', [clock.sequence, clock.pending.size], [sequence, 0]);
    state().markSaved('/synthetic/save-as.zhsp', capture()); clock.advance(900);
    check('save-as updates a completed association', writes[2].filePath, '/synthetic/save-as.zhsp');
    stop();
  });

  group('path changes preserve an already pending content deadline', () => {
    const { clock, writes, stop } = begin();
    clock.advance(900); const saveStarted = capture(); state().setText('autosave-a', '合成待保存正文');
    clock.advance(700); const deadline = clock.deadline(), sequence = clock.sequence;
    state().markSaved('/synthetic/pending-path.zhsp', saveStarted);
    check('an older manual-save snapshot cannot clear later dirty content', state().dirty);
    check('path cannot postpone an existing content timer', [clock.deadline(), clock.sequence], [deadline, sequence]);
    check('path cannot write early while content timer is pending', writes.length, 1);
    clock.advance(199); check('pending write still waits', writes.length, 1);
    clock.advance(1); check('original deadline saves latest text and path', [writes[1].project.elements[0].text, writes[1].filePath], ['合成待保存正文', '/synthetic/pending-path.zhsp']);
    stop();
  });

  group('typing after a path-only update retains trailing latest-state semantics', () => {
    const { clock, writes, stop } = begin();
    clock.advance(900); state().markSaved('/synthetic/path-before-edit.zhsp', capture());
    clock.advance(300); state().setText('autosave-a', '合成路径之后的新正文');
    check('new content restarts path timer', clock.deadline(), 2100);
    clock.advance(899); check('new text not saved early', writes.length, 1);
    clock.advance(1); check('newest text and association save together', [writes[1].project.elements[0].text, writes[1].filePath], ['合成路径之后的新正文', '/synthetic/path-before-edit.zhsp']);
    stop();
  });

  group('same-ID and identical-object reloads create an independent save boundary', () => {
    for (const identical of [false, true]) {
      const project = fixture();
      const { clock, writes, stop } = begin(project, '/synthetic/old.zhsp');
      const oldSave = capture(); clock.advance(500);
      const loaded = identical ? project : fixture('合成同ID新工程', '合成重载正文');
      state().loadProject(loaded, '/synthetic/reloaded.zhsp');
      check('reload increases epoch despite shared ID/object', state().documentEpoch, oldSave.documentEpoch + 1);
      check('reload replaces old timer with a new trailing timer', [clock.deadline(), clock.pending.size], [1400, 1]);
      check('old save result cannot alter reloaded association', state().markSaved('/synthetic/stale.zhsp', oldSave), false);
      check('ignored save cannot change timer or path', [clock.sequence, state().filePath], [2, '/synthetic/reloaded.zhsp']);
      clock.advance(899); check('old document is never saved at its old deadline', writes.length, 0);
      clock.advance(1); check('only reloaded document/path saved', [writes.length, writes[0].project, writes[0].filePath], [1, loaded, '/synthetic/reloaded.zhsp']);
      stop();
    }
  });

  group('new document and subscription cleanup never save stale associations', () => {
    const { clock, writes, stop } = begin(fixture(), '/synthetic/old.zhsp');
    const oldSave = capture(); clock.advance(500); state().newProject();
    const fresh = state().project;
    check('new project rejects a prior save result', state().markSaved('/synthetic/stale.zhsp', oldSave), false);
    clock.advance(900); check('new project saves its own null association', [writes[0].project, writes[0].filePath], [fresh, null]);
    state().markSaved('/synthetic/new.zhsp', capture());
    stop(); check('cleanup cancels a path-only timer', clock.pending.size, 0);
    state().setText(fresh.elements[0].id, '合成已停止输入'); state().markSaved('/synthetic/stopped.zhsp', capture());
    clock.advance(900); check('stopped subscription never writes or schedules', [writes.length, clock.pending.size], [1, 0]);
    const again = subscribeAutosave(useStore, saved => writes.push(saved), clock);
    clock.advance(900); check('remount reads the latest stopped state/path', [writes[1].project, writes[1].filePath], [state().project, '/synthetic/stopped.zhsp']);
    again(); again(); check('repeated cleanup is harmless', clock.pending.size, 0);
  });

  group('reentrant path updates from a write can schedule their own trailing job', () => {
    let once = false;
    const { clock, writes, stop } = begin(fixture(), null, () => {
      if (!once) { once = true; state().markSaved('/synthetic/reentrant.zhsp', capture()); }
    });
    clock.advance(900); check('completed callback does not hide reentrant timer', [writes.length, clock.pending.size, clock.deadline()], [1, 1, 1800]);
    clock.advance(900); check('reentrant association is saved exactly once', [writes.length, writes[1].filePath, clock.pending.size], [2, '/synthetic/reentrant.zhsp', 0]);
    stop();
  });
  console.log(`autosave path: ${checks} checks / ${groups} groups passed`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
  else delete globalThis.localStorage;
});
