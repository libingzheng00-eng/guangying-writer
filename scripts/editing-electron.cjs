/** Real Chromium editor/history regression, synthetic project in isolated userData.
 * Run only through an independent QA application, NOT a user's running application.
 * Native Enter, IME and menu IPC are exercised. Cut/copy/paste ClipboardEvents
 * carry an in-memory DataTransfer: this script never reads/writes the system clipboard.
 * Thus it does not claim to test external-application clipboard integration.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.GUANGYING_TEST_ROOT || path.resolve(__dirname, '..');
const renderer = process.env.GUANGYING_TEST_RENDERER || path.join(root, 'dist-renderer/index.html');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-editing-'));
app.setPath('userData', path.join(out, 'userData'));
ipcMain.handle('app:recent', () => []);
ipcMain.handle('app:info', () => ({ version: 'isolated-editing-qa', platform: process.platform }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const run = js => win.webContents.executeJavaScript(js);
async function until(js) {
  for (let i = 0; i < 100; i++) { if (await run(js)) return; await pause(50); }
  throw Error(`Timeout: ${js}`);
}
const q = `.script-flow [data-id="editing-a"]`;
const values = () => run(`[...document.querySelectorAll('.script-flow .sc-el')].map(e=>e.innerHTML)`);
async function select(start, end = start, endId = 'editing-a') {
  await run(`(() => { const el=document.querySelector(${JSON.stringify(q)}); el.focus();
    const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const nodes=[];let n;while(n=walk.nextNode())nodes.push(n);
    const point=offset=>{for(const n of nodes){if(offset<=n.length)return[n,offset];offset-=n.length;}return[el,el.childNodes.length];};
    const r=document.createRange();r.setStart(...point(${start}));
    if(${JSON.stringify(endId)}==='editing-a')r.setEnd(...point(${end}));
    else r.setEnd(document.querySelector('.script-flow [data-id='+${JSON.stringify(endId)}+']').firstChild,${end});
    const s=getSelection();s.removeAllRanges();s.addRange(r); })()`);
}
async function clipboardEvent(type, text = '') {
  return run(`(() => { const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(text)});
    const event=new ClipboardEvent(${JSON.stringify(type)},{bubbles:true,cancelable:true,clipboardData:data});
    document.querySelector(${JSON.stringify(q)}).dispatchEvent(event);
    return {prevented:event.defaultPrevented,text:data.getData('text/plain')}; })()`);
}
async function key(keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await pause(120);
}
async function menu(action) { win.webContents.send('menu:action', action); await pause(150); }
async function expectModelAndDOM(expected, label) {
  assert.deepEqual(await values(), expected, `${label}: visible DOM`);
  await pause(1100);
  assert.deepEqual(await run(`JSON.parse(localStorage.getItem('guangying:autosave')).project.elements.map(e=>e.text)`), expected, `${label}: autosave model`);
  console.log('PASS', label);
}
app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({ width: 1440, height: 960, show: true, webPreferences: {
      preload: path.join(root, 'electron/preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    } });
    const errors = [];
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadFile(renderer);
    await until(`!!document.querySelector('.script-flow [contenteditable]')`);
    const project = { id: 'editing-qa', name: '合成编辑测试', createdAt: 1, updatedAt: 1, titlePage: { show: false },
      settings: {}, acts: [], sceneMeta: [], boardLinks: [], revisions: [], beats: [],
      elements: [{ id: 'editing-a', type: 'action', text: '前半段后半段' }, { id: 'editing-b', type: 'action', text: '保留段落' }] };
    async function fixture(text) {
      project.elements[0].text = text;
      await run(`localStorage.setItem('guangying:autosave',${JSON.stringify(JSON.stringify({ project, filePath: null }))})`);
      await win.loadFile(renderer);
      await until(`!!document.querySelector('.editor__scroll[data-ready=true]') && !!document.querySelector(${JSON.stringify(q)})`);
      win.focus();
    }
    await fixture('前半段后半段');
    await select(3); await key('Enter');
    await expectModelAndDOM(['前半段', '后半段', '保留段落'], 'native Enter moves suffix without duplication');
    assert.notEqual(await run('document.activeElement.dataset.id'), 'editing-a');
    await menu('edit:undo');
    await expectModelAndDOM(['前半段后半段', '保留段落'], 'menu undo restores one complete paragraph');
    await menu('edit:redo');
    await expectModelAndDOM(['前半段', '后半段', '保留段落'], 'menu redo restores exact split');

    await fixture('前半段后半段'); await select(3, 6);
    assert.deepEqual(await clipboardEvent('copy'), { prevented: true, text: '后半段' });
    assert.deepEqual(await clipboardEvent('cut'), { prevented: true, text: '后半段' });
    await expectModelAndDOM(['前半段', '保留段落'], 'cut handler updates model and visible text');
    await menu('edit:undo');
    await expectModelAndDOM(['前半段后半段', '保留段落'], 'focused cut undo restores visible text');
    await menu('edit:redo');
    await expectModelAndDOM(['前半段', '保留段落'], 'focused cut redo restores visible text');

    await fixture('甲乙'); await select(1);
    await clipboardEvent('paste', '合成\n粘贴');
    await expectModelAndDOM(['甲合成<br>粘贴乙', '保留段落'], 'paste handler inserts multiline text at caret');
    await menu('edit:undo');
    await expectModelAndDOM(['甲乙', '保留段落'], 'paste undo updates focused DOM');
    await menu('edit:redo');
    await expectModelAndDOM(['甲合成<br>粘贴乙', '保留段落'], 'paste redo updates focused DOM');

    await fixture('首段余文'); await select(2, 2, 'editing-b');
    assert.deepEqual(await clipboardEvent('cut'), { prevented: true, text: '余文\n保留' });
    await expectModelAndDOM(['首段段落'], 'cross-paragraph cut joins boundaries');
    await menu('edit:undo');
    await expectModelAndDOM(['首段余文', '保留段落'], 'cross-paragraph undo restores both paragraphs');
    await select(2, 2, 'editing-b'); await clipboardEvent('paste', '<合成>&');
    await expectModelAndDOM(['首段&lt;合成&gt;&amp;段落'], 'cross-paragraph paste keeps literal angle brackets');
    await menu('edit:undo');
    await expectModelAndDOM(['首段余文', '保留段落'], 'cross-paragraph paste undo restores document');
    await select(2, 2, 'editing-b'); await key('Enter');
    await expectModelAndDOM(['首段', '段落'], 'native Enter replaces selected cross-paragraph content');
    await menu('edit:undo');
    await expectModelAndDOM(['首段余文', '保留段落'], 'selected Enter undo restores both paragraphs');

    await fixture('甲'); await select(1); await win.webContents.insertText('输入');
    await clipboardEvent('paste', '<合成>&');
    await win.webContents.insertText('后续');
    await expectModelAndDOM(['甲输入&lt;合成&gt;&amp;后续', '保留段落'], 'native typing / paste / typing preserves content');
    await menu('edit:undo'); await expectModelAndDOM(['甲输入&lt;合成&gt;&amp;', '保留段落'], 'first undo removes only post-paste typing');
    await menu('edit:undo'); await expectModelAndDOM(['甲输入', '保留段落'], 'second undo removes only paste');
    await menu('edit:undo'); await expectModelAndDOM(['甲', '保留段落'], 'third undo removes only original typing');

    const entityHTML = '&amp;lt;&amp;#65; &#x1F3AC;<br>&lt;合成&gt;';
    const entityText = '&lt;&#65; 🎬\n<合成>';
    await fixture(entityHTML);
    await pause(1100);
    const entityBeforeDOM = await values();
    const entityBeforeSave = await run(`localStorage.getItem('guangying:autosave')`);
    await run(`(() => {const el=document.querySelector(${JSON.stringify(q)});el.focus();const r=document.createRange();
      r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);})()`);
    assert.deepEqual(await clipboardEvent('copy'), { prevented: true, text: entityText });
    assert.deepEqual(await values(), entityBeforeDOM, 'entity copy leaves visible DOM unchanged');
    await pause(1100);
    assert.equal(await run(`localStorage.getItem('guangying:autosave')`), entityBeforeSave, 'entity copy does not alter autosave');
    assert.deepEqual(await clipboardEvent('cut'), { prevented: true, text: entityText });
    await expectModelAndDOM(['', '保留段落'], 'entity cut retains literal entities, numeric emoji and BR in clipboard');
    await menu('edit:undo'); await pause(1100);
    assert.deepEqual(await values(), entityBeforeDOM, 'entity cut undo restores canonical browser markup');
    assert.equal(await run(`JSON.parse(localStorage.getItem('guangying:autosave')).project.elements[0].text`), entityHTML, 'entity cut undo restores serialized HTML');
    await run(`(() => {const el=document.querySelector(${JSON.stringify(q)});el.focus();const r=document.createRange();
      r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);})()`);
    assert.deepEqual(await clipboardEvent('copy'), { prevented: true, text: entityText });
    await menu('edit:redo'); await expectModelAndDOM(['', '保留段落'], 'copy after entity undo does not clear redo');

    await fixture('<b>甲乙</b><br><i>丙丁</i>戊');
    await run(`(() => { const el=document.querySelector(${JSON.stringify(q)});el.focus();const r=document.createRange();
      r.setStart(el,2);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r); })()`);
    await key('Enter');
    await expectModelAndDOM(['<b>甲乙</b><br>', '<i>丙丁</i>戊', '保留段落'], 'native Enter at BR boundary respects nested markup');
    await menu('edit:undo');
    await expectModelAndDOM(['<b>甲乙</b><br><i>丙丁</i>戊', '保留段落'], 'rich-text split undo restores formatting');
    await fixture('连续输入'); await select(4);
    await win.webContents.insertText('合成');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 });
    await win.webContents.debugger.sendCommand('Input.insertText', { text: '中文' });
    await expectModelAndDOM(['连续输入合成中文', '保留段落'], 'normal typing and IME stay intact');
    assert.equal(await run('document.activeElement.dataset.id'), 'editing-a');
    win.webContents.debugger.detach();
    for (let i = 0; i < 11; i++) {
      await key('Tab');
      assert.equal(await run('document.activeElement.dataset.id'), 'editing-a', `Tab ${i + 1} focus`);
    }
    for (let i = 0; i < 11; i++) {
      await key('Tab', ['shift']);
      assert.equal(await run('document.activeElement.dataset.id'), 'editing-a', `Shift+Tab ${i + 1} focus`);
    }
    assert.equal(await run(`document.querySelector(${JSON.stringify(q)}).dataset.type`), 'action');
    console.log('PASS 11 Tab + 11 Shift+Tab preserve focus and text');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'editing.png'), (await win.webContents.capturePage()).toPNG());
    console.log('OUTPUT', out);
    win.destroy(); app.exit(0);
  } catch (error) {
    console.error(error); console.log('OUTPUT', out);
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
