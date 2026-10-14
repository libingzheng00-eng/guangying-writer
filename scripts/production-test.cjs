/**
 * Shooting-script locks and alternate dialogue: scene-number locking (5A/5B, A1), page locking
 * (12A/12B pages, 12-13 ranges) through the real paginator, alternate dialogue versions in the
 * store and the writing view, project-file round trips and FDX scene numbers.
 * Synthetic data in jsdom; pagination uses synthetic heights, not real layout.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://production.invalid/', pretendToBeVisual: true });
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
    export { nextInsertedNumber, sceneNumbersFor, lockedPageLabels, pageLockFromPages, plainPageNumber } from './src/model/locks';
    export { addAlt, selectAlt, deleteCurrentAlt, altVersions, currentAltNo } from './src/model/altDialogue';
    export { paginateMeasured, PaginationProvider } from './src/hooks/PaginationProvider';
    export { Editor } from './src/components/Editor';
    export { useStore } from './src/store/store';
    export { createProject, deriveScenes } from './src/model/project';
    export { serializeProject, parseProject } from './src/io/zhsp';
    export { toFdx } from './src/io/fdx';
  `, resolveDir: repo, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', loader: { '.css': 'empty', '.png': 'dataurl' } });
  const filename = path.join(__dirname, 'production.bundle.cjs');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(__dirname); mod._compile(built.outputFiles[0].text, filename);
  const m = mod.exports;
  const state = () => m.useStore.getState();

  // ---- scene numbers ----
  check('插入编号：5→5A→5B，5Z→5ZA，跳过已占用', [m.nextInsertedNumber('5', new Set()), m.nextInsertedNumber('5A', new Set()), m.nextInsertedNumber('5Z', new Set()), m.nextInsertedNumber('5', new Set(['5A']))], ['5A', '5B', '5ZA', '5B']);
  const lock = { lockedAt: 1, numbers: { a: '1', b: '2', c: '3' } };
  check('未锁定时连续编号', m.sceneNumbersFor(['a', 'b', 'c']), ['1', '2', '3']);
  check('锁定后插在 2 后面的两场编成 2A、2B，删掉的场号不补位', m.sceneNumbersFor(['a', 'b', 'x', 'y', 'c'], lock), ['1', '2', '2A', '2B', '3']);
  check('插在第一场前面的编成 A1、B1', m.sceneNumbersFor(['p', 'q', 'a', 'c'], lock), ['A1', 'B1', '1', '3']);

  // ---- page labels ----
  const plock = { lockedAt: 1, pages: [{ id: 'e1', label: '1' }, { id: 'e2', label: '2' }, { id: null, label: '3' }, { id: 'e4', label: '4' }] };
  check('锁定页原样；续页先用原页码，再编 A、B', m.lockedPageLabels(plock, [0, 1, -1, -1, 3], new Set([0, 1, 3])), ['1', '2', '3', '3A', '4']);
  check('第 2 页（连同它的续页 3）整页删掉后，第 1 页显示为 1-3', m.lockedPageLabels(plock, [0, 3], new Set([0, 3])), ['1-3', '4']);
  check('页码：独立标题页时正文从 1 起，否则从「页码起始」起', [m.plainPageNumber(1, true, 5), m.plainPageNumber(0, false, 5)], ['2', '5']);

  // ---- real paginator with a page lock ----
  const p = m.createProject('合成拍摄稿');
  p.settings.moreText = ''; p.settings.showContd = false;
  p.elements = Array.from({ length: 9 }, (_, i) => ({ id: `e${i + 1}`, type: 'action', text: `合成动作 ${i + 1}` }));
  const geo = { lineHeightPx: 10, contentHeightPx: 60, contentWidthPx: 400 };
  const heights = (project, lines = {}) => new Map(project.elements.map((e) => [`s:${e.id}`, (lines[e.id] || 1) * 10]));
  // 每段 1 行 + 1 行段前空白 = 2 行，一页 6 行放 3 段。
  const before = m.paginateMeasured(p, heights(p), geo);
  check('锁定前 9 段分成 3 页', before.pages.map((page) => page.items.map((it) => it.elements[0].id)), [['e1', 'e2', 'e3'], ['e4', 'e5', 'e6'], ['e7', 'e8', 'e9']]);
  p.pageLock = { lockedAt: 1, pages: m.pageLockFromPages(before.pages, (i) => String(i + 1)) };
  check('锁页表记下每页起头段落和页码', p.pageLock.pages, [{ id: 'e1', label: '1' }, { id: 'e4', label: '2' }, { id: 'e7', label: '3' }]);
  const grown = { ...p, elements: [...p.elements.slice(0, 4), { id: 'n1', type: 'action', text: '新加的' }, { id: 'n2', type: 'action', text: '新加的' }, ...p.elements.slice(4)] };
  const after = m.paginateMeasured(grown, heights(grown), geo);
  check('第 2 页加长后多出 2A 页，第 3 页仍从原来那段起头', after.pages.map((page) => [page.label, page.items[0].elements[0].id]), [['1', 'e1'], ['2', 'e4'], ['2A', 'e5'], ['3', 'e7']]);
  const shrunk = { ...p, elements: p.elements.filter((e) => !['e2', 'e3'].includes(e.id)) };
  check('删短的页保留原页码，不把后面的内容拉上来', m.paginateMeasured(shrunk, heights(shrunk), geo).pages.map((page) => [page.label, page.items.length]), [['1', 1], ['2', 3], ['3', 3]]);
  const gone = { ...p, elements: p.elements.filter((e) => !['e4', 'e5', 'e6'].includes(e.id)) };
  check('整页内容删掉后，前一页显示为 1-2', m.paginateMeasured(gone, heights(gone), geo).pages.map((page) => page.label), ['1-2', '3']);

  const headed = { ...p, elements: p.elements.map((e) => e.id === 'e3' ? { ...e, type: 'scene_heading', text: '内景 合成 夜' } : e) };
  check('锁定页前面的场次标题不会被单独挤到一页', m.paginateMeasured(headed, heights(headed), geo).pages.map((page) => [page.label, page.items.map((it) => it.elements[0].id)]),
    [['1', ['e1', 'e2', 'e3']], ['2', ['e4', 'e5', 'e6']], ['3', ['e7', 'e8', 'e9']]]);

  // ---- store: scene lock and alternates, each one undo step ----
  const q = m.createProject('合成备选');
  q.elements = [
    { id: 's1', type: 'scene_heading', text: '内景 合成车站 日' }, { id: 'c1', type: 'character', text: '林舟' }, { id: 'd1', type: 'dialogue', text: '第一版' },
    { id: 's2', type: 'scene_heading', text: '外景 合成码头 夜' },
  ];
  await act(async () => { state().loadProject(JSON.parse(JSON.stringify(q))); m.useStore.setState({ view: 'write', activeId: 'd1', past: [], future: [] }); });
  await act(async () => state().lockSceneNumbers());
  await act(async () => state().insertAfter('d1', 'scene_heading', '内景 新插入 夜'));
  check('锁定场号后插入的新场编成 1A', m.deriveScenes(state().project).map((s) => s.number), ['1', '1A', '2']);
  check('FDX 导出用锁定后的场号', [...m.toFdx(state().project).matchAll(/<Paragraph Number="([^"]+)"/g)].map((x) => x[1]), ['1', '1A', '2']);
  await act(async () => { state().undo(); state().undo(); });
  check('撤销两步回到未锁定', [state().project.sceneLock, m.deriveScenes(state().project).map((s) => s.number)], [undefined, ['1', '2']]);

  const history = state().past.length;
  await act(async () => state().addAltVersion('d1'));
  await act(async () => state().setText('d1', '第二版'));
  const d1 = () => state().project.elements.find((e) => e.id === 'd1');
  check('新建备选：旧版本保留，正文是新版本', [d1().text, d1().alts, d1().altNo], ['第二版', ['第一版'], 2]);
  await act(async () => state().selectAltVersion('d1', 1));
  check('切回第 1 版', [d1().text, d1().alts, d1().altNo, m.altVersions(d1())], ['第一版', ['第二版'], 1, ['第一版', '第二版']]);
  check('切换版本是一步可撤销的修改', state().past.length > history, true);
  const file = m.parseProject(m.serializeProject(state().project));
  check('备选版本保存后重开不丢', [file.elements.find((e) => e.id === 'd1').alts, file.elements.find((e) => e.id === 'd1').altNo], [['第二版'], 1]);
  const dirty = JSON.parse(m.serializeProject(state().project));
  dirty.project.elements.find((e) => e.id === 'd1').alts = ['<script>alert(1)</script><b>粗</b>'];
  dirty.project.elements.find((e) => e.id === 'd1').altNo = 9;
  const cleaned = m.parseProject(JSON.stringify(dirty)).elements.find((e) => e.id === 'd1');
  check('备选内容同正文一样清洗，越界序号回到 1', [cleaned.alts, cleaned.altNo], [['<b>粗</b>'], 1]);
  check('导出只用当前版本', [m.toFdx(state().project).includes('第一版'), m.toFdx(state().project).includes('第二版')], [true, false]);
  await act(async () => state().deleteAltVersion('d1'));
  check('删掉当前版本后只剩另一个，备选字段清空', [d1().text, d1().alts, d1().altNo], ['第二版', undefined, undefined]);
  const locked = m.parseProject(m.serializeProject({ ...state().project, sceneLock: { lockedAt: 5, numbers: { s1: '1', s2: '2' } }, pageLock: { lockedAt: 5, pages: [{ id: 's1', label: '1' }, { id: null, label: '2' }] } }));
  check('场号 / 页码锁定保存后重开不丢', [locked.sceneLock.numbers, locked.pageLock.pages], [{ s1: '1', s2: '2' }, [{ id: 's1', label: '1' }, { id: null, label: '2' }]]);

  // ---- writing view: the alternate-dialogue bar ----
  await act(async () => { state().loadProject(JSON.parse(JSON.stringify(q))); m.useStore.setState({ view: 'write', activeId: 'c1' }); });
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(m.PaginationProvider, null, React.createElement('div', { className: 'app-shell', 'data-theme': 'day' }, React.createElement(m.Editor)))));
  check('光标在人物名上时不出现备选工具条', document.querySelector('.alt-dialogue-bar'), null);
  await act(async () => m.useStore.setState({ activeId: 'd1' }));
  const bar = () => document.querySelector('.alt-dialogue-bar');
  check('光标在对白上时出现备选工具条，只有一个版本时只显示＋', [!!bar(), [...bar().querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))], [true, ['新建备选版本']]);
  const press = (label) => act(async () => { bar().querySelector(`button[aria-label="${label}"]`).dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await press('新建备选版本');
  check('新建后显示 2/2 并出现切换和删除', [bar().querySelector('.alt-dialogue-bar__count').textContent, !!bar().querySelector('button[aria-label="上一个版本"]'), !!bar().querySelector('button[aria-label="删除当前版本"]')], ['2/2', true, true]);
  await act(async () => state().setText('d1', '改过的第二版'));
  await press('上一个版本');
  const block = () => document.querySelector('.script-flow [data-id="d1"]');
  check('切回第 1 版，正文显示第 1 版，带版本数记号', [bar().querySelector('.alt-dialogue-bar__count').textContent, block().textContent, block().getAttribute('data-alts')], ['1/2', '第一版', '2']);
  await press('下一个版本');
  check('再切回改过的第 2 版', block().textContent, '改过的第二版');
  await act(async () => root.unmount());

  check('没有 React 运行时错误', errors.filter((line) => !line.includes('not wrapped in act')), []);
  console.log(`\n=== production ${checks}/${checks} PASS (jsdom + synthetic pagination heights) ===`);
})().catch((error) => { console.error(error); process.exit(1); });
