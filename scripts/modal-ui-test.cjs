/** Actual App/Dialogs/store with synthetic content and memory-only recovery.
 * jsdom checks event routing, focus, selection and history boundaries; it does
 * not implement native text undo, inert hit-testing, layout or a system IME.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://modal-ui-test.invalid/', pretendToBeVisual: true });
const w = dom.window;
const originals = new Map();
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'NodeFilter', 'Element', 'Event', 'InputEvent', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'CompositionEvent', 'DOMParser', 'Range', 'getComputedStyle', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? w : w[key] });
}
originals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.HTMLElement.prototype.scrollIntoView = () => {};
let menuAction, nativeCalls = [], fileCalls = [];
w.api = {
  isElectron: false,
  onMenu(callback) { menuAction = callback; return () => { menuAction = null; }; },
  async openProject() { fileCalls.push('open'); return null; },
  async saveProject() { fileCalls.push('save'); return null; },
  async saveProjectAs() { fileCalls.push('saveAs'); return null; },
  async exportPdf() { fileCalls.push('pdf'); return null; },
};
document.execCommand = command => { nativeCalls.push(command); return true; };
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
w.addEventListener('error', event => errors.push(event.message));
let root, checks = 0;
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); };

(async () => {
  const built = await require('esbuild').build({
    stdin: { contents: "export { default as App } from './src/App'; export { useStore } from './src/store/store'; export { createProject } from './src/model/project'; export { makeTextRange, offsetOf } from './src/utils/dom';", resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty', '.png': 'dataurl' }, logLevel: 'silent',
  });
  const mod = new Module(path.join(repo, '.modal-ui-memory.cjs'), module);
  mod.filename = path.join(repo, '.modal-ui-memory.cjs');
  mod.paths = Module._nodeModulePaths(repo);
  mod._compile(built.outputFiles[0].text, mod.filename);
  const { App, useStore, createProject, makeTextRange, offsetOf } = mod.exports;
  const state = () => useStore.getState();
  const q = selector => document.querySelector(selector);
  const modal = () => q('[role="dialog"][aria-modal="true"]');
  const settings = () => [...q('.toolbar').querySelectorAll('button')].find(node => node.textContent.trim() === '设置');
  const writing = id => q(`.script-flow .sc-el--editable[data-id="${id}"]`);
  const dispatch = (node, event) => act(async () => { node.dispatchEvent(event); });
  const click = node => dispatch(node, new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const focus = node => act(async () => node.focus());
  const key = async (node, key, props = {}) => {
    const event = new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...props });
    await dispatch(node, event); return event;
  };
  const menu = action => act(async () => { menuAction(action); });
  const input = (node, value) => act(async () => {
    node.focus();
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  const snapshot = () => ({ project: state().project, past: state().past, future: state().future, dirty: state().dirty, version: state().version, view: state().view, sidebar: state().sidebarOpen, epoch: state().documentEpoch });
  const unchanged = (label, before) => check(label, snapshot(), before);
  const inert = expected => {
    for (const selector of ['.toolbar', '.app-body', '.statusbar']) check(`${selector} inert=${expected}`, !!q(selector).closest('[inert]'), expected);
    if (modal()) check('modal itself remains interactive', modal().closest('[inert]'), null);
  };
  const rangeState = () => {
    const selection = w.getSelection();
    const anchor = selection.anchorNode?.parentElement?.closest('.sc-el--editable');
    const end = selection.focusNode?.parentElement?.closest('.sc-el--editable');
    return [anchor?.dataset.id, anchor && offsetOf(anchor, selection.anchorNode, selection.anchorOffset), end?.dataset.id, end && offsetOf(end, selection.focusNode, selection.focusOffset)];
  };
  const selectWriting = async (backward = false, across = false) => act(async () => {
    const first = writing('modal-a'), last = across ? writing('modal-b') : first;
    first.tabIndex = 0; last.tabIndex = 0; first.focus();
    const a = makeTextRange(first, 1, 1), b = makeTextRange(last, 3, 3);
    const selection = w.getSelection();
    if (backward) selection.setBaseAndExtent(b.startContainer, b.startOffset, a.startContainer, a.startOffset);
    else selection.setBaseAndExtent(a.startContainer, a.startOffset, b.startContainer, b.startOffset);
  });
  const project = createProject('合成模态焦点验收');
  project.titlePage.show = false;
  project.elements = [{ id: 'modal-a', type: 'action', text: '合成<b>焦点</b>正文甲' }, { id: 'modal-b', type: 'action', text: '合成正文乙' }];
  localStorage.setItem('guangying:autosave', JSON.stringify({ project, filePath: null }));
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(App))));
  await act(async () => {
    state().setText('modal-b', '合成正文第一次'); state().breakHistoryGroup();
    state().setText('modal-b', '合成正文第二次'); state().undo();
  });
  check('fixture starts with both earlier writing undo and redo', [state().past.length, state().future.length], [1, 1]);

  for (let cycle = 0; cycle < 3; cycle++) {
    await selectWriting(cycle === 1, cycle === 2);
    const selected = rangeState(), before = snapshot();
    await menu('file:titlePage');
    check(`cycle ${cycle} accessible title`, document.getElementById(modal().getAttribute('aria-labelledby')).textContent, '标题页');
    check(`cycle ${cycle} autofocus title field`, document.activeElement.getAttribute('aria-label'), '剧名');
    inert(true);
    const first = q('.modal__head button'), last = q('.modal__foot button');
    if (cycle === 0) {
      const titleControls = [first, q('.modal input[type="checkbox"]'),
        ...modal().querySelectorAll('.field input, .field textarea'), last];
      await focus(first);
      for (let step = 1; step <= titleControls.length; step++) {
        await key(document.activeElement, 'Tab');
        check(`title Tab visits control ${step} without skipping fields`, document.activeElement, titleControls[step % titleControls.length]);
      }
      for (let step = 1; step <= titleControls.length; step++) {
        await key(document.activeElement, 'Tab', { shiftKey: true });
        check(`title ShiftTab visits control ${step} without skipping fields`, document.activeElement, titleControls[(titleControls.length - step) % titleControls.length]);
      }
    }
    await focus(last); const tab = await key(last, 'Tab');
    check(`cycle ${cycle} Tab wraps to first control`, [tab.defaultPrevented, document.activeElement === first], [true, true]);
    await key(first, 'Tab', { shiftKey: true });
    check(`cycle ${cycle} ShiftTab wraps to last control`, document.activeElement, last);
    const ime = await key(last, 'Escape', { isComposing: true });
    check(`cycle ${cycle} composing Escape leaves dialog/default intact`, [!!modal(), ime.defaultPrevented], [true, false]);
    await key(last, 'Escape', { keyCode: 229 });
    check(`cycle ${cycle} 229 Escape does not close`, !!modal());
    await dispatch(last, new w.CompositionEvent('compositionstart', { bubbles: true }));
    await key(last, 'Escape');
    check(`cycle ${cycle} tracked IME composition ignores plain Escape`, !!modal());
    await dispatch(last, new w.CompositionEvent('compositionend', { bubbles: true }));
    await key(last, 'Escape');
    check(`cycle ${cycle} Escape closes`, modal(), null);
    inert(false);
    check(`cycle ${cycle} writing focus restored`, document.activeElement.dataset.id, 'modal-a');
    check(`cycle ${cycle} formatted/cross-block/backward range restored`, rangeState(), selected);
    unchanged(`cycle ${cycle} modal lifecycle is not a project transaction`, before);
  }

  await menu('edit:find');
  const findInput = q('.find-panel input[aria-label="查找内容"]');
  await input(findInput, '合成未命中的查找词');
  findInput.setSelectionRange(1, 5, 'backward');
  const findBefore = snapshot();
  // Native IPC callbacks can arrive together before React commits the modal.
  await act(async () => {
    menuAction('file:settings');
    menuAction('edit:find');
    menuAction('view:board');
    menuAction('file:titlePage');
    w.dispatchEvent(new w.Event('guangying:find'));
  });
  check('pending modal request blocks same-turn native view/find/replacement commands',
    [state().view, document.getElementById(modal().getAttribute('aria-labelledby')).textContent], ['write', '显示简介设置']);
  check('existing find panel is inert while modal has focus',
    [!!findInput.closest('[inert]'), modal().contains(document.activeElement)], [true, true]);
  await menu('edit:find');
  check('native find leaves the existing query and modal focus intact',
    [q('.find-panel input[aria-label="查找内容"]') === findInput, findInput.value, modal().contains(document.activeElement)],
    [true, '合成未命中的查找词', true]);
  await key(document.activeElement, 'Escape');
  check('modal close restores pre-existing find input and backward input selection',
    [document.activeElement === findInput, findInput.selectionStart, findInput.selectionEnd, findInput.selectionDirection], [true, 1, 5, 'backward']);
  check('existing find panel is interactive after modal close', !!findInput.closest('[inert]'), false);
  unchanged('find/modal handoff leaves project and history unchanged', findBefore);
  await key(findInput, 'Escape');
  check('find keeps its own Escape lifecycle after modal closes', q('.find-panel'), null);

  await focus(settings()); await click(settings());
  check('settings autofocus active page tab', document.activeElement.textContent, '版式');
  for (const label of ['元素缩进', '修订', '外观', '常规', '版式']) {
    const button = [...q('.modal .tabs').querySelectorAll('button')].find(node => node.textContent === label);
    await focus(button); await click(button);
    await focus(q('.modal__foot button')); await key(document.activeElement, 'Tab');
    check(`${label} Tab uses current mounted controls`, document.activeElement, q('.modal__head button'));
    await key(document.activeElement, 'Tab', { shiftKey: true });
    check(`${label} reverse Tab stays inside modal`, document.activeElement, q('.modal__foot button'));
  }
  let before = snapshot();
  const number = q('.modal input[type="number"]');
  await focus(number);
  for (const action of ['edit:find', 'view:cards', 'view:board', 'view:preview', 'view:reports', 'view:sidebar', 'element:character', 'element:insertScene', 'element:dual', 'element:omit', 'file:new', 'file:open', 'file:save', 'file:saveAs', 'file:importText', 'file:exportPdf', 'file:settings', 'file:titlePage']) await menu(action);
  await act(async () => w.dispatchEvent(new w.Event('guangying:find')));
  check('native/custom find never creates panel under modal', q('.find-panel'), null);
  check('native file commands are not invoked', fileCalls, []);
  check('repeat native modal requests do not replace settings', document.getElementById(modal().getAttribute('aria-labelledby')).textContent, '显示简介设置');
  for (const name of ['f', 's', 'o', 'n', 'p', 'd', '1', '2']) check(`modal prevents browser shortcut Ctrl+${name}`, (await key(number, name, { ctrlKey: true })).defaultPrevented);
  await click([...q('.toolbar__views').querySelectorAll('button')].find(node => node.textContent === '自由板'));
  await click(q('.toolbar [title="插入新场景 ⌘/Ctrl+Enter"]'));
  await click(q('.toolbar [title="查找正文 ⌘/Ctrl+F"]'));
  const outsideKey = await key(writing('modal-a'), 'Tab');
  check('stale background keyboard event is rejected', outsideKey.defaultPrevented);
  await focus(writing('modal-a'));
  check('programmatic background focus returns inside', modal().contains(document.activeElement));
  unchanged('commands and stale background events preserve project/UI history', before);

  await focus(number);
  await menu('edit:undo'); await menu('edit:redo');
  await key(number, 'z', { ctrlKey: true }); await key(number, 'z', { ctrlKey: true, shiftKey: true });
  unchanged('modal cannot undo/redo pre-opening writing snapshots', before);
  const openingProject = state().project, originalSize = state().project.settings.fontSize;
  await input(number, String(originalSize + 2));
  check('setting keeps existing immediate store update', state().project.settings.fontSize, originalSize + 2);
  const edited = state().project;
  await key(number, 'z', { ctrlKey: true });
  check('setting undo returns exactly to opening project', state().project, openingProject);
  before = snapshot(); await key(number, 'z', { ctrlKey: true });
  unchanged('second setting undo cannot cross into writing', before);
  await menu('edit:redo'); check('modal-native redo restores this session setting', state().project, edited);
  const undoInput = new w.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyUndo' });
  await dispatch(number, undoInput);
  check('context historyUndo uses guarded project route', [undoInput.defaultPrevented, state().project === openingProject], [true, true]);
  before = snapshot();
  await dispatch(number, new w.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyUndo' }));
  unchanged('context undo also respects session boundary', before);
  await key(number, 'y', { ctrlKey: true }); check('modal CtrlY routes session redo', state().project, edited);

  await click([...q('.modal .tabs').querySelectorAll('button')].find(node => node.textContent === '外观'));
  const hex = [...modal().querySelectorAll('input')].find(node => node.type === 'text');
  await input(hex, '#123456');
  before = snapshot(); const nativeStart = nativeCalls.length;
  const nativeUndo = await key(hex, 'z', { ctrlKey: true });
  check('existing local appearance field retains native keyboard undo', nativeUndo.defaultPrevented, false);
  await menu('edit:undo'); await menu('edit:redo');
  check('local native menu history follows existing owner', nativeCalls.slice(nativeStart), ['undo', 'redo']);
  unchanged('local native history never changes screenplay history', before);
  await click(q('.modal__head button'));
  check('closing settings restores its trigger', document.activeElement, settings());
  inert(false);
  const unload = new w.Event('beforeunload', { cancelable: true });
  await dispatch(w, unload);
  check('modal handling has not weakened unsaved-close protection', unload.defaultPrevented);

  // The next modal starts a new boundary; previous modal edits become background
  // history, even when using the same component under StrictMode.
  await focus(settings()); await click(settings()); before = snapshot();
  await menu('edit:undo'); unchanged('new modal cannot undo prior modal session', before);
  await dispatch(q('.modal-backdrop'), new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  check('backdrop retains isolation through pointer release', !!modal());
  inert(true);
  await click(q('.modal-backdrop'));
  check('backdrop dismisses and restores trigger', [modal(), document.activeElement === settings()], [null, true]);

  const fileTrigger = q('[aria-haspopup="menu"]');
  await focus(fileTrigger); await click(fileTrigger);
  await click([...q('[role="menu"]').querySelectorAll('[role="menuitem"]')].find(node => node.textContent.includes('标题页')));
  check('file menu and modal are mutually exclusive', [!!modal(), !!q('[role="menu"]')], [true, false]);
  await key(document.activeElement, 'Escape');
  check('menu-launched modal returns to stable file trigger', document.activeElement, fileTrigger);

  const priorTitle = state().project.titlePage.title, priorPast = state().past.length;
  await menu('file:titlePage'); await input(q('.modal input[aria-label="剧名"]'), '合成标题第一轮');
  check('title fields retain immediate project updates', state().project.titlePage.title, '合成标题第一轮');
  await key(document.activeElement, 'Escape');
  const firstTitleProject = state().project;
  await menu('file:titlePage'); await input(q('.modal input[aria-label="剧名"]'), '合成标题第二轮');
  check('separate title modal sessions never coalesce', state().past.length, priorPast + 2);
  await menu('edit:undo');
  check('second title session undo returns to first title snapshot', state().project, firstTitleProject);
  before = snapshot(); await menu('edit:undo');
  unchanged('second title session cannot undo first session', before);
  const modalUnload = new w.Event('beforeunload', { cancelable: true });
  await dispatch(w, modalUnload);
  check('unsaved-close protection also runs while modal is open', [modalUnload.defaultPrevented, !!modal()], [true, true]);
  await key(document.activeElement, 'Escape'); await menu('edit:undo');
  check('after closing, normal project undo remains available', state().project.titlePage.title, priorTitle);

  await act(async () => {
    state().mutate(p => {
      p.beats = [
        { id: 'modal-beat-a', kind: 'beat', title: '合成原始卡片', text: '', x: 0, y: 0, color: '#abc' },
        { id: 'modal-beat-b', kind: 'beat', title: '合成另一卡片', text: '', x: 300, y: 0, color: '#abc' },
      ];
      p.boardLinks = [{ id: 'modal-link', from: 'beat:modal-beat-a', to: 'beat:modal-beat-b', note: '合成原始关系' }];
    });
    state().setView('board');
  });
  for (const [label, display, edit, value, modelValue] of [
    ['card title', '.bcard[data-id="modal-beat-a"] .bcard__media-title[role="button"]', '.bcard[data-id="modal-beat-a"] input.bcard__media-title', '合成失焦卡片提交', () => state().project.beats[0].title],
    ['link note', '[data-link-id="modal-link"] .board-link__label', '[data-link-id="modal-link"] .board-link__input', '合成失焦关系提交', () => state().project.boardLinks[0].note],
  ]) {
    await dispatch(q(display), new w.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await input(q(edit), value);
    check(`${label} starts as an uncommitted local draft`, modelValue() !== value);
    await menu('file:settings');
    check(`${label} blur commits its existing draft before modal session`, modelValue(), value);
    check(`${label} blur callback cannot steal modal autofocus`, modal().contains(document.activeElement));
    before = snapshot(); await menu('edit:undo');
    unchanged(`${label} handoff commit stays outside modal undo boundary`, before);
    await key(document.activeElement, 'Escape');
    check(`${label} closed modal restores replacement control`, document.activeElement, q(display));
    await menu('edit:undo');
    check(`${label} background commit remains normally undoable after closing`, modelValue() !== value);
  }

  await focus(settings()); await click(settings());
  await click([...q('.modal .tabs').querySelectorAll('button')].find(node => node.textContent === '修订'));
  const removeRevision = [...modal().querySelectorAll('button')].find(node => node.textContent.trim() === '删除');
  await focus(removeRevision); await click(removeRevision);
  check('removing the focused revision row repairs focus inside modal', modal().contains(document.activeElement));
  await key(document.activeElement, 'Tab');
  check('Tab remains usable after focused control is removed', modal().contains(document.activeElement));
  await key(document.activeElement, 'Escape');

  // Unmount with modal open must restore pre-existing inert/aria state and remove
  // all document listeners; a later App mount must not inherit a closed trap.
  q('.statusbar').setAttribute('aria-hidden', 'false');
  await menu('file:titlePage');
  const oldStatus = q('.statusbar');
  await act(async () => root.unmount()); root = null;
  check('unmount restores pre-existing aria-hidden value', oldStatus.getAttribute('aria-hidden'), 'false');
  check('unmount removes only the inert it added', oldStatus.hasAttribute('inert'), false);
  const probe = document.createElement('button'); document.body.append(probe); probe.focus();
  check('unmounted trap does not intercept later focus', document.activeElement, probe);
  const normalTab = await key(probe, 'Tab'); check('unmounted trap no longer intercepts Tab', normalTab.defaultPrevented, false);
  probe.remove();
  root = createRoot(document.getElementById('root'));
  w.api.isElectron = true;
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(App))));
  await menu('file:settings'); check('fresh Electron-mode App has one live dialog', document.querySelectorAll('[aria-modal="true"]').length, 1);
  before = snapshot(); await menu('view:cards'); unchanged('Electron menu callback respects new modal boundary', before);
  await key(document.activeElement, 'Escape'); inert(false);
  check('React/window report no modal errors', errors, []);
  console.log(`modal UI: ${checks} checks passed (actual App + StrictMode; synthetic events, memory menu and native-history spies only)`);
})().catch(error => { originalError(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (root) await act(async () => root.unmount());
  console.error = originalError;
  dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
});
