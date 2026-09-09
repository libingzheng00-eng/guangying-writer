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
  const reset = (project) => useStore.setState({
    project,
    past: [],
    future: [],
    dirty: false,
    selectedIds: [],
    writingSelectionMode: false,
    writingSelectedIds: [],
    activeId: project.elements[0]?.id || null,
    version: 0,
  });
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
  state().loadProject(p2);
  state().resizeBeat('same', 310, 210);
  state().undo();
  ok('切换工程后撤销只回退当前工程', state().project.name === '工程二' && state().project.beats[0].w === 220);

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
