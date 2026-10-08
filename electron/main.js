const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { renderPdf } = require('./pdf');
const { saveProjectFile } = require('./projectSave');
const { dialogFileName } = require('./platform');
const { senderGuard, secureWindow, savePayload, pdfPayload, rejectRequest } = require('./security');
const { createFileAccess } = require('./fileAccess');

/* ---------------------------- 主进程崩溃兜底 ---------------------------- */
/* 任何未捕获的同步异常 / 未处理的 Promise 拒绝，默认会让 Electron 直接退出且无提示。
   这里收拢成日志（必要时弹窗），让应用不至于「悄无声息地死掉」。 */
function logFatal(where, err) {
  const msg = `[光影写手] 主进程异常 (${where})：${err && err.stack ? err.stack : err}`;
  console.error(msg);
  try {
    if (win && !win.isDestroyed()) {
      dialog.showErrorBox('光影写手遇到问题', `${where}：\n${err && err.message ? err.message : String(err)}`);
    }
  } catch {
    /* ignore */
  }
}
process.on('uncaughtException', (err) => logFatal('uncaughtException', err));
process.on('unhandledRejection', (reason) => logFatal('unhandledRejection', reason));

const DEV = process.env.ZS_DEV === '1' && !app.isPackaged;
const RENDERER_FILE = path.join(__dirname, '..', 'dist-renderer', 'index.html');
const RENDERER_URL = DEV ? 'http://localhost:5178/' : pathToFileURL(RENDERER_FILE).href;
const RECENT_FILE = () => path.join(app.getPath('userData'), 'recent.json');

let win = null;
const fileAccess = createFileAccess({
  fileSystem: fs, pathApi: path, platform: process.platform,
  userData: () => app.getPath('userData'), protectedRoots: [path.resolve(__dirname, '..')],
  warn: message => { try { console.warn('[光影写手]', message); } catch { /* diagnostics only */ } },
});

