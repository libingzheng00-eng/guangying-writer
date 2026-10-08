/** macOS production allowlist, runtime identity and symlink-aware archive proof. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const allowed = ['LICENSE', 'dist-renderer', 'electron', 'package.json'];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

function inventory(directory, allowInternalLinks = false) {
  assert.ok(fs.lstatSync(directory).isDirectory(), 'Inventory root must be a real directory');
  const realRoot = fs.realpathSync(directory);
  const result = {};
  function visit(absolute, relative) {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      assert.ok(allowInternalLinks, `Symlink forbidden in app sources: ${relative}`);
      const target = fs.readlinkSync(absolute);
      assert.ok(!path.isAbsolute(target), `Absolute runtime link forbidden: ${relative}`);
      assert.ok(inside(realRoot, fs.realpathSync(absolute)), `Runtime link escapes bundle: ${relative}`);
      result[relative] = { type: 'symlink', target };
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(absolute, name), relative ? `${relative}/${name}` : name);
    } else {
      assert.ok(stat.isFile(), `Special file forbidden: ${relative}`);
      result[relative] = { type: 'file', bytes: stat.size, sha256: hash(absolute) };
    }
  }
  visit(directory, '');
  return result;
}

function plist(file, key) {
  return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, file], { encoding: 'utf8', timeout: 10000 }).trim();
}

function verifyPackage(appDir, expected) {
  assert.equal(process.platform, 'darwin', 'Verify this bundle on macOS');
  const appRoot = path.join(appDir, 'Contents/Resources/app');
  assert.deepEqual(fs.readdirSync(appRoot).sort(), allowed, 'Only production entries may be packaged');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const entry of allowed) {
    const source = path.join(root, entry), target = path.join(appRoot, entry);
    if (entry === 'package.json') {
      assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), manifest, 'Packaged manifest must match source');
    } else if (fs.statSync(source).isDirectory()) {
      assert.deepEqual(inventory(target), inventory(source), `Packaged ${entry} must match this checkout exactly`);
    } else {
      assert.equal(hash(target), hash(source), `Packaged ${entry} must match source`);
    }
  }
  assert.ok(!fs.existsSync(path.join(appDir, 'Contents/Resources/default_app.asar')), 'Default app must not ship');
  const info = path.join(appDir, 'Contents/Info.plist');
  assert.equal(plist(info, 'CFBundleExecutable'), 'GuangyingWriter');
  assert.equal(plist(info, 'CFBundleIdentifier'), 'com.workbuddy.guangyingwriter');
  assert.equal(plist(info, 'CFBundleDisplayName'), manifest.productName);
  assert.equal(plist(info, 'CFBundleShortVersionString'), manifest.version);
  assert.equal(plist(info, 'CFBundleVersion'), manifest.version);
  const minimumOS = plist(info, 'LSMinimumSystemVersion');
  assert.equal(minimumOS.split('.')[0], '13', 'Electron 44 candidate requires macOS 13+');
  const executable = path.join(appDir, 'Contents/MacOS/GuangyingWriter');
  const arch = execFileSync('lipo', ['-archs', executable], { encoding: 'utf8', timeout: 10000 }).trim();
  assert.equal(arch, 'arm64', 'This macOS candidate is Apple Silicon only');
  const frameworkInfo = path.join(appDir, 'Contents/Frameworks/Electron Framework.framework/Resources/Info.plist');
  const electronVersion = plist(frameworkInfo, 'CFBundleVersion');
  assert.equal(electronVersion, require(path.join(root, 'node_modules/electron/package.json')).version);
  for (const required of ['Contents/Resources/app-icon.icns', 'Contents/Frameworks/Electron Framework.framework/Electron Framework']) {
    assert.ok(fs.statSync(path.join(appDir, required)).size > 0, `Runtime missing ${required}`);
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', appDir], { timeout: 30000, stdio: 'pipe' });
  const files = inventory(appDir, true);
  if (expected) {
    assert.equal(expected.platform, 'darwin'); assert.equal(expected.arch, arch);
    assert.equal(expected.version, manifest.version); assert.equal(expected.electronVersion, electronVersion);
    assert.equal(expected.minimumOS, minimumOS);
    assert.deepEqual(files, expected.files, 'Unzipped macOS bundle must match built files and symlinks exactly');
  }
  return { files, arch, electronVersion, minimumOS };
}

if (require.main === module) {
  try {
    assert.ok(process.argv.length === 3 || process.argv.length === 4, 'Usage: node scripts/verify-macos-package.cjs <app-directory> [build-manifest.json]');
    const expected = process.argv[3] && JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const proof = verifyPackage(path.resolve(process.argv[2]), expected);
    console.log(`macOS package verified: ${Object.keys(proof.files).length} entries; arm64, Electron ${proof.electronVersion}, macOS ${proof.minimumOS}+, exact production sources and ad-hoc signature integrity.`);
  } catch (error) { console.error(error); process.exitCode = 1; }
}
module.exports = { inventory, verifyPackage, hash };
