/** 顶栏上下文工具与导航副行契约；仅合成数据，jsdom 不证明真实窗口布局。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://writing-controls-test.invalid/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'localStorage']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
let mounted;
let checks = 0;
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
const check = (label, actual, expected = true) => {
  assert.deepEqual(actual, expected, label);
  checks += 1;
  console.log(`  ✓ ${label}`);
};
(async () => {
  const result = await esbuild.build({
    stdin: { contents: `export { Toolbar } from './src/components/Toolbar'; export { Sidebar } from './src/components/Sidebar'; export { useStore } from './src/store/store'; export { createProject } from './src/model/project';`, resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const bundle = new Module(path.join(repo, '.writing-controls-memory.cjs'), module);
  bundle.filename = path.join(repo, '.writing-controls-memory.cjs');
  bundle.paths = Module._nodeModulePaths(repo);
  bundle._compile(result.outputFiles[0].text, bundle.filename);
  const { Toolbar, Sidebar, useStore, createProject } = bundle.exports;
  const state = () => useStore.getState();
  const p = createProject('合成顶栏测试');
  p.elements = [
    { id: 'ui-s1', type: 'scene_heading', text: '内景 合成摄影棚 日' },
    { id: 'ui-a1', type: 'action', text: '合成动作一。' },
    { id: 'ui-s2', type: 'scene_heading', text: '外景 合成空地 夜' },
    { id: 'ui-a2', type: 'action', text: '合成动作二。' },
  ];
  p.sceneMeta = [
    { id: 'ui-meta1', elementId: 'ui-s1', title: '', synopsis: '', color: '#cfe4ff', actId: p.acts[0].id },
    { id: 'ui-meta2', elementId: 'ui-s2', title: '', synopsis: '', color: '#cfe4ff' },
  ];
  state().loadProject(p);
  useStore.setState({ view: 'write', sidebar: 'navigator', sidebarOpen: true, activeId: 'ui-a1', past: [], future: [], writingSelectionMode: false, writingSelectedIds: [] });
  const calls = [];
  const commands = Object.fromEntries(['setElementType', 'insertScene', 'makeDual', 'save', 'newFile', 'open', 'importAny', 'exportPdf', 'exportAs'].map((name) => [name, (...args) => { calls.push([name, ...args.filter((value) => typeof value !== 'object')]); }]));
  mounted = createRoot(document.getElementById('root'));
  await act(async () => mounted.render(React.createElement('div', { className: 'app-shell', 'data-theme': 'day' },
    React.createElement(Toolbar, { commands, onOpenSettings: () => calls.push(['settings']), onOpenTitle: () => calls.push(['title']) }), React.createElement(Sidebar))));
  const q = (selector) => document.querySelector(selector);
  const click = async (target) => act(async () => { target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  const title = (text) => Array.from(document.querySelectorAll('button')).find((button) => button.title === text);
  const before = JSON.stringify(state().project);

  check('普通写作保留元素类型和全部格式入口', q('.toolbar__context').querySelectorAll('.type-select, .icon-btn').length, 7);
  check('导航标题只显示一次，副行不再重复场名', q('.nav-item__sub').textContent.includes('合成摄影棚'), false);
  check('导航副行显示页数及正式幕名称', q('.nav-item__sub').textContent, `第 ? 页 · ${p.acts[0].title}`);
  check('无幕场景明确显示未归幕', document.querySelectorAll('.nav-item__sub')[1].textContent, '第 ? 页 · 未归幕');
  await click(q('.writing-select-toolbar--toggle button'));
  check('入口启用原有写作多选状态', state().writingSelectionMode);
  check('多选操作只在同一个上下文区出现', q('.toolbar__context [aria-label="段落多选操作"]') !== null);
  check('多选期间格式控件暂不占宽度', q('.toolbar__context .type-select'), null);
  check('未选择时不能执行删除', title('删除选中的正文段落').disabled);
  check('切换工具表现不改工程或撤销栈', [JSON.stringify(state().project), state().past.length], [before, 0]);
  await click(title('选择全部正文段落'));
  check('全选仍选原有全部段落 ID', state().writingSelectedIds, p.elements.map((el) => el.id));
  check('数量准确同步', q('.writing-select-toolbar__count').textContent, '已选 4 段');
  await act(async () => state().setWritingSelectedIds(['ui-a1', 'ui-a2']));
  await click(title('删除选中的正文段落'));
  check('删除只移除选中的正文，不误删场次', state().project.elements.map((el) => el.id), ['ui-s1', 'ui-s2']);
  check('批量删除只有一个撤销点', state().past.length, 1);
  await click(title('撤销最近一次修改'));
  check('工具区撤销完整恢复原工程', JSON.stringify(state().project), before);
  await click(q('.writing-select-toolbar--toggle button'));
  check('完成多选清除选区但不改正文', [state().writingSelectionMode, state().writingSelectedIds, JSON.stringify(state().project)], [false, [], before]);
  check('完成后恢复全部格式入口', q('.toolbar__context').querySelectorAll('.type-select, .icon-btn').length, 7);
  await click(title('插入新场景 ⌘↩'));
  await click(title('双列对白 ⌘D'));
  check('恢复后的原命令回调不变', calls.slice(-2), [['insertScene'], ['makeDual']]);
  await click(Array.from(document.querySelectorAll('.toolbar button')).find((b) => b.textContent === '文件 ▾'));
  check('文件菜单仍保留两个独立 PDF 出口', Array.from(document.querySelectorAll('.menu__item')).filter((b) => b.textContent.includes('PDF')).length, 2);
  await click(Array.from(document.querySelectorAll('.menu__item')).find((b) => b.textContent.includes('创作版 PDF')));
  check('创作版 PDF 调用仍为 creative', calls.at(-1), ['exportPdf', 'creative']);
  await click(q('.nav-item__main'));
  check('导航仍请求准确的正文场次起点', [state().view, state().focus?.id], ['write', 'ui-s1']);
  const viewSelect = q('.toolbar__view-select');
  await act(async () => { viewSelect.value = 'board'; viewSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  check('窄窗视图选择使用原 setView，五种界面均保留', [state().view, viewSelect.options.length], ['board', 5]);
  check('非写作界面没有多选入口', q('.writing-select-toolbar--toggle'), null);

  const css = fs.readFileSync(path.join(repo, 'src/styles/writing-controls.css'), 'utf8');
  check('专用样式仅作用于屏幕', css.includes('@media screen'));
  check('不修改正文/打印/卡片/侧栏几何选择器', /\.(?:editor|paper|script-block|preview|bcard|sidebar)\b/.test(css), false);
  check('不新增顶栏高度或裁切整个顶栏', /\.toolbar\s*\{[^}]*\b(?:height|overflow)\s*:/.test(css), false);
  check('没有 React 运行时错误', errors, []);
  console.log(`\n=== ${checks}/${checks} PASS（真实窗口宽度与视图另验） ===`);
})().catch((error) => { originalError(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (mounted) await act(async () => mounted.unmount());
  console.error = originalError;
  dom.window.close();
});
