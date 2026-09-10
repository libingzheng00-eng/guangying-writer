/** 自由板显示/删除安全契约。合成工程，内存构建；不读取应用和用户文件。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://board-polish.invalid', pretendToBeVisual: true });
const w = dom.window;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement', 'HTMLInputElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'WheelEvent', 'DOMParser', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? w : w[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const clone = (v) => JSON.parse(JSON.stringify(v));
let count = 0;
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); console.log(`✓ ${label}`); count++; };
let root;
(async () => {
  const built = await esbuild.build({ stdin: { contents: `export { BoardView } from './src/components/BoardView'; export { useStore } from './src/store/store'; export { createProject } from './src/model/project';`, resolveDir: repo, sourcefile: 'board-polish.entry.ts', loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const mod = new Module(path.join(__dirname, 'board-polish.bundle.cjs'), module);
  mod.filename = path.join(__dirname, 'board-polish.bundle.cjs');
  mod.paths = Module._nodeModulePaths(__dirname);
  mod._compile(built.outputFiles[0].text, mod.filename);
  const { BoardView, useStore, createProject } = mod.exports;
  const state = () => useStore.getState();
  const fixture = createProject('合成自由板安全测试');
  fixture.elements = [
    { id: 's1', type: 'scene_heading', text: '内景 测试棚 日' }, { id: 'a1', type: 'action', text: '合成动作一' },
    { id: 's2', type: 'scene_heading', text: '外景 测试园 夜' }, { id: 'a2', type: 'action', text: '合成动作二' },
  ];
  fixture.sceneMeta = [
    { id: 'm1', elementId: 's1', title: '', synopsis: '合成梗概一', color: '#ffffff', x: 20, y: 30 },
    { id: 'm2', elementId: 's2', title: '', synopsis: '合成梗概二', color: '#ffffff', x: 280, y: 30, w: 240, h: 180 },
  ];
  fixture.beats = [
    { id: 'b1', kind: 'beat', text: '合成灵感', color: '#ffffff', x: 550, y: 30, sceneId: 's1' },
    { id: 'b2', kind: 'sound', text: '合成声音', color: '#ffffff', x: 820, y: 30 },
  ];
  fixture.boardLinks = [
    { id: 'l1', from: 'scene:s1', to: 'beat:b1', note: '跨板关系' },
    { id: 'l2', from: 'beat:b1', to: 'beat:b2', note: '灵感关系' },
    { id: 'l3', from: 'scene:s1', to: 'scene:s2', note: '场景关系' },
  ];
  let confirmations = [];
  let accepted = false;
  w.confirm = (message) => { confirmations.push(message); return accepted; };
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const button = (name) => qa('button').find((b) => b.textContent.trim() === name);
  const click = async (node) => { assert.ok(node, 'target exists'); await act(async () => node.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))); };
  const key = async (node, value) => act(async () => node.dispatchEvent(new w.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
  const mount = async () => {
    await act(async () => {
      if (root) root.unmount();
      state().loadProject(clone(fixture));
      useStore.setState({ view: 'board', past: [], future: [], selectedIds: [] });
      root = createRoot(q('#root'));
      root.render(React.createElement('div', { className: 'app-shell', 'data-theme': 'day' }, React.createElement(BoardView)));
    });
    confirmations = [];
    accepted = false;
  };
  await mount();
  const original = clone(state().project);
  check('默认总览显示全部三条关系线', qa('.board-links line').length, 3);
  check('无尺寸场景默认高150', q('[data-id="s1"]').style.height, '150px');
  check('显式卡片尺寸保持180', q('[data-id="s2"]').style.height, '180px');
  check('新默认高度与关系线中心一致', q('.board-links line').getAttribute('y1'), '105');
  check('尺寸视觉兜底不写工程', state().project, original);
  check('连接入口显示明确文字', qa('.bcard__connect').every((b) => b.textContent === '连接'));
  await act(async () => state().setSelectedIds(['scene:s1', 'beat:b1']));
  await click(q('[data-id="s1"] .bcard__connect'));
  await click(button('灵感板'));
  check('只显示双端可见关系，备注同步过滤', qa('.board-link-note input').map((x) => x.value), ['灵感关系']);
  check('隐藏场景移出选区', state().selectedIds, ['beat:b1']);
  check('切板取消未完成连接', q('.board__link-state'), null);
  check('切板不删除工程关系或写历史', [state().project, state().past.length], [original, 0]);
  await click(button('场景板'));
  check('场景板仅显示场景间关系', qa('.board-link-note input').map((x) => x.value), ['场景关系']);
  await click(button('总览'));
  check('回到总览完整恢复关系备注', qa('.board-links line').length, 3);
  const grid = button('网格');
  check('参考网格默认开启', grid.getAttribute('aria-pressed'), 'true');
  check('网格初始28px且原点不变', [q('.board__canvas').style.backgroundSize, q('.board__canvas').style.backgroundPosition], ['28px 28px', '0px 0px']);
  await click(grid);
  check('网格开关只改显示', [q('.board__canvas').dataset.grid, state().project, state().past.length], ['off', original, 0]);
  await click(grid);
  await click(button('＋'));
  check('网格与世界缩放同步', [q('.board__canvas').style.backgroundSize, q('.board__world').style.transform], ['30.800000000000004px 30.800000000000004px', 'translate(0px, 0px) scale(1.1)']);
  await act(async () => q('.board__canvas').dispatchEvent(new w.WheelEvent('wheel', { clientX: 100, clientY: 80, deltaY: -80, bubbles: true, cancelable: true })));
  const transform = q('.board__world').style.transform;
  const translation = transform.match(/translate\(([^,]+), ([^)]+)\)/);
  check('光标缩放时网格原点跟随pan', q('.board__canvas').style.backgroundPosition, `${translation[1]} ${translation[2]}`);
  check('缩放不改坐标/工程历史', [state().project, state().past.length], [original, 0]);
  await act(async () => state().setSelectedIds(['beat:b2']));
  const selectionBefore = [...state().selectedIds];
  await click(q('[data-id="s1"] .bcard__del'));
  check('场景单卡删除明确警告正文', confirmations.length === 1 && confirmations[0].includes('正文'));
  check('取消删除保留正文/关系/选区/历史', [state().project, state().selectedIds, state().past.length], [original, selectionBefore, 0]);
  accepted = true;
  await click(q('[data-id="s1"] .bcard__del'));
  check('确认删除整场及其正文', state().project.elements.map((e) => e.id), ['s2', 'a2']);
  check('确认单场保留素材并解除关联', state().project.beats.map((b) => [b.id, b.sceneId]), [['b1', undefined], ['b2', undefined]]);
  check('整场删除仅清理相关关系', state().project.boardLinks.map((l) => l.id), ['l2']);
  check('一次删除只产生一个历史', state().past.length, 1);
  await act(async () => state().undo());
  check('撤销完整恢复正文与关系', state().project, original);
  await mount();
  await act(async () => state().setSelectedIds(['scene:s1', 'beat:b2']));
  await key(document.body, 'Delete');
  check('键盘批量含场景也需确认，取消无历史', [confirmations.length, state().project, state().past.length], [1, original, 0]);
  accepted = true;
  await click(button('删除所选（含整场）'));
  check('按钮批量删除场景与所选卡片', [state().project.elements.map((e) => e.id), state().project.beats.map((b) => b.id), state().past.length], [['s2', 'a2'], ['b1'], 1]);
  await act(async () => state().undo());
  check('批量删除一次撤销完整恢复', state().project, original);
  await mount();
  await click(button('灵感板'));
  // 模拟其他视图遗留的隐藏选区，即使未经过切板事件也绝不能误删。
  await act(async () => state().setSelectedIds(['scene:s1', 'beat:b2']));
  await key(document.body, 'Backspace');
  check('隐藏选区绝不被键盘误删', state().project.elements, original.elements);
  check('仅删除可见所选灵感，无整场确认', [state().project.beats.map((b) => b.id), confirmations.length], [['b1'], 0]);
  await mount();
  await act(async () => state().setSelectedIds(['scene:s1']));
  await key(q('.bcard__scene-notes'), 'Delete');
  await key(q('.bcard__link'), 'Delete');
  check('编辑摘要/关联选择器Delete不删卡', [state().project, confirmations.length], [original, 0]);
  await click(button('灵感板'));
  await act(async () => {
    q('[data-id="b1"] .bcard__head').dispatchEvent(new w.MouseEvent('mousedown', { button: 0, ctrlKey: true, bubbles: true }));
    q('[data-id="b2"] .bcard__head').dispatchEvent(new w.MouseEvent('mousedown', { button: 0, shiftKey: true, bubbles: true }));
  });
  check('Shift范围选择只覆盖可见卡片', state().selectedIds, ['beat:b1', 'beat:b2']);
  await act(async () => state().setSelectedIds(['scene:s1', 'beat:b1']));
  await click(q('[aria-label="卡片颜色 1"]'));
  check('隐藏选区不能被改色', state().project.sceneMeta, original.sceneMeta);
  check('可见所选卡片仍能改色', state().project.beats[0].color !== original.beats[0].color);
  const css = fs.readFileSync(path.join(repo, 'src/styles/board-polish.css'), 'utf8');
  check('样式限定屏幕与自由板，不影响写作/PDF', css.includes('@media screen') && !/\.editor|\.write-|\.preview|@media print/.test(css));
  check('网格是双向细线，未开启吸附', css.includes('linear-gradient(to right') && css.includes('linear-gradient(to bottom'));
  check('日夜网格独立弱对比', css.includes("data-theme='day'") && css.includes('.09') && css.includes('.13'));
  await act(async () => root.unmount());
  root = null;
  console.log(`\n自由板修整专项：${count} 条通过。真实拖拽、尺寸可读性和原生确认另需浏览器验收。`);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => dom.window.close());
