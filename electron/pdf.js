const { BrowserWindow } = require('electron');

/** 与测试共用的实际 PDF 输出路径；创作版在无脚本、无网络的独立窗口中打印冻结画布。 */
async function renderPdf(sourceWindow, opts) {
  if (opts?.mode !== 'creative') {
    return sourceWindow.webContents.printToPDF({
      pageSize: 'A4', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 },
      landscape: false, preferCSSPageSize: true,
    });
  }
  if (typeof opts.html !== 'string' || !opts.html.includes('export-sheet')) throw new Error('缺少创作版画布快照');
  const printWindow = new BrowserWindow({
    show: false, width: 1440, height: 960,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, partition: 'guangying-pdf-export' },
  });
  printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  printWindow.webContents.on('will-navigate', event => event.preventDefault());
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(opts.html)}`);
    await printWindow.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(async image => {
        try { await image.decode(); } catch { /* 损坏图片仍保留原位卡片与备注 */ }
      }));
    })()`);
    return await printWindow.webContents.printToPDF({
      pageSize: opts.pageSize, printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 },
      landscape: false, preferCSSPageSize: true,
    });
  } finally {
    printWindow.destroy();
  }
}
module.exports = { renderPdf };
