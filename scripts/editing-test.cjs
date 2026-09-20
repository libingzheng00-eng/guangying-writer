/** Focused editor regression: split / cut / paste / history / DOM offsets.
 * Synthetic data only; in-memory bundle and jsdom localStorage never read user data.
 * jsdom cannot perform native clipboard/default editing: those are explicitly simulated
 * below; actual Chromium input and menu IPC belong in editing-electron.cjs.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://editing-test.invalid/', pretendToBeVisual: true });
const w = dom.window;
for (const key of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'NodeFilter', 'Element', 'Event', 'InputEvent', 'MouseEvent', 'KeyboardEvent', 'DOMParser', 'Range', 'Selection', 'getComputedStyle', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: w[key] });
}
globalThis.window = w;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.HTMLElement.prototype.scrollIntoView = function () {};
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const failures = [];
let assertions = 0;
function check(label, actual, expected = true) {
  assertions++;
  try { assert.deepEqual(actual, expected); console.log(`PASS ${label}`); }
  catch { failures.push({ label, actual, expected }); console.error(`FAIL ${label}: ${JSON.stringify({ actual, expected })}`); }
}
let root;
(async () => {
  const built = await esbuild.build({ stdin: { contents: `
    export { Editor } from './src/components/Editor';
    export { useStore } from './src/store/store';
    export { createProject } from './src/model/project';
    export * from './src/utils/dom';
  `, resolveDir: repo, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.png': 'dataurl', '.css': 'empty' }, logLevel: 'silent' });
  const bundle = new Module(path.join(repo, '.editing-test-memory.cjs'), module);
  bundle.filename = path.join(repo, '.editing-test-memory.cjs');
  bundle.paths = Module._nodeModulePaths(repo);
  bundle._compile(built.outputFiles[0].text, bundle.filename);
  const { Editor, useStore, createProject, setCaret, caretOffset, domLength, offsetOf, splitHtml } = bundle.exports;
  const state = () => useStore.getState();
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Editor)));
  const block = id => document.querySelector(`.script-flow [data-id="${id}"]`);
  const texts = () => state().project.elements.map(e => e.text);
  const domTexts = () => [...document.querySelectorAll('.script-flow .sc-el')].map(e => e.innerHTML);
  const reset = async (html, extras = []) => {
    await act(async () => document.activeElement?.blur());
    const p = createProject('合成编辑验收');
    p.titlePage.show = false;
    p.elements = [{ id: 'editing-a', type: 'action', text: html }, ...extras, { id: 'editing-b', type: 'action', text: '保留的第二段。' }];
    await act(async () => { state().loadProject(p); useStore.setState({ focus: null, past: [], future: [], activeId: 'editing-a' }); });
    // jsdom does not implement contenteditable's native focusability; tabindex is
    // a test-only accommodation, not a production behavior alteration.
    for (const n of document.querySelectorAll('.script-flow [contenteditable]')) n.tabIndex = 0;
    await act(async () => { block('editing-a').focus(); setCaret(block('editing-a'), 'end'); });
    check('fixture is actually focused', document.activeElement, block('editing-a'));
  };
  const dispatch = async event => act(async () => block('editing-a').dispatchEvent(event));
  const sync = label => check(label, domTexts(), texts());
  const select = async (start, end, endId = 'editing-a') => act(async () => {
    block('editing-a').focus(); setCaret(block('editing-a'), start);
    const begin = w.getSelection().getRangeAt(0).cloneRange();
    setCaret(block(endId), end);
    const finish = w.getSelection().getRangeAt(0);
    begin.setEnd(finish.endContainer, finish.endOffset);
    w.getSelection().removeAllRanges(); w.getSelection().addRange(begin);
  });
  let lastClipboardHtml = '';
  const clipboard = async (type, text = '') => {
    const data = new Map([['text/plain', text]]);
    const event = new w.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      getData: mime => data.get(mime) || '', setData: (mime, value) => data.set(mime, value),
    } });
    await dispatch(event);
    lastClipboardHtml = data.get('text/html') || '';
    return { prevented: event.defaultPrevented, text: data.get('text/plain') };
  };
  const typeHtml = async html => act(async () => {
    block('editing-a').innerHTML = html;
    setCaret(block('editing-a'), 'end');
    block('editing-a').dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  });
  // Minimal browser insertHTML implementation: only the actual selection is replaced.
  // It emits input so Editor sees the same event shape as native cut/paste.
  document.execCommand = (command, _ui, html) => {
    if (command !== 'insertHTML') return false;
    const selection = w.getSelection(); const range = selection.getRangeAt(0);
    range.deleteContents();
    const fragment = range.createContextualFragment(html); const last = fragment.lastChild;
    range.insertNode(fragment);
    if (last) { range.setStartAfter(last); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); }
    document.activeElement.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    return true;
  };

  await reset('前半段后半段');
  await act(async () => setCaret(block('editing-a'), 3));
  const enter = new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await dispatch(enter);
  check('Enter browser default prevented', enter.defaultPrevented);
  check('Enter splits model once without duplicate suffix', texts(), ['前半段', '后半段', '保留的第二段。']);
  sync('Enter updates focused source DOM, suffix appears exactly once');
  check('Enter is one undo transaction', state().past.length, 1);
  await act(async () => state().undo());
  check('one undo restores complete original paragraph', texts(), ['前半段后半段', '保留的第二段。']);
  sync('split undo DOM matches model');
  await act(async () => state().redo());
  check('one redo restores exact split', texts(), ['前半段', '后半段', '保留的第二段。']);
  sync('split redo DOM matches model');

  await reset('前半段后半段');
  await act(async () => {
    const node = block('editing-a');
    node.innerHTML = '前半段';
    node.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'deleteByCut' }));
  });
  check('cut input updates model', texts()[0], '前半段');
  await act(async () => state().undo());
  sync('cut undo redraws focused paragraph');
  check('cut undo restores original text', texts()[0], '前半段后半段');
  await act(async () => state().redo());
  sync('cut redo redraws focused paragraph');

  await reset('甲乙');
  await act(async () => setCaret(block('editing-a'), 1));
  const paste = new w.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { getData: type => type === 'text/plain' ? '合成\n粘贴' : '' } });
  await dispatch(paste);
  check('paste prevents default duplicate insertion', paste.defaultPrevented);
  check('paste retains multiline break at caret', texts()[0], '甲合成<br>粘贴乙');
  sync('paste DOM matches model');
  check('paste produces one history entry', state().past.length, 1);
  await act(async () => state().undo());
  check('paste undo restores original', texts()[0], '甲乙');
  sync('paste undo redraws focused paragraph');
  await act(async () => state().redo());
  sync('paste redo redraws focused paragraph');

  await reset('前半段后半段'); await select(3, 6);
  const copied = await clipboard('copy');
  check('copy writes selected text only', copied, { prevented: true, text: '后半段' });
  check('copy creates no history or model edits', [state().past.length, texts()[0]], [0, '前半段后半段']);
  const cut = await clipboard('cut');
  check('cut handler writes selected clipboard text', cut, { prevented: true, text: '后半段' });
  check('cut handler removes selected range once', texts()[0], '前半段');
  sync('actual cut handler keeps DOM and model synchronized');
  check('cut handler creates one transaction', state().past.length, 1);
  await act(async () => state().undo());
  check('cut handler undo restores complete paragraph', texts()[0], '前半段后半段');
  sync('cut handler undo redraws focused DOM');

  await reset('甲'); await typeHtml('甲输入');
  await select(3, 3); await clipboard('paste', '<尖括号>&\n第二行');
  const pastedMarkup = texts()[0];
  check('literal clipboard brackets and ampersands retained', pastedMarkup, '甲输入&lt;尖括号&gt;&amp;<br>第二行');
  await typeHtml(pastedMarkup + '后续');
  check('typing / paste / typing are three independent history steps', state().past.length, 3);
  await act(async () => state().undo());
  check('first undo removes only post-paste typing', texts()[0], pastedMarkup); sync('first undo DOM synchronized');
  await act(async () => state().undo());
  check('second undo removes only paste', texts()[0], '甲输入'); sync('second undo DOM synchronized');
  await act(async () => state().undo());
  check('third undo removes pre-paste typing', texts()[0], '甲'); sync('third undo DOM synchronized');
  await act(async () => { state().redo(); state().redo(); state().redo(); });
  check('three redos restore exact combined content', texts()[0], pastedMarkup + '后续'); sync('three redo DOM synchronized');

  await reset('首段余文'); await select(2, 3, 'editing-b');
  const across = await clipboard('cut');
  check('cross-paragraph cut clipboard has one newline', across.text, '余文\n保留的');
  check('cross-paragraph cut joins remaining boundaries', texts(), ['首段第二段。']);
  sync('cross-paragraph cut DOM synchronized');
  check('cross-paragraph cut is one transaction', state().past.length, 1);
  await act(async () => state().undo());
  check('cross-paragraph cut undo restores both exact paragraphs', texts(), ['首段余文', '保留的第二段。']);
  sync('cross-paragraph undo DOM synchronized');
  await select(2, 3, 'editing-b'); await clipboard('paste', '替换<文字>&');
  check('cross-paragraph paste replaces selected text atomically', texts(), ['首段替换&lt;文字&gt;&amp;第二段。']);
  sync('cross-paragraph paste DOM synchronized');
  await act(async () => state().undo());
  check('cross-paragraph paste undo restores both paragraphs', texts(), ['首段余文', '保留的第二段。']);
  await select(2, 3, 'editing-b');
  await dispatch(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  check('Enter replaces cross-paragraph selection with one boundary', texts(), ['首段', '第二段。']);
  sync('selected Enter DOM synchronized');
  await act(async () => state().undo());
  check('selected Enter undo restores exact prior document', texts(), ['首段余文', '保留的第二段。']);

  await reset('起始段', [{ id: 'editing-scene', type: 'scene_heading', text: '内景 合成空间 日' }]);
  await act(async () => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector('.script-flow'));
    w.getSelection().removeAllRanges(); w.getSelection().addRange(range);
  });
  const allCopy = await clipboard('copy');
  check('copy across scene-number wrappers includes screenplay only', allCopy.text, '起始段\n内景 合成空间 日\n保留的第二段。');
  check('copy does not include scene number or helper controls', allCopy.text.includes('1'), false);
  check('rich clipboard excludes scene number wrappers and UI controls', lastClipboardHtml, '<div>起始段</div><div>内景 合成空间 日</div><div>保留的第二段。</div>');
  check('whole screenplay copy leaves history clean', state().past.length, 0);

  const entityHTML = '&amp;lt;&amp;#65; &#x1F3AC;<br>&lt;合成&gt;';
  const entityText = '&lt;&#65; 🎬\n<合成>';
  await reset(entityHTML);
  const beforeEntityCopy = { project: JSON.stringify(state().project), dom: domTexts(), past: state().past.length, future: state().future.length };
  await select(0, domLength(block('editing-a')));
  check('copy decodes DOM entities once, preserves literal entities, emoji and BR', await clipboard('copy'), { prevented: true, text: entityText });
  check('entity copy does not mutate project, DOM or either history stack',
    { project: JSON.stringify(state().project), dom: domTexts(), past: state().past.length, future: state().future.length }, beforeEntityCopy);
  check('cut has identical literal/entity/emoji/BR clipboard text', await clipboard('cut'), { prevented: true, text: entityText });
  check('entity cut removes selected contents exactly once', texts(), ['', '保留的第二段。']);
  sync('entity cut synchronizes focused DOM');
  check('entity cut is one undo transaction', state().past.length, 1);
  await act(async () => state().undo());
  check('entity cut undo restores original serialized HTML without double decode', texts()[0], entityHTML);
  check('entity cut undo restores original DOM projection', domTexts(), beforeEntityCopy.dom);
  await select(0, domLength(block('editing-a')));
  const entityFuture = state().future.length;
  await clipboard('copy');
  check('copy after undo leaves redo available', state().future.length, entityFuture);
  await act(async () => state().redo());
  check('redo after copy reapplies cut', texts()[0], '');

  const rich = document.createElement('div');
  rich.innerHTML = '<b>甲乙</b><br><i>丙丁</i>戊';
  document.body.appendChild(rich);
  check('DOM length counts rich text and BR', domLength(rich), 6);
  for (let i = 0; i <= 6; i++) { setCaret(rich, i); check(`caret roundtrip ${i}`, caretOffset(rich), i); }
  check('parent boundary before nested first child', offsetOf(rich, rich, 0), 0);
  check('parent boundary before BR', offsetOf(rich, rich, 1), 2);
  check('parent boundary after BR before nested child', offsetOf(rich, rich, 2), 3);
  check('parent boundary after nested child', offsetOf(rich, rich, 3), 5);
  const halves = splitHtml(rich, 4);
  check('rich split preserves tags before', halves.before, '<b>甲乙</b><br><i>丙</i>');
  check('rich split preserves tags after', halves.after, '<i>丁</i>戊');
  await reset('<b>甲乙</b><br><i>丙丁</i>戊');
  await select(0, domLength(block('editing-a')));
  await clipboard('copy');
  check('rich clipboard retains bold, italic and BR markup', lastClipboardHtml, '<div><b>甲乙</b><br><i>丙丁</i>戊</div>');
  await act(async () => setCaret(block('editing-a'), 4));
  await dispatch(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  check('real Editor Enter respects rich text + BR offset', texts().slice(0, 2), [halves.before, halves.after]);
  sync('rich split source DOM synchronized');
  await act(async () => state().undo());
  check('rich split one undo preserves exact original markup', texts()[0], '<b>甲乙</b><br><i>丙丁</i>戊');
  sync('rich split undo DOM synchronized');
  await act(async () => root.unmount()); root = null;
  console.log(JSON.stringify({ assertions, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (root) await act(async () => root.unmount());
  w.close();
});
