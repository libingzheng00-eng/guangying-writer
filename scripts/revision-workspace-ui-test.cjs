/** Actual App/workspace/store/context, synthetic content and memory-only storage.
 * jsdom checks event routing and state; it cannot prove OS undo, inert hit-testing,
 * layout, native clipboard/IME or PDF behavior.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://revision-ui-test.invalid/', pretendToBeVisual: true });
const w = dom.window, originals = new Map();
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Node', 'NodeFilter', 'Element', 'Event', 'InputEvent', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'CompositionEvent', 'DOMParser', 'Range', 'getComputedStyle', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? w : w[key] });
}
originals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.HTMLElement.prototype.scrollIntoView = () => {};
let menuAction, root, checks = 0;
const nativeCalls = [], fileCalls = [], errors = [];
w.api = {
  isElectron: false,
  onMenu(callback) { menuAction = callback; return () => { menuAction = null; }; },
  async openProject() { fileCalls.push('open'); return null; },
  async saveProject() { fileCalls.push('save'); return null; },
  async saveProjectAs() { fileCalls.push('saveAs'); return null; },
  async exportPdf() { fileCalls.push('pdf'); return null; },
};
document.execCommand = command => { nativeCalls.push(command); return true; };
const React = require('react'), { act } = React;
const { createRoot } = require('react-dom/client');
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
w.addEventListener('error', event => errors.push(event.message));
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); };

(async () => {
  const built = await require('esbuild').build({
    stdin: { contents: `export {default as App} from './src/App'; export {useStore} from './src/store/store';
      export {createProject} from './src/model/project'; export {captureReviewContext} from './src/app/reviewContext';
      export {makeTextRange, offsetOf} from './src/utils/dom'; export {ownsNativeHistory} from './src/utils/editHistory';`, resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    loader: { '.css': 'empty', '.png': 'dataurl' }, logLevel: 'silent',
  });
  const filename = path.join(repo, '.revision-workspace-ui-memory.cjs');
  const bundle = new Module(filename, module);
  bundle.filename = filename; bundle.paths = Module._nodeModulePaths(repo);
  bundle._compile(built.outputFiles[0].text, filename);
  const { App, useStore, createProject, captureReviewContext, makeTextRange, offsetOf, ownsNativeHistory } = bundle.exports;
  const state = () => useStore.getState(), q = selector => document.querySelector(selector);
  const modal = () => q('.revision-workspace[aria-modal="true"]');
  const writing = id => q(`.script-flow .sc-el--editable[data-id="${id}"]`);
  const field = label => q(`[aria-label="${label}"]`);
  const button = (text, scope = modal()) => {
    const node = [...scope.querySelectorAll('button')].find(item => item.textContent.trim() === text);
    assert.ok(node, `button exists: ${text}`); return node;
  };
  const dispatch = (node, event) => act(async () => node.dispatchEvent(event));
  // jsdom does not provide pointer-default focus. Apply only the unprevented
  // focus handoff, then use the real React handlers and DOM click defaults.
  const click = node => act(async () => {
    assert.ok(node, 'click target exists');
    const down = new w.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    node.dispatchEvent(down);
    if (!down.defaultPrevented && !node.matches(':disabled')) node.focus();
    node.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    node.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const key = async (node, name, props = {}) => {
    const event = new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...props });
    await dispatch(node, event); return event;
  };
  const input = (node, value) => act(async () => {
    assert.ok(node, 'input target exists'); node.focus();
    const prototype = node instanceof w.HTMLTextAreaElement ? w.HTMLTextAreaElement.prototype
      : node instanceof w.HTMLSelectElement ? w.HTMLSelectElement.prototype : w.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
    node.dispatchEvent(new w.Event(node instanceof w.HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
  const menu = action => act(async () => menuAction(action));
  const frame = () => act(async () => new Promise(resolve => requestAnimationFrame(() => resolve())));
  const snapshot = () => ({ project: state().project, serialized: JSON.stringify(state().project), past: state().past,
    future: state().future, dirty: state().dirty, version: state().version, epoch: state().documentEpoch });
  const unchanged = (label, saved) => check(label, snapshot(), saved);
  const rangeState = () => {
    const selection = w.getSelection();
    const at = (node, offset) => {
      const host = (node instanceof w.Element ? node : node?.parentElement)?.closest('.sc-el--editable');
      return host ? [host.dataset.id, offsetOf(host, node, offset)] : [null, null];
    };
    return [...at(selection.anchorNode, selection.anchorOffset), ...at(selection.focusNode, selection.focusOffset)];
  };
  const select = (id = 'review-a', start = 1, end = 5, backward = false, lastId = id) => act(async () => {
    const first = writing(id), last = writing(lastId); first.tabIndex = 0; first.focus();
    const from = makeTextRange(first, start, start), to = makeTextRange(last, end, end);
    if (backward) w.getSelection().setBaseAndExtent(to.startContainer, to.startOffset, from.startContainer, from.startOffset);
    else w.getSelection().setBaseAndExtent(from.startContainer, from.startOffset, to.startContainer, to.startOffset);
  });
  const open = async (tab = '批注') => {
    await click(q('.toolbar__review'));
    check('one real App workspace opens', document.querySelectorAll('.revision-workspace').length, 1);
    if (tab !== '版本') await click(button(tab));
  };
  const close = async () => { await click(field('关闭改稿工作台')); check('workspace closes', modal(), null); };
  const annotation = () => state().project.annotations?.[0];
  const project = createProject('合成改稿工作台验收');
  project.titlePage.show = false;
  project.elements = [
    { id: 'review-s1', type: 'scene_heading', text: '内景 合成空间 日' },
    { id: 'review-a', type: 'action', text: '合成<b>焦点</b>正文甲' },
    { id: 'review-b', type: 'action', text: '合成正文乙' },
    { id: 'review-empty', type: 'action', text: '' },
    { id: 'review-s2', type: 'scene_heading', text: '外景 合成空场 夜' },
  ];
  localStorage.setItem('guangying:autosave', JSON.stringify({ project, filePath: null }));
  localStorage.setItem('guangying:startup-preference', 'resume');
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(App))));
  await act(async () => {
    state().setText('review-b', '合成正文第一次'); state().breakHistoryGroup();
    state().setText('review-b', '合成正文第二次'); state().undo();
  });
  check('fixture has earlier writing undo and redo', [state().past.length, state().future.length], [1, 1]);
  await select('review-a', 1, 5, true);
  const context = captureReviewContext(), initialRange = rangeState(), opening = snapshot();
  check('review context captures exact formatted single-paragraph selection', context.textAnchor, {
    kind: 'text', elementId: 'review-a', start: 1, end: 5, quote: '成焦点正', sourceText: '合成焦点正文甲',
  });
  await open();
  check('selection is the explicit initial annotation scope', field('批注位置').value, 'selection');
  check('background writing/toolbar are inert', [!!q('.app-body').closest('[inert]'), !!q('.toolbar').closest('[inert]')], [true, true]);
  check('modal is accessible and export-excluded', [document.getElementById(modal().getAttribute('aria-labelledby')).textContent, modal().hasAttribute('data-export-exclude')], ['改稿工作台', true]);
  await click(button('撤销本次操作')); unchanged('modal cannot undo writing from before it opened', opening);
  await click(button('重做')); unchanged('modal cannot redo writing from before it opened', opening);
  const draft = field('新批注');
  await input(draft, '尚未提交的合成草稿');
  check('annotation draft explicitly owns native history', ownsNativeHistory(draft));
  check('annotation draft is visible to unsaved-draft protection', !!draft.closest('[data-project-draft-pending="true"]'));
  const nativeBefore = nativeCalls.length;
  check('draft browser undo keeps native default', (await key(draft, 'z', { ctrlKey: true })).defaultPrevented, false);
  const draftUndo = new w.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyUndo' });
  await dispatch(draft, draftUndo); check('draft beforeinput remains native', draftUndo.defaultPrevented, false);
  await menu('edit:undo'); await menu('edit:redo');
  check('App native menu history routes to draft only', nativeCalls.slice(nativeBefore), ['undo', 'redo']);
  unchanged('draft input/native history never touches project/redo', opening);
  await click(button('取消新批注'));
  check('cancel new draft clears only local text', field('新批注').value, '');
  unchanged('cancel new draft leaves complete store unchanged', opening);
  for (const name of ['s', 'o', 'n', 'p', 'f', 'd', '1']) {
    check(`workspace blocks root Ctrl+${name}`, (await key(field('新批注'), name, { ctrlKey: true })).defaultPrevented);
  }
  await menu('file:open'); await menu('edit:find'); await menu('view:cards');
  check('blocked file/menu shortcuts do not reach external actions', fileCalls, []);
  check('blocked root view/find commands preserve workspace', [state().view, !!q('.find-panel')], ['write', false]);
  const outside = new w.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: '外部事件' });
  await dispatch(writing('review-a'), outside);
  check('stale background beforeinput is intercepted', outside.defaultPrevented);
  unchanged('root shortcuts and stale background events preserve project', opening);
  const originalElements = state().project.elements;
  await input(field('新批注'), '合成批注 <b>保留字面</b>');
  await click(button('添加批注'));
  const noteId = annotation().id, addedSnapshot = state().project;
  check('adding one annotation is one history transaction', state().past.length, opening.past.length + 1);
  check('added annotation has exact original range and pending status', [annotation().anchor, annotation().status], [context.textAnchor, 'pending']);
  check('adding annotation keeps exact element references', state().project.elements === originalElements);
  check('annotation markup is displayed as literal text', [modal().textContent.includes('<b>保留字面</b>'), !!modal().querySelector('article b')], [true, false]);
  await click(button('撤销本次操作'));
  check('session undo restores exact pre-annotation snapshot', state().project === opening.project);
  await click(button('重做'));
  check('session redo restores same annotation ID and snapshot', [annotation().id, state().project === addedSnapshot], [noteId, true]);
  await input(field('新批注'), '必须明确放弃的合成草稿');
  const beforeDraftExit = snapshot();
  await click(button('撤销本次操作'));
  unchanged('footer undo cannot discard pending draft through history', beforeDraftExit);
  await menu('edit:undo'); await menu('edit:redo');
  unchanged('native menu from model controls respects pending draft boundary', beforeDraftExit);
  await key(button('撤销本次操作'), 'z', { ctrlKey: true });
  unchanged('keyboard project undo cannot bypass pending draft protection', beforeDraftExit);
  const guardedUndo = new w.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyUndo' });
  await dispatch(button('撤销本次操作'), guardedUndo);
  check('project beforeinput history is intercepted while draft is pending', guardedUndo.defaultPrevented);
  unchanged('beforeinput cannot bypass pending draft protection', beforeDraftExit);
  const exitAttempts = [
    ['header close', () => click(field('关闭改稿工作台'))],
    ['footer close', () => click(button('关闭'))],
    ['Escape', () => key(field('新批注'), 'Escape')],
    ['backdrop', () => click(modal().parentElement)],
    ['tab switch', () => click(button('版本'))],
    ['locate annotation', () => click(button('定位正文'))],
  ];
  for (const [label, attempt] of exitAttempts) {
    await attempt();
    check(`${label} requests explicit draft discard`, !!button('放弃草稿并继续'));
    check(`${label} confirmation starts on safe cancel action`, document.activeElement.textContent.trim(), '取消操作');
    unchanged(`${label} prompt does not save or discard project content`, beforeDraftExit);
    await click(button('取消操作'));
    check(`${label} cancellation preserves exact draft`, field('新批注').value, '必须明确放弃的合成草稿');
  }
  await click(button('版本')); await click(button('放弃草稿并继续'));
  check('explicit discard allows requested tab switch', modal().querySelector('[role="tab"][aria-selected="true"]').textContent, '版本');
  unchanged('discarding UI draft does not create project history', beforeDraftExit);
  await click(button('批注')); check('discarded annotation draft is gone on return', field('新批注').value, '');
  const tabKey = async (name, expected) => {
    const currentTab = modal().querySelector('[role="tab"][aria-selected="true"]');
    await act(async () => currentTab.focus());
    await key(currentTab, name); await frame();
    check(`tabs ${name} select and focus ${expected}`, [modal().querySelector('[role="tab"][aria-selected="true"]').textContent, document.activeElement.textContent], [expected, expected]);
    check('tablist has exactly one sequential keyboard stop', [...modal().querySelectorAll('[role="tab"]')].filter(node => node.tabIndex === 0).length, 1);
    check('active tab controls the labelled visible panel', modal().querySelector('[role="tabpanel"]').getAttribute('aria-labelledby'), document.activeElement.id);
  };
  await tabKey('Home', '版本'); await tabKey('End', '交稿检查');
  await tabKey('ArrowRight', '版本'); await tabKey('ArrowLeft', '交稿检查');
  await tabKey('Home', '版本'); await tabKey('ArrowRight', '批注');
  const firstStop = field('关闭改稿工作台'), lastStop = button('关闭');
  await act(async () => lastStop.focus()); await key(lastStop, 'Tab');
  check('workspace Tab wraps from last to first control', document.activeElement, firstStop);
  await key(firstStop, 'Tab', { shiftKey: true });
  check('workspace ShiftTab wraps from first to last control', document.activeElement, lastStop);
  await act(async () => writing('review-a').focus());
  check('programmatic background focus is returned inside workspace', modal().contains(document.activeElement));
  await key(document.activeElement, 'Escape', { isComposing: true });
  check('composing Escape keeps workspace open', !!modal());
  await key(document.activeElement, 'Escape', { keyCode: 229 });
  check('IME 229 Escape keeps workspace open', !!modal());
  await dispatch(field('新批注'), new w.CompositionEvent('compositionstart', { bubbles: true }));
  await key(field('新批注'), 'Escape');
  check('tracked composition ignores plain Escape until compositionend', !!modal());
  await dispatch(field('新批注'), new w.CompositionEvent('compositionend', { bubbles: true }));
  unchanged('focus/tab/IME navigation creates no project changes', beforeDraftExit);
  check('footer reports separate annotation count and capacity', modal().querySelector('footer').textContent.includes('批注 1 / 500') && modal().querySelector('footer').textContent.includes('1024 KiB'));
  await click(button('编辑 / 处理'));
  const beforeDecision = snapshot();
  await input(field('批注处理状态'), 'resolved'); await input(field('创作决定'), '合成决定：保留原文节奏');
  unchanged('decision/status remain drafts before explicit confirmation', beforeDecision);
  await click(button('确认批注与决定'));
  check('resolved status and explicit decision commit together', [annotation().status, annotation().decision, state().past.length], ['resolved', '合成决定：保留原文节奏', beforeDecision.past.length + 1]);
  await click(button('编辑 / 处理')); await input(field('批注处理状态'), 'declined');
  check('declined requires a nonempty reason', button('确认批注与决定').disabled);
  await input(field('不采用原因'), ' \n '); check('whitespace decline reason is insufficient', button('确认批注与决定').disabled);
  const beforeDecline = snapshot();
  await input(field('不采用原因'), '合成原因：与当前人物动机不符');
  unchanged('decline reason remains an uncommitted UI draft', beforeDecline);
  await click(button('确认批注与决定'));
  check('declined reason and prior decision both survive commit', [annotation().status, annotation().reason, annotation().decision], ['declined', '合成原因：与当前人物动机不符', '合成决定：保留原文节奏']);
  await close();
  check('closing workspace restores backward writing selection', rangeState(), initialRange);
  check('closing workspace restores writing focus', document.activeElement.dataset.id, 'review-a');

  await act(async () => state().setText('review-a', '改变后的合成正文甲'));
  check('real store text edit conservatively stales annotation', annotation().anchorState, 'changed');
  await select('review-b', 0, 2); await open();
  check('changed annotation visibly requests reattachment', modal().textContent.includes('原文已改变'));
  const beforeReanchor = snapshot(), oldAnchor = annotation().anchor;
  await click(button('重新挂接'));
  check('reattachment first requests explicit confirmation', !!field('确认操作'));
  unchanged('opening reattachment confirmation changes no project data', beforeReanchor);
  await click(button('取消操作')); unchanged('cancelled reattachment preserves old anchor/history', beforeReanchor);
  await click(button('重新挂接')); await click(button('确认重新挂接'));
  check('explicit reattachment targets only current selected text', [annotation().id, annotation().anchor.elementId, annotation().anchor.quote, annotation().anchorState], [noteId, 'review-b', '合成', 'current']);
  check('reattachment preserves treatment and decision', [annotation().status, annotation().reason, annotation().decision], ['declined', '合成原因：与当前人物动机不符', '合成决定：保留原文节奏']);
  await click(button('撤销本次操作'));
  check('real store undo restores stale anchor, not guessed current text', [annotation().anchor, annotation().anchorState], [oldAnchor, 'changed']);
  await click(button('重做')); check('real store redo restores explicit new target', annotation().anchor.elementId, 'review-b');
  await click(button('删除批注')); const beforeDelete = snapshot();
  await click(button('取消操作')); unchanged('cancel annotation deletion has no history impact', beforeDelete);
  await click(button('删除批注')); await click(button('确认删除批注'));
  check('confirmed annotation deletion removes only annotation', [state().project.annotations.length, state().project.elements === beforeDelete.project.elements], [0, true]);
  await click(button('撤销本次操作')); check('undo restores exact treated annotation', annotation(), beforeDelete.project.annotations[0]);
  await close();

  await select('review-a', 1, 3, true, 'review-b');
  await act(async () => state().setActive('review-s1'));
  const cross = captureReviewContext();
  check('cross-paragraph selection is explicitly unsupported', [cross.crossBlockSelection, cross.textAnchor, !!cross.selectionError], [true, null, true]);
  check('cross-paragraph selection never guesses an active paragraph from an endpoint', [cross.activeId, state().activeId], ['review-s1', 'review-s1']);
  const crossRange = rangeState(); await open();
  await input(field('新批注'), '跨段合成草稿');
  check('cross-paragraph draft cannot silently fall back to paragraph', [field('批注位置').value, button('添加批注').disabled, modal().textContent.includes('选区跨越多个段落')], ['selection', true, true]);
  await input(field('批注位置'), 'paragraph'); check('explicit paragraph choice makes scope usable', button('添加批注').disabled, false);
  await click(button('取消新批注')); await close();
  check('cross-paragraph backward selection returns intact', rangeState(), crossRange);
  await select('review-empty', 0, 0); await open(); await input(field('新批注'), '空段合成草稿');
  check('empty paragraph has no text anchor', [field('批注位置').value, button('添加批注').disabled], ['paragraph', true]);
  await input(field('批注位置'), 'scene'); check('explicit surrounding scene anchor is available', button('添加批注').disabled, false);
  await click(button('取消新批注')); await close();
  await select('review-a', 0, 2);
  const host = writing('review-a'), expectedHTML = host.innerHTML;
  host.innerHTML = '尚未同步的合成DOM';
  await select('review-a', 0, 2);
  check('unsynchronized DOM selection is refused by real context capture', [captureReviewContext().textAnchor, !!captureReviewContext().selectionError], [null, true]);
  host.innerHTML = expectedHTML;

  await select('review-a', 0, 0); await open('版本');
  const beforeVersion = snapshot();
  await input(field('新版本名称'), '合成版本一'); await click(button('保存当前版本'));
  check('version creation uses actual store once without altering prose', [state().project.revisionWorkspace.versions.length, state().past.length, state().project.elements === beforeVersion.project.elements], [1, beforeVersion.past.length + 1, true]);
  const version = state().project.revisionWorkspace.versions[0]; await close();
  await act(async () => state().setText('review-a', '当前修改后的合成正文'));
  await select('review-a', 3, 3);
  await act(async () => {
    state().setActive('review-s1');
    state().setWritingSelectedIds(['review-b', 'review-a']);
  });
  const caretContext = captureReviewContext(), preservedIds = state().writingSelectedIds;
  check('collapsed DOM caret wins over delayed store active paragraph',
    [caretContext.activeId, caretContext.textAnchor, caretContext.crossBlockSelection, caretContext.selectionError], ['review-a', null, false, undefined]);
  check('collapsed caret capture does not mutate store focus or explicit paragraph selection',
    [state().activeId, state().writingSelectedIds, caretContext.writingSelectedIds, caretContext.writingSelectedIds === preservedIds],
    ['review-s1', ['review-b', 'review-a'], ['review-b', 'review-a'], false]);
  await open('版本');
  check('actual App shows insertion target from collapsed DOM caret, not stale scene heading',
    modal().textContent.includes('插入到「当前修改后的合成正文」后'));
  const oldParagraph = version.content.elements.find(item => item.id === 'review-a');
  const oldCheckbox = [...modal().querySelectorAll('input[type="checkbox"]')].find(node => node.getAttribute('aria-label')?.includes('改变后的合成正文甲'));
  assert.ok(oldCheckbox, 'old paragraph checkbox exists'); await click(oldCheckbox);
  const beforeRestore = snapshot(), knownIds = new Set(state().project.elements.map(item => item.id));
  await click(button('取回所选 1 段'));
  const restored = state().project.elements.find(item => !knownIds.has(item.id));
  check('version restore inserts a new ID with exact old text', [!!restored, restored?.text, state().project.elements.length], [true, oldParagraph.text, beforeRestore.project.elements.length + 1]);
  check('version restore keeps current paragraph unchanged', state().project.elements.find(item => item.id === 'review-a').text, '当前修改后的合成正文');
  check('version restore inserts immediately after explicit target', state().project.elements[state().project.elements.findIndex(item => item.id === 'review-a') + 1].id, restored.id);
  await click(button('撤销本次操作')); check('one session undo removes only restored copy', state().project === beforeRestore.project);
  await close();

  await select('review-a', 0, 0); await open('暂存');
  await input(field('暂存名称'), '合成复制暂存'); await input(field('暂存备注'), '合成来源备注');
  const beforeStash = snapshot(); await click(button('复制存入'));
  check('copy stash retains exact writing and creates one entry', [state().project.elements === beforeStash.project.elements, state().project.revisionWorkspace.stash.length], [true, 1]);
  const stashCopy = state().project.revisionWorkspace.stash[0];
  const beforeStashRestore = snapshot(); await click(button('恢复暂存副本'));
  check('stash restoration inserts copy and retains source entry', [state().project.elements.length, state().project.revisionWorkspace.stash[0].id], [beforeStashRestore.project.elements.length + 1, stashCopy.id]);
  await click(button('撤销本次操作')); check('stash copy restoration undoes in one step', state().project === beforeStashRestore.project);
  await input(field('暂存名称'), '合成移出暂存');
  const beforeRemoveStash = snapshot(); await click(button('存入并移出正文'));
  unchanged('stash remove first asks confirmation without deleting', beforeRemoveStash);
  await click(button('取消操作')); unchanged('cancel stash removal preserves writing and history', beforeRemoveStash);
  await click(button('存入并移出正文')); await click(button('确认存入并移出'));
  check('confirmed stash removal moves exactly active paragraph', [state().project.elements.some(item => item.id === 'review-a'), state().project.revisionWorkspace.stash.length], [false, 2]);
  await click(button('撤销本次操作')); check('one undo restores removed paragraph and stash snapshot', state().project === beforeRemoveStash.project);
  await click(button('取消暂存草稿')); await close();

  await select('review-a', 0, 0); await open('交稿检查');
  const issues = modal().querySelectorAll('article').length, beforeIgnore = snapshot();
  check('synthetic empty scene produces a real delivery check', issues > 0);
  await click(button('忽略此项'));
  check('ignore hides exactly one issue without rewriting writing', [state().project.deliveryIgnored.length, modal().querySelectorAll('article').length, state().project.elements === beforeIgnore.project.elements], [1, issues - 1, true]);
  const ignoredSwitch = modal().querySelector('input[type="checkbox"]'); await click(ignoredSwitch);
  check('show ignored exposes its retained issue', modal().querySelectorAll('article').length, issues);
  await click(button('恢复提醒'));
  check('restore reminder clears explicit ignored record', state().project.deliveryIgnored, []);
  await close();

  // A different editor/list selection must not unmount an uncommitted draft.
  await select('review-a', 0, 2); await open();
  await input(field('新批注'), '合成第二条独立批注'); await click(button('添加批注'));
  const annotationRows = () => [...modal().querySelectorAll('article')];
  const firstNoteBody = state().project.annotations[0].body;
  const secondNote = state().project.annotations[1];
  const noteRow = body => annotationRows().find(node => node.textContent.includes(body));
  await click(button('编辑 / 处理', noteRow(firstNoteBody)));
  check('editing annotation disables both visibility-changing filters', [field('搜索批注').disabled, field('筛选批注状态').disabled], [true, true]);
  await input(field('编辑批注内容'), '合成尚未提交正文草稿');
  await input(field('批注处理状态'), 'declined');
  await input(field('不采用原因'), '合成尚未提交原因草稿');
  await input(field('创作决定'), '合成尚未提交决定草稿');
  await input(field('新批注'), '独立的新批注草稿应保留');
  const annotationDraftValues = () => [field('编辑批注内容')?.value, field('批注处理状态')?.value,
    field('不采用原因')?.value, field('创作决定')?.value];
  const beforeEditorSwitch = snapshot(), fourDrafts = annotationDraftValues();
  await click(button('编辑 / 处理', noteRow(secondNote.body)));
  check('switching annotation editor requests explicit discard', !!button('放弃草稿并继续'));
  unchanged('editor-switch prompt never writes draft into either annotation', beforeEditorSwitch);
  await click(button('取消操作'));
  check('cancel editor switch retains all four draft fields', annotationDraftValues(), fourDrafts);
  check('cancel editor switch retains first editing object and second display row', [field('编辑批注内容').closest('article') === annotationRows()[0], !!button('编辑 / 处理', noteRow(secondNote.body))], [true, true]);
  unchanged('cancel editor switch retains full project/history', beforeEditorSwitch);
  await click(button('编辑 / 处理', noteRow(secondNote.body))); await click(button('放弃草稿并继续'));
  check('explicit editor switch loads only target annotation data', [field('编辑批注内容').value, field('批注处理状态').value, field('创作决定').value], [secondNote.body, 'pending', '']);
  check('explicit editor switch changes editing object without saving first draft', field('编辑批注内容').closest('article') === annotationRows()[1]);
  check('switching annotation editor preserves independent new-annotation draft', field('新批注').value, '独立的新批注草稿应保留');
  unchanged('discard-and-switch creates no annotation/history change', beforeEditorSwitch);
  await click(button('取消编辑'));
  check('finishing editor releases both annotation filters', [field('搜索批注').disabled, field('筛选批注状态').disabled], [false, false]);
  await click(button('取消新批注'));
  await close();

  await select('review-a', 0, 0); await open('版本');
  await input(field('新版本名称'), '合成版本二'); await click(button('保存当前版本'));
  const versionEntries = () => [...modal().querySelectorAll('.revision-workspace__entry')];
  const versionEntry = name => versionEntries().find(node => node.querySelector('strong')?.textContent === name);
  const chosenVersionName = () => versionEntries().find(node => node.getAttribute('aria-pressed') === 'true')?.querySelector('strong')?.textContent;
  check('new version becomes the selected version', chosenVersionName(), '合成版本二');
  await click(button('重命名')); await input(field('版本新名称'), '尚未提交的合成版本名');
  check('active rename button cannot reset its existing draft', button('重命名').disabled);
  const beforeRenameSwitch = snapshot();
  await click(versionEntry('合成版本二'));
  check('clicking selected version preserves rename without opening discard confirmation', [field('版本新名称').value, field('确认操作')], ['尚未提交的合成版本名', null]);
  await click(versionEntry('合成版本一'));
  check('switching version during rename requests explicit discard', !!button('放弃草稿并继续'));
  unchanged('version-switch prompt does not rename any saved version', beforeRenameSwitch);
  await click(button('取消操作'));
  check('cancel version switch retains draft and selected version', [field('版本新名称').value, chosenVersionName()], ['尚未提交的合成版本名', '合成版本二']);
  unchanged('cancel version switch preserves project/history', beforeRenameSwitch);
  await click(versionEntry('合成版本一')); await click(button('放弃草稿并继续'));
  check('explicit version switch discards draft and selects target', [field('版本新名称'), chosenVersionName()], [null, '合成版本一']);
  unchanged('explicit version switch does not commit discarded rename', beforeRenameSwitch);
  await close();

  const obsoleteIgnored = ['delivery:1:empty-scene:0123456789abcdef', 'delivery:1:pending-annotation:fedcba9876543210'];
  await act(async () => state().mutate(draft => { draft.deliveryIgnored = [...obsoleteIgnored]; }));
  await select('review-a', 0, 0); await open('交稿检查');
  const beforeClearAll = snapshot(), clearAllLabel = '恢复全部提醒（2条记录）';
  check('obsolete ignored records still have an explicit bulk clear entry', !!button(clearAllLabel));
  await click(modal().querySelector('input[type="checkbox"]'));
  check('obsolete signatures do not fabricate current ignored issues', [...modal().querySelectorAll('article')].every(node => !node.textContent.includes('已忽略')));
  await click(button(clearAllLabel));
  check('bulk clear requires confirmation even for obsolete signatures', !!button('确认恢复全部提醒'));
  unchanged('bulk clear confirmation alone preserves all ignore records', beforeClearAll);
  await click(button('取消操作')); unchanged('cancel bulk clear preserves full project/history', beforeClearAll);
  await click(button(clearAllLabel)); await click(button('确认恢复全部提醒'));
  check('confirmed bulk clear removes obsolete records in one transaction', [state().project.deliveryIgnored, state().past.length], [[], beforeClearAll.past.length + 1]);
  check('bulk clear preserves writing, annotations and saved workspace', [state().project.elements === beforeClearAll.project.elements, state().project.annotations === beforeClearAll.project.annotations, state().project.revisionWorkspace === beforeClearAll.project.revisionWorkspace], [true, true, true]);
  await click(button('撤销本次操作'));
  check('one undo restores exact obsolete-ignore snapshot', state().project === beforeClearAll.project);
  await click(button('重做')); check('redo clears the same ignored records again', state().project.deliveryIgnored, []);
  await close();

  await select('review-a', 0, 2); await open(); await input(field('新批注'), '旧工程未确认合成草稿');
  const staleEpoch = state().documentEpoch;
  const replacement = createProject('合成切换后的工程'); replacement.id = state().project.id;
  replacement.titlePage.show = false;
  replacement.elements = [{ id: 'review-a', type: 'action', text: '同ID的新工程正文' }];
  await act(async () => state().loadProject(replacement));
  check('same project ID reload still advances epoch', state().documentEpoch > staleEpoch);
  check('stale dialog warns and disables actions', [modal().textContent.includes('此工作台已过期'), field('新批注').matches(':disabled')], [true, true]);
  const afterSwitch = snapshot();
  await menu('edit:undo'); await menu('edit:redo');
  await click(button('添加批注')); unchanged('stale dialog/menu cannot mutate new same-ID document', afterSwitch);
  await click(field('关闭改稿工作台'));
  check('stale draft still offers a usable discard-and-close action', button('放弃草稿并继续').disabled, false);
  await click(button('放弃草稿并继续')); check('stale draft can be discarded and dialog closed', modal(), null);
  unchanged('closing stale dialog preserves new document/history', afterSwitch);
  check('old selection is not restored across epoch', rangeState().join('|') !== 'review-a|0|review-a|2');
  check('modal close removes background isolation', !!q('.app-body').closest('[inert]'), false);
  await act(async () => state().mutate(draft => { draft.deliveryIgnored = [...obsoleteIgnored]; }));
  await select('review-a', 0, 0); await open('交稿检查');
  await click(button(clearAllLabel));
  const oldClearEpoch = state().documentEpoch;
  const replacementAgain = { ...state().project, elements: [{ id: 'review-a', type: 'action', text: '再次切换的合成正文' }] };
  await act(async () => state().loadProject(replacementAgain));
  const afterClearEpochChange = snapshot();
  check('stale bulk-clear confirmation cannot clear new document records', button('确认恢复全部提醒').disabled);
  await click(button('确认恢复全部提醒'));
  unchanged('disabled stale bulk-clear confirmation preserves new document', afterClearEpochChange);
  let staleClearResult;
  await act(async () => { staleClearResult = state().clearDeliveryIgnored(oldClearEpoch); });
  check('bulk-clear store action independently rejects stale epoch', staleClearResult, false);
  unchanged('stale bulk-clear store action preserves new ignore records/history', afterClearEpochChange);
  await click(button('取消操作')); await close();
  check('React and browser report no runtime errors', errors, []);
  console.log(`revision workspace UI: ${checks} checks passed (real App/context/store, synthetic DOM and memory native-menu spies; no native IME/PDF claim)`);
})().catch(error => { originalError(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (root) await act(async () => root.unmount());
  console.error = originalError; dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
});
