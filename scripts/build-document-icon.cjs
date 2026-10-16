/**
 * 由 assets/source/zhsp-document.svg 生成 .zhsp 文档图标 assets/zhsp-document.icns。
 * 用本仓库锁定的 Electron 离屏渲染各尺寸 PNG，再交给 macOS 自带的 iconutil 打包。
 * 运行：node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/build-document-icon.cjs
 * 只在改图标时手动运行；打包流程直接使用已提交的 .icns。
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'assets/source/zhsp-document.svg');
const output = path.join(root, 'assets/zhsp-document.icns');
// iconutil 要求的文件名与像素尺寸。
const sizes = [16, 32, 128, 256, 512].flatMap(size => [[`icon_${size}x${size}.png`, size], [`icon_${size}x${size}@2x.png`, size * 2]]);

app.whenReady().then(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zhsp-icon-'));
  const iconset = path.join(work, 'zhsp-document.iconset');
  fs.mkdirSync(iconset);
  const svg = fs.readFileSync(source, 'utf8');
  try {
    // 只渲染一次 1024 像素原图，再按各尺寸高质量缩小。
    const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true,
      webPreferences: { offscreen: true, javascript: false } });
    const page = path.join(work, 'icon.html');
    fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${svg}`);
    await win.loadFile(page);
    await new Promise(resolve => setTimeout(resolve, 300));
    const full = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
    win.destroy();
    for (const [name, size] of sizes) {
      fs.writeFileSync(path.join(iconset, name), full.resize({ width: size, height: size, quality: 'best' }).toPNG());
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', output]);
    console.log(`wrote ${path.relative(root, output)}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    app.quit();
  }
});
