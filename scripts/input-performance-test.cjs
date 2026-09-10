/** Synthetic-only input/history/autosave regression. No user files or Electron data.
 * Optional: --compare-ref COMMIT benchmarks the old store from a local Git commit.
 * Timings measure store.setText only, not the complete renderer or perceived latency.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');

async function load(ref) {
  const source = ref && execFileSync('git', ['show', `${ref}:src/store/store.ts`], { cwd: root, encoding: 'utf8' });
  const result = await esbuild.build({
    stdin: { contents: `export {useStore} from './src/store/store';
      export {createProject} from './src/model/project';
      export {subscribeAutosave} from './src/app/autosaveSubscription';`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: source ? [{ name: 'read-only-baseline', setup(build) {
      build.onLoad({ filter: /[\\/]src[\\/]store[\\/]store\.ts$/ }, () => ({
        contents: source, loader: 'ts', resolveDir: path.join(root, 'src/store'),
      }));
    } }] : [],
  });
  const filename = path.join(root, 'synthetic-input-memory.cjs');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(root);
  mod._compile(result.outputFiles[0].text, filename);
  return mod.exports;
}

function fixture(api, mib = 0) {
  const p = api.createProject('合成输入性能测试');
  p.elements = Array.from({ length: 300 }, (_, i) => ({
    id: `e${i}`, type: i % 10 === 0 ? 'scene_heading' : 'action', text: '合成测试文字。'.repeat(8),
  }));
  p.beats = [{ id: 'b', kind: 'image', text: '合成数据，不是真实照片', color: '#fff', x: 10, y: 20,
    img: 'data:image/png;base64,' + 'A'.repeat(mib * 1024 * 1024), w: 300, h: 220 }];
  p.boardLinks = [{ id: 'l', from: 'scene:e0', to: 'beat:b', note: '测试关系' }];
  return p;
}

function reset(api, project) {
  api.useStore.getState().loadProject(project);
  api.useStore.setState({ past: [], future: [], dirty: false, version: 0 });
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.values(value).forEach(freeze);
  Object.freeze(value);
}

function benchmark(api, label) {
  const rows = [];
  for (const mib of [0, 5, 20]) {
    reset(api, fixture(api, mib));
    const times = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      api.useStore.getState().setText('e1', `合成输入${i}`);
      times.push(performance.now() - start);
    }
    const measured = times.slice(5).sort((a, b) => a - b);
    rows.push({ label, imageDataMiB: mib, paragraphs: 300,
      medianMs: +measured[7].toFixed(3), maxMs: +measured.at(-1).toFixed(3) });
  }
  return rows;
}

(async () => {
  const api = await load();
  const state = () => api.useStore.getState();
  const p = fixture(api, 20);
  Object.assign(p.elements[1], { rev: 'r', omit: false, sceneId: 's', dual: 'left', dualGroup: 'dg' });
  reset(api, p);
  freeze(p);
  // There must be no project serialization in the text hot path.
  const stringify = JSON.stringify;
  let serializations = 0;
  JSON.stringify = function (...args) { serializations++; return stringify.apply(this, args); };
  try { state().setText('e1', '<b>中文输入</b>'); } finally { JSON.stringify = stringify; }
  assert.equal(serializations, 0);
  const next = state().project;
  assert.notEqual(next, p);
  assert.notEqual(next.elements, p.elements);
  assert.notEqual(next.elements[1], p.elements[1]);
  for (let i = 0; i < p.elements.length; i++) if (i !== 1) assert.equal(next.elements[i], p.elements[i]);
  for (const key of Object.keys(p)) {
    if (key !== 'elements' && key !== 'updatedAt') assert.equal(next[key], p[key], `unchanged ${key}`);
  }
  assert.equal(next.elements[1].text, '<b>中文输入</b>');
  assert.deepEqual(next.elements[1], { ...p.elements[1], text: '<b>中文输入</b>' }, 'retain every element field');
  assert.equal(state().past[0], p);
  assert.equal(state().version, 1);
  assert.equal(state().dirty, true);
  state().setText('e1', '连续输入');
  assert.equal(state().past.length, 1, 'same paragraph coalesces');
  state().setText('e2', '另一段');
  assert.equal(state().past.length, 2);
  state().undo();
  assert.equal(state().project.elements[1].text, '连续输入');
  state().undo();
  assert.equal(state().project, p);
  const noOpState = state();
  state().setText('e1', p.elements[1].text);
  state().setText('missing', '不应该新增');
  assert.equal(state(), noOpState, 'no-op must preserve identity/version/dirty/future');
  state().redo();
  assert.equal(state().project.elements[1].text, '连续输入');
  state().resizeBeat('b', 400, 300);
  assert.equal(p.beats[0].w, 300, 'generic mutation must not mutate shared past');
  assert.equal(p.beats[0].img, state().project.beats[0].img);
  state().undo();
  assert.equal(state().project.beats[0].w, 300);
  state().redo();
  assert.equal(state().project.beats[0].w, 400);

  reset(api, fixture(api));
  state().setText('e1', 'A');
  state().setText('e1', 'A');
  state().setText('e1', 'B');
  assert.equal(state().past.length, 2, 'no-op breaks coalescing just like generic mutate');
  state().undo();
  state().setText('e1', '新分支');
  assert.equal(state().future.length, 0);

  const originalNow = Date.now;
  let clockTime = 100000;
  Date.now = () => clockTime;
  try {
    reset(api, fixture(api));
    state().setText('e1', '起点');
    clockTime += 1499;
    state().setText('e1', '窗口内');
    assert.equal(state().past.length, 1);
    clockTime += 1500;
    state().setText('e1', '窗口外');
    assert.equal(state().past.length, 2);
    state().mutate(p => { p.name = '非历史变更'; }, { history: false });
    state().setText('e1', '新窗口');
    assert.equal(state().past.length, 3, 'non-history mutation breaks coalescing');
    for (let i = 0; i < 130; i++) {
      clockTime += 1600;
      state().setText('e1', `历史${i}`);
    }
    assert.equal(state().past.length, 120, 'history stays bounded');
    for (let i = 0; i < 120; i++) state().undo();
    assert.equal(state().future.length, 120);
    for (let i = 0; i < 120; i++) state().redo();
    assert.equal(state().project.elements[1].text, '历史129');
  } finally { Date.now = originalNow; }

  // Fake clock proves trailing save, latest data/path, no UI-only rescheduling,
  // and cleanup / StrictMode remount without waiting or touching localStorage.
  const callbacks = new Map();
  let seq = 0;
  const writes = [];
  const clock = { set(fn) { callbacks.set(++seq, fn); return seq; }, clear(id) { callbacks.delete(id); } };
  const flush = () => { const jobs = [...callbacks.values()]; callbacks.clear(); jobs.forEach(fn => fn()); };
  const start = () => api.subscribeAutosave(api.useStore, saved => writes.push(saved), clock);
  // Chromium requires native timers not be rebound to the injected clock object.
  const nativeSet = globalThis.setTimeout;
  const nativeClear = globalThis.clearTimeout;
  globalThis.setTimeout = function (fn, delay) {
    'use strict';
    assert.equal(this, undefined, 'setTimeout receiver');
    assert.equal(delay, 900);
    return clock.set(fn);
  };
  globalThis.clearTimeout = function (id) {
    'use strict';
    assert.equal(this, undefined, 'clearTimeout receiver');
    clock.clear(id);
  };
  try {
    const cancel = api.subscribeAutosave(api.useStore, saved => writes.push(saved));
    cancel();
    assert.equal(callbacks.size, 0);
  } finally {
    globalThis.setTimeout = nativeSet;
    globalThis.clearTimeout = nativeClear;
  }
  let stop = start();
  assert.equal(callbacks.size, 1);
  state().setText('e1', '自动保存甲');
  state().setText('e1', '自动保存乙');
  assert.equal(callbacks.size, 1, 'only one pending save');
  const scheduled = seq;
  state().setActive('e2');
  state().setPageCount(15);
  state().setView('reports');
  state().markSaved('/synthetic/latest.zhsp');
  assert.equal(seq, scheduled, 'UI updates cannot postpone autosave');
  assert.equal(writes.length, 0);
  flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].project, state().project);
  assert.equal(writes[0].filePath, '/synthetic/latest.zhsp');
  assert.equal(writes[0].project.elements[1].text, '自动保存乙');
  state().undo();
  assert.equal(callbacks.size, 1);
  flush();
  assert.equal(writes[1].project, state().project);
  state().redo();
  assert.equal(callbacks.size, 1);
  stop();
  assert.equal(callbacks.size, 0);
  state().setText('e1', '已停止');
  assert.equal(callbacks.size, 0);
  stop = start();
  flush();
  assert.equal(writes.length, 3);
  assert.equal(writes[2].project.elements[1].text, '已停止');
  stop();
  console.log('PASS: immutable text, frozen snapshots, no JSON hot path, history, autosave scheduling/cleanup');

  const args = process.argv.slice(2);
  if (args.length) {
    assert.ok(args.length === 2 && args[0] === '--compare-ref' && /^[a-zA-Z0-9._/-]+$/.test(args[1]));
    const baseline = await load(args[1]);
    // Compare the two stores under identical deterministic history operations.
    const template = fixture(api);
    reset(api, JSON.parse(JSON.stringify(template)));
    reset(baseline, JSON.parse(JSON.stringify(template)));
    const now = Date.now;
    let tick = 10000;
    Date.now = () => tick;
    try {
      for (const operation of [
        ['setText', 'e1', 'A'], ['setText', 'e1', 'B'], ['setText', 'e1', 'B'],
        ['setText', 'e1', 'C'], ['setText', 'e2', 'D'], ['setType', 'e2', 'dialogue'],
        ['undo'], ['redo'], ['resizeBeat', 'b', 400, 300], ['resizeBeat', 'b', 410, 310],
        ['setText', 'missing', 'x'], ['undo'], ['setText', 'e1', '分支'], ['undo'], ['redo'],
      ]) {
        tick += 100;
        const [name, ...values] = operation;
        state()[name](...values);
        baseline.useStore.getState()[name](...values);
        for (const key of ['project', 'past', 'future', 'version', 'dirty']) {
          assert.deepEqual(state()[key], baseline.useStore.getState()[key], `${name}: ${key}`);
        }
      }
    } finally { Date.now = now; }
    console.log('PASS: history and project results match the previous version');
    console.table([...benchmark(baseline, args[1]), ...benchmark(api, 'optimized')]);
  } else console.table(benchmark(api, 'optimized'));
})().catch(error => { console.error(error); process.exitCode = 1; });
