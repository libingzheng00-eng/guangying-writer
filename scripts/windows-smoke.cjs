/**
 * Windows packaged-payload smoke test. Run on a Windows desktop/CI runner:
 *   node scripts/windows-smoke.cjs --app release/windows/GuangyingWriter-win32-x64 --output release/windows-smoke
 *
 * The distributable is never edited. An independent temporary copy changes only
 * package.json's name/main and adds a QA entry; production main/preload/renderer
 * bytes are verified before and after. The copied packaged .exe runs those exact
 * production resources with an empty, test-owned userData, then restarts with the
 * same userData. Native dialog choices are stubbed, not the file IPC or close
 * guard. This is an instrumented packaged-payload test, not a claim of real IME,
 * native file-picker operation, installer, signing or cross-machine acceptance.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

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

async function main() {
  assert.equal(process.platform, 'win32', 'Windows smoke must execute on Windows; cross-build/static checks are not runtime evidence');
  const args = process.argv.slice(2);
  assert.equal(args.length, 4, 'Usage: node scripts/windows-smoke.cjs --app <packaged-directory> --output <new-evidence-directory>');
  assert.equal(args[0], '--app'); assert.equal(args[2], '--output');
  const source = fs.realpathSync(args[1]);
  const output = path.resolve(args[3]);
  const outputRelative = path.relative(source, output);
  assert.ok(outputRelative.startsWith('..' + path.sep) || outputRelative === '..' || path.isAbsolute(outputRelative), 'Evidence must be outside the distributable directory');
  assert.ok(!fs.existsSync(output), 'Evidence directory already exists; choose a new directory');
  const sourceApp = path.join(source, 'resources', 'app');
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceApp, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'guangying-writer');
  assert.equal(manifest.main, 'electron/main.js');
  const sourceHashes = treeHashes(sourceApp);
  assert.ok(sourceHashes['electron/main.js'] && sourceHashes['electron/preload.js'] && sourceHashes['dist-renderer/index.html']);
  assert.ok(fs.statSync(path.join(source, 'GuangyingWriter.exe')).isFile());
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-win-smoke-'));
  const candidate = path.join(temporary, 'candidate');
  fs.mkdirSync(output, { recursive: true });
  fs.cpSync(source, candidate, { recursive: true, errorOnExist: true, force: false, dereference: false });
  const qaApp = path.join(candidate, 'resources', 'app');
  assert.deepEqual(treeHashes(qaApp), sourceHashes, 'Copied production resources differ');
  fs.writeFileSync(path.join(qaApp, 'package.json'), JSON.stringify({ ...manifest, name: 'guangying-native-acceptance-qa', main: 'windows-smoke-shell.cjs' }, null, 2));
  fs.copyFileSync(path.join(__dirname, 'windows-smoke-shell.cjs'), path.join(qaApp, 'windows-smoke-shell.cjs'), fs.constants.COPYFILE_EXCL);
  const userData = path.join(temporary, '独立测试数据');
  const config = { temporary, output, userData, version: manifest.version, expectedPlatform: 'win32' };
  const configPath = path.join(temporary, 'smoke-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const report = {
    status: 'running', platform: process.platform, architecture: process.arch, version: manifest.version,
    scope: 'instrumented copy of Windows packaged executable and byte-identical production resources',
    limitations: ['Native file/save dialog selections are stubbed', 'CDP composition is not a real system IME',
      'No installer/signature/SmartScreen/cross-machine checks', 'PDF files are generated; full visual/font/layout inspection remains manual'],
    sourceHashes, phases: [],
  };
  function writeReport() { fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2)); }
  writeReport();
  try {
    for (const phase of ['first-launch', 'recovery']) {
      await new Promise((resolve, reject) => {
        const log = fs.createWriteStream(path.join(output, `${phase}.log`), { flags: 'wx' });
        const env = { ...process.env, GUANGYING_WINDOWS_SMOKE_CONFIG: configPath, GUANGYING_WINDOWS_SMOKE_PHASE: phase };
        delete env.ELECTRON_RUN_AS_NODE;
        delete env.ZS_DEV;
        const child = spawn(path.join(candidate, 'GuangyingWriter.exe'), [], { cwd: candidate, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let timedOut = false;
        let teardownDeadline;
        const timeout = setTimeout(() => {
          timedOut = true;
          // This PID belongs solely to this synthetic test; never find/kill by app name.
          if (child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
          teardownDeadline = setTimeout(() => {
            child.stdout.destroy(); child.stderr.destroy(); log.end();
            child.unref(); // A failed taskkill must not keep this failing CLI alive.
            reject(new Error(`${phase} timed out; owned process-tree teardown did not close its pipes`));
          }, 5000);
        }, 150000);
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
      assert.equal(result.platform, 'win32');
      assert.equal(result.phase, phase);
      assert.deepEqual(result.errors, [], 'No renderer/main errors may be hidden by a passing phase');
      report.phases.push(result); writeReport();
    }
    assert.deepEqual(treeHashes(sourceApp), sourceHashes, 'Source package was modified');
    assert.deepEqual(treeHashes(qaApp), sourceHashes, 'QA altered production main/preload/renderer');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.message;
    throw error;
  } finally { writeReport(); }
  console.log(`PASS Windows packaged-payload smoke: ${output}`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { treeHashes };
