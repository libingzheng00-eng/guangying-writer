/** Core guard: behavior and release hygiene, not immutable hashes.
 * Reads Git-tracked repository paths only; never searches personal userData.
 * Optional --package PATH inspects an explicitly prepared Resources/app directory.
 * Synthetic fixtures in source tests are legitimate. This is not a semantic
 * detector of private screenplay text: release review remains mandatory.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const failures = [];
const fail = (message) => failures.push(message);
const privateOrArtifact = /(?:^|\/)(?:node_modules|\.git|\.env(?:\.[^/]*)?|Local Storage|Session Storage|IndexedDB|Cookies|History|recent\.json|autosave(?:\.[^/]*)?|release(?:-[^/.]*)?|dist-renderer|captures?|backups?)(?:\/|$)|\.(?:zhsp|fdx|pdf|dmg|zip|app|asar)(?:\/|$)/i;
const packageData = /(?:^|\/)(?:node_modules|\.git|Local Storage|Session Storage|IndexedDB|Cookies|History|recent\.json|autosave(?:\.[^/]*)?|captures?|backups?)(?:\/|$)|\.(?:zhsp|fdx|pdf|dmg|zip|app)(?:\/|$)/i;
const maxBytes = 50 * 1024 * 1024;

function checkFile(base, relative, prohibited) {
  if (prohibited.test(relative)) fail(`禁止纳入发布/源码的路径: ${relative}`);
  const absolute = path.join(base, relative);
  if (!fs.existsSync(absolute)) { fail(`跟踪文件不存在: ${relative}`); return; }
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) fail(`需人工审查符号链接，防止引用本机资料: ${relative}`);
  if (stat.size > maxBytes) fail(`单文件超过 50 MiB，请使用 Releases 而非源码提交: ${relative}`);
}

(async () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of tracked) checkFile(root, file, privateOrArtifact);
  // Existence alone is a routing check; CI below must actually execute these tests.
  for (const file of ['CORE_FEATURES.md', 'DEVELOPER_HANDOFF.md', 'AGENTS.md',
    'scripts/render-test.cjs', 'scripts/writing-test.cjs', 'scripts/history-test.cjs',
    'scripts/zhsp-compat-test.cjs', 'scripts/pagination-safety-test.cjs', 'scripts/image-drop-electron.cjs', 'scripts/pdf-layout-electron.cjs']) {
    if (!fs.existsSync(path.join(root, file))) fail(`缺少核心契约或回归入口: ${file}`);
  }
  const result = await esbuild.build({
    stdin: { contents: 'export {sampleProject} from "./src/model/sample"; export {nextTypeOnTab} from "./src/model/flow";', resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  const bundle = new Module(path.join(root, '.core-guard-memory.cjs'), module);
  bundle.filename = path.join(root, '.core-guard-memory.cjs');
  bundle.paths = Module._nodeModulePaths(root);
  bundle._compile(result.outputFiles[0].text, bundle.filename);
  const { sampleProject, nextTypeOnTab } = bundle.exports;
  const sample = sampleProject();
  assert.equal(sample.name, '未命名剧本', '首次启动必须是空白未命名工程');
  assert.ok(sample.elements.length > 0, '空白模板仍须保留可编辑元素');
  assert.ok(sample.elements.every((element) => element.text === ''), '空白模板禁止预置剧情正文');
  for (const key of ['beats', 'sceneMeta', 'boardLinks']) assert.deepEqual(sample[key], [], `空白模板禁止预置 ${key}`);
  for (const key of ['title', 'subtitle', 'author', 'basedOn', 'contact', 'notes']) assert.equal(sample.titlePage[key] || '', '', `空白标题页禁止预置 ${key}`);
  const cycle = ['action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'scene_heading', 'general', 'note'];
  for (let i = 0; i < cycle.length; i++) {
    assert.equal(nextTypeOnTab(cycle[i]), cycle[(i + 1) % cycle.length], 'Tab 九类正向顺序不可回退');
    assert.equal(nextTypeOnTab(cycle[i], true), cycle[(i + cycle.length - 1) % cycle.length], 'Shift+Tab 九类反向顺序不可回退');
  }

  const args = process.argv.slice(2);
  if (args.length) {
    assert.ok(args.length === 2 && args[0] === '--package', '用法: node scripts/core-guard.cjs [--package /explicit/Resources/app]');
    const packageRoot = path.resolve(args[1]);
    assert.ok(path.basename(packageRoot) === 'app' && path.basename(path.dirname(packageRoot)) === 'Resources', '仅允许明确的 Resources/app 生产资源目录');
    assert.ok(fs.statSync(packageRoot).isDirectory(), '包检查目标必须是 Resources/app 目录');
    assert.ok(!fs.lstatSync(packageRoot).isSymbolicLink(), '包检查根不得是符号链接');
    const allowed = new Set(['package.json', 'LICENSE', 'electron', 'dist-renderer']);
    for (const item of fs.readdirSync(packageRoot)) if (!allowed.has(item)) fail(`应用资源根出现非生产文件: ${item}`);
    for (const item of allowed) if (!fs.existsSync(path.join(packageRoot, item))) fail(`应用资源缺少生产入口: ${item}`);
    function walk(relative = '') {
      for (const name of fs.readdirSync(path.join(packageRoot, relative))) {
        const entry = path.join(relative, name);
        const absolute = path.join(packageRoot, entry);
        const stat = fs.lstatSync(absolute);
        checkFile(packageRoot, entry, packageData);
        if (stat.isDirectory() && !stat.isSymbolicLink()) walk(entry);
      }
    }
    walk();
    console.log('已检查指定生产 app 资源目录，不访问本机自动保存。');
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(`核心守护通过：${tracked.length} 个 Git 跟踪路径、空白模板、Tab 九类正反向契约。`);
  console.log('边界：不扫描旧 Git 历史；不能识别任意文本中的隐私；不能替代实机拖放/PDF 视觉验收。');
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
