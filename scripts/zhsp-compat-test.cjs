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
const { isDeepStrictEqual } = require('node:util');

const entry = path.join(__dirname, 'zhsp-compat.entry.ts');
const bundle = path.join(__dirname, '..', '.tmp-zhsp-compat.cjs');
process.on('exit', () => {
  try { fs.unlinkSync(bundle); } catch (_) { /* 不存在即可 */ }
});

function wrap(oldA, extras = {}) {
  return JSON.stringify({
    // 旧版 app 标识仍必须能被 parseProject 打开；新版保存时会写 guangying-writer。
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

  const { parseProject, serializeProject, defaultSettings, createProject, sceneEndpoint, beatEndpoint, cardEndpoint, FALLBACK_CARD_W, FALLBACK_SCENE_H, FALLBACK_BEAT_H } = require(bundle);

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
  ok('新版保存写入 guangying-writer 标识', JSON.parse(oldSerialized).app === 'guangying-writer');
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
  ok('旧 wimg 归并为唯一图片卡类型', newReparsed.beats[2].kind === 'image');
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

  // ===== alpha.6.1 起：SceneMeta.w / h 持久化 + endpoints 跟随（Item 6a 收尾） =====

  console.log('\n== 场景 7：SceneMeta.w / h round-trip（合成工程含一张已 resize 的场景卡） ==');
  // 准备一个工程：1 个场景标题元素 + 1 个 sceneMeta，自定义 w/h
  const sizedScene = {
    baseProject,
    overrides: {
      elements: [
        { id: 'el-1', type: 'scene_heading', text: '1. 内景 / 合成咖啡馆', sceneNumber: '1' },
      ],
      sceneMeta: [
        { id: 'sc-1', elementId: 'el-1', title: '合成场景', synopsis: '合成', color: '#cfe4ff', x: 100, y: 200, w: 320, h: 180 },
      ],
      beats: [
        { id: 'b-r1', text: '已 resize 的卡', color: '#FCEBEB', x: 50, y: 80, kind: 'image', w: 480, h: 360 },
      ],
      boardLinks: [
        { id: 'l-1', from: 'scene:el-1', to: 'beat:b-r1' },
      ],
    },
  };
  // 直接构造一个 project（含 sceneMeta / beats / boardLinks），不依赖 elements 派生。
  const customProject = {
    ...baseProject,
    elements: sizedScene.overrides.elements,
    sceneMeta: sizedScene.overrides.sceneMeta,
    beats: sizedScene.overrides.beats,
    boardLinks: sizedScene.overrides.boardLinks,
  };
  const customSerialized = serializeProject(customProject);
  const customReparsed = parseProject(customSerialized);
  ok('round-trip 后 sceneMeta 数量 = 1', customReparsed.sceneMeta.length === 1);
  ok('round-trip SceneMeta.w 保留 = 320', customReparsed.sceneMeta[0].w === 320);
  ok('round-trip SceneMeta.h 保留 = 180', customReparsed.sceneMeta[0].h === 180);
  ok('round-trip SceneMeta.x 保留 = 100', customReparsed.sceneMeta[0].x === 100);
  ok('round-trip SceneMeta.y 保留 = 200', customReparsed.sceneMeta[0].y === 200);
  ok('round-trip Beat.w 保留 = 480', customReparsed.beats[0].w === 480);
  ok('round-trip Beat.h 保留 = 360', customReparsed.beats[0].h === 360);
  ok('round-trip boardLinks 数量 = 1', customReparsed.boardLinks.length === 1);

  console.log('\n== 场景 8：旧 .zhsp（无 SceneMeta.w/h、无 Beat.w/h）仍正常打开 ==');
  // 故意制造一个"alpha.6 之前"格式的工程：sceneMeta / beats 都没有 w/h 字段
  const oldScene = {
    baseProject,
    overrides: {
      elements: [
        { id: 'el-1', type: 'scene_heading', text: '1. 内景 / 合成老场景', sceneNumber: '1' },
      ],
      sceneMeta: [
        { id: 'sc-1', elementId: 'el-1', title: '合成旧场景', synopsis: '合成', color: '#cfe4ff', x: 50, y: 50 },
      ],
      beats: [
        { id: 'b-old', text: '合成老卡', color: '#FCEBEB', x: 30, y: 30 }, // 无 w/h / kind / title / img
      ],
      boardLinks: [
        { id: 'l-1', from: 'scene:el-1', to: 'beat:b-old' },
      ],
    },
  };
  const oldCustomProject = {
    ...baseProject,
    elements: oldScene.overrides.elements,
    sceneMeta: oldScene.overrides.sceneMeta,
    beats: oldScene.overrides.beats,
    boardLinks: oldScene.overrides.boardLinks,
  };
  // wrap() 这里不能直接用（它要求 JSON.stringify），改用 serializeProject → JSON.stringify 链路模拟：
  const oldSerializedText = serializeProject(oldCustomProject);
  // 直接 parse 这个 JSON 文本，验证 round-trip 不抛异常
  const oldReparsed2 = parseProject(oldSerializedText);
  ok('旧 .zhsp 打开不抛异常', oldReparsed2.sceneMeta.length === 1 && oldReparsed2.beats.length === 1);
  ok('旧 SceneMeta 解析后 w 是 undefined', oldReparsed2.sceneMeta[0].w === undefined);
  ok('旧 SceneMeta 解析后 h 是 undefined', oldReparsed2.sceneMeta[0].h === undefined);
  ok('旧 Beat 解析后 w 是 undefined', oldReparsed2.beats[0].w === undefined);
  ok('旧 Beat 解析后 h 是 undefined', oldReparsed2.beats[0].h === undefined);
  ok('旧 .zhsp 的 sceneMeta / beats / boardLinks 保留全字段', oldReparsed2.sceneMeta[0].x === 50 && oldReparsed2.sceneMeta[0].y === 50 && oldReparsed2.beats[0].x === 30 && oldReparsed2.beats[0].y === 30);
  // 把"旧格式 .zhsp 装包 JSON 文本"喂回 parseProject：必须不抛
  const reconstructed = JSON.parse(oldSerializedText);
  ok('序列化文本含 sceneMeta w 缺省（无 key 写入）', reconstructed.project.sceneMeta[0].w === undefined);
  ok('序列化文本不含 undefined 字面值', !/undefined/.test(oldSerializedText));

  console.log('\n== 场景 9：关系线 endpoints 在重开后仍按卡片中心连接 ==');
  // 用卡片的中心 (x + w/2, y + h/2) 作为 endpoint。对于旧工程无 w/h 的，
  // sceneEndpoint 走 FALLBACK_CARD_W / FALLBACK_SCENE_H；beatEndpoint 走 FALLBACK_CARD_W / FALLBACK_BEAT_H。
  // 重开自定义尺寸的工程：endpoints 应基于持久化的 w/h 算
  const epNewScene = sceneEndpoint(customReparsed.sceneMeta[0], { x: 0, y: 0 });
  const epNewBeat = beatEndpoint(customReparsed.beats[0]);
  ok('已 resize 场景卡 endpoint x = 100 + 320/2 = 260', epNewScene.x === 100 + 320 / 2);
  ok('已 resize 场景卡 endpoint y = 200 + 180/2 = 290', epNewScene.y === 200 + 180 / 2);
  ok('已 resize 节拍卡 endpoint x = 50 + 480/2 = 290', epNewBeat.x === 50 + 480 / 2);
  ok('已 resize 节拍卡 endpoint y = 80 + 360/2 = 260', epNewBeat.y === 80 + 360 / 2);

  // 重开旧工程：endpoints 应基于 fallback 算
  const epOldScene = sceneEndpoint(oldReparsed2.sceneMeta[0], { x: 0, y: 0 });
  const epOldBeat = beatEndpoint(oldReparsed2.beats[0]);
  ok('旧场景卡 endpoint x = 50 + 220/2 = 160', epOldScene.x === 50 + FALLBACK_CARD_W / 2);
  ok('旧场景卡 endpoint y = 50 + 96/2 = 98', epOldScene.y === 50 + FALLBACK_SCENE_H / 2);
  ok('旧节拍卡 endpoint x = 30 + 220/2 = 140', epOldBeat.x === 30 + FALLBACK_CARD_W / 2);
  ok('旧节拍卡 endpoint y = 30 + 92/2 = 76', epOldBeat.y === 30 + FALLBACK_BEAT_H / 2);

  console.log('\n== 场景 10：endpoints 对 NaN / Infinity / 字符串缺省不会炸 ==');
  const dirtyScene = { x: 100, y: 100, w: NaN, h: Infinity };
  const epDirty = sceneEndpoint(dirtyScene, { x: 0, y: 0 });
  ok('NaN/Infinity → 走 fallback（场景卡）', epDirty.x === 100 + FALLBACK_CARD_W / 2 && epDirty.y === 100 + FALLBACK_SCENE_H / 2);
  const cardEpDirty = cardEndpoint({ x: 0, y: 0 }, { w: 'bad', h: null }, { w: 200, h: 100 });
  ok('cardEndpoint 字符串/null → 走 fallback', cardEpDirty.x === 100 && cardEpDirty.y === 50);

  console.log('\n== 场景 11：旧 fromId/toId 关系线与现行关系线混存 ==');
  // Completely synthetic historical shape. Feed raw JSON into the reader:
  // serializing a current model first would hide an admission regression.
  const legacyLinks = [
    { id: 'old-scene-beat', fromId: 'legacy-scene', toId: 'legacy-beat', note: '合成旧关系说明', extra: { dash: true, weight: 2 } },
    { id: 'old-beat-scene', fromId: 'legacy-beat', toId: 'legacy-scene' },
    { id: 'old-unresolved', fromId: 'removed-scene', toId: 'missing-card', note: '合成未解析关系' },
    { id: 'old-meta-reference', fromId: 'legacy-meta', toId: 'legacy-beat' },
    { id: 'old-action-reference', fromId: 'legacy-action', toId: 'legacy-beat' },
    { id: 'old-prefixed', fromId: 'scene:legacy-scene', toId: 'beat:legacy-beat' },
    { id: 'current-prefixed', from: 'scene:legacy-scene', to: 'beat:legacy-beat', note: '合成现行关系' },
    // Current endpoints have authority even when legacy aliases disagree.
    { id: 'current-with-aliases', from: 'beat:legacy-beat', to: 'scene:legacy-scene', fromId: 'removed-scene', toId: 'missing-card', note: '保留当前端点' },
    { id: 'current-bare', from: 'legacy-scene', to: 'legacy-beat', note: '当前字段原样保留' },
  ];
  const legacyLinkProject = {
    ...baseProject,
    elements: [
      { id: 'legacy-scene', type: 'scene_heading', text: '内景 合成空间 日' },
      { id: 'legacy-action', type: 'action', text: '合成动作。' },
    ],
    sceneMeta: [{ id: 'legacy-meta', elementId: 'legacy-scene', title: '合成标题', synopsis: '合成摘要', color: '#cfe4ff' }],
    beats: [{ id: 'legacy-beat', text: '合成卡片', color: '#fff7d6', x: 20, y: 40, kind: 'image', img: 'data:image/png;base64,c3ludGhldGlj', w: 200, h: 160 }],
    boardLinks: legacyLinks,
  };
  const expectedLegacyLinks = [
    { ...legacyLinks[0], from: 'scene:legacy-scene', to: 'beat:legacy-beat' },
    { ...legacyLinks[1], from: 'beat:legacy-beat', to: 'scene:legacy-scene' },
    { ...legacyLinks[2], from: 'removed-scene', to: 'missing-card' },
    { ...legacyLinks[3], from: 'legacy-meta', to: 'beat:legacy-beat' },
    { ...legacyLinks[4], from: 'legacy-action', to: 'beat:legacy-beat' },
    { ...legacyLinks[5], from: 'scene:legacy-scene', to: 'beat:legacy-beat' },
    ...legacyLinks.slice(6),
  ];
  for (const [shape, raw] of [
    ['旧品牌封装', wrap(legacyLinkProject)],
    ['现行品牌封装', JSON.stringify({ app: 'guangying-writer', fileVersion: 1, project: legacyLinkProject })],
    ['无封装工程', JSON.stringify(legacyLinkProject)],
  ]) {
    let loaded;
    try { loaded = parseProject(raw); } catch (_) { /* The assertion reports failed admission below. */ }
    ok(`${shape}可打开混存的新旧关系线`, !!loaded);
    if (!loaded) continue;
    ok(`${shape}按真实卡片类型迁移且保留全部旧字段、备注和扩展数据`, isDeepStrictEqual(loaded.boardLinks, expectedLegacyLinks));
    ok(`${shape}不猜测元数据 ID、非场景正文 ID 或已删除端点`, isDeepStrictEqual(loaded.boardLinks.slice(2, 5).map(link => [link.from, link.to]), [
      ['removed-scene', 'missing-card'], ['legacy-meta', 'beat:legacy-beat'], ['legacy-action', 'beat:legacy-beat'],
    ]));
    ok(`${shape}完整现行端点优先且原样保留`, isDeepStrictEqual(loaded.boardLinks.slice(6), legacyLinks.slice(6)));
    ok(`${shape}旧关系线迁移不改正文、场景元数据和图文卡片`, isDeepStrictEqual(
      [loaded.elements, loaded.sceneMeta, loaded.beats],
      [legacyLinkProject.elements, legacyLinkProject.sceneMeta, legacyLinkProject.beats],
    ));
    const saved = serializeProject(loaded);
    const reopened = parseProject(saved);
    ok(`${shape}保存再打开不丢线、不丢旧字段、不重复迁移`, isDeepStrictEqual(reopened, loaded));
    ok(`${shape}保存文件包含规范端点及原始旧别名`, isDeepStrictEqual(JSON.parse(saved).project.boardLinks, expectedLegacyLinks));
  }

  console.log('\n== 场景 12：旧关系线迁移不能绕过现行端点和 ID 校验 ==');
  const oldPair = { id: 'unsafe-link', fromId: 'legacy-scene', toId: 'legacy-beat' };
  const rejectsLink = (name, link) => {
    let rejected = false;
    try { parseProject(wrap(legacyLinkProject, { boardLinks: [link] })); } catch (_) { rejected = true; }
    ok(name, rejected);
  };
  for (const [name, link] of [
    ['只有 from 的混合形态', { ...oldPair, from: 'scene:legacy-scene' }],
    ['只有 to 的混合形态', { ...oldPair, to: 'beat:legacy-beat' }],
    ['两端现代字段为 null', { ...oldPair, from: null, to: null }],
    ['现代 from 为 null', { ...oldPair, from: null, to: 'beat:legacy-beat' }],
    ['现代 to 为 null', { ...oldPair, from: 'scene:legacy-scene', to: null }],
    ['现代 from 为空串', { ...oldPair, from: '', to: 'beat:legacy-beat' }],
    ['现代 to 为对象', { ...oldPair, from: 'scene:legacy-scene', to: {} }],
    ['现代 from 为危险对象键', { ...oldPair, from: '__proto__', to: 'beat:legacy-beat' }],
    ['现代 to 含选择器引号', { ...oldPair, from: 'scene:legacy-scene', to: 'bad"id' }],
    ['旧形态缺 fromId', { id: 'missing-from', toId: 'legacy-beat' }],
    ['旧形态缺 toId', { id: 'missing-to', fromId: 'legacy-scene' }],
    ['旧形态备注不是字符串', { ...oldPair, note: {} }],
  ]) rejectsLink(`${name}仍拒绝，不借旧别名兜底`, link);
  for (const field of ['fromId', 'toId']) {
    for (const [label, value] of [
      ['null', null], ['number', 7], ['object', {}], ['array', []], ['empty', ''],
      ['whitespace', '   '], ['reserved', '__proto__'], ['constructor', 'constructor'],
      ['quote', 'bad"id'], ['control', 'bad\nid'], ['overlong', 'x'.repeat(513)],
    ]) rejectsLink(`旧 ${field} 的 ${label} 非法值仍拒绝`, { ...oldPair, [field]: value });
  }

  console.log('\n== 场景 13：端点前缀不占卡片 ID 长度，后缀仍须安全 ==');
  const longestSceneId = 's'.repeat(512);
  const longestBeatId = 'b'.repeat(512);
  const longIdProject = {
    ...baseProject,
    elements: [{ id: longestSceneId, type: 'scene_heading', text: '内景 合成长 ID 场景 日' }],
    beats: [{ id: longestBeatId, text: '合成长 ID 卡片', color: '#fff7d6', x: 10, y: 20 }],
  };
  const longestEndpoints = [
    [`scene:${longestSceneId}`, `beat:${longestBeatId}`],
    [`beat:${longestBeatId}`, `scene:${longestSceneId}`],
  ];
  for (const [shape, links] of [
    ['旧裸 ID 迁移', [
      { id: 'long-old-forward', fromId: longestSceneId, toId: longestBeatId, note: '合成正向' },
      { id: 'long-old-reverse', fromId: longestBeatId, toId: longestSceneId, note: '合成反向' },
    ]],
    ['现行带前缀端点', [
      { id: 'long-current-forward', from: longestEndpoints[0][0], to: longestEndpoints[0][1] },
      { id: 'long-current-reverse', from: longestEndpoints[1][0], to: longestEndpoints[1][1] },
    ]],
  ]) {
    let loaded;
    try { loaded = parseProject(wrap(longIdProject, { boardLinks: links })); } catch (_) { /* Report below. */ }
    ok(`${shape}接受 scene 和 beat 各 512 字符的真实 ID`, !!loaded);
    if (!loaded) continue;
    ok(`${shape}规范端点保留完整的 512 字符 ID`, isDeepStrictEqual(loaded.boardLinks.map(link => [link.from, link.to]), longestEndpoints));
    ok(`${shape}不截短原始关系字段和备注`, loaded.boardLinks.every((link, index) => Object.entries(links[index]).every(([key, value]) => link[key] === value)));
    let reopened;
    try { reopened = parseProject(serializeProject(loaded)); } catch (_) { /* Admission alone is insufficient: the result must remain saveable. */ }
    ok(`${shape}保存再打开完整往返，不因增加前缀而拒绝`, !!reopened && isDeepStrictEqual(reopened, loaded));
  }
  for (const prefix of ['scene:', 'beat:']) {
    for (const [label, suffix] of [
      ['513 字符', 'x'.repeat(513)], ['空', ''], ['空白', '   '],
      ['保留对象键', '__proto__'], ['constructor', 'constructor'], ['prototype', 'prototype'],
      ['选择器注入', 'bad\"id'], ['控制字符', 'bad\nid'], ['反斜线', 'bad\\id'], ['标签', '<bad>'],
    ]) {
      for (const side of ['from', 'to']) {
        rejectsLink(`现行 ${side} 的 ${prefix}${label} 后缀拒绝`, {
          id: 'unsafe-prefixed-current', from: 'scene:legacy-scene', to: 'beat:legacy-beat', [side]: prefix + suffix,
        });
        rejectsLink(`旧 ${side}Id 的 ${prefix}${label} 后缀首次迁移即拒绝`, {
          ...oldPair, [`${side}Id`]: prefix + suffix,
        });
      }
    }
  }

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
