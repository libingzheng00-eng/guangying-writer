/** Run the fixed hidden review suite with the existing runtime; no installation. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { cleanEnvironment } = require('./desktop-launch.cjs');
const { stopOwnedChild } = require('./desktop-smoke.cjs');
const root = path.resolve(__dirname, '..');
assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--output');
const output = process.argv[3]; assert.ok(path.isAbsolute(output)); fs.mkdirSync(output);
const runtime = path.join(root, 'node_modules/electron/dist', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron');
assert.ok(fs.statSync(runtime).isFile());
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-review-launch-'));
fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ name: 'guangying-native-acceptance-qa', version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, main: path.join(__dirname, 'native-acceptance-launcher.cjs') }), { flag: 'wx' });
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const renderer = path.join(root, 'dist-renderer/index.html'); const before = hash(renderer);
const rendererFiles = fs.readdirSync(path.join(root, 'dist-renderer/assets')).filter(name => /\.(?:js|css)$/.test(name));
const rendererHashes = Object.fromEntries(['index.html', ...rendererFiles.map(name => 'assets/' + name)].map(name => [name, hash(path.join(root, 'dist-renderer', name))]));
const env = { ...cleanEnvironment(process.env), GUANGYING_QA_HIDDEN: '1', GUANGYING_QA_MODE: 'review' };
let log = '';
const child = spawn(runtime, [temporary], { cwd: temporary, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log += data; process.stdout.write(data); });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; stopOwnedChild(child, process.platform); }, 150000);
child.once('error', error => { clearTimeout(timer); fs.writeFileSync(path.join(output, 'launch-error.txt'), String(error)); process.exitCode = 1; });
child.once('close', (code, signal) => {
  clearTimeout(timer); fs.writeFileSync(path.join(output, 'review.log'), log);
  const resultPath = [...log.matchAll(/^OUTPUT (.+)$/gm)].at(-1)?.[1]?.trim();
  let result, hidden;
  const copiedEvidence = [];
  if (resultPath) {
    assert.equal(fs.realpathSync(path.dirname(resultPath)), fs.realpathSync(os.tmpdir()), 'Evidence must be a direct QA temporary directory');
    assert.match(path.basename(resultPath), /^guangying-review-/);
    assert.ok(!fs.lstatSync(resultPath).isSymbolicLink());
    // Copy only fixed synthetic outputs, never userData or arbitrary paths from logs.
    for (const name of ['result.json', 'hidden-window-proof.json', 'expected-pdf-markers.json',
      'review-1440-day.png', 'review-1024-night.png', 'scene-script-order-day.png', 'review-creative.pdf', 'review-a4.pdf']) {
      const file = path.join(resultPath, name);
      if (!fs.existsSync(file)) continue;
      assert.ok(fs.lstatSync(file).isFile(), 'Evidence cannot be a symlink or special file');
      fs.copyFileSync(file, path.join(output, name), fs.constants.COPYFILE_EXCL);
      copiedEvidence.push({ name, sha256: hash(file) });
    }
    if (fs.existsSync(path.join(output, 'result.json'))) result = JSON.parse(fs.readFileSync(path.join(output, 'result.json')));
    if (fs.existsSync(path.join(output, 'hidden-window-proof.json'))) hidden = JSON.parse(fs.readFileSync(path.join(output, 'hidden-window-proof.json')));
  }
  const assetsUnchanged = Object.entries(rendererHashes).every(([name, expected]) => hash(path.join(root, 'dist-renderer', name)) === expected);
  const passed = code === 0 && !signal && !timedOut && result?.status === 'passed' && hidden?.actualShowEvents === 0 && hidden?.initiallyVisible === 0 && assetsUnchanged;
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ status: passed ? 'passed' : 'failed', code, signal, timedOut,
    platform: process.platform, arch: process.arch, electronVersion: require('../node_modules/electron/package.json').version,
    runtime, runtimeCopied: false, resultPath, hidden, result, rendererHtmlSha256: before, rendererHashes, assetsUnchanged, copiedEvidence }, null, 2));
  process.exitCode = passed ? 0 : 1;
});
