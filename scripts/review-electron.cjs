/** Hidden native review-workspace regression. Synthetic data; no user app/files. */
'use strict';
const { app, ipcMain } = require('electron');
const { createFixtureWindow } = require('./native-fixture-window.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const { renderPdf } = require('../electron/pdf.js');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-review-'));
app.setPath('userData', path.join(out, 'userData'));
let win;
const report = { checks: [], errors: [], outputs: [], scope: 'Real built React/preload, synthetic DOM input, isolated recovery reload and actual PDF; no physical desktop interaction.' };
const q = JSON.stringify;
const run = js => win.webContents.executeJavaScript(js);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pass = name => { report.checks.push(name); console.log('PASS', name); };
async function until(js, label = js) {
  for (let attempt = 0; attempt < 240; attempt++) { if (await (typeof js === 'function' ? js() : run(js))) return; await pause(50); }
  throw new Error('Timeout: ' + label);
}
const model = () => run("JSON.parse(localStorage.getItem('guangying:autosave')).project");
async function click(text, scope = '.revision-workspace') {
  await until(`(() => {const node=Array.from(document.querySelectorAll(${q(scope + ' button')})).find(node=>node.textContent.trim()===${q(text)});if(!node||node.disabled)return false;node.click();return true;})()`);
  await pause(50);
}
async function input(label, value, scope = '') {
  await run(`(() => {const node=document.querySelector(${q(scope)}+' [aria-label='+CSS.escape(${q(label)})+']');if(!node)throw Error('Missing input');node.focus();
    const proto=node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:node instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(node,${q(value)});node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
  await pause(50);
}
async function editSceneField(label, value) {
  // A prohibited/hidden macOS window has no OS focus. Simulate only DOM focus
  // events through React's normal handlers; never focus/show the native window.
  const focusEvidence = await run(`(() => {const node=document.querySelector('.scene-review__list [aria-label='+CSS.escape(${q(label)})+']');const evidence={documentFocused:document.hasFocus(),naturalFocusIn:0,simulatedDOMFocus:false};const observe=e=>{if(e.isTrusted)evidence.naturalFocusIn++};node.addEventListener('focusin',observe);node.focus();node.removeEventListener('focusin',observe);evidence.activeElementMatches=document.activeElement===node;if(!document.hasFocus()){node.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));evidence.simulatedDOMFocus=true;}return evidence;})()`);
  const simulated = focusEvidence.simulatedDOMFocus;
  await input(label, value, '.scene-review__list');
  await run(`(() => {const node=document.querySelector('.scene-review__list [aria-label='+CSS.escape(${q(label)})+']');node.blur();if(${simulated})node.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));})()`);
  (report.sceneFieldFocus ||= []).push({ label, ...focusEvidence, nativeWindowFocused: false });
}
async function open() { await click('改稿', '.toolbar'); await until(`!!document.querySelector('.revision-workspace')`); }
async function close() { await run(`document.querySelector('[aria-label="关闭改稿工作台"]').click()`); await until(`!document.querySelector('.revision-workspace')`); }
async function focusBody(id, start = 0, end = start) {
  await run(`(() => {const node=document.querySelector('.script-flow .sc-el--editable[data-id='+CSS.escape(${q(id)})+']');node.focus();const range=document.createRange();range.setStart(node.firstChild,${start});range.setEnd(node.firstChild,${end});const sel=getSelection();sel.removeAllRanges();sel.addRange(range);})()`);
}
ipcMain.handle('app:recent', () => []);
ipcMain.handle('app:info', () => ({ version: 'review-qa', platform: process.platform }));
ipcMain.handle('file:show', () => null);
ipcMain.handle('pdf:export', async (_event, options) => {
  try {
    const pdf = await renderPdf(win, options);
    const file = path.join(out, options.mode === 'creative' ? 'review-creative.pdf' : 'review-a4.pdf');
    fs.writeFileSync(file, pdf); report.outputs.push(file); return file;
  } catch (error) { report.errors.push(String(error)); throw error; }
});
app.whenReady().then(async () => {
  try {
    const project = { id: 'synthetic-review', name: '合成改稿验收', createdAt: 1, updatedAt: 1, titlePage: { show: false },
      settings: {}, acts: [], revisions: [], beats: [], sceneMeta: [], boardLinks: [], elements: [
        { id: 'scene-a', type: 'scene_heading', text: '内景 合成客厅 日' },
        { id: 'action-a', type: 'action', text: 'OLD_BODY_SECRET' },
        { id: 'character-a', type: 'character', text: '测试人物' },
        { id: 'dialogue-a', type: 'dialogue', text: 'CURRENT_PUBLIC_DIALOGUE' },
        { id: 'scene-empty', type: 'scene_heading', text: '外景 合成空场 夜' },
      ] };
    win = await createFixtureWindow({ out, renderer: path.join(root, 'dist-renderer/index.html'), preload: path.join(root, 'electron/preload.js'), project, theme: 'day' });
    await until(`!!document.querySelector('.editor__scroll[data-ready="true"]')`);
    assert.equal(win.isVisible(), false);
    await focusBody('action-a', 0, 3);
    await open();
    assert.equal(await run(`document.querySelector('.app-body').inert`), true);
    await input('新版本名称', 'PRIVATE_VERSION_NAME'); await click('保存当前版本');
    await until(async () => (await model()).revisionWorkspace?.versions.length === 1);
    pass('Native UI captures a named version; background is inert');
    await click('批注'); await input('新批注', 'PRIVATE_COMMENT_BODY'); await click('添加批注');
    await until(async () => (await model()).annotations?.length === 1);
    const annotation = (await model()).annotations[0];
    assert.equal(annotation.anchor.quote, 'OLD'); assert.equal(annotation.anchor.start, 0); assert.equal(annotation.anchor.end, 3);
    pass('Actual DOM selection is captured before modal focus and saved with UTF-16 offsets');
    await click('暂存'); await input('暂存名称', 'PRIVATE_STASH_NAME'); await input('暂存备注', 'PRIVATE_STASH_NOTE'); await click('复制存入');
    await until(async () => (await model()).revisionWorkspace.stash.length === 1);
    assert.equal((await model()).elements[1].text, 'OLD_BODY_SECRET');
    pass('Explicit stash preserves source and leaves the body unchanged');
    await click('交稿检查');
    assert.ok(await run(`document.querySelector('[aria-label="交稿检查"]').textContent.includes('批注')`));
    await click('忽略此项');
    await until(async () => (await model()).deliveryIgnored?.length === 1);
    pass('Delivery issue ignore is stored without modifying writing');
    await close();
    await focusBody('action-a', 0, 'OLD_BODY_SECRET'.length);
    await win.webContents.insertText('CURRENT_PUBLIC_BODY');
    await until(async () => (await model()).elements[1].text === 'CURRENT_PUBLIC_BODY');
    assert.equal((await model()).annotations[0].anchorState, 'changed');
    await open();
    assert.ok(await run(`document.querySelector('[aria-label="版本管理"]').textContent.includes('修改 1')`));
    await run(`Array.from(document.querySelectorAll('.revision-workspace__paragraph input')).find(node=>node.getAttribute('aria-label').includes('OLD_BODY_SECRET')).click()`);
    await click('取回所选 1 段');
    await until(async () => (await model()).elements.length === 6);
    let current = await model();
    assert.equal(current.elements[1].text, 'CURRENT_PUBLIC_BODY'); assert.equal(current.elements[2].text, 'OLD_BODY_SECRET'); assert.notEqual(current.elements[2].id, 'action-a');
    await click('撤销本次操作'); await until(async () => (await model()).elements.length === 5);
    pass('Scene comparison and paragraph recovery insert a new copy; one undo restores exact body');
    await click('批注'); await click('编辑 / 处理');
    await input('批注处理状态', 'declined'); await input('不采用原因', 'PRIVATE_DECLINE_REASON'); await input('创作决定', 'PRIVATE_DECISION_BODY'); await click('确认批注与决定');
    await until(async () => (await model()).annotations[0].status === 'declined');
    assert.equal((await model()).annotations[0].anchorState, 'changed');
    pass('Changed anchors retain quotes; declined annotation requires reason and records creative decision');
    for (const [width, height, theme] of [[1440, 960, 'day'], [1024, 680, 'night']]) {
      win.setSize(width, height);
      await run(`document.querySelector('.app-shell').dataset.theme=${q(theme)}`);
      await pause(200);
      const contrast = await run(`(() => {const style=getComputedStyle(document.querySelector('.revision-workspace'));const luminance=color=>{const c=color.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];};const a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);})()`);
      assert.ok(contrast >= 4.5, `Workspace ${theme} text contrast: ${contrast}`);
      (report.themeContrast ||= {})[theme] = contrast;
      const bounds = await run(`(() => {const d=document.querySelector('.revision-workspace').getBoundingClientRect();return {left:d.left,right:d.right,top:d.top,bottom:d.bottom,width:innerWidth,height:innerHeight};})()`);
      assert.ok(bounds.left >= 0 && bounds.right <= bounds.width + 1 && bounds.top >= 0 && bounds.bottom <= bounds.height + 1);
      fs.writeFileSync(path.join(out, `review-${width}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    }
    pass('Workspace fits wide and minimum supported window; day/night screenshots captured');
    await close();
    const toolbarBounds = await run(`(() => {const t=document.querySelector('.toolbar');const nodes=[...t.querySelectorAll('button,select')].filter(n=>n.getClientRects().length);return {width:innerWidth,right:Math.max(...nodes.map(n=>n.getBoundingClientRect().right))};})()`);
    assert.ok(toolbarBounds.right <= toolbarBounds.width + 1, JSON.stringify(toolbarBounds));
    const beforeReload = await model();
    win = await createFixtureWindow({ out, renderer: path.join(root, 'dist-renderer/index.html'), preload: path.join(root, 'electron/preload.js'), previous: win, restore: true });
    await until(`!!document.querySelector('.editor__scroll[data-ready="true"]')`);
    assert.deepEqual(await model(), beforeReload);
    await open(); await click('批注');
    assert.ok(await run(`document.querySelector('.revision-workspace').textContent.includes('PRIVATE_DECISION_BODY')`));
    await close();
    pass('Real isolated recovery reload preserves versions, stash, annotations, decision and ignore');
    win.setSize(1440, 960);
    await click('故事板', '.toolbar');
    await input('故事板排列', 'script');
    await editSceneField('第 1 场地点', '合成客厅');
    await editSceneField('第 1 场故事时间', '三天后');
    await input('第 1 场修改状态', 'revising');
    await until(async () => (await model()).sceneMeta.some(item => item.elementId === 'scene-a' && item.location === '合成客厅' && item.storyTime === '三天后' && item.revisionStatus === 'revising'));
    await run(`document.querySelector('[aria-label="下移第 1 场"]').click()`);
    await until(async () => (await model()).elements[0].id === 'scene-empty');
    win.webContents.send('menu:action', 'edit:undo');
    await until(async () => (await model()).elements[0].id === 'scene-a');
    fs.writeFileSync(path.join(out, 'scene-script-order-day.png'), (await win.webContents.capturePage()).toPNG());
    await click('自由板', '.toolbar');
    assert.ok(await run(`document.querySelector('.board').textContent.includes('三天后')`));
    await click('写作', '.toolbar');
    await until(`!!document.querySelector('.editor__scroll[data-ready="true"]')`);
    pass('Actual storyboard scene fields, body-order move/undo and freeboard projection remain linked');
    win.webContents.send('menu:action', 'file:exportPdf');
    await until(() => report.outputs.length === 1 || report.errors.length, 'creative PDF');
    assert.equal(report.errors.length, 0);
    win.webContents.send('menu:action', 'file:exportPrintPdf');
    await until(() => report.outputs.length === 2 || report.errors.length, 'A4 PDF');
    assert.equal(report.errors.length, 0);
    fs.writeFileSync(path.join(out, 'expected-pdf-markers.json'), JSON.stringify({ present: ['CURRENT_PUBLIC_BODY', 'CURRENT_PUBLIC_DIALOGUE'], absent: ['OLD_BODY_SECRET', 'PRIVATE_VERSION_NAME', 'PRIVATE_COMMENT_BODY', 'PRIVATE_STASH_NAME', 'PRIVATE_STASH_NOTE', 'PRIVATE_DECLINE_REASON', 'PRIVATE_DECISION_BODY'] }, null, 2));
    pass('Actual creative and A4 PDF generated for independent text-leak inspection');
    assert.equal(win.isVisible(), false); report.status = 'passed';
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.log('OUTPUT', out); app.exit(0);
  } catch (error) {
    report.status = 'failed'; report.error = error.stack;
    try { report.failureSnapshot = { project: await model(), interface: await run(`({active:document.activeElement?.outerHTML,dialog:document.querySelector('.revision-workspace')?.textContent})`) }; } catch {}
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.error(error); console.log('OUTPUT', out); app.exit(1);
  }
});
