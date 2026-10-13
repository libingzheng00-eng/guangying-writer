/**
 * Find & replace: pure HTML replacement, single-undo store transaction and the real App panel.
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
    stdin: { contents: `export { default as App } from './src/App'; export { useStore } from './src/store/store'; export { createProject } from './src/model/project'; export { replaceTextRanges, searchText } from './src/model/search';`, resolveDir: repo, sourcefile: 'find-replace.entry.ts', loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', loader: { '.png': 'dataurl', '.css': 'empty' },
  });
  const testModule = new Module(path.join(__dirname, 'find-replace-test.bundle.cjs'), module);
  testModule.filename = path.join(__dirname, 'find-replace-test.bundle.cjs');
  testModule.paths = Module._nodeModulePaths(__dirname);
  testModule._compile(built.outputFiles[0].text, testModule.filename);
  const { App, useStore, createProject, replaceTextRanges, searchText } = testModule.exports;

  // ---- pure helper ----
  check('替换保留格式标签', replaceTextRanges('<b>老王</b>说：老王来了', [{ start: 0, end: 2 }, { start: 4, end: 6 }], '老李'), '<b>老李</b>说：老李来了');
  check('替换文字按纯文本写入，不解释为 HTML', replaceTextRanges('甲乙', [{ start: 0, end: 1 }], '<i>x</i>&'), '&lt;i&gt;x&lt;/i&gt;&amp;乙');
  check('跨格式边界的命中沿用首字格式并清理空标签', replaceTextRanges('<b>阿</b>明到了', [{ start: 0, end: 2 }], '阿强'), '<b>阿强</b>到了');
  check('可替换为空字符串以删除', replaceTextRanges('删掉这三个字', [{ start: 0, end: 2 }], ''), '这三个字');
  check('BR 计一个字符且偏移正确', replaceTextRanges('上一行<br>下一行', [{ start: 4, end: 6 }], '第二'), '上一行<br>第二行');
  check('实体按解码后的文字定位', replaceTextRanges('&amp;合成', [{ start: 1, end: 3 }], '替换'), '&amp;替换');
  check('越界或重叠范围被拒绝', [replaceTextRanges('短', [{ start: 0, end: 5 }], 'x'), replaceTextRanges('一二三', [{ start: 0, end: 2 }, { start: 1, end: 3 }], 'x')], [null, null]);

  // ---- real App panel and store ----
  const project = createProject('合成替换测试');
  project.titlePage.show = false;
  project.elements = [
    { id: 'r-heading', type: 'scene_heading', text: '内景 合成车站 日' },
    { id: 'r-action', type: 'action', text: '<b>老王</b>看表。老王叹气。' },
    { id: 'r-cue', type: 'character', text: '老王' },
    { id: 'r-line', type: 'dialogue', text: '车又晚了。' },
    { id: 'r-note', type: 'note', text: '老王的台词还要改' },
  ];
  project.annotations = [{ id: 'r-ann', createdAt: 1, updatedAt: 1, body: '合成批注', status: 'pending',
    anchor: { kind: 'text', elementId: 'r-action', start: 0, end: 2, quote: '老王', sourceText: '老王看表。老王叹气。' }, anchorState: 'current' }];
  localStorage.setItem('guangying:autosave', JSON.stringify({ project, filePath: null }));
  localStorage.setItem('guangying:startup-preference', 'resume');
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(App)); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
  const state = () => useStore.getState();
  const q = selector => document.querySelector(selector);
  const status = () => q('.find-panel [role="status"]')?.textContent;
  const setInput = async (node, value) => act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  const click = async target => act(async () => { target.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); });
  const press = async (target, name) => act(async () => { target.dispatchEvent(new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })); });
  const buttonText = text => [...document.querySelectorAll('.find-panel button')].find(node => node.textContent === text);
  const text = id => state().project.elements.find(element => element.id === id).text;

  await press(q('.sc-el--editable'), 'f');
  await act(async () => { window.dispatchEvent(new w.Event('guangying:find')); });
  check('查找面板打开', !!q('.find-panel'));
  check('替换默认收起，不增加干扰', q('input[aria-label="替换为"]'), null);
  await click(buttonText('替换'));
  check('点击「替换」展开替换栏', !!q('input[aria-label="替换为"]'));
  await setInput(q('input[aria-label="查找内容"]'), '老王');
  check('查找命中正文与备忘共四处', status(), '1 / 4 处');
  await setInput(q('input[aria-label="替换为"]'), '老李');
  const historyBefore = state().past.length;
  await click(q('.find-panel__replace button'));
  check('替换当前一处，保留加粗', text('r-action'), '<b>老李</b>看表。老王叹气。');
  check('单处替换是一步撤销', state().past.length, historyBefore + 1);
  check('剩余命中自动更新', status(), '1 / 3 处');
  check('批注原文改变后保守标记为已改变', state().project.annotations[0].anchorState, 'changed');
  await press(q('input[aria-label="替换为"]'), 'Enter');
  check('在替换框按 Enter 替换下一处', text('r-action'), '<b>老李</b>看表。老李叹气。');
  await click(buttonText('全部替换'));
  check('全部替换覆盖人物与备忘', [text('r-cue'), text('r-note')], ['老李', '老李的台词还要改']);
  check('全部替换后没有剩余命中', status(), '没有找到匹配内容');
  check('全部替换给出数量提示', state().toast.text.startsWith('已替换 2 处'));
  check('场次与对白不受影响', [text('r-heading'), text('r-line')], ['内景 合成车站 日', '车又晚了。']);
  check('替换标记工程未保存', state().dirty, true);
  await act(async () => state().undo());
  check('撤销一次恢复整批全部替换', [text('r-cue'), text('r-note'), text('r-action')], ['老王', '老王的台词还要改', '<b>老李</b>看表。老李叹气。']);
  await act(async () => state().redo());
  check('重做恢复整批替换', text('r-cue'), '老李');

  const epoch = state().documentEpoch;
  check('原文已变化的过期命中被整体拒绝', state().replaceMatches([{ elementId: 'r-line', start: 0, end: 1, text: '不' }], 'x', epoch), 0);
  check('过期文档的命中被拒绝', state().replaceMatches([{ elementId: 'r-line', start: 0, end: 1, text: '车' }], 'x', epoch + 1), 0);
  check('被拒绝时正文不变', text('r-line'), '车又晚了。');
  check('searchText 与替换后的偏移一致', searchText(text('r-action')), '老李看表。老李叹气。');

  await act(async () => root.unmount());
  check('无React/窗口运行错误', errors.filter(line => !line.includes('not wrapped in act')), []);
  console.log(`\n=== find-replace ${assertions}/${assertions} PASS (jsdom; real IME and paint validated separately) ===`);
})().catch(error => { console.error(error); process.exit(1); });
