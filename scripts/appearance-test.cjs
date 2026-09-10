/** 正文字色契约：默认日黑夜白，旧/自定义 HEX 保留；外观不进入工程与撤销。
 * 只在内存中转译源码、使用内存 localStorage 替身与合成工程，不访问用户资料。
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const saved = new Map();
const storage = {
  getItem: (key) => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, String(value)),
};
let passed = 0;
function check(name, run) { run(); passed += 1; console.log(`  ✓ ${name}`); }

(async () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    const result = await esbuild.build({
      stdin: { contents: 'export * from "./src/model/appearance"; export { useStore } from "./src/store/store"; export { createProject } from "./src/model/project";', resolveDir: root, loader: 'ts' },
      bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
    });
    function fresh(initial = {}) {
      saved.clear();
      for (const [key, value] of Object.entries(initial)) saved.set(key, value);
      const bundle = new Module(path.join(root, '.appearance-test-memory.cjs'), module);
      bundle.filename = path.join(root, '.appearance-test-memory.cjs');
      bundle.paths = Module._nodeModulePaths(root);
      bundle._compile(result.outputFiles[0].text, bundle.filename);
      return bundle.exports;
    }
    const { DEFAULT_FONT_COLOR, normalizeFontColor, resolveFontColor } = fresh();
    check('默认值是 auto，不再预置荧光黄', () => assert.equal(DEFAULT_FONT_COLOR, 'auto'));
    for (const value of [null, '', ' ', 'invalid', '#12', '#zzzzzz', 'rgb(0,0,0)', 'auto']) {
      check(`normalize ${JSON.stringify(value)} → auto`, () => assert.equal(normalizeFontColor(value), 'auto'));
    }
    for (const [color, normalized, resolved] of [
      ['#123456', '#123456', '#123456'], ['#AbC123', '#abc123', '#abc123'],
      ['#abc', '#abc', '#aabbcc'], [' #AbC ', '#abc', '#aabbcc'],
      ['#e9ff3a', '#e9ff3a', '#e9ff3a'], ['#000000', '#000000', '#000000'], ['#ffffff', '#ffffff', '#ffffff'],
    ]) {
      check(`自定义/旧 HEX ${color} 在日夜均保留`, () => {
        assert.equal(normalizeFontColor(color), normalized);
        assert.equal(resolveFontColor(color, 'day'), resolved);
        assert.equal(resolveFontColor(color, 'night'), resolved);
      });
    }
    for (const [theme, color] of [['day', '#000000'], ['night', '#ffffff']]) {
      check(`默认/非法颜色在 ${theme} 解析为 ${color}`, () => {
        assert.equal(resolveFontColor('auto', theme), color);
        assert.equal(resolveFontColor('invalid', theme), color);
      });
    }
    for (const [name, initial, expected] of [
      ['首次启动默认跟随主题', {}, 'auto'],
      ['旧品牌黄字设置保留', { 'mojiang:fontColor': '#e9ff3a' }, '#e9ff3a'],
      ['已有新存储键 HEX 保留', { 'guangying:fontColor': '#123456' }, '#123456'],
      ['新键优先于旧键', { 'guangying:fontColor': '#112233', 'mojiang:fontColor': '#e9ff3a' }, '#112233'],
      ['恢复 auto 后不回退旧黄字', { 'guangying:fontColor': 'auto', 'mojiang:fontColor': '#e9ff3a' }, 'auto'],
      ['非法存储值回退 auto', { 'guangying:fontColor': 'invalid' }, 'auto'],
    ]) {
      check(name, () => assert.equal(fresh(initial).useStore.getState().fontColor, expected));
    }

    const { useStore, createProject } = fresh();
    const project = createProject('外观隔离测试');
    project.elements = [{ id: 'appearance-action', type: 'action', text: '合成原始段落' }];
    useStore.setState({ project, past: [], future: [], version: 0, dirty: false, activeId: 'appearance-action' });
    const state = () => useStore.getState();
    state().setText('appearance-action', '合成修改段落');
    state().undo();
    function changeAppearanceWithoutHistory(fontColor, appTheme) {
      const before = state();
      const serialized = JSON.stringify(before.project);
      before.setFontColor(fontColor);
      state().setAppTheme(appTheme);
      const after = state();
      for (const key of ['project', 'past', 'future', 'version', 'dirty', 'activeId']) {
        assert.equal(after[key], before[key], `修改外观不得改变 ${key}`);
      }
      assert.equal(JSON.stringify(after.project), serialized, '不得原位修改工程字段');
      assert.equal(after.fontColor, normalizeFontColor(fontColor));
      assert.equal(after.appTheme, appTheme);
      assert.equal(storage.getItem('guangying:fontColor'), normalizeFontColor(fontColor));
      assert.equal(storage.getItem('guangying:appTheme'), appTheme);
    }
    check('有重做记录时改外观不改变工程/历史/dirty/version', () => {
      assert.ok(state().future.length > 0);
      changeAppearanceWithoutHistory('#e9ff3a', 'day');
      state().redo();
      assert.equal(state().project.elements[0].text, '合成修改段落');
      assert.equal(state().fontColor, '#e9ff3a');
      assert.equal(state().appTheme, 'day');
    });
    check('有撤销记录时恢复默认/切夜间不生成历史且正文可撤销', () => {
      assert.ok(state().past.length > 0);
      changeAppearanceWithoutHistory('auto', 'night');
      state().undo();
      assert.equal(state().project.elements[0].text, '合成原始段落');
      assert.equal(state().fontColor, 'auto');
      assert.equal(state().appTheme, 'night');
    });
    check('setFontColor 非法值归一化为 auto 且不生成历史', () => changeAppearanceWithoutHistory('invalid', 'day'));
    console.log(`appearance: ${passed} checks passed; no real userData/localStorage accessed`);
    console.log('边界：纯函数与真实 store action 检查，不证明 CSS 级联、颜色控件或 PDF 实际呈现。');
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
