/**
 * 真实 Electron 窗口截屏脚本：加载打包后的 dist-renderer，等待渲染完成后 capturePage 输出 PNG。
 * 用法：node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/capture.cjs <out.png> [waitMs] [--width=1280] [--height=800]
 * 不修改任何用户数据目录，使用临时 userData 路径。
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const argv = process.argv.slice(2);
const outArg = argv.find((a) => !a.startsWith('--') && /\.png$/i.test(a)) || path.join(__dirname, '..', 'capture.png');
const waitArg = Number(argv.find((a) => /^\d+$/.test(a))) || 2500;
const width = Number((argv.find((a) => a.startsWith('--width=')) || '').slice(8)) || 1280;
const height = Number((argv.find((a) => a.startsWith('--height=')) || '').slice(9)) || 800;

app.setPath('userData', path.join(__dirname, '..', '.tmp-userdata'));
app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: true },
  });
  const indexHtml = path.join(__dirname, '..', 'dist-renderer', 'index.html');
  if (!fs.existsSync(indexHtml)) {
    console.error('dist-renderer missing; run `npm run build` first.');
    app.exit(2);
    return;
  }
  await win.loadFile(indexHtml);
  await new Promise((r) => setTimeout(r, waitArg));
  try {
    const img = await win.webContents.capturePage();
    fs.mkdirSync(path.dirname(outArg), { recursive: true });
    fs.writeFileSync(outArg, img.toPNG());
    const sz = img.getSize();
    console.log(`saved ${outArg} ${sz.width}x${sz.height}`);
  } catch (e) {
    console.error('capture failed:', e && e.message);
    app.exit(3);
    return;
  }
  app.quit();
});