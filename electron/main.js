const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

/* ---------------------------- 主进程崩溃兜底 ---------------------------- */
/* 任何未捕获的同步异常 / 未处理的 Promise 拒绝，默认会让 Electron 直接退出且无提示。
   这里收拢成日志（必要时弹窗），让应用不至于「悄无声息地死掉」。 */
function logFatal(where, err) {
  const msg = `[墨场] 主进程异常 (${where})：${err && err.stack ? err.stack : err}`;
  console.error(msg);
  try {
    if (win && !win.isDestroyed()) {
      dialog.showErrorBox('墨场遇到问题', `${where}：\n${err && err.message ? err.message : String(err)}`);
    }
  } catch {
    /* ignore */
  }
}
process.on('uncaughtException', (err) => logFatal('uncaughtException', err));
process.on('unhandledRejection', (reason) => logFatal('unhandledRejection', reason));

const DEV = process.env.ZS_DEV === '1';
const RECENT_FILE = () => path.join(app.getPath('userData'), 'recent.json');

let win = null;

function readRecent() {
  try {
    const raw = fs.readFileSync(RECENT_FILE(), 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.slice(0, 12) : [];
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
    title: '墨场 · 中文编剧',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 20 },
    backgroundColor: '#f6f7f9',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  // 窗口关闭后把引用置空，避免后续 send() 打到已销毁的窗口而抛错
  win.on('closed', () => {
    win = null;
  });

  if (DEV) {
    win.loadURL('http://localhost:5178');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist-renderer', 'index.html'));
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
        { label: '导出 PDF…', accelerator: 'CmdOrCtrl+P', click: () => send('file:exportPdf') },
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

ipcMain.handle('dialog:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: '剧本文件', extensions: ['zhsp', 'fdx', 'txt', 'md'] },
      { name: '墨场工程', extensions: ['zhsp'] },
      { name: 'Final Draft', extensions: ['fdx'] },
      { name: '文本', extensions: ['txt', 'md'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const file = res.filePaths[0];
  try {
    const content = fs.readFileSync(file, 'utf8');
    pushRecent({ path: file, name: path.basename(file), updatedAt: Date.now() });
    return { path: file, content };
  } catch (err) {
    dialog.showErrorBox('打开失败', `无法读取文件：${file}\n${err && err.message ? err.message : err}`);
    return null;
  }
});

ipcMain.handle('dialog:save', async (_e, { content, path: target, name }) => {
  let file = target;
  if (!file) {
    const res = await dialog.showSaveDialog(win, {
      defaultPath: name || '未命名剧本.zhsp',
      filters: [{ name: '墨场工程', extensions: ['zhsp'] }],
    });
    if (res.canceled || !res.filePath) return null;
    file = res.filePath;
  }
  try {
    fs.writeFileSync(file, content, 'utf8');
  } catch (err) {
    dialog.showErrorBox('保存失败', `无法写入文件：${file}\n${err && err.message ? err.message : err}`);
    return null;
  }
  pushRecent({ path: file, name: path.basename(file), updatedAt: Date.now() });
  return file;
});

ipcMain.handle('dialog:saveAs', async (_e, { content, name, ext }) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: `${name}.${ext || 'zhsp'}`,
    filters: [{ name: '导出文件', extensions: [ext || 'zhsp'] }],
  });
  if (res.canceled || !res.filePath) return null;
  try {
    fs.writeFileSync(res.filePath, content, 'utf8');
  } catch (err) {
    dialog.showErrorBox('导出失败', `无法写入文件：${res.filePath}\n${err && err.message ? err.message : err}`);
    return null;
  }
  return res.filePath;
});

ipcMain.handle('pdf:export', async (_e, opts) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: '剧本.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return null;
  try {
    const data = await win.webContents.printToPDF({
      pageSize: opts && opts.pageSize ? opts.pageSize : 'A4',
      printBackground: true,
      margins: { marginType: 'none' },
      landscape: false,
      preferCSSPageSize: true,
    });
    fs.writeFileSync(res.filePath, data);
    return res.filePath;
  } catch (err) {
    dialog.showErrorBox('导出失败', String(err && err.message ? err.message : err));
    return null;
  }
});

ipcMain.handle('file:show', async (_e, p) => {
  if (p) shell.showItemInFolder(p);
});

ipcMain.handle('app:recent', () => readRecent());
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));

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
