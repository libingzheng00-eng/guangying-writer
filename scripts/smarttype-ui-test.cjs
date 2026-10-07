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
  // Type badges are UI metadata, never candidate text or replacement payload.
  const optionLabel = node => node?.querySelector('.smarttype__label')?.textContent
    ?? node?.firstChild?.textContent ?? '';
  const labels = () => options().map(optionLabel);
  const textHTML = () => state().project.elements.map(item => item.text);
  const visibleHTML = () => [...document.querySelectorAll('.script-flow .sc-el')].map(node => node.innerHTML);
  const prefix = () => element().text;
  const sync = label => check(label, visibleHTML(), textHTML());

  async function reset(type = 'character', overrides = {}, extraElements = []) {
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
      ...extraElements,
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
  async function type(text, id = 'smart-edit', caret = 'end', inputType = 'insertText') {
    await act(async () => {
      const node = block(id);
      node.innerHTML = escapeHtml(text);
      setCaret(node, caret);
      node.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType }));
    });
  }
  async function key(name, modifiers = {}, id = 'smart-edit') {
    const event = new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...modifiers });
    await act(async () => block(id).dispatchEvent(event));
    return event;
  }
  async function keyup(name, modifiers = {}, id = 'smart-edit') {
    await act(async () => block(id).dispatchEvent(new w.KeyboardEvent('keyup', {
      key: name, bubbles: true, cancelable: true, ...modifiers,
    })));
  }
  async function choose(label) {
    const option = options().find(node => optionLabel(node) === label);
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
  const countBeforeConfirmation = state().project.elements.length;
  await key('Enter');
  const completedIndex = state().project.elements.findIndex(item => item.id === 'smart-edit');
  check('Enter accepts the selected character', prefix(), '测试角色');
  check('first candidate Enter never inserts a paragraph', state().project.elements.length, countBeforeConfirmation);
  check('first candidate Enter keeps the completed character focused', document.activeElement?.dataset.id, 'smart-edit');
  check('accepted character candidates close immediately', labels(), []);
  await keyup('Enter');
  check('keyup cannot reopen the accepted character candidates', labels(), []);
  await key('Enter');
  check('second character Enter inserts exactly one paragraph', state().project.elements.length, countBeforeConfirmation + 1);
  check('second character Enter advances to dialogue', state().project.elements[completedIndex + 1].type, 'dialogue');
  check('second character Enter leaves the new dialogue focused', document.activeElement?.dataset.id, state().project.elements[completedIndex + 1].id);

  await reset(); await type('te');
  const visibleOptions = labels();
  check('multiple synthetic character candidates available for arrow navigation', visibleOptions.length >= 2);
  await key('ArrowDown');
  check('ArrowDown highlights the next candidate without editing text', optionLabel(document.querySelector('.smarttype__item.is-active')), visibleOptions[1]);
  check('candidate navigation leaves the typed prefix alone', prefix(), 'te');
  await key('ArrowUp');
  check('ArrowUp returns to the first candidate', optionLabel(document.querySelector('.smarttype__item.is-active')), visibleOptions[0]);
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
  await reset(); await type('测试');
  check('character candidate is present before vocabulary source changes', labels().includes('测试角色'));
  await act(async () => state().setText('smart-known-cn', '改名后的合成角色'));
  check('changing vocabulary source invalidates the prior candidate list', labels(), []);
  await key('Enter');
  check('Enter after source rename cannot complete the removed character name', prefix(), '测试');

  await reset('scene_heading'); await type('内景 ');
  check('scene prefix offers location field rather than the whole heading', labels().includes('工作室'));
  await choose('工作室');
  check('location completion retains scene prefix and a separator for time', prefix(), '内景 工作室 ');
  check('location completion remains in current scene heading', element().type, 'scene_heading');
  check('location acceptance closes candidates until new input', labels(), []);
  await keyup('Enter');
  check('location acceptance cannot reopen time suggestions merely on keyup', labels(), []);
  await type('内景 工作室 黄');
  check('new time-prefix input resumes field completion', labels().includes('黄昏'));
  await choose('黄昏');
  check('time completion fills only the missing time field', prefix(), '内景 工作室 黄昏');
  check('mouse time completion does not create another paragraph', state().project.elements.length, 8);
  check('mouse time completion closes accepted candidates', labels(), []);
  sync('multi-field scene completion keeps DOM and store synchronized');

  await reset('scene_heading'); await type('内景 工作室 ');
  check('scene time field exposes day/night suggestions', labels().includes('日'));
  const chosenDay = options().findIndex(node => optionLabel(node) === '日');
  if (chosenDay >= 0) {
    for (let i = 0; i < chosenDay; i++) await key('ArrowDown');
    await key('Enter');
    const index = state().project.elements.findIndex(item => item.id === 'smart-edit');
    check('Enter on the final scene field retains completed heading', prefix(), '内景 工作室 日');
    check('Enter on final scene field stays in current heading', document.activeElement?.dataset.id, 'smart-edit');
    check('scene field confirmation does not create another paragraph', state().project.elements.length, 8);
    await keyup('Enter');
    check('accepted scene field does not reopen on keyup', labels(), []);
    await key('Enter');
    check('second Enter on completed scene field advances to action', state().project.elements[index + 1].type, 'action');
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
  check('incremental lowercase INT. waits for explicit cross-type confirmation', element().type, 'action');
  check('incremental scene recommendation does not duplicate or rewrite text', prefix(), 'int.');
  check('lowercase INT. exposes its scene-heading candidate', labels().some(label => label.toLowerCase() === 'int.'));
  await key('Enter');
  check('confirmed lowercase scene prefix becomes a scene heading', element().type, 'scene_heading');
  await reset('action');
  for (const typed of ['I', 'IN', 'INT', 'INT.']) {
    await type(typed);
    check(`incremental uppercase ${typed} keeps focus`, document.activeElement?.dataset.id, 'smart-edit');
  }
  check('uppercase scene prefix is not prematurely trapped as character', element().type, 'action');
  await key('Enter');
  check('confirmed uppercase scene prefix becomes a scene heading', element().type, 'scene_heading');

  await reset('action'); await type('内'); await type('内景');
  check('incremental Chinese 内景 waits for explicit scene confirmation', element().type, 'action');
  check('Chinese scene recommendation preserves focus and original text', [document.activeElement?.dataset.id, prefix()], ['smart-edit', '内景']);
  await key('Enter');
  check('Chinese scene confirmation changes type without moving focus', [document.activeElement?.dataset.id, element().type], ['smart-edit', 'scene_heading']);
  await reset('action');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true })));
  await type('内景 工作室 日');
  check('composition does not prematurely change the element type', element().type, 'action');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true })));
  check('committed IME scene heading still waits for explicit confirmation', element().type, 'action');
  check('IME scene recommendation keeps focus inside same paragraph', document.activeElement?.dataset.id, 'smart-edit');
  await key('Enter');
  check('confirmed IME scene heading changes type in the same paragraph', [document.activeElement?.dataset.id, element().type], ['smart-edit', 'scene_heading']);
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

  // 2026-10-08 user-approved contract: cross-type suggestions belong only to a
  // fresh empty-line input session. Confirming is not the same action as Enter.
  for (const originalType of ['action', 'character', 'parenthetical', 'dialogue', 'transition',
    'shot', 'scene_heading', 'general', 'note', 'act']) {
    await reset(originalType); await type('特');
    const count = state().project.elements.length;
    check(`fresh ${originalType} line offers cross-type 特写`, labels().includes('特写'));
    check(`suggesting 特写 does not preemptively change ${originalType}`, element().type, originalType);
    const shotOption = options().find(node => optionLabel(node) === '特写');
    check(`cross-type candidate visibly identifies 镜头 in ${originalType}`, shotOption?.textContent.includes('镜头') ?? false);
    if (shotOption) {
      const index = options().indexOf(shotOption);
      for (let i = 0; i < index; i++) await key('ArrowDown');
    }
    const event = await key('Enter');
    check(`fresh ${originalType} candidate Enter is handled`, event.defaultPrevented);
    check(`fresh ${originalType} acceptance completes text and type together`, [prefix(), element().type], ['特写', 'shot']);
    check(`fresh ${originalType} acceptance leaves paragraph count alone`, state().project.elements.length, count);
    check(`fresh ${originalType} acceptance keeps same paragraph focused`, document.activeElement?.dataset.id, 'smart-edit');
    check(`fresh ${originalType} acceptance keeps caret at completed text end`, caretOffset(block()), 2);
    check(`fresh ${originalType} acceptance closes candidate list`, labels(), []);
  }

  await reset('action'); await type('特');
  const crossCount = state().project.elements.length;
  const pastBeforeCross = state().past.length;
  await key('Enter');
  check('cross-type completion records exactly one independent undo transaction', state().past.length, pastBeforeCross + 1);
  const crossCommitted = state().project;
  await act(async () => state().undo());
  check('one cross-type undo restores both prefix and original type', [prefix(), element().type], ['特', 'action']);
  check('cross-type undo never removes surrounding screenplay', state().project.elements.length, crossCount);
  sync('cross-type completion undo synchronizes focused DOM');
  await act(async () => state().redo());
  check('one cross-type redo restores both completed text and target type', [prefix(), element().type], ['特写', 'shot']);
  check('cross-type redo preserves surrounding synthetic screenplay', state().project, crossCommitted);
  sync('cross-type completion redo synchronizes focused DOM');
  await keyup('Enter');
  check('confirmed completion stays closed after keyup and history redraw', labels(), []);
  await act(async () => { block('smart-other').focus(); block().focus(); setCaret(block(), 'end'); });
  check('refocusing confirmed text cannot reopen its same candidates', labels(), []);
  await key('Enter');
  check('next Enter after confirmed cross-type text creates one paragraph', state().project.elements.length, crossCount + 1);

  await reset('action'); await type('特');
  const intentSpace = await key(' ');
  check('Space cannot unexpectedly confirm a cross-type intent while writing a sentence', intentSpace.defaultPrevented, false);
  check('Space routing leaves cross-type text and type unchanged', [prefix(), element().type], ['特', 'action']);
  await reset('action'); await type('特');
  const mouseCount = state().project.elements.length;
  await choose('特写');
  check('mouse cross-type confirmation changes text and type in current paragraph', [prefix(), element().type], ['特写', 'shot']);
  check('mouse cross-type confirmation cannot insert a paragraph', [document.activeElement?.dataset.id, state().project.elements.length], ['smart-edit', mouseCount]);
  await keyup('Enter');
  check('mouse-confirmed candidate remains closed on keyup', labels(), []);
  await reset('action'); await type('特'); await key('ArrowRight');
  check('Right can explicitly confirm cross-type intent without splitting', [prefix(), element().type, state().project.elements.length], ['特写', 'shot', 8]);

  const family = [
    { id: 'smart-family-exact', type: 'character', text: '小明' },
    { id: 'smart-family-longer', type: 'character', text: '小明妈妈' },
  ];
  await reset('action'); await type('特'); await type('特别安静的合成房间。');
  check('continuing a prefix into a normal sentence dismisses cross-type suggestions', labels(), []);
  check('unconfirmed shot prefix remains ordinary action text', [prefix(), element().type], ['特别安静的合成房间。', 'action']);
  await reset('action', {}, family); await type('小明'); await type('小明走进合成房间。');
  check('unconfirmed character prefix may continue as an action sentence', [prefix(), element().type], ['小明走进合成房间。', 'action']);
  check('continuing a character prefix cannot leave stale character candidates', labels(), []);
  await reset('dialogue', {}, family); await type('小明');
  check('complete character prefix shows exact and longer names together', labels().filter(label => label.startsWith('小明')), ['小明', '小明妈妈']);
  check('complete character prefix puts exact name first', labels()[0], '小明');
  check('complete prefix never auto-converts an unrelated dialogue line', [prefix(), element().type], ['小明', 'dialogue']);
  await key('ArrowDown');
  check('Down can select longer name after an exact prefix', optionLabel(document.querySelector('.smarttype__item.is-active')), '小明妈妈');
  const familyCount = state().project.elements.length;
  await key('Enter');
  check('accepting longer name changes current line to character', [prefix(), element().type], ['小明妈妈', 'character']);
  check('accepting longer name stays on current paragraph', [document.activeElement?.dataset.id, state().project.elements.length], ['smart-edit', familyCount]);
  await keyup('Enter'); await key('Enter');
  const familyIndex = state().project.elements.findIndex(item => item.id === 'smart-edit');
  check('second Enter after longer-name acceptance enters dialogue', state().project.elements[familyIndex + 1].type, 'dialogue');
  await reset('general', {}, family); await type('小明');
  const exactPast = state().past.length;
  await key('Enter');
  check('default exact-name confirmation cannot expand into longer name', [prefix(), element().type], ['小明', 'character']);
  check('exact-label type conversion still has one history transaction', state().past.length, exactPast + 1);
  await act(async () => state().undo());
  check('undo of exact-label completion restores original type without deleting name', [prefix(), element().type], ['小明', 'general']);
  await reset('character', {}, family); await type('小明');
  const exactNoChangePast = state().past.length;
  await key('Enter');
  check('same-type exact-name acceptance retains exact text', [prefix(), element().type], ['小明', 'character']);
  check('same-type exact-name acceptance adds no redundant history', state().past.length, exactNoChangePast);
  check('same-type exact-name acceptance still closes the list', labels(), []);
  await type('小', 'smart-edit', 'end', 'deleteContentBackward');
  check('genuine editing after confirmation resumes character prefix suggestions', labels().filter(label => label.startsWith('小明')), ['小明', '小明妈妈']);
  await type('小明');
  check('retyping a confirmed exact name can again offer its longer names', labels().filter(label => label.startsWith('小明')), ['小明', '小明妈妈']);
  check('resumed exact-name suggestions cannot auto-expand text or type', [prefix(), element().type], ['小明', 'character']);

  await reset('action'); await type('特'); await key('Escape');
  check('Escape cancels cross-type suggestions without changing original type', [prefix(), element().type], ['特', 'action']);
  const cancelledCount = state().project.elements.length;
  await key('Enter');
  check('Enter after cross-type Escape follows normal splitting', state().project.elements.length, cancelledCount + 1);
  check('Enter after Escape cannot silently complete the cancelled prefix', prefix(), '特');
  for (const [initial, continued] of [['内', '内景'], ['INT', 'INT.']]) {
    await reset('action'); await type(initial); await key('Escape'); await type(continued);
    check(`Escape on ${initial} clears old recognizer continuation and preserves original type`, element().type, 'action');
    check(`continued ${initial} input remains literal until explicit confirmation`, prefix(), continued);
  }
  await reset('general'); await type('完全不匹配的合成文字');
  check('unmatched input has no SmartType candidates', labels(), []);
  const noCandidateCount = state().project.elements.length;
  await key('Enter');
  check('Enter with no candidate retains normal paragraph insertion', state().project.elements.length, noCandidateCount + 1);

  await reset('action', { text: '已有的合成描述' }); await type('特');
  check('editing existing action text does not unlock cross-type candidates', labels(), []);
  check('editing existing action keeps its type', element().type, 'action');
  await reset('action', { text: '前句特' }); await select(2); await key('Enter');
  const splitIndex = state().project.elements.findIndex(item => item.id === 'smart-edit');
  const splitTail = state().project.elements[splitIndex + 1];
  check('middle Enter moves its existing trailing text instead of creating empty input session', [prefix(), splitTail.text], ['前句', '特']);
  check('split trailing text is focused without cross-type suggestions', [document.activeElement?.dataset.id, labels()], [splitTail.id, []]);
  await keyup('Enter', {}, splitTail.id);
  await type('特写', splitTail.id);
  check('typing in an inherited split tail does not convert it across types', element(splitTail.id).type, 'action');
  check('typing in inherited split tail does not offer cross-type candidates', labels(), []);

  await reset('action');
  const inserted = new w.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(inserted, 'clipboardData', { value: { getData: mime => mime === 'text/plain' ? '特' : '' } });
  await act(async () => block().dispatchEvent(inserted));
  check('pasting into an empty line preserves action type', [prefix(), element().type], ['特', 'action']);
  check('pasted content cannot open cross-type suggestions', labels(), []);
  await keyup('v', { metaKey: true });
  check('paste keyup cannot retroactively enable cross-type suggestions', labels(), []);
  await type('特写');
  check('continuing after pasted content stays in original type', element().type, 'action');
  check('continuing pasted content does not unlock cross-type candidates', labels(), []);

  // Replacing a recognizer prefix with the identical clipboard spelling is
  // still a paste boundary. Text equality cannot revive the pre-paste session.
  await reset('action'); await type('IN'); await select(0, 2);
  const samePrefixPaste = new w.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(samePrefixPaste, 'clipboardData', {
    value: { getData: mime => mime === 'text/plain' ? 'IN' : '' },
  });
  await act(async () => block().dispatchEvent(samePrefixPaste));
  check('same-spelling prefix paste follows editor controlled clipboard routing', samePrefixPaste.defaultPrevented);
  check('same-spelling prefix paste preserves literal text and original type', [prefix(), element().type], ['IN', 'action']);
  check('same-spelling prefix paste closes the old candidates', labels(), []);
  await type('INT.');
  check('same-spelling paste cannot leave old scene-recognizer prefix alive', [prefix(), element().type], ['INT.', 'action']);
  check('continuing identical pasted prefix cannot regain cross-type candidates', labels(), []);
  sync('identical pasted prefix stays equal in model and visible paragraph');

  await reset('action'); await type('IN'); await select(0, 2);
  const cutData = new Map();
  const prefixCut = new w.Event('cut', { bubbles: true, cancelable: true });
  Object.defineProperty(prefixCut, 'clipboardData', {
    value: { setData: (mime, value) => cutData.set(mime, value) },
  });
  await act(async () => block().dispatchEvent(prefixCut));
  check('cutting recognizer prefix writes exactly selected literal clipboard text', cutData.get('text/plain'), 'IN');
  check('cutting prefix removes text without changing paragraph type', [prefix(), element().type], ['', 'action']);
  check('cutting prefix closes its suggestions', labels(), []);
  await act(async () => state().undo());
  check('cut undo restores original prefix and original type in one step', [prefix(), element().type], ['IN', 'action']);
  await act(async () => state().redo());
  check('cut redo again removes only the selected prefix', [prefix(), element().type], ['', 'action']);
  await act(async () => state().undo());
  await type('INT.');
  check('editing restored cut text cannot revive old scene recognition session', [prefix(), element().type], ['INT.', 'action']);
  check('editing restored cut text cannot reopen stale cross-type candidates', labels(), []);
  sync('cut-history-restored text stays synchronized with visible paragraph');

  await reset('dialogue', { dual: 'left', dualGroup: 'smart-synthetic-dual' }); await type('特');
  check('existing dual-dialogue structure cannot unlock cross-type intent', labels(), []);
  check('typing a shot prefix cannot change dual-dialogue membership or type',
    [element().type, element().dual, element().dualGroup], ['dialogue', 'left', 'smart-synthetic-dual']);
  await reset('character'); await type('特');
  check('non-dual character can initially recommend a shot intent', labels().includes('特写'));
  await act(async () => state().setDual('smart-edit', 'left'));
  check('enabling dual layout invalidates a previously shown cross-type intent', labels(), []);
  const enabledDualGroup = element().dualGroup;
  await key('Enter');
  check('stale shot intent cannot remove newly enabled dual membership',
    [prefix(), element().type, element().dual, element().dualGroup], ['特', 'character', 'left', enabledDualGroup]);

  await reset('action'); await type('特');
  const replacementProject = JSON.parse(JSON.stringify(state().project));
  replacementProject.name = '另一份独立合成工程';
  replacementProject.elements.find(item => item.id === 'smart-edit').text = '新的合成正文';
  await act(async () => state().loadProject(replacementProject));
  check('opening another document with same element ID dismisses stale intent', labels(), []);
  await key('Enter');
  const replacedIndex = state().project.elements.findIndex(item => item.id === 'smart-edit');
  check('stale cross-type candidate cannot overwrite same-ID new-document text',
    state().project.elements.slice(replacedIndex, replacedIndex + 2).map(item => item.text).join(''), '新的合成正文');
  check('stale cross-type candidate cannot convert the new document line', element().type, 'action');

  // A genuine loadProject advances documentEpoch without remounting Editor.
  // Same project/element IDs and identical old prefixes must not revive the
  // recognizer's per-element continuation map in an already populated draft.
  for (const [initial, continued] of [['IN', 'INT.'], ['内', '内景'], ['外', '外景']]) {
    await reset('action'); await type(initial);
    const epochBeforeLoad = state().documentEpoch;
    const loaded = JSON.parse(JSON.stringify(state().project));
    loaded.name = `同ID独立工程 ${initial}`;
    loaded.elements.find(item => item.id === 'smart-edit').text = initial;
    await act(async () => state().loadProject(loaded));
    check(`${initial} same-ID project load advances actual document epoch`, state().documentEpoch > epochBeforeLoad);
    check(`${initial} project replacement clears any preceding candidate`, labels(), []);
    await type(continued);
    check(`${initial} old recognizer prefix cannot convert loaded existing action`, [prefix(), element().type], [continued, 'action']);
    check(`${initial} loaded existing action cannot inherit a cross-type input session`, labels(), []);
    sync(`${initial} loaded action keeps model and visible text equal`);
    const countBeforeEnter = state().project.elements.length;
    await key('Enter');
    check(`${initial} Enter after document replacement still performs normal split`, state().project.elements.length, countBeforeEnter + 1);
    check(`${initial} document replacement cannot revive stale scene confirmation`, [prefix(), element().type], [continued, 'action']);
  }

  // A late compositionend from an empty paragraph in document A cannot give
  // document B's existing same-ID text the old "started empty" recognizer flag.
  for (const loadedText of ['内景 工作室 日', 'ANOTHER TEST ROLE']) {
    await reset('action');
    await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true })));
    await type('内', 'smart-edit', 'end', 'insertCompositionText');
    const epochBeforeLoad = state().documentEpoch;
    const loaded = JSON.parse(JSON.stringify(state().project));
    loaded.name = '跨组合期独立合成工程';
    loaded.elements.find(item => item.id === 'smart-edit').text = loadedText;
    await act(async () => state().loadProject(loaded));
    check(`composition marker ${loadedText} crosses a real document epoch`, state().documentEpoch > epochBeforeLoad);
    check(`composition project load ${loadedText} preserves new document content`, [prefix(), element().type], [loadedText, 'action']);
    await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true, data: '内' })));
    check(`old empty-composition marker cannot recognize ${loadedText} in loaded draft`, [prefix(), element().type], [loadedText, 'action']);
    check(`old composition cannot open cross-type recommendations in ${loadedText}`, labels(), []);
    sync(`late compositionend ${loadedText} cannot overwrite loaded visible text`);
    await type(`${loadedText} 继续旧正文`);
    check(`editing after late compositionend ${loadedText} stays in original type`, element().type, 'action');
    check(`editing after late compositionend ${loadedText} cannot inherit old candidates`, labels(), []);
  }

  await reset('action'); await type('特');
  const imeCount = state().project.elements.length;
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true })));
  check('composition start dismisses cross-type candidates', labels(), []);
  const imeEnter = await key('Enter', { isComposing: true });
  check('composition Enter remains available to the IME', imeEnter.defaultPrevented, false);
  check('composition Enter changes neither line type nor paragraph count', [prefix(), element().type, state().project.elements.length], ['特', 'action', imeCount]);
  await type('特', 'smart-edit', 'end', 'insertCompositionText');
  await act(async () => block().dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true, data: '特' })));
  const postCompositionEnter = await key('Enter', { isComposing: false, keyCode: 229, which: 229 });
  check('post-composition keyCode229 is never consumed as SmartType confirmation', postCompositionEnter.defaultPrevented, false);
  check('post-composition keyCode229 cannot complete or split the line', [prefix(), element().type, state().project.elements.length], ['特', 'action', imeCount]);
  await key('Enter');
  check('a subsequent genuine Enter may confirm committed composition text', [prefix(), element().type, state().project.elements.length], ['特写', 'shot', imeCount]);

  // Direct transaction validation protects against delayed callbacks even when
  // there is no mounted candidate UI left to reject them first.
  const protectedState = () => JSON.stringify({
    project: state().project, past: state().past, future: state().future,
    dirty: state().dirty, version: state().version, documentEpoch: state().documentEpoch,
  });
  const invalidCommits = [
    ['stale document epoch', ({ text, type, epoch }) => ['smart-edit', text, type, '特写', 'shot', epoch - 1]],
    ['stale source HTML', ({ type, epoch }) => ['smart-edit', '过期合成文本', type, '特写', 'shot', epoch]],
    ['stale source type', ({ text, epoch }) => ['smart-edit', text, 'dialogue', '特写', 'shot', epoch]],
    ['unsupported conversion target', ({ text, type, epoch }) => ['smart-edit', text, type, '特写', 'general', epoch]],
    ['invalid conversion target', ({ text, type, epoch }) => ['smart-edit', text, type, '特写', 'not-a-script-type', epoch]],
    ['missing element ID', ({ text, type, epoch }) => ['missing-synthetic-element', text, type, '特写', 'shot', epoch]],
  ];
  for (const [label, args] of invalidCommits) {
    await reset('action'); await type('特');
    await act(async () => {
      state().setText('smart-tail', '合成临时修改，用于保留 redo。');
      state().undo();
    });
    const before = protectedState();
    const projectBefore = state().project;
    let accepted;
    await act(async () => {
      accepted = state().commitSmartType(...args({ text: prefix(), type: element().type, epoch: state().documentEpoch }));
    });
    check(`commitSmartType rejects ${label}`, accepted, false);
    check(`rejected ${label} preserves project/history/redo/dirty/version`, protectedState(), before);
    check(`rejected ${label} preserves current immutable project reference`, state().project === projectBefore);
  }
  await reset('action'); await type('特');
  await act(async () => {
    state().setText('smart-tail', '合成临时修改，用于无变化事务 redo。');
    state().undo();
  });
  const noChangeBefore = protectedState();
  let noChangeAccepted;
  await act(async () => {
    noChangeAccepted = state().commitSmartType('smart-edit', prefix(), 'action', prefix(), 'action', state().documentEpoch);
  });
  check('same-text same-type completion may acknowledge successful confirmation', noChangeAccepted);
  check('no-change completion preserves all project/history/redo/dirty/version state', protectedState(), noChangeBefore);

  await reset('character', { text: '特', dual: 'left', dualGroup: 'smart-direct-dual' });
  const directDualBefore = protectedState();
  let directDualAccepted;
  await act(async () => {
    directDualAccepted = state().commitSmartType('smart-edit', '特', 'character', '特写', 'shot', state().documentEpoch);
  });
  check('direct cross-type completion refuses a dual-dialogue element', directDualAccepted, false);
  check('rejected dual-dialogue conversion preserves structure and history', protectedState(), directDualBefore);

  await reset('action', { text: '<b>特</b>', rev: 'smart-revision', sceneId: 'smart-location-1' });
  const decoratedProject = JSON.parse(JSON.stringify(state().project));
  decoratedProject.targetPages = 51;
  decoratedProject.beats = [
    { id: 'smart-protected-beat-1', kind: 'beat', title: '合成灵感一', text: '仅作保护断言。', color: '#d8e7cd', x: 230, y: 97, boardX: 28, boardY: 56, w: 260, h: 180 },
    { id: 'smart-protected-beat-2', kind: 'sound', title: '合成声音二', text: '无实际音频。', color: '#e7d8cd', x: 540, y: 191, sceneId: 'smart-location-1' },
  ];
  decoratedProject.boardLinks = [{ id: 'smart-protected-link', from: 'beat:smart-protected-beat-1', to: 'beat:smart-protected-beat-2', note: '合成关系备注' }];
  await act(async () => state().loadProject(decoratedProject));
  const protectedProjectBefore = state().project;
  const expectedProject = JSON.parse(JSON.stringify(protectedProjectBefore));
  const immutableBefore = JSON.stringify(protectedProjectBefore);
  const acceptedPast = state().past.length;
  let directAccepted;
  await act(async () => {
    directAccepted = state().commitSmartType('smart-edit', '<b>特</b>', 'action', '<b>特写</b>', 'shot', state().documentEpoch);
  });
  const expectedElement = expectedProject.elements.find(item => item.id === 'smart-edit');
  expectedElement.text = '<b>特写</b>';
  expectedElement.type = 'shot';
  expectedProject.updatedAt = state().project.updatedAt;
  check('direct valid completion succeeds', directAccepted);
  check('direct acceptance changes only target HTML/type and normal updatedAt', state().project, expectedProject);
  check('direct acceptance never mutates the previous immutable project', JSON.stringify(protectedProjectBefore), immutableBefore);
  check('direct valid acceptance makes exactly one history transaction', state().past.length, acceptedPast + 1);
  await act(async () => state().undo());
  check('direct completion undo restores original target HTML and type', [prefix(), element().type], ['<b>特</b>', 'action']);
  check('direct completion undo also retains unrelated cards, relationship and settings', state().project, protectedProjectBefore);

  await act(async () => root.unmount()); root = null;
  console.log(JSON.stringify({ assertions, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (root) await act(async () => root.unmount());
  w.close();
});
