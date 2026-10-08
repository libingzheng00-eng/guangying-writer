/**
 * 独立 QA 壳启动 smoke 主进程，不修改仓库 package.json，不使用应用默认 userData。
 * 截图与临时环境保留在本次唯一的临时目录，方便检查，不纳入源码或安装包。
 *
 * 用法： node scripts/run-smoke.cjs
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');
// The Electron package resolves the installed runtime on macOS, Windows and
// Linux; do not assume the macOS application-bundle layout in the QA launcher.
const electron = require('electron');
const qaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-smoke-'));
const shellRoot = path.join(qaRoot, 'shell');
fs.mkdirSync(shellRoot);
fs.writeFileSync(path.join(shellRoot, 'package.json'), JSON.stringify({
  name: 'guangying-smoke-qa',
  productName: '光影写手 QA',
  version: '1.0.0',
  private: true,
  main: path.join(root, 'scripts/smoke.js'),
}, null, 2) + '\n');

let code = 0;
try {
  const r = spawnSync(electron, [shellRoot], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, GUANGYING_SMOKE_ROOT: qaRoot },
  });
  code = r.status == null ? 1 : r.status;
  if (r.error) console.error('启动 Electron 失败：', r.error);
  if (r.signal) console.error(`Electron 被 ${r.signal} 中断`);
} catch (e) {
  console.error('启动 Electron 失败：', e);
  code = 1;
}
console.log(`Smoke 合成测试环境：${qaRoot}`);
process.exit(code);
