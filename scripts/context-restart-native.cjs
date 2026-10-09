/**
 * Real independent-process writing-context acceptance using the existing local
 * Electron executable. No runtime copy, renderer/store seed, or user profile.
 * Usage: node scripts/context-restart-native.cjs [--case offscreen-scroll|visible-scroll|board|missing-scene]
 *   [--output /absolute/new/evidence/directory]
 * The existing dist-renderer must already be built from the source under test.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { cleanEnvironment } = require('./desktop-launch.cjs');
const { stopOwnedChild } = require('./desktop-smoke.cjs');

const root = path.resolve(__dirname, '..');
const cases = ['offscreen-scroll', 'visible-scroll', 'board', 'missing-scene'];
const args = process.argv.slice(2);
let selected = cases, requestedOutput;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--case') {
    const name = args[++index]; assert.ok(cases.includes(name), 'Unknown context case'); selected = [name];
  } else if (args[index] === '--output') {
    requestedOutput = args[++index]; assert.ok(requestedOutput && path.isAbsolute(requestedOutput), '--output needs an absolute new directory');
  } else throw new Error('Unknown argument: ' + args[index]);
}
assert.ok(!process.versions.electron, 'Run the orchestrator with Node, not Electron');
const runtime = require('electron');
const expectedRuntime = process.platform === 'darwin'
  ? path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : process.platform === 'win32' ? path.join(root, 'node_modules/electron/dist/electron.exe')
    : path.join(root, 'node_modules/electron/dist/electron');
assert.equal(fs.realpathSync(runtime), fs.realpathSync(expectedRuntime), 'Only this task installation runtime is allowed');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const filesUnder = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name);
  assert.ok(!entry.isSymbolicLink(), 'Candidate source/renderer cannot be symlinked');
  return entry.isDirectory() ? filesUnder(file) : [file];
});
const inspected = [path.join(root, 'package.json'), ...filesUnder(path.join(root, 'electron')),
  ...filesUnder(path.join(root, 'dist-renderer')), ...filesUnder(path.join(root, 'src')),
  __filename, path.join(__dirname, 'context-restart-shell.cjs')];
const sourceHashes = Object.fromEntries(inspected.map(file => [path.relative(root, file), hash(file)]));
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-context-restart-')));
const output = requestedOutput || path.join(temporary, 'evidence');
fs.mkdirSync(output, { recursive: false });
const shell = path.join(temporary, 'shell'); fs.mkdirSync(shell);
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(shell, 'package.json'), JSON.stringify({
  name: 'guangying-native-acceptance-qa', version: packageInfo.version,
  main: path.join(__dirname, 'context-restart-shell.cjs'),
}), { flag: 'wx' });
const report = { status: 'running', scope: 'source production main/preload/built renderer; existing task Electron runtime',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  platform: process.platform, architecture: process.arch, temporary, output, runtime, runtimeCopied: false,
  sourceHashes, phases: [], limitations: [
    'Native picker and production close-dialog choices are queued; this is not manual system picker acceptance.',
    'The missing-scene replacement uses the real Chromium confirm dialog accepted through CDP; window.confirm is not replaced.',
    'This source harness does not prove an installed package or physical system shortcut/IME behavior.',
  ] };
const journal = () => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
const projectFor = name => {
  const project = { id: `context-native-${name}`, name: `合成上下文 ${name}`, createdAt: 1, updatedAt: 1,
    titlePage: { show: false, title: '', author: '', contact: '', notes: '' },
    settings: { smartQuotes: true, contdCharacter: true }, acts: [], sceneMeta: [],
    boardLinks: [], revisions: [], elements: [], beats: [], targetPages: 100 };
  for (let scene = 1; scene <= 3; scene++) {
    project.elements.push({ id: `context-s${scene}`, type: 'scene_heading', text: `内景 合成第${scene}场 日` });
    project.sceneMeta.push({ id: `context-meta${scene}`, elementId: `context-s${scene}`, title: '',
      synopsis: `仅供跨进程恢复验收的第${scene}场。`, color: '#cfe4ff' });
    for (let paragraph = 0; paragraph < 12; paragraph++) project.elements.push({
      id: `context-s${scene}-a${paragraph}`, type: 'action',
      text: `第${scene}场第${paragraph + 1}段合成正文，用于滚动与独立重启位置验收，不含用户资料。`.repeat(4),
    });
  }
  return project;
};
async function launch(config, stage) {
  const log = fs.openSync(path.join(output, `${config.name}-${stage}.log`), 'wx');
  const env = { ...cleanEnvironment(process.env), GUANGYING_CONTEXT_RESTART_CONFIG: config.configPath, GUANGYING_CONTEXT_RESTART_STAGE: stage };
  console.log('START', config.name, stage, 'isolated profile:', config.userData);
  const outcome = await new Promise(resolve => {
    const child = spawn(runtime, [shell], { cwd: root, env, stdio: ['ignore', log, log], detached: process.platform !== 'win32' });
    let timedOut = false;
    const timeout = setTimeout(() => {
      // A failed/hung test owns this PID and synthetic profile. This emergency
      // teardown is never reported as production close-guard acceptance.
      timedOut = true; stopOwnedChild(child, process.platform);
    }, 90000);
    child.once('error', error => { clearTimeout(timeout); resolve({ error: error.message }); });
    child.once('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, timedOut }); });
  });
  fs.closeSync(log);
  const file = path.join(output, `${config.name}-${stage}.json`);
  const phase = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { status: 'failed', case: config.name, stage, error: 'No shell result; inspect its launch log' };
  phase.processExit = outcome;
  if (outcome.code !== 0 || outcome.timedOut || outcome.error) phase.status = 'failed';
  report.phases.push(phase); journal();
  console.log(phase.status.toUpperCase(), config.name, stage, phase.error || '');
  return phase;
}
async function main() {
  journal();
  for (const name of selected) {
    const directory = path.join(temporary, name); fs.mkdirSync(directory);
    const fixture = path.join(directory, '合成 长文工程.zhsp');
    const project = projectFor(name);
    fs.writeFileSync(fixture, JSON.stringify({ app: 'guangying-writer', fileVersion: 1, savedAt: 1, project }), { flag: 'wx' });
    const config = { name, temporary, directory, output, root, runtime, shell,
      projectId: project.id, fixture, userData: path.join(directory, 'userData'),
      expected: path.join(directory, 'expected.json'), configPath: path.join(directory, 'config.json'), sourceHashes };
    fs.mkdirSync(config.userData);
    fs.writeFileSync(config.configPath, JSON.stringify(config), { flag: 'wx' });
    const prepared = await launch(config, 'prepare');
    if (prepared.status !== 'passed') continue;
    if (name === 'missing-scene') {
      // Only this known newly generated file is edited, between normal process
      // shutdown and restart. Keep its inode so the prior explicit grant remains
      // valid; no user profile or writing-context/recovery storage is modified.
      const prior = JSON.parse(fs.readFileSync(fixture, 'utf8'));
      assert.equal(prior.project.id, project.id);
      const start = prior.project.elements.findIndex(element => element.id === 'context-s3');
      assert.ok(start > 0);
      const removed = prior.project.elements.splice(start).map(element => element.id);
      prior.project.sceneMeta = prior.project.sceneMeta.filter(meta => !removed.includes(meta.elementId));
      prior.savedAt = Date.now();
      fs.writeFileSync(fixture, JSON.stringify(prior));
      fs.writeFileSync(path.join(directory, 'external-change.json'), JSON.stringify({
        removed, project: prior.project, hash: hash(fixture), method: 'in-place write to generated synthetic disk fixture only',
      }, null, 2), { flag: 'wx' });
    }
    await launch(config, 'restart');
  }
  const changed = inspected.filter(file => hash(file) !== sourceHashes[path.relative(root, file)]).map(file => path.relative(root, file));
  report.sourceUnchanged = changed.length === 0; report.changedFiles = changed;
  report.status = report.phases.length === selected.length * 2 && report.phases.every(phase => phase.status === 'passed') && !changed.length ? 'passed' : 'failed';
  journal(); console.log('RESULT', report.status, path.join(output, 'result.json'));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
main().catch(error => { report.status = 'failed'; report.error = error.stack || String(error); journal(); console.error(error); process.exitCode = 1; });
