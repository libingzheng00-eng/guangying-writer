/** Isolated Electron board QA. Synthetic fixtures only; never load a user's project. */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = process.env.GUANGYING_TEST_ROOT || path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-board-appearance-'));
app.setPath('userData', path.join(out, 'userData'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const renderer = process.env.GUANGYING_TEST_RENDERER || path.join(root, 'dist-renderer/index.html');
ipcMain.handle('app:recent', () => []);
ipcMain.handle('app:info', () => ({ version: 'board-qa', platform: process.platform }));
let win;
const checks = [];
const run = js => win.webContents.executeJavaScript(js);
const pause = ms => new Promise(r => setTimeout(r, ms));
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log('PASS', name); };
async function until(js) { for(let i=0;i<100;i++) { if(await run(js)) return; await pause(60); } throw Error('Timeout '+js); }
async function click(selector) { await run(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(100); }
async function drag(selector, dx, dy) {
  const p = await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  win.webContents.sendInputEvent({type:'mouseMove',...p});
  win.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});
  for(let i=1;i<=10;i++) { win.webContents.sendInputEvent({type:'mouseMove',x:p.x+Math.round(dx*i/10),y:p.y+Math.round(dy*i/10),button:'left'}); await pause(20); }
  win.webContents.sendInputEvent({type:'mouseUp',x:p.x+dx,y:p.y+dy,button:'left',clickCount:1}); await pause(150);
}
async function screenshot(name) { win.show();win.focus();await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await pause(400);fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG()); }
app.whenReady().then(async()=>{
 try {
  win = new BrowserWindow({width:1500,height:940,show:true,webPreferences:{preload:path.join(root,'electron/preload.js'),nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
  await win.loadFile(renderer); await until('!!document.querySelector(".script-flow [contenteditable]")');
  check('空白首次启动',await run('!document.querySelector(".script-flow [contenteditable]").textContent.trim()'));
  const img='data:image/png;base64,'+fs.readFileSync(path.join(root,'src/assets/typewriter-pointer.png')).toString('base64');
  const project={id:'board-appearance-qa',name:'自由板合成验收',createdAt:1,updatedAt:1,titlePage:{show:false},settings:{},acts:[],revisions:[],boardLinks:[],elements:[{id:'qa-s1',type:'scene_heading',text:'内景 合成摄影棚 日'},{id:'qa-a1',type:'action',text:'仅供测试的合成正文。'},{id:'qa-s2',type:'scene_heading',text:'外景 合成花园 夜'}],sceneMeta:[{id:'qa-m1',elementId:'qa-s1',title:'摄影棚的合成场景',synopsis:'测试场景信息',color:'#cfe4ff',x:40,y:45,w:340,h:190},{id:'qa-m2',elementId:'qa-s2',title:'第二张紫色测试场景',synopsis:'仅供合成验收',color:'#e5d8ff',x:450,y:45,w:340,h:190}],beats:[{id:'qa-image',kind:'image',img,title:'合成参考图',text:'',color:'#fff7d6',x:450,y:320,w:280,h:240},{id:'qa-beat',kind:'beat',text:'合成灵感卡',color:'#fff7d6',x:40,y:320,w:280,h:190}]};
  await run(`localStorage.setItem('guangying:autosave',${JSON.stringify(JSON.stringify({project,filePath:null}))});localStorage.setItem('guangying:appTheme','day')`);
  const openBoard=async()=>{ await win.loadFile(renderer);await until('!!document.querySelector(".script-flow")');await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='自由板').click()`);await until('!!document.querySelector(".bcard--scene")');};
  await openBoard();
  const card='.bcard[data-id="qa-s1"]';
  const geometry=()=>run(`(()=>{const e=document.querySelector('${card}'),n=e.querySelector('.bcard__no').getBoundingClientRect(),t=e.querySelector('.bcard__title').getBoundingClientRect(),r=e.querySelector('.bcard__resize').getBoundingClientRect();return {left:e.style.left,top:e.style.top,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,noY:n.y,titleY:t.y,handleW:r.width,handleH:r.height,bg:getComputedStyle(e).backgroundColor}})()`);
  const before=await geometry();
  check('场号与标题同行',Math.abs(before.noY-before.titleY)<6);
  check('缩放手柄18px',before.handleW===18&&before.handleH===18);
  check('图标操作无文字且图片标签已隐藏',await run(`Array.from(document.querySelectorAll('.bcard__actions button,.bcard__resize')).every(e=>!e.textContent.trim())&&!document.querySelector('.bcard--image .bcard__tag')`));
  check('两种场景色实际底色不同',await run(`getComputedStyle(document.querySelector('${card}')).backgroundColor!==getComputedStyle(document.querySelector('.bcard[data-id="qa-s2"]')).backgroundColor`));
  await screenshot('day');
  await drag(card+' .bcard__title',30,35);
  const moved=await geometry();check('真实鼠标拖动卡片',parseFloat(moved.left)-parseFloat(before.left)===30&&parseFloat(moved.top)-parseFloat(before.top)===35);
  await drag(card+' .bcard__resize',40,30);
  const resized=await geometry();check('真实鼠标缩放卡片',resized.width-moved.width===40&&resized.height-moved.height===30);
  await click(card+' .bcard__connect');await click('.bcard[data-id="qa-s2"] .bcard__connect');
  check('连接按钮建立关系线',await run('document.querySelectorAll(".board-links line").length===1'));
  await run(`document.querySelector('${card} .bcard__scene-notes').focus()`);win.webContents.insertText('合成摘要输入');await pause(200);
  check('摘要真实输入且不移动卡片',await run(`document.querySelector('${card} .bcard__scene-notes').value.includes('合成摘要输入')`) && (await geometry()).left===resized.left);
  await run('window.__qaConfirm=[];window.confirm=(message)=>{window.__qaConfirm.push(message);return false};true');
  await click(card+' .bcard__del-scene');
  check('整场删除确认取消保留卡片和连线',await run(`window.__qaConfirm.length===1&&window.__qaConfirm[0].includes('正文')&&!!document.querySelector('${card}')&&document.querySelectorAll('.board-links line').length===1`));
  await run('window.confirm=()=>true;true');await click(card+' .bcard__del-scene');
  check('确认删除整场并清理连线',await run(`!document.querySelector('${card}')&&!document.querySelector('.board-links line')`));
  win.webContents.send('menu:action','edit:undo');await pause(200);
  check('一次撤销恢复场景及连线',await run(`!!document.querySelector('${card}')&&document.querySelectorAll('.board-links line').length===1`));
  await pause(1300);await win.webContents.executeJavaScript("localStorage.setItem('guangying:appTheme','night')");await openBoard();
  check('夜间场景底色不同',await run(`getComputedStyle(document.querySelector('${card}')).backgroundColor!==getComputedStyle(document.querySelector('.bcard[data-id="qa-s2"]')).backgroundColor`));
  check('保存重开保持缩放和摘要',(await geometry()).width===resized.width&&await run(`document.querySelector('${card} .bcard__scene-notes').value.includes('合成摘要输入')`));
  await screenshot('night');
  await run(`(()=>{const saved=JSON.parse(localStorage.getItem('guangying:autosave'));const m=saved.project.sceneMeta.find(m=>m.elementId==='qa-s1');m.title='这是用于最小尺寸验收的很长很长的合成场景标题';m.w=180;m.h=110;localStorage.setItem('guangying:autosave',JSON.stringify(saved));localStorage.setItem('guangying:appTheme','day');})()`);
  await openBoard();
  const minimum=await run(`(()=>{const c=document.querySelector('${card}'),t=c.querySelector('.bcard__title').getBoundingClientRect(),a=c.querySelector('.bcard__actions').getBoundingClientRect(),n=c.querySelector('textarea').getBoundingClientRect();return {w:c.getBoundingClientRect().width,h:c.getBoundingClientRect().height,titleRight:t.right,actionsLeft:a.left,notesHeight:n.height}})()`);
  check('最小180×110长标题不遮挡操作且保留输入区域',minimum.w===180&&minimum.h===110&&minimum.titleRight<=minimum.actionsLeft&&minimum.notesHeight>=20);
  await run(`document.querySelector('${card} textarea').focus()`);win.webContents.insertText('最小尺寸输入');await pause(150);
  check('最小尺寸仍可编辑摘要',await run(`document.querySelector('${card} textarea').value.includes('最小尺寸输入')`));
  await screenshot('minimum-day');
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({checks,before,resized},null,2));console.log('OUTPUT',out);app.exit(0);
 }catch(e){console.error(e.stack);if(win)await screenshot('failure');console.error('OUTPUT',out);app.exit(1);}
});
