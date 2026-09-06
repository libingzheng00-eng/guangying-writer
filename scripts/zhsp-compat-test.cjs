/**
 * scripts/zhsp-compat-test.cjs
 *
 * 验证 .zhsp 工程文件向后兼容逻辑（第二项）：
 *   - Beat 新增的 kind/title/img/w/h 必须全部是可选字段
 *   - 旧 .zhsp 打开/保存/再次打开不丢失原有 text/color/x/y/sceneId
 *   - sceneNumber 保留 left/right/both 三种选项，默认值改为 left
 *   - 旧 .zhsp 显式保存为 both/right/none 时必须保留原设置
 *
 * 所有断言仅使用合成数据，不包含任何真实剧本内容。
 * 用法： node scripts/zhsp-compat-test.cjs
 */
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const entry = path.join(__dirname, 'zhsp-compat.entry.ts');
const bundle = path.join(__dirname, '..', '.tmp-zhsp-compat.cjs');
process.on('exit', () => {
  try { fs.unlinkSync(bundle); } catch (_) { /* 不存在即可 */ }
});

function wrap(oldA, extras = {}) {
  return JSON.stringify({
    app: 'zh-screenwriter',
    fileVersion: 1,
    savedAt: 1,
    project: { ...oldA, ...extras },
  });
}

