/** 自由板独立坐标与原子历史专项；只使用内存中的合成工程。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

const repo = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
let count = 0;
const check = (label, actual, expected = true) => {
  assert.deepEqual(actual, expected, label);
  console.log(`✓ ${label}`);
  count++;
};

(async () => {
  const built = await esbuild.build({
    stdin: {
      contents: `export { useStore } from './src/store/store';
        export { createProject } from './src/model/project';
        export { parseProject, serializeProject } from './src/io/zhsp';
        export * from './src/model/boardWorkspace';
        export { beatEndpoint, clampSize, RESIZE_LIMITS } from './src/model/board';`,
      resolveDir: repo,
      sourcefile: 'board-workspace-model.entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    logLevel: 'silent',
  });
  const mod = new Module(path.join(__dirname, 'board-workspace-model.bundle.cjs'), module);
  mod.filename = path.join(__dirname, 'board-workspace-model.bundle.cjs');
  mod.paths = Module._nodeModulePaths(__dirname);
  mod._compile(built.outputFiles[0].text, mod.filename);
  const {
    useStore, createProject, parseProject, serializeProject, boardBeatPosition,
    snapBoardPosition, BOARD_GRID_SIZE, BOARD_SNAP_TOLERANCE_PX, beatEndpoint,
    clampSize, RESIZE_LIMITS,
  } = mod.exports;
  const state = () => useStore.getState();
  const fixture = createProject('合成自由板独立坐标测试');
  fixture.elements = [
    { id: 's1', type: 'scene_heading', text: '内景 合成测试棚 日' },
    { id: 'a1', type: 'action', text: '<b>合成动作一</b>' },
    { id: 's2', type: 'scene_heading', text: '外景 合成测试园 夜' },
    { id: 'a2', type: 'action', text: '合成动作二' },
  ];
  fixture.sceneMeta = [
    { id: 'm1', elementId: 's1', title: '合成场景一', synopsis: '合成梗概一', color: '#ffffff', x: 20, y: 30, w: 240, h: 180 },
    { id: 'm2', elementId: 's2', title: '合成场景二', synopsis: '合成梗概二', color: '#ffffff', x: 280, y: 30 },
  ];
  fixture.beats = [
    { id: 'b1', kind: 'image', text: '合成图片备注', title: '合成图片', img: 'data:image/png;base64,AA==', color: '#ffffff', x: 550, y: 700, w: 240, h: 180, sceneId: 's1' },
    { id: 'b2', kind: 'sound', text: '合成声音备注', title: '合成声音', color: '#ffffff', x: 820, y: 130 },
    { id: 'b3', kind: 'beat', text: '合成灵感', color: '#ffffff', x: 20, y: 160, boardX: 1020, boardY: 230, w: 260, h: 190 },
  ];
  fixture.boardLinks = [
    { id: 'l1', from: 'scene:s1', to: 'beat:b1', note: '合成场景关系' },
    { id: 'l2', from: 'beat:b1', to: 'beat:b2', note: '合成素材关系' },
    { id: 'l3', from: 'scene:s1', to: 'scene:s2', note: '合成场景顺序' },
    { id: 'l4', from: 'beat:b2', to: 'beat:b3', note: '合成声音关系' },
  ];
  const reset = (project = fixture) => {
    state().loadProject(clone(project));
    useStore.setState({ past: [], future: [], dirty: false, selectedIds: [], version: 0 });
  };
  const writingData = project => ({
    elements: project.elements,
    beats: project.beats.map(({ boardX, boardY, ...beat }) => beat),
    boardLinks: project.boardLinks,
    settings: project.settings,
    titlePage: project.titlePage,
    acts: project.acts,
  });

  check('世界网格与屏幕吸附容差为28和6', [BOARD_GRID_SIZE, BOARD_SNAP_TOLERANCE_PX], [28, 6]);
  const legacyBeat = Object.freeze({ x: 41, y: 73 });
  check('缺失自由板坐标时只读回退旧坐标', boardBeatPosition(legacyBeat), { x: 41, y: 73 });
  check('只读投影不新增可选字段', Object.keys(legacyBeat), ['x', 'y']);
  check('独立坐标优先并按轴回退', boardBeatPosition({ x: 41, y: 73, boardX: 0 }), { x: 0, y: 73 });
  check('损坏自由板坐标按轴回退有限旧坐标', boardBeatPosition({ x: 41, y: 73, boardX: NaN, boardY: Infinity }), { x: 41, y: 73 });
  check('损坏旧坐标仅在只读投影兜底0', boardBeatPosition({ x: NaN, y: Infinity }), { x: 0, y: 0 });
  check('吸附默认关闭保持输入坐标', snapBoardPosition({ x: 25, y: 34 }), { x: 25, y: 34 });
  check('每个轴仅在6屏幕像素内吸附', snapBoardPosition({ x: 22, y: 35 }, 1, true), { x: 28, y: 35 });
  check('zoom2时世界容差降为3', snapBoardPosition({ x: 25, y: 24 }, 2, true), { x: 28, y: 24 });
  check('zoom0.5时世界容差增为12', snapBoardPosition({ x: 17, y: 15 }, 0.5, true), { x: 28, y: 15 });
  check('负数位置也靠近正确世界网格', snapBoardPosition({ x: -25, y: -34 }, 1, true), { x: -28, y: -28 });
  check('Alt绕过磁性吸附', snapBoardPosition({ x: 25, y: 30 }, 1, true, true), { x: 25, y: 30 });
  check('无效缩放安全回退1', snapBoardPosition({ x: 25, y: 35 }, Infinity, true), { x: 28, y: 35 });

  reset();
  const original = clone(state().project);
  state().moveBoardCards([{ id: 'beat:b1', x: 610, y: 80 }]);
  check('单卡拖动只写独立自由板坐标', boardBeatPosition(state().project.beats[0]), { x: 610, y: 80 });
  check('单卡拖动完整保留写作素材和正文', writingData(state().project), writingData(original));
  check('单卡拖动不改其他卡片和场景元数据', [state().project.beats.slice(1), state().project.sceneMeta], [original.beats.slice(1), original.sceneMeta]);
  check('单卡拖动一次提交一个撤销点', state().past.length, 1);
  const movedSingle = clone(state().project);
  state().undo();
  check('撤销恢复旧卡并移除新坐标字段', state().project, original);
  state().redo();
  check('重做完整恢复独立自由板坐标', state().project, movedSingle);
  check('旧端点几何仍按写作坐标计算', beatEndpoint(state().project.beats[0]), beatEndpoint(original.beats[0]));

  reset();
  state().moveBoardCards([
    { id: 'scene:s1', x: 120, y: 140 },
    { id: 'beat:b2', x: 920, y: 240 },
    { id: 'beat:b3', x: 1120, y: 340 },
  ]);
  check('混合组拖动提交场景与两张素材的落点', [
    { x: state().project.sceneMeta[0].x, y: state().project.sceneMeta[0].y },
    ...state().project.beats.slice(1).map(boardBeatPosition),
  ], [{ x: 120, y: 140 }, { x: 920, y: 240 }, { x: 1120, y: 340 }]);
  check('混合组拖动保持全部正文与写作坐标', writingData(state().project), writingData(original));
  check('混合组拖动只生成一条撤销记录', state().past.length, 1);
  const movedGroup = clone(state().project);
  state().undo();
  check('混合组拖动一次完整撤销', state().project, original);
  state().redo();
  check('混合组拖动一次完整重做', state().project, movedGroup);

  reset();
  state().moveBoardCards([{ id: 'beat:b1', x: 610, y: 80 }]);
  state().moveBoardCards([{ id: 'beat:b1', x: 710, y: 180 }]);
  check('同卡快速两次手势不合并撤销', state().past.length, 2);
  state().undo();
  check('撤销第二次手势保留第一次位置', boardBeatPosition(state().project.beats[0]), { x: 610, y: 80 });
  state().undo();
  check('第二次撤销回到旧写作坐标回退', state().project.beats[0], original.beats[0]);
  const redoBefore = state();
  for (const positions of [
    [], [{ id: 'beat:b1', x: 550, y: 700 }],
    [{ id: 'beat:b1', x: 900, y: 90 }, { id: 'beat:b1', x: 550, y: 700 }],
    [{ id: 'beat:missing', x: 20, y: 30 }],
    [{ id: 'scene:a1', x: 20, y: 30 }],
    [{ id: 'beat:b1', x: NaN, y: 30 }],
    [{ id: 'beat:b1', x: 20, y: Infinity }],
    [{ id: 'beat:b1', x: '20', y: 30 }],
    [{ id: 'beat:b1', x: 20, y: 30 }, { id: 'beat:b2', x: Infinity, y: 80 }],
  ]) state().moveBoardCards(positions);
  check('无效或原位批次不改变项目引用', state().project === redoBefore.project);
  check('无效或原位批次保留全部重做记录', state().future === redoBefore.future && state().future.length === 2);
  check('无效或原位批次保留版本与dirty', [state().version, state().dirty, state().past.length], [redoBefore.version, redoBefore.dirty, 0]);
  check('无效或原位批次不添加旧卡可选坐标', ['boardX', 'boardY'].some(key => Object.hasOwn(state().project.beats[0], key)), false);

  reset();
  state().setSelectedIds(['scene:s2', 'beat:b2']);
  state().setBoardCardColors(['scene:s1', 'beat:b1'], '#90ad92');
  check('批量改色仅影响调用方可见ID', [state().project.sceneMeta.map(meta => meta.color), state().project.beats.map(beat => beat.color)], [['#90ad92', '#ffffff'], ['#90ad92', '#ffffff', '#ffffff']]);
  check('批量改色不更改选择集合', state().selectedIds, ['scene:s2', 'beat:b2']);
  check('批量改色一次提交一条历史', state().past.length, 1);
  state().undo();
  check('批量改色一次完整撤销', state().project, original);
  const colorRedo = state();
  state().setBoardCardColors(['scene:s1', 'beat:b1'], '#ffffff');
  state().setBoardCardColors([], '#90ad92');
  state().setBoardCardColors(['beat:missing'], '#90ad92');
  check('原位和无效改色保留重做版本', [state().project === colorRedo.project, state().future === colorRedo.future, state().version], [true, true, colorRedo.version]);
  reset();
  state().updateBeat('b1', { text: '合成备注第一次' });
  state().setBoardCardColors(['beat:b1'], '#90ad92');
  state().updateBeat('b1', { text: '合成备注第二次' });
  check('批量改色切断前后旧文本编辑合并窗口', state().past.length, 3);

  reset();
  state().commitBoardCardTitle('b1', '合成标题第一次');
  state().commitBoardCardTitle('b1', '合成标题第二次');
  check('两次已完成标题编辑分别产生撤销记录', state().past.length, 2);
  state().undo();
  check('撤销第二次标题编辑保留第一次标题', state().project.beats[0].title, '合成标题第一次');
  state().undo();
  check('再撤销第一次标题编辑恢复完整原卡', state().project, original);
  const titleRedo = state();
  state().commitBoardCardTitle('b1', fixture.beats[0].title);
  state().commitBoardCardTitle('missing', '合成不存在标题');
  state().commitBoardCardTitle('b3', '');
  check('原位或未知标题提交保留项目redo及状态', [state().project === titleRedo.project, state().future === titleRedo.future, state().dirty, state().version], [true, true, titleRedo.dirty, titleRedo.version]);
  check('旧卡空标题确认不物化可选title字段', Object.hasOwn(state().project.beats[2], 'title'), false);
  state().redo();
  check('原位草稿确认后仍可重做已完成标题编辑', state().project.beats[0].title, '合成标题第一次');

  reset();
  state().updateBeat('b1', { text: '合成正文先完成' });
  state().commitBoardCardTitle('b1', '合成独立标题');
  check('正文与已完成标题分成两个撤销步骤', state().past.length, 2);
  state().undo();
  check('只撤销标题完整保留先前卡片正文', [state().project.beats[0].text, state().project.beats[0].title], ['合成正文先完成', fixture.beats[0].title]);
  state().undo();
  check('再撤销恢复标题前的原正文', state().project, original);

  reset();
  state().commitBoardLinkNote('l1', '合成关系备注第一次');
  state().commitBoardLinkNote('l1', '合成关系备注第二次');
  check('两次已完成关系备注分别产生撤销记录', state().past.length, 2);
  state().undo();
  check('撤销第二次关系备注保留第一次备注', state().project.boardLinks[0].note, '合成关系备注第一次');
  state().undo();
  check('再撤销第一次关系备注恢复原项目', state().project, original);
  const noteRedo = state();
  state().commitBoardLinkNote('l1', fixture.boardLinks[0].note);
  state().commitBoardLinkNote('missing', '合成不存在关系');
  check('原位或未知关系备注保留项目redo及状态', [state().project === noteRedo.project, state().future === noteRedo.future, state().dirty, state().version], [true, true, noteRedo.dirty, noteRedo.version]);
  state().redo();
  check('原位备注草稿确认后仍可重做第一次编辑', state().project.boardLinks[0].note, '合成关系备注第一次');

  reset();
  const cleanCommit = state();
  state().commitBoardCardTitle('b1', fixture.beats[0].title);
  state().commitBoardLinkNote('l1', fixture.boardLinks[0].note);
  check('干净工程原位确认不改变dirty版本历史', [state().project === cleanCommit.project, state().dirty, state().version, state().past.length], [true, false, 0, 0]);
  state().updateBeat('b1', { text: '合成旧接口正文一' });
  state().commitBoardCardTitle('b1', fixture.beats[0].title);
  state().updateBeat('b1', { text: '合成旧接口正文二' });
  check('无变化标题确认仍切断旧正文合并窗口', state().past.length, 2);
  reset();
  state().updateBoardLink('l1', { note: '合成旧接口备注一' });
  state().commitBoardLinkNote('l1', '合成旧接口备注一');
  state().updateBoardLink('l1', { note: '合成旧接口备注二' });
  check('无变化备注确认仍切断旧关系合并窗口', state().past.length, 2);

  reset();
  state().resizeBoardCard('beat:b1', 300, 230);
  state().resizeBoardCard('beat:b1', 360, 280);
  check('两次自由板缩放独立撤销', state().past.length, 2);
  check('自由板缩放保留写作坐标及正文', [state().project.elements, state().project.beats.map(beat => [beat.id, beat.x, beat.y, beat.text])], [original.elements, original.beats.map(beat => [beat.id, beat.x, beat.y, beat.text])]);
  state().undo();
  check('撤销最后缩放保留前一次尺寸', [state().project.beats[0].w, state().project.beats[0].h], [300, 230]);
  state().undo();
  check('再撤销恢复旧尺寸', state().project, original);
  const resizeRedo = state();
  state().resizeBoardCard('beat:b1', 240, 180);
  state().resizeBoardCard('beat:missing', 300, 230);
  check('原位和无效缩放保留重做', [state().project === resizeRedo.project, state().future === resizeRedo.future, state().version], [true, true, resizeRedo.version]);
  for (const [id, kind] of [['scene:s1', 'scene'], ['beat:b1', 'image'], ['beat:b2', 'sound'], ['beat:b3', 'beat']]) {
    reset();
    state().resizeBoardCard(id, -10, 100000);
    const card = kind === 'scene' ? state().project.sceneMeta[0] : state().project.beats.find(beat => `beat:${beat.id}` === id);
    check(`${kind}缩放遵守既有最小最大尺寸`, [card.w, card.h], [RESIZE_LIMITS[kind].minW, RESIZE_LIMITS[kind].maxH]);
    state().resizeBoardCard(id, NaN, Infinity);
    const normalized = kind === 'scene' ? state().project.sceneMeta[0] : state().project.beats.find(beat => `beat:${beat.id}` === id);
    check(`${kind}损坏尺寸沿用既有clamp兜底`, { w: normalized.w, h: normalized.h }, clampSize(kind, NaN, Infinity));
  }
  reset();
  state().resizeBeat('b1', 300, 230);
  state().resizeBeat('b1', 360, 280);
  check('其他视图既有连续resize接口继续合并', state().past.length, 1);

  reset();
  state().setSelectedIds(['beat:b1']);
  state().deleteSelectedBoardCards();
  const afterFirstDelete = clone(state().project);
  state().setSelectedIds(['beat:b2']);
  state().deleteSelectedBoardCards();
  check('独立快速两次批量删除不合并', state().past.length, 2);
  state().undo();
  check('撤销第二次删除只恢复第二批卡和关系', state().project, afterFirstDelete);
  state().undo();
  check('再撤销第一次删除完整恢复全部卡和关系', state().project, original);
  reset();
  state().setSelectedIds(['scene:s1']);
  state().deleteSelectedBoardCards();
  const afterFirstSceneDelete = clone(state().project);
  state().setSelectedIds(['scene:s2']);
  state().deleteSelectedBoardCards();
  check('两个整场删除独立保留历史', state().past.length, 2);
  state().undo();
  check('整场删除撤销保留前一次删除及素材解除关联', state().project, afterFirstSceneDelete);
  state().undo();
  check('两个整场删除完全撤销恢复正文与关联', state().project, original);

  const associated = clone(fixture);
  associated.beats[0].sceneId = 'm1';
  associated.beats[1].sceneId = 's1';
  associated.beats[2].sceneId = 'm2';
  reset(associated);
  state().setSelectedIds(['scene:s1']);
  state().deleteSelectedBoardCards();
  check('整场删除同时解除规范元数据ID和旧标题ID关联', state().project.beats.map(beat => [beat.id, beat.sceneId]), [['b1', undefined], ['b2', undefined], ['b3', 'm2']]);
  check('关联清理保留未选场景及其规范元数据ID', [state().project.sceneMeta.map(meta => meta.id), state().project.elements.map(element => element.id)], [['m2'], ['s2', 'a2']]);
  check('关联清理与整场正文删除仅产生一条历史', state().past.length, 1);
  state().undo();
  check('一次撤销完整恢复规范和旧ID关联及整场内容', state().project, associated);

  const old = parseProject(JSON.stringify({ project: { ...fixture, beats: [fixture.beats[0]] } }));
  check('旧项目解析不新增board坐标key', ['boardX', 'boardY'].some(key => Object.hasOwn(old.beats[0], key)), false);
  const oldSaved = JSON.parse(serializeProject(old)).project;
  check('旧项目保存不新增board坐标key', ['boardX', 'boardY'].some(key => Object.hasOwn(oldSaved.beats[0], key)), false);
  check('旧项目保存重开保持原有坐标素材尺寸', parseProject(serializeProject(old)).beats, old.beats);
  const noSceneCoordinates = clone(fixture);
  noSceneCoordinates.sceneMeta.forEach(meta => { delete meta.x; delete meta.y; });
  const oldScenes = parseProject(serializeProject(noSceneCoordinates));
  check('无坐标旧场景读取后保持x/y字段缺省', oldScenes.sceneMeta.map(meta => [Object.hasOwn(meta, 'x'), Object.hasOwn(meta, 'y')]), [[false, false], [false, false]]);
  reset(oldScenes);
  state().setView('board');
  check('载入并切到自由板不物化场景坐标或历史', [state().project.sceneMeta, state().past.length], [noSceneCoordinates.sceneMeta, 0]);
  const oldScenesSaved = JSON.parse(serializeProject(state().project)).project;
  check('无坐标场景保存时仍不新增x/y字段', oldScenesSaved.sceneMeta.map(meta => [Object.hasOwn(meta, 'x'), Object.hasOwn(meta, 'y')]), [[false, false], [false, false]]);
  check('无坐标旧场景保存重开完整保留元数据', parseProject(serializeProject(state().project)).sceneMeta, noSceneCoordinates.sceneMeta);
  const newProject = clone(fixture);
  newProject.beats[0].boardX = 0;
  newProject.beats[0].boardY = -28;
  const reopened = parseProject(serializeProject(newProject));
  check('新项目序列化完整保存独立坐标和旧坐标', reopened.beats, newProject.beats);
  check('新项目重开不改场景卡和关系', [reopened.sceneMeta, reopened.boardLinks], [newProject.sceneMeta, newProject.boardLinks]);
  const malformed = parseProject(JSON.stringify({ project: { ...fixture, beats: [
    { ...fixture.beats[0], boardX: null, boardY: '28' },
    { ...fixture.beats[1], boardX: 0 },
    { ...fixture.beats[2], boardX: Infinity, boardY: NaN },
  ] } }));
  check('解析非有限或非数的board坐标保持字段缺省', malformed.beats.map(beat => [Object.hasOwn(beat, 'boardX'), Object.hasOwn(beat, 'boardY')]), [[false, false], [true, false], [false, false]]);
  check('解析合法的单轴board坐标并按轴回退', boardBeatPosition(malformed.beats[1]), { x: 0, y: 130 });
  const overflow = parseProject(JSON.stringify({ project: fixture }).replace('"x":550', '"boardX":1e999,"x":550'));
  check('JSON可表示的溢出数字不进入board字段', Object.hasOwn(overflow.beats[0], 'boardX'), false);
  const noMeta = clone(fixture);
  noMeta.sceneMeta = [];
  reset(noMeta);
  state().moveBoardCards([{ id: 'scene:s1', x: 40, y: 60 }]);
  check('合法无元数据场景创建自由板元数据', state().project.sceneMeta.map(meta => [meta.elementId, meta.x, meta.y]), [['s1', 40, 60]]);
  check('补元数据不改变正文', state().project.elements, noMeta.elements);
  state().undo();
  check('补元数据一次撤销保持旧项目缺省', state().project.sceneMeta, []);

  reset();
  useStore.setState({ view: 'board', activeId: 'a1', focus: { id: 'a1', caret: 3, scroll: 'nearest', ts: 123 } });
  const beforeCreateUI = { view: state().view, activeId: state().activeId, focus: state().focus };
  const newSceneId = state().addBoardScene(450, 620);
  check('非空工程自由板创建返回新场景标题ID', typeof newSceneId === 'string' && !!newSceneId && !original.elements.some(element => element.id === newSceneId));
  check('新场景放在最后场完整块后，原正文顺序与文字不变', state().project.elements.slice(0, original.elements.length), original.elements);
  check('新场景沿用标题后动作的空场布局', state().project.elements.slice(-2).map(element => [element.type, element.text]), [['scene_heading', ''], ['action', '']]);
  check('新场元数据同时保存自由板坐标且保持未归幕', state().project.sceneMeta.at(-1), { id: state().project.sceneMeta.at(-1).id, elementId: newSceneId, title: '', synopsis: '', color: '#cfe4ff', x: 450, y: 620 });
  check('自由板创建不改视图或写作焦点', { view: state().view, activeId: state().activeId, focus: state().focus }, beforeCreateUI);
  check('自由板创建保留全部旧素材和关系', [state().project.beats, state().project.boardLinks], [original.beats, original.boardLinks]);
  check('自由板创建正文和坐标只生成一条撤销记录', state().past.length, 1);
  const afterCreate = clone(state().project);
  state().undo();
  check('自由板新场一次撤销同时移除正文与元数据', state().project, original);
  const createRedoBefore = state();
  for (const [x, y] of [[NaN, 80], [80, Infinity], [-Infinity, 80], ['80', 90]]) {
    check('非法坐标新场入口返回null', state().addBoardScene(x, y), null);
  }
  check('非法坐标创建不改项目与重做栈', [state().project === createRedoBefore.project, state().future === createRedoBefore.future, state().version, state().dirty], [true, true, createRedoBefore.version, createRedoBefore.dirty]);
  state().redo();
  check('自由板新场一次重做完整恢复正文和元数据', state().project, afterCreate);

  const empty = clone(fixture);
  empty.elements = [];
  empty.sceneMeta = [];
  empty.beats = [];
  empty.boardLinks = [];
  empty.acts = [];
  reset(empty);
  const firstSceneId = state().addBoardScene(0, -28);
  check('空工程也能创建标题和动作', state().project.elements.map(element => [element.type, element.text]), [['scene_heading', ''], ['action', '']]);
  check('空工程新场有限坐标保留零与负值，未自动归幕', state().project.sceneMeta.map(meta => [meta.elementId, meta.x, meta.y, Object.hasOwn(meta, 'actId')]), [[firstSceneId, 0, -28, false]]);
  check('空工程自由板创建不补幕或新增额外历史', [state().project.acts, state().past.length], [[], 1]);
  const firstSceneCreated = clone(state().project);
  state().undo();
  check('空工程新场一次撤销恢复完全空工程', state().project, empty);
  state().redo();
  check('空工程新场一次重做恢复相同ID与坐标', state().project, firstSceneCreated);

  console.log(`\n自由板数据隔离专项：${count} 条通过。只验证模型和真实store，不代表浏览器或PDF实机验收。`);
})().catch(error => { console.error(error); process.exitCode = 1; });
