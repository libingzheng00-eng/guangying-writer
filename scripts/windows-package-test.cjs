/** Portable package integrity regression, synthetic files only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { windowsIcon } = require('./package-windows.cjs');
const { inventory, verifyPackage } = require('./verify-windows-package.cjs');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-package-test-'));
try {
  const ico = windowsIcon(fs.readFileSync(path.join(root, 'assets/app-icon.icns')));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 1);
  assert.equal(ico.readUInt32LE(18), 22);
  assert.equal(ico.readUInt32LE(14), ico.length - 22);
  assert.equal(ico.subarray(22, 30).toString('hex'), '89504e470d0a1a0a');
  assert.throws(() => windowsIcon(Buffer.from('not-an-icon')));
  const app = path.join(temp, 'package');
  const resources = path.join(app, 'resources', 'app');
  fs.mkdirSync(resources, { recursive: true });
  for (const entry of ['package.json', 'LICENSE', 'electron', 'dist-renderer']) {
    fs.cpSync(path.join(root, entry), path.join(resources, entry), { recursive: true });
  }
  for (const file of ['chrome_100_percent.pak', 'chrome_200_percent.pak', 'icudtl.dat', 'resources.pak', 'LICENSE', 'LICENSES.chromium.html', 'locales/en-US.pak', 'locales/zh-CN.pak']) {
    const target = path.join(app, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'synthetic-runtime');
  }
  const exe = Buffer.alloc(128);
  exe.write('MZ'); exe.writeUInt32LE(64, 0x3c); exe.write('PE\0\0', 64); exe.writeUInt16LE(0x8664, 68);
  fs.writeFileSync(path.join(app, 'GuangyingWriter.exe'), exe);
  const files = verifyPackage(app);
  assert.ok(Object.keys(files).some(name => name.startsWith('resources/app/electron/')));
  verifyPackage(app, { platform: 'win32', arch: 'x64', files });
  const packageFile = path.join(resources, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  fs.writeFileSync(packageFile, JSON.stringify(manifest));
  verifyPackage(app); // JSON formatting is allowed; dropping identity/fields is not.
  fs.writeFileSync(packageFile, JSON.stringify({ ...manifest, name: 'wrong-app' }));
  assert.throws(() => verifyPackage(app), /manifest fields/);
  fs.copyFileSync(path.join(root, 'package.json'), packageFile);
  fs.writeFileSync(path.join(app, 'icudtl.dat'), 'tampered');
  assert.throws(() => verifyPackage(app, { platform: 'win32', arch: 'x64', files }), /exactly match/);
  fs.writeFileSync(path.join(resources, 'private.zhsp'), 'synthetic-prohibited-file');
  assert.throws(() => verifyPackage(app), /Only production/);
  fs.unlinkSync(path.join(resources, 'private.zhsp'));
  fs.appendFileSync(path.join(resources, 'electron', 'main.js'), '\n// changed package');
  assert.throws(() => verifyPackage(app), /must match this checkout/);
  // A directory junction is unprivileged on Windows and remains a symlink to lstat.
  fs.symlinkSync(resources, path.join(temp, 'unsafe-link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => inventory(path.join(temp, 'unsafe-link')), /Symlink forbidden/);
  console.log('Windows package regression passed: existing icon, production allowlist, exact source/runtime hashes, tamper detection, symlink rejection.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
