/** Isolated real-renderer input/IME/autosave regression, using synthetic data only.
 * Load via an independent QA app, never by attaching to the user's application.
 * Input-to-two-frames timings include frame scheduling; not an end-user latency SLA.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.GUANGYING_TEST_ROOT || path.resolve(__dirname, '..');
const renderer = process.env.GUANGYING_TEST_RENDERER || path.join(root, 'dist-renderer/index.html');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-input-'));
app.setPath('userData', path.join(out, 'userData'));
ipcMain.handle('app:recent', () => []);
ipcMain.handle('app:info', () => ({ version: 'isolated-input-qa', platform: process.platform }));
const pause = ms => new Promise(r => setTimeout(r, ms));
let win;
const run = js => win.webContents.executeJavaScript(js);
async function until(js) {
  for (let i = 0; i < 100; i++) { if (await run(js)) return; await pause(60); }
  throw Error(`Timeout: ${js}`);
}
app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({ width: 1440, height: 960, show: true,
      webPreferences: { preload: path.join(root, 'electron/preload.js'), contextIsolation: true,
        nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 3) { errors.push(message); console.error('RENDERER', message); }
    });
    await win.loadFile(renderer);
    await until('!!document.querySelector(".script-flow [contenteditable]")');
    const project = { id: 'input-qa', name: '合成输入测试', createdAt: 1, updatedAt: 1,
      titlePage: { show: false }, settings: {}, acts: [], sceneMeta: [], boardLinks: [], revisions: [],
      elements: Array.from({ length: 300 }, (_, i) => ({ id: `qa-${i}`,
        type: i % 10 === 0 ? 'scene_heading' : 'action', text: i % 10 === 0 ? `内景 合成场景${i} 日` : '合成测试文字。'.repeat(8) })),
      beats: [{ id: 'image-qa', kind: 'image', title: '合成素材', text: '', color: '#fff', x: 850, y: 40,
        img: 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'src/assets/typewriter-pointer.png')).toString('base64') }] };
    await run(`localStorage.setItem('guangying:autosave',${JSON.stringify(JSON.stringify({ project, filePath: null }))});`);
    await win.loadFile(renderer);
    await until('!!document.querySelector(".editor__scroll[data-ready=true]") && !!document.querySelector(".script-flow [data-id=qa-1]")');
    win.show(); win.focus();
    await run(`(() => {
      const el = document.querySelector('.script-flow [data-id=qa-1]');
      el.scrollIntoView({block:'center'}); el.focus();
      const range=document.createRange(); range.selectNodeContents(el); range.collapse(false);
      const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      window.__inputTimings=[];
      el.addEventListener('input', () => {
        const start=performance.now();
        requestAnimationFrame(()=>requestAnimationFrame(()=>window.__inputTimings.push(performance.now()-start)));
      }, {capture:true});
    })()`);
    const before = project.elements[1].text;
    for (let i = 0; i < 30; i++) {
      await win.webContents.insertText('a');
      await until(`window.__inputTimings.length >= ${i + 1}`);
    }
    assert.equal(await run(`document.querySelector('.script-flow [data-id=qa-1]').textContent`), before + 'a'.repeat(30));
    assert.equal(await run('document.activeElement.dataset.id'), 'qa-1');
    console.log('PASS 300段工程连续输入30字，文本完整且焦点不跳转');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 });
    await win.webContents.debugger.sendCommand('Input.insertText', { text: '中文' });
    await pause(100);
    const expected = before + 'a'.repeat(30) + '中文';
    assert.equal(await run(`document.querySelector('.script-flow [data-id=qa-1]').textContent`), expected);
    assert.equal(await run('document.activeElement.dataset.id'), 'qa-1');
    console.log('PASS CDP中文组合输入提交，不残留拼音、不跳出原段落');
    await pause(1200);
    const saved = await run(`JSON.parse(localStorage.getItem('guangying:autosave'))`);
    assert.equal(saved.project.elements.find(e => e.id === 'qa-1').text, expected);
    assert.equal(saved.project.beats[0].img, project.beats[0].img);
    const times = (await run('window.__inputTimings')).slice(5, 30).sort((a, b) => a - b);
    const result = { renderer, measuredInputs: times.length, paragraphs: 300,
      medianInputToTwoFramesMs: times[Math.floor(times.length / 2)],
      maxInputToTwoFramesMs: times.at(-1), errors };
    await win.loadFile(renderer);
    await until('!!document.querySelector(".editor__scroll[data-ready=true]") && !!document.querySelector(".script-flow [data-id=qa-1]")');
    assert.equal(await run(`document.querySelector('.script-flow [data-id=qa-1]').textContent`), expected);
    await until('document.querySelector(".writing-material-card__image")?.naturalWidth > 0');
    assert.equal(await run('document.querySelectorAll(".script-flow [contenteditable]").length'), 300);
    console.log('PASS 自动保存后重载，正文、图片与300段结构完整');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'input.png'), (await win.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    console.log('OUTPUT', out);
    win.destroy(); app.exit(0);
  } catch (error) {
    console.error(error); console.log('OUTPUT', out);
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
