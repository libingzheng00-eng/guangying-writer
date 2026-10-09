/** File command concurrency and format regression using only synthetic projects.
 * The native bridge resolves in memory; no file dialogs, real files, user data,
 * system clipboard, installed application or Electron process are accessed.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://file-commands-test.invalid/' });
for (const key of ['window', 'document', 'navigator', 'DOMParser', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__fileCommandConversions = [];
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
let root;
let assertions = 0;
const check = (label, actual, expected = true) => {
  assert.deepEqual(actual, expected, label);
  assertions++;
  console.log(`PASS ${label}`);
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

(async () => {
  // Wrap only the converter imports in useCommands, preserving the actual
  // implementations. Counters prove that unselected formats never run.
  const conversionModules = {
    '../io/fdx': { file: 'src/io/fdx.ts', names: ['toFdx'] },
    '../io/textscript': { file: 'src/io/textscript.ts', names: ['toPlainText', 'toMarkdown', 'toHtml'] },
  };
  const built = await esbuild.build({
    stdin: { contents: `
      export {useCommands} from './src/app/useCommands';
      export {useStore} from './src/store/store';
      export {createProject} from './src/model/project';
      export {serializeProject} from './src/io/zhsp';
      export {toFdx} from './src/io/fdx';
      export {toPlainText, toMarkdown, toHtml} from './src/io/textscript';
    `, resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'synthetic-converter-counters', setup(build) {
      build.onResolve({ filter: /^\.\.\/io\/(?:fdx|textscript)$/ }, args => {
        if (args.importer === path.join(repo, 'src/app/useCommands.ts')) return { path: args.path, namespace: 'converter-counter' };
      });
      build.onLoad({ filter: /.*/, namespace: 'converter-counter' }, args => {
        const { file, names } = conversionModules[args.path];
        const source = JSON.stringify(path.join(repo, file));
        return { contents: `import * as original from ${source}; export * from ${source};
          ${names.map(name => `export function ${name}(...args: Parameters<typeof original.${name}>) {
            globalThis.__fileCommandConversions.push('${name}'); return original.${name}(...args);
          }`).join('\n')}`, loader: 'ts', resolveDir: repo };
      });
    } }],
  });
  const filename = path.join(repo, '.file-commands-memory.cjs');
  const bundle = new Module(filename, module);
  bundle.filename = filename;
  bundle.paths = Module._nodeModulePaths(repo);
  bundle._compile(built.outputFiles[0].text, filename);
  const { useCommands, useStore, createProject, serializeProject, toFdx, toPlainText, toMarkdown, toHtml } = bundle.exports;
  const state = () => useStore.getState();
  const calls = [];
  let openResult = null;
  let confirmResult = true;
  let confirms = 0;
  window.confirm = () => { confirms++; return confirmResult; };
  let saveResult = '/synthetic/saved.zhsp';
  let saveAsResult = '/synthetic/saved-as.zhsp';
  window.api = {
    isElectron: true,
    openProject: async () => { calls.push({ method: 'openProject' }); if (openResult instanceof Error) throw openResult; return openResult; },
    saveProject: async payload => { calls.push({ method: 'saveProject', payload }); if (saveResult instanceof Error) throw saveResult; return saveResult; },
    saveProjectAs: async payload => { calls.push({ method: 'saveProjectAs', payload }); if (saveAsResult instanceof Error) throw saveAsResult; return saveAsResult; },
  };
  let commands;
  function Harness() { commands = useCommands(); return null; }
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Harness)));
  const fixture = (name = '合成文件命令', text = '合成正文') => {
    const p = createProject(name);
    p.titlePage.show = false;
    p.elements = [{ id: 'file-a', type: 'action', text }];
    return p;
  };
  const reset = (p = fixture(), filePath = '/synthetic/original.zhsp', dirty = true) => {
    state().loadProject(p, filePath);
    useStore.setState({ dirty, toast: null });
    calls.length = 0;
    openResult = null;
    confirmResult = true;
    confirms = 0;
    saveResult = '/synthetic/saved.zhsp';
    saveAsResult = '/synthetic/saved-as.zhsp';
    globalThis.__fileCommandConversions.length = 0;
    return p;
  };

  const original = reset();
  const start = state();
  check('normal save returns native path', await commands.save(false), '/synthetic/saved.zhsp');
  check('normal save sends only zhsp envelope with original association', {
    method: calls[0].method, path: calls[0].payload.path, name: calls[0].payload.name,
    app: JSON.parse(calls[0].payload.content).app, project: JSON.parse(calls[0].payload.content).project,
  }, { method: 'saveProject', path: '/synthetic/original.zhsp', name: '合成文件命令.zhsp', app: 'guangying-writer', project: original });
  check('completed exact snapshot binds path and clears dirty', [state().filePath, state().dirty], ['/synthetic/saved.zhsp', false]);
  check('save does not create history, version or document epoch', [state().past, state().future, state().version, state().documentEpoch], [start.past, start.future, start.version, start.documentEpoch]);

  const invalidSave = fixture(); invalidSave.settings.lineHeight = 0.1;
  reset(invalidSave);
  const beforeInvalidSave = state();
  check('unreadable outgoing schema is reported as a handled save failure', await commands.save(false), null);
  check('invalid outgoing snapshot never invokes disk IPC or marks the draft saved',
    [calls.length, state().dirty, state().filePath, state().project === beforeInvalidSave.project, state().past === beforeInvalidSave.past],
    [0, true, '/synthetic/original.zhsp', true, true]);
  check('schema save failure releases saving state and provides a visible error',
    [commands.isSaving(), state().toast.kind, state().toast.text.startsWith('保存失败：')], [false, 'error', true]);

  reset();
  check('normal saveAs returns path', await commands.save(true), '/synthetic/saved-as.zhsp');
  check('saveAs sends project format and base name', [calls[0].method, calls[0].payload.name, calls[0].payload.ext], ['saveProjectAs', '合成文件命令', 'zhsp']);
  check('saveAs changes file association only after success', [state().filePath, state().dirty], ['/synthetic/saved-as.zhsp', false]);

  reset();
  const typingSave = deferred();
  saveAsResult = typingSave.promise;
  const beforeTyping = state();
  const pendingTyping = commands.save(true);
  state().setText('file-a', '保存等待期间的新合成正文');
  const afterTyping = state();
  typingSave.resolve('/synthetic/typing.zhsp');
  check('pending save still returns written path', await pendingTyping, '/synthetic/typing.zhsp');
  check('pending save writes captured snapshot, not later typing', JSON.parse(calls[0].payload.content).project.elements[0].text, beforeTyping.project.elements[0].text);
  check('typing during save remains dirty with new association', [state().project, state().dirty, state().filePath], [afterTyping.project, true, '/synthetic/typing.zhsp']);
  check('save completion preserves typing history and version', [state().past, state().version, state().documentEpoch], [afterTyping.past, afterTyping.version, beforeTyping.documentEpoch]);
  check('save toast distinguishes later unsaved changes', state().toast.text.includes('当前修改尚未保存'));
  calls.length = 0;
  await commands.save(false);
  check('next save uses new path and latest content', [calls[0].payload.path, JSON.parse(calls[0].payload.content).project.elements[0].text, state().dirty], ['/synthetic/typing.zhsp', '保存等待期间的新合成正文', false]);

  reset();
  const returningSave = deferred();
  saveResult = returningSave.promise;
  const captured = state().project;
  const pendingReturning = commands.save();
  state().setText('file-a', '随后修改');
  state().undo();
  check('undo can return to the exact snapshot while save waits', state().project === captured);
  returningSave.resolve('/synthetic/exact-after-undo.zhsp');
  await pendingReturning;
  check('returning to exact saved snapshot clears dirty', state().dirty, false);

  reset();
  const switchingSave = deferred();
  saveAsResult = switchingSave.promise;
  const pendingSwitching = commands.save(true);
  const different = fixture('另一个合成工程', '另一份合成正文');
  state().loadProject(different, '/synthetic/different.zhsp');
  const afterSwitch = state();
  switchingSave.resolve('/synthetic/previous.zhsp');
  await pendingSwitching;
  check('old save cannot bind path or dirty to a different document', [state().project, state().filePath, state().dirty, state().version], [different, '/synthetic/different.zhsp', false, afterSwitch.version]);

  for (const sameObject of [false, true]) {
    const p = reset();
    const delayed = deferred();
    saveAsResult = delayed.promise;
    const pending = commands.save(true);
    const priorEpoch = state().documentEpoch;
    const reloaded = sameObject ? p : JSON.parse(JSON.stringify(p));
    state().loadProject(reloaded, '/synthetic/reloaded.zhsp');
    check(`reload increments epoch with ${sameObject ? 'identical object' : 'same project ID'}`, state().documentEpoch, priorEpoch + 1);
    delayed.resolve('/synthetic/stale-save.zhsp');
    await pending;
    check(`old save ignored after ${sameObject ? 'identical-object' : 'same-ID'} reload`, [state().project, state().filePath, state().dirty], [reloaded, '/synthetic/reloaded.zhsp', false]);
  }

  reset();
  const newDocumentSave = deferred();
  saveResult = newDocumentSave.promise;
  const pendingNewDocument = commands.save();
  const epochBeforeNew = state().documentEpoch;
  state().newProject();
  const blank = state().project;
  newDocumentSave.resolve('/synthetic/old-new.zhsp');
  await pendingNewDocument;
  check('new document increments epoch and ignores old save', [state().project, state().filePath, state().dirty, state().documentEpoch], [blank, null, false, epochBeforeNew + 1]);

  reset();
  const concurrentSave = deferred();
  saveAsResult = concurrentSave.promise;
  const pendingConcurrent = commands.save(true);
  check('repeat save is rejected while saveAs awaits native dialog', await commands.save(false), false);
  await act(async () => root.render(React.createElement(Harness)));
  check('rerender retains save lock and refuses another saveAs', await commands.save(true), false);
  check('only one native save or dialog is requested concurrently', calls.map(call => call.method), ['saveProjectAs']);
  check('concurrent save displays in-progress information', state().toast.text.includes('保存正在进行'));
  concurrentSave.resolve('/synthetic/concurrent.zhsp');
  await pendingConcurrent;
  saveAsResult = '/synthetic/after-concurrent.zhsp';
  check('save lock releases after completion', await commands.save(true), '/synthetic/after-concurrent.zhsp');

  reset();
  saveResult = null;
  check('cancelled save returns null', await commands.save(), null);
  check('cancelled save preserves association and dirty', [state().filePath, state().dirty], ['/synthetic/original.zhsp', true]);
  saveResult = '/synthetic/after-cancel.zhsp';
  check('save lock releases after cancellation', await commands.save(), '/synthetic/after-cancel.zhsp');

  reset();
  saveAsResult = new Error('合成保存失败');
  check('rejected bridge save returns null', await commands.save(true), null);
  check('save error preserves association and dirty', [state().filePath, state().dirty], ['/synthetic/original.zhsp', true]);
  check('save error is shown clearly', [state().toast.kind, state().toast.text], ['error', '保存失败：合成保存失败']);
  saveAsResult = '/synthetic/after-error.zhsp';
  check('save lock releases after rejected bridge', await commands.save(true), '/synthetic/after-error.zhsp');

  const fdx = '<?xml version="1.0"?><FinalDraft><Content><Paragraph Type="Action"><Text>合成FDX正文</Text></Paragraph></Content></FinalDraft>';
  for (const ext of ['fdx', 'FDX', 'txt', 'MD']) {
    reset();
    openResult = { path: `/synthetic/imported.${ext}`, content: ext.toLowerCase() === 'fdx' ? fdx : '合成导入正文。' };
    await commands.open();
    check(`opening external ${ext} removes source file association`, state().filePath, null);
    check(`opening external ${ext} derives extension-free project name`, state().project.name, 'imported');
    calls.length = 0;
    await commands.save();
    check(`saving external ${ext} requests new zhsp target`, [calls[0].method, calls[0].payload.path, calls[0].payload.name, JSON.parse(calls[0].payload.content).app], ['saveProject', null, 'imported.zhsp', 'guangying-writer']);
  }

  reset();
  const nativeProject = fixture('合成原生工程', '合成原生正文');
  openResult = { path: '/synthetic/native.zhsp', content: serializeProject(nativeProject) };
  await commands.open();
  check('native zhsp opening preserves source association', [state().filePath, state().project.name], ['/synthetic/native.zhsp', '合成原生工程']);
  const beforeBadOpen = state().project;
  openResult = { path: '/synthetic/broken.zhsp', content: '{invalid synthetic JSON' };
  await commands.open();
  check('parse failure preserves current document', [state().project, state().filePath, state().toast.kind], [beforeBadOpen, '/synthetic/native.zhsp', 'error']);
  openResult = new Error('合成打开失败');
  await commands.open();
  check('bridge open rejection is handled without changing project', [state().project, state().toast.text], [beforeBadOpen, '打开失败：合成打开失败']);
  openResult = null;
  await commands.open();
  check('cancelled open preserves current association', state().filePath, '/synthetic/native.zhsp');

  reset();
  state().setText('file-a', '尚未保存的合成正文');
  const dirtyOpen = state();
  confirmResult = false;
  openResult = { path: '/synthetic/replacement.zhsp', content: serializeProject(nativeProject) };
  await commands.open();
  check('dirty open asks before replacement', confirms, 1);
  check('cancelled discard preserves project, path, dirty and both history stacks', [state().project, state().filePath, state().dirty, state().past, state().future, state().version, state().documentEpoch], [dirtyOpen.project, dirtyOpen.filePath, dirtyOpen.dirty, dirtyOpen.past, dirtyOpen.future, dirtyOpen.version, dirtyOpen.documentEpoch]);

  reset(fixture(), '/synthetic/original.zhsp', false);
  const waitingOpen = deferred(); openResult = waitingOpen.promise;
  const pendingOpen = commands.open();
  state().setText('file-a', '文件对话框等待时继续输入');
  const duringOpen = state(); confirmResult = false;
  waitingOpen.resolve({ path: '/synthetic/replacement.zhsp', content: serializeProject(nativeProject) });
  await pendingOpen;
  check('editing while open waits is also confirmed', confirms, 1);
  check('rejecting late replacement preserves new input/history', [state().project, state().past, state().dirty], [duringOpen.project, duringOpen.past, true]);

  reset();
  const staleOpen = deferred(); openResult = staleOpen.promise;
  const oldOpen = commands.open();
  const sameIdReload = JSON.parse(JSON.stringify(state().project));
  state().loadProject(sameIdReload, '/synthetic/same-id-reloaded.zhsp');
  const afterReload = state();
  staleOpen.resolve({ path: '/synthetic/replacement.zhsp', content: serializeProject(nativeProject) });
  await oldOpen;
  check('old open cannot replace an epoch-changed same-ID document', [state().project, state().filePath, state().documentEpoch, state().past], [sameIdReload, afterReload.filePath, afterReload.documentEpoch, afterReload.past]);
  check('stale open is rejected before discard confirmation', confirms, 0);

  reset(fixture(), '/synthetic/original.zhsp', false);
  const firstOpen = deferred();
  openResult = firstOpen.promise; const pendingFirst = commands.open();
  check('duplicate open is ignored while one selection is pending', await commands.open(), false);
  check('duplicate click creates only one native file chooser', calls.filter(call => call.method === 'openProject').length, 1);
  firstOpen.resolve({ path: '/synthetic/first-open.zhsp', content: serializeProject(nativeProject) });
  await pendingFirst;
  check('single pending open loads its chosen file once with fresh history', [state().project.name, state().filePath, state().past.length, state().future.length], [nativeProject.name, '/synthetic/first-open.zhsp', 0, 0]);
  check('clean replacement does not require discard confirmation', confirms, 0);

  reset();
  const rejectedState = state();
  openResult = { path: '/synthetic/invalid.zhsp', content: '{invalid', openToken: 'uncommittable' };
  const committedTokens = [];
  window.api.commitOpen = async (token, name) => { committedTokens.push([token, name]); return true; };
  await commands.open();
  check('invalid project never asks to discard a dirty document', confirms, 0);
  check('invalid project preserves document identity and recent commit state',
    [state().project, state().documentEpoch, state().dirty, committedTokens.length],
    [rejectedState.project, rejectedState.documentEpoch, true, 0]);
  openResult = { path: '/synthetic/native.zhsp', content: serializeProject(nativeProject), openToken: 'validated-open' };
  confirmResult = false;
  await commands.open();
  check('cancelled discard never commits a recent record', committedTokens.length, 0);
  confirmResult = true;
  await commands.open();
  check('successfully parsed and loaded project commits its opaque native token and display name', committedTokens, [['validated-open', nativeProject.name]]);

  reset();
  window.api.openRecent = async id => { calls.push({ method: 'openRecent', id }); return { path: '/synthetic/recent.zhsp', content: serializeProject(nativeProject), openToken: 'recent-open' }; };
  await commands.openRecent('recent-id');
  check('recent command submits only an opaque ID and loads validated content', [calls[0], state().filePath], [{ method: 'openRecent', id: 'recent-id' }, '/synthetic/recent.zhsp']);
  window.api.relocateRecent = async id => { calls.push({ method: 'relocateRecent', id }); return null; };
  const beforeRelocate = state();
  await commands.relocateRecent('recent-id');
  check('cancelled relocation preserves the current document and location', [state().project, state().filePath, state().documentEpoch], [beforeRelocate.project, beforeRelocate.filePath, beforeRelocate.documentEpoch]);

  reset();
  const waitingImport = deferred(); openResult = waitingImport.promise;
  const pendingImport = commands.importAny();
  check('import shares the open lock and refuses duplicate new/open', [commands.newFile(), await commands.open()], [false, false]);
  const switched = fixture('合成导入期间切换', '不能追加旧导入');
  state().loadProject(switched, '/synthetic/switched.zhsp');
  waitingImport.resolve({ path: '/synthetic/import.txt', content: '过期导入文字' });
  await pendingImport;
  check('stale import cannot append into a later document or ask for replacement', [state().project, confirms], [switched, 0]);
  reset();
  openResult = { path: '/synthetic/import.txt', content: '合成替换内容' };
  confirmResult = false;
  const retainedImport = state();
  await commands.importAny();
  check('import replacement separately protects dirty document when discard is declined',
    [confirms, state().project, state().filePath, state().past],
    [2, retainedImport.project, retainedImport.filePath, retainedImport.past]);
  reset();
  openResult = new Error('合成导入对话框失败');
  check('import bridge rejection is caught and releases shared open lock', await commands.importAny(), false);
  openResult = { path: '/synthetic/after-import-failure.zhsp', content: serializeProject(nativeProject) };
  check('open remains usable after an import bridge rejection', await commands.open());

  const converters = { fdx: ['toFdx', toFdx], txt: ['toPlainText', toPlainText], md: ['toMarkdown', toMarkdown], html: ['toHtml', toHtml] };
  for (const [kind, [converter, convert]] of Object.entries(converters)) {
    const p = reset(fixture('合成导出工程', '<b>合成格式</b> &amp; 正文'));
    saveAsResult = `/synthetic/export.${kind}`;
    const beforeExport = state();
    await commands.exportAs(kind);
    check(`${kind} export invokes only its selected real converter`, globalThis.__fileCommandConversions, [converter]);
    check(`${kind} export sends selected format content and extension`, calls[0], { method: 'saveProjectAs', payload: { content: convert(p), name: p.name, ext: kind } });
    check(`${kind} export does not mark project saved or alter history`, [state().project, state().filePath, state().dirty, state().past, state().future, state().version, state().documentEpoch], [beforeExport.project, beforeExport.filePath, beforeExport.dirty, beforeExport.past, beforeExport.future, beforeExport.version, beforeExport.documentEpoch]);
  }

  console.log(`PASS file commands: ${assertions} synthetic checks; no real files written.`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; })
  .finally(async () => { if (root) await act(async () => root.unmount()); dom.window.close(); });
