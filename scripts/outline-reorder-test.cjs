/** 真实 React 挂载与 drag/drop 事件回归；数据完全合成，不访问用户应用/存储。
 * jsdom 不提供鼠标命中或原生拖放，卡片矩形/DataTransfer 为测试替身；仍须浏览器拖拽验收。
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://outline-test.invalid/', pretendToBeVisual: true });
const originals = new Map();
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'localStorage']) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : dom.window[name] });
}
originals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
let mounted;
let checks = 0;
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
const check = (label, run) => { run(); checks += 1; console.log(`  ✓ ${label}`); };

(async () => {
  try {
    const result = await esbuild.build({
      stdin: { contents: 'export {Sidebar} from "./src/components/Sidebar"; export {useStore} from "./src/store/store"; export {createProject,deriveScenes} from "./src/model/project";', resolveDir: root, loader: 'tsx' },
      bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['react', 'react-dom', 'react-dom/*'],
    });
    const bundle = new Module(path.join(root, '.outline-test-memory.cjs'), module);
    bundle.filename = path.join(root, '.outline-test-memory.cjs');
    bundle.paths = Module._nodeModulePaths(root);
    bundle._compile(result.outputFiles[0].text, bundle.filename);
    const { Sidebar, useStore, createProject, deriveScenes } = bundle.exports;
    const state = () => useStore.getState();
    const original = createProject('合成大纲拖拽测试');
    original.elements = [{ id: 'prefix', type: 'act', text: '第一幕' }];
    for (const letter of ['a', 'b', 'c', 'd']) {
      original.elements.push(
        { id: `${letter}-scene`, type: 'scene_heading', text: `内景 合成地点${letter} 日` },
        { id: `${letter}-action`, type: 'action', text: `合成动作${letter}` },
        { id: `${letter}-character`, type: 'character', text: '测试角色' },
        { id: `${letter}-dialogue`, type: 'dialogue', text: `合成对白${letter}` },
      );
      original.sceneMeta.push({ id: `${letter}-meta`, elementId: `${letter}-scene`, title: `合成标题${letter}`, synopsis: `合成摘要${letter}`, color: '#cfe4ff', actId: original.acts[0].id });
    }
    original.beats = [{ id: 'fixture-beat', kind: 'beat', text: '合成关联卡', color: '#cfe4ff', x: 40, y: 60, sceneId: 'a-scene' }];
    original.boardLinks = [{ id: 'fixture-link', from: 'scene:a-scene', to: 'beat:fixture-beat', note: '合成关系' }];
    let mutations = 0;
    const mutate = state().mutate;
    useStore.setState({ mutate: (...args) => { mutations += 1; mutate(...args); } });
    const reset = () => {
      act(() => useStore.setState({ project: JSON.parse(JSON.stringify(original)), past: [], future: [], version: 0, dirty: false, sidebar: 'outline', sidebarOpen: true, view: 'write', activeId: 'a-action', focus: null }));
      mutations = 0;
    };
    reset();
    mounted = createRoot(document.getElementById('root'));
    act(() => mounted.render(React.createElement(Sidebar)));
    const card = (letter) => document.querySelector(`[data-outline-scene="${letter}-scene"]`);
    const handle = (letter) => card(letter).querySelector('.outline-item__drag');
    const transfer = () => {
      const values = new Map();
      return { effectAllowed: 'none', dropEffect: 'none', get types() { return Array.from(values.keys()); }, setData: (key, value) => values.set(key, value), getData: (key) => values.get(key) || '', setDragImage() {} };
    };
    const dispatch = (node, type, dataTransfer, clientY = 110) => {
      const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientY });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      act(() => node.dispatchEvent(event));
      return event;
    };
    const start = (letter) => {
      const data = transfer();
      dispatch(handle(letter), 'dragstart', data);
      return data;
    };
    const hover = (letter, edge, data) => {
      card(letter).getBoundingClientRect = () => ({ top: 100, height: 100, bottom: 200, left: 0, right: 250, width: 250 });
      dispatch(card(letter), 'dragover', data, edge === 'before' ? 110 : 190);
    };
    const drop = (letter, edge, data) => {
      hover(letter, edge, data);
      dispatch(card(letter), 'drop', data, edge === 'before' ? 110 : 190);
    };
    const orderedIds = (letters) => ['prefix', ...letters.flatMap((letter) => ['scene', 'action', 'character', 'dialogue'].map((kind) => `${letter}-${kind}`))];
    const ids = () => state().project.elements.map((element) => element.id);
    const keepAssociations = () => {
      for (const key of ['sceneMeta', 'beats', 'boardLinks', 'acts']) assert.deepEqual(state().project[key], original[key], `${key} 必须按 ID 保留`);
    };

    check('仅场号把手可拖；标题/摘要/整卡都不 draggable', () => {
      assert.equal(document.querySelectorAll('[draggable="true"]').length, 4);
      assert.equal(card('a').draggable, false);
      assert.equal(card('a').querySelector('input').draggable, false);
      assert.equal(card('a').querySelector('textarea').draggable, false);
      assert.equal(handle('a').tagName, 'BUTTON');
    });
    for (const [source, target, edge, expected] of [
      ['a', 'c', 'before', ['b', 'a', 'c', 'd']],
      ['a', 'c', 'after', ['b', 'c', 'a', 'd']],
      ['d', 'b', 'before', ['a', 'd', 'b', 'c']],
      ['d', 'b', 'after', ['a', 'b', 'd', 'c']],
      ['a', 'd', 'after', ['b', 'c', 'd', 'a']],
      ['d', 'a', 'before', ['d', 'a', 'b', 'c']],
    ]) {
      check(`${source} → ${target} ${edge} 整场移动，一次提交可撤销/重做`, () => {
        reset();
        const data = start(source);
        assert.ok(card(source).classList.contains('is-dragging'));
        hover(target, edge, data);
        assert.ok(card(target).classList.contains(`is-drop-${edge}`));
        drop(target, edge, data);
        assert.deepEqual(ids(), orderedIds(expected));
        assert.deepEqual(deriveScenes(state().project).map((scene) => scene.number), ['1', '2', '3', '4']);
        keepAssociations();
        assert.equal(mutations, 1);
        assert.equal(state().past.length, 1);
        assert.equal(document.querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after').length, 0);
        act(() => state().undo());
        assert.deepEqual(state().project, original);
        act(() => state().redo());
        assert.deepEqual(ids(), orderedIds(expected));
        keepAssociations();
      });
    }
    for (const [source, target, edge] of [['b', 'b', 'before'], ['b', 'b', 'after'], ['a', 'b', 'before'], ['c', 'b', 'after']]) {
      check(`${source} → ${target} ${edge} 原位不调用 mutate、不增历史`, () => {
        reset();
        const before = state();
        drop(target, edge, start(source));
        assert.equal(mutations, 0);
        for (const key of ['project', 'past', 'future', 'version', 'dirty']) assert.equal(state()[key], before[key]);
      });
    }
    check('取消拖拽清理高亮且不写历史', () => {
      reset();
      const data = start('a');
      hover('c', 'after', data);
      dispatch(handle('a'), 'dragend', data);
      assert.equal(mutations, 0);
      assert.equal(document.querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after').length, 0);
    });
    check('落在摘要文本框内仍接管排序，不污染文本', () => {
      reset();
      const data = start('d');
      hover('b', 'after', data);
      const event = dispatch(card('b').querySelector('textarea'), 'drop', data, 190);
      assert.equal(event.defaultPrevented, true);
      assert.deepEqual(ids(), orderedIds(['a', 'b', 'd', 'c']));
      keepAssociations();
      assert.equal(mutations, 1);
    });
    check('外部文本/伪造类型拖入不能触发排序', () => {
      reset();
      const data = transfer();
      data.setData('application/x-guangying-outline-scene', 'a-scene');
      assert.equal(dispatch(card('c'), 'dragover', data).defaultPrevented, false);
      dispatch(card('c'), 'drop', data);
      assert.equal(mutations, 0);
      assert.deepEqual(ids(), orderedIds(['a', 'b', 'c', 'd']));
    });
    check('拖拽中切换工程不能误排序新工程', () => {
      reset();
      const data = start('a');
      const other = JSON.parse(JSON.stringify(original));
      other.id = 'different-synthetic-project';
      act(() => useStore.setState({ project: other }));
      drop('c', 'after', data);
      assert.equal(mutations, 0);
      assert.deepEqual(ids(), orderedIds(['a', 'b', 'c', 'd']));
      dispatch(handle('a'), 'dragend', data);
    });
    check('标题/摘要仍可编辑，点击标题不抢回正文焦点', () => {
      reset();
      for (const [selector, ctor, value, key] of [['input', 'HTMLInputElement', '新合成标题', 'title'], ['textarea', 'HTMLTextAreaElement', '新合成摘要', 'synopsis']]) {
        const input = card('a').querySelector(selector);
        act(() => { input.focus(); input.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
        assert.equal(document.activeElement, input);
        assert.equal(state().focus, null);
        Object.getOwnPropertyDescriptor(dom.window[ctor].prototype, 'value').set.call(input, value);
        act(() => input.dispatchEvent(new dom.window.Event('input', { bubbles: true })));
        assert.equal(state().project.sceneMeta.find((meta) => meta.elementId === 'a-scene')[key], value);
      }
      assert.deepEqual(ids(), orderedIds(['a', 'b', 'c', 'd']));
    });
    check('场号键盘 Alt+上下键支持邻场移动且边界不写历史', () => {
      reset();
      const key = (letter, name) => act(() => handle(letter).dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, altKey: true, key: name })));
      key('a', 'ArrowUp');
      assert.equal(mutations, 0);
      key('a', 'ArrowDown');
      assert.deepEqual(ids(), orderedIds(['b', 'a', 'c', 'd']));
      key('a', 'ArrowUp');
      assert.deepEqual(ids(), orderedIds(['a', 'b', 'c', 'd']));
      assert.equal(mutations, 2);
    });
    assert.deepEqual(errors, [], 'React 挂载与交互不应有 console.error');
    console.log(`outline reorder: ${checks} rendered-event/store checks passed; browser drag geometry still requires manual validation`);
  } finally {
    if (mounted) act(() => mounted.unmount());
    console.error = originalError;
    dom.window.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
