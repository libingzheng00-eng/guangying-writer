/** Windows x64 portable build. Only the four production entries enter the app. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inventory, verifyPackage } = require('./verify-windows-package.cjs');

const root = path.resolve(__dirname, '..');
const entries = ['package.json', 'LICENSE', 'electron', 'dist-renderer'];

// Reuse the existing 256px PNG representation; no new artwork or system fonts.
function windowsIcon(icns) {
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
  for (let offset = 8; offset + 8 <= icns.length;) {
    const length = icns.readUInt32BE(offset + 4);
    assert.ok(length >= 8 && offset + length <= icns.length, 'Invalid ICNS chunk');
    if (icns.toString('ascii', offset, offset + 4) === 'ic08') {
      const png = icns.subarray(offset + 8, offset + length);
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(png.readUInt32BE(16), 256);
      assert.equal(png.readUInt32BE(20), 256);
      const header = Buffer.alloc(22);
      header.writeUInt16LE(1, 2); // ICO, one PNG image, 0 width/height means 256.
      header.writeUInt16LE(1, 4);
      header.writeUInt16LE(1, 10);
      header.writeUInt16LE(32, 12);
      header.writeUInt32LE(png.length, 14);
      header.writeUInt32LE(22, 18);
      return Buffer.concat([header, png]);
    }
    offset += length;
  }
  throw new Error('Existing app icon has no 256px PNG representation');
}

async function main() {
  assert.equal(process.platform, 'win32', 'Build on Windows (CI: windows-2022); cross-builds are not acceptance.');
  assert.equal(process.arch, 'x64', 'This candidate supports Windows x64 only.');
  assert.ok(process.argv.length <= 3, 'Usage: node scripts/package-windows.cjs [new-output-directory]');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim(), '',
    'Commit source changes before packaging so build-manifest.json identifies the actual sources.');
  const out = path.resolve(process.argv[2] || path.join(root, 'release', 'windows'));
  // Reserve a NEW output directory. Never delete/overwrite a previous candidate.
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(out);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-win-stage-'));
  try {
    for (const entry of entries) {
      // inventory rejects symlinks and special files before copying anything.
      inventory(path.join(root, entry));
      fs.cpSync(path.join(root, entry), path.join(stage, 'app', entry), { recursive: true, errorOnExist: true, force: false });
    }
    const icon = path.join(stage, 'app-icon.ico');
    fs.writeFileSync(icon, windowsIcon(fs.readFileSync(path.join(root, 'assets', 'app-icon.icns'))));
    const manifest = require(path.join(root, 'package.json'));
    const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
    // PE VERSIONINFO accepts up to four numeric fields, unlike the full alpha
    // SemVer in the application. Keep that full version in the runtime manifest.
    const peVersion = manifest.version.split('-')[0] + '.0';
    const { packager } = await import('@electron/packager');
    const [appDir] = await packager({
      dir: path.join(stage, 'app'), out, name: 'GuangyingWriter', executableName: 'GuangyingWriter',
      platform: 'win32', arch: 'x64', electronVersion, appVersion: peVersion,
      buildVersion: peVersion, icon, asar: false, prune: false, overwrite: false,
      // Keep the existing application identity/manifest; Packager normally strips
      // development fields. JSON whitespace may change, never runtime fields.
      sanitizePackageJson: [value => value],
      derefSymlinks: false,
      win32metadata: { ProductName: manifest.productName, FileDescription: manifest.productName, InternalName: manifest.name },
    });
    assert.ok(appDir, 'Packager did not produce a Windows application');
    // Packager also writes appVersion into its copied manifest. Restore the
    // exact source manifest before any verification, archive, or runtime test.
    fs.copyFileSync(path.join(root, 'package.json'), path.join(appDir, 'resources', 'app', 'package.json'));
    execFileSync(process.execPath, [path.join(__dirname, 'core-guard.cjs'), '--package', path.join(appDir, 'resources', 'app')], { cwd: root, stdio: 'inherit' });
    const evidence = verifyPackage(appDir);
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(out, 'build-manifest.json'), JSON.stringify({
      schemaVersion: 1, commit, version: manifest.version, electronVersion,
      platform: 'win32', arch: 'x64', authenticodeSigned: false,
      appDirectory: path.basename(appDir), files: evidence,
    }, null, 2) + '\n', { flag: 'wx' });
    console.log(`Windows x64 candidate: ${appDir}`);
  } finally {
    // Only the unique temporary staging directory created above is removed.
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { windowsIcon };
