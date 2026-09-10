/** 故事板归幕红线：合成工程、真实 React 事件；实际鼠标拖放另做浏览器验收。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://storyboard-test.invalid/' });
const w = dom.window;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Event', 'MouseEvent', 'DOMParser', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? w : w[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
let root;
(async () => {
  const result = await require('esbuild').build({ stdin: {
    contents: `export { CardsView } from './src/components/CardsView';
      export { useStore } from './src/store/store';
      export { createProject } from './src/model/project';
      export { serializeProject, parseProject } from './src/io/zhsp';`,
    resolveDir: path.resolve(__dirname, '..'), loader: 'ts',
  }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' });
  const mod = new Module(path.join(__dirname, 'storyboard-test.bundle.cjs'), module);
  mod.filename = path.join(__dirname, 'storyboard-test.bundle.cjs');
  mod.paths = Module._nodeModulePaths(__dirname);
  mod._compile(result.outputFiles[0].text, mod.filename);
  const { CardsView, useStore, createProject, serializeProject, parseProject } = mod.exports;
  const state = () => useStore.getState();
  const p = createProject('合成故事板测试');
  p.acts = [{ id: 'act-1', title: '第一幕', color: '#cfe4ff' }, { id: 'act-2', title: '第二幕', color: '#cfe4ff' }];
  p.elements = [1, 2, 3, 4].flatMap(n => [
    { id: `s${n}`, type: 'scene_heading', text: `内景 合成场景${n} 日` },
    { id: `a${n}`, type: 'action', text: `合成动作${n}` },
  ]);
  p.sceneMeta = [1, 2, 3, 4].map(n => ({ id: `m${n}`, elementId: `s${n}`, title: `合成场景${n}`, synopsis: '', color: '#cfe4ff', actId: 'act-1' }));
  p.beats = [{ id: 'b1', text: '合成素材', color: '#fff', x: 20, y: 30, sceneId: 's1' }];
  p.boardLinks = [{ id: 'l1', from: 'scene:s1', to: 'beat:b1', note: '合成关系' }];
  const reset = () => act(async () => {
    state().loadProject(JSON.parse(JSON.stringify(p)));
    useStore.setState({ past: [], future: [] });
  });
  await reset();
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(CardsView)));
  const section = index => document.querySelector(`.cards__act[data-act-id="${['act-1', 'act-2', ''][index]}"]`);
  const card = name => [...document.querySelectorAll('.card')].find(c => c.querySelector('.card__title').value === name);
  const fire = async (node, type, clientX = -1) => act(async () => {
    const e = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX });
    Object.defineProperty(e, 'dataTransfer', { value: { effectAllowed: '', dropEffect: '', setData() {} } });
    node.dispatchEvent(e);
  });
  const move = async (name, target) => {
    await fire(card(name), 'dragstart');
    await fire(target, 'dragover');
    await fire(target, 'drop');
  };
  const order = () => state().project.elements.filter(e => e.type === 'scene_heading').map(e => e.id);
  const actId = id => state().project.sceneMeta.find(m => m.elementId === id).actId;
  assert.equal(document.querySelector('.cards__act').dataset.actId, '', '未归幕固定在首位');

  // 空梗概在双击后才挂载；拖出卡片时不得卸载正在原生拖动的 DOM 源。
  const source = card('合成场景1');
  await fire(source, 'dblclick');
  const textarea = source.querySelector('textarea');
  assert.ok(textarea);
  await fire(textarea, 'dragstart');
  await fire(source, 'mouseout');
  assert.ok(textarea.isConnected, '拖动期间不得卸载空梗概源节点，否则浏览器会取消原生拖拽');
  await fire(section(2).querySelector('.cards__empty'), 'drop');
  assert.equal(actId('s1'), undefined, '落到未归幕提示区解除归幕');
  assert.equal(state().past.length, 1, '冒泡落点只产生一次撤销记录');
  assert.deepEqual(state().project.beats, p.beats);
  assert.deepEqual(state().project.boardLinks, p.boardLinks);
  assert.deepEqual(parseProject(serializeProject(state().project)), state().project, '保存重开保持未归幕');
  await act(async () => state().undo());
  assert.deepEqual(state().project, p, '一次撤销完整恢复正文和归幕');
  await act(async () => state().redo());
  assert.equal(actId('s1'), undefined);
  await move('合成场景1', section(1).querySelector('header'));
  assert.equal(actId('s1'), 'act-2', '未归幕可以重新拖到另一幕标题区');
  await move('合成场景2', section(2).querySelector('.cards__grid'));
  assert.equal(actId('s2'), undefined, '网格空白落点可解除归幕');
  const beforeUngroup = state().project.elements;
  await move('合成场景1', card('合成场景2'));
  assert.equal(actId('s1'), undefined, '已有卡片落点也可以解除归幕');
  assert.deepEqual(state().project.elements, beforeUngroup, '新契约：未归幕内卡片落点也不能改变正文顺序');

  await reset();
  await move('合成场景1', card('合成场景3'));
  assert.deepEqual(order(), ['s2', 's1', 's3', 's4'], '向后拖到第三场前保持准确顺序');
  assert.deepEqual(state().project.elements.map(e=>e.id), ['s2','a2','s1','a1','s3','a3','s4','a4'], '整场正文跟随且不丢失');
  await act(async () => state().undo());
  assert.deepEqual(state().project, p);
  await fire(card('合成场景1'), 'dragstart');
  await fire(card('合成场景3'), 'dragover', 100);
  assert.ok(card('合成场景3').classList.contains('is-insert-after'), '右半部显示后插入线');
  await fire(card('合成场景3'), 'drop', 100);
  assert.deepEqual(order(), ['s2','s3','s1','s4'], '实际落点与后插入线一致');
  await reset();
  await move('合成场景1', card('合成场景1'));
  assert.equal(state().past.length, 0, '原位落下不产生撤销点');
  await fire(card('合成场景1'), 'dragstart');
  await fire(card('合成场景1'), 'dragend');
  await fire(section(2), 'drop');
  assert.deepEqual(state().project, p, '取消拖动后落点不能使用过期源');
  assert.equal(state().past.length, 0);
  const click = async (node, shiftKey = false) => act(async () => node.dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey })));
  const pick = async (node, value) => act(async () => { node.value = value; node.dispatchEvent(new w.Event('change', { bubbles: true })); });
  await click(card('合成场景1').querySelector('.card__select'));
  await click(card('合成场景3').querySelector('.card__select'), true);
  assert.equal(document.querySelectorAll('.card.is-selected').length, 3, 'Shift选中连续三场');
  await pick(document.querySelector('[aria-label="移动选中的场景"]'), 'act-2');
  assert.deepEqual(['s1','s2','s3'].map(actId), ['act-2','act-2','act-2'], '多选移至入口归幕全部场景');
  assert.equal(state().past.length, 1, '批量菜单操作只有一个撤销点');
  await click(section(1).querySelector('.cards__collapse'));
  assert.equal(section(1).querySelector('.cards__grid').hidden, true, '幕可收起');
  await move('合成场景4', section(1).querySelector('header'));
  assert.equal(actId('s4'), 'act-2', '收起状态仍接受拖入');
  assert.equal(section(1).querySelector('.cards__grid').hidden, false, '拖入后展开目标幕');
  await pick(card('合成场景4').querySelector('select'), '__ungrouped__');
  assert.equal(actId('s4'), undefined, '单卡移至菜单可解除归幕');
  const beforeDelete = JSON.parse(JSON.stringify(state().project));
  await click(section(1).querySelector('.cards__remove-act'));
  const confirmation = section(1).querySelector('[role="alertdialog"]');
  assert.ok(confirmation.textContent.includes('正文和素材保留原位'));
  await click([...confirmation.querySelectorAll('button')].find(b=>b.textContent==='取消'));
  assert.deepEqual(state().project, beforeDelete, '取消删幕不改工程');
  await click(section(1).querySelector('.cards__remove-act'));
  await click([...section(1).querySelectorAll('button')].find(b=>b.textContent==='确认删除幕'));
  assert.deepEqual(state().project.elements, beforeDelete.elements, '删除幕保留正文位置');
  assert.deepEqual(['s1','s2','s3','s4'].map(actId), [undefined,undefined,undefined,undefined]);
  await act(async () => state().undo());
  assert.deepEqual(state().project, beforeDelete, '一次撤销恢复整幕和归属');
  await reset();
  await click(card('合成场景1').querySelector('.card__select'));
  await click(card('合成场景2').querySelector('.card__select'), true);
  await move('合成场景1', section(1).querySelector('.cards__grid'));
  assert.deepEqual(['s1','s2'].map(actId), ['act-2','act-2'], '拖动选中卡时全部选中场景一起移动');
  assert.equal(state().past.length, 1, '多选拖动只有一次历史');
  console.log('PASS 故事板归幕/未归幕、三个落点、原生源节点保持、排序、取消、保存和撤销红线');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (root) await act(async () => root.unmount());
  w.close();
});