(async () => {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outfile: bundle,
    platform: 'node',
    format: 'cjs',
    target: 'es2020',
    logLevel: 'silent',
  });

  const { parseProject, serializeProject, defaultSettings, createProject } = require(bundle);

  const failures = [];
  const ok = (name, cond) => {
    if (cond) console.log(`  \u2713 ${name}`);
    else { console.log(`  \u2717 ${name}`); failures.push(name); }
  };

  const baseProject = {
    id: 'synth',
    name: '合成工程',
    createdAt: 1,
    updatedAt: 1,
    titlePage: { title: '', author: '' },
    elements: [],
    sceneMeta: [],
    beats: [],
    boardLinks: [],
    targetPages: 100,
    acts: [{ id: 'act-1', title: '第一幕', color: '#cfe4ff' }],
    revisions: [],
    settings: {},
  };

  console.log('\n== 场景 1：默认值 ==');
  ok('createProject 默认 sceneNumber=left', createProject('t').settings.sceneNumber === 'left');
  ok('defaultSettings() 默认 sceneNumber=left', defaultSettings().sceneNumber === 'left');

  console.log('\n== 场景 2：旧工程 sceneNumber 兼容 ==');
  const noScene = parseProject(wrap(baseProject, { settings: {} }));
  ok('旧工程完全无 settings.sceneNumber → left', noScene.settings.sceneNumber === 'left');
  ok('旧工程未指定 sceneNumber 时，其它 settings 字段仍取默认', noScene.settings.autoNumberScenes === true);

  const bothFile = parseProject(wrap(baseProject, { settings: { sceneNumber: 'both' } }));
  ok('旧工程 sceneNumber=both → 保留 both', bothFile.settings.sceneNumber === 'both');

  const rightFile = parseProject(wrap(baseProject, { settings: { sceneNumber: 'right' } }));
  ok('旧工程 sceneNumber=right → 保留 right', rightFile.settings.sceneNumber === 'right');

  const noneFile = parseProject(wrap(baseProject, { settings: { sceneNumber: 'none' } }));
  ok('旧工程 sceneNumber=none → 保留 none', noneFile.settings.sceneNumber === 'none');

  const bogusFile = parseProject(wrap(baseProject, { settings: { sceneNumber: 'bogus' } }));
  ok('非法 sceneNumber → 兜底 left', bogusFile.settings.sceneNumber === 'left');

  console.log('\n== 场景 3：旧格式 Beat（无新字段）round-trip ==');
  const oldBeats = [
    { id: 'b1', text: '合成卡片甲', color: '#FCEBEB', x: 10, y: 20, sceneId: 'sc-1' },
    { id: 'b2', text: '合成卡片乙', color: '#E6F1FB', x: 30, y: 40 },
  ];
  const loadedOld = parseProject(wrap(baseProject, { beats: oldBeats }));
  ok('旧 Beat 数量', loadedOld.beats.length === 2);
  ok('旧 Beat[0] text', loadedOld.beats[0].text === '合成卡片甲');
  ok('旧 Beat[0] color', loadedOld.beats[0].color === '#FCEBEB');
  ok('旧 Beat[0] x', loadedOld.beats[0].x === 10);
  ok('旧 Beat[0] y', loadedOld.beats[0].y === 20);
  ok('旧 Beat[0] sceneId', loadedOld.beats[0].sceneId === 'sc-1');
  ok('旧 Beat[1] text', loadedOld.beats[1].text === '合成卡片乙');
  ok('旧 Beat 不强制添加 kind/title/img/w/h', loadedOld.beats[0].kind === undefined && loadedOld.beats[0].title === undefined && loadedOld.beats[0].img === undefined && loadedOld.beats[0].w === undefined && loadedOld.beats[0].h === undefined);

  // round-trip
  const oldSerialized = serializeProject(loadedOld);
  const oldReparsed = parseProject(oldSerialized);
  ok('round-trip Beat 数量', oldReparsed.beats.length === 2);
  ok('round-trip Beat[0].text', oldReparsed.beats[0].text === '合成卡片甲');
  ok('round-trip Beat[0].color', oldReparsed.beats[0].color === '#FCEBEB');
  ok('round-trip Beat[0].x', oldReparsed.beats[0].x === 10);
  ok('round-trip Beat[0].y', oldReparsed.beats[0].y === 20);
  ok('round-trip Beat[0].sceneId', oldReparsed.beats[0].sceneId === 'sc-1');
  ok('round-trip Beat[1].text', oldReparsed.beats[1].text === '合成卡片乙');
  ok('round-trip sceneNumber 仍为 left', oldReparsed.settings.sceneNumber === 'left');
  ok('round-trip 序列化文本不包含 undefined 字段', !/undefined/.test(oldSerialized));

  console.log('\n== 场景 4：新格式 Beat（含 kind/title/img/w/h）round-trip ==');
  const newBeats = [
    { id: 'b3', text: '声音卡', color: '#fff7d6', x: 50, y: 60, kind: 'sound', title: '合成背景音乐', img: '', w: 200, h: 120 },
    { id: 'b4', text: '图片卡', color: '#E6F1FB', x: 70, y: 80, kind: 'image', title: '合成剧照', img: 'data:image/png;base64,iVBORw0KGgo=', w: 240, h: 180 },
    { id: 'b5', text: '写作图片', color: '#FCEBEB', x: 90, y: 100, kind: 'wimg', title: '合成设定图', img: 'data:image/png;base64,abcd', w: 160, h: 90 },
    { id: 'b6', text: '文字卡', color: '#fff7d6', x: 110, y: 120, kind: 'beat', title: '合成节拍', w: 120, h: 80 },
  ];
  const newProject = createProject('new');
  newProject.beats = newBeats;
  const newSerialized = serializeProject(newProject);
  const newReparsed = parseProject(newSerialized);
  ok('新 Beat 数量', newReparsed.beats.length === 4);
  ok('sound kind 保留', newReparsed.beats[0].kind === 'sound');
  ok('sound title 保留', newReparsed.beats[0].title === '合成背景音乐');
  ok('sound w/h 保留', newReparsed.beats[0].w === 200 && newReparsed.beats[0].h === 120);
  ok('image kind 保留', newReparsed.beats[1].kind === 'image');
  ok('image dataURL 保留', newReparsed.beats[1].img === 'data:image/png;base64,iVBORw0KGgo=');
  ok('image w/h 保留', newReparsed.beats[1].w === 240 && newReparsed.beats[1].h === 180);
  ok('wimg kind 保留', newReparsed.beats[2].kind === 'wimg');
  ok('beat kind 保留', newReparsed.beats[3].kind === 'beat');

  console.log('\n== 场景 5：残缺 Beat 解析不抛异常、可用字段不丢 ==');
  const corruptBeats = [
    { id: 'bx', text: '半截卡', color: '#fff' /* 缺 x/y */ },
    { text: '无 id' /* 缺 id/text/color/x/y */ },
  ];
  const corrupt = parseProject(wrap(baseProject, { beats: corruptBeats }));
  ok('残缺 Beat 不抛异常', Array.isArray(corrupt.beats));
  ok('可识别的残缺 Beat 保留 text', corrupt.beats[0] && corrupt.beats[0].text === '半截卡');
  ok('可识别的残缺 Beat 保留 color', corrupt.beats[0] && corrupt.beats[0].color === '#fff');
  ok('可识别的残缺 Beat 补 0 坐标', corrupt.beats[0] && corrupt.beats[0].x === 0 && corrupt.beats[0].y === 0);
  ok('完全无 id 的 Beat 被丢弃', !corrupt.beats.some((b) => !b.id));

  console.log('\n== 场景 6：旧工程显式保存为 both，再次打开仍为 both ==');
  const bothProject = parseProject(wrap(baseProject, { settings: { sceneNumber: 'both' } }));
  const bothSerialized = serializeProject(bothProject);
  const bothReparsed = parseProject(bothSerialized);
  ok('round-trip sceneNumber=both', bothReparsed.settings.sceneNumber === 'both');

  if (failures.length) {
    console.log(`\n=== FAIL: ${failures.length} test(s) failed ===`);
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('\n=== ALL PASS ===');
    process.exit(0);
  }
})().catch((err) => {
  console.error('test crashed:', err && err.stack ? err.stack : err);
  process.exit(2);
});
