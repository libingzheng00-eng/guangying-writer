/** Synthetic React/jsdom character-lines view regression. No user files, apps or native input. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://character-lines-ui.invalid/', pretendToBeVisual: true });
const w = dom.window;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLButtonElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'InputEvent', 'DOMParser', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'NodeFilter']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? w : w[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.HTMLElement.prototype.scrollIntoView = function () {};
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
let checks = 0;
const check = (name, actual, ...expected) => { assert.deepEqual(actual, expected.length ? expected[0] : true, name); checks++; console.log(`  ✓ ${name}`); };
const clone = value => JSON.parse(JSON.stringify(value));
const q = selector => document.querySelector(selector);
const qa = selector => [...document.querySelectorAll(selector)];
const byLabel = value => qa('[aria-label]').find(node => node.getAttribute('aria-label') === value);
const button = (text, scope = document) => [...scope.querySelectorAll('button')].find(node => node.textContent.trim() === text);
const click = node => act(async () => { node.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); });
const input = (node, value) => act(async () => {
  const proto = node instanceof w.HTMLTextAreaElement ? w.HTMLTextAreaElement.prototype : node instanceof w.HTMLSelectElement ? w.HTMLSelectElement.prototype : w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
  node.dispatchEvent(new w.Event(node instanceof w.HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
});
const errors = [];
const consoleError = console.error;
console.error = (...args) => { errors.push(args.join(' ')); consoleError(...args); };

(async () => {
  const built = await esbuild.build({ stdin: { contents: `
    export { CharacterLinesView } from './src/components/CharacterLinesView';
    export { useStore } from './src/store/store';
    export { createProject } from './src/model/project';
    export { serializeProject, parseProject } from './src/io/zhsp';
    export { toPlainText, toHtml } from './src/io/textscript';
  `, resolveDir: repo, sourcefile: 'character-lines-ui.entry.ts', loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', loader: { '.css': 'empty' } });
  const filename = path.join(__dirname, 'character-lines-ui.bundle.cjs');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(__dirname); mod._compile(built.outputFiles[0].text, filename);
  const { CharacterLinesView, useStore, createProject, serializeProject, parseProject, toPlainText, toHtml } = mod.exports;
  const state = () => useStore.getState();

  const p = createProject('合成人物线');
  p.elements = [
    { id: 's1', type: 'scene_heading', text: '内景 合成渡口 日' },
    { id: 'a1', type: 'action', text: '雨声。售票窗口半开。' },
    { id: 'c1', type: 'character', text: '阿明' },
    { id: 'd1', type: 'dialogue', text: '船还开吗？' },
    { id: 'c2', type: 'character', text: '小红' },
    { id: 'd2', type: 'dialogue', text: '今天最后一班。' },
    { id: 's2', type: 'scene_heading', text: '外景 合成码头 夜' },
    { id: 'a2', type: 'action', text: '小红独自等船，想起明仔说过的话。' },
    { id: 's3', type: 'scene_heading', text: '内景 合成船舱 夜' },
    { id: 'c3', type: 'character', text: '阿明' },
    { id: 'p3', type: 'parenthetical', text: '低声' },
    { id: 'd3', type: 'dialogue', text: '我回来了。' },
  ];
  const original = clone(p);
  const located = [];
  await act(async () => { state().loadProject(clone(p), null); useStore.setState({ view: 'character-lines', past: [], future: [] }); });
  const root = createRoot(q('#root'));
  await act(async () => root.render(React.createElement(CharacterLinesView, { onLocate: target => located.push(target) })));

  const people = () => [...byLabel('阅读人物').options].map(option => option.textContent);
  check('人物栏提供初始人物名单', people(), ['阿明 · 未登记', '小红 · 未登记']);
  await input(byLabel('阅读人物'), state().project.elements && byLabel('阅读人物').options[0].value);
  const sceneButtons = () => qa('.character-lines__scenes button').map(node => node.querySelector('strong').textContent);
  check('只列出有该人物发言的场景，按正文顺序', sceneButtons(), ['内景 合成渡口 日', '内景 合成船舱 夜']);
  check('阅读区显示完整场景上下文', q('.character-lines__script').textContent.includes('售票窗口半开'));

  await click(button('台词聚焦'));
  const focused = q('.character-lines__script').textContent;
  check('台词聚焦收起动作与其他人物台词', [focused.includes('船还开吗'), focused.includes('售票窗口'), focused.includes('最后一班')], [true, false, false]);
  await click(button('下一场'));
  check('台词聚焦保留同组括号提示', q('.character-lines__script').textContent.includes('低声'));
  await click(button('完整场景'));

  check('未登记时只读，不写入人物库', state().project.characterWorkspace, undefined);
  await click(button('登记此人物'));
  check('打开登记对话框', !!q('[role="dialog"]'));
  check('规范名预填正文写法', byLabel('规范人物名').value, '阿明');
  await input(byLabel('人物别名'), '明仔');
  const beforeProfile = state().past.length;
  await click(button('保存人物'));
  check('保存后关闭对话框', q('[role="dialog"]'), null);
  check('登记人物与精确别名', state().project.characterWorkspace.profiles.map(item => [item.canonicalName, item.aliases]), [['阿明', ['明仔']]]);
  check('登记是一次可撤销事务', state().past.length, beforeProfile + 1);
  check('登记不改正文', state().project.elements, original.elements);
  check('人物下拉标记为已登记', people()[0], '阿明');

  check('登记别名后，别名命中的场景加入阅读顺序', sceneButtons(), ['内景 合成渡口 日', '外景 合成码头 夜', '内景 合成船舱 夜']);
  await input(byLabel('筛选人物证据'), 'speaking');
  check('发言筛选不把提及当作发言', sceneButtons(), ['内景 合成渡口 日', '内景 合成船舱 夜']);
  await input(byLabel('筛选人物证据'), 'all');
  await click(qa('.character-lines__scenes button').find(node => node.textContent.includes('合成码头')));
  const mention = q('.character-lines__evidence-card');
  check('提及证据显示原文与依据', [mention.querySelector('blockquote').textContent.includes('明仔'), mention.textContent.includes('仅提及') || mention.textContent.includes('待确认')], [true, true]);

  await click(button('确认 / 纠正', mention));
  await input(byLabel('证据分类'), 'present');
  await input(byLabel('纠正说明'), '回忆镜头中出现');
  await click(button('保存纠正'));
  check('作者纠正保存为独立记录', state().project.characterWorkspace.overrides.map(item => [item.classification, item.reason]), [['present', '回忆镜头中出现']]);
  check('纠正不改正文', state().project.elements, original.elements);

  await click(button('添加人物笔记'));
  await input(byLabel('人物笔记内容'), '他一直没有回来。');
  await click(button('保存人物笔记'));
  check('人物笔记写入普通批注并建立关联', [state().project.annotations.length, state().project.characterWorkspace.noteLinks.length], [1, 1]);
  check('笔记显示在本场作者记录', q('.character-lines__notes').textContent.includes('他一直没有回来'));

  await input(byLabel('筛选人物证据'), 'all');
  await input(byLabel('搜索人物线原文'), '回来');
  check('人物线搜索命中计数', q('.character-lines__search [role="status"]').textContent, '1 / 1');
  await click(button('定位命中原文'));
  check('定位返回原始元素与 UTF-16 范围', [located.at(-1).elementId, located.at(-1).start, located.at(-1).end], ['d3', 1, 3]);

  const saved = parseProject(serializeProject(state().project));
  check('人物库随工程保存重开', [saved.characterWorkspace.profiles.length, saved.characterWorkspace.overrides.length, saved.characterWorkspace.noteLinks.length], [1, 1, 1]);
  const exported = toPlainText(state().project) + toHtml(state().project);
  check('人物登记、纠正和笔记不进入正式导出', ['回忆镜头中出现', '他一直没有回来'].some(text => exported.includes(text)), false);

  while (state().past.length) await act(async () => state().undo());
  check('撤销全部人物操作恢复原工程', [state().project.elements, state().project.characterWorkspace?.profiles?.length || 0, state().project.annotations?.length || 0], [original.elements, 0, 0]);

  await act(async () => { state().loadProject(clone(original), null); });
  check('同一工程重开时恢复本机阅读书签', byLabel('搜索人物线原文').value, '回来');
  const other = clone(original); other.id = 'other-synthetic-project';
  await act(async () => { state().loadProject(other, null); });
  check('切换到另一工程会重置阅读会话', [!!q('[role="dialog"]'), byLabel('搜索人物线原文').value], [false, '']);

  await act(async () => root.unmount());
  check('没有 React 运行时错误', errors.filter(line => !line.includes('not wrapped in act')), []);
  console.log(`\n=== character-lines-ui ${checks}/${checks} PASS (jsdom; real input, paint and PDF validated separately) ===`);
})().catch(error => { console.error(error); process.exit(1); });
