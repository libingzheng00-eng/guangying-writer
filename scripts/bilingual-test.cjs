/**
 * Bilingual scripts: per-paragraph translations (ja/en) with stale detection, the 双语 view,
 * translation display in writing/preview, the project-file contract, and the translation
 * skill's extract/apply scripts (which must hash the source exactly like the app).
 * Synthetic data only; jsdom for the view; real temp files for the skill scripts.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://bilingual.invalid/', pretendToBeVisual: true });
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
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.join(' ')); originalError(...args); };

(async () => {
  const repo = path.resolve(__dirname, '..');
  const built = await esbuild.build({ stdin: { contents: `
    export { sourceHash, translationState, translationProgress } from './src/model/translation';
    export { BilingualView } from './src/components/BilingualView';
    export { StaticBlock } from './src/components/ScriptBlock';
    export { useStore } from './src/store/store';
    export { createProject, FORMAT_REVISION } from './src/model/project';
    export { serializeProject, parseProject } from './src/io/zhsp';
  `, resolveDir: repo, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', loader: { '.css': 'empty', '.png': 'dataurl' } });
  const filename = path.join(__dirname, 'bilingual.bundle.cjs');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(__dirname); mod._compile(built.outputFiles[0].text, filename);
  const m = mod.exports;
  // Windows 上动态 import 只接受 file:// 地址，不能直接用盘符路径。
  const lib = await import(pathToFileURL(path.join(repo, 'skills/guangying-translate/scripts/zhsp-lib.mjs')).href);
  const state = () => m.useStore.getState();

  // ---- the skill hashes the source exactly like the app ----
  const samples = ['', '雨水顺着屋檐往下淌。', '<b>粗</b>体&amp;符号<br>第二行', '  前后空格  ', 'A &lt;tag&gt; &quot;q&quot; &#39;s', '换行\r\n统一'];
  check('技能脚本与软件的原文指纹完全一致', samples.map(lib.sourceHash), samples.map(m.sourceHash));
  check('只改格式不改文字时指纹不变', m.sourceHash('<b>你好</b>'), m.sourceHash('你好'));

  // ---- store: write, stale, review, clear ----
  const p = m.createProject('合成双语');
  p.elements = [
    { id: 's1', type: 'scene_heading', text: '内景 合成车站 夜' },
    { id: 'a1', type: 'action', text: '雨水顺着屋檐往下淌。' },
    { id: 'c1', type: 'character', text: '林舟' },
    { id: 'd1', type: 'dialogue', text: '你来了。' },
    { id: 'n1', type: 'note', text: '内部备忘' },
  ];
  await act(async () => { state().loadProject(JSON.parse(JSON.stringify(p))); m.useStore.setState({ past: [], future: [] }); });
  await act(async () => { state().setTranslation('d1', 'ja', 'き'); state().setTranslation('d1', 'ja', '来たのね。'); });
  const d1 = () => state().project.elements.find((e) => e.id === 'd1');
  check('写译文：连续输入合并为一步撤销，记下原文指纹', [d1().tr.ja.text, d1().tr.ja.srcHash, state().past.length], ['来たのね。', m.sourceHash('你来了。'), 1]);
  check('日文已译、英文未译，互不影响', [m.translationState(d1(), 'ja'), m.translationState(d1(), 'en')], ['done', 'missing']);
  await act(async () => state().setText('d1', '你终于来了。'));
  check('原文改过后译文标为待复查', m.translationState(d1(), 'ja'), 'stale');
  await act(async () => state().markTranslationReviewed('d1', 'ja'));
  check('点「已复查」只更新指纹，译文不变', [m.translationState(d1(), 'ja'), d1().tr.ja.text], ['done', '来たのね。']);
  check('进度只算可译段落（不含备忘）', m.translationProgress(state().project.elements, 'ja'), { total: 4, done: 1, stale: 0, missing: 3 });
  await act(async () => state().setTranslation('d1', 'ja', '   '));
  check('清空译文就删掉这条', [d1().tr], [undefined]);

  // ---- project file ----
  await act(async () => { state().setTranslation('d1', 'en', 'You came.'); state().setGlossary('en', [{ source: '林舟', target: 'Lin Zhou' }]); });
  const saved = JSON.parse(m.serializeProject(state().project));
  check('保存记录新的格式修订号', saved.formatRevision, m.FORMAT_REVISION);
  const reopened = m.parseProject(JSON.stringify(saved));
  check('译文和译名表保存后重开不丢', [reopened.elements.find((e) => e.id === 'd1').tr.en.text, reopened.translation.glossary.en], ['You came.', [{ source: '林舟', target: 'Lin Zhou' }]]);
  const bad = JSON.parse(JSON.stringify(saved)); bad.project.elements[3].tr = { 'x"y': { text: 'a', srcHash: '00' } };
  assert.throws(() => m.parseProject(JSON.stringify(bad))); checks++; console.log('  ✓ 非法语言代码被拒绝');
  const ctrl = JSON.parse(JSON.stringify(saved)); ctrl.project.elements[3].tr.en.text = 'A\u0007B';
  check('译文里的控制字符被去掉', m.parseProject(JSON.stringify(ctrl)).elements[3].tr.en.text, 'AB');

  // ---- the 双语 view ----
  localStorage.clear();
  await act(async () => { state().loadProject(JSON.parse(JSON.stringify(p))); m.useStore.setState({ view: 'bilingual', shownTranslation: null, past: [] }); });
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement('div', { className: 'app-shell', 'data-theme': 'day' }, React.createElement(m.BilingualView))));
  const rows = () => [...document.querySelectorAll('.bilingual__row')];
  check('每个可译段落一行，备忘不出现', rows().map((r) => r.dataset.id), ['s1', 'a1', 'c1', 'd1']);
  check('左边原文只读，右边是译文框', [rows()[1].querySelector('.bilingual__source-text').textContent, !!rows()[1].querySelector('textarea'), rows()[1].querySelector('[contenteditable]')], ['雨水顺着屋檐往下淌。', true, null]);
  const area = rows()[1].querySelector('textarea');
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(area, '雨が軒先から滴り落ちる。');
    area.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  check('在右边输入即写进这一段的日文译文', state().project.elements.find((e) => e.id === 'a1').tr.ja.text, '雨が軒先から滴り落ちる。');
  check('进度显示已译段数', document.querySelector('.bilingual__progress').textContent.startsWith('已译 1/4'), true);
  await act(async () => state().setText('a1', '雨小了。'));
  check('原文改过后这一行标黄并出现「已复查」', [rows()[1].classList.contains('is-stale'), !!rows()[1].querySelector('.bilingual__stale button')], [true, true]);
  await act(async () => rows()[1].querySelector('.bilingual__stale button').dispatchEvent(new w.MouseEvent('click', { bubbles: true })));
  check('点「已复查」后不再标黄', rows()[1].classList.contains('is-done'), true);
  await act(async () => { [...document.querySelectorAll('.bilingual__bar [role="tab"]')].find((b) => b.textContent === '英文').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  check('切到英文后显示英文译文（这里还没翻）', rows()[1].querySelector('textarea').value, '');
  const filter = document.querySelector('select[aria-label="只看"]');
  await act(async () => { Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, 'value').set.call(filter, 'missing'); filter.dispatchEvent(new w.Event('change', { bubbles: true })); });
  check('只看未译', rows().length, 4);
  await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent === '译名表').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await act(async () => { [...document.querySelectorAll('.bilingual__glossary button')].find((b) => b.textContent.includes('添加')).dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  check('译名表可以加空行再填', document.querySelectorAll('.bilingual__glossary-row').length, 1);
  await act(async () => root.unmount());

  // ---- translation display in writing / preview ----
  await act(async () => state().setShownTranslation('ja'));
  const root2 = createRoot(document.getElementById('root'));
  await act(async () => root2.render(React.createElement(m.StaticBlock, { el: state().project.elements.find((e) => e.id === 'a1'), settings: state().project.settings })));
  check('打开「显示译文」后段落带上译文（预览 / 对照版 PDF）', document.querySelector('[data-id="a1"]').getAttribute('data-tr'), '雨が軒先から滴り落ちる。');
  check('显示偏好记在本机', localStorage.getItem('guangying:shownTranslation'), 'ja');
  await act(async () => state().setShownTranslation(null));
  check('关掉后不显示', document.querySelector('[data-id="a1"]').getAttribute('data-tr'), null);
  await act(async () => root2.unmount());

  // ---- the skill scripts on a real file ----
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gy-translate-'));
  const file = path.join(dir, '合成剧本.zhsp');
  const fresh = m.createProject('合成剧本'); fresh.elements = p.elements;
  fs.writeFileSync(file, m.serializeProject(fresh));
  const script = (name, ...args) => execFileSync(process.execPath, [path.join(repo, 'skills/guangying-translate/scripts', name), ...args], { encoding: 'utf8' });
  const work = JSON.parse(script('extract.mjs', file, '--lang', 'ja'));
  check('取出段落：只有可译段落，带场次与说话人', work.items.map((i) => [i.id, i.scene, i.speaker || '', i.state]), [['s1', 1, '', 'missing'], ['a1', 1, '', 'missing'], ['c1', 1, '', 'missing'], ['d1', 1, '林舟', 'missing']]);
  const input = path.join(dir, 'ja.json');
  fs.writeFileSync(input, JSON.stringify({ items: [{ id: 's1', text: '〇 駅（夜）' }, { id: 'd1', text: '来たのね。' }, { id: 'nope', text: 'x' }], glossary: [{ source: '林舟', target: 'リン・ジョウ' }], notes: '静かな口調。' }));
  const original = fs.readFileSync(file, 'utf8');
  const out = script('apply.mjs', file, input, '--lang', 'ja');
  check('写回：报告写了几段、跳过找不到的段落，并留下备份', [/写入 2 段/.test(out), /1 个段落在剧本里找不到/.test(out), fs.readdirSync(dir).some((f) => f.includes('翻译前备份'))], [true, true, true]);
  const applied = m.parseProject(fs.readFileSync(file, 'utf8'));
  check('软件能打开写回后的文件，译文都标为已译', applied.elements.filter((e) => e.tr?.ja).map((e) => [e.id, m.translationState(e, 'ja')]), [['s1', 'done'], ['d1', 'done']]);
  check('原文一个字都没变', applied.elements.map((e) => [e.id, e.type, e.text]), JSON.parse(original).project.elements.map((e) => [e.id, e.type, e.text]));
  check('译名表与翻译说明写入工程', [applied.translation.glossary.ja, applied.translation.notes.ja], [[{ source: '林舟', target: 'リン・ジョウ' }], '静かな口調。']);
  const needed = JSON.parse(script('extract.mjs', file, '--lang', 'ja', '--only-needed'));
  check('改稿后只取未译 / 待复查的段落', needed.items.map((i) => i.id), ['a1', 'c1']);
  fs.rmSync(dir, { recursive: true, force: true });

  check('没有 React 运行时错误', errors.filter((line) => !line.includes('not wrapped in act')), []);
  console.log(`\n=== bilingual ${checks}/${checks} PASS (jsdom + real temp files for the skill scripts) ===`);
})().catch((error) => { console.error(error); process.exit(1); });
