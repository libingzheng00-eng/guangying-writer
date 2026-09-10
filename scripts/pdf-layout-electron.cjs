/** 真实导出回归：合成七场剧本，第五场旁放参考图和声音卡。全程独立用户目录。 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = process.env.GUANGYING_TEST_ROOT || path.resolve(__dirname, '..');
const { renderPdf } = require(path.join(root, 'electron/pdf.js'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-pdf-layout-'));
app.setPath('userData', path.join(out, 'userData'));
const renderer = process.env.GUANGYING_TEST_RENDERER || path.join(root, 'dist-renderer/index.html');
let win, lastOptions, exporting = false;
const outputs = [];
const errors = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
const run = js => win.webContents.executeJavaScript(js);
async function until(js) {
  for (let i=0;i<160;i++) { if (await run(js)) return; await pause(50); }
  throw new Error(`Timeout: ${js}`);
}
ipcMain.handle('app:recent', () => []);
ipcMain.handle('app:info', () => ({ version: 'test', platform: process.platform }));
ipcMain.handle('file:show', () => null);
ipcMain.handle('pdf:export', async (_event, opts) => {
  exporting = true;
  lastOptions = opts;
  try {
    const data = await renderPdf(win, opts);
    const file = path.join(out, opts.mode === 'creative' ? 'creative.pdf' : outputs.length < 2 ? 'print-a4.pdf' : outputs.length < 3 ? 'long-a4.pdf' : 'dual-a4.pdf');
    fs.writeFileSync(file, data);
    outputs.push(file);
    return file;
  } catch(e) { errors.push(String(e)); throw e; }
  finally { exporting = false; }
});
const geometry = `(() => {
  const canvas=document.querySelector('.editor__scroll'), origin=canvas.getBoundingClientRect();
  const read=el=>{const r=el.getBoundingClientRect();return {x:r.x-origin.x,y:r.y-origin.y,width:r.width,height:r.height};};
  return {scene:read(document.querySelector('.script-flow [data-id="scene-5"]')), image:read(document.querySelector('.writing-material-card--image')), sound:read(document.querySelector('.writing-material-card:not(.writing-material-card--image)'))};
})()`;
app.whenReady().then(async () => {
  let proof;
  try {
    win = new BrowserWindow({width:1440,height:960,show:true,webPreferences:{preload:path.join(root,'electron/preload.js'),nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
    await win.loadFile(renderer);
    await until('!!document.querySelector(".editor__scroll[data-ready=true]")');
    const image = 'data:image/png;base64,' + fs.readFileSync(path.join(root,'src/assets/typewriter-pointer.png')).toString('base64');
    const project = { id:'pdf-qa',name:'图文位置验收',createdAt:1,updatedAt:1,titlePage:{show:false},sceneMeta:[],boardLinks:[],acts:[],revisions:[],settings:{paper:'letter'},elements:[],beats:[
      {id:'qa-image',kind:'image',title:'第五场视角参考',text:'参考图应与第五场并列，不能出现在文末。',img:image,color:'#fff',x:860,y:100},
      {id:'qa-sound',kind:'sound',title:'第五场声音',text:'远处传来钟声。',color:'#fff',x:16,y:100},
    ]};
    for(let i=1;i<=7;i++) {
      project.elements.push({id:`scene-${i}`,type:'scene_heading',text:`内景 第${i}场测试地点 日`});
      project.elements.push({id:`action-${i}`,type:'action',text:`第${i}场正文。镜头越过窗边，停在桌面上。这里仅使用合成的测试文字。`.repeat(5)});
    }
    const loadProject = async () => {
      await run(`localStorage.setItem('guangying:autosave',${JSON.stringify(JSON.stringify({project,filePath:null}))});localStorage.setItem('guangying:appTheme','day');`);
      await win.loadFile(renderer);
      await until('!!document.querySelector(".editor__scroll[data-ready=true]") && !!document.querySelector("[data-id=scene-5]")');
    };
    await loadProject();
    const fifth = await run(`(() => {const root=document.querySelector('.editor__scroll').getBoundingClientRect(); const s=document.querySelector('.script-flow [data-id="scene-5"]').getBoundingClientRect();return s.top-root.top;})()`);
    project.beats[0].y=fifth+20;
    project.beats[1].y=fifth+60;
    await loadProject();
    await run(`document.querySelector('.script-flow [data-id="scene-5"]').scrollIntoView({block:'center'});`);
    await pause(200);
    const before=await run(geometry);
    // 等待首次加载的兼容字段标准化写入完成，再建立不变性基线。
    await pause(1200);
    const savedBefore = await run("localStorage.getItem('guangying:autosave')");
    win.show();win.focus();
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    fs.writeFileSync(path.join(out,'before.png'),(await win.webContents.capturePage()).toPNG());
    win.webContents.send('menu:action','file:exportPdf');
    for(let i=0;i<400 && outputs.length<1 && !errors.length;i++) await pause(50);
    assert.equal(outputs.length,1,errors.join('\n') || '创作版导出失败');
    assert.equal(lastOptions.mode,'creative');
    proof = new BrowserWindow({width:1440,height:960,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    await proof.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(lastOptions.html));
    const after=await proof.webContents.executeJavaScript(geometry);
    for(const item of ['scene','image','sound']) for(const key of ['x','y','width','height']) {
      assert.ok(Math.abs(before[item][key]-after[item][key])<1,`${item}.${key}: ${before[item][key]} -> ${after[item][key]}`);
    }
    console.log('PASS 第五场正文/参考图/声音卡的坐标与尺寸保持一致（误差小于1px）');
    assert.ok(!lastOptions.html.includes('创作素材附页'));
    console.log('PASS 创作版没有文末素材附页');
    // 纯文本从Letter工程发起，仍应走A4。
    win.webContents.send('menu:action','file:exportPrintPdf');
    for(let i=0;i<400 && outputs.length<2 && !errors.length;i++) await pause(50);
    assert.equal(outputs.length,2,errors.join('\n') || 'A4版导出失败');
    assert.equal(lastOptions.mode,'print');
    assert.deepEqual(lastOptions.pageSize,{width:210000,height:297000});
    await until('!!document.querySelector(".editor__scroll[data-ready=true]")');
    const afterExport=await run(geometry);
    assert.deepEqual(afterExport,before);
    assert.equal(await run("localStorage.getItem('guangying:autosave')"), savedBefore, '导出不能改写工程');
    console.log('PASS 两种导出均不改变原写作排版/卡片位置');
    fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify({before,after,outputs},null,2));
    // 长对白与长动作使用唯一逐行标记，供实际 PDF 全文提取核对，无真实剧本内容。
    const markers = Array.from({length:150}, (_,i)=>`DIALOGUE_${String(i+1).padStart(3,'0')}`);
    const actionMarkers = Array.from({length:100}, (_,i)=>`ACTION_${String(i+1).padStart(3,'0')}`);
    project.beats = [];
    project.elements = [
      {id:'scene-5',type:'scene_heading',text:'内景 长页合成测试 日'},
      {id:'long-character',type:'character',text:'测试角色'},
      {id:'long-dialogue',type:'dialogue',text:markers.join('<br>')},
      {id:'long-action',type:'action',text:actionMarkers.join('<br>')},
    ];
    await loadProject();
    win.webContents.send('menu:action','file:exportPrintPdf');
    for(let i=0;i<400 && outputs.length<3 && !errors.length;i++) await pause(50);
    assert.equal(outputs.length,3,errors.join('\n') || '长对白A4导出失败');
    fs.writeFileSync(path.join(out,'expected-lines.json'),JSON.stringify([...markers,...actionMarkers]));
    console.log('PASS 长对白/长动作实际PDF已生成，需提取逐行标记核对250行完整性');
    const leftMarkers=Array.from({length:80},(_,i)=>`LEFT_${String(i+1).padStart(3,'0')}`);
    const rightMarkers=Array.from({length:90},(_,i)=>`RIGHT_${String(i+1).padStart(3,'0')}`);
    project.elements=[
      {id:'scene-5',type:'scene_heading',text:'内景 双列合成测试 日'},
      {id:'left-character',type:'character',text:'左侧角色',dual:'left',dualGroup:'qa-dual'},
      {id:'left-dialogue',type:'dialogue',text:leftMarkers.join('<br>'),dual:'left',dualGroup:'qa-dual'},
      {id:'right-character',type:'character',text:'右侧角色',dual:'right',dualGroup:'qa-dual'},
      {id:'right-dialogue',type:'dialogue',text:rightMarkers.join('<br>'),dual:'right',dualGroup:'qa-dual'},
    ];
    await loadProject();
    win.webContents.send('menu:action','file:exportPrintPdf');
    for(let i=0;i<400 && outputs.length<4 && !errors.length;i++) await pause(50);
    assert.equal(outputs.length,4,errors.join('\n') || '双列A4导出失败');
    fs.writeFileSync(path.join(out,'expected-dual-lines.json'),JSON.stringify([...leftMarkers,...rightMarkers]));
    console.log('PASS 长双列实际PDF已生成，需提取逐行标记核对170行完整性');
    console.log(`RESULT ${out}`);
    proof.destroy();app.exit(0);
  } catch(e) {
    console.error(e);
    console.log(`RESULT ${out}`);
    if(proof) proof.destroy();app.exit(1);
  }
});
