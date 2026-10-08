/** QA-only entry copied into a temporary package by windows-smoke.cjs. */
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const config = JSON.parse(fs.readFileSync(process.env.GUANGYING_WINDOWS_SMOKE_CONFIG, 'utf8'));
const phase = process.env.GUANGYING_WINDOWS_SMOKE_PHASE;
assert.ok(['first-launch', 'recovery'].includes(phase));
assert.equal(process.platform, config.expectedPlatform);
const root = app.getAppPath();
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name, 'guangying-native-acceptance-qa');
const tempRelative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(config.temporary));
assert.ok(tempRelative && tempRelative !== '..' && !tempRelative.startsWith('..' + path.sep) && !path.isAbsolute(tempRelative));
assert.equal(path.dirname(config.userData), config.temporary);
fs.mkdirSync(config.userData, { recursive: true });
app.setPath('userData', config.userData);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const report = { status: 'running', phase, platform: process.platform, electron: process.versions.electron, checks: [], dialogs: [], errors: [] };
const journal = () => fs.writeFileSync(path.join(config.output, `${phase}.json`), JSON.stringify(report, null, 2));
const pass = name => { report.checks.push(name); journal(); console.log('PASS', name); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const run = js => win.webContents.executeJavaScript(js);
async function until(condition, label, timeout = 12000) {
  const stop = Date.now() + timeout;
  while (Date.now() < stop) {
    if (await (typeof condition === 'string' ? run(condition) : condition())) return;
    await pause(60);
  }
  throw new Error(`Timeout: ${label}`);
}
const saveChoices = [];
const openChoices = [];
const closeChoices = [];
dialog.showSaveDialog = async (_window, options) => {
  assert.ok(saveChoices.length, 'Unexpected save/export dialog');
  const choice = saveChoices.shift();
  assert.ok(options.filters.some(filter => filter.extensions.includes(choice.extension)), 'Incorrect dialog extension');
  report.dialogs.push({ kind: 'save', extension: choice.extension, stubbed: true, canceled: !!choice.canceled });
  return choice.canceled ? { canceled: true } : { canceled: false, filePath: choice.path };
};
dialog.showOpenDialog = async (_window, options) => {
  assert.ok(openChoices.length, 'Unexpected open dialog');
  assert.ok(options.properties.includes('openFile'));
  const choice = openChoices.shift();
  report.dialogs.push({ kind: 'open', stubbed: true, canceled: !!choice.canceled });
  return choice.canceled ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [choice.path] };
};
dialog.showMessageBoxSync = (_window, options) => {
  assert.equal(options.title, '关闭前确认保存', 'Only the real production close guard may ask this dialog');
  assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
  assert.deepEqual(options.buttons, ['继续写作', '仍然离开']);
  assert.ok(closeChoices.length, 'Unexpected close prompt (e.g. save never completed)');
  const choice = closeChoices.shift();
  report.dialogs.push({ kind: 'close', defaultId: options.defaultId, cancelId: options.cancelId, choice, stubbed: true });
  return choice;
};
dialog.showErrorBox = (title, message) => { report.errors.push({ title, message }); journal(); };
// Prevent Explorer windows from taking focus. Export IPC itself remains real.
shell.showItemInFolder = file => { assert.ok(file.startsWith(config.temporary + path.sep)); };
const actionSelector = '.script-flow [data-id="windows-action"]';
const text = () => run(`document.querySelector(${JSON.stringify(actionSelector)}).textContent`);
async function focusEnd() {
  win.show(); win.focus();
  await run(`(() => { const e=document.querySelector(${JSON.stringify(actionSelector)});e.scrollIntoView({block:'center'});e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r); })()`);
}
async function key(keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await pause(160);
}
function menu(label) {
  const search = items => { for (const item of items) { if (item.label === label) return item; if (item.submenu) { const found = search(item.submenu.items); if (found) return found; } } };
  const item = search(Menu.getApplicationMenu().items);
  assert.ok(item && typeof item.click === 'function', `Production menu missing: ${label}`);
  item.click(item, win, {});
}
const syntheticDir = path.join(config.temporary, '中文 路径 与空格');
const sourceFile = path.join(syntheticDir, '原始 合成样例.zhsp');
const savedFile = path.join(syntheticDir, '另存 工程.zhsp');
const creativeFile = path.join(syntheticDir, '创作 图文.pdf');
const printFile = path.join(syntheticDir, 'A4 纯文本.pdf');
const expectedPath = path.join(config.temporary, 'expected.json');
const readProject = file => JSON.parse(fs.readFileSync(file, 'utf8')).project;
async function snapshot() { return run(`JSON.parse(localStorage.getItem('guangying:autosave'))`); }
async function waitSaved(expectedText) {
  await until(() => fs.existsSync(savedFile) && readProject(savedFile).elements.find(e => e.id === 'windows-action').text === expectedText, 'real save IPC writes expected .zhsp');
  await until(`document.body.textContent.includes('已保存：')`, 'save completion');
  await until(async () => {
    const saved = await snapshot();
    return saved?.filePath === savedFile && saved.project.elements.find(e => e.id === 'windows-action').text === expectedText;
  }, 'autosave latest text and file association');
}
async function screenshot(name) { fs.writeFileSync(path.join(config.output, name), (await win.webContents.capturePage()).toPNG()); }
async function closeAndStay() {
  const count = report.dialogs.filter(d => d.kind === 'close').length;
  closeChoices.push(0); win.close();
  await until(() => report.dialogs.filter(d => d.kind === 'close').length === count + 1, 'production will-prevent-unload reaches close confirmation');
  await pause(200);
  assert.equal(win.isDestroyed(), false, 'Default continue-writing choice must preserve the window');
}
async function finishClose(leave) {
  assert.deepEqual(saveChoices, []); assert.deepEqual(openChoices, []); assert.deepEqual(closeChoices, []);
  assert.deepEqual(report.errors, [], 'Renderer/main errors');
  if (leave) closeChoices.push(1);
  win.once('closed', () => {
    // Synchronous evidence is recorded before production window-all-closed quits.
    try {
      assert.deepEqual(closeChoices, [], 'Expected guard did not execute');
      assert.deepEqual(report.errors, [], 'No renderer/main errors during production close');
      report.status = 'passed'; journal(); app.quit();
    } catch (error) {
      report.status = 'failed'; report.error = error.stack || String(error); journal(); app.exit(1);
    }
  });
  win.close();
}

