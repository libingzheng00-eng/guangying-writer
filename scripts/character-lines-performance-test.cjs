/** Synthetic model benchmark. No Electron, user files, runtime downloads, or
 * node_modules copies. Baseline imports resolve entirely inside a git archive;
 * candidate imports resolve entirely inside the working source tree. Both use
 * the same installed dependencies, after package-lock equality is checked.
 *
 * node scripts/character-lines-performance-test.cjs --output /absolute/new/dir
 * Optional: --sizes 300,3000 --rounds 3 --iterations 30 --media-mib 0
 * Timings are model-only evidence, never renderer/input latency acceptance.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const BASELINE = '0c072f229b0d29bbc54e181ae8171213b69b0c27';
const hash = value => createHash('sha256').update(value).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));

function options(argv) {
  const result = { baselineRef: BASELINE, sizes: [300, 3000, 10000, 30000], rounds: 3, iterations: 30, mediaMiB: 0 };
  const names = { '--baseline-ref': 'baselineRef', '--output': 'output', '--source-root': 'sourceRoot', '--label': 'label' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--worker') { result.worker = true; continue; }
    assert.ok(i + 1 < argv.length, `Missing value for ${flag}`);
    const value = argv[++i];
    if (names[flag]) result[names[flag]] = value;
    else if (flag === '--sizes') {
      result.sizes = value.split(',').map(Number);
      assert.ok(result.sizes.length && result.sizes.every(n => [300, 3000, 10000, 30000].includes(n)), 'Use the fixed synthetic sizes: 300,3000,10000,30000');
      assert.equal(new Set(result.sizes).size, result.sizes.length);
    } else if (flag === '--rounds' || flag === '--iterations' || flag === '--media-mib') {
      const n = Number(value);
      assert.ok(Number.isInteger(n));
      if (flag === '--rounds') { assert.ok(n >= 1 && n <= 7); result.rounds = n; }
      if (flag === '--iterations') { assert.ok(n >= 5 && n <= 200); result.iterations = n; }
      if (flag === '--media-mib') { assert.ok([0, 5, 20].includes(n)); result.mediaMiB = n; }
    } else throw Error(`Unknown option: ${flag}`);
  }
  if (result.output) assert.ok(path.isAbsolute(result.output), 'Evidence output must be absolute');
  return result;
}

function sourceDigest(directory) {
  const files = [];
  function walk(subdir) {
    for (const entry of fs.readdirSync(path.join(directory, subdir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      assert.ok(!entry.isSymbolicLink(), 'Source evidence must not follow symlinks');
      const relative = path.join(subdir, entry.name);
      if (entry.isDirectory()) walk(relative); else if (entry.isFile()) files.push(relative);
    }
  }
  walk('src'); walk('electron');
  files.push('package.json', 'package-lock.json', 'tsconfig.json');
  const manifest = Object.fromEntries(files.map(name => [name, fileHash(path.join(directory, name))]));
  return { sha256: hash(JSON.stringify(manifest)), manifest };
}

function dependencyFingerprint(directory) {
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const rootVersions = { manifest: manifest.version, lock: lock.version, packageEntry: lock.packages?.['']?.version };
  // A candidate version bump is metadata, not a dependency change. Every other
  // lock entry remains part of the equality check, including resolved/integrity.
  delete lock.version;
  if (lock.packages?.['']) delete lock.packages[''].version;
  const dependencies = Object.fromEntries(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides', 'packageManager']
    .filter(key => manifest[key] !== undefined).map(key => [key, manifest[key]]));
  return { sha256: hash(JSON.stringify({ lock, dependencies })), rootVersions, rawLockSha256: fileHash(path.join(directory, 'package-lock.json')) };
}

function fixture(api, size, mediaMiB, withCharacters = false) {
  const p = api.createProject('合成人物线性能稿');
  const people = ({ 300: 20, 3000: 80, 10000: 300, 30000: 1000 })[size];
  const perScene = size === 300 ? 10 : 20;
  p.id = `synthetic-character-perf-${size}`; p.createdAt = 1; p.updatedAt = 1;
  p.acts = []; p.sceneMeta = []; p.beats = []; p.boardLinks = []; p.revisions = [];
  p.titlePage.show = false;
  p.elements = Array.from({ length: size }, (_, i) => {
    const place = i % perScene, person = Math.floor(i / 3) % people;
    const type = place === 0 ? 'scene_heading' : place % 3 === 1 ? 'action' : place % 3 === 2 ? 'character' : 'dialogue';
    const text = type === 'scene_heading' ? `内景 合成空间${Math.floor(i / perScene)} 日`
      : type === 'character' ? `合成人物${person}`
        : type === 'action' ? `合成人物${person}进入房间。合成人物${(person + 1) % people}的名字出现在信封上。`
          : `合成对白${i}，<b>原文</b>与<br>换行保留。`;
    return { id: `perf-e-${i}`, type, text };
  });
  if (mediaMiB) p.beats.push({ id: 'perf-media', kind: 'image', text: '模型专用合成字节，不验证图片解码',
    color: '#ffffff', x: 800, y: 20, img: 'data:image/png;base64,' + 'A'.repeat(mediaMiB * 1024 * 1024) });
  if (withCharacters) p.characterWorkspace = { schema: 1,
    profiles: Array.from({ length: Math.min(people, 500) }, (_, i) => ({ id: `perf-person-${i}`, canonicalName: `合成人物${i}`, aliases: [`合成别名${i}`] })),
    overrides: [], assignments: [], noteLinks: [] };
  return p;
}

function summary(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const at = quantile => +sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)].toFixed(4);
  return { samples: sorted.length, p50Ms: at(.5), p95Ms: at(.95), maxMs: +sorted.at(-1).toFixed(4), rawMs: times.map(n => +n.toFixed(4)) };
}
function measure(count, action) {
  const times = [];
  for (let i = 0; i < count; i++) { const start = performance.now(); action(i); times.push(performance.now() - start); }
  return summary(times);
}

async function load(sourceRoot) {
  const memory = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key),
  } });
  const hasCharacters = fs.existsSync(path.join(sourceRoot, 'src/model/characterLines.ts'));
  const result = await esbuild.build({ stdin: { contents: `
    export {useStore} from './src/store/store';
    export {createProject} from './src/model/project';
    export {deriveWritingElements} from './src/model/flow';
    export {buildReport} from './src/model/reports';
    export {serializeProject,parseProject} from './src/io/zhsp';
    ${hasCharacters ? "export * as characters from './src/model/characterLines';" : ''}
  `, resolveDir: sourceRoot, loader: 'ts' }, absWorkingDir: sourceRoot,
    nodePaths: [path.join(root, 'node_modules')], bundle: true, write: false,
    platform: 'node', format: 'cjs', target: 'node22', packages: 'external', metafile: true, logLevel: 'silent' });
  const importedSources = Object.keys(result.metafile.inputs).filter(name => !name.startsWith('<'));
  for (const name of importedSources) {
    const absolute = path.resolve(sourceRoot, name), relative = path.relative(sourceRoot, absolute);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Mixed source trees: ${name}`);
  }
  const filename = path.join(sourceRoot, '.synthetic-character-perf-memory.cjs');
  const compiled = new Module(filename, module); compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(root);
  compiled._compile(result.outputFiles[0].text, filename);
  return { api: compiled.exports, importedSources, bundleSha256: hash(result.outputFiles[0].text), hasCharacters };
}

async function worker(opts) {
  assert.ok(opts.sourceRoot && path.isAbsolute(opts.sourceRoot));
  const { api, importedSources, bundleSha256, hasCharacters } = await load(opts.sourceRoot);
  const reset = project => { api.useStore.getState().loadProject(project); api.useStore.getState().breakHistoryGroup(); };
  const rows = [];
  for (const size of opts.sizes) {
    global.gc?.();
    const project = fixture(api, size, opts.mediaMiB), before = process.memoryUsage();
    const row = { size, scenes: size / (size === 300 ? 10 : 20), mediaMiB: opts.mediaMiB, metrics: {} };
    const metrics = row.metrics;
    metrics.writingCold = measure(5, () => api.deriveWritingElements([...project.elements]));
    api.deriveWritingElements(project.elements);
    metrics.writingWarm = measure(opts.iterations, () => api.deriveWritingElements(project.elements));
    metrics.report = measure(5, () => api.buildReport(project));
    reset(project);
    const baseElements = api.useStore.getState().project.elements;
    metrics.storeInput = measure(opts.iterations, i => api.useStore.getState().setText('perf-e-1', `合成热路径输入${i}`));
    assert.equal(api.useStore.getState().project.elements.length, size);
    assert.equal(api.useStore.getState().project.elements[2], baseElements[2], 'Unchanged paragraph identity must survive typing');
    metrics.serialize = measure(3, () => api.serializeProject(project));
    const serialized = api.serializeProject(project); row.serializedBytes = Buffer.byteLength(serialized);
    metrics.parse = measure(3, () => api.parseProject(serialized));
    if (hasCharacters) {
      const build = api.characters.buildCharacterLineIndex;
      assert.equal(typeof build, 'function', 'Character feature exists but its measured entry is missing');
      const rich = fixture(api, size, opts.mediaMiB, true);
      metrics.characterCold = measure(3, () => build({ ...rich, elements: rich.elements.map(e => ({ ...e })) }));
      const initial = build(rich);
      assert.ok(initial && Array.isArray(initial.occurrences)); row.occurrences = initial.occurrences.length;
      metrics.characterWarm = measure(opts.iterations, () => assert.equal(build(rich), initial, 'Unchanged character index should be reused'));
      reset(rich);
      metrics.characterInputClosed = measure(opts.iterations, i => api.useStore.getState().setText('perf-e-1', `合成人物0沉默看窗外。合成输入${i}`));
      metrics.characterInputOpen = measure(opts.iterations, i => {
        api.useStore.getState().setText('perf-e-1', `合成人物0走进房间。合成输入${i}`);
        build(api.useStore.getState().project);
      });
      const current = api.useStore.getState().project;
      assert.equal(current.characterWorkspace, rich.characterWorkspace, 'Typing shares immutable character data');
      const reopen = api.parseProject(api.serializeProject(current));
      assert.deepEqual(reopen.characterWorkspace, current.characterWorkspace, 'Character data survives actual project codec');
    }
    global.gc?.(); row.memory = { before, after: process.memoryUsage(), gcAvailable: !!global.gc };
    rows.push(row);
  }
  console.log('CHARACTER_PERF_RESULT ' + JSON.stringify({ label: opts.label, hasCharacters, rows, importedSources, bundleSha256 }));
}

async function main(opts) {
  const commit = execFileSync('git', ['rev-parse', `${opts.baselineRef}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
  assert.match(commit, /^[0-9a-f]{40}$/);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-character-perf-source-'));
  const output = opts.output || fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-character-perf-evidence-'));
  if (opts.output) fs.mkdirSync(output);
  const report = { status: 'running', scope: 'synthetic model only; full source graph per revision; no renderer/OS input performance claim',
    baselineCommit: commit, candidateCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    settings: opts, system: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0]?.model, totalMemory: os.totalmem() },
    startedAt: new Date().toISOString(), rounds: [], limitations: ['New character-index timings have no equivalent feature in the baseline.', 'Forced-GC Node memory is diagnostic, not an Electron leak or disk-usage test.'] };
  const journal = () => fs.writeFileSync(path.join(output, 'performance.json'), JSON.stringify(report, null, 2));
  try {
    // Archive only repository-tracked data. Dependencies stay at the existing root.
    const archive = execFileSync('git', ['archive', '--format=tar', commit], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-xf', '-', '-C', temporary], { input: archive });
    const baselineDependencies = dependencyFingerprint(temporary), candidateDependencies = dependencyFingerprint(root);
    assert.equal(baselineDependencies.sha256, candidateDependencies.sha256, 'Dependencies changed beyond root version metadata; prepare an explicit dependency-equivalent comparison first');
    report.dependencyEquivalence = { baseline: baselineDependencies, candidate: candidateDependencies,
      ignoredFields: ['package.json version', 'package-lock.json version', 'package-lock.json packages[""].version'] };
    report.baselineSources = sourceDigest(temporary); report.candidateSources = sourceDigest(root);
    report.lockSha256 = fileHash(path.join(root, 'package-lock.json')); journal();
    for (let round = 0; round < opts.rounds; round++) {
      const labels = round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
      for (const label of labels) {
        const result = spawnSync(process.execPath, ['--expose-gc', __filename, '--worker', '--source-root', label === 'baseline' ? temporary : root,
          '--label', label, '--sizes', opts.sizes.join(','), '--iterations', String(opts.iterations), '--media-mib', String(opts.mediaMiB)],
        { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
        fs.writeFileSync(path.join(output, `round-${round + 1}-${label}.log`), result.stdout + result.stderr, { flag: 'wx' });
        assert.equal(result.status, 0, `${label} worker failed: ${result.error?.message || result.stderr}`);
        const line = result.stdout.split('\n').find(value => value.startsWith('CHARACTER_PERF_RESULT ')); assert.ok(line, 'Worker produced no evidence');
        report.rounds.push({ round: round + 1, ...JSON.parse(line.slice('CHARACTER_PERF_RESULT '.length)) }); journal();
        console.log(`MODEL ${label} round ${round + 1}/${opts.rounds}: ${opts.sizes.join(',')} elements`);
      }
    }
    assert.equal(sourceDigest(root).sha256, report.candidateSources.sha256, 'Candidate source changed during benchmark; rerun against a stable candidate');
    report.status = 'passed'; report.finishedAt = new Date().toISOString(); journal();
    console.log('OUTPUT', output);
    console.log('Model correctness and measurements recorded; no latency threshold, renderer, native input or memory-leak acceptance is implied.');
  } catch (error) { report.status = 'failed'; report.error = error.stack || String(error); journal(); console.error(report.error); process.exitCode = 1; }
  finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
const opts = options(process.argv.slice(2));
(opts.worker ? worker(opts) : main(opts)).catch(error => { console.error(error); process.exitCode = 1; });
