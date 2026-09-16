const { BrowserWindow, session } = require('electron');
const { randomUUID } = require('node:crypto');

const PRINT_SCHEME = 'guangying-pdf';
const PRINT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";

/** 与测试共用的实际 PDF 输出路径；创作版在无脚本、无网络的独立窗口中打印冻结画布。 */
async function renderPdf(sourceWindow, opts) {
  if (opts?.mode !== 'creative') {
    return sourceWindow.webContents.printToPDF({
      pageSize: 'A4', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 },
      landscape: false, preferCSSPageSize: true,
    });
  }
  if (typeof opts.html !== 'string' || !opts.html.includes('export-sheet')) throw new Error('缺少创作版画布快照');
  // 核心红线：只替换快照传输，不重排图文。不要恢复 data:text/html URL：
  // 冻结样式与图片很容易超过 Chromium 的 URL 长度上限，而且错误会泄漏整份正文。
  // 每次独立、非持久 session + 内存 Response，不落盘，不共享工程或应用存储。
  const id = randomUUID();
  const printSession = session.fromPartition(`guangying-pdf-${id}`, { cache: false });
  const documentURL = `${PRINT_SCHEME}://snapshot/${id}`;
  let html = opts.html;
  let printWindow;
  let handled = false;
  let stage = '准备打印窗口';
  try {
    printSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    printSession.setPermissionCheckHandler(() => false);
    printSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: details.url !== documentURL && !details.url.startsWith('data:') });
    });
    printSession.protocol.handle(PRINT_SCHEME, request => {
      if (request.url !== documentURL || request.method !== 'GET') return new Response(null, { status: 403 });
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': PRINT_CSP,
          'Cache-Control': 'no-store',
        },
      });
    });
    handled = true;
    printWindow = new BrowserWindow({
      show: false, width: 1440, height: 960,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, session: printSession },
    });
    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    printWindow.webContents.on('will-navigate', event => event.preventDefault());
    stage = '加载创作画布';
    await printWindow.loadURL(documentURL);
    stage = '等待字体和图片';
    await printWindow.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(async image => {
        try { await image.decode(); } catch { /* 损坏图片仍保留原位卡片与备注 */ }
      }));
    })()`);
    stage = '生成 PDF';
    return await printWindow.webContents.printToPDF({
      pageSize: opts.pageSize, printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 },
      landscape: false, preferCSSPageSize: true,
    });
  } catch {
    // 不回显 Chromium 原始错误（可能含正文、图片 data URL 或本地路径）。
    throw new Error(`创作版 PDF 导出失败：${stage}未完成。请重试；剧本内容没有被修改。`);
  } finally {
    html = '';
    try {
      if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
    } finally {
      if (handled) printSession.protocol.unhandle(PRINT_SCHEME);
    }
  }
}
module.exports = { renderPdf };
