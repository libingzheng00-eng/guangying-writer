/** Smart double-quote regression: synthetic text and jsdom only.
 * Actual input/default edits, OS clipboard and Chinese IME are not simulated
 * accurately by jsdom; this suite verifies transformation/event routing/state.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://smartquotes-test.invalid/', pretendToBeVisual: true });
const w = dom.window;
for (const key of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'NodeFilter', 'Element', 'Event', 'InputEvent', 'MouseEvent', 'KeyboardEvent', 'CompositionEvent', 'DOMParser', 'Range', 'Selection', 'getComputedStyle', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
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
function normalized(html) { const template = document.createElement('template'); template.innerHTML = html; return template.innerHTML; }
let root;
(async () => {
  const built = await esbuild.build({ stdin: { contents: `
    export { applySmartDoubleQuotes } from './src/utils/smartQuotes';
    export { Editor } from './src/components/Editor';
    export { useStore } from './src/store/store';
    export { createProject } from './src/model/project';
    export { runEditHistory } from './src/utils/editHistory';
    export * from './src/utils/dom';
  `, resolveDir: repo, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.png': 'dataurl', '.css': 'empty' }, logLevel: 'silent' });
  const bundle = new Module(path.join(repo, '.smartquotes-test-memory.cjs'), module);
  bundle.filename = path.join(repo, '.smartquotes-test-memory.cjs');
  bundle.paths = Module._nodeModulePaths(repo);
  bundle._compile(built.outputFiles[0].text, bundle.filename);
  const { applySmartDoubleQuotes: apply, Editor, useStore, createProject, runEditHistory, setCaret, caretOffset, makeTextRange, domText } = bundle.exports;
  const cases = [
    ['whole odd-length quote', '', '"ABC"', { data: '"ABC"', caret: 5 }, '“ABC”'],
    ['whole even-length quote', '', '"AB"', { data: '"AB"', caret: 4 }, '“AB”'],
    ['empty quoted text', '', '""', { data: '""', caret: 2 }, '“”'],
    ['Chinese quote pair', '', '他说："你好"。', { data: '他说："你好"。', caret: 8 }, '他说：“你好”。'],
    ['existing opener guides typed closer', '“ABC', '“ABC"', { data: '"', caret: 5 }, '“ABC”'],
    ['closing quote immediately before Chinese word', '他说：“ABC的意思', '他说：“ABC"的意思', { data: '"', caret: 8 }, '他说：“ABC”的意思'],
    ['closing quote immediately before English word', '“ABCword', '“ABC"word', { data: '"', caret: 5 }, '“ABC”word'],
    ['old straight opener guides new closer without being changed', '"ABC', '"ABC"', { data: '"', caret: 5 }, '"ABC”'],
    ['existing straight pair remains while normal text is inserted', '"ABC"', '"ABC"x', { data: 'x', caret: 6 }, '"ABC"x'],
    ['existing manual curly and corner quotes remain', '“旧”「旧」', '“旧”「旧」"新"', { data: '"新"', caret: 9 }, '“旧”「旧」"新"'],
    ['explicit colon starts new opener', '他说：尾段', '他说："尾段', { data: '"', caret: 4 }, '他说：“尾段'],
    ['embedded literal remains ambiguous', 'foobar', 'foo"bar', { data: '"', caret: 4 }, 'foo"bar'],
    ['isolated measurement remains literal', '尺寸6', '尺寸6"', { data: '"', caret: 4 }, '尺寸6"'],
    ['explicit quoted number closes', '“123', '“123"', { data: '"', caret: 5 }, '“123”'],
    ['escaped ASCII quotes remain', '\\ABC', '\\"ABC', { data: '"', caret: 2 }, '\\"ABC'],
    ['emoji offsets remain UTF16', '😀：', '😀："', { data: '"', caret: 4 }, '😀：“'],
    ['BR contributes one offset', '旧<br>：尾段', '旧<br>："尾段', { data: '"', caret: 4 }, '旧<br>：“尾段'],
    ['inline markup length never affects direction', '<b>“ABC</b>', '<b>“ABC"</b>', { data: '"', caret: 5 }, '<b>“ABC”</b>'],
    ['selection replacement uses only inserted range', '甲旧乙', '甲："新"乙', { data: '："新"', caret: 5, selection: { start: 1, end: 2 } }, '甲：“新”乙'],
    ['unidentified input data does nothing', '“ABC', '“ABC"', { data: null, caret: 5 }, '“ABC"'],
    ['empty data does nothing', '“ABC', '“ABC"', { data: '', caret: 5 }, '“ABC"'],
    ['mismatched input data cannot rewrite old text', '“ABC', '“ABC"', { data: '"wrong', caret: 5 }, '“ABC"'],
    ['invalid negative caret does nothing', '“ABC', '“ABC"', { data: '"', caret: -1 }, '“ABC"'],
    ['stale prefix cannot rewrite current text', 'old', 'new"', { data: '"', caret: 4 }, 'new"'],
    ['stale suffix cannot rewrite current text', '：old', '："new', { data: '"', caret: 2 }, '："new'],
    ['attributes with quotes remain text-free context', '<b title="literal &quot;old&quot;">：</b>', '<b title="literal &quot;old&quot;">："</b>', { data: '"', caret: 2 }, '<b title="literal &quot;old&quot;">：“</b>'],
  ];
  for (const [label, previous, next, insertion, expected] of cases) {
    check(`helper: ${label}`, normalized(apply(previous, next, insertion)), normalized(expected));
  }
  // A known unmatched opener makes this a closer even when the quotation
  // itself ends in punctuation that otherwise introduces a new quotation.
  for (const punctuation of [':', '：', '(', '（', '—', '–']) {
    const previous = `“ABC${punctuation}`;
    check(`helper: open quotation closes after ${punctuation}`, apply(previous, `${previous}"`, { data: '"', caret: previous.length + 1 }), `${previous}”`);
    const legacy = `"ABC${punctuation}`;
    check(`helper: legacy opener remains literal while closing after ${punctuation}`, apply(legacy, `${legacy}"`, { data: '"', caret: legacy.length + 1 }), `${legacy}”`);
  }
  const richNext = '<b title="keep &quot;attribute&quot;" data-review="literal">：“ABC"</b><i>尾段</i>';
  const richResult = apply('<b title="keep &quot;attribute&quot;" data-review="literal">：“ABC</b><i>尾段</i>', richNext, { data: '"', caret: 6 });
  const richTemplate = document.createElement('template'); richTemplate.innerHTML = richResult;
  check('helper preserves every attribute value', [...richTemplate.content.querySelector('b').attributes].map(a => [a.name, a.value]), [['title', 'keep "attribute"'], ['data-review', 'literal']]);
  check('helper preserves both rich formatting nodes', [richTemplate.content.querySelector('b').textContent, richTemplate.content.querySelector('i').textContent], ['：“ABC”', '尾段']);

  const state = () => useStore.getState();
  const block = () => document.querySelector('.script-flow .sc-el--editable[data-id="quote-edit"]');
  const current = () => state().project.elements.find(e => e.id === 'quote-edit');
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Editor)));
  async function reset(html = '', type = 'dialogue', smartQuotes = true) {
    await act(async () => document.activeElement?.blur());
    const p = createProject('合成智能引号验收');
    p.titlePage.show = false;
    p.settings.smartQuotes = smartQuotes;
    p.elements = [{ id: 'quote-edit', type, text: html }, { id: 'quote-keep', type: 'action', text: '不得改动的合成尾段。' }];
    await act(async () => { state().loadProject(p); useStore.setState({ focus: null, past: [], future: [], activeId: 'quote-edit' }); });
    block().tabIndex = 0;
    await act(async () => { block().focus(); setCaret(block(), 'end'); });
  }
  const sync = label => check(label, block().innerHTML, current().text);
  async function insert(text, options = {}) {
    const node = block();
    let inserted;
    await act(async () => {
      if (options.start !== undefined) {
        const selection = w.getSelection(); selection.removeAllRanges(); selection.addRange(makeTextRange(node, options.start, options.end ?? options.start));
      }
      const selection = w.getSelection(), range = selection.getRangeAt(0);
      range.deleteContents();
      inserted = document.createTextNode(text); range.insertNode(inserted);
      range.setStart(inserted, inserted.data.length); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
      node.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: options.inputType || 'insertText', data: options.data === undefined ? text : options.data, isComposing: !!options.isComposing }));
    });
    return inserted;
  }
  async function history(direction) { await act(async () => runEditHistory(direction)); }

  await reset();
  const firstVersion = state().version;
  await insert('"'); await insert('ABC'); await insert('"');
  check('UI typed pair uses contextual opening and closing', domText(block()), '“ABC”');
  check('UI typed pair commits one state version per input', state().version - firstVersion, 3);
  check('UI quote transformation is not an extra undo transaction', state().past.length, 1);
  check('UI caret stays behind closing quote', caretOffset(block()), 5);
  sync('UI DOM/model match after quotes');
  await history('undo'); check('UI single undo restores pre-typing text', current().text, ''); sync('UI undo updates focused DOM');
  await history('redo'); check('UI redo restores transformed pair', domText(block()), '“ABC”'); sync('UI redo updates focused DOM');

  await reset('他说：“ABC的意思');
  await insert('"', { start: 7 });
  check('UI partial caret creates closing quote before Chinese suffix', domText(block()), '他说：“ABC”的意思');
  check('UI partial caret preserves exact UTF16 position', caretOffset(block()), 8);
  check('UI partial insertion does not change another paragraph', state().project.elements[1].text, '不得改动的合成尾段。');
  await history('undo'); check('UI partial insertion undo leaves original suffix', domText(block()), '他说：“ABC的意思');
  await history('redo'); check('UI partial insertion redo stays exact', domText(block()), '他说：“ABC”的意思');

  for (const punctuation of [':', '：', '(', '（', '—', '–']) {
    await reset();
    await insert('"'); await insert(`ABC${punctuation}`); await insert('"');
    check(`UI sequential typing closes after ${punctuation}`, domText(block()), `“ABC${punctuation}”`);
    check(`UI sequential closing after ${punctuation} stays same transaction`, state().past.length, 1);
    check(`UI sequential closing after ${punctuation} preserves caret`, caretOffset(block()), 6);
    await history('undo'); check(`UI sequential quotation ending ${punctuation} is fully undoable`, domText(block()), '');
    await history('redo'); check(`UI sequential quotation ending ${punctuation} is fully redoable`, domText(block()), `“ABC${punctuation}”`);
  }

  await reset('<b title="keep &quot;attribute&quot;">😀：“ABC</b><i>尾段</i>');
  await insert('"', { start: 7 });
  check('UI nested formatting closes quote without rewriting suffix', domText(block()), '😀：“ABC”尾段');
  check('UI rich insertion retains attribute punctuation', block().querySelector('b').getAttribute('title'), 'keep "attribute"');
  check('UI rich insertion retains both formatting nodes', [block().querySelector('b')?.textContent, block().querySelector('i')?.textContent], ['😀：“ABC”', '尾段']);
  check('UI rich caret respects surrogate pair UTF16 length', caretOffset(block()), 8);
  sync('UI rich DOM/model match');

  await reset('：旧尾段');
  await insert('"新"', { start: 1, end: 2 });
  check('UI selected replacement transforms only inserted quote pair', domText(block()), '：“新”尾段');
  await history('undo'); check('UI selected replacement undo restores original once', domText(block()), '：旧尾段');

  for (const type of ['action', 'character', 'parenthetical', 'transition', 'shot', 'scene_heading', 'general', 'note']) {
    await reset('原文：', type);
    await insert('"ABC"');
    check(`UI ${type} never applies dialogue-only smart quotes`, domText(block()), '原文："ABC"');
  }
  await reset('原文：', 'dialogue', false); await insert('"ABC"');
  check('UI disabled setting preserves straight quotes', domText(block()), '原文："ABC"');

  for (const inputType of ['insertFromPaste', 'insertReplacementText', 'formatBold', 'deleteContentBackward', 'historyUndo', 'historyRedo']) {
    await reset('“ABC'); await insert('"', { inputType });
    check(`UI ${inputType} metadata never transforms existing/new quote`, domText(block()), '“ABC"');
  }
  await reset('“ABC'); await insert('"', { data: null });
  check('UI missing insertion data never guesses a conversion', domText(block()), '“ABC"');

  await reset('"旧" “手写”「角括号」：'); await insert('"新"');
  check('UI existing straight/curly/corner quotes remain byte-identical text', domText(block()), '"旧" “手写”「角括号」：“新”');
  await reset('尺寸6'); await insert('"');
  check('UI ambiguous measurement quote remains literal', domText(block()), '尺寸6"');
  await reset('旧<br>：尾段'); await insert('"', { start: 3 });
  check('UI soft line break does not skew insertion offset', current().text, '旧<br>：“尾段');
  check('UI soft line break caret counts BR once', caretOffset(block()), 4);

  await reset('原文：');
  const pasteData = new Map([['text/plain', '"ABC"']]);
  const paste = new w.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { getData: mime => pasteData.get(mime) || '', setData: (mime, value) => pasteData.set(mime, value) } });
  await act(async () => block().dispatchEvent(paste));
  check('UI actual paste handler prevents native double insertion', paste.defaultPrevented);
  check('UI paste handler preserves copied straight quotes', domText(block()), '原文："ABC"');
  await insert('x'); check('UI typing after paste does not reformat pasted quotes', domText(block()), '原文："ABC"x');

  await reset('前文：');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true })));
  const composingNode = await insert('"ABC"', { isComposing: true, inputType: 'insertCompositionText' });
  check('UI active composition keeps ASCII quotes untouched', domText(block()), '前文："ABC"');
  check('UI active composition does not rebuild composing text node', block().contains(composingNode));
  sync('UI composition interim synchronizes raw text only');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true, data: '"ABC"' })));
  check('UI composition completion transforms only committed insertion', domText(block()), '前文：“ABC”');
  check('UI composition completion is same transaction as provisional text', state().past.length, 1);
  check('UI composition completion preserves caret', caretOffset(block()), 8);
  await history('undo'); check('UI composition undo restores original once', domText(block()), '前文：');
  await history('redo'); check('UI composition redo restores final transformed text', domText(block()), '前文：“ABC”');

  await reset('"旧"：');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true })));
  await insert('汉字', { isComposing: true, inputType: 'insertCompositionText' });
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true, data: '汉字' })));
  check('UI composition without new ASCII quote never reprocesses old quotes', domText(block()), '"旧"：汉字');

  await reset('前文：');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true })));
  await insert('"', { isComposing: false });
  check('UI composingRef guards input even when isComposing metadata is false', domText(block()), '前文："');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true, data: '' })));
  check('UI unknown/canceled composition does not guess conversion', domText(block()), '前文："');

  await reset('前文：'); await insert('"', { isComposing: true });
  check('UI isComposing metadata alone guards composition conversion', domText(block()), '前文："');

  await reset('前文：旧尾段');
  await act(async () => {
    const selection = w.getSelection(); selection.removeAllRanges(); selection.addRange(makeTextRange(block(), 3, 4));
    block().dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true }));
  });
  await insert('"新"', { isComposing: true, inputType: 'insertCompositionText' });
  check('UI selected composition keeps provisional quote range literal', domText(block()), '前文："新"尾段');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true, data: '"新"' })));
  check('UI selected composition uses original replacement range', domText(block()), '前文：“新”尾段');
  check('UI selected composition preserves caret before untouched suffix', caretOffset(block()), 6);
  check('UI selected composition is one atomic undo transaction', state().past.length, 1);
  await history('undo'); check('UI selected composition undo restores replaced character', domText(block()), '前文：旧尾段');
  await history('redo'); check('UI selected composition redo restores only inserted text', domText(block()), '前文：“新”尾段');

  await reset('前文：');
  await insert('普通字');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true })));
  await insert(' "ABC"', { isComposing: true, inputType: 'insertCompositionText' });
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true, data: ' "ABC"' })));
  check('UI IME start creates boundary after earlier regular typing', state().past.length, 2);
  await history('undo'); check('UI IME undo does not remove previous regular typing', domText(block()), '前文：普通字');
  await history('undo'); check('UI second undo reaches original before regular typing', domText(block()), '前文：');
  await history('redo'); await history('redo');
  check('UI multi-step redo preserves composition final quotes', domText(block()), '前文：普通字 “ABC”');

  await reset('前文：');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true })));
  await insert('"', { isComposing: true, inputType: 'insertCompositionText' });
  await act(async () => state().mutate(project => { project.settings.smartQuotes = false; }));
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true, data: '"' })));
  check('UI composition completion respects latest disabled setting', domText(block()), '前文："');

  await reset('前文：');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true })));
  await insert('"', { isComposing: true, inputType: 'insertCompositionText' });
  const oldEpoch = state().documentEpoch;
  const nextDocument = createProject('另一合成文档'); nextDocument.titlePage.show = false;
  nextDocument.elements = [{ id: 'quote-edit', type: 'dialogue', text: '另一文档："保留"' }];
  await act(async () => state().loadProject(nextDocument));
  block().tabIndex = 0;
  await act(async () => { block().focus(); setCaret(block(), 'end'); });
  const newVersion = state().version, newPast = state().past;
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true, data: '"' })));
  check('UI composition snapshot identifies document epoch', state().documentEpoch > oldEpoch);
  check('UI stale composition completion leaves new document quotes alone', domText(block()), '另一文档："保留"');
  check('UI stale composition completion does not create a new document edit', [state().version, state().past], [newVersion, newPast]);

  await reset('原文：'); await insert('“手写”');
  check('UI explicitly typed curly quotes stay exactly as entered', domText(block()), '原文：“手写”');
  await reset('原文：'); await insert("don't 'single' 「角括号」");
  check('UI single quotes, apostrophe and corner quotes are out of scope', domText(block()), "原文：don't 'single' 「角括号」");
  check('UI quote behavior leaves scene/card/link structures unchanged', [state().project.sceneMeta.length, state().project.beats.length, state().project.boardLinks.length], [0, 0, 0]);
  await act(async () => root.unmount());
  console.log(JSON.stringify({ assertions, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
