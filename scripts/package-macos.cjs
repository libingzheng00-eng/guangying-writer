/** New candidate only; no installation, Release publication or existing asset replacement. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { verifyPackage, hash } = require('./verify-macos-package.cjs');
const root = path.resolve(__dirname, '..');

function main() {
  assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64');
  assert.ok(process.argv.length <= 3, 'Usage: node scripts/package-macos.cjs [new-output-directory]');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim(), '',
    'Commit tested source changes before packaging so the manifest identifies exact sources');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim();
  const out = path.resolve(process.argv[2] || path.join(root, 'release/macos-security'));
  const relativeOutput = path.relative(root, out);
  if (!relativeOutput.startsWith('..' + path.sep) && relativeOutput !== '..' && !path.isAbsolute(relativeOutput)) {
    const ignored = spawnSync('git', ['check-ignore', '--no-index', '-q', '--', path.join(out, 'candidate-output-probe')], { cwd: root, timeout: 10000 });
    assert.equal(ignored.status, 0, 'Use an ignored output directory or a directory outside the checkout so packaging preserves clean source status');
  }
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.mkdirSync(out);
  const result = spawnSync('bash', ['package.sh'], {
    cwd: root, env: { ...process.env, OUT_DIR: out, ARCH: 'arm64', APP_NAME: 'GuangyingWriter',
      DISPLAY_NAME: '光影写手', BUNDLE_ID: 'com.workbuddy.guangyingwriter' }, stdio: 'inherit', timeout: 480000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'macOS candidate packaging failed');
  const appDirectory = 'GuangyingWriter.app';
  const appDir = path.join(out, appDirectory);
  execFileSync(process.execPath, [path.join(__dirname, 'core-guard.cjs'), '--package', path.join(appDir, 'Contents/Resources/app')], { cwd: root, stdio: 'inherit', timeout: 30000 });
  const proof = verifyPackage(appDir);
  const manifest = require(path.join(root, 'package.json'));
  const signing = spawnSync('codesign', ['-dv', '--verbose=2', appDir], { encoding: 'utf8', timeout: 10000 });
  assert.equal(signing.status, 0); assert.match(signing.stderr, /Signature=adhoc/);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim(), commit);
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim(), '', 'Sources changed during packaging');
  fs.writeFileSync(path.join(out, 'build-manifest.json'), JSON.stringify({ schemaVersion: 1, commit,
    version: manifest.version, electronVersion: proof.electronVersion, platform: 'darwin', arch: proof.arch,
    minimumOS: proof.minimumOS, adHocSigned: true, notarized: false, appDirectory, files: proof.files,
  }, null, 2) + '\n', { flag: 'wx' });
  const zipName = 'GuangyingWriter-macOS-arm64.zip';
  fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), `${hash(path.join(out, zipName))}  ${zipName}\n`, { flag: 'wx' });
  fs.writeFileSync(path.join(out, 'signature-status.txt'), 'Ad-hoc signed; integrity verified; not Developer ID signed or Apple notarized.\n' + signing.stderr, { flag: 'wx' });
  console.log(`macOS arm64 candidate: ${appDir}`);
}
if (require.main === module) { try { main(); } catch (error) { console.error(error); process.exitCode = 1; } }
