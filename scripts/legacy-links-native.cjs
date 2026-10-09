/** Hidden synthetic legacy-link acceptance, reusing the task's existing runtime.
 * node scripts/legacy-links-native.cjs --output /absolute/new/evidence-directory
 * The production renderer must already be built. No private file is accepted.
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
assert.deepEqual(process.argv.slice(2, 3), ['--output']);
assert.equal(process.argv.length, 4);
const output = process.argv[3]; assert.ok(path.isAbsolute(output)); fs.mkdirSync(output);
const runtime = require('electron');
const expectedRuntime = path.join(root, 'node_modules/electron/dist', process.platform === 'darwin'
  ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron');
assert.equal(fs.realpathSync(runtime), fs.realpathSync(expectedRuntime));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  assert.ok(!entry.isSymbolicLink()); const file = path.join(dir, entry.name); return entry.isDirectory() ? files(file) : [file];
});
const tracked = [path.join(root, 'package.json'), ...['src', 'electron', 'dist-renderer'].flatMap(dir => files(path.join(root, dir))),
  __filename, path.join(__dirname, 'legacy-links-shell.cjs')];
const sourceHashes = Object.fromEntries(tracked.map(file => [path.relative(root, file), hash(file)]));
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-legacy-links-')));
const shell = path.join(temporary, 'shell'), userData = path.join(temporary, 'userData');
fs.mkdirSync(shell); fs.mkdirSync(userData);
const project = {
  id: 'synthetic-legacy-links', name: '合成旧连线兼容工程', createdAt: 123, updatedAt: 456, targetPages: 88,
  titlePage: { show: false, title: '合成标题', author: '合成作者', contact: '合成联系资料', notes: '仅供测试' },
  settings: { smartQuotes: true, contdCharacter: true, lineHeight: 1.75 },
  elements: [1, 2, 3].flatMap(n => [{ id: `scene-${n}`, type: 'scene_heading', text: `内景 合成第${n}场 日` },
    { id: `action-${n}`, type: 'action', text: `第${n}场<b>合成正文</b>，全部内容必须保留。` }]),
  sceneMeta: [1, 2, 3].map(n => ({ id: `meta-${n}`, elementId: `scene-${n}`, title: `合成场名${n}`,
    synopsis: `合成摘要${n}`, color: '#cfe4ff', x: n * 330, y: n * 40, w: 280, h: 180, extra: { synthetic: n } })),
  beats: [{ id: 'beat-note', kind: 'beat', title: '合成卡标题', text: '合成卡备注', color: '#fff7d6', x: 840, y: 250,
    boardX: 180, boardY: 330, w: 260, h: 210, sceneId: 'scene-2' }],
  acts: [{ id: 'act-synthetic', title: '合成幕', color: '#cfe4ff' }],
  revisions: [{ id: 'revision-synthetic', label: '合成修订', color: '#ccddff' }],
  boardLinks: [
    { id: 'old-existing', fromId: 'scene-1', toId: 'beat-note', note: '旧关系说明保留', extra: { dash: true, weight: 2 } },
    { id: 'old-missing', fromId: 'scene-3', toId: 'deleted-card', note: '缺失端点仍保留关系说明', extra: { retained: true } },
    { id: 'current-pair', from: 'scene:scene-2', to: 'scene:scene-3', note: '现行关系说明', extra: { style: 'solid' } },
    { id: 'current-aliases', from: 'beat:beat-note', to: 'scene:scene-1', fromId: 'stale-from', toId: 'stale-to',
      note: '现行端点优先且旧别名保留', extra: { aliases: ['synthetic', 'preserved'] } },
  ],
};
const expectedLinks = project.boardLinks.map((link, index) => index === 0 ? { ...link, from: 'scene:scene-1', to: 'beat:beat-note' }
  : index === 1 ? { ...link, from: 'scene:scene-3', to: 'deleted-card' } : link);
const write = (name, value) => {
  const file = path.join(temporary, name); fs.writeFileSync(file, JSON.stringify({ app: 'mojiang', fileVersion: 1, savedAt: 1, project: value }), { flag: 'wx' }); return file;
};
const fixture = write('合成 旧连线.zhsp', project);
const invalidFiles = [
  write('合成 混合不完整端点.zhsp', { ...project, boardLinks: [{ ...project.boardLinks[0], from: 'scene:scene-1' }] }),
  write('合成 恶意端点.zhsp', { ...project, boardLinks: [{ ...project.boardLinks[0], from: 'scene:__proto__', to: 'beat:beat-note' }] }),
];
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
fs.writeFileSync(path.join(shell, 'package.json'), JSON.stringify({ name: 'guangying-native-acceptance-qa', version,
  main: path.join(__dirname, 'legacy-links-shell.cjs') }), { flag: 'wx' });
const configPath = path.join(temporary, 'config.json');
const config = { root, temporary, shell, userData, output, runtime, fixture, invalidFiles, project, expectedLinks,
  initialHashes: Object.fromEntries([fixture, ...invalidFiles].map(file => [file, hash(file)])),
  expected: path.join(temporary, 'expected.json'), sourceHashes, configPath };
fs.writeFileSync(configPath, JSON.stringify(config), { flag: 'wx' });
const report = { status: 'running', version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'hidden production main/preload/built renderer and real IPC with synthetic projects only',
  temporary, userData, runtime, runtimeCopied: false, sourceHashes, phases: [], limitations: [
    'Owned QA windows suppress show/focus, use DOM button clicks and production MenuItem callbacks; no physical input or visual acceptance is claimed.',
    'Native picker/close choices are stubs. Restart uses real Continue and Save before recent reopening; unchanged dirty replacement protection requires no confirm on this clean path.',
  ] };
const journal = () => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
async function phase(stage) {
  const fd = fs.openSync(path.join(output, `${stage}.log`), 'wx');
  const env = { ...cleanEnvironment(process.env), GUANGYING_LEGACY_LINKS_CONFIG: configPath, GUANGYING_LEGACY_LINKS_STAGE: stage };
  const exit = await new Promise(resolve => {
    const child = spawn(runtime, [shell, `--user-data-dir=${userData}`], { cwd: shell, env, detached: process.platform !== 'win32', stdio: ['ignore', fd, fd] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stopOwnedChild(child, process.platform); }, 90000);
    child.once('error', error => { clearTimeout(timer); resolve({ error: error.message }); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, timedOut }); });
  }); fs.closeSync(fd);
  const resultPath = path.join(output, `${stage}.json`);
  const result = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : { status: 'failed', stage, error: 'No shell result; inspect phase log' };
  result.processExit = exit; if (exit.code !== 0 || exit.signal || exit.timedOut) result.status = 'failed';
  report.phases.push(result); journal(); console.log(stage, result.status, result.error || ''); return result;
}
(async () => {
  journal(); console.log('OUTPUT', output);
  if ((await phase('open-save')).status === 'passed') await phase('restart-recent');
  report.sourceUnchanged = tracked.every(file => hash(file) === sourceHashes[path.relative(root, file)]);
  report.rejectedFilesUnchanged = invalidFiles.every(file => hash(file) === config.initialHashes[file]);
  report.status = report.phases.length === 2 && report.phases.every(p => p.status === 'passed') && report.sourceUnchanged && report.rejectedFilesUnchanged ? 'passed' : 'failed';
  journal(); console.log('RESULT', report.status, path.join(output, 'result.json')); process.exitCode = report.status === 'passed' ? 0 : 1;
})().catch(error => { report.status = 'failed'; report.error = error.stack || String(error); journal(); console.error(error); process.exitCode = 1; });
