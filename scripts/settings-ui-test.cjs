/** Real App/SettingsDialog/store; synthetic projects and memory-only recovery.
 * jsdom verifies draft validation, accessibility, focus and modal history routing.
 * It does not emulate native input undo, browser layout or a system file picker.
 */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: 'http://settings-ui-test.invalid/', pretendToBeVisual: true,
});
const w = dom.window;
const originals = new Map();
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
  'Node', 'NodeFilter', 'Element', 'Event', 'InputEvent', 'KeyboardEvent', 'MouseEvent', 'FocusEvent',
  'CompositionEvent', 'DOMParser', 'Range', 'getComputedStyle', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? w : w[key] });
}
originals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.HTMLElement.prototype.scrollIntoView = () => {};
let menuAction, root, checks = 0;
const fileCalls = [], nativeHistory = [], errors = [];
w.api = {
  isElectron: false,
  onMenu(callback) { menuAction = callback; return () => { menuAction = null; }; },
  async openProject() { fileCalls.push('open'); return null; },
  async saveProject() { fileCalls.push('save'); return null; },
  async saveProjectAs() { fileCalls.push('saveAs'); return null; },
  async exportPdf() { fileCalls.push('pdf'); return null; },
};
document.execCommand = command => { nativeHistory.push(command); return true; };
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
w.addEventListener('error', event => errors.push(event.message));
const check = (label, actual, expected = true) => {
  assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`);
};
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, String(value)); } };
}

(async () => {
  const built = await require('esbuild').build({
    stdin: { contents: `export { default as App } from './src/App';
      export { useStore } from './src/store/store';
      export { createProject } from './src/model/project';
      export { ELEMENT_META } from './src/model/elements';
      export { serializeProject, parseProject } from './src/io/zhsp';
      export { writeRecovery, readRecovery } from './src/app/autosaveStorage';`, resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    loader: { '.css': 'empty', '.png': 'dataurl' }, logLevel: 'silent',
  });
  const filename = path.join(repo, '.settings-ui-memory.cjs');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(repo);
  mod._compile(built.outputFiles[0].text, filename);
  const { App, useStore, createProject, ELEMENT_META, serializeProject, parseProject, writeRecovery, readRecovery } = mod.exports;
  const state = () => useStore.getState();
  const q = selector => document.querySelector(selector);
  const modal = () => q('[role="dialog"][aria-modal="true"]');
  const settingsButton = () => [...q('.toolbar').querySelectorAll('button')].find(node => node.textContent.trim() === '设置');
  const field = label => {
    const node = [...modal().querySelectorAll('input')].find(input => input.getAttribute('aria-label') === label);
    assert.ok(node, `Missing accessible settings field: ${label}`);
    return node;
  };
  const dispatch = (node, event) => act(async () => { node.dispatchEvent(event); });
  const click = node => dispatch(node, new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const key = async (node, keyName, props = {}) => {
    const event = new w.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...props });
    await dispatch(node, event); return event;
  };
  const menu = action => act(async () => { assert.equal(typeof menuAction, 'function'); menuAction(action); });
  const input = (node, value) => act(async () => {
    node.focus();
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  const tab = async label => {
    const button = [...modal().querySelectorAll('.tabs button')].find(node => node.textContent === label);
    assert.ok(button, `Missing settings tab: ${label}`); await click(button);
  };
  const snapshot = () => {
    const s = state();
    const refs = { project: s.project, past: s.past, future: s.future, dirty: s.dirty,
      version: s.version, filePath: s.filePath, epoch: s.documentEpoch };
    return { refs, json: JSON.stringify(refs) };
  };
  const unchanged = (label, before) => {
    const after = snapshot();
    for (const name of Object.keys(before.refs)) assert.strictEqual(after.refs[name], before.refs[name], `${label}: ${name}`);
    check(label, after.json, before.json);
  };
  const content = project => ({ elements: project.elements, beats: project.beats, boardLinks: project.boardLinks,
    sceneMeta: project.sceneMeta, acts: project.acts, revisions: project.revisions, titlePage: project.titlePage });
  const linkedError = node => [...new Set([
    ...(node.getAttribute('aria-describedby') || '').split(/\s+/),
    ...(node.getAttribute('aria-errormessage') || '').split(/\s+/),
  ].filter(Boolean))].map(id => {
    const error = document.getElementById(id);
    assert.ok(error && modal().contains(error), `Accessible error target must exist: ${id}`);
    return error.textContent.trim();
  }).join(' ');
  const clearError = (label, node) => {
    check(`${label}: validation error clears`, node.getAttribute('aria-invalid') === 'true', false);
    check(`${label}: valid value uses project history`, !!node.closest('[data-native-edit-history]'), false);
  };

  const project = createProject('仅合成设置持久化验收');
  project.titlePage.show = false;
  project.elements = [
    { id: 'settings-a', type: 'action', text: '合成<b>格式正文</b>甲<br>续行' },
    { id: 'settings-b', type: 'action', text: '合成正文乙' },
  ];
  project.beats = [{ id: 'settings-image', kind: 'image', title: '合成图片卡片', text: '合成备注',
    img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMIqAj4DwAETAIY7NJ6TgAAAABJRU5ErkJggg==',
    color: '#fff7d6', x: 820, y: 80, boardX: 320, boardY: 160, w: 240, h: 180 }];
  localStorage.setItem('guangying:autosave', JSON.stringify({ project, filePath: '/synthetic/设置 合成工程.zhsp' }));
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(App))));
  await act(async () => {
    state().setText('settings-b', '合成正文已提交历史'); state().breakHistoryGroup();
    state().setText('settings-b', '合成正文可重做历史'); state().undo();
    // Simulate the existing saved marker only; no native save or filesystem access.
    state().markSaved('/synthetic/设置 合成工程.zhsp');
  });
  check('fixture has saved content plus both writing undo and redo',
    [state().dirty, state().past.length, state().future.length], [false, 1, 1]);
  const originalContent = JSON.parse(JSON.stringify(content(state().project)));
  await act(async () => settingsButton().focus()); await click(settingsButton());
  check('real SettingsDialog opens through App', !!modal());
  const opening = snapshot(), openingProject = state().project;
  await menu('edit:undo'); await menu('edit:redo');
  unchanged('settings session cannot consume pre-existing writing history', opening);

  const indentLabel = `${ELEMENT_META.action.label}左缩进`;
  const invalidCases = [
    { tab: '版式', label: '行距（倍）', raw: '0.4', reason: /0\.5|行距|范围/ },
    { tab: '版式', label: '字号（pt）', raw: '145', reason: /144|字号|范围/ },
    { tab: '版式', label: '字号（pt）', raw: '', reason: /输入|数字|数值|完整/ },
    { tab: '版式', label: '左边距（cm）', raw: '30', reason: /宽|版心|正文|可用|页面/ },
    { tab: '版式', label: '上边距（cm）', raw: '29', reason: /高|版心|正文|可用|页面|行/ },
    { tab: '元素缩进', label: indentLabel, raw: '10001', reason: /10000|缩进|范围/ },
  ];
  for (const test of invalidCases) {
    await tab(test.tab);
    const node = field(test.label), previous = node.value, before = snapshot();
    await input(node, test.raw);
    unchanged(`${test.label}=${test.raw}: rejected draft preserves project, saved marker, version and both history stacks`, before);
    check(`${test.label}: invalid raw value remains visible without clamping`, node.value, test.raw);
    check(`${test.label}: input identity and focus survive validation`, [field(test.label) === node, document.activeElement === node], [true, true]);
    check(`${test.label}: accessibility marks invalid value`, node.getAttribute('aria-invalid'), 'true');
    const message = linkedError(node);
    check(`${test.label}: associated error explains the invalid value`, message.length >= 4 && test.reason.test(message));
    check(`${test.label}: invalid draft owns only local native history`, !!node.closest('[data-native-edit-history]'));
    const undo = await key(node, 'z', { ctrlKey: true });
    check(`${test.label}: native input undo remains available`, undo.defaultPrevented, false);
    const nativeStart = nativeHistory.length;
    await menu('edit:undo'); await menu('edit:redo');
    check(`${test.label}: menu history stays with local input`, nativeHistory.slice(nativeStart), ['undo', 'redo']);
    const beforeInput = new w.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyUndo' });
    await dispatch(node, beforeInput);
    check(`${test.label}: browser history input is not redirected to project`, beforeInput.defaultPrevented, false);
    unchanged(`${test.label}: invalid-draft history never changes the project`, before);
    await input(node, previous);
    clearError(test.label, node);
    unchanged(`${test.label}: returning to existing value creates no project transaction`, before);
  }
  unchanged('all invalid drafts preserve earlier writing undo and redo', opening);

  // A related accepted edit may make an earlier draft numerically valid. It
  // remains unapplied until another explicit input; no silent validation clear.
  await tab('版式');
  const left = field('左边距（cm）'), right = field('右边距（cm）');
  const beforeDependentDraft = snapshot();
  await input(left, '20');
  unchanged('left margin 20 is rejected while right margin 2.5 leaves insufficient width', beforeDependentDraft);
  check('initial dependent margin draft reports an accessible geometry error',
    left.getAttribute('aria-invalid') === 'true' && /宽|版心|正文|可用|页面/.test(linkedError(left)));
  await input(right, '0');
  check('related right-margin edit commits only its own value',
    [state().project.settings.marginLeft, state().project.settings.marginRight], [openingProject.settings.marginLeft, 0]);
  check('now-valid but unapplied left draft remains visibly invalid',
    [left.value, left.getAttribute('aria-invalid')], ['20', 'true']);
  check('pending draft explains that explicit re-entry is required', /尚未应用|未应用|重新输入|确认/.test(linkedError(left)));
  check('pending draft keeps local history despite becoming geometrically valid', !!left.closest('[data-native-edit-history]'));
  const beforeConfirm = snapshot();
  // Re-entering a number means replacing the field contents, not fabricating a
  // same-value React change event that the browser would never dispatch.
  await input(left, '');
  unchanged('clearing pending margin draft writes no fallback or zero into the store', beforeConfirm);
  check('empty margin draft remains focused, visible and invalid',
    [left.value, document.activeElement === left, left.getAttribute('aria-invalid')], ['', true, 'true']);
  await input(left, '20');
  check('explicit re-entry now commits the geometrically valid left margin',
    [state().project.settings.marginLeft, state().project.settings.marginRight], [20, 0]);
  clearError('confirmed dependent margin', left);
  check('confirmed cross-field margins survive save and reload',
    parseProject(serializeProject(state().project)).settings, state().project.settings);
  await menu('edit:undo'); await menu('edit:undo');
  check('session undo restores original settings after cross-field margin edits', state().project, openingProject);
  check('cross-field margin edits and undo preserve body and cards', content(state().project), originalContent);

  // The same margins can be safe on A4 and unsafe on shorter Letter paper.
  const top = field('上边距（cm）');
  const paper = modal().querySelector('select[aria-label="纸张"]');
  assert.ok(paper, 'Paper choice must have an accessible label');
  const selectPaper = value => act(async () => {
    paper.focus();
    Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, 'value').set.call(paper, value);
    paper.dispatchEvent(new w.Event('change', { bubbles: true }));
  });
  await input(top, '25');
  check('A4 accepts top 25 and bottom 2.5 with 22 mm available height',
    [state().project.settings.paper, state().project.settings.marginTop, state().project.settings.marginBottom], ['A4', 25, 2.5]);
  const beforePaperRejection = snapshot();
  await selectPaper('letter');
  unchanged('Letter rejection preserves accepted A4 project, version and history', beforePaperRejection);
  check('rejected paper selection displays the actual stored A4 value and keeps focus',
    [paper.value, state().project.settings.paper, document.activeElement === paper], ['A4', 'A4', true]);
  check('paper selection has an associated insufficient-height error',
    paper.getAttribute('aria-invalid') === 'true' && /高|版心|正文|可用|页面|行/.test(linkedError(paper)));
  await input(top, String(openingProject.settings.marginTop));
  await selectPaper('letter');
  check('Letter commits once the dependent top margin is corrected', state().project.settings.paper, 'letter');
  clearError('corrected paper selection', paper);
  const reloadedLetter = parseProject(serializeProject(state().project));
  check('corrected Letter geometry saves and reloads with exact settings', reloadedLetter.settings, state().project.settings);
  check('paper changes preserve formatted text, embedded image and card geometry', content(reloadedLetter), originalContent);
  await menu('edit:undo'); await menu('edit:undo'); await menu('edit:undo');
  check('session undo restores original settings after dependent paper changes', state().project, openingProject);

  const validCases = [
    { tab: '版式', label: '字号（pt）', value: 14, get: s => s.fontSize },
    { tab: '版式', label: '行距（倍）', value: 1.75, get: s => s.lineHeight },
    ...[['上边距（cm）', 'marginTop'], ['下边距（cm）', 'marginBottom'], ['左边距（cm）', 'marginLeft'], ['右边距（cm）', 'marginRight']]
      .map(([label, name]) => ({ tab: '版式', label, value: 2.8, get: s => s[name] })),
    { tab: '元素缩进', label: indentLabel, value: 3, get: s => s.indent.action.left },
  ];
  for (const test of validCases) {
    await tab(test.tab);
    const node = field(test.label), before = state().project, previous = test.get(before.settings);
    if (test.label === '行距（倍）') {
      const beforeCorrection = snapshot();
      await input(node, '0.4');
      unchanged('invalid line-height draft also preserves an already dirty project and settings history', beforeCorrection);
      check('direct correction begins with the invalid local draft still visible',
        [node.value, node.getAttribute('aria-invalid')], ['0.4', 'true']);
    }
    await input(node, String(test.value));
    const after = state().project;
    check(`${test.label}: valid input immediately updates store`, test.get(after.settings), test.value);
    check(`${test.label}: valid input keeps the mounted field focused`, [field(test.label) === node, document.activeElement === node], [true, true]);
    check(`${test.label}: accepted edit marks the project dirty`, state().dirty);
    clearError(test.label, node);
    await key(node, 'z', { ctrlKey: true });
    check(`${test.label}: project undo restores the exact preceding snapshot`, state().project, before);
    check(`${test.label}: visible input follows project undo`, Number(field(test.label).value), previous);
    await key(field(test.label), 'z', { ctrlKey: true, shiftKey: true });
    check(`${test.label}: project redo restores the accepted edit`, state().project, after);
    check(`${test.label}: visible input follows project redo`, Number(field(test.label).value), test.value);
    check(`${test.label}: formatting edits preserve all text, cards and metadata`, content(state().project), originalContent);
  }
  const accepted = state().project;
  const beforeRoundtrip = snapshot();
  const parsed = parseProject(serializeProject(accepted));
  check('valid UI settings survive serializeProject and parseProject without value drift', parsed.settings, accepted.settings);
  check('project roundtrip preserves formatted body, image bytes, geometry and metadata', content(parsed), originalContent);
  const memory = memoryStorage();
  writeRecovery(memory, { project: parsed, filePath: state().filePath });
  const restored = readRecovery(memory);
  check('roundtripped settings remain a readable current recovery point', [restored.source, restored.warning], ['current', null]);
  check('memory recovery preserves every parsed project field and the associated path', restored.snapshot, { project: parsed, filePath: state().filePath });
  unchanged('serialization and recovery leave live project/history/dirty/version untouched', beforeRoundtrip);

  for (let index = 0; index < validCases.length; index++) await menu('edit:undo');
  check('all settings edits undo exactly to this session opening project', state().project, openingProject);
  const boundary = snapshot(); await menu('edit:undo');
  unchanged('one more undo cannot cross into earlier writing', boundary);
  for (let index = 0; index < validCases.length; index++) await menu('edit:redo');
  check('all settings edits redo after boundary protection', state().project, accepted);

  await tab('版式');
  const line = field('行距（倍）'), beforeDraft = snapshot();
  await input(line, '0.4');
  check('new invalid draft is visible before closing', [line.value, line.getAttribute('aria-invalid')], ['0.4', 'true']);
  await key(line, 'Escape');
  check('Escape closes the settings dialog', modal(), null);
  unchanged('closing invalid draft keeps accepted project/history unchanged', beforeDraft);
  check('closing settings returns focus to the live toolbar trigger', document.activeElement, settingsButton());
  await click(settingsButton());
  const reopened = field('行距（倍）');
  check('reopening drops old invalid draft and displays accepted value', reopened.value, '1.75');
  clearError('reopened line height', reopened);
  check('reopened dialog carries no stale validation errors', modal().querySelectorAll('[aria-invalid="true"]').length, 0);
  const freshBoundary = snapshot(); await menu('edit:undo');
  unchanged('new settings session cannot undo edits from the previous session', freshBoundary);
  await key(document.activeElement, 'Escape');
  await menu('edit:undo');
  check('after closing, normal project undo remains available', state().project.settings.indent.action.left, openingProject.settings.indent.action.left);
  await menu('edit:redo');
  check('after closing, normal redo restores all accepted settings', state().project, accepted);
  check('settings never call native file or export operations', fileCalls, []);
  check('React and window report no settings errors', errors, []);
  console.log(`settings UI: ${checks} checks passed (actual App/SettingsDialog/store, memory serialization/recovery; no browser or native picker)`);
})().catch(error => { originalError(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (root) await act(async () => root.unmount());
  console.error = originalError;
  dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
});
