/** Real App/StartupPage/store against synthetic memory storage and native ports.
 * No personal files, Electron app, or browser profile is opened. jsdom does not
 * implement native Tab/default button activation, geometry, or OS dialogs.
 */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://startup-ui-test.invalid/', pretendToBeVisual: true });
const w = dom.window;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'NodeFilter', 'Element', 'Event', 'InputEvent', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'CompositionEvent', 'DOMParser', 'Range', 'Selection', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? w : w[key] });
}
w.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const KEY = 'guangying:autosave', LEGACY = 'mojiang:autosave', PROTECTED = 'guangying:autosave:unreadable', PREF = 'guangying:startup-preference';
const errors = [], originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
w.addEventListener('error', event => errors.push(event.message));
let root, checks = 0, menuAction;
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); };
const q = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const button = text => all('.startup button').find(node => node.textContent.trim().includes(text));
const accessible = label => all('button').find(node => node.getAttribute('aria-label') === label);
const click = async node => { assert.ok(node, 'expected live button'); await act(async () => node.click()); };
const key = async (node, value, extra = {}) => {
  const event = new w.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra });
  await act(async () => node.dispatchEvent(event)); return event;
};
const input = async (node, value) => {
  assert.ok(node, 'expected input');
  await act(async () => {
    node.focus(); Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
};
const wait = ms => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const unload = async () => {
  const event = new w.Event('beforeunload', { cancelable: true });
  await act(async () => w.dispatchEvent(event)); return event;
};
const native = action => act(async () => menuAction(action));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, writes: [], failKey: null,
    getItem: name => values.get(name) ?? null,
    setItem(name, value) { if (this.failKey === name) throw Object.assign(new Error('synthetic quota'), { name: 'QuotaExceededError' }); this.writes.push([name, String(value)]); values.set(name, String(value)); },
    removeItem: name => values.delete(name), clear: () => values.clear(),
  };
}

