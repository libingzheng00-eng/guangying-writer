/**
 * Shared synthetic BoardView harness. Bundles in memory and never reads .zhsp,
 * app userData, autosaves or user scripts. jsdom supplies event/state coverage,
 * not browser paint, actual pointer gestures, native IME or native confirmation.
 * Bounding boxes and isContentEditable below model browser APIs jsdom lacks.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');

async function makeBoardHarness(name) {
  const repo = path.resolve(__dirname, '..');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `http://${name}.invalid/`, pretendToBeVisual: true });
  const w = dom.window;
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'CompositionEvent', 'WheelEvent', 'DOMParser', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? w : w[key] });
  }
  Object.defineProperty(w.HTMLElement.prototype, 'isContentEditable', { configurable: true, get() { return !!this.closest('[contenteditable="true"], [contenteditable=""]'); } });
  Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return parseFloat(this.style.width) || (this.matches('[data-card]') ? 220 : 1200); } });
  Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return parseFloat(this.style.height) || (this.matches('[data-kind="scene"]') ? 150 : this.matches('[data-card]') ? 170 : 800); } });
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    const left = this.matches('.board__canvas') ? 0 : parseFloat(this.style.left) || 0;
    const top = this.matches('.board__canvas') ? 0 : parseFloat(this.style.top) || 0;
    const width = this.offsetWidth;
    const height = this.offsetHeight;
    return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON() { return this; } };
  };
  w.HTMLElement.prototype.scrollIntoView = () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = React;
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
  w.addEventListener('error', (event) => errors.push(event.message));
  const built = await esbuild.build({ stdin: { contents: "export { BoardView } from './src/components/BoardView'; export { useStore } from './src/store/store'; export { createProject } from './src/model/project';", resolveDir: repo, sourcefile: `${name}.entry.ts`, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const mod = new Module(path.join(__dirname, `${name}.bundle.cjs`), module);
  mod.filename = path.join(__dirname, `${name}.bundle.cjs`);
  mod.paths = Module._nodeModulePaths(__dirname);
  mod._compile(built.outputFiles[0].text, mod.filename);
  const { BoardView, useStore, createProject } = mod.exports;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const fixture = createProject('合成自由板工作区测试');
  fixture.elements = [
    { id: 's1', type: 'scene_heading', text: '内景 合成测试棚 日' }, { id: 'a1', type: 'action', text: '合成动作一。' },
    { id: 's2', type: 'scene_heading', text: '外景 合成测试园 夜' }, { id: 'a2', type: 'action', text: '合成动作二。' },
  ];
  fixture.sceneMeta = [
    { id: 'm1', elementId: 's1', title: '合成场景一', synopsis: '合成梗概一', color: '#ffffff', x: 20, y: 30 },
    { id: 'm2', elementId: 's2', title: '', synopsis: '', color: '#ffffff', x: 280, y: 30, w: 240, h: 180 },
  ];
  fixture.beats = [
    { id: 'b1', kind: 'beat', text: '合成灵感', color: '#ffffff', x: 550, y: 30, sceneId: 'm1', w: 220, h: 170 },
    { id: 'b2', kind: 'sound', text: '合成声音', title: '合成声音', color: '#ffffff', x: 820, y: 30, w: 220, h: 170 },
  ];
  fixture.boardLinks = [
    { id: 'l1', from: 'scene:s1', to: 'beat:b1', note: '合成跨板关系' },
    { id: 'l2', from: 'beat:b1', to: 'beat:b2', note: '合成灵感关系' },
    { id: 'l3', from: 'scene:s1', to: 'scene:s2', note: '合成场景关系' },
  ];
  const state = () => useStore.getState();
  const q = (selector) => document.querySelector(selector);
  const qa = (selector) => [...document.querySelectorAll(selector)];
  const card = (id) => q(`[data-card][data-id="${id}"]`);
  const hit = (id) => q(`.board-link__hit[data-link-id="${id}"]`);
  const label = (id) => hit(id)?.parentElement.querySelector('.board-link__label') || q(`.board-link__label[data-link-id="${id}"]`);
  const byName = (name, selector = 'button, [role="menuitem"]') => qa(selector).find((node) => node.getAttribute('aria-label') === name || node.textContent.trim() === name);
  const dispatch = async (target, event) => { assert.ok(target, 'event target exists'); await act(async () => { target.dispatchEvent(event); }); return event; };
  const mouse = (target, type, options = {}) => dispatch(target, new w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 50, clientY: 50, ...options }));
  const click = (target, options = {}) => mouse(target, 'click', options);
  const key = (target, value, modifiers = {}) => dispatch(target, new w.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...modifiers }));
  const press = async (target, modifiers = {}) => { await mouse(target, 'mousedown', modifiers); await mouse(w, 'mouseup', modifiers); await click(target, modifiers); };
  const pressCard = (id, modifiers = {}) => press(card(id)?.querySelector('.bcard__head') || card(id), modifiers);
  const input = async (target, value) => {
    assert.ok(target, 'input target exists');
    const proto = target.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : target.tagName === 'SELECT' ? w.HTMLSelectElement.prototype : w.HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(target, value);
      target.dispatchEvent(new w.Event(target.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    });
  };
  let root;
  let confirmations = [];
  let accepted = false;
  w.confirm = (message) => { confirmations.push(message); return accepted; };
  const mount = async (project = fixture) => {
    await act(async () => {
      if (root) root.unmount();
      state().loadProject(clone(project));
      useStore.setState({ view: 'board', past: [], future: [], selectedIds: [], focus: null });
      root = createRoot(q('#root'));
      root.render(React.createElement('div', { className: 'app-shell', 'data-theme': 'day' }, React.createElement(BoardView)));
    });
    confirmations = [];
    accepted = false;
  };
  const history = () => [state().past.length, state().future.length, state().dirty, state().version];
  const selectedLink = () => q('.board--workspace')?.getAttribute('data-selected-link') || '';
  const openViewSettings = async () => {
    const summary = q('.board__dropdown summary[aria-label="视图设置"]');
    assert.ok(summary, 'view settings summary is reachable');
    const details = summary.closest('details');
    assert.ok(details, 'view settings uses its native disclosure container');
    if (!details.open) await click(summary);
    assert.equal(details.open, true, 'view settings opens before controls are used');
    return details;
  };
  const menuDelete = async (id) => {
    await mouse(card(id), 'contextmenu', { button: 2 });
    const action = byName(id.startsWith('s') ? '删除整场' : '删除卡片');
    assert.ok(action, 'right-click delete action has a clear accessible name');
    return action;
  };
  return { repo, dom, w, React, act, useStore, state, fixture, clone, q, qa, card, hit, label, byName, dispatch, mouse, click, key, press, pressCard, input, mount, history, selectedLink, openViewSettings, menuDelete, errors,
    confirmations: () => confirmations,
    accept: (value) => { accepted = value; },
    async close() { if (root) await act(async () => root.unmount()); console.error = originalError; dom.window.close(); },
  };
}

module.exports = { makeBoardHarness };
