/** Exact production allowlist, Windows PE architecture, and archive round-trip integrity. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const allowed = ['LICENSE', 'dist-renderer', 'electron', 'package.json'];
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function inventory(target) {
  const result = {};
  function visit(absolute, relative) {
    const stat = fs.lstatSync(absolute);
    assert.ok(!stat.isSymbolicLink(), `Symlink forbidden in production: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(absolute, name), relative ? `${relative}/${name}` : name);
    } else {
      assert.ok(stat.isFile(), `Special file forbidden: ${relative}`);
      result[relative] = { bytes: stat.size, sha256: sha256(absolute) };
    }
  }
  visit(target, '');
  return result;
}

function verifyPackage(appDir, expectedManifest) {
  const appRoot = path.join(appDir, 'resources', 'app');
  assert.deepEqual(fs.readdirSync(appRoot).sort(), allowed, 'Only production entries may be packaged');
  for (const entry of allowed) {
    if (entry === 'package.json') {
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(appRoot, entry), 'utf8')),
        JSON.parse(fs.readFileSync(path.join(root, entry), 'utf8')), 'Packaged manifest fields must match this checkout exactly');
      continue; // Packager serializes JSON; checkout line endings are immaterial.
    }
    assert.deepEqual(inventory(path.join(appRoot, entry)), inventory(path.join(root, entry)), `Packaged ${entry} must match this checkout exactly`);
  }
  for (const file of ['GuangyingWriter.exe', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'icudtl.dat', 'resources.pak', 'LICENSE', 'LICENSES.chromium.html', 'locales/en-US.pak', 'locales/zh-CN.pak']) {
    assert.ok(fs.statSync(path.join(appDir, file)).size > 0, `Runtime missing ${file}`);
  }
  assert.ok(!fs.existsSync(path.join(appDir, 'resources', 'default_app.asar')), 'Default Electron app must not ship');
  const exe = fs.readFileSync(path.join(appDir, 'GuangyingWriter.exe'));
  assert.equal(exe.toString('ascii', 0, 2), 'MZ', 'Windows executable required');
  const pe = exe.readUInt32LE(0x3c);
  assert.equal(exe.toString('ascii', pe, pe + 4), 'PE\0\0');
  assert.equal(exe.readUInt16LE(pe + 4), 0x8664, 'Windows x64 executable required');
  const files = inventory(appDir);
  if (expectedManifest) {
    assert.equal(expectedManifest.platform, 'win32');
    assert.equal(expectedManifest.arch, 'x64');
    assert.deepEqual(files, expectedManifest.files, 'Unzipped runtime must exactly match the built package');
  }
  return files;
}

if (require.main === module) {
  try {
    assert.ok(process.argv.length === 3 || process.argv.length === 4, 'Usage: node scripts/verify-windows-package.cjs <app-directory> [build-manifest.json]');
    const expected = process.argv[3] && JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const files = verifyPackage(path.resolve(process.argv[2]), expected);
    console.log(`Windows package verified: ${Object.keys(files).length} files; exact production sources, x64 PE, complete locales, no QA/user data.`);
  } catch (error) { console.error(error); process.exitCode = 1; }
}
module.exports = { inventory, verifyPackage };