function readRecent() {
  try {
    const raw = fs.readFileSync(RECENT_FILE(), 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(entry => entry && typeof entry.path === 'string' &&
      typeof entry.name === 'string' && Number.isFinite(entry.updatedAt)).slice(0, 12) : [];
  } catch {
    return [];
  }
}

function writeRecent(list) {
  try {
    fs.writeFileSync(RECENT_FILE(), JSON.stringify(list.slice(0, 12), null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

function pushRecent(entry) {
  const list = readRecent().filter((r) => r.path !== entry.path);
  list.unshift(entry);
  writeRecent(list);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 680,
    title: '光影写手',
    // Keep native minimize/maximize/close controls on Windows. Traffic lights and
    // the inset title bar belong only to the existing macOS window chrome.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 20 } }
      : { titleBarStyle: 'default' }),
    backgroundColor: '#f6f7f9',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  secureWindow(win);

  win.once('ready-to-show', () => win.show());
  // beforeunload first flushes the latest recovery point in the renderer.
  // A recovery point is NOT a disk save: default to staying in the document.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', title: '关闭前确认保存',
      message: '尚有未保存的修改、未确认的卡片文字，或保存仍在进行。',
      detail: '请先确认卡片文字，再使用“保存/另存为”。自动恢复点不能替代工程文件；恢复点保存失败时也请不要直接退出。',
      buttons: ['继续写作', '仍然离开'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (choice === 1) event.preventDefault(); // Electron: allow the unload.
  });
  // 窗口关闭后把引用置空，避免后续 send() 打到已销毁的窗口而抛错
  win.on('closed', () => {
    win = null;
  });

  if (DEV) {
    win.loadURL('http://localhost:5178');
  } else {
    win.loadFile(RENDERER_FILE);
  }
}

const send = (action) => {
  if (win && !win.isDestroyed()) win.webContents.send('menu:action', action);
};

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建剧本', accelerator: 'CmdOrCtrl+N', click: () => send('file:new') },
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => send('file:open') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('file:save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('file:saveAs') },
        { type: 'separator' },
        { label: '导入文本剧本…', click: () => send('file:importText') },
        { label: '导入 Final Draft (FDX)…', click: () => send('file:importFdx') },
        { type: 'separator' },
        { label: '导出创作版 PDF（原位卡片）…', click: () => send('file:exportPdf') },
        { label: '导出 A4 纯文本 PDF…', accelerator: 'CmdOrCtrl+P', click: () => send('file:exportPrintPdf') },
        { label: '导出 FDX…', click: () => send('file:exportFdx') },
        { label: '导出纯文本…', click: () => send('file:exportText') },
        { label: '导出 Markdown…', click: () => send('file:exportMd') },
        { type: 'separator' },
        { label: '标题页…', click: () => send('file:titlePage') },
        { label: '显示简介设置…', click: () => send('file:settings') },
      ],
    },
    {
      label: '编辑',
      submenu: [
        // 注意：这两项绝对不要加 role。若同时写了 role 和 click，Electron 会优先执行
        // role 对应的原生撤销（只作用于原生输入框），click 被直接忽略，
        // 导致故事板 / 自由板等视图下 Cmd+Z 完全无反应。
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => send('edit:undo') },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('edit:redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: '查找…', accelerator: 'CmdOrCtrl+F', click: () => send('edit:find') },
      ],
    },
    {
      label: '元素',
      submenu: [
        { label: '场次标题', accelerator: 'CmdOrCtrl+1', click: () => send('element:scene_heading') },
        { label: '动作', accelerator: 'CmdOrCtrl+2', click: () => send('element:action') },
        { label: '人物', accelerator: 'CmdOrCtrl+3', click: () => send('element:character') },
        { label: '括号提示', accelerator: 'CmdOrCtrl+4', click: () => send('element:parenthetical') },
        { label: '对白', accelerator: 'CmdOrCtrl+5', click: () => send('element:dialogue') },
        { label: '转场', accelerator: 'CmdOrCtrl+6', click: () => send('element:transition') },
        { label: '镜头', accelerator: 'CmdOrCtrl+7', click: () => send('element:shot') },
        { label: '幕 / 分集', accelerator: 'CmdOrCtrl+8', click: () => send('element:act') },
        { type: 'separator' },
        { label: '插入场景', accelerator: 'CmdOrCtrl+Return', click: () => send('element:insertScene') },
        { label: '双列对白', accelerator: 'CmdOrCtrl+D', click: () => send('element:dual') },
        { label: '省略 / 恢复', click: () => send('element:omit') },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '写作', accelerator: 'CmdOrCtrl+Alt+1', click: () => send('view:write') },
        { label: '故事板卡片', accelerator: 'CmdOrCtrl+Alt+2', click: () => send('view:cards') },
        { label: '自由板', click: () => send('view:board') },
        { label: '分页预览', accelerator: 'CmdOrCtrl+Alt+3', click: () => send('view:preview') },
        { label: '统计报表', accelerator: 'CmdOrCtrl+Alt+4', click: () => send('view:reports') },
        { type: 'separator' },
        { label: '显示 / 隐藏侧栏', accelerator: 'CmdOrCtrl+Alt+L', click: () => send('view:sidebar') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------------------- IPC ---------------------------- */

function warnProjectSaveDurability(result) {
  const warning = result?.durabilityWarning;
  if (result?.directorySynced !== false || typeof warning !== 'string' ||
      !/^directory-sync-[A-Z][A-Z0-9_]{0,31}$/.test(warning)) return;
  // The atomic replacement already committed. Diagnostics must not include the
  // project path/content or turn a successful save into a failure dialog/null.
  // Unsupported directory fsync is an expected platform limitation, not an error.
  try {
    console.warn('[光影写手] 工程已写入；目录持久化同步未确认。', warning);
  } catch { /* logging failure cannot undo an already successful save */ }
}

function handle(channel, action) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      const checkSender = senderGuard(event, () => win, RENDERER_URL);
      return await action(payload, checkSender);
    } catch {
      // Do not forward filesystem paths, project text or arbitrary native errors
      // through rejected IPC promises. Rejections stay distinct from cancellation.
      rejectRequest();
    }
  });
}

function rememberSaved(selection) {
  try { fileAccess.grantProject(selection); }
  catch {
    try { console.warn('[光影写手] 文件已保存；保存位置授权未能更新，下次保存可能需要重新确认。'); }
    catch { /* logging cannot undo a successful save */ }
  }
}

