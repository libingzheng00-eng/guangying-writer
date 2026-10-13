/** PDF export command races with synthetic projects only.
 * Snapshot builders and the native bridge are in-memory stubs; no Electron,
 * file dialog, real PDF or user data is touched.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div><div id="stage"></div>', { url: 'http://export-races.invalid/' });
for (const key of ['window', 'document', 'navigator', 'DOMParser', 'localStorage', 'HTMLElement']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
}
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__pdfSnapshots = [];
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
let checks = 0;
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); };
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

(async () => {
  const built = await esbuild.build({
    stdin: { contents: `
      export {useCommands} from './src/app/useCommands';
      export {useStore} from './src/store/store';
      export {createProject} from './src/model/project';
    `, resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'snapshot-stubs', setup(build) {
      build.onResolve({ filter: /^\.\.\/io\/(?:creativePdf|printPdf)$/ }, args => {
        if (args.importer === path.join(repo, 'src/app/useCommands.ts')) return { path: args.path, namespace: 'pdf-stub' };
      });
      build.onLoad({ filter: /.*/, namespace: 'pdf-stub' }, args => ({ loader: 'ts', contents: args.path.endsWith('creativePdf')
        ? `export function buildCreativePdf(node: HTMLElement) { globalThis.__pdfSnapshots.push(['creative', node.dataset.paginationKey]); return { mode: 'creative', pageSize: { width: 1, height: 1 }, html: '<section class="export-sheet"></section>' }; }`
        : `export function buildPrintPdf(node: HTMLElement) { globalThis.__pdfSnapshots.push(['print', node.dataset.paginationKey]); return { mode: 'print', pageSize: { width: 1, height: 1 }, html: '<section class="print-sheet"></section>' }; }` }));
    } }],
  });
  const filename = path.join(repo, '.export-races-memory.cjs');
  const bundle = new Module(filename, module);
  bundle.filename = filename; bundle.paths = Module._nodeModulePaths(repo);
  bundle._compile(built.outputFiles[0].text, filename);
  const { useCommands, useStore, createProject } = bundle.exports;
  const state = () => useStore.getState();

  const exports = [];
  let nativeResult = null;
  window.api = {
    isElectron: true,
    exportPdf: async opts => { exports.push(opts.mode); return nativeResult ? nativeResult.promise : '/synthetic/out.pdf'; },
    showInFolder: () => {},
    saveProjectAs: async () => { throw new Error('合成磁盘错误'); },
  };
  let commands;
  function Harness() { commands = useCommands(); return null; }
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Harness)));

  const fixture = () => { const p = createProject('合成导出'); p.elements = [{ id: 'x-1', type: 'action', text: '合成正文' }]; return p; };
  const stage = document.getElementById('stage');
  const mountReady = (mode, key) => {
    stage.innerHTML = mode === 'creative' ? '<div class="editor__scroll" data-ready="true"></div>' : '<div class="preview" data-ready="true"></div>';
    stage.firstChild.dataset.paginationKey = key ?? `${state().version}:${mode === 'creative' ? state().project.settings.paper : 'A4'}`;
    return stage.firstChild;
  };
  const reset = (view = 'board') => {
    state().loadProject(fixture(), null);
    useStore.setState({ view, pdfExportMode: null, toast: null });
    exports.length = 0; globalThis.__pdfSnapshots.length = 0; nativeResult = null; stage.innerHTML = '';
  };

  reset();
  mountReady('print');
  await act(async () => { await commands.exportPdf('print'); });
  check('A4 export freezes the ready preview and calls native once', [exports, globalThis.__pdfSnapshots.map(item => item[0])], [['print'], ['print']]);
  check('completed export restores the original view and clears export mode', [state().view, state().pdfExportMode], ['board', null]);
  check('completed export reports success', state().toast.kind, 'ok');

  reset('write');
  mountReady('creative');
  await act(async () => { await commands.exportPdf('creative'); });
  check('creative export uses the writing canvas snapshot', [exports, state().view], [['creative'], 'write']);

  reset();
  mountReady('print', 'stale:A4');
  let running;
  await act(async () => { running = commands.exportPdf('print'); await tick(60); });
  check('stale pagination key is not exported', exports, []);
  mountReady('print');
  await act(async () => { await running; });
  check('export waits until pagination matches the current version', exports, ['print']);

  reset();
  await act(async () => { running = commands.exportPdf('print'); await tick(20); });
  await act(async () => { state().setText('x-1', '导出等待期间的新输入'); });
  mountReady('print');
  await act(async () => { await running; });
  check('typing during export aborts before any native PDF request', exports, []);
  check('aborted export explains the change', [state().toast.kind, state().toast.text.includes('请重新导出')], ['error', true]);
  check('aborted export clears export mode', state().pdfExportMode, null);
  check('aborted export keeps the newer edit', state().project.elements[0].text, '导出等待期间的新输入');

  reset();
  const before = state().documentEpoch;
  await act(async () => { running = commands.exportPdf('print'); await tick(20); });
  await act(async () => { state().loadProject(fixture(), null); });
  mountReady('print');
  await act(async () => { await running; });
  check('reloading the same project id during export aborts it', [exports, state().documentEpoch > before], [[], true]);

  reset();
  await act(async () => { running = commands.exportPdf('print'); await tick(20); });
  await act(async () => { state().setView('cards'); });
  await act(async () => { await running; });
  check('a user view change during export aborts and is not overridden', [exports, state().view, state().pdfExportMode], [[], 'cards', null]);

  reset();
  mountReady('print');
  nativeResult = deferred();
  let first;
  await act(async () => { first = commands.exportPdf('print'); await tick(10); });
  await act(async () => { await commands.exportPdf('creative'); });
  check('a second export while one is running is ignored', exports, ['print']);
  nativeResult.resolve('/synthetic/out.pdf');
  await act(async () => { await first; });
  check('first export still completes', [state().pdfExportMode, state().toast.kind], [null, 'ok']);

  reset();
  await act(async () => { await commands.exportAs('txt'); });
  check('text export failures are reported instead of throwing', [state().toast.kind, state().toast.text.startsWith('导出失败')], ['error', true]);

  await act(async () => root.unmount());
  console.log(`\n=== export-command-races ${checks}/${checks} PASS (stubs; real PDF output is validated separately) ===`);
})().catch(error => { console.error(error); process.exit(1); });
