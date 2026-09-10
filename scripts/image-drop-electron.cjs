/**
 * 本地图片拖入回归：运行真实 Electron 构建，CDP 向正文/空白画布投递真实本地文件。
 * 可用独立测试 app 运行本脚本；不连接现用窗口、不读取用户工程。
 * GUANGYING_TEST_ROOT 指向源码根，GUANGYING_TEST_RENDERER 可指定待验收安装包的 index.html。
 * 结果和截图保留在输出的临时目录。CDP 不能代替 Finder 手工拖动的系统层验收。
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.GUANGYING_TEST_ROOT || path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-drop-result-'));
app.setPath('userData', path.join(out, 'userData'));
const renderer = process.env.GUANGYING_TEST_RENDERER || path.join(root, 'dist-renderer/index.html');
const photo = path.join(out, 'drag-test.png');
const second = path.join(out, 'second-photo.png');
const broken = path.join(out, 'broken.png');
fs.copyFileSync(path.join(root, 'src/assets/typewriter-pointer.png'), photo);
fs.copyFileSync(photo, second);
fs.writeFileSync(broken, 'invalid image fixture');
let saved = null;
let exported = null;
ipcMain.handle('pdf:export', (_event, opts) => { exported = opts; return null; });
ipcMain.handle('app:recent', () => []);
ipcMain.handle('app:info', () => ({ version: 'image-drop-test', platform: process.platform }));
ipcMain.handle('dialog:save', (_event, payload) => {
  saved = payload.content;
  return path.join(out, 'synthetic.zhsp');
});
ipcMain.handle('dialog:open', () => ({ path: path.join(out, 'synthetic.zhsp'), content: saved }));
const checks = [];
let win;
const run = (expression) => win.webContents.executeJavaScript(expression);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(expression) {
  for (let i = 0; i < 80; i++) {
    if (await run(expression)) return;
    await pause(100);
  }
  throw new Error(`Timed out: ${expression}`);
}
function check(name, value) {
  assert.ok(value, name);
  checks.push(name);
  console.log(`PASS ${name}`);
}
const count = () => run('document.querySelectorAll(".writing-material-card--image").length');
async function drop(files, x, y) {
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await win.webContents.debugger.sendCommand('Input.dispatchDragEvent', { type, x, y, data });
  }
}
async function screenshot(name) {
  win.show();
  win.focus();
  await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await pause(200);
  fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
}
app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({ width: 1440, height: 960, show: true,
      webPreferences: { preload: path.join(root, 'electron/preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    await win.loadFile(renderer);
    await until('!!document.querySelector(".script-flow [contenteditable]")');
    win.webContents.debugger.attach('1.3');
    check('独立用户目录首次启动为空白正文', await run(`!document.querySelector('.script-flow [contenteditable]').textContent.trim()`));
    await run(`document.querySelector('.script-flow [contenteditable]').focus()`);
    const originalId = await run(`document.activeElement.closest('[data-id]').dataset.id`);
    const cycle = ['action','character','parenthetical','dialogue','transition','shot','scene_heading','general','note'];
    const startIndex = cycle.indexOf(await run(`document.activeElement.closest('[data-type]').dataset.type`));
    assert.ok(startIndex >= 0);
    const tab = async (shift, index) => {
      const modifiers = shift ? ['shift'] : [];
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers});
      win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers});
      await pause(45);
      const focus = await run(`(() => {const e=document.activeElement;return {editable:e.isContentEditable,id:e.closest('[data-id]')?.dataset.id,type:e.closest('[data-type]')?.dataset.type};})()`);
      assert.deepEqual(focus,{editable:true,id:originalId,type:cycle[index]},'真实Tab不能跳出原段落');
    };
    for(let i=1;i<=11;i++) await tab(false,(startIndex+i)%9);
    for(let i=1;i<=11;i++) await tab(true,(startIndex+11-i)%9);
    check('真实 Electron 连按11次Tab再反向11次，焦点始终留在原正文', true);
    const bodyBefore = await run('document.querySelector(".script-flow").innerHTML');
    const target = await run(`(() => { const b = document.querySelector('.script-flow [contenteditable]').getBoundingClientRect(); return {x: b.x + 80, y: b.y + b.height / 2}; })()`);
    await drop([photo], target.x, target.y);
    await until('document.querySelector(".writing-material-card__image")?.naturalWidth > 0');
    check('本地 PNG 落在正文上生成一张已解码图片卡', await count() === 1);
    check('图片没有插入或替换正文', await run('document.querySelector(".script-flow").innerHTML') === bodyBefore);
    await run(`document.querySelector('button[title="撤销 ⌘Z"]').click()`);
    await until('document.querySelectorAll(".writing-material-card--image").length === 0');
    check('一次撤销整张新图片卡，不残留空卡', await count() === 0);
    await run(`document.querySelector('button[title="重做 ⇧⌘Z"]').click()`);
    await until('document.querySelector(".writing-material-card__image")?.naturalWidth > 0');
    await run(`document.querySelector('button[aria-label="显示或隐藏声音卡"]').click()`);
    check('关闭声音仍能看见图片', await run(`(() => { const e=document.querySelector('.writing-material-card--image'); return !!e && getComputedStyle(e).visibility === 'visible' && getComputedStyle(e.parentElement).opacity === '1'; })()`));
    // 滚动容器/内层坐标必须用真实 layout 验证。临时增加空白高度，不改工程正文。
    await run(`document.querySelector('.editor__scroll').style.minHeight='2400px'; document.querySelector('.editor').scrollTop=700;`);
    await pause(150);
    const edge = await run(`(() => { const b=document.querySelector('.editor').getBoundingClientRect(); return {x:b.right-25, y:b.top+260, right:b.right}; })()`);
    await drop([second], edge.x, edge.y);
    await until('document.querySelectorAll(".writing-material-card--image").length === 2');
    check('关闭声音后仍能拖入第二张图片', await count() === 2);
    check('滚动后的右侧落点保持在可见范围内', await run(`(() => { const all=[...document.querySelectorAll('.writing-material-card--image')]; const r=all[1].getBoundingClientRect(); return r.right <= ${edge.right} && r.top >= ${edge.y}-40 && r.top <= ${edge.y}+10; })()`));
    await screenshot('image-drop-night.png');
    await drop([broken], edge.x - 350, edge.y);
    await until('document.body.innerText.includes("无法读取图片")');
    check('损坏图片报错且不创建空卡', await count() === 2);
    await drop([photo, second], edge.x - 350, edge.y + 150);
    await until('document.querySelectorAll(".writing-material-card--image").length === 4');
    check('一次拖入两张图片均被接收', await count() === 4);
    // 无 MIME 的有效 PNG：浏览器 File 构造器模拟边界，仍走挂载的 React drop 处理器。
    await run(`(() => { const src=document.querySelector('.writing-material-card__image').src; const bytes=Uint8Array.from(atob(src.split(',')[1]), c=>c.charCodeAt(0)); const dt=new DataTransfer(); dt.items.add(new File([bytes], 'no-mime.PNG')); document.querySelector('.editor__scroll').dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:dt,clientX:700,clientY:400})); })()`);
    await until('document.querySelectorAll(".writing-material-card--image").length === 5');
    check('有效 PNG 缺少 MIME 仍能拖入', await count() === 5);
    win.webContents.send('menu:action', 'file:save');
    for (let i=0; !saved && i<30; i++) await pause(100);
    const project=JSON.parse(saved).project;
    check('保存内容含五张完整图片且正文仍空白', project.beats.length === 5 && project.beats.every(b=>b.kind==='image' && b.img.startsWith('data:')) && project.elements.every(e=>!e.text));
    win.webContents.send('menu:action', 'file:open');
    await pause(300);
    check('保存后重新打开保留图片', await count() === 5);
    await run(`localStorage.setItem('guangying:appTheme','day')`);
    await pause(1000);
    await win.loadFile(renderer);
    await until('document.querySelectorAll(".writing-material-card--image").length === 5');
    await run(`document.querySelector('.editor__scroll').style.minHeight='2400px'; document.querySelector('.editor').scrollTop=700;`);
    await pause(200);
    await screenshot('image-drop-day.png');
    check('重启后自动保存仍恢复五张图片', await count() === 5);
    win.webContents.send('menu:action', 'file:exportPdf');
    for (let i=0; !exported && i<160; i++) await pause(50);
    check('创作版按原位保留五张图片（包括无 MIME 图片）', !!exported && (exported.html.match(/<img /g) || []).length === 5 && (exported.html.match(/src="data:/g) || []).length === 5);
    await run(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='预览').click()`);
    await until('!!document.querySelector(".preview[data-ready=true]")');
    check('A4 纯文本预览不混入图片附页', await run('document.querySelectorAll(".preview__material-page").length') === 0);
    await screenshot('image-drop-preview.png');
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({checks, renderer}, null, 2));
    console.log(`RESULT ${out}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (win) await screenshot('failure.png').catch(()=>{});
    console.log(`RESULT ${out}`);
    app.exit(1);
  }
});
