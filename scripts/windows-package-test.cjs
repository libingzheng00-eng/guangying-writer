/** Portable package integrity regression, synthetic files only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { windowsIcon } = require('./package-windows.cjs');
const { inventory, verifyPackage } = require('./verify-windows-package.cjs');
const { copyQaEntries, phaseTimeoutMs, cleanEnvironment } = require('./windows-smoke.cjs');
const { inventory: desktopInventory, cleanEnvironment: rawEnvironment } = require('./desktop-launch.cjs');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-package-test-'));
try {
  const qa = path.join(temp, 'qa-only-helpers');
  fs.mkdirSync(qa);
  const qaHashes = copyQaEntries(qa);
  assert.deepEqual(Object.keys(qaHashes), ['windows-smoke-shell.cjs', 'windows-ui-layers.cjs', 'desktop-security-qa.cjs', 'startup-native-qa.cjs']);
  for (const name of Object.keys(qaHashes)) assert.equal(fs.readFileSync(path.join(qa, name), 'utf8'), fs.readFileSync(path.join(__dirname, name), 'utf8'));
  assert.throws(() => copyQaEntries(qa), /EEXIST/, 'QA staging cannot overwrite an existing helper');
  assert.ok(phaseTimeoutMs['first-launch'] >= 180000 && phaseTimeoutMs['first-launch'] <= 360000);
  assert.ok(phaseTimeoutMs.recovery > 0 && phaseTimeoutMs.recovery <= 90000);
  const poisonedEnvironment = { PATH: 'kept', NODE_OPTIONS: '--require attacker', Node_Path: '/foreign', ELECTRON_RUN_AS_NODE: '1',
    electron_no_asar: '1', ZS_DEV: '1', DYLD_INSERT_LIBRARIES: '/foreign', LD_PRELOAD: '/foreign',
    GUANGYING_WINDOWS_SMOKE_CONFIG: '/foreign', GUANGYING_DESKTOP_SMOKE_PHASE: 'foreign' };
  assert.deepEqual(rawEnvironment(poisonedEnvironment), { PATH: 'kept' }, 'Raw entry must reject inherited runtime/loader/dev injection');
  assert.deepEqual(cleanEnvironment('/owned/config.json', 'recovery', poisonedEnvironment), {
    PATH: 'kept', GUANGYING_WINDOWS_SMOKE_CONFIG: '/owned/config.json', GUANGYING_WINDOWS_SMOKE_PHASE: 'recovery',
  }, 'Only the task-owned QA config may be reintroduced after injection filtering');
  if (process.platform !== 'win32') {
    const bundle = path.join(temp, 'synthetic.app');
    fs.mkdirSync(path.join(bundle, 'Versions', 'A'), { recursive: true });
    fs.writeFileSync(path.join(bundle, 'Versions', 'A', 'runtime'), 'synthetic-runtime');
    fs.symlinkSync('A', path.join(bundle, 'Versions', 'Current'));
    const links = desktopInventory(bundle, { allowContainedSymlinks: true });
    assert.deepEqual(links['Versions/Current'], { type: 'symlink', target: 'A' });
    assert.equal(links['Versions/A/runtime'].type, 'file');
    assert.equal(Object.keys(links).length, 2, 'Mac framework inventory must not traverse symlink aliases');
    assert.throws(() => desktopInventory(bundle), /symbolic link/, 'Windows inventory still forbids every link');
    fs.symlinkSync('../../outside', path.join(bundle, 'escape'));
    assert.throws(() => desktopInventory(bundle, { allowContainedSymlinks: true }), /escapes/, 'Runtime links cannot leave a bundle');
  }
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
  console.log('Windows package regression passed: existing icon, production allowlist, exact source/runtime hashes, tamper detection, symlink rejection, exact QA helper copies, bounded phase budgets.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
