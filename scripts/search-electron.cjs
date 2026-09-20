/**
 * Real Chromium find panel, highlight Ranges and scrolling. Synthetic data only.
 * Run with an independent QA app, never with a user's active production instance.
 * Renderer path may be selected via GUANGYING_TEST_RENDERER/GUANGYING_TEST_ROOT.
 * Exercises the production menu IPC handler; this does not test OS menu accelerators.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.GUANGYING_TEST_ROOT || path.resolve(__dirname, '..');
const renderer = process.env.GUANGYING_TEST_RENDERER || path.join(root, 'dist-renderer/index.html');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-search-'));
app.setPath('userData', path.join(out, 'userData'));
ipcMain.handle('app:recent', () => []);
ipcMain.handle('app:info', () => ({ version: 'isolated-search-qa', platform: process.platform }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const run = js => win.webContents.executeJavaScript(js);
async function until(js) {
  for (let i = 0; i < 100; i++) { if (await run(js)) return; await pause(50); }
  throw Error(`Timeout: ${js}`);
}
async function key(keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await pause(100);
}
async function query(text) {
  await run(`(() => { const q=document.querySelector('[aria-label="查找内容"]');q.focus();q.select(); })()`);
  await win.webContents.insertText(text);
  await pause(180);
}
async function click(label) {
  await run(`document.querySelector('.find-panel button[aria-label='+${JSON.stringify(JSON.stringify(label))}+']').click()`);
  await pause(150);
}
const status = () => run(`document.querySelector('.find-panel [role=status]').textContent`);
const current = () => run(`[...CSS.highlights.get('script-find-current')].map(r=>r.toString())`);
app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({ width: 1440, height: 960, show: true, webPreferences: {
      preload: path.join(root, 'electron/preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    } });
    const errors = [];
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadFile(renderer);
    await until(`!!document.querySelector('.script-flow [contenteditable]')`);
    const project = { id: 'search-qa', name: '合成查找测试', createdAt: 1, updatedAt: 1, titlePage: { show: false },
      settings: {}, acts: [], sceneMeta: [], boardLinks: [], revisions: [], beats: [],
      elements: [
        { id: 'search-a', type: 'action', text: '<b>合成</b> Find find FIND' },
        ...Array.from({ length: 50 }, (_, i) => ({ id: `search-filler-${i}`, type: 'action', text: `合成段落 ${i + 1}。只用于滚动验收，不包含用户内容。` })),
        { id: 'search-bottom', type: 'action', text: '&#x1F3AC;底部定位合成' },
        { id: 'search-note', type: 'note', text: '合成备忘' },
      ] };
    await run(`localStorage.setItem('guangying:autosave',${JSON.stringify(JSON.stringify({ project, filePath: null }))})`);
    await run(`localStorage.setItem('guangying:appTheme','day')`);
    await win.loadFile(renderer);
    await until(`!!document.querySelector('.editor__scroll[data-ready=true]')`);
    // parseProject fills defaults on load; settle that initial autosave before
    // measuring whether the following read-only search changes anything.
    await pause(1200);
    win.focus();
    const before = await run(`JSON.stringify([...document.querySelectorAll('.script-flow .sc-el--editable')].map(n=>[n.dataset.id,n.innerHTML]))`);
    const beforeAutosave = await run(`localStorage.getItem('guangying:autosave')`);
    win.webContents.send('menu:action', 'edit:find');
    await until(`document.activeElement?.getAttribute('aria-label')==='查找内容'`);
    await query('find');
    assert.equal(await status(), '1 / 3 处');
    assert.deepEqual(await current(), ['Find']);
    assert.equal(await run(`CSS.highlights.get('script-find').size`), 3);
    await click('下一处'); assert.equal(await status(), '2 / 3 处');
    await key('Enter'); assert.equal(await status(), '3 / 3 处');
    await key('Enter'); assert.equal(await status(), '1 / 3 处');
    await key('Enter', ['shift']); assert.equal(await status(), '3 / 3 处');
    await click('上一处'); assert.equal(await status(), '2 / 3 处');
    await run(`document.querySelector('.find-panel input[type=checkbox]').click()`); await pause(100);
    assert.equal(await status(), '1 / 1 处'); assert.deepEqual(await current(), ['find']);
    console.log('PASS real menu IPC / native query typing / results / next-previous / case sensitivity');
    await query('底部定位');
    assert.equal(await status(), '1 / 1 处'); assert.deepEqual(await current(), ['底部定位']);
    const visible = await run(`(() => {
      const range=[...CSS.highlights.get('script-find-current')][0];
      const rect=range.getBoundingClientRect();const editor=document.querySelector('.editor');const view=editor.getBoundingClientRect();
      return {inside:rect.top>=view.top&&rect.bottom<=view.bottom,scrollTop:editor.scrollTop,range:range.toString()};
    })()`);
    assert.equal(visible.inside, true, JSON.stringify(visible));
    assert.ok(visible.scrollTop > 0, JSON.stringify(visible));
    assert.equal(await run(`document.activeElement.getAttribute('aria-label')`), '查找内容');
    assert.equal(await run(`document.querySelector('.app-shell').dataset.theme`), 'day');
    fs.writeFileSync(path.join(out, 'find-day.png'), (await win.webContents.capturePage()).toPNG());
    console.log('PASS actual Range highlight / numeric entities / long document scroll / query focus');
    await query('不存在的合成关键字');
    assert.equal(await status(), '没有找到匹配内容');
    assert.equal(await run(`document.querySelector('.find-panel button[aria-label="下一处"]').disabled`), true);
    await query('备忘'); assert.equal(await status(), '1 / 1 处'); assert.deepEqual(await current(), ['备忘']);
    await key('Escape'); await until(`!document.querySelector('.find-panel')`);
    assert.equal(await run(`CSS.highlights.size`), 0);
    assert.equal(await run(`document.activeElement.dataset.id`), 'search-note');
    assert.equal(await run(`JSON.stringify([...document.querySelectorAll('.script-flow .sc-el--editable')].map(n=>[n.dataset.id,n.innerHTML]))`), before);
    await pause(1100);
    assert.equal(await run(`localStorage.getItem('guangying:autosave')`), beforeAutosave);
    await run(`localStorage.setItem('guangying:appTheme','night')`);
    await win.loadFile(renderer);
    await until(`!!document.querySelector('.editor__scroll[data-ready=true]')`);
    win.webContents.send('menu:action', 'edit:find');
    await until(`document.activeElement?.getAttribute('aria-label')==='查找内容'`);
    await query('底部定位');
    assert.equal(await run(`document.querySelector('.app-shell').dataset.theme`), 'night');
    assert.deepEqual(await current(), ['底部定位']);
    fs.writeFileSync(path.join(out, 'find-night.png'), (await win.webContents.capturePage()).toPNG());
    assert.equal(await run(`localStorage.getItem('guangying:autosave')`), beforeAutosave);
    assert.deepEqual(errors, []);
    console.log('PASS empty results / notes / native Escape / focus restoration / unchanged content and autosave');
    console.log('OUTPUT', out);
    win.destroy(); app.exit(0);
  } catch (error) {
    console.error(error); console.log('OUTPUT', out);
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
