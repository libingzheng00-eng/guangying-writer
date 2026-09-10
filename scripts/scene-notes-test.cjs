/**
 * 自由板场景信息：真实 React / jsdom 事件、跨视图同步与保存撤销契约。
 * 仅用本文件内的合成工程；内存构建，不读用户工程、不启动应用、不写测试包。
 * jsdom 不验证真实尺寸、拖动手感或中文输入法；这些另做浏览器验收。
 * 运行：node scripts/scene-notes-test.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');

const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://scene-notes-test.invalid/',
  pretendToBeVisual: true,
});
const w = dom.window;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement',
  'HTMLInputElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'WheelEvent',
  'DOMParser', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? w : w[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
w.addEventListener('error', (e) => errors.push(e.message));

let root;
let assertions = 0;
const check = (label, actual, expected = true) => {
  assert.deepEqual(actual, expected, label);
  assertions += 1;
  console.log(`  ✓ ${label}`);
};

(async () => {
  const built = await esbuild.build({
    stdin: {
      contents: `
        export { BoardView } from './src/components/BoardView';
        export { Sidebar } from './src/components/Sidebar';
        export { CardsView } from './src/components/CardsView';
        export { useStore } from './src/store/store';
        export { createProject } from './src/model/project';
        export { serializeProject, parseProject } from './src/io/zhsp';
      `,
      resolveDir: repo,
      sourcefile: 'scene-notes-test.entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    logLevel: 'silent',
  });
  // 保持应用组件与测试共用一份 React；虚拟模块从项目 node_modules 解析依赖。
  const testModule = new Module(path.join(__dirname, 'scene-notes-test.bundle.cjs'), module);
  testModule.filename = path.join(__dirname, 'scene-notes-test.bundle.cjs');
  testModule.paths = Module._nodeModulePaths(__dirname);
  testModule._compile(built.outputFiles[0].text, testModule.filename);
  const { BoardView, Sidebar, CardsView, useStore, createProject, serializeProject, parseProject } = testModule.exports;
  const state = () => useStore.getState();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const p = createProject('合成场景信息测试');
  p.elements = [
    { id: 'notes-s1', type: 'scene_heading', text: '内景 测试摄影棚 日' },
    { id: 'notes-a1', type: 'action', text: '合成动作段落一。' },
    { id: 'notes-s2', type: 'scene_heading', text: '外景 测试花园 夜' },
    { id: 'notes-a2', type: 'action', text: '合成动作段落二。' },
  ];
  p.sceneMeta = [
    { id: 'notes-meta1', elementId: 'notes-s1', title: '摄影棚测试场景', synopsis: '', color: '#cfe4ff', x: 30, y: 40, w: 280, h: 180, actId: 'act-1' },
    { id: 'notes-meta2', elementId: 'notes-s2', title: '', synopsis: '', color: '#fff7d6', x: 350, y: 80, w: 240, h: 160 },
  ];
  p.beats = [{ id: 'notes-b1', kind: 'beat', text: '合成关联卡', color: '#fff7d6', x: 700, y: 60, sceneId: 'notes-s1' }];
  p.boardLinks = [{ id: 'notes-l1', from: 'scene:notes-s1', to: 'beat:notes-b1', note: '合成关系备注' }];
  const reset = async (project) => act(async () => {
    state().loadProject(clone(project));
    useStore.setState({ view: 'board', sidebar: 'outline', sidebarOpen: true, past: [], future: [], selectedIds: ['scene:notes-s1'], focus: null });
  });
  await reset(p);
  const bubble = { mouse: 0, double: 0, wheel: 0 };
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement('div', {
    onMouseDown: () => { bubble.mouse += 1; },
    onDoubleClick: () => { bubble.double += 1; },
    onWheel: () => { bubble.wheel += 1; },
  }, React.createElement(Sidebar), React.createElement(BoardView), React.createElement(CardsView))));
  const q = (selector) => document.querySelector(selector);
  const card = (id = 'notes-s1') => q(`.bcard--scene[data-id="${id}"]`);
  const notes = (id = 'notes-s1') => card(id)?.querySelector('textarea.bcard__scene-notes');
  const meta = () => state().project.sceneMeta.find((s) => s.elementId === 'notes-s1');
  const dispatch = async (target, event) => act(async () => { target.dispatchEvent(event); });
  const input = async (textarea, value) => act(async () => {
    // 原生 setter 绕过 React 的 value tracker，触发实际受控输入 onChange。
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
    textarea.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  const unchangedExceptSynopsis = (before, after, synopsis) => {
    const expected = clone(before);
    expected.updatedAt = after.updatedAt;
    expected.sceneMeta.find((s) => s.elementId === 'notes-s1').synopsis = synopsis;
    return JSON.stringify(after) === JSON.stringify(expected);
  };

  console.log('\n== 自由板场景信息 ==');
  check('每张场景卡有可编辑信息框', document.querySelectorAll('.bcard__scene-notes').length, 2);
  check('信息框具有可访问的场号标签', notes()?.getAttribute('aria-label'), '第 1 场故事信息');
  check('空摘要使用提示语而非重复场景标题', notes()?.placeholder, '这一场发生了什么？');
  check('空摘要的真实值为空', notes()?.value, '');
  check('第一行保留独立卡片标题', card().querySelector('.bcard__title').textContent, p.sceneMeta[0].title);
  check('无独立标题时保留正文场次标题', card('notes-s2').querySelector('.bcard__title').textContent, p.elements[2].text);
  check('旧重复摘要节点已移除', card('notes-s2').querySelector('.bcard__synopsis'), null);
  check('挂载本身不改工程', state().project, p);

  const before = clone(state().project);
  const text = '测试镜头切到空置舞台。\n记录第二个合成故事点。';
  await input(notes(), text);
  check('真实输入事件更新 sceneMeta.synopsis', meta().synopsis, text);
  check('编辑只改摘要和更新时间，不改正文/标题/坐标/尺寸/关系线', unchangedExceptSynopsis(before, state().project, text));
  check('自由板显示完整多行输入', notes().value, text);
  check('左侧大纲即时显示同一信息', q('.outline-item__synopsis').value, text);
  check('故事板即时显示同一信息', q('.card__synopsis').value, text);
  check('一次输入产生一个撤销记录', state().past.length, 1);

  const continued = `${text}\n继续补充。`;
  await input(notes(), continued);
  check('连续输入合并为一个撤销点', state().past.length, 1);
  await act(async () => state().undo());
  check('一次撤销完整恢复编辑前工程', state().project, before);
  check('撤销同步清空自由板和大纲', [notes().value, q('.outline-item__synopsis').value], ['', '']);
  await act(async () => state().redo());
  check('重做恢复完整多行摘要', notes().value, continued);
  check('重做同步恢复大纲和故事板', [q('.outline-item__synopsis').value, q('.card__synopsis').value], [continued, continued]);
  check('.zhsp 保存重开保持整个工程', parseProject(serializeProject(state().project)), state().project);

  const eventBefore = clone(state().project);
  const historyBefore = state().past.length;
  const transformBefore = q('.board__world').style.transform;
  await dispatch(notes(), new w.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 50, clientY: 90 }));
  await dispatch(w, new w.MouseEvent('mousemove', { bubbles: true, clientX: 150, clientY: 170 }));
  await dispatch(w, new w.MouseEvent('mouseup', { bubbles: true, clientX: 150, clientY: 170 }));
  check('拖选摘要文字不会启动外层卡片拖移', state().project, eventBefore);
  check('摘要 mousedown 不冒泡到外层', bubble.mouse, 0);
  check('摘要编辑不改变已有选择', state().selectedIds, ['scene:notes-s1']);
  await dispatch(notes(), new w.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  check('摘要双击不跳到写作视图', state().view, 'board');
  check('摘要双击不发起正文焦点请求', state().focus, null);
  check('摘要双击不冒泡到外层', bubble.double, 0);
  await dispatch(notes(), new w.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 200, clientX: 50, clientY: 90 }));
  check('摘要滚轮不缩放画布', q('.board__world').style.transform, transformBefore);
  check('摘要 wheel 不冒泡到外层', bubble.wheel, 0);
  for (const key of ['Delete', 'Backspace']) {
    const event = new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    await dispatch(notes(), event);
    check(`摘要内 ${key} 不删除选中场景及关系线`, state().project, eventBefore);
    check(`摘要内 ${key} 留给原生文字编辑处理`, event.defaultPrevented, false);
  }
  check('这些编辑手势不会污染撤销栈', state().past.length, historyBefore);

  const sidebarText = '从大纲更新的合成故事点。';
  await input(q('.outline-item__synopsis'), sidebarText);
  check('大纲编辑反向同步自由板和故事板', [notes().value, q('.card__synopsis').value], [sidebarText, sidebarText]);
  const cardsText = '从故事板更新的合成故事点。';
  await input(q('.card__synopsis'), cardsText);
  check('故事板编辑反向同步自由板和大纲', [notes().value, q('.outline-item__synopsis').value], [cardsText, cardsText]);
  await input(notes(), '');
  check('删除摘要后不退回重复标题', notes().value, '');
  check('清空摘要仍保留独立标题与关系', [meta().title, state().project.boardLinks], [p.sceneMeta[0].title, p.boardLinks]);

  // 文本与 resize 各用独立 coalesce key，互不吞掉撤销边界。
  await reset(p);
  await input(notes(), '缩放前的合成摘要。');
  await act(async () => state().resizeSceneMeta('notes-s1', 320, 220));
  await input(notes(), '缩放后的合成摘要。');
  check('信息编辑/缩放/再编辑形成三个撤销点', state().past.length, 3);
  await act(async () => state().undo());
  check('撤销末次摘要编辑保留 resize 结果', [notes().value, meta().w, meta().h], ['缩放前的合成摘要。', 320, 220]);
  await act(async () => state().undo());
  check('撤销 resize 保留前次摘要', [notes().value, meta().w, meta().h], ['缩放前的合成摘要。', 280, 180]);
  await act(async () => state().undo());
  check('多步撤销完整恢复原工程', state().project, p);

  const legacy = clone(p);
  legacy.sceneMeta = [];
  await reset(legacy);
  check('旧工程没有元数据时显示空信息框', notes().value, '');
  await input(notes(), '为旧工程补充的合成故事点。');
  check('旧工程首次编辑创建正确元数据', [state().project.sceneMeta.length, meta().elementId, meta().synopsis], [1, 'notes-s1', '为旧工程补充的合成故事点。']);
  check('补充旧工程摘要不改变正文和关系线', [state().project.elements, state().project.boardLinks], [legacy.elements, legacy.boardLinks]);
  check('首次编辑不凭空写入坐标或尺寸', ['x', 'y', 'w', 'h'].some((key) => Object.hasOwn(meta(), key)), false);
  check('旧工程编辑后可保存重开', parseProject(serializeProject(state().project)), state().project);
  await act(async () => state().undo());
  check('旧工程首次摘要编辑可完整撤回', state().project, legacy);

  await dispatch(card().querySelector('.bcard__title'), new w.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  check('非编辑区双击仍可跳转正文', state().view, 'write');
  check('非编辑区双击定位原场次', state().focus?.id, 'notes-s1');
  check('React / window 无运行时错误', errors, []);
  console.log(`\n=== ${assertions}/${assertions} PASS（React/jsdom；视觉和实际手势另验） ===`);
})().catch((error) => {
  originalError(error?.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (root) await act(async () => root.unmount());
  console.error = originalError;
  dom.window.close();
});
