/** Real App/components + synthetic store history. All localStorage and menu IPC
 * below are jsdom/in-memory mocks. Native text undo/default editing is NOT
 * implemented by jsdom; this suite verifies ownership and routing only.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://native-draft-history-test.invalid/', pretendToBeVisual: true });
const w = dom.window;
const originals = new Map();
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'NodeFilter', 'Element', 'Event', 'InputEvent', 'KeyboardEvent', 'MouseEvent', 'DOMParser', 'Range', 'getComputedStyle', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? w : w[key] });
}
originals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.HTMLElement.prototype.scrollIntoView = () => {};
let menuAction;
w.api = { isElectron: false, onMenu(callback) { menuAction = callback; return () => { menuAction = null; }; } };
const nativeCalls = [];
document.execCommand = direction => { nativeCalls.push(direction); return true; };
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
w.addEventListener('error', event => errors.push(event.message));
let checks = 0, groups = 0, mounted;
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); };

(async () => {
  const built = await require('esbuild').build({
    stdin: { contents: "export { default as App } from './src/App'; export { useStore } from './src/store/store'; export { createProject } from './src/model/project'; export { ownsNativeHistory,runEditHistory } from './src/utils/editHistory';", resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty', '.png': 'dataurl' }, logLevel: 'silent',
  });
  const mod = new Module(path.join(repo, '.native-draft-history-memory.cjs'), module);
  mod.filename = path.join(repo, '.native-draft-history-memory.cjs');
  mod.paths = Module._nodeModulePaths(repo);
  mod._compile(built.outputFiles[0].text, mod.filename);
  const { App, useStore, createProject, ownsNativeHistory, runEditHistory } = mod.exports;
  const state = () => useStore.getState();
  const q = selector => document.querySelector(selector);
  const buttons = () => [...document.querySelectorAll('button')];
  const click = node => act(async () => node.dispatchEvent(new w.MouseEvent('click', { bubbles: true })));
  const input = (node, value) => act(async () => {
    node.focus();
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  const snapshot = () => ({ project: state().project, serialized: JSON.stringify(state().project), past: state().past, future: state().future, dirty: state().dirty, version: state().version, documentEpoch: state().documentEpoch });
  const unchanged = (label, saved) => check(label, [state().project === saved.project, JSON.stringify(state().project) === saved.serialized, state().past === saved.past, state().future === saved.future, state().dirty === saved.dirty, state().version === saved.version, state().documentEpoch === saved.documentEpoch], [true, true, true, true, true, true, true]);
  const nativeOwner = async (label, node) => {
    await act(async () => node.focus());
    check(`${label} declares native history ownership`, ownsNativeHistory(node));
    const saved = snapshot(), callStart = nativeCalls.length;
    for (const shiftKey of [false, true]) {
      const key = new w.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey, bubbles: true, cancelable: true });
      await act(async () => node.dispatchEvent(key));
      check(`${label} browser ${shiftKey ? 'redo' : 'undo'} remains native default`, key.defaultPrevented, false);
    }
    check(`${label} browser route does not also execute a programmatic native command`, nativeCalls.length, callStart);
    unchanged(`${label} browser keys never undo project or change history`, saved);
    await act(async () => { menuAction('edit:undo'); menuAction('edit:redo'); });
    check(`${label} actual App menu mapper routes only native undo/redo`, nativeCalls.slice(callStart), ['undo', 'redo']);
    unchanged(`${label} menu route preserves project/past/future/dirty/version/epoch`, saved);
  };

  mounted = createRoot(document.getElementById('root'));
  await act(async () => mounted.render(React.createElement(App)));
  await act(async () => [...document.querySelectorAll('.startup button')]
    .find(button => button.textContent.includes('新建剧本')).click());
  const p = createProject('合成本地草稿历史');
  p.titlePage.show = false;
  p.elements = [
    { id: 'head-a', type: 'scene_heading', text: '内景 合成棚 日' },
    { id: 'action-a', type: 'action', text: '合成原始动作' },
    { id: 'character-a', type: 'character', text: '合成甲' },
    { id: 'dialogue-a', type: 'dialogue', text: '合成甲对白' },
    { id: 'head-b', type: 'scene_heading', text: '外景 合成园 夜' },
    { id: 'character-b', type: 'character', text: '合成乙' },
    { id: 'dialogue-b', type: 'dialogue', text: '合成乙对白' },
  ];
  p.sceneMeta = [{ id: 'meta-a', elementId: 'head-a', title: '', synopsis: '合成摘要', color: '#abc' }];
  await act(async () => {
    state().loadProject(p);
    state().setText('action-a', '合成第一次修改');
    state().breakHistoryGroup();
    state().setText('action-a', '合成第二次修改');
    state().undo();
    useStore.setState({ view: 'reports', sidebar: 'navigator', sidebarOpen: true, activeId: 'action-a', focus: null });
  });
  check('real App fixture has both undo and redo available', [state().past.length, state().future.length], [1, 1]);
  check('in-memory App menu callback is connected', typeof menuAction, 'function');

  const reportFilter = q('[aria-label="筛选人物"]'), reportBefore = snapshot();
  await input(reportFilter, '合成乙');
  check('real React report filter state responds to input event', [...q('.report-matrix tbody').querySelectorAll('.character-name-edit')].map(node => node.value), ['合成乙']);
  unchanged('report filtering itself never changes project history', reportBefore);
  await nativeOwner('report person filter', reportFilter);
  check('report local query remains intact after routing checks', reportFilter.value, '合成乙');
  const nameDraft = q('.report-matrix .character-name-edit');
  await nativeOwner('uncommitted report rename field', nameDraft);
  groups++;

  const sceneSearch = q('.panel__search'), sidebarBefore = snapshot();
  await input(sceneSearch, '合成棚');
  check('real React sidebar filter state narrows scene list', q('.panel__list').querySelectorAll('.nav-item').length, 1);
  unchanged('sidebar filtering itself never changes project history', sidebarBefore);
  await nativeOwner('sidebar scene search', sceneSearch);
  check('sidebar query remains intact after routing checks', sceneSearch.value, '合成棚');
  groups++;

  await click(buttons().find(node => node.textContent.trim() === '设置'));
  await click([...q('.modal .tabs').querySelectorAll('button')].find(node => node.textContent === '外观'));
  const colorField = q('.modal input[type="color"]');
  const hexField = [...q('.modal').querySelectorAll('input')].find(node => node.type === 'text');
  const colorBefore = snapshot();
  await input(hexField, '#123456');
  check('HEX preference input really updates local appearance', state().fontColor, '#123456');
  unchanged('local appearance change does not join project history', colorBefore);
  await nativeOwner('local appearance HEX input', hexField);
  await nativeOwner('local appearance color control', colorField);
  groups++;

  await click([...q('.modal .tabs').querySelectorAll('button')].find(node => node.textContent === '版式'));
  const modelNumber = q('.modal input[type="number"]');
  check('project-backed setting is not accidentally classified as a draft', ownsNativeHistory(modelNumber), false);
  const beforeSetting = state().project, previousSize = state().project.settings.fontSize;
  await input(modelNumber, String(previousSize + 1));
  check('project setting input still writes its original store action', state().project.settings.fontSize, previousSize + 1);
  const settingNativeCalls = nativeCalls.length;
  const undoKey = new w.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
  await act(async () => modelNumber.dispatchEvent(undoKey));
  check('project-backed web undo still prevents native default', undoKey.defaultPrevented);
  check('project-backed web undo restores exact project snapshot', state().project, beforeSetting);
  check('project-backed web undo does not call native text command', nativeCalls.length, settingNativeCalls);
  await click(q('.modal__head button'));
  groups++;

  await click(q('.toolbar [title="查找正文 ⌘/Ctrl+F"]'));
  const findInput = q('[aria-label="查找内容"]');
  await input(findInput, '不存在的合成查询');
  check('find panel local query really updates React state', q('.find-panel [role="status"]').textContent, '没有找到匹配内容');
  await nativeOwner('existing find-panel query container', findInput);
  await click(q('[aria-label="关闭查找"]'));
  await act(async () => { useStore.setState({ sidebar: 'inspector', activeId: 'action-a' }); });
  check('model-backed scene synopsis remains project-owned', ownsNativeHistory(q('.sidebar textarea')), false);
  groups++;

  // The board fields are existing commit-on-blur drafts; fixed-source checks
  // ensure the audit does not silently drop their explicit ownership markers.
  const board = fs.readFileSync(path.join(repo, 'src/components/BoardView.tsx'), 'utf8');
  check('existing board title draft is explicitly native-owned', /<input[^>]*data-native-edit-history[^>]*className="bcard__media-title"/.test(board));
  check('existing board relation draft is explicitly native-owned', /<input[^>]*data-native-edit-history[^>]*className="board-link__input"/.test(board));
  groups++;

  // App boot must treat recovered writing as unsaved until a real file save.
  // These are only jsdom origins/fixtures; no actual user storage is accessed.
  const remount = async raw => {
    await act(async () => mounted.unmount()); mounted = null;
    localStorage.removeItem('guangying:autosave'); localStorage.removeItem('mojiang:autosave');
    localStorage.setItem('guangying:startup-preference', 'resume');
    if (raw !== null) localStorage.setItem('guangying:autosave', raw);
    mounted = createRoot(document.getElementById('root'));
    await act(async () => mounted.render(React.createElement(App)));
  };
  const recovery = createProject('合成恢复未保存正文');
  recovery.titlePage.show = false;
  recovery.elements = [{ id: 'recovery-edit', type: 'action', text: '不能静默丢弃的合成恢复正文' }];
  await remount(JSON.stringify({ project: recovery, filePath: '/synthetic/recovered.zhsp' }));
  check('valid old autosave restores exact text and file association', [state().project.elements[0].text, state().filePath], [recovery.elements[0].text, '/synthetic/recovered.zhsp']);
  check('recovered autosave is conservatively dirty, without fabricated history', [state().dirty, state().past.length, state().future.length], [true, 0, 0]);
  let discardCalls = 0;
  w.confirm = () => { discardCalls++; return false; };
  w.api.openProject = async () => ({ path: '/synthetic/other.zhsp', content: JSON.stringify(createProject('合成另一稿')) });
  const recoveredState = snapshot();
  await act(async () => { menuAction('file:open'); await Promise.resolve(); });
  check('opening another document asks before discarding recovered autosave', discardCalls, 1);
  unchanged('cancelled recovered-draft discard retains project and history', recoveredState);
  await act(async () => state().markSaved('/synthetic/recovered.zhsp', { project: state().project, documentEpoch: state().documentEpoch }));
  check('explicit successful exact-snapshot save can still clear recovery dirty', state().dirty, false);
  await remount(null);
  check('no autosave starts a clean blank template', [state().project.name, state().dirty, state().project.elements.every(e => !e.text)], ['未命名剧本', false, true]);
  await remount('{synthetic invalid json');
  check('broken autosave falls back to clean blank without partial recovery', [state().project.name, state().dirty, state().filePath, state().project.elements.every(e => !e.text)], ['未命名剧本', false, null, true]);
  check('React/window report no routing runtime errors', errors, []);
  groups++;
  console.log(`native draft history: ${checks} checks in ${groups} groups passed (real App/component/store, memory menu and native-command spies only; actual browser/OS native text undo still requires manual validation)`);
})().catch(error => { originalError(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (mounted) await act(async () => mounted.unmount());
  console.error = originalError;
  dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});