app.on('browser-window-created', (_event, candidate) => {
  if (win) return; // Secondary production PDF window must not replace the editor.
  win = candidate;
  candidate.webContents.on('render-process-gone', (_event, details) => { report.errors.push({ rendererGone: details.reason }); journal(); });
  candidate.webContents.on('console-message', (_event, level, message) => { if (level >= 3) { report.errors.push({ renderer: message }); journal(); } });
});
require(path.join(root, 'electron', 'main.js'));

app.whenReady().then(async () => {
  try {
    await until(() => !!win, 'production main creates BrowserWindow');
    await until('!!document.querySelector(".editor__scroll[data-ready=true]")', 'packaged renderer ready', 30000);
    assert.equal(win.webContents.getURL(), pathToFileURL(path.join(root, 'dist-renderer', 'index.html')).href);
    const info = await run('window.api.getInfo()');
    assert.equal(info.version, config.version); assert.equal(info.platform, config.expectedPlatform);
    assert.equal(app.getPath('userData'), config.userData);
    pass('packaged production main/preload/renderer start with isolated userData');
    if (phase === 'recovery') {
      const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
      await until(`!!document.querySelector(${JSON.stringify(actionSelector)})`, 'recovered action');
      assert.equal(await text(), expected.unsavedText);
      const recovered = await snapshot();
      assert.equal(recovered.filePath, savedFile);
      assert.equal(recovered.project.beats[0].img, expected.image);
      await until('document.querySelector(".writing-material-card__image")?.naturalWidth > 0', 'recovered embedded image decodes');
      pass('actual process restart recovers unsaved Chinese text, embedded image, and .zhsp association without reseeding');
      await closeAndStay();
      assert.equal(await text(), expected.unsavedText);
      pass('recovered document conservatively remains dirty and default close choice stays open');
      await focusEnd(); await key('s', ['control']); await waitSaved(expected.unsavedText);
      assert.equal(fs.readFileSync(savedFile + '.guangying-backup', 'utf8'), expected.diskBeforeRecovery);
      // Reading the old localStorage alone would not prove the live model was
      // restored. Saving it through production IPC verifies every project field.
      assert.deepEqual(readProject(savedFile), expected.project, 'Full live recovered project must survive process restart and disk save');
      pass('Ctrl+S after process restart writes associated Chinese path and backs up the previous disk version');
      pass('complete recovered project matches: all paragraphs, formatting, cards, coordinates, settings, and metadata');
      await screenshot('recovered.png');
      pass('saved document closes through production beforeunload without an extra prompt');
      await finishClose(false);
      return;
    }

    const blank = await run(`Array.from(document.querySelectorAll('.script-flow .sc-el')).map(e=>e.textContent)`);
    assert.equal(blank.length, 2); assert.ok(blank.every(value => value === ''));
    assert.equal(await run('document.querySelectorAll(".writing-material-card").length'), 0);
    const firstRecovery = await snapshot();
    if (firstRecovery) {
      assert.ok(firstRecovery.project.elements.every(element => element.text === ''));
      assert.deepEqual(firstRecovery.project.beats, []); assert.equal(firstRecovery.filePath, null);
    }
    assert.deepEqual(await run('window.api.getRecent()'), []);
    pass('first launch is blank: two empty editable paragraphs, no cards, prior text, associated file, or recent files');
    await screenshot('first-launch.png');
    win.show(); win.focus();
    await key('f', ['control']); await until('!!document.querySelector(".find-panel")', 'Ctrl+F opens find');
    await key('Escape'); await until('!document.querySelector(".find-panel")', 'Escape closes find');
    pass('Chromium Ctrl+F and Escape operate the production find panel');

    fs.mkdirSync(syntheticDir);
    // Generated 1x1 RGBA pixel, valid PNG chunk CRCs and zlib stream.
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMIqAj4DwAETAIY7NJ6TgAAAABJRU5ErkJggg==';
    const project = { id: 'windows-synthetic', name: 'Windows 合成验收', createdAt: 1, updatedAt: 1,
      titlePage: { show: false }, settings: { smartQuotes: true }, acts: [], sceneMeta: [], boardLinks: [], revisions: [],
      elements: [{ id: 'windows-scene', type: 'scene_heading', text: '内景 合成测试房间 日' },
        { id: 'windows-action', type: 'action', text: '合成正文' }, { id: 'windows-keep', type: 'action', text: '<b>保留</b>段落' }],
      beats: [{ id: 'windows-image', kind: 'image', title: '合成像素', text: '仅用于测试', img: image, color: '#fff', x: 850, y: 90, w: 120, h: 100 }] };
    fs.writeFileSync(sourceFile, JSON.stringify({ app: 'guangying-writer', fileVersion: 1, savedAt: 1, project }), { flag: 'wx' });
    const sourceBytes = fs.readFileSync(sourceFile, 'utf8');
    openChoices.push({ path: sourceFile }); await key('o', ['control']);
    await until(`!!document.querySelector(${JSON.stringify(actionSelector)})`, 'Ctrl+O real IPC opens synthetic Chinese filename');
    assert.equal(await text(), '合成正文');
    await until('document.querySelector(".writing-material-card__image")?.naturalWidth > 0', 'fixture embedded image decodes');
    pass('Ctrl+O reads .zhsp via production file IPC from Chinese path with spaces (dialog selection stubbed)');
    openChoices.push({ canceled: true }); await key('o', ['control']);
    assert.equal(await text(), '合成正文');
    pass('canceled open leaves current synthetic document intact');

    await focusEnd(); await win.webContents.insertText('键盘'); await pause(150);
    assert.equal(await text(), '合成正文键盘');
    await key('z', ['control']); assert.equal(await text(), '合成正文');
    await key('z', ['control', 'shift']); assert.equal(await text(), '合成正文键盘');
    pass('Chromium Ctrl+Z / Ctrl+Shift+Z restore visible Chinese text without a native DOM-only undo');
    const cycle = ['action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'scene_heading', 'general', 'note'];
    for (let index = 1; index <= 11; index++) {
      await key('Tab');
      assert.equal(await run('document.activeElement.dataset.id'), 'windows-action');
      assert.equal(await run('document.activeElement.dataset.type'), cycle[index % 9]);
    }
    for (let index = 1; index <= 11; index++) {
      await key('Tab', ['shift']);
      assert.equal(await run('document.activeElement.dataset.id'), 'windows-action');
      assert.equal(await run('document.activeElement.dataset.type'), cycle[(11 - index) % 9]);
    }
    assert.equal(await text(), '合成正文键盘');
    pass('11 Tab and 11 Shift+Tab preserve the same paragraph/focus and all nine element types');
    await focusEnd();
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 });
    await win.webContents.debugger.sendCommand('Input.insertText', { text: '中文' });
    win.webContents.debugger.detach(); await pause(180);
    const firstSavedText = '合成正文键盘中文'; assert.equal(await text(), firstSavedText);
    pass('CDP Chinese composition commits once without leftover pinyin (not real system IME acceptance)');

    saveChoices.push({ canceled: true, extension: 'zhsp' }); await key('s', ['control', 'shift']);
    assert.equal(fs.existsSync(savedFile), false); assert.equal(fs.readFileSync(sourceFile, 'utf8'), sourceBytes);
    assert.equal(await text(), firstSavedText);
    await closeAndStay(); assert.equal(await text(), firstSavedText);
    pass('canceled Save As preserves current content, dirty close protection, and source .zhsp');
    saveChoices.push({ path: savedFile, extension: 'zhsp' }); await key('s', ['control', 'shift']);
    await waitSaved(firstSavedText);
    const firstSavedBytes = fs.readFileSync(savedFile, 'utf8');
    assert.equal(fs.readFileSync(sourceFile, 'utf8'), sourceBytes);
    pass('Ctrl+Shift+S writes a new Chinese filename through real atomic save IPC and preserves source');
    await focusEnd(); await win.webContents.insertText('第二版'); await key('s', ['control']);
    const diskText = firstSavedText + '第二版'; await waitSaved(diskText);
    assert.equal(fs.readFileSync(savedFile + '.guangying-backup', 'utf8'), firstSavedBytes);
    assert.equal(readProject(savedFile).beats[0].img, image);
    assert.equal(readProject(savedFile).elements[2].text, '<b>保留</b>段落');
    pass('Ctrl+S atomically replaces .zhsp, preserves embedded image/formatting, and retains exact previous-version backup');

    const beforePdf = JSON.stringify((await snapshot()).project);
    for (const [label, destination, outputName] of [['导出创作版 PDF（原位卡片）…', creativeFile, 'creative.pdf'], ['导出 A4 纯文本 PDF…', printFile, 'print-a4.pdf']]) {
      saveChoices.push({ path: destination, extension: 'pdf' }); menu(label);
      await until(() => fs.existsSync(destination), 'production PDF export', 30000);
      const bytes = fs.readFileSync(destination);
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'); assert.ok(bytes.length > 1000);
      // Chromium emits page/image dictionaries uncompressed. This is a bounded
      // fixture check, not a general PDF parser or proof of visual/text fidelity.
      const pdf = bytes.toString('latin1');
      assert.equal((pdf.match(/\/Type\s*\/Page\b/g) || []).length, 1, 'This short synthetic fixture must produce one page');
      const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
      assert.ok(boxes.length > 0, 'PDF must declare page geometry');
      const images = (pdf.match(/\/Subtype\s*\/Image\b/g) || []).length;
      if (outputName === 'print-a4.pdf') {
        for (const box of boxes) assert.ok(Math.abs(Number(box[1]) - 595.28) < 1 && Math.abs(Number(box[2]) - 841.89) < 1, 'Plain-text PDF must use A4 points');
        assert.equal(images, 0, 'Plain-text PDF must exclude the image card');
      } else {
        assert.ok(images > 0, 'Creative PDF must embed the synthetic image');
      }
      fs.copyFileSync(destination, path.join(config.output, outputName));
      await until('!!document.querySelector(".editor__scroll[data-ready=true]")', 'return from PDF view');
    }
    // A mistaken export-side edit would reach recovery after its 900ms debounce.
    await pause(1200);
    assert.equal(JSON.stringify((await snapshot()).project), beforePdf);
    pass('both production PDFs have one page; A4 geometry excludes cards, creative PDF embeds image, project stays unchanged (visual/text review remains separate)');
    await focusEnd(); await win.webContents.insertText('未保存恢复');
    const unsavedText = diskText + '未保存恢复';
    await until(async () => (await snapshot())?.project.elements.find(e => e.id === 'windows-action').text === unsavedText, 'automatic recovery writes latest text');
    assert.equal(readProject(savedFile).elements[1].text, diskText, 'Autosave must not pretend to save the disk .zhsp');
    await closeAndStay(); assert.equal(await text(), unsavedText);
    pass('dirty close reaches real beforeunload/will-prevent-unload and defaults to continue writing');
    fs.writeFileSync(expectedPath, JSON.stringify({ unsavedText, image, project: (await snapshot()).project, diskBeforeRecovery: fs.readFileSync(savedFile, 'utf8') }));
    await screenshot('before-restart.png');
    pass('explicit leave choice uses production guard; next phase restarts same QA executable/profile');
    await finishClose(true);
  } catch (error) {
    report.status = 'failed'; report.error = error.stack || String(error); journal(); console.error(error);
    // Deliberate teardown only after reporting failure; never counts as close acceptance.
    app.exit(1);
  }
});
