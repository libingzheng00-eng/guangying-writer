/**
 * Shared packaged-payload QA for macOS and Windows. Platform wrappers:
 *   node scripts/windows-smoke.cjs --app release/windows/GuangyingWriter-win32-x64 --output release/windows-smoke
 *
 * The distributable is never edited. An independent temporary copy changes its
 * package.json name/main and adds QA entries; Mac also receives a distinct bundle
 * identity and ad-hoc signature. Production main/preload/renderer bytes are
 * verified before and after. The copied packaged executable runs those exact
 * production resources with an empty, test-owned userData, then restarts with the
 * same userData for home recovery and automatic-resume phases. Native dialog
 * choices are stubbed, not the file IPC or close
 * guard. This is an instrumented packaged-payload test, not a claim of real IME,
 * native file-picker operation, installer, signing or cross-machine acceptance.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { cleanEnvironment: cleanRuntimeEnvironment, inventory } = require('./desktop-launch.cjs');

const qaEntries = ['windows-smoke-shell.cjs', 'windows-ui-layers.cjs', 'desktop-security-qa.cjs', 'startup-native-qa.cjs'];
const phaseTimeoutMs = { 'first-launch': 360000, recovery: 90000, 'auto-resume': 90000 };
function copyQaEntries(destination) {
  const hashes = {};
  for (const name of qaEntries) {
    const source = path.join(__dirname, name);
    const target = path.join(destination, name);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    const expected = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const actual = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    assert.equal(actual, expected, `QA helper copy differs: ${name}`);
    hashes[name] = actual;
  }
  return hashes;
}

function treeHashes(root) {
  const result = {};
  function walk(relative) {
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file);
    assert.ok(!stat.isSymbolicLink(), 'Smoke input must not contain symbolic links');
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) walk(path.join(relative, name));
    else if (stat.isFile()) result[relative.split(path.sep).join('/')] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    else throw new Error('Smoke input must contain only regular files/directories');
  }
  for (const dir of ['electron', 'dist-renderer']) walk(dir);
  return result;
}

const root = path.resolve(__dirname, '..');
const outside = (parent, child) => { const relative = path.relative(parent, child); return relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative); };
function packageLayout(directory, platform) {
  if (platform === 'win32') return { app: path.join(directory, 'resources', 'app'), executable: path.join(directory, 'GuangyingWriter.exe') };
  const executableName = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(directory, 'Contents', 'Info.plist')], { encoding: 'utf8', timeout: 10000 }).trim();
  assert.ok(executableName && path.basename(executableName) === executableName);
  return { app: path.join(directory, 'Contents', 'Resources', 'app'), executable: path.join(directory, 'Contents', 'MacOS', executableName) };
}
function cleanEnvironment(configPath, phase, base = process.env) {
  // Share raw startup's injection filtering; only these two task-owned entries
  // are then supplied to the isolated QA child.
  return { ...cleanRuntimeEnvironment(base), GUANGYING_WINDOWS_SMOKE_CONFIG: configPath, GUANGYING_WINDOWS_SMOKE_PHASE: phase };
}
function stopOwnedChild(child, platform) {
  if (!child.pid) return;
  if (platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
}
async function main(platform) {
  assert.ok(['win32', 'darwin'].includes(platform));
  assert.equal(process.platform, platform, 'Desktop QA must execute on its target platform; cross-build/static checks are not runtime evidence');
  const args = process.argv.slice(2);
  assert.ok(args.length === 4 || args.length === 6, 'Usage: node scripts/{windows,macos}-smoke.cjs --app <packaged-directory> --output <new-evidence-directory> [--manifest <build-manifest.json>]');
  if (args.length === 6) assert.equal(args[4], '--manifest');
  assert.equal(args[0], '--app'); assert.equal(args[2], '--output');
  const source = fs.realpathSync(args[1]);
  const output = path.resolve(args[3]);
  const outputRelative = path.relative(source, output);
  assert.ok(outputRelative.startsWith('..' + path.sep) || outputRelative === '..' || path.isAbsolute(outputRelative), 'Evidence must be outside the distributable directory');
  assert.ok(!fs.existsSync(output), 'Evidence directory already exists; choose a new directory');
  const sourceLayout = packageLayout(source, platform);
  const sourceApp = sourceLayout.app;
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceApp, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'guangying-writer');
  assert.equal(manifest.main, 'electron/main.js');
  const sourceHashes = treeHashes(sourceApp);
  assert.ok(sourceHashes['electron/main.js'] && sourceHashes['electron/preload.js'] && sourceHashes['dist-renderer/index.html']);
  assert.ok(fs.statSync(sourceLayout.executable).isFile());
  const cleanStatus = () => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim();
  assert.equal(cleanStatus(), '', 'Packaged QA requires a clean checkout of the final head');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim();
  const expectedElectron = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  assert.equal(expectedElectron, '44.7.0', 'Review this QA runtime contract before changing Electron');
  assert.deepEqual(treeHashes(root), sourceHashes, 'Packaged production resources must match this exact checkout/build');
  const expectedManifest = args[5] && JSON.parse(fs.readFileSync(args[5], 'utf8'));
  const verify = platform === 'win32' ? require('./verify-windows-package.cjs').verifyPackage : (...values) => require('./verify-macos-package.cjs').verifyPackage(...values).files;
  const sourceInventory = verify(source, expectedManifest);
  if (expectedManifest) {
    assert.equal(expectedManifest.commit, commit); assert.equal(expectedManifest.electronVersion, expectedElectron);
    assert.equal(expectedManifest.version, manifest.version); assert.equal(expectedManifest.platform, platform); assert.equal(expectedManifest.arch, process.arch);
  }
  const provenance = { commit, electronVersion: expectedElectron, sourceManifestSHA256: args[5] ? createHash('sha256').update(fs.readFileSync(args[5])).digest('hex') : null,
    packageLockSHA256: createHash('sha256').update(fs.readFileSync(path.join(root, 'package-lock.json'))).digest('hex') };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  assert.ok(outside(source, path.join(fs.realpathSync(path.dirname(output)), path.basename(output))), 'Evidence parent must not alias the distributable');
  const temporary = (fs.realpathSync.native || fs.realpathSync)(fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-desktop-smoke-')));
  // Keep a literal ~ even when native realpath expands Windows 8.3 aliases.
  // Real packaged IPC must accept Node/Chromium's equivalent URL spellings.
  const candidate = path.join(temporary, 'qa~entry', platform === 'darwin' ? 'GuangyingWriter-QA.app' : 'candidate');
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(path.dirname(candidate));
  if (platform === 'darwin') execFileSync('/usr/bin/ditto', [source, candidate], { timeout: 120000 });
  else fs.cpSync(source, candidate, { recursive: true, errorOnExist: true, force: false, dereference: false });
  assert.deepEqual(verify(candidate, expectedManifest), sourceInventory, 'Copied runtime and production resources differ before QA instrumentation');
  const candidateLayout = packageLayout(candidate, platform);
  const qaApp = candidateLayout.app;
  assert.deepEqual(treeHashes(qaApp), sourceHashes, 'Copied production resources differ');
  fs.writeFileSync(path.join(qaApp, 'package.json'), JSON.stringify({ ...manifest, name: 'guangying-native-acceptance-qa', main: 'windows-smoke-shell.cjs' }, null, 2));
  const qaHashes = copyQaEntries(qaApp);
  if (platform === 'darwin') {
    const plist = path.join(candidate, 'Contents', 'Info.plist');
    for (const [key, value] of [['CFBundleIdentifier', 'com.guangyingwriter.qa.' + path.basename(temporary)], ['CFBundleName', 'GuangyingWriter QA'], ['CFBundleDisplayName', '光影写手独立验收']]) {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist], { timeout: 10000 });
    }
    // Re-sign only this new QA copy after its manifest/helper/identity changes.
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', candidate], { timeout: 120000 });
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate], { timeout: 30000 });
  }
  const userData = path.join(temporary, '独立测试数据');
  const qaInventoryOptions = { allowContainedSymlinks: platform === 'darwin' };
  const preparedQaInventory = inventory(candidate, qaInventoryOptions);
  const config = { temporary, output, userData, version: manifest.version, expectedPlatform: platform, expectedArch: process.arch, expectedElectron, expectedExecutable: candidateLayout.executable, ...provenance, phaseTimeoutMs, uiTimeoutMs: 180000 };
  const configPath = path.join(temporary, 'smoke-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const report = {
    status: 'running', platform: process.platform, architecture: process.arch, version: manifest.version,
    scope: 'instrumented copy of packaged desktop executable and byte-identical production resources',
    ...provenance, runtimeBeforeQA: sourceInventory, preparedQaInventory,
    limitations: ['Native file/save dialog selections are stubbed', 'CDP composition is not a real system IME',
      'Native menu callbacks exercise the production IPC route, not system-menu pointer operation',
      ...(platform === 'darwin' ? ['Mac native commands validate exact accelerators and invoke production MenuItem callbacks; physical Command-key dispatch through Cocoa is not verified', 'Mac modal field selection uses Chromium selectAll as input preparation, not a physical Cmd+A check'] : []),
      ...(platform === 'darwin' ? ['Only the isolated QA primary window adds enableLargerThanScreen; renderer viewport checks do not prove the entire window fits the physical display'] : []),
      'No installer/signature/SmartScreen/cross-machine checks', 'PDF files are generated; full visual/font/layout inspection remains manual'],
    sourceHashes, qaHashes, phaseTimeoutMs, uiTimeoutMs: config.uiTimeoutMs, phases: [],
  };
  function writeReport() { fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2)); }
  writeReport();
  try {
    for (const phase of ['first-launch', 'recovery', 'auto-resume']) {
      await new Promise((resolve, reject) => {
        const log = fs.createWriteStream(path.join(output, `${phase}.log`), { flags: 'wx' });
        const env = cleanEnvironment(configPath, phase);
        const child = spawn(candidateLayout.executable, [], { cwd: candidate, env, detached: platform === 'darwin', stdio: ['ignore', 'pipe', 'pipe'] });
        let timedOut = false;
        let teardownDeadline;
        const timeout = setTimeout(() => {
          timedOut = true;
          // This PID belongs solely to this synthetic test; never find/kill by app name.
          try { stopOwnedChild(child, platform); } catch (error) { console.error('Owned QA teardown failed:', error.message); }
          teardownDeadline = setTimeout(() => {
            child.stdout.destroy(); child.stderr.destroy(); log.end();
            child.unref(); // A failed taskkill must not keep this failing CLI alive.
            reject(new Error(`${phase} timed out; owned process-tree teardown did not close its pipes`));
          }, 5000);
        }, phaseTimeoutMs[phase]);
        for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log.write(data); process.stdout.write(data); });
        child.on('error', error => { clearTimeout(timeout); clearTimeout(teardownDeadline); log.end(); reject(error); });
        child.on('close', (code, signal) => {
          clearTimeout(timeout); clearTimeout(teardownDeadline); log.end();
          if (timedOut || code !== 0) reject(new Error(`${phase} failed: ${timedOut ? 'timeout (owned process terminated)' : `exit ${code}, signal ${signal}`}`));
          else resolve();
        });
      });
      const result = JSON.parse(fs.readFileSync(path.join(output, `${phase}.json`), 'utf8'));
      assert.equal(result.status, 'passed');
      assert.equal(result.platform, platform);
      assert.equal(result.electron, expectedElectron);
      assert.equal(result.commit, commit);
      assert.equal(result.phase, phase);
      assert.deepEqual(result.errors, [], 'No renderer/main errors may be hidden by a passing phase');
      report.phases.push(result); writeReport();
    }
    assert.deepEqual(verify(source, expectedManifest), sourceInventory, 'Source package/runtime was modified');
    assert.deepEqual(treeHashes(sourceApp), sourceHashes, 'Source package was modified');
    assert.deepEqual(treeHashes(qaApp), sourceHashes, 'QA altered production main/preload/renderer');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.message;
    throw error;
  } finally {
    try {
      assert.deepEqual(verify(source, expectedManifest), sourceInventory, 'Source package/runtime changed during QA');
      assert.deepEqual(treeHashes(qaApp), sourceHashes, 'QA altered production main/preload/renderer');
      assert.deepEqual(inventory(candidate, qaInventoryOptions), preparedQaInventory, 'QA execution altered its prepared executable/runtime/helper bytes or links');
      assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim(), commit);
      assert.equal(cleanStatus(), '', 'Checkout changed during QA');
      report.packageUnchanged = true;
    } catch (error) {
      report.status = 'failed'; report.packageUnchanged = false; report.integrityError = error.message;
    }
    writeReport();
  }
  assert.equal(report.status, 'passed', report.integrityError || report.error);
  console.log(`PASS ${platform} packaged-payload smoke: ${output}`);
}
module.exports = { main, treeHashes, copyQaEntries, phaseTimeoutMs, cleanEnvironment, stopOwnedChild };
