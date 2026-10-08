'use strict';

// Real Toolbar/store in jsdom plus real main.js in an Electron VM mock.
// Synthetic state only; no native window, userData or file dialog is accessed.
// jsdom cannot perform browser Tab defaults, CSS hit-testing or native menus.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><input id="outside" aria-label="合成外部输入"><button id="stop">合成外部按钮</button></body></html>', { url: 'http://menu-ui-test.invalid/', pretendToBeVisual: true });
const w = dom.window;
for (const key of ['window', 'document', 'navigator', 'self', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'DOMParser', 'Range', 'Selection', 'MutationObserver', 'localStorage', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' || key === 'self' ? w : w[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
w.addEventListener('error', event => errors.push(event.message));
let root;
let checks = 0;
const nodeIds = new WeakMap();
let nodeSerial = 0;
const comparable = value => {
  if (value instanceof w.Node) {
    if (!nodeIds.has(value)) nodeIds.set(value, ++nodeSerial);
    // Compare DOM identity without letting a failed assertion print React's
    // attached fiber/event graphs. Different nodes must never compare equal.
    return { domNode: nodeIds.get(value), name: value.nodeName };
  }
  return Array.isArray(value) ? value.map(comparable) : value;
};
const check = (label, actual, expected = true) => { assert.deepEqual(comparable(actual), comparable(expected), label); checks++; console.log(`  ✓ ${label}`); };
const repo = path.resolve(__dirname, '..');

function nativeMenus(platform) {
  const state = { windows: [], sent: [], menus: [] };
  class Window {
    constructor() {
      this.webContents = { on() {}, send: (...args) => state.sent.push(args) };
      state.windows.push(this);
    }
    once() {} on() {} loadFile() {} isDestroyed() { return false; }
    static getAllWindows() { return state.windows; }
  }
  const electron = {
    app: { whenReady: () => ({ then: callback => callback() }), requestSingleInstanceLock: () => true, on() {}, quit() {}, getPath() { throw new Error('No userData access permitted'); } },
    BrowserWindow: Window,
    Menu: { buildFromTemplate: template => template, setApplicationMenu: menu => state.menus.push(menu) },
    dialog: {}, ipcMain: { handle() {} }, shell: {},
  };
  const mainFile = path.join(repo, 'electron/main.js');
  vm.runInNewContext(fs.readFileSync(mainFile, 'utf8'), {
    __dirname: path.dirname(mainFile), process: { env: {}, platform, on() {} }, console,
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'node:path') return platform === 'win32' ? path.win32 : path.posix;
      if (name === 'node:fs') return new Proxy({}, { get() { throw new Error('No filesystem access permitted by main mock'); } });
      if (name === './pdf') return { renderPdf() { throw new Error('No PDF export permitted'); } };
      if (name === './projectSave') return { saveProjectFile() { throw new Error('No project save permitted'); } };
      if (name === './platform') return require('../electron/platform');
      throw new Error(`Unexpected main dependency: ${name}`);
    },
  }, { filename: mainFile });
  return state;
}

