/** Forward compatibility: fields from newer versions survive open/edit/save, and
 * opening a newer file asks first. Synthetic data, in-memory bridge only. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://forward-compat.invalid/' });
for (const key of ['window', 'document', 'navigator', 'DOMParser', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
let checks = 0;
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); };

(async () => {
  const built = await esbuild.build({ stdin: { contents: `
    export {useCommands} from './src/app/useCommands';
    export {useStore} from './src/store/store';
    export {setChoiceHost} from './src/app/choiceDialog';
    export {createProject, FORMAT_REVISION} from './src/model/project';
    export {serializeProject, parseProject, projectFileNotice} from './src/io/zhsp';
    export {toFdx} from './src/io/fdx';
    export {toPlainText, toMarkdown, toHtml} from './src/io/textscript';
  `, resolveDir: repo, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const filename = path.join(repo, '.forward-compat-memory.cjs');
  const bundle = new Module(filename, module);
  bundle.filename = filename; bundle.paths = Module._nodeModulePaths(repo);
  bundle._compile(built.outputFiles[0].text, filename);
  const { useCommands, useStore, setChoiceHost, createProject, FORMAT_REVISION, serializeProject, parseProject, projectFileNotice, toFdx, toPlainText, toMarkdown, toHtml } = bundle.exports;
  const state = () => useStore.getState();

  const base = createProject('合成新版工程');
  base.elements = [{ id: 'fc-1', type: 'action', text: '合成正文', futureElementField: { level: 2 } }];
  base.beats = [{ id: 'fc-beat', text: '合成卡片', color: '#fff7d6', x: 1, y: 2, futureBeatField: 'FUTURE_BEAT_MARKER' }];
  const future = { schema: 9, items: [{ id: 'a', text: 'FUTURE_PROJECT_MARKER' }] };
  const newerFile = JSON.stringify({ app: 'guangying-writer', fileVersion: 1, formatRevision: FORMAT_REVISION + 5, savedAt: 1,
    project: { ...base, futureWorkspace: future } });

  // ---- format layer ----
  const parsed = parseProject(newerFile);
  check('unknown top-level field is preserved, not dropped', parsed.preservedFields, { futureWorkspace: future });
  check('unknown element field is preserved', parsed.elements[0].futureElementField, { level: 2 });
  check('unknown card field is preserved', parsed.beats[0].futureBeatField, 'FUTURE_BEAT_MARKER');
  const resaved = JSON.parse(serializeProject(parsed));
  check('saving writes the field back where the newer version put it', resaved.project.futureWorkspace, future);
  check('saved file does not leak the internal preservedFields wrapper', 'preservedFields' in resaved.project, false);
  check('saved file records this format revision', resaved.formatRevision, FORMAT_REVISION);
  check('card field survives a save', resaved.project.beats[0].futureBeatField, 'FUTURE_BEAT_MARKER');
  check('known fields win over a preserved field of the same name', JSON.parse(serializeProject({ ...parsed, preservedFields: { futureWorkspace: future } })).project.name, '合成新版工程');
  check('newer format is detected', projectFileNotice(newerFile, parsed), { newerFormat: true, preservedFields: ['futureWorkspace'] });
  const plainFile = serializeProject(createProject('合成普通工程'));
  check('same-version file raises no notice', projectFileNotice(plainFile, parseProject(plainFile)), { newerFormat: false, preservedFields: [] });
  const legacy = JSON.stringify({ app: 'mojiang', fileVersion: 1, savedAt: 1, project: createProject('合成旧工程') });
  check('older file without a revision raises no notice', projectFileNotice(legacy, parseProject(legacy)).newerFormat, false);
  assert.throws(() => parseProject('{"project":{"__proto__":{"polluted":true},"elements":[]}}'));
  check('prototype keys are rejected rather than preserved', 'polluted' in {}, false);
  const exported = toFdx(parsed) + toPlainText(parsed) + toMarkdown(parsed) + toHtml(parsed);
  check('preserved data never reaches formal exports', ['FUTURE_PROJECT_MARKER', 'FUTURE_BEAT_MARKER'].some(marker => exported.includes(marker)), false);

  // ---- store + open command ----
  let choiceResult = 'cancel';
  const asked = [];
  setChoiceHost((request, resolve) => { asked.push(request); resolve(choiceResult); });
  let openResult = null, saved = null;
  window.confirm = () => true;
  window.api = {
    isElectron: true,
    openProject: async () => openResult,
    saveProject: async payload => { saved = payload.content; return '/synthetic/saved.zhsp'; },
    saveProjectAs: async payload => { saved = payload.content; return '/synthetic/saved.zhsp'; },
    commitOpen: async () => true,
  };
  let commands;
  function Harness() { commands = useCommands(); return null; }
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Harness)));
  const current = createProject('合成当前稿');
  state().loadProject(current, '/synthetic/current.zhsp');

  openResult = { path: '/synthetic/newer.zhsp', content: newerFile };
  check('declining the newer-version prompt does not open', await commands.open(), false);
  check('prompt explains the situation with named options', [asked[0].title, asked[0].options.map(option => option.label)], ['这个工程来自更新的版本', ['打开并保留新版内容', '不打开']]);
  check('current document is untouched after declining', [state().project, state().filePath], [current, '/synthetic/current.zhsp']);
  choiceResult = 'open';
  check('accepting opens the newer file', await commands.open(), true);
  check('opened project carries preserved fields', state().project.preservedFields, { futureWorkspace: future });
  await act(async () => state().setText('fc-1', '本版编辑过的正文'));
  await act(async () => state().mutate(project => { project.name = '改过名字'; }));
  check('edits keep preserved fields', state().project.preservedFields, { futureWorkspace: future });
  await act(async () => state().undo());
  check('undo keeps preserved fields', state().project.preservedFields, { futureWorkspace: future });
  await commands.save(false);
  const written = JSON.parse(saved).project;
  check('save after editing writes the newer data back unchanged', [written.futureWorkspace, written.elements[0].text, written.elements[0].futureElementField], [future, '本版编辑过的正文', { level: 2 }]);
  asked.length = 0;
  openResult = { path: '/synthetic/plain.zhsp', content: plainFile };
  await commands.open();
  check('ordinary files open without the prompt', asked.length, 0);

  await act(async () => root.unmount());
  console.log(`\n=== forward-compat ${checks}/${checks} PASS (synthetic; versions ≤ alpha.18.16 still drop unknown fields) ===`);
})().catch(error => { console.error(error); process.exit(1); });
