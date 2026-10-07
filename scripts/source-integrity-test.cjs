/** Synthetic source/data integrity regression; no user files, userData, or Electron process. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');

async function load() {
  const result = await require('esbuild').build({
    stdin: { contents: `export { createProject, deriveScenes, deriveCharacters } from './src/model/project';
      export { computeStats } from './src/model/stats';
      export { fromPlainText, toHtml, toPlainText } from './src/io/textscript';
      export { plain, countWords } from './src/utils/text';`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
  });
  const mod = new Module(path.join(root, '.source-integrity-memory.cjs'), module);
  mod.filename = path.join(root, '.source-integrity-memory.cjs');
  mod.paths = Module._nodeModulePaths(root);
  mod._compile(result.outputFiles[0].text, mod.filename);
  return mod.exports;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.values(value).forEach(freeze);
  Object.freeze(value);
}

function checkLauncher(childResult) {
  const writes = [], spawns = [], exits = [], directories = [];
  const qaRoot = '/synthetic/tmp/guangying-smoke-unique';
  const fakeFs = {
    mkdtempSync(prefix) { assert.equal(prefix, '/synthetic/tmp/guangying-smoke-'); return qaRoot; },
    mkdirSync(target) { directories.push(target); },
    writeFileSync(target, content) { writes.push({ target, content }); },
    readFileSync() { throw new Error('Smoke launcher must not read the repository package or user data'); },
  };
  const fakeProcess = { env: { EXISTING_ENV: 'kept' }, exit(code) { exits.push(code); } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'scripts/run-smoke.cjs'), 'utf8'), {
    __dirname: path.join(root, 'scripts'), process: fakeProcess, console: { log() {}, error() {} },
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === 'path') return path;
      if (name === 'os') return { tmpdir: () => '/synthetic/tmp' };
      if (name === 'child_process') return { spawnSync(...args) { spawns.push(args); return childResult; } };
      throw new Error(`Unexpected launcher dependency ${name}`);
    },
  });
  assert.deepEqual(directories, [path.join(qaRoot, 'shell')]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].target, path.join(qaRoot, 'shell/package.json'));
  const manifest = JSON.parse(writes[0].content);
  assert.equal(manifest.main, path.join(root, 'scripts/smoke.js'));
  assert.equal(manifest.name, 'guangying-smoke-qa');
  assert.equal(spawns.length, 1);
  assert.deepEqual(Array.from(spawns[0][1]), [path.join(qaRoot, 'shell')]);
  assert.equal(spawns[0][2].env.GUANGYING_SMOKE_ROOT, qaRoot);
  assert.equal(spawns[0][2].env.EXISTING_ENV, 'kept');
  return exits[0];
}

function smokePaths() {
  const source = fs.readFileSync(path.join(root, 'scripts/smoke.js'), 'utf8');
  let unique = 0;
  const probe = (env) => {
    const calls = [];
    vm.runInNewContext(source, {
      __dirname: path.join(root, 'scripts'), process: { env },
      require(name) {
        if (name === 'electron') return {
          app: {
            setPath(key, target) { calls.push({ key, target }); },
            disableHardwareAcceleration() {},
            whenReady() {
              assert.equal(calls.length, 1, 'userData isolation must precede app readiness');
              return { then() {} }; // Never construct a BrowserWindow or execute the renderer.
            },
          },
          BrowserWindow() { throw new Error('This regression must not launch Electron'); },
        };
        if (name === 'node:path') return path;
        if (name === 'node:os') return { tmpdir: () => '/synthetic/tmp' };
        if (name === 'node:fs') return {
          mkdtempSync(prefix) { assert.equal(prefix, '/synthetic/tmp/guangying-smoke-'); return `${prefix}${++unique}`; },
        };
        throw new Error(`Unexpected smoke dependency ${name}`);
      },
    });
    assert.equal(calls[0].key, 'userData');
    return calls[0].target;
  };
  assert.equal(probe({ GUANGYING_SMOKE_ROOT: '/synthetic/tmp/launcher' }), '/synthetic/tmp/launcher/userData');
  const first = probe({}), second = probe({});
  assert.notEqual(first, second, 'Direct invocation must also create a fresh temporary userData');
  assert.ok(first.startsWith('/synthetic/tmp/guangying-smoke-'));
};

(async () => {
  const api = await load();
  let groups = 0;
  const check = (label, fn) => { fn(); groups++; console.log(`PASS ${label}`); };
  const fixture = () => {
    const p = api.createProject('合成源码完整性');
    p.elements = [
      { id: 'pre', type: 'general', text: '合成序言 hello' },
      { id: 's1', type: 'scene_heading', text: '1. 内景 <b>合成空间</b> 日' },
      { id: 'a1', type: 'action', text: '<b>合成动作</b>&amp; 原位。' },
      { id: 'c1', type: 'character', text: '合成甲' },
      { id: 'p1', type: 'parenthetical', text: '(轻声)' },
      { id: 'd1', type: 'dialogue', text: '甲。' },
      { id: 'n1', type: 'note', text: '不参与公共统计的合成备忘' },
      { id: 'd2', type: 'dialogue', text: '孤立。' },
      { id: 'c2', type: 'character', text: '合成甲（V.O.）' },
      { id: 'd3', type: 'dialogue', text: '<i>继续</i> abc def' },
      { id: 's2', type: 'scene_heading', text: '外景 合成院落 夜', omit: true },
      { id: 'c3', type: 'character', text: '合成乙:' },
      { id: 'd4', type: 'dialogue', text: '末尾 hello' },
      { id: 's3', type: 'scene_heading', text: '' },
    ];
    p.sceneMeta = [
      { id: 'first', elementId: 's1', title: '首条标题', synopsis: '首条梗概', color: '#abc', actId: 'act-1', x: 0, y: 2, w: 310, h: 190 },
      { id: 'duplicate', elementId: 's1', title: '重复标题', synopsis: '不应覆盖', color: '#def' },
      { id: 'meta2', elementId: 's2', title: '', synopsis: '', color: '#123', omit: false },
      { id: 'orphan', elementId: 'missing', title: '孤儿', synopsis: '', color: '#456' },
    ];
    return p;
  };

  check('场景派生保留正文范围、首条重复元数据、场号、坐标、省略与只读输入', () => {
    const p = fixture(), before = JSON.stringify(p);
    freeze(p);
    const scenes = api.deriveScenes(p);
    assert.deepEqual(scenes.map(s => [s.elementId, s.id, s.start, s.end, s.number, s.heading]), [
      ['s1', 'first', 1, 10, '1', '内景 合成空间 日'],
      ['s2', 'meta2', 10, 13, '2', '外景 合成院落 夜'],
      ['s3', 's3', 13, 14, '3', ''],
    ]);
    assert.deepEqual([scenes[0].title, scenes[0].synopsis, scenes[0].color, scenes[0].actId, scenes[0].x, scenes[0].y, scenes[0].w, scenes[0].h],
      ['首条标题', '首条梗概', '#abc', 'act-1', 0, 2, 310, 190]);
    assert.equal(scenes[1].omit, true);
    assert.equal(JSON.stringify(p), before);
    const manual = { ...p, settings: { ...p.settings, autoNumberScenes: false } };
    assert.deepEqual(api.deriveScenes(manual).map(s => s.number), ['首条标题', '', '']);
    const noScenes = { ...p, elements: [{ id: 'general', type: 'general', text: '合成场前文字' }],
      get sceneMeta() { throw new Error('No-heading project must not scan scene metadata'); } };
    assert.deepEqual(api.deriveScenes(noScenes), []);
  });

  check('合成千场元数据检索保持线性工作量', () => {
    const p = api.createProject('合成千场'), count = 1000;
    let elementIdReads = 0;
    p.elements = Array.from({ length: count }, (_, i) => ({ id: `s${i}`, type: 'scene_heading', text: '内景 合成空间 日' }));
    p.sceneMeta = Array.from({ length: count }, (_, i) => ({
      id: `m${i}`, get elementId() { elementIdReads++; return `s${i}`; },
      title: `合成${i}`, synopsis: '', color: '#fff',
    }));
    const scenes = api.deriveScenes(p);
    assert.equal(scenes.length, count);
    assert.ok(scenes.every((scene, i) => scene.id === `m${i}` && scene.title === `合成${i}`));
    assert.ok(elementIdReads <= count * 3, `Metadata key reads must grow linearly, observed ${elementIdReads}`);
  });

  check('人物派生保持括号归一、场景顺序、发言与对白归属、排序及只读输入', () => {
    const p = fixture(), before = JSON.stringify(p);
    freeze(p);
    assert.deepEqual(api.deriveCharacters(p), [
      { name: '合成甲', scenes: [0], lines: 2, words: 10 },
      { name: '合成乙', scenes: [1], lines: 1, words: 7 },
    ]);
    assert.equal(JSON.stringify(p), before);
  });

  check('公共统计只复用计数，不改变备忘、省略、人物、页数与阅读时间口径', () => {
    const p = fixture(), before = JSON.stringify(p);
    freeze(p);
    const eligible = p.elements.filter(el => el.type !== 'note');
    const words = eligible.reduce((sum, el) => sum + api.countWords(el.text), 0);
    const stats = api.computeStats(p, 12);
    assert.equal(stats.words, words);
    assert.equal(stats.dialogueWords, eligible.filter(el => el.type === 'dialogue').reduce((sum, el) => sum + api.countWords(el.text), 0));
    assert.equal(stats.actionWords, api.countWords(p.elements[2].text));
    assert.equal(stats.cjk, eligible.reduce((sum, el) => sum + (api.plain(el.text).match(/[\u4e00-\u9fff]/g)?.length || 0), 0));
    assert.equal(stats.sceneCount, 3);
    assert.equal(stats.characterCount, 2);
    assert.equal(stats.estimatedPages, 12);
    assert.equal(stats.estimatedMinutes, words / p.settings.wordsPerMinute);
    assert.equal(stats.elementCounts.note, undefined);
    assert.equal(stats.elementCounts.scene_heading, 3, 'Legacy common stats still include omitted headings');
    assert.equal(api.computeStats(p).words, words);
    assert.equal(JSON.stringify(p), before);
  });

  check('纯文本识别保留原类型，所有输出把尖括号、实体与引号视为字面文本', () => {
    const cases = [
      ['内景 <合成空间>& 日', 'scene_heading', '内景 <合成空间>& 日'],
      ['切至：', 'transition', '切至：'],
      ['特写 - <提示>&"引号"', 'shot', '特写 - <提示>&"引号"'],
      ['（请看 <提示>&"引号"）', 'parenthetical', '（请看 <提示>&"引号"）'],
      ['甲<b>&\n一段合成对白。', 'character', '甲<b>&'],
      ['甲\n一段 <提示>&"对白"。', 'dialogue', '一段 <提示>&"对白"。'],
      ['合成动作包含 <img src=x onerror="示例"> & 字面字符。', 'action', '合成动作包含 <img src=x onerror="示例"> & 字面字符。'],
    ];
    for (const [input, type, literal] of cases) {
      const elements = api.fromPlainText(input), el = elements.find(item => item.type === type);
      assert.ok(el, `Expected importer type ${type}`);
      const dom = new JSDOM(`<div id="text">${el.text}</div>`);
      assert.equal(dom.window.document.querySelector('#text').textContent, literal);
      assert.equal(dom.window.document.querySelector('#text').children.length, 0);
      dom.window.close();
      assert.equal(api.plain(el.text), literal);
    }
    const multiline = api.fromPlainText('合成第一行。\r\n合成第二行。\r\n\r\n甲\r\n合成对白第一行。\r\n合成对白第二行。');
    assert.deepEqual(multiline.map(el => [el.type, api.plain(el.text)]), [
      ['action', '合成第一行。\n合成第二行。'], ['character', '甲'], ['dialogue', '合成对白第一行。\n合成对白第二行。'],
    ]);
    assert.deepEqual(api.fromPlainText('').map(el => [el.type, el.text]), [['action', '']]);
  });

  check('HTML导出保留字面正文、标题、换行与既有备忘筛选，不能生成正文标签', () => {
    const p = api.createProject('合成<工程>&');
    p.titlePage.title = '合成<标题>& </title><script>示例</script>';
    p.titlePage.show = true;
    p.elements = [
      { id: 'a', type: 'action', text: '<b>粗体&lt;提示&gt;</b><br>&amp; &lt;img src=x onerror=&quot;示例&quot;&gt;', omit: true },
      { id: 'n', type: 'note', text: '合成&lt;备忘&gt;&amp;' },
    ];
    const before = JSON.stringify(p);
    const html = api.toHtml(p), dom = new JSDOM(html), doc = dom.window.document;
    assert.equal(doc.title, p.titlePage.title);
    assert.equal(doc.querySelector('h1').textContent, p.titlePage.title);
    assert.equal(doc.querySelector('p.el-action').innerHTML, '粗体&lt;提示&gt;<br>&amp; &lt;img src=x onerror="示例"&gt;');
    assert.equal(doc.querySelectorAll('p.el-action br').length, 1);
    assert.equal(doc.querySelectorAll('script,img,b,提示,标题').length, 0);
    assert.equal(doc.querySelector('p.el-note'), null);
    assert.equal(JSON.stringify(p), before);
    dom.window.close();
    p.settings.printNotes = true;
    const withNotes = new JSDOM(api.toHtml(p));
    assert.equal(withNotes.window.document.querySelector('p.el-note').textContent, '合成<备忘>&');
    withNotes.window.close();
    p.titlePage.title = '';
    const fallback = new JSDOM(api.toHtml(p));
    assert.equal(fallback.window.document.title, p.name);
    fallback.window.close();
    assert.ok(api.toPlainText(p).includes('粗体<提示>\n& <img src=x onerror="示例">'));
  });

  check('smoke启动壳只写独立临时manifest，保留退出状态，不改仓库package', () => {
    assert.equal(checkLauncher({ status: 0 }), 0);
    assert.equal(checkLauncher({ status: 4 }), 4);
    assert.equal(checkLauncher({ status: null, signal: 'SIGTERM' }), 1);
    assert.equal(checkLauncher({ status: null, error: new Error('synthetic missing runtime') }), 1);
  });
  check('smoke直调与启动器都在app ready之前隔离userData，不启动Electron', smokePaths);
  console.log(`Source integrity passed: ${groups} synthetic groups; no Electron or user data accessed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
