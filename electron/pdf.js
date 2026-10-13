const { BrowserWindow, session } = require('electron');
const { randomUUID } = require('node:crypto');
const { pdfPayload } = require('./security');

const PRINT_SCHEME = 'guangying-pdf';
const PRINT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";

/** 两种 PDF 都在无脚本、无网络的独立窗口中打印冻结快照；不读取编辑器窗口。 */
async function renderPdf(sourceWindow, opts) {
  if (opts?.mode === 'creative' && (typeof opts.html !== 'string' || !opts.html.includes('export-sheet'))) throw new Error('缺少创作版画布快照');
  pdfPayload(opts);
  const creative = opts.mode === 'creative';
  const label = creative ? '创作版' : 'A4 打印版';
  // 核心红线：只替换快照传输，不重排图文。不要恢复 data:text/html URL：
  // 冻结样式与图片很容易超过 Chromium 的 URL 长度上限，而且错误会泄漏整份正文。
  // 每次独立、非持久 session + 内存 Response，不落盘，不共享工程或应用存储。
  const id = randomUUID();
  const documentURL = `${PRINT_SCHEME}://snapshot/${id}`;
  let html = opts.html;
  let printSession;
  let printWindow;
  let handled = false;
  let stage = '准备打印窗口';
  try {
    printSession = session.fromPartition(`guangying-pdf-${id}`, { cache: false });
    printSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    printSession.setPermissionCheckHandler(() => false);
    printSession.on('will-download', event => event.preventDefault());
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
    stage = creative ? '加载创作画布' : '加载 A4 分页快照';
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
      pageSize: creative ? opts.pageSize : 'A4', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 },
      landscape: false, preferCSSPageSize: true,
    });
  } catch {
    // 不回显 Chromium 原始错误（可能含正文、图片 data URL 或本地路径）。
    throw new Error(`${label} PDF 导出失败：${stage}未完成。请重试；剧本内容没有被修改。`);
  } finally {
    html = '';
    let cleanupFailed = false;
    try { if (printWindow && !printWindow.isDestroyed()) printWindow.destroy(); }
    catch { cleanupFailed = true; }
    try { if (handled) printSession.protocol.unhandle(PRINT_SCHEME); }
    catch { cleanupFailed = true; }
    if (cleanupFailed) throw new Error(`${label} PDF 导出失败：清理打印窗口未完成。请重试；剧本内容没有被修改。`);
  }
}
module.exports = { renderPdf };
