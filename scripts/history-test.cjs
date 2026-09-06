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
    version: 0,
  });
  const state = () => useStore.getState();

  console.log('\n== Item 6c：撤销 / 重做安全 ==');

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
  state().setSelectedIds(['b2']);
  const removed = state().deleteSelectedBeats();
  ok('批量删除返回正确数量', removed === 1);
  ok('删除卡片同时清理孤儿关系线', state().project.beats.length === 1 && state().project.boardLinks.length === 0);
  state().undo();
  ok('撤销删除恢复卡片', state().project.beats.length === 2 && state().project.beats.some((b) => b.id === 'b2'));
  ok('撤销删除恢复关系线', state().project.boardLinks.length === 1 && state().project.boardLinks[0].id === 'l1');
  state().redo();
  ok('重做删除再次清理卡片与关系线', state().project.beats.length === 1 && state().project.boardLinks.length === 0);

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
