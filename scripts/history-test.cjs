/**
 * Item 6c：撤销 / 重做安全测试。
 * 只使用合成工程，不启动 Electron，不读取用户工程。
 */
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const entry = path.join(__dirname, 'history.entry.ts');
const bundle = path.join(__dirname, '..', '.tmp-history.cjs');
process.on('exit', () => {
  try { fs.unlinkSync(bundle); } catch (_) { /* 临时文件不存在即可 */ }
});

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

  const { useStore, createProject } = require(bundle);
  const failures = [];
  const ok = (name, condition) => {
    if (condition) console.log(`  ✓ ${name}`);
    else { console.log(`  ✗ ${name}`); failures.push(name); }
  };
  const reset = (project) => {
    useStore.getState().breakHistoryGroup();
    useStore.setState({
      project,
      filePath: null,
      past: [],
      future: [],
      dirty: false,
      selectedIds: [],
      writingSelectionMode: false,
      writingSelectedIds: [],
      activeId: project.elements[0]?.id || null,
      focus: null,
      version: 0,
    });
  };
  const state = () => useStore.getState();

  console.log('\n== Item 6c：撤销 / 重做安全 ==');
  const writing = createProject('正文多选测试');
  writing.elements = [
    { id: 'w1', type: 'action', text: '<b>保留格式</b>' },
    { id: 'w2', type: 'character', text: '测试人物' },
    { id: 'w3', type: 'dialogue', text: '测试对白' },
  ];
  reset(writing);
  const originalWriting = JSON.stringify(state().project);
  state().deleteWritingElements(['w2', 'w3']);
  ok('正文跨段批量删除仅删除所选段', state().project.elements.length === 1 && state().project.elements[0].text === '<b>保留格式</b>');
  ok('删除其他段落不打断当前编辑位置', state().activeId === 'w1');
  state().undo();
  ok('正文批量删除一次撤销完整恢复', JSON.stringify(state().project) === originalWriting);
  state().redo();
  ok('正文批量删除支持重做', state().project.elements.length === 1);
  state().deleteWritingElements(['w1']);
  ok('正文全部删除后保留可编辑空段', state().project.elements.length === 1 && state().project.elements[0].text === '');

  const p = createProject('撤销测试');
  p.beats = [
    { id: 'b1', text: '保留卡', color: '#fff7d6', x: 10, y: 20, w: 300, h: 220 },
    { id: 'b2', text: '删除卡', color: '#fff7d6', x: 400, y: 20 },
  ];
  p.boardLinks = [
    { id: 'l1', from: 'beat:b1', to: 'beat:b2', note: '关系' },
  ];
  reset(p);

  // 连续 resize 必须只产生一个撤销点，且回退到 resize 前的尺寸。
  state().resizeBeat('b1', 320, 240);
  state().resizeBeat('b1', 350, 260);
  ok('连续 resize 合并为一个撤销点', state().past.length === 1);
  ok('连续 resize 的最终尺寸保留', state().project.beats[0].w === 350 && state().project.beats[0].h === 260);
  state().undo();
  ok('一次撤销回到 resize 前尺寸', state().project.beats[0].w === 300 && state().project.beats[0].h === 220);
  ok('撤销 resize 不破坏关系线', state().project.boardLinks.length === 1 && state().project.boardLinks[0].note === '关系');
  state().redo();
  ok('一次重做恢复最终尺寸', state().project.beats[0].w === 350 && state().project.beats[0].h === 260);

  // 无实际变化不应占用撤销点。
  const pastBeforeNoop = state().past.length;
  state().setText(p.elements[0].id, p.elements[0].text);
  ok('无实际变化不生成撤销点', state().past.length === pastBeforeNoop);

  // 删除后撤销应完整恢复卡片与关系线；重做再完整删除。
  reset(p);
  // BoardView 的真实选中值带 `beat:` 前缀，store 也应能正确识别它。
  state().setSelectedIds(['beat:b2']);
  const removed = state().deleteSelectedBeats();
  ok('批量删除返回正确数量', removed === 1);
  ok('删除卡片同时清理孤儿关系线', state().project.beats.length === 1 && state().project.boardLinks.length === 0);
  state().undo();
  ok('撤销删除恢复卡片', state().project.beats.length === 2 && state().project.beats.some((b) => b.id === 'b2'));
  ok('撤销删除恢复关系线', state().project.boardLinks.length === 1 && state().project.boardLinks[0].id === 'l1');
  state().redo();
  ok('重做删除再次清理卡片与关系线', state().project.beats.length === 1 && state().project.boardLinks.length === 0);

  // 场景卡删除必须删除正文整场、清理场景元数据与关系线，但保留其他场景。
  const sceneProject = createProject('场景删除测试');
  sceneProject.elements = [
    { id: 's1', type: 'scene_heading', text: '内景 场景一 日' },
    { id: 'a1', type: 'action', text: '第一场动作' },
    { id: 's2', type: 'scene_heading', text: '外景 场景二 夜' },
    { id: 'a2', type: 'action', text: '第二场动作' },
  ];
  sceneProject.sceneMeta = [
    { id: 'm1', elementId: 's1', title: '一', synopsis: '', color: '#fff' },
    { id: 'm2', elementId: 's2', title: '二', synopsis: '', color: '#fff' },
  ];
  sceneProject.beats = [
    { id: 'sb1', text: '属于场景一', color: '#fff', x: 0, y: 0, sceneId: 's1' },
    { id: 'sb2', text: '属于场景二', color: '#fff', x: 0, y: 0, sceneId: 's2' },
  ];
  sceneProject.boardLinks = [
    { id: 'sl1', from: 'scene:s1', to: 'beat:sb2' },
    { id: 'sl2', from: 'scene:s2', to: 'beat:sb2' },
  ];
  reset(sceneProject);
  state().setSelectedIds(['scene:s1']);
  const sceneRemoved = state().deleteSelectedBoardCards();
  ok('删除整场返回正确数量', sceneRemoved.scenes === 1 && sceneRemoved.beats === 0);
  ok('删除整场移除场景正文但保留下一场', !state().project.elements.some((e) => e.id === 's1' || e.id === 'a1') && state().project.elements.some((e) => e.id === 's2'));
  ok('删除整场清理场景元数据与孤儿关系线', state().project.sceneMeta.length === 1 && state().project.boardLinks.length === 1 && state().project.boardLinks[0].id === 'sl2');
  state().undo();
  ok('撤销整场删除恢复正文、元数据与关系线', state().project.elements.length === 4 && state().project.sceneMeta.length === 2 && state().project.boardLinks.length === 2);
  state().redo();
  ok('重做整场删除仍保留其他场景', state().project.elements.some((e) => e.id === 's2') && !state().project.elements.some((e) => e.id === 's1'));

  // 撤销后产生新编辑必须清空重做栈，避免回到错误分支。
  reset(p);
  state().setText(p.elements[0].id, '第一次修改');
  state().undo();
  ok('撤销后存在重做记录', state().future.length === 1);
  state().setText(p.elements[0].id, '新的分支');
  ok('撤销后新编辑清空旧重做分支', state().future.length === 0 && state().project.elements[0].text === '新的分支');

  // 两个工程快速切换后，不能沿用上一个工程的 coalesce key。
  const p1 = createProject('工程一');
  p1.beats = [{ id: 'same', text: '', color: '#fff7d6', x: 0, y: 0, w: 220, h: 170 }];
  const p2 = createProject('工程二');
  p2.beats = [{ id: 'same', text: '', color: '#fff7d6', x: 0, y: 0, w: 220, h: 170 }];
  state().loadProject(p1);
  state().resizeBeat('same', 300, 200);
  state().loadProject(p2, '/synthetic/project-two.zhsp');
  ok('打开工程清空上一工程的撤销与重做', state().past.length === 0 && state().future.length === 0);
  state().undo();
  ok('打开后立即撤销仍保留当前工程与文件路径', state().project === p2 && state().filePath === '/synthetic/project-two.zhsp' && !state().dirty);
  state().resizeBeat('same', 310, 210);
  state().undo();
  ok('切换工程后撤销只回退当前工程', state().project.name === '工程二' && state().project.beats[0].w === 220);
  const openedBaseline = state().project;
  state().undo();
  ok('当前工程第二次撤销不跨回上一个文件', state().project === openedBaseline && state().past.length === 0 && state().future.length === 1 && state().filePath === '/synthetic/project-two.zhsp');
  state().redo();
  ok('工程内重做恢复当前工程操作', state().project.name === '工程二' && state().project.beats[0].w === 310 && state().filePath === '/synthetic/project-two.zhsp');
  state().undo();
  state().loadProject(p1, '/synthetic/project-one.zhsp');
  state().redo();
  ok('打开另一个工程清空旧重做分支', state().project === p1 && state().past.length === 0 && state().future.length === 0 && !state().dirty);
  state().resizeBeat('same', 330, 230);
  state().newProject();
  const blank = state().project;
  state().undo(); state().redo();
  ok('新建工程不可撤销或重做到旧文件', state().project === blank && state().filePath === null && state().past.length === 0 && state().future.length === 0 && !state().dirty);
  ok('新建工程清除旧焦点请求与选择', state().focus === null && state().selectedIds.length === 0 && state().writingSelectedIds.length === 0);

  // Forty distinct editing transactions must walk back and forward exactly.
  const sequence = createProject('合成连续撤销');
  sequence.elements = [{ id: 'sequence-a', type: 'action', text: '合成起点' }];
  reset(sequence);
  const snapshots = [JSON.stringify(state().project)];
  for (let i = 1; i <= 40; i++) {
    state().breakHistoryGroup();
    state().setText('sequence-a', `合成事务${i}`);
    snapshots.push(JSON.stringify(state().project));
  }
  ok('40个独立正文事务均保留撤销点', state().past.length === 40);
  let exactUndo = true;
  for (let i = 39; i >= 0; i--) {
    state().undo();
    exactUndo &&= JSON.stringify(state().project) === snapshots[i] && state().past.length === i;
  }
  ok('连续40次撤销每一步精确恢复快照', exactUndo && state().future.length === 40);
  let exactRedo = true;
  for (let i = 1; i <= 40; i++) {
    state().redo();
    exactRedo &&= JSON.stringify(state().project) === snapshots[i] && state().future.length === 40 - i;
  }
  ok('连续40次重做每一步精确恢复快照', exactRedo && state().past.length === 40);
  state().undo();
  const beforeBoundary = state();
  let boundaryNotifications = 0;
  const unsubscribeBoundary = useStore.subscribe(() => boundaryNotifications++);
  state().breakHistoryGroup();
  unsubscribeBoundary();
  ok('显式合并断点无状态、版本、dirty、历史或订阅副作用', state() === beforeBoundary && boundaryNotifications === 0);
  state().setText('sequence-a', '合成新分支');
  ok('显式断点后的新输入保留旧撤销且清空redo', state().past.length === 40 && state().future.length === 0);

  // IDs are interface state, not snapshot history; stale IDs must be removed.
  const selectionProject = createProject('合成选区清理');
  selectionProject.elements = [
    { id: 'keep-scene', type: 'scene_heading', text: '内景 合成空间 日' },
    { id: 'keep-action', type: 'action', text: '合成动作' },
  ];
  selectionProject.beats = [{ id: 'keep-beat', text: '合成卡片', color: '#fff', x: 0, y: 0 }];
  reset(selectionProject);
  state().mutate(p => {
    p.elements.push({ id: 'new-action', type: 'action', text: '新合成段落' });
    p.beats.push({ id: 'new-beat', text: '新合成卡片', color: '#fff', x: 0, y: 0 });
  });
  state().requestFocus('new-action', 2);
  state().setSelectedIds(['scene:keep-scene', 'beat:keep-beat', 'keep-beat', 'beat:new-beat', 'scene:keep-action', 'missing']);
  state().setWritingSelectedIds(['keep-action', 'new-action']);
  state().undo();
  ok('撤销新增清除失效active与focus但不强制聚焦', state().activeId === null && state().focus === null);
  ok('撤销仅过滤失效板面选区并保留兼容裸ID', JSON.stringify(state().selectedIds) === JSON.stringify(['scene:keep-scene', 'beat:keep-beat', 'keep-beat']));
  ok('撤销保留尚存在的正文选区', JSON.stringify(state().writingSelectedIds) === JSON.stringify(['keep-action']));
  state().requestFocus('keep-action', 1);
  const survivingFocus = state().focus;
  state().redo();
  ok('重做保留合法active及原焦点请求不制造新请求', state().activeId === 'keep-action' && state().focus === survivingFocus);
  state().mutate(p => {
    p.elements = p.elements.filter(el => el.id !== 'keep-action');
    p.beats = p.beats.filter(beat => beat.id !== 'keep-beat');
  });
  state().undo();
  state().requestFocus('keep-action', 1);
  state().setSelectedIds(['scene:keep-scene', 'beat:keep-beat', 'beat:new-beat']);
  state().setWritingSelectedIds(['keep-action', 'new-action']);
  state().redo();
  ok('重做删除清除失效active与focus', state().activeId === null && state().focus === null);
  ok('重做删除仅过滤消失的卡片与段落选区', JSON.stringify(state().selectedIds) === JSON.stringify(['scene:keep-scene', 'beat:new-beat']) && JSON.stringify(state().writingSelectedIds) === JSON.stringify(['new-action']));

  if (failures.length) {
    console.error(`\nFAILURES: ${failures.length}`);
    process.exitCode = 1;
  } else {
    console.log('\n=== ALL PASS ===');
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
