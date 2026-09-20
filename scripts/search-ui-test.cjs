/**
 * Mount the real App + FindPanel with synthetic text and memory-only localStorage.
 * jsdom has no layout or CSS Highlight paint: Range rectangles/scroll are stubbed,
 * and Highlight stores actual DOM Ranges so text/offsets can be asserted.
 * This tests handlers/state/read-only contracts, NOT visual scrolling or native menus.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://search-ui-test.invalid/', pretendToBeVisual: true });
const w = dom.window;
for (const key of ['window', 'document', 'navigator', 'self', 'location', 'history', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'NodeFilter', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'DOMParser', 'Range', 'Selection', 'MutationObserver', 'localStorage', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' || key === 'self' ? w : w[key] });
}
w.HTMLElement.prototype.scrollIntoView = () => {};
w.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 100, top: 100, bottom: 120, left: 0, right: 100, width: 100, height: 20 });
Object.defineProperty(w, 'CSS', { configurable: true, value: { highlights: new Map() } });
w.Highlight = class Highlight { constructor(...ranges) { this.ranges = ranges; } };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
w.addEventListener('error', event => errors.push(event.message));
let root;
let assertions = 0;
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); assertions++; console.log(`  ✓ ${label}`); };
const repo = path.resolve(__dirname, '..');

(async () => {
  const built = await esbuild.build({
    stdin: { contents: `export { default as App } from './src/App'; export { useStore } from './src/store/store'; export { createProject } from './src/model/project';`, resolveDir: repo, sourcefile: 'search-ui.entry.ts', loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', loader: { '.png': 'dataurl', '.css': 'empty' },
  });
  const testModule = new Module(path.join(__dirname, 'search-ui-test.bundle.cjs'), module);
  testModule.filename = path.join(__dirname, 'search-ui-test.bundle.cjs');
  testModule.paths = Module._nodeModulePaths(__dirname);
  testModule._compile(built.outputFiles[0].text, testModule.filename);
  const { App, useStore, createProject } = testModule.exports;
  const project = createProject('合成查找测试');
  project.titlePage.show = false;
  project.elements = [
    { id: 'find-heading', type: 'scene_heading', text: '内景 合成测试棚 日' },
    { id: 'find-action', type: 'action', text: '<b>测试</b> Find find FIND' },
    { id: 'find-note', type: 'note', text: '备忘测试' },
    { id: 'find-dual-left', type: 'dialogue', text: '左列测试', dual: 'left', dualGroup: 'find-dual' },
    { id: 'find-dual-right', type: 'dialogue', text: '右列测试', dual: 'right', dualGroup: 'find-dual' },
    { id: 'find-entity', type: 'general', text: '&#x1F3AC;&#27979;&#35797;' },
  ];
  localStorage.setItem('guangying:autosave', JSON.stringify({ project, filePath: null }));
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(App)); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
  const state = () => useStore.getState();
  const q = selector => document.querySelector(selector);
  const panel = () => q('.find-panel');
  const query = () => q('input[aria-label="查找内容"]');
  const status = () => q('.find-panel [role="status"]')?.textContent;
  const currentText = () => w.CSS.highlights.get('script-find-current')?.ranges.map(range => range.toString());
  const button = label => q(`.find-panel button[aria-label="${label}"]`);
  const dispatch = async (target, event) => act(async () => { target.dispatchEvent(event); });
  const key = async (target, name, modifiers = {}) => {
    const event = new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...modifiers });
    await dispatch(target, event);
    return event;
  };
  const type = async value => act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(query(), value);
    query().dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  const click = async target => dispatch(target, new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const before = JSON.stringify(state().project);
  const beforeHistory = [state().past, state().future, state().dirty, state().version];
  const scriptHTML = () => [...document.querySelectorAll('.script-flow .sc-el--editable')].map(node => [node.dataset.id, node.innerHTML]);
  const beforeDOM = scriptHTML();
  check('默认查找面板关闭', panel(), null);
  const findKey = await key(q('.sc-el--editable'), 'f', { ctrlKey: true });
  check('Ctrl+F被应用接管', findKey.defaultPrevented);
  check('Ctrl+F打开正文查找', !!panel());
  check('打开后焦点在查找输入框', document.activeElement, query());
  check('空查询提示全文范围', status(), '搜索全文（含备忘）');
  check('空查询上下处按钮禁用', [button('上一处').disabled, button('下一处').disabled], [true, true]);
  await type('find');
  check('默认忽略大小写统计全部三处', status(), '1 / 3 处');
  check('高亮按DOM范围得到首处原文', currentText(), ['Find']);
  check('结果列表显示三项', q('.find-panel__results').children.length, 3);
  await click(button('下一处'));
  check('下一处更新计数及当前高亮', [status(), currentText()], ['2 / 3 处', ['find']]);
  await key(query(), 'Enter');
  check('Enter定位下一处', [status(), currentText()], ['3 / 3 处', ['FIND']]);
  await key(query(), 'Enter');
  check('末处向下循环首处', status(), '1 / 3 处');
  await key(query(), 'Enter', { shiftKey: true });
  check('Shift+Enter反向循环末处', status(), '3 / 3 处');
  await click(button('上一处'));
  check('上一处按钮可用', status(), '2 / 3 处');
  await click(q('.find-panel__results button'));
  check('结果列表点击可定位首处', status(), '1 / 3 处');
  await click(q('.find-panel input[type="checkbox"]'));
  check('区分大小写只命中完全一致内容', [status(), currentText()], ['1 / 1 处', ['find']]);
  await type('不存在的合成字词');
  check('无匹配有明确提示', status(), '没有找到匹配内容');
  check('无匹配导航禁用', [button('上一处').disabled, button('下一处').disabled], [true, true]);
  await type('测试');
  check('中文命中含备忘/双列/实体字', status(), '1 / 6 处');
  check('中文所有范围文字正确', w.CSS.highlights.get('script-find').ranges.map(range => range.toString()), Array(6).fill('测试'));
  await click([...q('.find-panel__results').children].at(-1));
  check('numeric与emoji偏移定位实际正文', currentText(), ['测试']);
  const queryUndo = await key(query(), 'z', { ctrlKey: true });
  check('查找框撤销留给输入框而不拦截为工程撤销', queryUndo.defaultPrevented, false);
  const composingEscape = await key(query(), 'Escape', { isComposing: true });
  check('输入法组合期间Escape不关闭', [!!panel(), composingEscape.defaultPrevented], [true, false]);
  const closeKey = await key(query(), 'Escape');
  check('Escape关闭面板且阻止冒泡默认行为', [panel(), closeKey.defaultPrevented], [null, true]);
  check('关闭清理查找高亮', w.CSS.highlights.size, 0);
  check('关闭恢复当前命中段落编辑焦点', document.activeElement.dataset.id, 'find-entity');
  const cmdFind = await key(document.activeElement, 'f', { metaKey: true });
  check('Cmd+F也可打开', [cmdFind.defaultPrevented, !!panel()], [true, true]);
  await type('find');
  await key(query(), 'f', { metaKey: true });
  check('重复Cmd+F聚焦并选中当前查询', [document.activeElement, query().selectionStart, query().selectionEnd], [query(), 0, 4]);
  await click(button('关闭查找'));
  check('关闭按钮可关闭', panel(), null);
  await act(async () => state().setView('board'));
  await key(q('.app-shell'), 'f', { ctrlKey: true });
  check('其他视图查找自动回写作并打开面板', [state().view, !!panel()], ['write', true]);
  await type('find');
  await act(async () => useStore.setState({ pdfExportMode: 'creative' }));
  check('PDF导出期间清除屏幕查找高亮', w.CSS.highlights.size, 0);
  await act(async () => useStore.setState({ pdfExportMode: null }));
  check('导出结束恢复只读查找高亮', currentText(), ['Find']);
  await click(button('关闭查找'));
  check('所有查找交互都未修改正文工程', JSON.stringify(state().project), before);
  check('所有查找交互都不产生历史/dirty/version', [state().past, state().future, state().dirty, state().version], beforeHistory);
  check('正文HTML未被插入搜索mark或其他节点', scriptHTML(), beforeDOM);
  check('无React/窗口运行错误', errors, []);
  console.log(`\n=== search-ui ${assertions}/${assertions} PASS (jsdom; layout/paint stubbed) ===`);
})().catch(error => { originalError(error?.stack || error); process.exitCode = 1; }).finally(async () => {
  if (root) await act(async () => root.unmount());
  console.error = originalError;
  dom.window.close();
});