(async () => {
  const built = await esbuild.build({
    stdin: { contents: `export { Toolbar } from './src/components/Toolbar'; export { useStore } from './src/store/store'; export { createProject } from './src/model/project';`, resolveDir: repo, sourcefile: 'menu-ui.entry.ts', loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
  });
  const testModule = new Module(path.join(__dirname, 'menu-ui-test.bundle.cjs'), module);
  testModule.filename = path.join(__dirname, 'menu-ui-test.bundle.cjs');
  testModule.paths = Module._nodeModulePaths(__dirname);
  testModule._compile(built.outputFiles[0].text, testModule.filename);
  const { Toolbar, useStore, createProject } = testModule.exports;
  const project = createProject('合成菜单测试');
  useStore.setState({ project, activeId: project.elements[0]?.id || null, view: 'write' });
  const beforeProject = JSON.stringify(useStore.getState().project);
  const beforeHistory = [useStore.getState().past, useStore.getState().future, useStore.getState().dirty, useStore.getState().version];
  const calls = [];
  const commands = {};
  for (const name of ['newFile', 'open', 'save', 'importAny', 'exportPdf', 'exportAs', 'setElementType', 'insertScene', 'makeDual']) {
    commands[name] = (...args) => { calls.push([name, ...args]); };
  }
  // Match the real no-argument command; React may pass its click event to it.
  commands.openFind = () => { calls.push(['openFind']); document.getElementById('outside').focus(); };
  let modalOpen = false;
  let openerAtTitle;
  const q = selector => document.querySelector(selector);
  const trigger = () => q('button[aria-haspopup="menu"]');
  const menu = () => q('[role="menu"]');
  const items = () => [...document.querySelectorAll('[role="menuitem"]')];
  const button = label => [...document.querySelectorAll('.toolbar button')].find(node => node.textContent.trim() === label);
  const render = async () => act(async () => root.render(React.createElement(Toolbar, {
    commands, modalOpen,
    onOpenSettings: () => { calls.push(['settings']); document.getElementById('outside').focus(); },
    onOpenTitle: () => { calls.push(['title']); openerAtTitle = document.activeElement; document.getElementById('outside').focus(); },
  })));
  root = createRoot(document.getElementById('root'));
  await render();
  const dispatch = async (target, event) => act(async () => target.dispatchEvent(event));
  const click = async target => dispatch(target, new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const key = async (target, name, extra = {}) => {
    const event = new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra });
    await dispatch(target, event); return event;
  };
  const open = async () => { await click(trigger()); assert.ok(menu(), 'menu opened'); };
  const focus = async target => act(async () => target.focus());

  check('文件菜单初始关闭', [menu(), trigger().getAttribute('aria-expanded')], [null, 'false']);
  await open();
  check('菜单有可关联的语义和11个保留的操作', [trigger().getAttribute('aria-controls'), menu().id, menu().getAttribute('aria-label'), items().length], [menu().id, menu().id, '文件', 11]);
  check('鼠标打开聚焦首项且菜单项不加入普通Tab序列', [document.activeElement, items().every(item => item.tabIndex === -1)], [items()[0], true]);
  await key(document.activeElement, 'ArrowUp');
  check('向上从首项循环至最后一项', document.activeElement, items().at(-1));
  await key(document.activeElement, 'ArrowDown');
  check('向下从末项循环至首项', document.activeElement, items()[0]);
  await key(document.activeElement, 'End');
  check('End跳末项并跳过分隔线', document.activeElement, items().at(-1));
  await key(document.activeElement, 'Home');
  check('Home跳首项', document.activeElement, items()[0]);
  await focus(trigger());
  await key(trigger(), 'ArrowUp');
  check('菜单已打开时从触发器向上也进入末项', document.activeElement, items().at(-1));
  const leakedKeys = [];
  const underlyingKeys = event => leakedKeys.push(event.key);
  w.addEventListener('keydown', underlyingKeys);
  for (const name of ['Delete', 'Backspace', 'l', ' ', 'Enter']) {
    const isolated = await key(document.activeElement, name);
    check(`${name}不取消按钮默认行为`, isolated.defaultPrevented, false);
  }
  await key(document.activeElement, 'Escape', { isComposing: true });
  w.removeEventListener('keydown', underlyingKeys);
  check('菜单普通键与IME键不冒泡触发底层画布操作', leakedKeys, []);
  let escapedToWindow = 0;
  const escaped = event => { if (event.key === 'Escape') escapedToWindow++; };
  w.addEventListener('keydown', escaped);
  const escape = await key(document.activeElement, 'Escape');
  check('Esc关闭并恢复文件按钮且不传到底层', [menu(), document.activeElement, escape.defaultPrevented, escapedToWindow], [null, trigger(), true, 0]);
  w.removeEventListener('keydown', escaped);

  await key(trigger(), 'ArrowUp');
  check('触发器ArrowUp打开并聚焦末项', document.activeElement, items().at(-1));
  await click(trigger());
  check('再次点文件关闭且焦点在触发器', [menu(), document.activeElement], [null, trigger()]);
  await key(trigger(), 'ArrowDown');
  check('触发器ArrowDown打开首项', document.activeElement, items()[0]);
  for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
    const composing = await key(document.activeElement, 'Escape', extra);
    check('组合输入Escape不误关闭菜单', [!!menu(), composing.defaultPrevented], [true, false]);
  }
  const downWithModifier = await key(document.activeElement, 'ArrowDown', { ctrlKey: true });
  check('修饰方向键不被菜单接管', downWithModifier.defaultPrevented, false);
  const tab = await key(document.activeElement, 'Tab');
  check('Tab关闭并交还原生导航：不取消默认，起点回文件按钮', [menu(), tab.defaultPrevented, document.activeElement], [null, false, trigger()]);
  await open();
  const backTab = await key(document.activeElement, 'Tab', { shiftKey: true });
  check('ShiftTab也离开菜单而不圈焦点', [menu(), backTab.defaultPrevented, document.activeElement], [null, false, trigger()]);

  for (const name of ['Enter', ' ']) {
    await focus(trigger());
    const nativeActivation = await key(trigger(), name);
    check(`${name === ' ' ? 'Space' : name}保留按钮原生激活且不在keydown重复打开`, [menu(), nativeActivation.defaultPrevented], [null, false]);
    await click(trigger()); // jsdom does not synthesize the browser's button click.
    check('一次原生激活click打开菜单', !!menu());
    await key(document.activeElement, 'Escape');
  }
  const triggerKeys = [];
  const triggerLeaks = event => triggerKeys.push(event.key);
  w.addEventListener('keydown', triggerLeaks);
  for (const name of ['Enter', ' ', 'Delete', 'Backspace', 'l', 'Escape']) {
    await focus(trigger());
    const isolated = await key(trigger(), name);
    check(`关闭菜单的文件按钮${name}保留默认行为`, isolated.defaultPrevented, false);
  }
  w.removeEventListener('keydown', triggerLeaks);
  check('关闭菜单的文件按钮普通键也不触发底层自由板命令', triggerKeys, []);

  await open();
  await click(button('设置'));
  check('同工具栏设置关闭旧文件菜单并保留新目标焦点', [menu(), calls.at(-1), document.activeElement.id], [null, ['settings'], 'outside']);
  await open();
  await click(button('查找'));
  check('查找关闭菜单且允许查找接管焦点', [menu(), calls.at(-1), document.activeElement.id], [null, ['openFind'], 'outside']);
  await open();
  await click(button('自由板'));
  check('点击视图切换关闭菜单', [menu(), useStore.getState().view], [null, 'board']);
  await open();
  await act(async () => useStore.getState().setView('reports'));
  check('原生等外部视图切换关闭菜单且不丢失焦点', [menu(), document.activeElement], [null, trigger()]);
  await open();
  await act(async () => {
    const select = q('select[aria-label="工作视图"]');
    select.value = 'cards'; select.dispatchEvent(new w.Event('change', { bubbles: true }));
  });
  check('窄屏视图选择器切页同样关闭菜单', [menu(), useStore.getState().view], [null, 'cards']);
  await open();
  await click(q('.doc-title'));
  check('文档标题入口也关闭文件菜单', [menu(), calls.at(-1), document.activeElement.id], [null, ['title'], 'outside']);

  await open();
  const stop = document.getElementById('stop');
  stop.addEventListener('mousedown', event => event.stopPropagation());
  const outsideDown = new w.MouseEvent('mousedown', { bubbles: true, cancelable: true });
  await dispatch(stop, outsideDown);
  await focus(stop);
  check('外点即使停止冒泡仍关闭且不取消默认或抢焦点', [menu(), outsideDown.defaultPrevented, document.activeElement], [null, false, stop]);
  await open();
  await focus(document.getElementById('outside'));
  check('仅焦点离开也关闭菜单，不恢复文件焦点', [menu(), document.activeElement.id], [null, 'outside']);
  await open();
  await dispatch(w, new w.Event('blur'));
  check('应用窗口失焦关闭菜单', menu(), null);

  await open();
  const beforeCalls = calls.length;
  await click(items().find(item => item.textContent === '另存为…'));
  check('菜单操作执行一次，保留原参数和稳定返回焦点', [menu(), calls.slice(beforeCalls), document.activeElement], [null, [['save', true]], trigger()]);
  await open();
  await click(items().at(-1));
  check('标题页执行前建立稳定返回按钮，执行后不夺回新焦点', [menu(), calls.at(-1), openerAtTitle, document.activeElement.id], [null, ['title'], trigger(), 'outside']);

  await open();
  modalOpen = true;
  await render();
  await focus(document.getElementById('outside'));
  check('模态开启立即卸载菜单且文件按钮禁用', [menu(), trigger().disabled, trigger().getAttribute('aria-expanded')], [null, true, 'false']);
  await click(trigger());
  await key(trigger(), 'ArrowDown');
  check('模态期间菜单不能重开或夺焦点', [menu(), document.activeElement.id], [null, 'outside']);
  modalOpen = false;
  await render();
  check('模态关闭不会复活旧文件菜单', [menu(), trigger().disabled], [null, false]);
  const outsideEscape = await key(document.getElementById('outside'), 'Escape');
  check('菜单关闭时不接管外部键盘', outsideEscape.defaultPrevented, false);

  const viewButtons = [...document.querySelectorAll('.toolbar__views button')].map(item => item.textContent);
  check('保留五种页内视图入口', viewButtons, ['写作', '故事板', '自由板', '预览', '统计']);
  for (const platform of ['win32', 'darwin']) {
    const native = nativeMenus(platform);
    const entries = native.menus[0].find(item => item.label === '视图').submenu;
    const routes = entries.filter(item => ['写作', '故事板卡片', '自由板', '分页预览', '统计报表'].includes(item.label));
    check(`${platform}原生菜单保留五视图且原1–4快捷键不变`, JSON.parse(JSON.stringify(routes.map(item => [item.label, item.accelerator || null]))), [
      ['写作', 'CmdOrCtrl+Alt+1'], ['故事板卡片', 'CmdOrCtrl+Alt+2'], ['自由板', null], ['分页预览', 'CmdOrCtrl+Alt+3'], ['统计报表', 'CmdOrCtrl+Alt+4'],
    ]);
    routes.forEach(item => item.click());
    check(`${platform}实际main菜单回调发出全部既有renderer视图动作`, native.sent, ['write', 'cards', 'board', 'preview', 'reports'].map(view => ['menu:action', `view:${view}`]));
  }
  check('菜单导航不改合成工程', JSON.stringify(useStore.getState().project), beforeProject);
  check('菜单导航不产生历史或dirty/version', [useStore.getState().past, useStore.getState().future, useStore.getState().dirty, useStore.getState().version], beforeHistory);
  await open();
  await act(async () => useStore.getState().newProject());
  check('原生新建等同页工程替换关闭菜单并恢复存活触发器', [menu(), document.activeElement], [null, trigger()]);
  await open();
  const reopened = JSON.parse(JSON.stringify(useStore.getState().project));
  await act(async () => useStore.getState().loadProject(reopened));
  check('同ID重开工程也关闭旧菜单且不污染新工程历史', [menu(), document.activeElement, useStore.getState().past.length, useStore.getState().dirty], [null, trigger(), 0, false]);
  check('无React或窗口运行错误', errors, []);
  console.log(`\n=== menu-ui ${checks}/${checks} PASS (jsdom + main VM; no native focus/paint validation) ===`);
})().catch(error => { originalError(error?.stack || error); process.exitCode = 1; }).finally(async () => {
  if (root) await act(async () => root.unmount());
  console.error = originalError;
  dom.window.close();
});
