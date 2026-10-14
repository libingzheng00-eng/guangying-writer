/** Rich card notes, storyboard top-bar tools, collapsible progress bar and revision chip labels.
 * Synthetic data in jsdom; real mouse, IME and paint are validated separately. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://card-notes.invalid/', pretendToBeVisual: true });
const w = dom.window;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Node', 'NodeFilter', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'DOMParser', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? w : w[key] });
}
w.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
let checks = 0;
const check = (name, actual, expected = true) => { assert.deepEqual(actual, expected, name); checks++; console.log(`  ✓ ${name}`); };
const q = (selector, scope = document) => scope.querySelector(selector);
const qa = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const click = node => act(async () => { node.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); });
const change = (node, value) => act(async () => {
  Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, 'value').set.call(node, value);
  node.dispatchEvent(new w.Event('change', { bubbles: true }));
});
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.join(' ')); originalError(...args); };

(async () => {
  const built = await esbuild.build({ stdin: { contents: `
    export { CardsView } from './src/components/CardsView';
    export { Sidebar, revisionChipLabel } from './src/components/Sidebar';
    export { Editor } from './src/components/Editor';
    export { PaginationProvider } from './src/hooks/PaginationProvider';
    export { useStore } from './src/store/store';
    export { createProject } from './src/model/project';
    export { serializeProject, parseProject } from './src/io/zhsp';
    export { richNoteHtml, richNoteValue, richNotePlain, isRichNote } from './src/utils/richNote';
  `, resolveDir: repo, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', loader: { '.css': 'empty', '.png': 'dataurl' } });
  const filename = path.join(__dirname, 'card-notes.bundle.cjs');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(__dirname); mod._compile(built.outputFiles[0].text, filename);
  const { CardsView, Sidebar, revisionChipLabel, Editor, PaginationProvider, useStore, createProject, serializeProject, parseProject, richNoteHtml, richNoteValue, richNotePlain, isRichNote } = mod.exports;
  const state = () => useStore.getState();

  // ---- rich note helpers ----
  check('旧纯文本简介按文字转义并保留换行', richNoteHtml('A&B <3\n第二行'), 'A&amp;B &lt;3<br>第二行');
  check('带格式的简介保留粗体/斜体/下划线', richNoteHtml('<b>粗</b><i>斜</i><u>线</u>'), '<b>粗</b><i>斜</i><u>线</u>');
  check('脚本与事件属性被清除', richNoteHtml('<b onclick="x()">粗</b><script>alert(1)</script>'), '<b>粗</b>');
  check('编辑区没有格式时保存为纯文本', richNoteValue('第一行<br>第二行'), '第一行\n第二行');
  check('编辑区的 strong/em 统一为 b/i', richNoteValue('<strong>粗</strong> <em>斜</em>'), '<b>粗</b> <i>斜</i>');
  check('浏览器插入的 div 换行转为 br', richNoteValue('<b>一</b><div>二</div>'), '<b>一</b><br>二');
  check('只读场合显示纯文字', [richNotePlain('<b>粗</b>体'), richNotePlain('纯文字'), isRichNote('a<b')], ['粗体', '纯文字', false]);

  // ---- revision chips ----
  check('修订色块：初稿显示 1，其余取首字', ['初稿', 'A', '第二稿', ''].map(revisionChipLabel), ['1', 'A', '第', '·']);

  // ---- storyboard ----
  const p = createProject('合成卡片简介');
  p.elements = [
    { id: 's1', type: 'scene_heading', text: '内景 合成车站 日' }, { id: 'a1', type: 'action', text: '合成正文一' },
    { id: 's2', type: 'scene_heading', text: '外景 合成码头 夜' }, { id: 'a2', type: 'action', text: '合成正文二' },
  ];
  p.sceneMeta = [{ id: 'm1', elementId: 's1', title: '候车', synopsis: '已有的<b>简介</b>', color: '#cfe4ff' }];
  await act(async () => { state().loadProject(JSON.parse(JSON.stringify(p))); useStore.setState({ view: 'cards', past: [], future: [] }); });
  const root = createRoot(q('#root'));
  await act(async () => root.render(React.createElement(PaginationProvider, null, React.createElement('div', { className: 'app-shell', 'data-theme': 'day' }, React.createElement(CardsView)))));
  const card = id => q(`.card[data-scene-id="${id}"]`);
  check('简介是卡片主体，可直接编辑', [!!q('[data-rich-note].card__synopsis', card('s1')), q('[data-rich-note].card__synopsis', card('s1')).getAttribute('contenteditable')], [true, 'true']);
  check('简介显示已有粗体', q('.card__synopsis', card('s1')).innerHTML, '已有的<b>简介</b>');
  check('场景标题放在卡片底部，不再是灰底大块', [q('.card__footer .card__heading', card('s1')).textContent, qa('.card__colors button', card('s1')).length], ['内景 合成车站 日', 0]);
  check('卡片里不再填地点 / 故事时间', qa('[aria-label$="场地点"], [aria-label$="场故事时间"]').length, 0);
  check('未选中时顶栏不显示颜色工具', q('.cards__selection-tools'), null);
  const note = q('.card__synopsis', card('s2'));
  await act(async () => { note.innerHTML = '新的<b>重点</b>简介'; note.dispatchEvent(new w.Event('input', { bubbles: true })); });
  check('输入的粗体保存进简介', state().project.sceneMeta.find(m => m.elementId === 's2').synopsis, '新的<b>重点</b>简介');
  check('简介保存重开不变', parseProject(serializeProject(state().project)).sceneMeta.find(m => m.elementId === 's2').synopsis, '新的<b>重点</b>简介');
  const history = state().past.length;
  await click(q('.card__select', card('s1')));
  await click(q('.card__select', card('s2')));
  check('选中后顶栏出现颜色与修改状态', [qa('.cards__selection-tools .cards__colors button').length, !!q('select[aria-label="所选场景修改状态"]')], [8, true]);
  await click(q('.cards__colors button[aria-label="场景颜色 3"]'));
  const colors = state().project.sceneMeta.filter(m => ['s1', 's2'].includes(m.elementId)).map(m => m.color);
  check('顶栏改色同时作用于所选场景，一步撤销', [new Set(colors).size, state().past.length], [1, history + 1]);
  await change(q('select[aria-label="所选场景修改状态"]'), 'revising');
  check('顶栏改状态同时作用于所选场景', state().project.sceneMeta.filter(m => ['s1', 's2'].includes(m.elementId)).map(m => m.revisionStatus), ['revising', 'revising']);
  check('卡片标题行显示状态标记', q('.card__status', card('s1')).textContent, '修改中');
  await act(async () => state().undo());
  check('撤销状态一步恢复两场', state().project.sceneMeta.filter(m => ['s1', 's2'].includes(m.elementId)).map(m => m.revisionStatus || ''), ['', '']);
  check('改色与改状态不动正文', state().project.elements, p.elements);
  await act(async () => root.unmount());

  // ---- progress bar collapse ----
  localStorage.clear();
  await act(async () => { state().loadProject(JSON.parse(JSON.stringify(p))); useStore.setState({ view: 'write' }); });
  const root2 = createRoot(q('#root'));
  await act(async () => root2.render(React.createElement(PaginationProvider, null, React.createElement('div', { className: 'app-shell', 'data-theme': 'day' }, React.createElement(Editor)))));
  check('默认显示进度栏与收起把手', [!!q('.write-progress'), !!q('button[aria-label="收起进度栏"]')], [true, true]);
  await click(q('button[aria-label="收起进度栏"]'));
  check('收起后只留展开把手', [q('.write-progress'), !!q('button[aria-label="展开进度栏"]')], [null, true]);
  check('收起状态记在本机，不写工程', [localStorage.getItem('guangying:progress-collapsed'), state().project.elements], ['1', p.elements]);
  await act(async () => root2.unmount());
  const root3 = createRoot(q('#root'));
  await act(async () => root3.render(React.createElement(PaginationProvider, null, React.createElement('div', { className: 'app-shell', 'data-theme': 'day' }, React.createElement(Editor)))));
  check('重新打开仍保持收起', !!q('button[aria-label="展开进度栏"]'));
  await click(q('button[aria-label="展开进度栏"]'));
  check('展开后打字机进度栏恢复', [!!q('.write-progress'), localStorage.getItem('guangying:progress-collapsed')], [true, '0']);

  // ---- 进度栏：右侧不再有按钮；点页数框改目标；指针停在当前页 ----
  check('进度栏右侧不再有目标框和声音按钮', [q('.write-progress__tools'), q('button[aria-label="新建声音卡"]'), q('button[aria-label="显示或隐藏声音卡"]')], [null, null, null]);
  const historyBeforeTarget = state().past.length;
  await click(q('.write-progress__label[role="button"]'));
  const targetField = q('input[aria-label="目标页数"]');
  check('点击页数框出现目标页数输入', !!targetField);
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(targetField, '8');
    targetField.dispatchEvent(new w.Event('input', { bubbles: true }));
    targetField.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  check('回车后目标页数生效并收起输入框', [state().project.targetPages, q('input[aria-label="目标页数"]'), q('.write-progress__target').textContent], [8, null, '8']);
  check('改目标页数是一步可撤销的修改', state().past.length, historyBeforeTarget + 1);
  await click(q('.write-progress__label[role="button"]'));
  await act(async () => {
    const field = q('input[aria-label="目标页数"]');
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(field, '99');
    field.dispatchEvent(new w.Event('input', { bubbles: true }));
    field.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  check('Esc 放弃修改', [state().project.targetPages, q('input[aria-label="目标页数"]')], [8, null]);
  const marker = q('.write-progress__marker');
  check('打字机指针按当前页定位（第 1 页 / 目标 8 页）', marker.style.left, 'calc(12.5% - 28px)');

  // ---- 正文两侧空白处右键：新建声音卡、隐藏所有卡片 ----
  const layer = q('.editor__scroll');
  await act(async () => { q('.script-flow').dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 })); });
  check('正文里右键不弹素材菜单', q('.writing-context-menu'), null);
  await act(async () => { layer.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 200 })); });
  check('空白处右键弹出素材菜单', qa('.writing-context-menu [role="menuitem"]').map((node) => node.textContent), ['新建声音卡', '新建图片卡…', '隐藏所有卡片']);
  const beatsBefore = state().project.beats.length;
  await click(qa('.writing-context-menu [role="menuitem"]')[0]);
  check('新建声音卡后菜单关闭、卡片出现', [q('.writing-context-menu'), state().project.beats.length, state().project.beats.at(-1).kind, qa('.writing-material-card').length], [null, beatsBefore + 1, 'sound', 1]);
  await act(async () => { layer.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 200 })); });
  await click(qa('.writing-context-menu [role="menuitem"]')[2]);
  check('隐藏所有卡片后画面上没有素材卡，工程不变', [qa('.writing-material-card').length, state().project.beats.length], [0, beatsBefore + 1]);
  await act(async () => { layer.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 200 })); });
  check('隐藏后菜单改为显示所有卡片', qa('.writing-context-menu [role="menuitem"]')[2].textContent, '显示所有卡片（1）');
  await act(async () => { document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  check('Esc 关闭菜单', q('.writing-context-menu'), null);
  await act(async () => { state().addBeat(40, 200, '', 'sound'); });
  check('新增卡片时自动重新显示全部卡片', qa('.writing-material-card').length, 2);
  await act(async () => root3.unmount());

  check('没有 React 运行时错误', errors.filter(line => !line.includes('not wrapped in act')), []);
  console.log(`\n=== card-notes-ui ${checks}/${checks} PASS (jsdom) ===`);
})().catch(error => { console.error(error); process.exit(1); });
