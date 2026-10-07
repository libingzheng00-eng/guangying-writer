/** SmartType interaction regression, synthetic screenplay only.
 * Runs the actual Editor with an in-memory esbuild bundle and jsdom. Browser
 * defaults (native soft breaks/clipboard/IME) are not simulated as real input;
 * checks below cover event routing, candidate lifetime, model/DOM and history.
 * Real Chromium keyboard/caret geometry must also be checked separately.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');

const repo = path.resolve(__dirname, '..');
const browser = new JSDOM('<!doctype html><div id="root"></div>', {
  url: 'http://smarttype-test.invalid/', pretendToBeVisual: true,
});
const w = browser.window;
for (const key of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'NodeFilter', 'Element', 'Event', 'InputEvent', 'MouseEvent', 'KeyboardEvent', 'DOMParser', 'Range', 'Selection', 'getComputedStyle', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: w[key] });
}
globalThis.window = w;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.HTMLElement.prototype.scrollIntoView = function () {};
// Deterministic synthetic rectangles: jsdom does not lay out HTML.
w.HTMLElement.prototype.getBoundingClientRect = function () {
  return { x: 100, y: 160, top: 160, bottom: 190, left: 100, right: 500, width: 400, height: 30, toJSON() { return {}; } };
};

const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const failures = [];
let assertions = 0;
let root;
function check(label, actual, expected = true) {
  assertions++;
  try { assert.deepEqual(actual, expected); console.log(`PASS ${label}`); }
  catch { failures.push({ label, actual, expected }); console.error(`FAIL ${label}: ${JSON.stringify({ actual, expected })}`); }
}

(async () => {
  const built = await esbuild.build({
    stdin: { contents: `
      export { Editor } from './src/components/Editor';
      export { useStore } from './src/store/store';
      export { createProject } from './src/model/project';
      export { setCaret, caretOffset, makeTextRange } from './src/utils/dom';
      export { escapeHtml } from './src/utils/text';
    `, resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    loader: { '.png': 'dataurl', '.css': 'empty' }, logLevel: 'silent',
  });
  const bundle = new Module(path.join(repo, '.smarttype-ui-memory.cjs'), module);
  bundle.filename = path.join(repo, '.smarttype-ui-memory.cjs');
  bundle.paths = Module._nodeModulePaths(repo);
  bundle._compile(built.outputFiles[0].text, bundle.filename);
  const { Editor, useStore, createProject, setCaret, caretOffset, makeTextRange, escapeHtml } = bundle.exports;
  const state = () => useStore.getState();
  const block = (id = 'smart-edit') => document.querySelector(`.script-flow [data-id="${id}"]`);
  const element = (id = 'smart-edit') => state().project.elements.find(item => item.id === id);
  const options = () => [...document.querySelectorAll('.smarttype__item')];
  const labels = () => options().map(node => node.textContent);
  const textHTML = () => state().project.elements.map(item => item.text);
  const visibleHTML = () => [...document.querySelectorAll('.script-flow .sc-el')].map(node => node.innerHTML);
  const prefix = () => element().text;
  const sync = label => check(label, visibleHTML(), textHTML());

  async function reset(type = 'character', overrides = {}) {
    if (root) { await act(async () => root.unmount()); root = null; }
    // Let any already-queued blur from the prior mount finish before the next
    // independent fixture. The A -> B lifetime check below deliberately does not.
    await act(async () => pause(150));
    document.getElementById('root').innerHTML = '';
    const project = createProject('合成快捷输入验收');
    project.titlePage.show = false;
    project.elements = [
      { id: 'smart-location-1', type: 'scene_heading', text: '内景 工作室 日' },
      { id: 'smart-known-cn', type: 'character', text: '测试角色' },
      { id: 'smart-known-en', type: 'character', text: 'TEST ROLE' },
      { id: 'smart-known-angle', type: 'character', text: 'TEST &lt;MENTOR&gt;' },
      { id: 'smart-location-2', type: 'scene_heading', text: '外景 广场 夜' },
      { id: 'smart-edit', type, text: '', ...overrides },
      { id: 'smart-other', type: 'character', text: '' },
      { id: 'smart-tail', type: 'action', text: '保留的合成段落。' },
    ];
    await act(async () => {
      state().loadProject(project);
      useStore.setState({ focus: null, past: [], future: [], activeId: 'smart-edit' });
      root = createRoot(document.getElementById('root'));
      root.render(React.createElement(Editor));
    });
    // Only jsdom lacks contentEditable's native focusability; production nodes
    // are not altered by this accommodation.
    for (const node of document.querySelectorAll('.script-flow [contenteditable]')) node.tabIndex = 0;
    await act(async () => { block().focus(); setCaret(block(), 'end'); });
  }
  async function type(text, id = 'smart-edit', caret = 'end') {
    await act(async () => {
      const node = block(id);
      node.innerHTML = escapeHtml(text);
      setCaret(node, caret);
      node.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
  }
  async function key(name, modifiers = {}, id = 'smart-edit') {
    const event = new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...modifiers });
    await act(async () => block(id).dispatchEvent(event));
    return event;
  }
  async function choose(label) {
    const option = options().find(node => node.textContent === label);
    check(`candidate ${label} available for mouse completion`, !!option);
    if (!option) return false;
    await act(async () => option.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true })));
    return true;
  }
  async function select(start, end = start) {
    await act(async () => {
      block().focus();
      const selection = w.getSelection();
      selection.removeAllRanges();
      selection.addRange(makeTextRange(block(), start, end));
    });
  }

  await reset(); await type('测试');
  check('Chinese character prefix finds existing character', labels().includes('测试角色'));
  const initialCount = state().project.elements.length;
  await key('Tab');
  check('Tab clears character candidates before changing type', labels(), []);
  check('Tab changes only the current element type', element().type, 'parenthetical');
  await key('Enter');
  check('Enter after Tab does not write a stale character suggestion', prefix(), '测试');
  check('Enter after Tab follows the normal paragraph rhythm', state().project.elements.length, initialCount + 1);

  await reset(); await type('测试');
  const tabStart = prefix();
  const tabCaret = caretOffset(block());
  for (let i = 0; i < 9; i++) {
    await key('Tab');
    check(`Tab ${i + 1} keeps focus inside same paragraph`, document.activeElement?.dataset.id, 'smart-edit');
    check(`Tab ${i + 1} keeps visible paragraph text`, block().textContent, tabStart);
    check(`Tab ${i + 1} keeps original caret offset`, caretOffset(block()), tabCaret);
  }
  check('nine Tabs return to character', element().type, 'character');
  for (let i = 0; i < 11; i++) {
    await key('Tab');
    check(`continued Tab ${i + 10} keeps focus`, document.activeElement?.dataset.id, 'smart-edit');
    check(`continued Tab ${i + 10} keeps visible text`, block().textContent, tabStart);
    check(`continued Tab ${i + 10} keeps original caret`, caretOffset(block()), tabCaret);
  }
  for (let i = 0; i < 11; i++) {
    await key('Tab', { shiftKey: true });
    check(`Shift+Tab ${i + 1} keeps focus`, document.activeElement?.dataset.id, 'smart-edit');
    check(`Shift+Tab ${i + 1} keeps visible text`, block().textContent, tabStart);
    check(`Shift+Tab ${i + 1} keeps original caret`, caretOffset(block()), tabCaret);
  }
  check('eleven forward and reverse Tabs preserve original type', element().type, 'character');
  check('type cycles never alter paragraph text', prefix(), tabStart);

  await reset(); await type('测试'); await select(1);
  for (let i = 0; i < 9; i++) {
    await key('Tab');
    check(`middle-caret Tab ${i + 1} keeps focus`, document.activeElement?.dataset.id, 'smart-edit');
    check(`middle-caret Tab ${i + 1} keeps visible text`, block().textContent, '测试');
    check(`middle-caret Tab ${i + 1} preserves position 1`, caretOffset(block()), 1);
  }
  check('middle-caret type loop returns to character without text mutation', [element().type, prefix()], ['character', '测试']);

  await reset('scene_heading', { text: '内景 合成空间 日' }); await select(1);
  for (const sceneNumber of ['left', 'none', 'both', 'right']) {
    await act(async () => state().updateSettings({ sceneNumber }));
    check(`scene-number ${sceneNumber} preserves visible heading`, block().textContent, '内景 合成空间 日');
    check(`scene-number ${sceneNumber} preserves serialized heading`, prefix(), '内景 合成空间 日');
    check(`scene-number ${sceneNumber} preserves current caret offset`, caretOffset(block()), 1);
  }
  for (const tag of ['button', 'input']) {
    await reset('scene_heading', { text: '内景 合成空间 日' }); await select(1);
    const control = document.createElement(tag);
    control.id = `smart-external-${tag}`;
    if (tag === 'button') control.textContent = '合成设置按钮';
    document.body.appendChild(control);
    await act(async () => control.focus());
    check(`external ${tag} is actually focused before scene setting change`, document.activeElement?.id, control.id);
    await act(async () => state().updateSettings({ sceneNumber: 'none' }));
    check(`scene-number wrapper update cannot steal external ${tag} focus`, document.activeElement?.id, control.id);
    check(`scene setting change while ${tag} focused still preserves heading DOM`, block().textContent, '内景 合成空间 日');
    await act(async () => state().updateSettings({ sceneNumber: 'both' }));
    check(`second scene-number wrapper update cannot steal external ${tag} focus`, document.activeElement?.id, control.id);
    control.remove();
  }

  for (const modifiers of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
    await reset(); await type('测试');
    const before = textHTML();
    const event = await key('Enter', modifiers);
    check(`${Object.keys(modifiers)[0]}+Enter does not accept candidate`, textHTML(), before);
    check(`${Object.keys(modifiers)[0]}+Enter leaves browser/app shortcut available`, event.defaultPrevented, false);
  }
  for (const modifiers of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
    await reset(); await type('测试');
    const before = textHTML();
    const event = await key(' ', modifiers);
    check(`${Object.keys(modifiers)[0]}+Space does not accept candidate`, textHTML(), before);
    check(`${Object.keys(modifiers)[0]}+Space leaves system shortcut available`, event.defaultPrevented, false);
  }
  await reset(); await type('测试');
  await key('ArrowDown', { shiftKey: true });
  check('Shift+Arrow never replaces the writing paragraph', prefix(), '测试');

  await reset(); await type('测试');
  await key('Escape');
  check('Escape dismisses candidates', labels(), []);
  check('Escape preserves writing focus', document.activeElement?.dataset.id, 'smart-edit');
  await key('Escape');
  check('Escape without a candidate still preserves writing focus', document.activeElement?.dataset.id, 'smart-edit');

  await reset(); await type('测试'); await select(1);
  await key('Enter');
  const sourceIndex = state().project.elements.findIndex(item => item.id === 'smart-edit');
  check('mid-paragraph Enter performs the real split, not whole-line completion', textHTML().slice(sourceIndex, sourceIndex + 2), ['测', '试']);
  sync('mid-paragraph Enter keeps DOM and store synchronized');
  await reset(); await type('测试'); await select(0, 1);
  const selectedSpace = await key(' ');
  check('Space with a noncollapsed text selection is not SmartType completion', selectedSpace.defaultPrevented, false);
  check('noncollapsed selection does not overwrite the whole paragraph', prefix(), '测试');

  await reset(); await type('te');
  check('English character prefix matching ignores case', labels().includes('TEST ROLE'));
  await choose('TEST ROLE');
  check('mouse completion updates model immediately', prefix(), 'TEST ROLE');
  check('mouse completion updates focused visible paragraph immediately', block().textContent, 'TEST ROLE');
  check('mouse completion remains in current paragraph', document.activeElement?.dataset.id, 'smart-edit');
  const committed = textHTML();
  await act(async () => state().undo());
  check('one undo restores typed prefix rather than deleting earlier text', prefix(), 'te');
  sync('completion undo redraws the currently focused paragraph');
  await act(async () => state().redo());
  check('one redo reapplies completion', textHTML(), committed);
  sync('completion redo redraws the currently focused paragraph');

  await reset(); await type('te');
  await choose('TEST <MENTOR>');
  check('angle-bracket candidate is serialized as escaped literal text', prefix(), 'TEST &lt;MENTOR&gt;');
  check('angle-bracket candidate displays its literal characters', block().textContent, 'TEST <MENTOR>');
  check('completion cannot create a markup element from its label', block().querySelector('mentor'), null);
  sync('literal completion keeps DOM and store synchronized');

  await reset();
  await act(async () => {
    block().innerHTML = '<b>te</b>';
    setCaret(block(), 'end');
    block().dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  });
  await choose('TEST ROLE');
  check('completion preserves inline formatting surrounding the typed field', prefix(), '<b>TEST ROLE</b>');
  sync('formatted completion keeps DOM and store synchronized');

  await reset(); await type('测试');
  await key('Enter');
  const completedIndex = state().project.elements.findIndex(item => item.id === 'smart-edit');
  check('Enter accepts the selected character', prefix(), '测试角色');
  check('completed character Enter advances to dialogue', state().project.elements[completedIndex + 1].type, 'dialogue');
  check('completed character Enter leaves the new dialogue focused', document.activeElement?.dataset.id, state().project.elements[completedIndex + 1].id);

  await reset(); await type('te');
  const visibleOptions = labels();
  check('multiple synthetic character candidates available for arrow navigation', visibleOptions.length >= 2);
  await key('ArrowDown');
  check('ArrowDown highlights the next candidate without editing text', document.querySelector('.smarttype__item.is-active')?.textContent, visibleOptions[1]);
  check('candidate navigation leaves the typed prefix alone', prefix(), 'te');
  await key('ArrowUp');
  check('ArrowUp returns to the first candidate', document.querySelector('.smarttype__item.is-active')?.textContent, visibleOptions[0]);
  await key('ArrowRight');
  check('Right accepts the highlighted completion while keeping current paragraph', prefix(), escapeHtml(visibleOptions[0]));
  check('Right completion does not create a new element', state().project.elements.length, 8);

  await reset(); await type('测试');
  await act(async () => state().undo());
  await key('Enter');
  check('undo invalidates completion bound to the old prefix', prefix(), '');
  await reset(); await type('测试');
  await act(async () => state().setType('smart-edit', 'action'));
  await key('Enter');
  check('external type change invalidates candidates for the old type', prefix(), '测试');

  await reset('scene_heading'); await type('内景 ');
  check('scene prefix offers location field rather than the whole heading', labels().includes('工作室'));
  await choose('工作室');
  check('location completion retains scene prefix and a separator for time', prefix(), '内景 工作室 ');
  check('location completion remains in current scene heading', element().type, 'scene_heading');
  check('location completion offers the next time field', labels().includes('日'));
  await choose('日');
  check('time completion fills only the missing time field', prefix(), '内景 工作室 日');
  check('mouse time completion does not create another paragraph', state().project.elements.length, 8);
  sync('multi-field scene completion keeps DOM and store synchronized');

  await reset('scene_heading'); await type('内景 工作室 ');
  check('scene time field exposes day/night suggestions', labels().includes('日'));
  const chosenDay = options().findIndex(node => node.textContent === '日');
  if (chosenDay >= 0) {
    for (let i = 0; i < chosenDay; i++) await key('ArrowDown');
    await key('Enter');
    const index = state().project.elements.findIndex(item => item.id === 'smart-edit');
    check('Enter on the final scene field retains completed heading', prefix(), '内景 工作室 日');
    check('Enter on final scene field advances to action', state().project.elements[index + 1].type, 'action');
  }

  await reset(); await type('测试角色 (');
  check('character extension field offers V.O. without changing name', labels().includes('V.O.'));
  await choose('V.O.');
  check('character extension completion retains name and pairs parentheses', prefix(), '测试角色 (V.O.)');

  await reset('scene_heading'); await type('内景 工作室 夜');
  check('exact night time is not hijacked by a longer matching time', labels(), []);
  await key('Enter');
  check('Enter after an exact time keeps original heading unchanged', prefix(), '内景 工作室 夜');
  await reset(); await type('测试');
  await act(async () => state().setWritingSelectionMode(true));
  check('writing paragraph selection mode dismisses SmartType candidates', labels(), []);
  check('entering paragraph selection mode does not modify writing text', prefix(), '测试');

  await reset(); await type('测试');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true })));
  check('IME composition hides obsolete candidates', labels(), []);
  const composingEnter = await key('Enter', { isComposing: true });
  check('IME confirmation Enter is not intercepted', composingEnter.defaultPrevented, false);
  check('IME confirmation cannot accept old candidates', prefix(), '测试');
  await type('测试角色');
  check('candidate list stays quiet during IME composition', labels(), []);
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true })));
  check('composition end preserves the committed text', prefix(), '测试角色');
  sync('composition end keeps visible text synchronized');

  await reset(); await type('测试');
  await act(async () => { block('smart-other').focus(); setCaret(block('smart-other'), 'end'); });
  await type('te', 'smart-other');
  check('newly focused paragraph can show its own candidate', labels().includes('TEST ROLE'));
  await act(async () => pause(150));
  check('prior paragraph blur timer cannot dismiss current paragraph candidates', labels().includes('TEST ROLE'));
  await choose('TEST ROLE');
  check('candidate after fast focus change applies to the correct paragraph', element('smart-other').text, 'TEST ROLE');
  check('candidate after fast focus change leaves previous paragraph intact', prefix(), '测试');

  await reset(); await type('测试'); await select(2);
  const data = new Map([['text/plain', '粘贴合成文本']]);
  const paste = new w.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { getData: mime => data.get(mime) || '' } });
  await act(async () => block().dispatchEvent(paste));
  check('paste closes candidates belonging to pre-paste text', labels(), []);
  check('paste still follows the atomic writing transaction', prefix(), '测试粘贴合成文本');
  sync('paste during candidate state keeps DOM synchronized');

  await reset('action');
  for (const typed of ['i', 'in', 'int', 'int.']) {
    await type(typed);
    check(`incremental ${typed} keeps focus in the original paragraph`, document.activeElement?.dataset.id, 'smart-edit');
  }
  check('incremental lowercase INT. is recognized as scene heading', element().type, 'scene_heading');
  check('incremental scene recognition does not duplicate text', prefix(), 'int.');
  await reset('action');
  for (const typed of ['I', 'IN', 'INT', 'INT.']) {
    await type(typed);
    check(`incremental uppercase ${typed} keeps focus`, document.activeElement?.dataset.id, 'smart-edit');
  }
  check('uppercase scene prefix is not prematurely trapped as character', element().type, 'scene_heading');

  await reset('action'); await type('内'); await type('内景');
  check('incremental Chinese 内景 is recognized as scene heading', element().type, 'scene_heading');
  check('Chinese scene wrapper preserves focus and original text', [document.activeElement?.dataset.id, prefix()], ['smart-edit', '内景']);
  await reset('action');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true })));
  await type('内景 工作室 日');
  check('composition does not prematurely change the element type', element().type, 'action');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true })));
  check('committed IME scene heading is recognized', element().type, 'scene_heading');
  check('IME scene recognition restores focus inside same paragraph', document.activeElement?.dataset.id, 'smart-edit');
  await type('内景 工作室 日 合成备注');
  check('continued input after recognition preserves committed text and type', [element().type, prefix()], ['scene_heading', '内景 工作室 日 合成备注']);

  await reset('action', { text: '内景 回忆只是描述' });
  await type('内景 回忆只是普通描述', 'smart-edit', 8);
  check('editing middle of an existing action never guesses a new type', element().type, 'action');
  await type('内景 回忆只是普通描述，继续描述');
  check('editing tail of an existing action never guesses a new type', element().type, 'action');
  await reset('action'); await key('Tab');
  check('manual Tab explicitly selects character', element().type, 'character');
  await type('内景 工作室 日');
  check('automatic guessing does not override explicitly selected element type', element().type, 'character');
  await reset('scene_heading'); await type('I');
  check('typing uppercase I in an explicit scene element stays a scene element', element().type, 'scene_heading');

  await act(async () => root.unmount()); root = null;
  console.log(JSON.stringify({ assertions, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (root) await act(async () => root.unmount());
  w.close();
});
