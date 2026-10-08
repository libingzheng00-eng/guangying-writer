/**
 * Actual Chromium UI-layer acceptance inside windows-smoke's owned QA window.
 * No store injection, synthetic React events, beforeunload removal, or real user
 * data. Pointer/key input goes through webContents.sendInputEvent; JavaScript
 * only reads layout/state, scrolls controls into view, and prepares focus/ranges.
 * MenuItem.click exercises the production native-menu -> IPC -> App route; it
 * does not claim a human operated the Windows system menu with a mouse.
 */
const strictAssert = require('node:assert/strict');

module.exports = async function runWindowsUiLayers({ win, run, key, menu, pause, until, screenshot: capture, pass: markPassed, snapshot }) {
  let assertions = 0;
  const groups = [], screenshots = [];
  const assert = Object.fromEntries(['ok', 'equal', 'deepEqual'].map(method => [method, (...args) => { strictAssert[method](...args); assertions++; }]));
  const pass = label => { groups.push(label); markPassed(label); };
  const screenshot = async name => { await capture(name); screenshots.push(name); };
  assert.equal(process.platform, 'win32', 'UI layer acceptance is Windows-only');
  const editor = '.script-flow [data-id="windows-action"]';
  const modal = '.modal[role="dialog"][aria-modal="true"]';
  const trigger = '.toolbar [aria-haspopup="menu"]';
  const popup = '[role="menu"][aria-label="文件"]';
  const fileLabels = ['新建剧本', '打开…', '另存为…', '导入文本 / FDX…', '导出创作版 PDF（原位卡片）…', '导出 A4 纯文本 PDF…',
    '导出 Final Draft (FDX)…', '导出纯文本…', '导出 Markdown…', '导出网页 HTML…', '标题页…'];
  const settingsButton = `Array.from(document.querySelectorAll('.toolbar__file-actions > button')).find(e=>e.textContent.trim()==='设置')`;
  const q = value => JSON.stringify(value);
  const element = selector => `document.querySelector(${q(selector)})`;
  const labelButton = (scope, label) => `Array.from(document.querySelectorAll(${q(scope + ' button')})).find(e=>e.textContent.trim()===${q(label)})`;
  const field = label => `Array.from(document.querySelectorAll('.modal .field')).find(e=>e.querySelector('label')?.textContent.trim()===${q(label)})?.querySelector('input,textarea,select')`;
  const focusable = `Array.from(document.querySelectorAll(${q(modal)}+' button, '+${q(modal)}+' input, '+${q(modal)}+' textarea, '+${q(modal)}+' select, '+${q(modal)}+' [tabindex]')).filter(e=>!e.disabled&&e.tabIndex>=0&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden')`;
  const originalBounds = win.getBounds();
  const originalTheme = await run(`document.querySelector('.app-shell').dataset.theme`);
  await until(async () => (await snapshot())?.project.id === 'windows-synthetic', 'UI fixture reaches recovery before establishing its invariant snapshot');
  const before = (await snapshot()).project;
  const withoutTimestamp = project => { const copy = JSON.parse(JSON.stringify(project)); delete copy.updatedAt; return copy; };

  async function clickExpression(expression, label = expression) {
    const point = await run(`(() => {
      const e=${expression};if(!e)throw Error('Missing test control');
      e.scrollIntoView({block:'nearest',inline:'nearest'});
      const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
      const hit=document.elementFromPoint(x,y);
      return {x,y,width:r.width,height:r.height,inside:x>=0&&y>=0&&x<innerWidth&&y<innerHeight,hit:!!hit&&(e===hit||e.contains(hit)),tag:hit?.tagName,className:hit?.className};
    })()`);
    assert.ok(point.width > 0 && point.height > 0 && point.inside && point.hit, `${label} must be visible and topmost at its click point: ${JSON.stringify(point)}`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(point.x), y: Math.round(point.y) });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: Math.round(point.x), y: Math.round(point.y) });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: Math.round(point.x), y: Math.round(point.y) });
    await pause(100);
  }
  const click = selector => clickExpression(element(selector), selector);
  async function editField(label, value) {
    await clickExpression(field(label), label);
    await key('a', ['control']);
    if (value) await win.webContents.insertText(value);
    else await key('Backspace');
    await until(`(${field(label)})?.value===${q(value)}`, `${label} accepts real Chromium input`);
  }
  async function readyModal(title) {
    await until(`!!document.querySelector(${q(modal)}) && document.querySelector(${q(modal)}).contains(document.activeElement)`, title + ' modal opens and receives focus');
    assert.equal(await run(`document.querySelector(${q(modal)}).querySelector('h3').textContent`), title);
    assert.equal(await run(`document.querySelector(${q(modal)}).contains(document.activeElement)`), true, 'Initial focus must move into the modal');
    assert.equal(await run(`['.toolbar','.app-body','.statusbar'].every(s=>!!document.querySelector(s).closest('[inert]'))&&!document.querySelector(${q(modal)}).closest('[inert]')`), true, 'All background regions are inert while the modal remains interactive');
    assert.equal(await run(`document.querySelector(${q(trigger)}).disabled&&!document.querySelector(${q(popup)})`), true, 'Modal disables the file trigger and removes its popup');
    const geometry = await run(`(() => {const e=document.querySelector(${q(modal)}),r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,label:document.getElementById(e.getAttribute('aria-labelledby'))?.textContent};})()`);
    assert.equal(geometry.label, title);
    assert.ok(geometry.left >= -1 && geometry.top >= -1 && geometry.right <= geometry.w + 1 && geometry.bottom <= geometry.h + 1, `Modal stays within viewport: ${JSON.stringify(geometry)}`);
  }
  async function escapeModal() {
    await key('Escape');
    await until(`!document.querySelector(${q(modal)})`, 'Escape closes modal');
    assert.equal(await run(`['.toolbar','.app-body','.statusbar'].some(s=>!!document.querySelector(s).closest('[inert]'))`), false, 'All background regions return to interactive state');
    assert.equal(await run(`document.querySelector(${q(trigger)}).disabled||!!document.querySelector(${q(popup)})`), false, 'Closing the modal enables the trigger without reviving an old popup');
  }
  async function openSettings() {
    await clickExpression(settingsButton, 'toolbar Settings');
    await readyModal('显示简介设置');
  }
  async function clickBackdrop() {
    const point = await run(`(() => { const x=2,y=innerHeight-2;return {x,y,hit:document.elementFromPoint(x,y)?.classList.contains('modal-backdrop')};})()`);
    assert.equal(point.hit, true, 'Backdrop dismissal point is topmost, outside dialog content');
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: point.x, y: point.y });
    await pause(80);
    assert.equal(await run(`!!document.querySelector(${q(modal)})`), true, 'Backdrop stays mounted until pointer release to prevent click-through');
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: point.x, y: point.y });
    await until(`!document.querySelector(${q(modal)})`, 'Backdrop click dismisses modal');
  }
  async function visibleModalFocus(label) {
    // Read only: never scroll or refocus the control before this assertion.
    // A contained but clipped focus target is not usable keyboard navigation.
    const state = await run(`(() => {
      const e=document.activeElement,d=document.querySelector(${q(modal)});
      if(!e||!d?.contains(e))return {contained:false};
      const r=e.getBoundingClientRect(),m=d.getBoundingClientRect();
      const clip={left:Math.max(0,m.left),top:Math.max(0,m.top),right:Math.min(innerWidth,m.right),bottom:Math.min(innerHeight,m.bottom)};
      const ancestors=[];
      for(let p=e.parentElement;p;p=p.parentElement){
        const s=getComputedStyle(p),b=p.getBoundingClientRect();
        const clipsX=/^(auto|scroll|hidden|clip)$/.test(s.overflowX),clipsY=/^(auto|scroll|hidden|clip)$/.test(s.overflowY);
        if(clipsX){clip.left=Math.max(clip.left,b.left+p.clientLeft);clip.right=Math.min(clip.right,b.left+p.clientLeft+p.clientWidth);}
        if(clipsY){clip.top=Math.max(clip.top,b.top+p.clientTop);clip.bottom=Math.min(clip.bottom,b.top+p.clientTop+p.clientHeight);}
        if(clipsX||clipsY)ancestors.push({className:p.className,scrollTop:p.scrollTop,scrollLeft:p.scrollLeft,rect:b.toJSON()});
      }
      const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
      return {contained:true,label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,60),rect:r.toJSON(),clip,ancestors,
        visible:r.width>0&&r.height>0&&r.left>=clip.left-1&&r.top>=clip.top-1&&r.right<=clip.right+1&&r.bottom<=clip.bottom+1,
        topmost:!!hit&&(hit===e||e.contains(hit)),hit:hit?{tag:hit.tagName,className:hit.className}:null};
    })()`);
    const usable = state.contained && state.visible && state.topmost;
    // Capture the untouched failure state before throwing; the outer harness
    // also preserves its general ui-layer-failure.json/png diagnostics.
    if (!usable) await screenshot('ui-focus-failure.png').catch(() => {});
    assert.ok(usable, `${label}: focused control must fit its modal/scroll clipping bounds and receive elementFromPoint: ${JSON.stringify(state)}`);
  }
  async function tabTrap(label = 'Dialog') {
    const count = await run(`${focusable}.length`);
    assert.ok(count > 2, 'Dialog has focusable business controls');
    let index = await run(`(${focusable}).indexOf(document.activeElement)`);
    assert.ok(index >= 0, 'Dialog starts on a live business control');
    await visibleModalFocus(`${label} initial focus`);
    // Start from the actual opener's focus. In Settings, the first two reverse
    // keys go from the page tab to Close and then to offscreen Done. No test
    // focus()/scrollIntoView() may pre-scroll that regression out of existence.
    for (const [direction, modifiers, step] of [['Shift+Tab', ['shift'], -1], ['Tab', [], 1]]) {
      for (let i = 0; i < count; i++) {
        await key('Tab', modifiers);
        index = (index + step + count) % count;
        assert.equal(await run(`(${focusable}).indexOf(document.activeElement)`), index, `${label} ${direction} visits every control and wraps within dialog`);
        await visibleModalFocus(`${label} ${direction} ${i + 1}/${count}`);
      }
    }
  }
  async function focusEditorRange(backward = false) {
    await run(`(() => {const e=document.querySelector(${q(editor)});e.scrollIntoView({block:'center'});e.focus();getSelection().setBaseAndExtent(e.firstChild,${backward ? 3 : 1},e.firstChild,${backward ? 1 : 3});})()`);
  }
  async function assertEditorRange(backward = false) {
    assert.deepEqual(await run(`(() => {const s=getSelection();return {id:document.activeElement.dataset.id,anchor:s.anchorOffset,focus:s.focusOffset,text:s.toString()};})()`),
      { id: 'windows-action', anchor: backward ? 3 : 1, focus: backward ? 1 : 3, text: '成正' }, 'Closing native-menu modal restores the same editor selection and direction');
  }
  async function blockedBackground() {
    const unchanged = await run(`document.querySelector(${q(editor)}).outerHTML`);
    await key('f', ['control']);
    menu('查找…'); await pause(100);
    assert.equal(await run('!!document.querySelector(".find-panel")'), false, 'Native/keyboard Find cannot open behind modal');
    for (const label of ['新建剧本', '打开…', '保存', '另存为…', '导入文本剧本…', '导入 Final Draft (FDX)…',
      '导出创作版 PDF（原位卡片）…', '导出 A4 纯文本 PDF…', '导出 FDX…', '导出纯文本…', '导出 Markdown…',
      '标题页…', '显示简介设置…', '故事板卡片', '自由板', '分页预览', '统计报表', '插入场景', '双列对白', '省略 / 恢复']) {
      menu(label); await pause(25);
      assert.equal(await run(`document.querySelector(${q(modal)}).contains(document.activeElement)`), true, `${label} cannot replace the modal or steal focus`);
    }
    await key('2', ['control', 'alt']);
    assert.equal(await run(`!!document.querySelector(${q(editor)}) && !document.querySelector('.cards')`), true, 'Native/keyboard view switch is blocked by modal');
    menu('人物'); await pause(100);
    assert.equal(await run(`document.querySelector(${q(editor)}).outerHTML`), unchanged, 'Native element command cannot mutate background paragraph');
    await run(`document.querySelector(${q(editor)}).focus()`);
    assert.equal(await run(`document.querySelector(${q(modal)}).contains(document.activeElement)`), true, 'Inert background refuses programmatic focus');
  }

  win.setSize(1440, 960); win.show(); win.focus(); await pause(150);
  for (let i = 0; i < 3; i++) {
    await focusEditorRange(i === 1);
    menu('标题页…'); await readyModal('标题页');
    if (i === 0) {
      await tabTrap(); await blockedBackground();
      const oldTitle = await run(`(${field('剧名')}).value`);
      await editField('剧名', '合成层级验收标题');
      await until(async () => (await snapshot())?.project.titlePage.title === '合成层级验收标题', 'title-field edit reaches the real project recovery snapshot');
      menu('撤销');
      await until(`(${field('剧名')}).value===${q(oldTitle)}`, 'native Undo restores title field within modal');
      menu('重做');
      await until(`(${field('剧名')}).value==='合成层级验收标题'`, 'native Redo restores title field within modal');
      await editField('剧名', oldTitle);
    } else {
      const titleAtOpen = await run(`(${field('剧名')}).value`);
      menu('撤销'); await pause(160);
      assert.equal(await run(`(${field('剧名')}).value`), titleAtOpen, 'A new modal session cannot undo a previous session');
      assert.equal(await run(`document.querySelector(${q(editor)}).textContent`), '合成正文', 'Modal Undo cannot change background writing');
    }
    await escapeModal(); await assertEditorRange(i === 1);
  }
  pass('Windows modal: native title/Undo/Redo commands, bounded history, input, Tab/Shift+Tab containment, blocked background commands, and three selection-restoring Escape cycles');

  await openSettings(); await tabTrap(); await blockedBackground();
  const oldMore = await run(`(${field('「（更多）」文案')}).value`);
  await editField('「（更多）」文案', '合成续页标签');
  await until(async () => (await snapshot())?.project.settings.moreText === '合成续页标签', 'settings-field edit reaches the real project recovery snapshot');
  await editField('「（更多）」文案', oldMore);
  for (const tab of ['元素缩进', '修订', '外观', '常规', '版式']) {
    await clickExpression(labelButton('.modal .tabs', tab), `settings ${tab} tab`);
    assert.equal(await run(`document.querySelector('.modal .tabs .is-active').textContent`), tab);
    await tabTrap();
  }
  await escapeModal();
  assert.equal(await run(`document.activeElement===(${settingsButton})`), true, 'Settings returns focus to its live toolbar trigger');
  pass('Windows settings: business text persists, every tab remains interactive, focus trap survives dynamic content, Escape restores toolbar trigger');

  // Native menu is deliberately invoked from the editor, independently of the
  // renderer toolbar: this covers the IPC path that DOM-only tests cannot prove.
  await focusEditorRange(); menu('显示简介设置…'); await readyModal('显示简介设置');
  await escapeModal(); await assertEditorRange();
  pass('Windows native Settings menu follows modal isolation and restores editor selection');

  menu('查找…');
  await until(`document.activeElement===document.querySelector('.find-panel input[aria-label="查找内容"]')`, 'Native Find receives focus before modal');
  await win.webContents.insertText('合成正文');
  await run(`document.activeElement.setSelectionRange(1,3,'backward')`);
  menu('显示简介设置…'); await readyModal('显示简介设置');
  menu('查找…'); await key('f', ['control']);
  assert.equal(await run(`document.querySelector(${q(modal)}).contains(document.activeElement)`), true, 'Already-open Find cannot steal modal focus');
  await escapeModal();
  assert.deepEqual(await run(`(() => {const e=document.activeElement;return {label:e.getAttribute('aria-label'),value:e.value,start:e.selectionStart,end:e.selectionEnd,direction:e.selectionDirection};})()`),
    { label: '查找内容', value: '合成正文', start: 1, end: 3, direction: 'backward' }, 'Closing modal restores Find input focus and its exact selection');
  await key('Escape'); await until(`!document.querySelector('.find-panel')`, 'Find closes normally after modal');

  await focusEditorRange(); menu('标题页…'); await readyModal('标题页');
  await click('.modal__head button');
  await until(`!document.querySelector(${q(modal)})`, 'Title close button dismisses modal');
  await assertEditorRange();
  await openSettings(); await clickBackdrop();
  assert.equal(await run(`document.activeElement===(${settingsButton})`), true, 'Backdrop restores live Settings trigger');
  pass('Windows modal lifecycle: existing Find stays isolated, input selection restores, close button and backdrop release dismiss safely');

  for (const [width, height] of [[1024, 680], [1440, 960]]) {
    win.setSize(width, height); await pause(150);
    assert.deepEqual(win.getSize(), [width, height], 'Evidence window has the requested outer size');
    for (const theme of ['day', 'night']) {
      await openSettings();
      await clickExpression(labelButton('.modal .tabs', '外观'), 'appearance tab');
      await clickExpression(labelButton('.appearance-theme-switch', theme === 'day' ? '日间' : '夜间'), theme);
      assert.equal(await run(`document.querySelector('.app-shell').dataset.theme`), theme);
      await clickExpression(labelButton('.modal .tabs', '版式'), 'page tab');
      await readyModal('显示简介设置');
      await screenshot(`ui-settings-${width}x${height}-${theme}.png`);
      await tabTrap(`Settings ${width}x${height} ${theme}`);
      await clickExpression(labelButton('.modal__foot', '完成'), 'settings Done');
      await until(`!document.querySelector(${q(modal)})`, 'Done closes settings');
      assert.equal(await run(`document.activeElement===(${settingsButton})`), true);

      await click('.doc-title'); await readyModal('标题页');
      await screenshot(`ui-title-${width}x${height}-${theme}.png`);
      await tabTrap(`Title ${width}x${height} ${theme}`);
      await escapeModal();
      assert.equal(await run('document.activeElement===document.querySelector(".doc-title")'), true);

      await click(trigger); await until(`!!document.querySelector(${q(popup)})`, 'file popup');
      assert.equal(await run(`document.querySelector(${q(trigger)}).getAttribute('aria-expanded')`), 'true');
      const items = await run(`Array.from(document.querySelectorAll(${q(popup + ' [role="menuitem"]')})).map(e=>({text:e.textContent.trim(),r:e.getBoundingClientRect().toJSON(),topmost:e.contains(document.elementFromPoint(e.getBoundingClientRect().x+e.getBoundingClientRect().width/2,e.getBoundingClientRect().y+e.getBoundingClientRect().height/2))}))`);
      assert.deepEqual(items.map(item => item.text), fileLabels, 'All 11 file command labels/order remain present');
      assert.equal(await run(`document.querySelector(${q(trigger)}).getAttribute('aria-controls')===document.querySelector(${q(popup)}).id`), true, 'File trigger is linked to its live popup');
      const viewport = await run('({width:innerWidth,height:innerHeight})');
      for (const item of items) assert.ok(item.r.x >= -1 && item.r.y >= -1 && item.r.right <= viewport.width + 1 && item.r.bottom <= viewport.height + 1 && item.topmost, `File item must be within viewport and topmost: ${JSON.stringify(item)}`);
      assert.equal(await run(`document.activeElement===document.querySelector(${q(popup + ' [role="menuitem"]')})`), true);
      await screenshot(`ui-file-menu-${width}x${height}-${theme}.png`);
      await key('Escape');
      await until(`!document.querySelector(${q(popup)})`, 'Escape dismisses menu');
      assert.equal(await run(`document.activeElement===document.querySelector(${q(trigger)})`), true);
    }
  }
  pass('Windows 1024x680 and 1440x960, day/night: settings/title modals and every file-menu item fit; full forward/reverse Tab cycles keep focus visible/topmost inside scroll clipping bounds (12 screenshots)');

  const menuItems = `${popup} [role="menuitem"]`;
  await click(trigger); await key('End');
  assert.equal(await run(`document.activeElement===Array.from(document.querySelectorAll(${q(menuItems)})).at(-1)`), true);
  await key('Down');
  assert.equal(await run(`document.activeElement===document.querySelector(${q(menuItems)})`), true);
  await key('Up');
  assert.equal(await run(`document.activeElement===Array.from(document.querySelectorAll(${q(menuItems)})).at(-1)`), true);
  await key('Home');
  assert.equal(await run(`document.activeElement===document.querySelector(${q(menuItems)})`), true);
  await key('Escape'); await key('Up');
  await until(`!!document.querySelector(${q(popup)})`, 'ArrowUp opens file menu');
  assert.equal(await run(`document.activeElement===Array.from(document.querySelectorAll(${q(menuItems)})).at(-1)`), true, 'ArrowUp opens at the last file item');
  await key('Escape'); await key('Down');
  await until(`!!document.querySelector(${q(popup)})`, 'ArrowDown opens file menu');
  await key('Tab');
  await until(`!document.querySelector(${q(popup)})`, 'Tab dismisses file menu');
  assert.equal(await run(`document.activeElement===(${settingsButton})`), true, 'Tab continues to the next toolbar control');
  await click(trigger); await key('Tab', ['shift']);
  await until(`!document.querySelector(${q(popup)})`, 'Shift+Tab dismisses file menu');
  assert.equal(await run(`document.activeElement.textContent.trim()`), '保存', 'Shift+Tab continues to the preceding toolbar control');
  await click(trigger); await click(editor);
  await until(`!document.querySelector(${q(popup)})`, 'Outside pointer click dismisses file menu');
  assert.equal(await run('document.activeElement.dataset.id'), 'windows-action', 'Outside click retains its editor focus');
  await click(trigger); win.blur();
  await until(`!document.querySelector(${q(popup)})`, 'Owned window blur dismisses file menu');
  win.focus(); await pause(160);

  await click(trigger);
  await clickExpression(labelButton(popup, '标题页…'), 'file menu title command');
  await readyModal('标题页');
  assert.equal(await run(`!!document.querySelector(${q(popup)})`), false, 'Opening modal consumes the file menu');
  await escapeModal();
  assert.equal(await run(`document.activeElement===document.querySelector(${q(trigger)})`), true, 'Modal returns to live file trigger, not an unmounted menu item');
  pass('Windows file menu: arrows/Home/End, Escape, Tab/Shift+Tab continuation, outside click/window blur, and title action through stable focus handoff');

  await click(trigger); menu('自由板');
  await until(`!!document.querySelector('.board--workspace')&&!document.querySelector(${q(popup)})`, 'Native Free Board entry switches view and closes the file popup');
  assert.equal(await run(`document.activeElement===document.querySelector(${q(trigger)})`), true, 'Native view switch leaves a live file trigger focused');
  await click('.bcard[data-id="windows-image"] .bcard__media-img');
  const boardState = `(() => ({mode:document.querySelector('.board').dataset.mode,panning:document.querySelector('.board__canvas').dataset.panning,cards:Array.from(document.querySelectorAll('.bcard')).map(e=>[e.dataset.id,e.classList.contains('is-selected')])}))()`;
  const expectedBoardState = await run(boardState);
  assert.equal(expectedBoardState.cards.some(([id, selected]) => id === 'windows-image' && selected), true, 'Synthetic image card is selected for destructive-shortcut isolation checks');
  await run(`document.querySelector(${q(trigger)}).focus()`);
  for (const code of ['Delete', 'Backspace', 'l', 'Escape']) {
    await key(code);
    assert.deepEqual(await run(boardState), expectedBoardState, `Closed file trigger ${code} cannot change board mode, selection or cards`);
  }
  for (const code of ['Space', 'Enter']) {
    await key(code);
    await until(`!!document.querySelector(${q(popup)})`, `${code} activates the closed file button through Chromium`);
    assert.deepEqual(await run(boardState), expectedBoardState, `${code} button activation cannot operate the board`);
    for (const blocked of ['Delete', 'Backspace', 'l']) {
      await key(blocked);
      assert.deepEqual(await run(boardState), expectedBoardState, `Open file menu ${blocked} cannot operate the board`);
    }
    await key('Escape');
    await until(`!document.querySelector(${q(popup)})`, 'Board file menu closes on Escape');
  }
  await screenshot('ui-native-free-board.png');
  await click(trigger); await clickExpression(labelButton('.toolbar__views', '写作'), 'toolbar Writing view');
  await until(`!!document.querySelector(${q(editor)})&&!document.querySelector(${q(popup)})`, 'Toolbar view switch closes the file popup');
  await click(trigger); await clickExpression(settingsButton, 'settings while file popup is open');
  await readyModal('显示简介设置'); await escapeModal();
  await click(trigger); menu('查找…');
  await until(`!document.querySelector(${q(popup)})&&document.activeElement===document.querySelector('.find-panel input[aria-label="查找内容"]')`, 'Native Find closes file popup and owns focus');
  await key('Escape'); await until(`!document.querySelector('.find-panel')`, 'Find closes after popup handoff');
  pass('Windows native Free Board and file-menu lifecycle: keyboard button activation, closed/open key isolation on selected card, toolbar/native view and Find/Settings handoffs');

  // Restore only through the same visible UI; no store/localStorage test seed.
  await openSettings();
  await clickExpression(labelButton('.modal .tabs', '外观'), 'restore appearance tab');
  await clickExpression(labelButton('.appearance-theme-switch', originalTheme === 'day' ? '日间' : '夜间'), 'restore original theme');
  await escapeModal(); win.setBounds(originalBounds); await pause(1200);
  assert.deepEqual(withoutTimestamp((await snapshot()).project), withoutTimestamp(before), 'UI acceptance restores all project fields and leaves original screenplay/card geometry intact');
  await focusEditorRange();
  return { status: 'passed', assertions, groups, screenshots, scope: 'Chromium key/pointer input and native MenuItem callback -> production IPC; synthetic fixture only' };
};