(async () => {
  const built = await require('esbuild').build({ stdin: { contents: `export {default as App} from './src/App';
    export {useStore} from './src/store/store'; export {createProject} from './src/model/project';
    export {serializeProject} from './src/io/zhsp'; export {useRecoveryStatus} from './src/app/recoveryStatus';`, resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', loader: { '.png': 'dataurl', '.css': 'empty' } });
  const filename = path.join(repo, '.startup-ui-memory.cjs');
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(repo);
  mod._compile(built.outputFiles[0].text, filename);
  const { App, useStore, createProject, serializeProject, useRecoveryStatus } = mod.exports;
  const state = () => useStore.getState();
  const fixture = name => {
    const project = createProject(name); project.titlePage.show = false;
    project.elements = [{ id: 'startup-scene', type: 'scene_heading', text: '内景 合成启动页场景 日' },
      { id: 'startup-action', type: 'action', text: '合成正文保持完整，不属于用户资料。' }];
    project.beats = [{ id: 'startup-card', kind: 'beat', title: '合成卡片标题', text: '合成备注', x: 20, y: 30, color: '#fff' }];
    return project;
  };
  const recovered = fixture('合成恢复稿');
  const raw = JSON.stringify({ project: recovered, filePath: '/synthetic/恢复稿.zhsp' });
  const snapshot = () => ({ project: state().project, epoch: state().documentEpoch, past: state().past, future: state().future, dirty: state().dirty, version: state().version, filePath: state().filePath });
  async function unmount() {
    if (root) await act(async () => root.unmount()); root = null;
  }
  async function mount(storage, options = {}) {
    await unmount();
    Object.defineProperty(w, 'localStorage', { configurable: true, value: storage });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    let records = options.recents || [], confirmResult = true;
    const calls = { open: 0, recent: [], relocate: [], commit: [], pin: [], remove: [], confirm: [] };
    const port = {
      isElectron: false, onMenu(callback) { menuAction = callback; return () => { menuAction = null; }; },
      getRecent: async () => records.map(item => ({ ...item })),
      openProject: async () => { calls.open++; return options.open ? options.open() : null; },
      openRecent: async id => { calls.recent.push(id); return options.openRecent ? options.openRecent(id) : null; },
      relocateRecent: async id => { calls.relocate.push(id); return options.relocate ? options.relocate(id) : null; },
      commitOpen: async (...args) => { calls.commit.push(args); return true; },
      pinRecent: async (id, pinned) => { calls.pin.push([id, pinned]); if (options.failMutation) throw new Error('synthetic mutation failure'); records = records.map(item => item.id === id ? { ...item, pinned } : item); return records; },
      removeRecent: async id => { calls.remove.push(id); if (options.failMutation) throw new Error('synthetic mutation failure'); records = records.filter(item => item.id !== id); return records; },
      saveProject: async () => null, saveProjectAs: async () => null, exportPdf: async () => null,
      getInfo: async () => ({ version: 'synthetic', platform: 'web' }), showInFolder() {},
    };
    w.api = port;
    w.confirm = message => { calls.confirm.push(message); return confirmResult; };
    await act(async () => {
      useStore.setState({ toast: null });
      useRecoveryStatus.setState({ phase: 'pending', error: null, lastSuccess: null });
      root = createRoot(document.getElementById('root'));
      root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    });
    await settle();
    return { calls, port, setConfirm: value => { confirmResult = value; } };
  }

  const empty = memory();
  await mount(empty);
  check('first launch presents an accessible landing page and focuses its heading', [!!q('.startup'), document.activeElement?.tagName, document.activeElement?.textContent], [true, 'H1', '光影写手']);
  check('no record or recovery invents a continue action', [!!button('继续写作'), q('.startup__empty h3')?.textContent, state().dirty], [false, '还没有最近项目', false]);
  await wait(1000);
  check('StrictMode blank landing does not create a recovery point', empty.writes, []);
  check('closing blank landing has no editing guard', (await unload()).defaultPrevented, false);
  await unmount();
  check('landing close and unmount remain storage read-only', empty.writes, []);

  const saved = memory({ [KEY]: raw });
  await mount(saved);
  check('recovery stays on default home and shows its project name', [!!q('.startup'), q('.startup__continue p')?.textContent], [true, '继续上次写作 · 合成恢复稿']);
  check('read recovery keeps exact project/path and conservatively dirty without fake history', [state().project.elements, state().filePath, state().dirty, state().past.length, state().future.length], [recovered.elements, '/synthetic/恢复稿.zhsp', true, 0, 0]);
  const waitingSnapshot = snapshot();
  await wait(1000); await unload();
  check('valid recovery raw survives idle and close without writes', [saved.values.get(KEY), saved.writes], [raw, []]);
  check('home close does not mutate the waiting project/history', snapshot(), waitingSnapshot);
  await click(button('继续写作'));
  check('explicit continue enters editing without replacing recovered project', [!!q('.startup'), state().project === waitingSnapshot.project, state().documentEpoch, state().dirty], [false, true, waitingSnapshot.epoch, true]);
  check('activated recovered document protects close', (await unload()).defaultPrevented);
  await act(async () => state().setText('startup-action', '明确继续后的合成输入'));
  const active = snapshot();
  await native('file:home');
  check('native home retains the active project and offers current writing', [!!q('.startup'), q('.startup__continue p')?.textContent, snapshot()], [true, '继续当前写作 · 合成恢复稿', active]);
  await wait(1000);
  check('returning home after editing keeps pending autosave active', JSON.parse(saved.values.get(KEY)).project.elements[1].text, '明确继续后的合成输入');
  await click(button('继续写作'));
  check('returning from home preserves current history, dirty and epoch', snapshot(), active);

  // Use a real BoardView draft; no fabricated pending marker hides lifecycle bugs.
  await act(async () => state().setView('board'));
  await act(async () => q('[data-id="startup-card"] span.bcard__media-title').dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true })));
  const titleDraft = q('[data-id="startup-card"] input.bcard__media-title');
  await input(titleDraft, '尚未确认的合成标题');
  await native('file:home');
  check('pending card draft refuses home without dropping local text', [!!q('.startup'), q('[data-id="startup-card"] input.bcard__media-title')?.value, state().project.beats[0].title], [false, '尚未确认的合成标题', '合成卡片标题']);
  check('refused home restores focus to the actual draft', document.activeElement === titleDraft);
  await key(titleDraft, 'Escape');
  await native('file:home');
  check('cancelling the local draft allows returning home', !!q('.startup'));

  for (const damaged of ['{synthetic invalid json', JSON.stringify({ project: { ...recovered, elements: 'invalid' }, filePath: null })]) {
    const storage = memory({ [KEY]: damaged, [PROTECTED]: '合成另一份既有保护' });
    await mount(storage);
    await wait(1000); const close = await unload(); await unmount();
    check('invalid recovery remains untouched through StrictMode idle/close/unmount', [storage.values.get(KEY), storage.values.get(PROTECTED), storage.writes, close.defaultPrevented], [damaged, '合成另一份既有保护', [], false]);
  }

  const fresh = memory();
  const first = await mount(fresh);
  await click(button('新建剧本'));
  check('explicit first new opens a genuinely blank document without confirmation', [!!q('.startup'), state().project.elements.every(item => item.text === ''), state().filePath, first.calls.confirm.length], [false, true, null, 0]);
  await wait(1000);
  check('explicit new activates recovery for its own blank project', JSON.parse(fresh.values.get(KEY)).project.id, state().project.id);

  const pref = memory({ [KEY]: raw, [PREF]: 'resume' });
  await mount(pref);
  check('saved resume preference immediately activates available recovery', [!!q('.startup'), state().project.name, state().dirty], [false, '合成恢复稿', true]);
  check('resume preference does not clear close protection', (await unload()).defaultPrevented);
  const missingResume = memory({ [PREF]: 'resume' });
  await mount(missingResume);
  check('resume without recovery or recent project falls back to empty home', [!!q('.startup'), !!button('继续写作'), missingResume.values.has(KEY)], [true, false, false]);

  const prefStorage = memory();
  await mount(prefStorage);
  prefStorage.failKey = PREF;
  await click(q('input[value="resume"]'));
  check('preference persistence failure is visible and does not pretend it changed', [q('input[value="home"]').checked, prefStorage.values.has(PREF), q('[role="alert"]')?.textContent.includes('启动偏好未能保存')], [true, false, true]);
  prefStorage.failKey = null;
  await click(q('input[value="resume"]'));
  check('preference can be retried and saved without creating recovery', [prefStorage.values.get(PREF), q('input[value="resume"]').checked, prefStorage.values.has(KEY)], ['resume', true, false]);

  const recents = [
    { id: 'old-pinned', name: '合成置顶稿', path: '/synthetic/Pinned.zhsp', updatedAt: 1000, pinned: true },
    { id: 'latest', name: '合成新稿', path: '/synthetic/Recent.zhsp', updatedAt: 3000, pinned: false },
    { id: 'moved', name: '合成移动稿', path: '/synthetic/Moved.zhsp', updatedAt: 2000, pinned: false, missing: true },
  ];
  const listStorage = memory({ [KEY]: raw });
  const list = await mount(listStorage, { recents });
  check('recent list exposes name, exact path and machine-readable time', [all('.startup__project strong').map(item => item.textContent), all('.startup__path').map(item => item.textContent), all('.startup__project time').every(item => !!item.dateTime)], [['合成置顶稿', '合成新稿', '合成移动稿'], ['/synthetic/Pinned.zhsp', '/synthetic/Recent.zhsp', '/synthetic/Moved.zhsp'], true]);
  const listSnapshot = snapshot();
  const search = q('input[type="search"]');
  await input(search, 'RECENT.ZHSP');
  check('keyboard-editable search matches case-insensitive paths', all('.startup__project strong').map(item => item.textContent), ['合成新稿']);
  const undoSearch = await key(search, 'z', { ctrlKey: true });
  check('search native undo is not stolen by project history', [undoSearch.defaultPrevented, snapshot()], [false, listSnapshot]);
  await input(search, '无匹配合成字');
  check('search no-results state is explicit', q('.startup__empty h3')?.textContent, '没有找到匹配的项目');
  await click(accessible('清除搜索'));
  check('clear restores list and keyboard focus to search', [search.value, document.activeElement === search, all('.startup__project').length], ['', true, 3]);
  const pin = accessible('置顶：合成新稿');
  await act(async () => pin.focus());
  check('pin is an enabled native keyboard-operable button', [pin.tagName, pin.tabIndex, pin.disabled, document.activeElement === pin], ['BUTTON', 0, false, true]);
  await click(pin); // jsdom lacks native Enter -> click; exercise its native button action.
  check('pin routes only record identity and updates visual/ARIA state', [list.calls.pin, accessible('取消置顶：合成新稿')?.getAttribute('aria-pressed'), all('.startup__project strong')[0].textContent], [[['latest', true]], 'true', '合成新稿']);
  await click(accessible('取消置顶：合成新稿'));
  check('unpin restores chronological order below pinned records', [list.calls.pin.at(-1), all('.startup__project strong')[0].textContent], [['latest', false], '合成置顶稿']);
  await click(accessible('重新定位项目：合成移动稿'));
  check('missing record routes to relocate, never arbitrary-path open', [list.calls.relocate, list.calls.recent, list.calls.commit], [['moved'], [], []]);
  const nextButton = accessible('打开项目：合成新稿');
  const remove = accessible('仅移除记录：合成置顶稿，不会删除工程文件');
  await act(async () => remove.focus()); await click(remove);
  check('remove affects only metadata and hands keyboard focus to next surviving project', [list.calls.remove, all('.startup__project strong').map(item => item.textContent), document.activeElement === nextButton, list.calls.open, list.calls.commit], [['old-pinned'], ['合成新稿', '合成移动稿'], true, 0, []]);
  await click(accessible('仅移除记录：合成新稿，不会删除工程文件'));
  await click(accessible('仅移除记录：合成移动稿，不会删除工程文件'));
  check('removing final record returns focus to search with explicit empty list', [document.activeElement === search, q('.startup__empty h3')?.textContent], [true, '还没有最近项目']);
  check('all list and search operations preserve project/history and recovery raw', [snapshot(), listStorage.values.get(KEY)], [listSnapshot, raw]);

  const failedList = await mount(memory({ [KEY]: raw }), { recents, failMutation: true });
  await click(accessible('仅移除记录：合成新稿，不会删除工程文件'));
  check('failed removal retains records and reports metadata-only failure', [all('.startup__project').length, failedList.calls.remove, q('[role="alert"]')?.textContent.includes('工程文件没有被删除或修改')], [3, ['latest'], true]);

  const target = fixture('合成打开目标');
  const chosen = { path: '/synthetic/目标.zhsp', content: serializeProject(target), openToken: 'synthetic-open-token' };
  for (const mode of ['dialog-cancel', 'invalid', 'discard-cancel']) {
    const storage = memory({ [KEY]: raw });
    const opened = await mount(storage, { recents, open: async () => mode === 'dialog-cancel' ? null : mode === 'invalid' ? { ...chosen, content: '{invalid' } : chosen });
    opened.setConfirm(false);
    const before = snapshot();
    await click(button('打开工程'));
    check(`${mode}: failed/cancelled open keeps waiting project and exact raw`, [!!q('.startup'), snapshot(), storage.values.get(KEY), opened.calls.commit], [true, before, raw, []]);
    check(`${mode}: invalid input is rejected before discard confirmation`, opened.calls.confirm.length, mode === 'discard-cancel' ? 1 : 0);
    check(`${mode}: existing recent rows survive`, all('.startup__project').length, 3);
  }
  const successful = await mount(memory({ [KEY]: raw }), { open: async () => chosen });
  await click(button('打开工程'));
  check('valid confirmed open activates target and commits recent token only after acceptance', [!!q('.startup'), state().project.id, state().filePath, successful.calls.confirm.length, successful.calls.commit], [false, target.id, chosen.path, 1, [[chosen.openToken, target.name]]]);

  const pending = deferred();
  const racing = await mount(memory(), { open: () => pending.promise });
  await native('file:open'); await native('file:open'); await native('file:new');
  check('first pending open wins; repeated open/new cannot replace or spawn a second chooser', [racing.calls.open, !!q('.startup'), state().project.name, button('新建剧本').disabled], [1, true, '未命名剧本', true]);
  await act(async () => pending.resolve(chosen)); await settle();
  check('first accepted asynchronous result activates exactly its target', [state().project.id, racing.calls.commit.length, !!q('.startup')], [target.id, 1, false]);

  const automatic = await mount(memory({ [PREF]: 'resume' }), { recents, openRecent: async () => chosen });
  check('resume without a draft selects the newest valid record, not older pin order', [automatic.calls.recent, automatic.calls.open, state().project.id, !!q('.startup')], [['latest'], 0, target.id, false]);
  const unavailable = await mount(memory({ [PREF]: 'resume' }), { recents: [{ ...recents[2], updatedAt: 9000 }] });
  check('resume of missing file stays home without opening a chooser or mutating records', [!!q('.startup'), unavailable.calls.open, unavailable.calls.recent, unavailable.calls.relocate, !!q('[role="alert"]')], [true, 0, [], [], true]);
  check('no React or window runtime errors', errors, []);
  console.log(`Startup UI: ${checks} checks passed (real App/StrictMode, synthetic memory/native ports; no browser keyboard defaults or native OS acceptance).`);
})().catch(error => { originalError(error?.stack || error); process.exitCode = 1; }).finally(async () => {
  if (root) await act(async () => root.unmount());
  console.error = originalError; dom.window.close();
});
