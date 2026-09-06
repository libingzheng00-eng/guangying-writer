/**
 * 让 `npm run smoke` 可用：本机 Electron 在命令行直接传入 .js 会把它当成「渲染进程」加载，
 * 导致 require('electron').app 为 undefined。因此本启动器临时把 package.json 的 main
 * 指向 scripts/smoke.js，用 `electron .` 以「主进程」方式运行冒烟测试，结束后再还原 main。
 *
 * 用法： node scripts/run-smoke.cjs
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const electron = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const origMain = pkg.main;
let restored = false;
function restoreMain() {
  if (restored) return;
  restored = true;
  pkg.main = origMain;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}
process.once('exit', restoreMain);

pkg.main = 'scripts/smoke.js';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

let code = 0;
try {
  const r = spawnSync(electron, ['.'], { cwd: root, stdio: 'inherit' });
  code = r.status == null ? (r.error ? 1 : 0) : r.status;
} catch (e) {
  console.error('启动 Electron 失败：', e);
  code = 1;
} finally {
  // 无论如何都还原 main，避免污染 package.json。
  // exit 监听器额外覆盖启动器被外部中断的失败路径。
  restoreMain();
}
process.exit(code);
