/** Fixed hidden character-line acceptance against production main/preload/React.
 * Uses the existing runtime twice with one isolated, synthetic-only userData.
 * No runtime/dependency download, installation, private path or app attachment.
 * node scripts/character-lines-native.cjs --output /absolute/new/evidence-dir
 * Optional --python /absolute/python (existing pypdf required for PDF inspection).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { cleanEnvironment } = require('./desktop-launch.cjs');
const { stopOwnedChild } = require('./desktop-smoke.cjs');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
assert.ok(args.length === 2 || args.length === 4);
assert.equal(args[0], '--output'); const output = args[1]; assert.ok(path.isAbsolute(output));
if (args.length === 4) { assert.equal(args[2], '--python'); assert.ok(path.isAbsolute(args[3])); }
const python = args[3] || (process.platform === 'win32' ? 'python' : 'python3');
const pdfProbe = spawnSync(python, ['-c', 'import pypdf; print(pypdf.__version__)'], { encoding: 'utf8', timeout: 15000 });
assert.equal(pdfProbe.status, 0, 'An existing Python with pypdf is required before starting native acceptance; no dependency is installed automatically.');
const runtime = path.join(root, 'node_modules/electron/dist', process.platform === 'darwin'
  ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron');
assert.ok(fs.statSync(runtime).isFile(), 'Existing locked Electron runtime is required');
fs.mkdirSync(output);
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'QA source inventory does not follow links');
    const file = path.join(directory, entry.name); return entry.isDirectory() ? files(file) : [file];
  });
}
const tracked = [path.join(root, 'package.json'), path.join(root, 'package-lock.json'),
  ...['src', 'electron', 'dist-renderer'].flatMap(name => files(path.join(root, name))),
  __filename, path.join(__dirname, 'character-lines-electron.cjs'), path.join(__dirname, 'native-acceptance-launcher.cjs')];
const sourceHashes = Object.fromEntries(tracked.map(file => [path.relative(root, file), hash(file)]));
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-character-native-')));
const shell = path.join(temporary, 'shell'), userData = path.join(temporary, 'userData');
fs.mkdirSync(shell); fs.mkdirSync(userData);
const el = (id, type, text, extra = {}) => ({ id, type, text, ...extra });
const project = {
  id: 'synthetic-character-native', name: '合成人物线验收', createdAt: 1, updatedAt: 1,
  titlePage: { show: false }, settings: {}, acts: [], revisions: [], beats: [], boardLinks: [],
  elements: [
    el('qa-scene-alias', 'scene_heading', '内景 合成会客室 日'),
    el('qa-silent-action', 'action', '冷杉坐在门边，一言不发。阿明妈妈翻阅一张写着阿明名字的纸。'),
    el('qa-alias-cue', 'character', '阿仔（V.O.）'),
    el('qa-public-dialogue', 'dialogue', 'PUBLIC_CHARACTER_DIALOGUE 我听说了<b>冷杉</b>的消息。'),
    el('qa-scene-same-name', 'scene_heading', '外景 合成站台 夜'),
    el('qa-ambiguous-cue', 'character', '阿明'),
    el('qa-ambiguous-dialogue', 'dialogue', 'PUBLIC_AMBIGUOUS_DIALOGUE 我在这里。'),
    el('qa-mama-cue', 'character', '阿明妈妈'),
    el('qa-mama-dialogue', 'dialogue', 'PUBLIC_MAMA_DIALOGUE 名称前缀不能合并。'),
    el('qa-scene-unknown', 'scene_heading', '内景 合成空屋 日'),
    el('qa-orphan-dialogue', 'dialogue', 'PUBLIC_UNKNOWN_DIALOGUE 这句话尚未标明归属。'),
    el('qa-scene-group', 'scene_heading', '外景 合成广场 日'),
    el('qa-group-cue', 'character', '众人'), el('qa-group-dialogue', 'dialogue', 'PUBLIC_GROUP_DIALOGUE 一起出发。'),
    el('qa-scene-youth', 'scene_heading', '内景 合成旧屋 日'),
    el('qa-youth-cue', 'character', '阿明（青年）'), el('qa-youth-dialogue', 'dialogue', 'PUBLIC_YOUTH_DIALOGUE 保留身份括号。'),
    el('qa-scene-offset', 'scene_heading', '内景 合成档案室 日'),
    el('qa-offset-action', 'action', '合成😀&amp;<b>冷杉</b><br>冷杉的照片挂在墙上；冷杉本人不在这里。'),
    el('qa-scene-dual', 'scene_heading', '内景 合成双列场 日'),
    el('qa-dual-left', 'character', '阿仔', { dual: 'left', dualGroup: 'qa-dual' }),
    el('qa-dual-left-line', 'dialogue', 'PUBLIC_LEFT_DIALOGUE 左侧。', { dual: 'left', dualGroup: 'qa-dual' }),
    el('qa-dual-right', 'character', '阿明妈妈', { dual: 'right', dualGroup: 'qa-dual' }),
    el('qa-dual-right-line', 'dialogue', 'PUBLIC_RIGHT_DIALOGUE 右侧。', { dual: 'right', dualGroup: 'qa-dual' }),
  ],
  sceneMeta: [{ id: 'qa-meta-alias', elementId: 'qa-scene-alias', title: '', synopsis: '', color: '#cfe4ff', storyTime: '三天后' }],
  characterWorkspace: { schema: 1, profiles: [
    { id: 'qa-person-main', canonicalName: '阿明', aliases: ['阿仔'], disambiguation: 'PRIVATE_MAIN_DESCRIPTION' },
    { id: 'qa-person-same', canonicalName: '阿明', aliases: ['小陈'], disambiguation: 'PRIVATE_SAME_NAME_DESCRIPTION' },
    { id: 'qa-person-mama', canonicalName: '阿明妈妈', aliases: [] },
    { id: 'qa-person-silent', canonicalName: '冷杉', aliases: ['小陈'] },
    { id: 'qa-person-group', canonicalName: '众人', aliases: [] },
  ], overrides: [], assignments: [], noteLinks: [] },
  annotations: [{ id: 'qa-original-annotation', createdAt: 1, updatedAt: 1, body: 'PRIVATE_ORIGINAL_ANNOTATION', status: 'pending',
    anchor: { kind: 'scene', elementId: 'qa-scene-alias' }, anchorState: 'current' }],
  revisionWorkspace: { schema: 1,
    versions: [{ id: 'qa-old-version', name: 'PRIVATE_VERSION_NAME', description: '', createdAt: 1,
      content: { elements: [el('qa-old-body', 'action', 'PRIVATE_OLD_VERSION_BODY')], sceneMeta: [] } }],
    stash: [{ id: 'qa-old-stash', name: 'PRIVATE_STASH_NAME', description: 'PRIVATE_STASH_DESCRIPTION', createdAt: 1, kind: 'excerpt',
      source: { projectId: 'synthetic-character-native', elementIds: ['qa-stash-body'] },
      content: { elements: [el('qa-stash-body', 'action', 'PRIVATE_STASH_BODY')], sceneMeta: [] } }],
  },
};
const fixture = path.join(temporary, '合成 人物线.zhsp');
fs.writeFileSync(fixture, JSON.stringify({ app: 'mojiang', fileVersion: 1, savedAt: 1, project }), { flag: 'wx' });
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
fs.writeFileSync(path.join(shell, 'package.json'), JSON.stringify({ name: 'guangying-native-acceptance-qa', version,
  main: path.join(__dirname, 'native-acceptance-launcher.cjs') }), { flag: 'wx' });
const configPath = path.join(temporary, 'config.json');
const pdfs = [path.join(temporary, 'characters-creative.pdf'), path.join(temporary, 'characters-a4.pdf')];
const markers = { present: ['PUBLIC_CHARACTER_DIALOGUE', 'PUBLIC_MAMA_DIALOGUE', 'PUBLIC_LEFT_DIALOGUE', 'PUBLIC_RIGHT_DIALOGUE'],
  absent: ['PRIVATE_MAIN_DESCRIPTION', 'PRIVATE_SAME_NAME_DESCRIPTION', 'PRIVATE_ORIGINAL_ANNOTATION', 'PRIVATE_CHARACTER_NOTE',
    'PRIVATE_VERSION_NAME', 'PRIVATE_OLD_VERSION_BODY', 'PRIVATE_STASH_NAME', 'PRIVATE_STASH_DESCRIPTION', 'PRIVATE_STASH_BODY'] };
const config = { root, temporary, shell, userData, output, runtime, fixture, project, sourceHashes,
  expected: path.join(temporary, 'expected.json'), initialHash: hash(fixture), pdfs, markers };
fs.writeFileSync(configPath, JSON.stringify(config), { flag: 'wx' });
const report = { status: 'running', version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'Hidden production main/preload/built renderer, real synthetic file IPC, independent process restart and actual PDF text inspection',
  temporary, userData, runtime, runtimeCopied: false, sourceHashes, phases: [], pdfInspection: [],
  limitations: ['DOM inputs and native picker choices are synthetic; no physical mouse, system IME or visible layout acceptance.',
    'PDF text inspection does not replace visual pagination/layout review.'] };
const journal = () => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
async function phase(stage) {
  const fd = fs.openSync(path.join(output, `${stage}.log`), 'wx');
  const env = { ...cleanEnvironment(process.env), GUANGYING_QA_HIDDEN: '1', GUANGYING_QA_MODE: 'characters',
    GUANGYING_CHARACTER_CONFIG: configPath, GUANGYING_CHARACTER_STAGE: stage };
  const exit = await new Promise(resolve => {
    const child = spawn(runtime, [shell, `--user-data-dir=${userData}`], { cwd: shell, env, detached: process.platform !== 'win32', stdio: ['ignore', fd, fd] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stopOwnedChild(child, process.platform); }, 180000);
    child.once('error', error => { clearTimeout(timer); resolve({ error: error.message }); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, timedOut }); });
  });
  fs.closeSync(fd);
  const resultFile = path.join(output, `${stage}.json`), hiddenFile = path.join(temporary, 'hidden-window-proof.json');
  const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : { status: 'failed', stage, error: 'No phase evidence' };
  if (fs.existsSync(hiddenFile)) {
    result.hidden = JSON.parse(fs.readFileSync(hiddenFile, 'utf8'));
    fs.copyFileSync(hiddenFile, path.join(output, `${stage}-hidden-window-proof.json`), fs.constants.COPYFILE_EXCL);
  }
  result.processExit = exit;
  if (exit.code !== 0 || exit.signal || exit.timedOut || result.hidden?.actualShowEvents !== 0 || result.hidden?.initiallyVisible !== 0 || !result.hidden?.windows) result.status = 'failed';
  report.phases.push(result); journal(); console.log(stage, result.status); return result;
}
function inspectPdfs() {
  for (const pdf of pdfs) {
    assert.ok(fs.statSync(pdf).size > 100);
    const result = spawnSync(python, ['-c', 'import json,sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1]); print(json.dumps({"pages":len(r.pages),"text":"\\n".join(p.extract_text() or "" for p in r.pages)}))', pdf], { encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.status, 0, 'PDF extraction failed');
    const extracted = JSON.parse(result.stdout), text = extracted.text.replace(/\s/g, '');
    for (const value of markers.present) assert.ok(text.includes(value), `Expected public marker missing from ${path.basename(pdf)}: ${value}`);
    for (const value of markers.absent) assert.ok(!text.includes(value), `Private marker leaked into ${path.basename(pdf)}: ${value}`);
    const name = path.basename(pdf); fs.copyFileSync(pdf, path.join(output, name), fs.constants.COPYFILE_EXCL);
    report.pdfInspection.push({ name, sha256: hash(pdf), bytes: fs.statSync(pdf).size, pages: extracted.pages,
      presentChecked: markers.present, absentChecked: markers.absent, tool: `pypdf ${pdfProbe.stdout.trim()}`, status: 'passed' }); journal();
  }
}
(async () => {
  journal(); console.log('OUTPUT', output);
  if ((await phase('edit-save')).status === 'passed') await phase('restart-reopen');
  if (report.phases.length === 2 && report.phases.every(item => item.status === 'passed')) inspectPdfs();
  report.sourceUnchanged = tracked.every(file => hash(file) === sourceHashes[path.relative(root, file)]);
  report.status = report.phases.length === 2 && report.phases.every(item => item.status === 'passed') && report.pdfInspection.length === 2 && report.sourceUnchanged ? 'passed' : 'failed';
  journal(); console.log('RESULT', report.status); process.exitCode = report.status === 'passed' ? 0 : 1;
})().catch(error => { report.status = 'failed'; report.error = error.stack || String(error); journal(); console.error(error); process.exitCode = 1; });
