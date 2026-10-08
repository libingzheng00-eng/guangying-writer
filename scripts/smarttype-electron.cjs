/**
 * Actual Chromium SmartType regression, exclusively synthetic fixtures and a
 * fresh temporary userData. Launch only through an independent signed QA app.
 * Native Enter/arrows/Tab and the product's menu IPC history route are covered.
 * CDP composition plus an explicit keyCode229 event are simulations, NOT proof
 * of a real macOS Chinese input method. No system clipboard or user app is read.
 */
const { app, ipcMain } = require('electron');
const { createFixtureWindow } = require('./native-fixture-window.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.env.GUANGYING_TEST_ROOT || path.resolve(__dirname, '..');
const renderer = process.env.GUANGYING_TEST_RENDERER || path.join(root, 'dist-renderer/index.html');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-smarttype-'));
app.setPath('userData', path.join(out, 'userData'));
ipcMain.handle('app:recent', () => []);
ipcMain.handle('app:info', () => ({ version: 'isolated-smarttype-qa', platform: process.platform }));

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const selector = '.script-flow [data-id="smart-native-edit"]';
const errors = [];
let win;
let assertions = 0;
const run = js => win.webContents.executeJavaScript(js);
const check = (label, actual, expected = true) => {
  assert.deepEqual(actual, expected, label);
  assertions++;
  console.log('PASS', label);
};
async function until(js, label) {
  for (let i = 0; i < 100; i++) {
    if (await run(js)) return;
    await pause(50);
  }
  throw Error(`Timeout: ${label}`);
}
async function key(keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await pause(120);
}
async function insert(text) {
  await win.webContents.insertText(text);
  await pause(120);
}
async function menu(action) {
  win.webContents.send('menu:action', action);
  await pause(150);
}
const labels = () => run(`Array.from(document.querySelectorAll('.smarttype__item'),n=>n.querySelector('.smarttype__label')?.textContent||'')`);
const current = () => run(`(() => {const n=document.querySelector(${JSON.stringify(selector)});
  const s=getSelection();let caret=-1;
  if(s?.rangeCount&&n.contains(s.anchorNode)){const r=document.createRange();r.selectNodeContents(n);r.setEnd(s.anchorNode,s.anchorOffset);caret=r.toString().length;}
  return {html:n.innerHTML,text:n.textContent,type:n.dataset.type,focus:document.activeElement?.dataset.id,
    count:document.querySelectorAll('.script-flow .sc-el').length,caret};})()`);
const saved = () => run(`JSON.parse(localStorage.getItem('guangying:autosave')).project`);
async function caret(offset = 'end') {
  await run(`(() => {const n=document.querySelector(${JSON.stringify(selector)});n.focus();
    const r=document.createRange();r.selectNodeContents(n);
    if(${JSON.stringify(offset)}==='end')r.collapse(false);
    else {const walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let left=${JSON.stringify(offset)},text;
      while(text=walker.nextNode()){if(left<=text.length){r.setStart(text,left);r.collapse(true);break;}left-=text.length;}}
    const s=getSelection();s.removeAllRanges();s.addRange(r);})()`);
}
async function expectSaved(type, text, count, label) {
  await until(`(() => {const p=JSON.parse(localStorage.getItem('guangying:autosave')).project;
    const e=p.elements.find(e=>e.id==='smart-native-edit');return e.type===${JSON.stringify(type)}&&
      e.text===${JSON.stringify(text)}&&p.elements.length===${count};})()`, label);
  const project = await saved();
  const el = project.elements.find(e => e.id === 'smart-native-edit');
  check(`${label}: autosave text/type/count`, [el.text, el.type, project.elements.length], [text, type, count]);
  check(`${label}: preserved synthetic surrounding names`, project.elements.filter(e => e.id.startsWith('smart-native-name')).map(e => e.text), ['小明', '小明妈妈']);
}
async function fixture(type = 'action', text = '') {
  const project = { id: 'smarttype-native-synthetic', name: '独立合成快捷输入验收', createdAt: 1, updatedAt: 1,
    titlePage: { show: false }, settings: {}, acts: [], sceneMeta: [], boardLinks: [], revisions: [], beats: [],
    elements: [
      { id: 'smart-native-scene', type: 'scene_heading', text: '内景 合成工作室 日' },
      { id: 'smart-native-name-1', type: 'character', text: '小明' },
      { id: 'smart-native-name-2', type: 'character', text: '小明妈妈' },
      { id: 'smart-native-edit', type, text },
      { id: 'smart-native-tail', type: 'action', text: '合成保留段落。' },
    ] };
  win = await createFixtureWindow({ out, renderer, project, previous: win,
    preload: path.join(root, 'electron/preload.js'), onCreated: candidate => {
      candidate.webContents.on('console-message', ({ level, message }) => { if (level === 'error') errors.push(message); });
    },
  });
  await until(`!!document.querySelector('.editor__scroll[data-ready=true]')&&!!document.querySelector(${JSON.stringify(selector)})`, 'candidate fixture ready');
  win.focus();
  await caret();
}
async function capture(name) {
  // DOM assertions do not prove a composited frame was captured. Allow the QA
  // window/font/menu paint to settle without changing product animation timing.
  await pause(450);
  await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG());
}

