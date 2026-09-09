/**
 * 冒烟测试：无头加载渲染进程，收集控制台错误，并把界面截图写到 /tmp/guangying-*.png
 * 用法： ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/smoke.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const OUT = process.env.SMOKE_OUT || '/tmp/guangying-smoke.png';
const WAIT = Number(process.env.SMOKE_WAIT || 6000);

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false });
  const logs = [];
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    logs.push(`[${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => logs.push(`[fail] ${code} ${desc}`));
  win.webContents.on('render-process-gone', (_e, details) => logs.push(`[crash] ${JSON.stringify(details)}`));

  await win.loadFile(path.join(__dirname, '..', 'dist-renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, WAIT));

  // 读取页面上的关键状态，验证应用确实渲染成功
  const probe = await win.webContents
    .executeJavaScript(
      `(() => {
        const q = (s) => document.querySelector(s);
        return {
          title: document.title,
          blocks: document.querySelectorAll('.script-flow .sc-el').length,
          toolbar: !!q('.toolbar'),
          sidebar: !!q('.sidebar'),
          statusbar: q('.statusbar') ? q('.statusbar').innerText.replace(/\\n/g, ' | ') : null,
          measure: document.querySelectorAll('.sc-measure .sc-el').length,
          firstBlock: q('.script-flow .sc-el') ? q('.script-flow .sc-el').innerText : null,
        };
      })()`,
    )
    .catch((e) => ({ error: String(e) }));

  const img = await win.capturePage();
  fs.writeFileSync(OUT, img.toPNG());

  console.log('=== PROBE ===');
  console.log(JSON.stringify(probe, null, 2));
  console.log('=== CONSOLE ===');
  console.log(logs.length ? logs.join('\n') : '(no console output)');
  app.quit();
});
