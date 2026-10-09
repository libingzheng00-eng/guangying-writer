/** Synthetic React/jsdom scene review regression. Does not open user files or apps. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://scene-review.invalid/', pretendToBeVisual: true });
const w = dom.window;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'WheelEvent', 'FocusEvent', 'DOMParser', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? w : w[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
let root;
let checks = 0;
const check = (name, actual, ...expected) => { assert.deepEqual(actual, expected.length ? expected[0] : true, name); checks++; };
const clone = value => JSON.parse(JSON.stringify(value));
const q = selector => document.querySelector(selector);
const qa = selector => [...document.querySelectorAll(selector)];
const label = (scope, value) => [...scope.querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === value);
const click = node => act(async () => { node.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); });
const input = (node, value) => act(async () => {
  const proto = node instanceof w.HTMLTextAreaElement ? w.HTMLTextAreaElement.prototype : node instanceof w.HTMLSelectElement ? w.HTMLSelectElement.prototype : w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
  node.dispatchEvent(new w.Event(node instanceof w.HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
});
const edit = async (node, value) => { await act(async () => node.focus()); await input(node, value); await act(async () => node.blur()); };

(async () => {
  const built = await esbuild.build({ stdin: { contents: `
    export { Sidebar } from './src/components/Sidebar';
    export { CardsView } from './src/components/CardsView';
    export { BoardView } from './src/components/BoardView';
    export { useStore } from './src/store/store';
    export { createProject, deriveScenes } from './src/model/project';
    export { serializeProject, parseProject } from './src/io/zhsp';
  `, resolveDir: repo, sourcefile: 'scene-review.entry.ts', loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const mod = new Module(path.join(__dirname, 'scene-review.bundle.cjs'), module);
  mod.filename = path.join(__dirname, 'scene-review.bundle.cjs'); mod.paths = Module._nodeModulePaths(__dirname); mod._compile(built.outputFiles[0].text, mod.filename);
  const { Sidebar, CardsView, BoardView, useStore, createProject, deriveScenes, serializeProject, parseProject } = mod.exports;
  const state = () => useStore.getState();
  const p = createProject('合成场景审阅');
  p.elements = ['a', 'b', 'c', 'd'].flatMap((id, index) => [{ id: `scene-${id}`, type: 'scene_heading', text: `内景 合成地点${index + 1} 日` }, { id: `action-${id}`, type: 'action', text: `合成场景${index + 1}正文` }]);
  p.sceneMeta = ['a', 'b', 'c', 'd'].map((id, index) => ({ id: `meta-${id}`, elementId: `scene-${id}`, title: '', synopsis: index === 0 ? '第一行摘要\n保留第二行' : '', color: '#cfe4ff', ...(index % 2 === 0 ? { actId: 'act-1' } : {}), x: 30 + index * 320, y: 40, w: 280, h: 180 }));
  p.beats = [{ id: 'beat-1', text: '合成素材', color: '#fff7d6', x: 44, y: 55, boardX: 77, boardY: 88, sceneId: 'meta-a' }];
  p.boardLinks = [{ id: 'link-1', from: 'scene:scene-a', to: 'beat:beat-1', note: '合成关系' }];
  const reset = async () => act(async () => { state().loadProject(clone(p)); useStore.setState({ view: 'cards', sidebar: 'outline', sidebarOpen: true, selectedIds: ['scene:scene-a'], past: [], future: [] }); });
  await reset();
  root = createRoot(q('#root'));
  await act(async () => root.render(React.createElement('div', { className: 'app-shell', 'data-theme': 'day' }, React.createElement(Sidebar), React.createElement(CardsView), React.createElement(BoardView))));
  const meta = id => state().project.sceneMeta.find(item => item.elementId === (id || 'scene-a'));
  const outline = () => q('[data-outline-scene="scene-a"]');
  const order = () => state().project.elements.filter(element => element.type === 'scene_heading').map(element => element.id);
  const before = clone(state().project);
  const location = label(outline(), '第 1 场地点');
  await act(async () => location.focus()); await input(location, '合成候车厅');
  check('地点草稿尚未提交不改工程', state().project, before);
  check('地点草稿标记关闭保护', location.dataset.projectDraftPending, 'true');
  check('地点草稿拥有原生撤销', location.hasAttribute('data-native-edit-history'));
  await act(async () => location.blur());
  check('完成地点编辑独立提交', meta().location, '合成候车厅');
  check('地点不改正文', state().project.elements, before.elements);
  check('地点不改素材坐标与关系', [state().project.beats, state().project.boardLinks], [before.beats, before.boardLinks]);
  check('同一地点同步所有视图', qa('[aria-label="第 1 场地点"]').map(node => node.value), ['合成候车厅', '合成候车厅', '合成候车厅']);
  const afterLocation = state().past.length;
  await input(label(outline(), '第 1 场修改状态'), 'revising');
  check('状态与地点不合并', state().past.length, afterLocation + 1);
  check('状态同步故事板', label(q('.card[data-scene-id="scene-a"]'), '第 1 场修改状态').value, 'revising');
  await act(async () => state().undo());
  check('撤销状态保留地点', [meta().revisionStatus, meta().location], [undefined, '合成候车厅']);
  await act(async () => state().redo());
  check('重做状态', meta().revisionStatus, 'revising');
  await edit(label(outline(), '第 1 场故事时间'), '第三天傍晚');
  check('故事时间为自由文字', meta().storyTime, '第三天傍晚');
  check('信息保存重开', deriveScenes(parseProject(serializeProject(state().project)))[0].storyTime, '第三天傍晚');

  const cancel = label(outline(), '第 1 场地点');
  const history = state().past.length;
  await act(async () => cancel.focus()); await input(cancel, '取消草稿');
  await act(async () => cancel.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  check('Esc取消不改地点与历史', [meta().location, state().past.length], ['合成候车厅', history]);
  check('Esc清除未提交标记', cancel.dataset.projectDraftPending, undefined);
  await act(async () => cancel.focus()); await input(cancel, '过期草稿');
  await act(async () => state().commitReviewSceneMeta('scene-a', { location: '另一处已提交值' }));
  await act(async () => cancel.blur());
  check('过期字段草稿不覆盖新值', meta().location, '另一处已提交值');

  const projectBeforeMode = clone(state().project);
  await input(label(document, '故事板排列'), 'script');
  check('切换正文顺序不改工程', state().project, projectBeforeMode);
  check('线性展示使用正文顺序', qa('.scene-review__row').map(node => node.dataset.sceneId), order());
  check('多行旧摘要不因一行展示而截断', label(q('.scene-review__row'), '第 1 场一行摘要').value, '第一行摘要\n保留第二行');
  const materials = [clone(state().project.beats), clone(state().project.boardLinks)];
  await click(label(q('.scene-review__list'), '下移第 1 场'));
  check('首场下移仅越过相邻一场', order(), ['scene-b', 'scene-a', 'scene-c', 'scene-d']);
  check('整场正文跟随', state().project.elements.map(element => element.id), ['scene-b', 'action-b', 'scene-a', 'action-a', 'scene-c', 'action-c', 'scene-d', 'action-d']);
  check('线性移动不改归幕与坐标', state().project.sceneMeta, projectBeforeMode.sceneMeta);
  check('线性移动不改素材关系', [state().project.beats, state().project.boardLinks], materials);
  await act(async () => state().undo());
  check('一次撤销恢复全部场景顺序', order(), ['scene-a', 'scene-b', 'scene-c', 'scene-d']);
  await act(async () => state().redo());
  check('一次重做恢复移动', order(), ['scene-b', 'scene-a', 'scene-c', 'scene-d']);
  await input(label(document, '故事板排列'), 'acts');
  check('分组模式继续未归幕置顶', qa('.cards__act').map(node => node.dataset.actId), ['', 'act-1']);
  check('切回分组不重排正文', order(), ['scene-b', 'scene-a', 'scene-c', 'scene-d']);

  await reset();
  await act(async () => state().setSidebar('navigator'));
  await click(q('.nav-item .nav-item__ops button[title="下移"]'));
  check('导航下移也按稳定ID只移动一场', order(), ['scene-b', 'scene-a', 'scene-c', 'scene-d']);
  await act(async () => state().undo());
  await click(qa('.nav-item').at(-1).querySelector('button[title="上移"]'));
  check('导航末场上移', order(), ['scene-a', 'scene-b', 'scene-d', 'scene-c']);

  await reset();
  await act(async () => state().setView('board'));
  const boardLocation = label(q('.board__context'), '第 1 场地点');
  const boardBefore = clone(state().project);
  await act(async () => boardLocation.focus());
  for (const key of ['L', 'Delete', 'Backspace', ' ']) {
    await act(async () => boardLocation.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    check(`自由板字段内${key}不触发画布命令`, state().project, boardBefore);
  }
  await edit(boardLocation, '自由板地点');
  check('自由板字段反向同步大纲', label(outline(), '第 1 场地点').value, '自由板地点');
  check('自由板信息编辑保持已存尺寸位置', state().project.sceneMeta.map(({ x, y, w, h }) => ({ x, y, w, h })), p.sceneMeta.map(({ x, y, w, h }) => ({ x, y, w, h })));
  const stale = label(outline(), '第 1 场故事时间');
  await act(async () => stale.focus()); await input(stale, '跨工程草稿');
  await reset();
  check('相同ID切稿清除场景草稿', label(outline(), '第 1 场故事时间').value, '');
  check('相同ID切稿不提交旧草稿', meta().storyTime, undefined);
  console.log(`Scene review UI: ${checks}/${checks} passed (synthetic React/jsdom; native and visual QA separate).`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (root) await act(async () => root.unmount()); dom.window.close(); });