app.whenReady().then(async () => {
  try {
    await fixture(); await insert('特');
    check('native new action offers a shot candidate', (await labels()).includes('特写'));
    check('native recommendation does not change action type', (await current()).type, 'action');
    check('native candidate exposes 镜头 type badge', await run(`document.querySelector('.smarttype__item')?.textContent.includes('镜头')`));
    await capture('01-shot-candidate');
    await key('Enter');
    let state = await current();
    check('first native Enter completes text/type and stays in same paragraph', [state.text, state.type, state.focus, state.count, state.caret], ['特写', 'shot', 'smart-native-edit', 5, 2]);
    check('accepted native candidate does not reopen on keyup', await labels(), []);
    await expectSaved('shot', '特写', 5, 'native shot confirmation');
    await menu('edit:undo');
    state = await current();
    check('one menu IPC undo restores prefix and original action type', [state.text, state.type, state.focus, state.count], ['特', 'action', 'smart-native-edit', 5]);
    await expectSaved('action', '特', 5, 'native shot undo');
    await menu('edit:redo');
    state = await current();
    check('one menu IPC redo restores completed text and shot type', [state.text, state.type, state.focus, state.count], ['特写', 'shot', 'smart-native-edit', 5]);
    await expectSaved('shot', '特写', 5, 'native shot redo');
    check('history redraw cannot reopen confirmed native candidate', await labels(), []);
    await key('Enter');
    check('second native Enter creates exactly one paragraph', (await current()).count, 6);
    check('second native Enter focuses the new paragraph', (await current()).focus !== 'smart-native-edit');
    await expectSaved('shot', '特写', 6, 'second native Enter');

    await fixture('dialogue'); await insert('小明');
    check('native exact prefix retains exact and longer characters', (await labels()).filter(label => label.startsWith('小明')), ['小明', '小明妈妈']);
    check('native exact prefix is not auto-converted from dialogue', (await current()).type, 'dialogue');
    await key('Down');
    check('native Down highlights longer character name', await run(`document.querySelector('.smarttype__item.is-active .smarttype__label')?.textContent`), '小明妈妈');
    await key('Enter');
    state = await current();
    check('native longer-name acceptance changes only current paragraph', [state.text, state.type, state.focus, state.count], ['小明妈妈', 'character', 'smart-native-edit', 5]);
    await expectSaved('character', '小明妈妈', 5, 'native longer character');
    await key('Enter');
    await expectSaved('character', '小明妈妈', 6, 'native character second Enter');
    const roleProject = await saved();
    const roleIndex = roleProject.elements.findIndex(e => e.id === 'smart-native-edit');
    check('native confirmed character second Enter follows dialogue rhythm', roleProject.elements[roleIndex + 1].type, 'dialogue');

    await fixture('action', '合成光标'); await caret(1);
    for (const reverse of [false, true]) {
      for (let i = 0; i < 11; i++) {
        await key('Tab', reverse ? ['shift'] : []);
        state = await current();
        check(`native ${reverse ? 'Shift+Tab' : 'Tab'} ${i + 1} preserves paragraph, text and middle caret`, [state.focus, state.text, state.caret], ['smart-native-edit', '合成光标', 1]);
      }
    }
    check('eleven forward/reverse native Tabs restore action type', (await current()).type, 'action');

    await fixture();
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: 'te', selectionStart: 2, selectionEnd: 2 });
    await pause(100);
    check('CDP composition suppresses SmartType candidates', await labels(), []);
    check('CDP composition keeps original action type', (await current()).type, 'action');
    await win.webContents.debugger.sendCommand('Input.insertText', { text: '特' });
    await pause(120);
    win.webContents.debugger.detach();
    check('CDP committed character is recommended without automatic type change', [(await current()).text, (await current()).type], ['特', 'action']);
    check('CDP committed character exposes the shot candidate', (await labels()).includes('特写'));
    const postComposition = await run(`(() => {const event=new KeyboardEvent('keydown',{key:'Enter',keyCode:229,which:229,isComposing:false,bubbles:true,cancelable:true});
      document.querySelector(${JSON.stringify(selector)}).dispatchEvent(event);return event.defaultPrevented;})()`);
    check('synthetic post-composition keyCode229 is not accepted as SmartType Enter', postComposition, false);
    state = await current();
    check('post-composition keyCode229 cannot complete or split native fixture', [state.text, state.type, state.count], ['特', 'action', 5]);
    await key('Enter');
    state = await current();
    check('subsequent genuine native Enter confirms committed text once', [state.text, state.type, state.focus, state.count], ['特写', 'shot', 'smart-native-edit', 5]);
    await expectSaved('shot', '特写', 5, 'CDP composition followed by native Enter');
    await capture('02-smarttype-confirmed');
    check('candidate renderer reported no console errors', errors, []);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ assertions, errors,
      covered: ['native keyboard', 'menu IPC history', 'autosave model', 'CDP composition simulation', 'synthetic keyCode229'],
      unverified: ['real macOS input method', 'system clipboard', 'production close protection'],
    }, null, 2));
    console.log(JSON.stringify({ assertions, failures: 0 }));
    console.log('OUTPUT', out);
    win.destroy(); app.exit(0);
  } catch (error) {
    console.error(error); console.log('OUTPUT', out);
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