handle('dialog:open', async (_payload, checkSender) => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: '剧本文件', extensions: ['zhsp', 'fdx', 'txt', 'md'] },
      { name: '光影写手工程', extensions: ['zhsp'] },
      { name: 'Final Draft', extensions: ['fdx'] },
      { name: '文本', extensions: ['txt', 'md'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  checkSender();
  if (res.canceled || !res.filePaths.length) return null;
  const file = res.filePaths[0];
  try {
    const { content } = fileAccess.readSelected(file);
    pushRecent({ path: file, name: path.basename(file), updatedAt: Date.now() });
    return { path: file, content };
  } catch (err) {
    dialog.showErrorBox('打开失败', '无法安全读取所选文件。请检查文件是否可用，或重新选择。');
    return null;
  }
});

handle('dialog:save', async (payload, checkSender) => {
  const { content, path: target, name } = savePayload(payload);
  let selection = target ? fileAccess.authorizedProject(target) : null;
  if (!selection) {
    const res = await dialog.showSaveDialog(win, {
      ...(target ? { title: '确认恢复工程的保存位置', buttonLabel: '确认并保存' } : {}),
      defaultPath: target || dialogFileName(name || '未命名剧本.zhsp', process.platform),
      filters: [{ name: '光影写手工程', extensions: ['zhsp'] }],
    });
    checkSender();
    if (res.canceled || !res.filePath) return null;
    selection = fileAccess.selected(res.filePath, 'zhsp');
  }
  const file = selection.requested;
  try {
    checkSender();
    const current = fileAccess.check(selection, 'zhsp');
    warnProjectSaveDurability(await saveProjectFile(current.canonical, content, { path: path.dirname(current.canonical), ...current.parent }));
    checkSender();
    rememberSaved(current);
  } catch (err) {
    if (err?.code === 'ESECURITY') throw err;
    dialog.showErrorBox('保存失败', '工程保存未完成。请检查保存位置、文件权限和可用空间后重试。');
    return null;
  }
  pushRecent({ path: file, name: path.basename(file), updatedAt: Date.now() });
  return file;
});

handle('dialog:saveAs', async (payload, checkSender) => {
  const { content, name, ext } = savePayload(payload, true);
  const res = await dialog.showSaveDialog(win, {
    defaultPath: dialogFileName(`${name || '未命名剧本'}.${ext || 'zhsp'}`, process.platform),
    filters: [{ name: '导出文件', extensions: [ext || 'zhsp'] }],
  });
  checkSender();
  if (res.canceled || !res.filePath) return null;
  const selection = fileAccess.selected(res.filePath, ext || 'zhsp');
  try {
    if ((ext || 'zhsp').toLowerCase() === 'zhsp') {
      const current = fileAccess.check(selection, 'zhsp');
      warnProjectSaveDurability(await saveProjectFile(current.canonical, content, { path: path.dirname(current.canonical), ...current.parent }));
      checkSender();
      rememberSaved(selection);
    } else fileAccess.writeExport(selection, content, 'utf8');
  } catch (err) {
    if (err?.code === 'ESECURITY') throw err;
    dialog.showErrorBox('导出失败', '无法写入所选文件。请检查保存位置、文件权限和可用空间后重试。');
    return null;
  }
  return res.filePath;
});

handle('pdf:export', async (payload, checkSender) => {
  const opts = pdfPayload(payload);
  const res = await dialog.showSaveDialog(win, {
    defaultPath: dialogFileName(opts?.name || '剧本.pdf', process.platform),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  checkSender();
  if (res.canceled || !res.filePath) return null;
  const selection = fileAccess.selected(res.filePath, 'pdf');
  try {
    const data = await renderPdf(win, opts);
    checkSender();
    fileAccess.writeExport(selection, data);
    return res.filePath;
  } catch (err) {
    if (err?.code === 'ESECURITY') throw err;
    dialog.showErrorBox('导出失败', 'PDF 导出未完成。请检查保存位置后重试；工程内容没有被修改。');
    return null;
  }
});

handle('file:show', async (p) => {
  shell.showItemInFolder(fileAccess.shownPath(p));
});

handle('app:recent', () => readRecent());
handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));

/* ---------------------------- 生命周期 ---------------------------- */

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/* 单实例：重复打开只聚焦已有窗口，避免多个进程抢写同一份 userData / 自动保存 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else {
      createWindow();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
