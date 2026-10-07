/** Real Editor + store + clipboard-event integration with synthetic data only.
 * jsdom has no native OS clipboard/default editing. MemoryDataTransfer and the
 * ClipboardEvent shim below only deliver event data to the real React handlers.
 * Focus adapter models contentEditable focusability missing from jsdom; it does
 * not replace Editor's requestFocus, selection, paste or history implementation.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://clipboard-ui-test.invalid/', pretendToBeVisual: true });
const w = dom.window;
const originals = new Map();
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'NodeFilter', 'Element', 'Event', 'InputEvent', 'KeyboardEvent', 'MouseEvent', 'CompositionEvent', 'DOMParser', 'Range', 'Selection', 'getComputedStyle', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? w : w[key] });
}
originals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.HTMLElement.prototype.scrollIntoView = () => {};
const nativeFocus = w.HTMLElement.prototype.focus;
w.HTMLElement.prototype.focus = function (options) {
  if (this.matches('.sc-el--editable[contenteditable="true"]')) this.tabIndex = 0;
  return nativeFocus.call(this, options);
};
class MemoryDataTransfer {
  constructor(entries = []) { this.values = new Map(entries); }
  get types() { return [...this.values.keys()]; }
  getData(type) { return this.values.get(type) || ''; }
  setData(type, value) { this.values.set(type, String(value)); }
  clearData(type) { if (type) this.values.delete(type); else this.values.clear(); }
}
const ClipboardEvent = w.ClipboardEvent || class ClipboardEvent extends w.Event {
  constructor(type, init = {}) {
    super(type, init);
    Object.defineProperty(this, 'clipboardData', { value: init.clipboardData });
  }
};
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
w.addEventListener('error', event => errors.push(event.message));
const clone = value => JSON.parse(JSON.stringify(value));
let checks = 0, groups = 0, mounted;
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); };

(async () => {
  const built = await require('esbuild').build({
    stdin: { contents: "export { Editor } from './src/components/Editor'; export { useStore } from './src/store/store'; export { createProject } from './src/model/project'; export * from './src/utils/dom'; export * from './src/utils/writingClipboard'; export { runEditHistory } from './src/utils/editHistory';", resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.png': 'dataurl', '.css': 'empty' }, logLevel: 'silent',
  });
  const mod = new Module(path.join(repo, '.clipboard-ui-memory.cjs'), module);
  mod.filename = path.join(repo, '.clipboard-ui-memory.cjs');
  mod.paths = Module._nodeModulePaths(repo);
  mod._compile(built.outputFiles[0].text, mod.filename);
  const { Editor, useStore, createProject, setCaret, caretOffset, domLength, domText, WRITING_CLIPBOARD_MIME: MIME, decodeWritingClipboard, runEditHistory } = mod.exports;
  const state = () => useStore.getState();
  const block = id => document.querySelector(`.script-flow .sc-el--editable[data-id="${id}"]`);
  const elements = () => state().project.elements;
  const sync = label => check(label, [...document.querySelectorAll('.script-flow .sc-el--editable')].map(node => [node.dataset.id, node.dataset.type, node.innerHTML]), elements().map(element => [element.id, element.type, element.text]));
  const fixture = () => {
    const p = createProject('合成剪贴板UI验收');
    p.titlePage.show = false;
    p.settings.sceneNumber = 'both';
    p.elements = [
      { id: 'ui-head-first', type: 'scene_heading', text: '内景 合成摄影棚 日' },
      { id: 'ui-character', type: 'character', text: '<b>合成甲</b>', dual: 'left', dualGroup: 'PRIVATE_DUAL_GROUP', rev: 'PRIVATE_REVISION', sceneId: 'PRIVATE_SCENE_ASSOCIATION' },
      { id: 'ui-dialogue', type: 'dialogue', text: '<i>你好</i><br><u>合成世界🙂</u>', dual: 'left', dualGroup: 'PRIVATE_DUAL_GROUP' },
      { id: 'ui-head-second', type: 'scene_heading', text: '外景 合成空地 夜' },
      { id: 'ui-target', type: 'action', text: '前后' },
      { id: 'ui-tail', type: 'general', text: '保留合成尾段' },
    ];
    p.sceneMeta = [
      { id: 'PRIVATE_META_FIRST', elementId: 'ui-head-first', title: '合成卡片标题', synopsis: '合成卡片信息', color: '#abc', x: 10, y: 20 },
      { id: 'PRIVATE_META_SECOND', elementId: 'ui-head-second', title: '', synopsis: '', color: '#def' },
    ];
    p.beats = [{ id: 'PRIVATE_IMAGE_ID', kind: 'image', text: '合成图片批注', img: 'data:image/png;base64,c3ludGhldGlj', color: '#fff', sceneId: 'PRIVATE_META_FIRST', x: 0, y: 0 }];
    p.boardLinks = [{ id: 'PRIVATE_RELATION_ID', from: 'scene:ui-head-first', to: 'beat:PRIVATE_IMAGE_ID', note: '合成关系' }];
    return p;
  };
  mounted = createRoot(document.getElementById('root'));
  await act(async () => mounted.render(React.createElement(Editor)));
  const reset = async (project = fixture()) => {
    await act(async () => {
      document.activeElement?.blur();
      state().loadProject(project);
      useStore.setState({ activeId: 'ui-target', focus: null, writingSelectionMode: false, writingSelectedIds: [], past: [], future: [], view: 'write' });
    });
    check('synthetic Editor fixture is mounted', !!block('ui-target'));
  };
  const select = async (firstId, start, lastId = firstId, end = start) => {
    await act(async () => {
      const first = block(firstId), last = block(lastId);
      first.focus();
      setCaret(first, start);
      const range = w.getSelection().getRangeAt(0).cloneRange();
      setCaret(last, end);
      const finish = w.getSelection().getRangeAt(0);
      range.setEnd(finish.endContainer, finish.endOffset);
      w.getSelection().removeAllRanges(); w.getSelection().addRange(range);
    });
  };
  const sourceSelection = () => select('ui-character', 0, 'ui-dialogue', domLength(block('ui-dialogue')));
  const clipboard = async (type, id, data = new MemoryDataTransfer()) => {
    const event = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: data });
    await act(async () => block(id).dispatchEvent(event));
    return { event, data };
  };
  const savedState = () => ({ project: state().project, serialized: JSON.stringify(state().project), past: state().past, future: state().future, dirty: state().dirty, version: state().version });
  const unchanged = (label, saved) => check(label, [state().project === saved.project, JSON.stringify(state().project) === saved.serialized, state().past === saved.past, state().future === saved.future, state().dirty === saved.dirty, state().version === saved.version], [true, true, true, true, true, true]);
  const routeHistory = direction => act(async () => runEditHistory(direction));

  await reset();
  await sourceSelection();
  const beforeCopy = savedState();
  const copied = await clipboard('copy', 'ui-character');
  check('cross character/dialogue copy prevents native default', copied.event.defaultPrevented);
  check('copy writes only selected plain screenplay', copied.data.getData('text/plain'), '合成甲\n你好\n合成世界🙂');
  check('copy writes an internal typed-format payload', decodeWritingClipboard(copied.data.getData(MIME)), [{ type: 'character', html: '<b>合成甲</b>' }, { type: 'dialogue', html: '<i>你好</i><br><u>合成世界🙂</u>' }]);
  check('external rich copy keeps basic b/i/u/br only from selected nodes', copied.data.getData('text/html'), '<div><b>合成甲</b></div><div><i>你好</i><br><u>合成世界🙂</u></div>');
  unchanged('clean copy does not dirty, version, mutate project or either history stack', beforeCopy);
  const privateTokens = ['ui-character', 'ui-dialogue', 'PRIVATE_DUAL_GROUP', 'PRIVATE_REVISION', 'PRIVATE_SCENE_ASSOCIATION', 'PRIVATE_META_FIRST', 'PRIVATE_META_SECOND', 'PRIVATE_IMAGE_ID', 'PRIVATE_RELATION_ID', 'data:image'];
  check('no clipboard projection includes element IDs, dual metadata, image or relation data', copied.data.types.every(type => privateTokens.every(token => !copied.data.getData(type).includes(token))));
  check('internal schema has no metadata fields', JSON.parse(copied.data.getData(MIME)).fragments.map(item => Object.keys(item)), [['type', 'html'], ['type', 'html']]);

  await act(async () => { state().setText('ui-target', '合成可重做改动'); state().undo(); });
  await sourceSelection();
  const withRedo = savedState();
  check('redo preservation scenario really has pending redo', state().future.length, 1);
  await clipboard('copy', 'ui-character');
  unchanged('copy with pending redo preserves exact redo/past references and dirty/version', withRedo);
  groups++;

  await select('ui-target', 1);
  const beforePaste = clone(state().project), priorPast = state().past.length;
  const pasted = await clipboard('paste', 'ui-target', copied.data);
  check('internal multi-paste prevents native default', pasted.event.defaultPrevented);
  const targetIndex = elements().findIndex(item => item.id === 'ui-target');
  const inserted = elements()[targetIndex + 1];
  check('multi-paste keeps source character/dialogue types and rich text', elements().slice(targetIndex, targetIndex + 2).map(item => [item.type, item.text]), [['character', '前<b>合成甲</b>'], ['dialogue', '<i>你好</i><br><u>合成世界🙂</u>后']]);
  check('multi-paste preserves target ID but gives added paragraph a fresh ID', inserted.id !== 'ui-character' && inserted.id !== 'ui-dialogue' && !beforePaste.elements.some(item => item.id === inserted.id));
  check('new paragraph cannot inherit source dual/revision/scene metadata', Object.keys(inserted).sort(), ['id', 'text', 'type']);
  check('first target does not acquire source dual metadata', [elements()[targetIndex].dual, elements()[targetIndex].dualGroup], [undefined, undefined]);
  check('multi-paste is one transaction and clears redo', [state().past.length, state().future.length], [priorPast + 1, 0]);
  check('multi-paste preserves existing scene metadata/materials/relations', [state().project.sceneMeta, state().project.beats, state().project.boardLinks], [beforePaste.sceneMeta, beforePaste.beats, beforePaste.boardLinks]);
  check('multi-paste restores focus/caret before untouched suffix', [document.activeElement?.dataset.id, caretOffset(block(inserted.id))], [inserted.id, 9]);
  sync('multi-paste live Editor DOM equals model IDs/types/rich content');
  const afterPaste = clone(state().project);
  await routeHistory('undo');
  check('one routed undo restores exact pre-paste project', state().project, beforePaste);
  await routeHistory('redo');
  check('one routed redo restores exact IDs/types/format after paste', state().project, afterPaste);
  sync('multi-paste routed redo synchronizes live DOM');
  groups++;

  await reset();
  await select('ui-dialogue', 0, 'ui-dialogue', domLength(block('ui-dialogue')));
  const one = await clipboard('copy', 'ui-dialogue');
  await select('ui-target', 0, 'ui-target', 2);
  await clipboard('paste', 'ui-target', one.data);
  check('single fragment keeps target action type and ID', [elements().find(item => item.id === 'ui-target').type, elements().length], ['action', 6]);
  check('single fragment preserves italic/underline/BR in model and DOM', [elements().find(item => item.id === 'ui-target').text, block('ui-target').innerHTML], ['<i>你好</i><br><u>合成世界🙂</u>', '<i>你好</i><br><u>合成世界🙂</u>']);
  check('single fragment focus/caret counts emoji and BR exactly', [document.activeElement?.dataset.id, caretOffset(block('ui-target'))], ['ui-target', 9]);
  check('single rich paste also creates only one history transaction', state().past.length, 1);
  await reset();
  await select('ui-character', 0, 'ui-character', domLength(block('ui-character')));
  const bold = await clipboard('copy', 'ui-character');
  await select('ui-target', 0, 'ui-target', 2);
  await clipboard('paste', 'ui-target', bold.data);
  check('single bold character copy retains formatting without changing target type', [elements().find(item => item.id === 'ui-target').type, block('ui-target').innerHTML], ['action', '<b>合成甲</b>']);
  groups++;

  await reset();
  await sourceSelection();
  const beforeCut = clone(state().project);
  const cut = await clipboard('cut', 'ui-character');
  check('cross-paragraph cut prevents default and exports the same typed fragments', [cut.event.defaultPrevented, cut.data.getData(MIME)], [true, copied.data.getData(MIME)]);
  // DOM Range keeps balanced empty formatting wrappers at the two boundaries.
  // They contain no selected characters and must survive an exact history replay.
  check('cut joins selected boundaries only once, retaining empty rich boundary shells', elements().map(item => [item.id, item.text]), beforeCut.elements.filter(item => item.id !== 'ui-dialogue').map(item => [item.id, item.id === 'ui-character' ? '<b></b><u></u>' : item.text]));
  check('cut leaves no selected visible characters in the retained source', domText(block('ui-character')), '');
  check('cut is one project transaction', state().past.length, 1);
  const afterCut = clone(state().project);
  await select('ui-target', 1);
  await clipboard('paste', 'ui-target', cut.data);
  const afterCutPaste = clone(state().project);
  check('cut then paste are two independent project transactions', state().past.length, 2);
  await routeHistory('undo');
  check('first undo removes only paste, keeping prior cut', state().project, afterCut);
  await routeHistory('undo');
  check('second undo restores original cut source exactly', state().project, beforeCut);
  await routeHistory('redo');
  check('first redo reapplies cut only', state().project, afterCut);
  await routeHistory('redo');
  check('second redo reapplies exact paste including stable fresh IDs', state().project, afterCutPaste);
  sync('cut/paste two undos/two redos keep rendered DOM synchronized');
  groups++;

  const literal = '<b>literal</b>&🙂\r\n内景 不自动拆段 日';
  const normalized = literal.replace(/\r\n?/g, '\n');
  for (const bad of ['{broken', JSON.stringify({ version: 2, fragments: [{ type: 'dialogue', html: '不能使用' }] }), JSON.stringify({ version: 1, fragments: [{ type: 'unknown', html: '不能使用' }] })]) {
    await reset();
    await select('ui-target', 0, 'ui-target', 2);
    const data = new MemoryDataTransfer([[MIME, bad], ['text/plain', literal], ['text/html', '<img src="https://unsafe.invalid/"><script>bad()</script>']]);
    const fallback = await clipboard('paste', 'ui-target', data);
    check('invalid internal payload falls back to literal plain event policy', fallback.event.defaultPrevented);
    check('plain fallback keeps literal < > & emoji and multiline text', domText(block('ui-target')), normalized);
    check('plain fallback neither parses heading nor creates extra elements', [elements().find(item => item.id === 'ui-target').type, elements().length], ['action', 6]);
    check('plain fallback does not interpret supplied HTML or literal tags', block('ui-target').querySelectorAll('b,img,script').length, 0);
    check('plain fallback is one transaction', state().past.length, 1);
  }
  await reset();
  await select('ui-target', 0, 'ui-target', 2);
  const emptyBefore = savedState();
  const empty = await clipboard('paste', 'ui-target', new MemoryDataTransfer([[MIME, '{broken'], ['text/html', '<b>not plain</b>']]));
  check('invalid payload with no plain text still blocks arbitrary default HTML', empty.event.defaultPrevented);
  unchanged('empty plain fallback does not remove selection or create history', emptyBefore);
  groups++;

  await reset();
  await select('ui-target', 0, 'ui-target', 2);
  const dirtyHtml = '<b onclick="window.clipboardBad=true" style="color:red">粗</b><i id="PRIVATE_HTML_ID">斜</i><u data-id="PRIVATE_HTML_ID">下</u><script>window.clipboardBad=true</script><style>body{display:none}</style><img src="https://unsafe.invalid/img" onerror="window.clipboardBad=true"><a href="javascript:bad()">链接文字</a><!--PRIVATE_COMMENT-->';
  const malicious = new MemoryDataTransfer([[MIME, JSON.stringify({ version: 1, fragments: [{ type: 'dialogue', html: dirtyHtml, id: 'PRIVATE_PAYLOAD_ID', dual: 'right', dualGroup: 'PRIVATE_PAYLOAD_GROUP', img: 'PRIVATE_PAYLOAD_IMAGE', boardLinks: ['PRIVATE_PAYLOAD_RELATION'] }] })], ['text/plain', 'plain must not supersede a valid typed payload']]);
  await clipboard('paste', 'ui-target', malicious);
  check('valid internal HTML is sanitized before becoming project text', elements().find(item => item.id === 'ui-target').text, '<b>粗</b><i>斜</i><u>下</u>链接文字');
  check('malicious scripts/styles/images/links never become clipboard target DOM nodes', block('ui-target').querySelectorAll('script,style,img,a').length, 0);
  check('pasted allowed format nodes cannot carry attributes', [...block('ui-target').querySelectorAll('*')].every(node => ['B', 'I', 'U'].includes(node.tagName) && node.attributes.length === 0));
  check('forged metadata does not enter target element', Object.keys(elements().find(item => item.id === 'ui-target')).sort(), ['id', 'text', 'type']);
  check('sanitized single-fragment source type does not override target', elements().find(item => item.id === 'ui-target').type, 'action');
  sync('sanitized rich paste live DOM equals safe model');
  groups++;

  await reset();
  await act(async () => {
    block('ui-head-first').focus();
    const range = document.createRange(); range.selectNodeContents(document.querySelector('.script-flow'));
    w.getSelection().removeAllRanges(); w.getSelection().addRange(range);
  });
  const wholeBefore = savedState();
  const whole = await clipboard('copy', 'ui-head-first');
  check('whole-selection fixture really renders scene number wrappers', document.querySelectorAll('.script-flow .sc-scene-no').length, 4);
  check('whole screenplay copy excludes all scene-number digits', /[0-9]/.test(whole.data.getData('text/plain')), false);
  check('whole typed copy includes each screenplay element once, without helper wrappers', decodeWritingClipboard(whole.data.getData(MIME)).map(item => [item.type, item.html]), elements().map(item => [item.type, item.text]));
  check('whole rich copy excludes scene UI class/attributes and image cards', /sc-scene|data-id|data-type|PRIVATE_|<img/i.test(whole.data.getData('text/html')), false);
  unchanged('whole-selection copy does not mutate project or histories', wholeBefore);
  groups++;

  const entered = fixture();
  entered.elements = [{ id: 'ui-target', type: 'action', text: '<b>甲乙</b><i>丙丁</i>' }, { id: 'ui-tail', type: 'general', text: '合成尾段' }];
  entered.sceneMeta = []; entered.beats = []; entered.boardLinks = [];
  await reset(entered);
  await select('ui-target', 2);
  const beforeEnter = clone(state().project);
  const enter = new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await act(async () => block('ui-target').dispatchEvent(enter));
  const enteredId = elements()[1].id, afterEnter = clone(state().project);
  check('Enter prevents native insertion and splits rich text once', [enter.defaultPrevented, elements().map(item => item.text)], [true, ['<b>甲乙</b>', '<b></b><i>丙丁</i>', '合成尾段']]);
  check('Enter focuses its newly-created paragraph at start', [document.activeElement?.dataset.id, caretOffset(block(enteredId))], [enteredId, 0]);
  check('Enter creates one history transaction', state().past.length, 1);
  await select(enteredId, 1);
  await routeHistory('undo');
  check('routed Enter undo restores exact original project', state().project, beforeEnter);
  check('undo of removed focused paragraph restores surviving writing focus', document.activeElement?.dataset.id, 'ui-target');
  await select('ui-target', 2);
  await routeHistory('redo');
  check('routed Enter redo restores exact new paragraph ID and HTML', state().project, afterEnter);
  check('redo Enter restores new paragraph bookmark rather than original paragraph/body', [document.activeElement?.dataset.id, caretOffset(block(enteredId)), state().focus.id, state().focus.caret], [enteredId, 1, enteredId, 1]);
  await routeHistory('undo');
  check('repeated undo restores original paragraph bookmark', [document.activeElement?.dataset.id, caretOffset(block('ui-target'))], ['ui-target', 2]);
  await routeHistory('redo');
  check('repeated redo retains restored paragraph/caret bookmark', [document.activeElement?.dataset.id, caretOffset(block(enteredId))], [enteredId, 1]);
  sync('Enter history bookmark roundtrip keeps DOM synchronized');
  await act(async () => {
    const node = block(enteredId);
    node.innerHTML = '<i>丙补丁</i>'; setCaret(node, 2);
    node.dispatchEvent(new w.InputEvent('input', { inputType: 'insertText', bubbles: true }));
  });
  check('typing after Enter redo changes restored new paragraph only', elements().map(item => item.text), ['<b>甲乙</b>', '<i>丙补丁</i>', '合成尾段']);
  check('typing after redo is separate from original Enter transaction', state().past.length, 2);
  await routeHistory('undo');
  check('undo after redo typing removes typing only, leaving Enter structure', state().project, afterEnter);
  groups++;

  check('React and window report no integration runtime errors', errors, []);
  console.log(`clipboard UI: ${checks} checks in ${groups} groups passed (real Editor/store, in-memory ClipboardEvent/DataTransfer only; native OS clipboard, Chromium default editing, visual geometry and IME still require separate validation)`);
})().catch(error => { originalError(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (mounted) await act(async () => mounted.unmount());
  console.error = originalError;
  dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});
