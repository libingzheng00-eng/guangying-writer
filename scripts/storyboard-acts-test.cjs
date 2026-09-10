/** 故事板幕行为契约：仅合成数据；内存 bundle 验证模型、真实 store 和保存格式。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

(async () => {
  const result = await require('esbuild').build({ stdin: {
    contents: `export { moveStoryboardScenes, storyboardPageCounts } from './src/model/storyboard';
      export { useStore } from './src/store/store';
      export { createProject } from './src/model/project';
      export { serializeProject, parseProject } from './src/io/zhsp';`,
    resolveDir: path.resolve(__dirname, '..'), loader: 'ts',
  }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' });
  const mod = new Module(path.join(__dirname, 'storyboard-acts-test.bundle.cjs'), module);
  mod.filename = path.join(__dirname, 'storyboard-acts-test.bundle.cjs');
  mod.paths = Module._nodeModulePaths(__dirname);
  mod._compile(result.outputFiles[0].text, mod.filename);
  const { moveStoryboardScenes, storyboardPageCounts, useStore, createProject, serializeProject, parseProject } = mod.exports;
  const clone = p => JSON.parse(JSON.stringify(p));
  const fixture = () => {
    const p = createProject('合成幕分组测试');
    p.acts = ['a', 'b', 'c'].map(id => ({ id, title: `合成幕${id}`, color: '#cfe4ff' }));
    p.elements = [{ id: 'preface', type: 'general', text: '合成场前文字' }, ...[1, 2, 3, 4, 5, 6].flatMap(n => [
      { id: `s${n}`, type: 'scene_heading', text: `内景 合成空间${n} 日` },
      { id: `text${n}`, type: 'action', text: `<b>合成动作${n}</b>` },
      { id: `note${n}`, type: 'note', text: `合成备忘${n}` },
    ])];
    p.sceneMeta = [1, 2, 3, 4, 5, 6].map(n => ({
      id: `meta${n}`, elementId: `s${n}`, title: `合成标题${n}`, synopsis: `合成摘要${n}`,
      color: '#cfe4ff', x: n * 100, y: n * 20, w: 240, h: 150,
      ...(n < 3 ? { actId: 'a' } : n < 5 ? { actId: 'b' } : {}),
    }));
    p.beats = [{ id: 'image1', kind: 'image', img: 'data:image/png;base64,c3ludGhldGlj', title: '合成图片', text: '合成备注', color: '#fff', x: 100, y: 200, w: 220, h: 170, sceneId: 's1' },
      { id: 'sound1', kind: 'sound', title: '合成声音', text: '合成声音备注', color: '#fff', x: 500, y: 200, sceneId: 's3' }];
    p.boardLinks = [{ id: 'link1', from: 'scene:s1', to: 'beat:image1', note: '合成关系' },
      { id: 'link2', from: 'scene:s3', to: 'beat:sound1', note: '合成声音关系' }];
    return p;
  };
  const order = p => p.elements.filter(e => e.type === 'scene_heading').map(e => e.id);
  const actId = (p, id) => p.sceneMeta.find(m => m.elementId === id)?.actId;
  const roundTrip = p => assert.deepEqual(parseProject(serializeProject(p)), p, '保存重开完整保留工程');
  const protectedContent = (p, before) => {
    assert.deepEqual([...p.elements].sort((a, b) => a.id.localeCompare(b.id)), [...before.elements].sort((a, b) => a.id.localeCompare(b.id)), '正文元素及格式完整保留');
    assert.deepEqual(p.elements[0], before.elements[0], '场前文字保持原位');
    for (const id of order(p)) {
      const start = p.elements.findIndex(e => e.id === id);
      const original = before.elements.findIndex(e => e.id === id);
      assert.deepEqual(p.elements.slice(start, start + 3), before.elements.slice(original, original + 3), '整场动作及备忘连续跟随');
    }
    assert.deepEqual(p.beats, before.beats, '素材、关联、位置和尺寸保留');
    assert.deepEqual(p.boardLinks, before.boardLinks, '关系线及备注保留');
    const withoutAct = metas => metas.map(({ actId: ignored, ...meta }) => meta);
    assert.deepEqual(withoutAct(p.sceneMeta), withoutAct(before.sceneMeta), '其余场景元数据保留');
    assert.deepEqual(p.settings, before.settings, '写作设置保持');
  };
  let groups = 0;
  const check = (name, fn) => { fn(); groups++; console.log(`PASS ${name}`); };

  check('非连续多选按正文顺序成块归入目标幕尾', () => {
    const p = fixture(), before = clone(p);
    moveStoryboardScenes(p, ['s5', 's1', 's1', 'missing'], 'b');
    assert.deepEqual(order(p), ['s2', 's3', 's4', 's1', 's5', 's6']);
    assert.equal(actId(p, 's1'), 'b'); assert.equal(actId(p, 's5'), 'b');
    protectedContent(p, before); roundTrip(p);
  });
  for (const [edge, expected] of [['before', ['s2', 's3', 's1', 's5', 's4', 's6']], ['after', ['s2', 's3', 's4', 's1', 's5', 's6']]]) {
    check(`非连续多选向后插入目标${edge}`, () => {
      const p = fixture(), before = clone(p);
      moveStoryboardScenes(p, ['s5', 's1'], 'b', { targetId: 's4', edge });
      assert.deepEqual(order(p), expected); protectedContent(p, before);
    });
  }
  check('非连续多选向前移动仍保持源场顺序', () => {
    const p = fixture(), before = clone(p);
    moveStoryboardScenes(p, ['s6', 's4'], 'a', { targetId: 's1', edge: 'before' });
    assert.deepEqual(order(p), ['s4', 's6', 's1', 's2', 's3', 's5']);
    protectedContent(p, before);
  });
  check('回未归幕仅解除归属，忽略卡片落点并保留原正文数组', () => {
    const p = fixture(), before = clone(p), originalElements = p.elements;
    moveStoryboardScenes(p, ['s4', 's1'], undefined, { targetId: 's6', edge: 'after' });
    assert.strictEqual(p.elements, originalElements);
    assert.deepEqual(p.elements, before.elements);
    assert.equal(actId(p, 's1'), undefined); assert.equal(actId(p, 's4'), undefined);
    assert.equal(actId(p, 's2'), 'a'); assert.equal(actId(p, 's3'), 'b');
    protectedContent(p, before); roundTrip(p);
  });
  check('同源落点不改排序', () => {
    const p = fixture();
    moveStoryboardScenes(p, ['s1', 's3'], 'b', { targetId: 's3', edge: 'before' });
    assert.deepEqual(order(p), ['s1', 's2', 's3', 's4', 's5', 's6']);
  });
  check('空选择、无效 ID、正文非场次 ID、无效幕不改变工程', () => {
    for (const [ids, destination] of [[[], 'b'], [['missing'], 'b'], [['text1'], 'b'], [['s1'], 'missing']]) {
      const p = fixture(), before = clone(p);
      moveStoryboardScenes(p, ids, destination);
      assert.deepEqual(p, before);
    }
  });
  check('空幕可接受整场且内容不丢失', () => {
    const p = fixture(), before = clone(p);
    moveStoryboardScenes(p, ['s2'], 'c');
    assert.equal(actId(p, 's2'), 'c');
    protectedContent(p, before); roundTrip(p);
  });

  const state = () => useStore.getState();
  const reset = () => { state().loadProject(fixture()); useStore.setState({ past: [], future: [] }); return clone(state().project); };
  check('批量跨幕一次撤销完整恢复，重做和保存重开保留结果', () => {
    const before = reset();
    state().moveScenesToAct(['s5', 's1'], 'b');
    assert.equal(state().past.length, 1);
    assert.deepEqual(order(state().project), ['s2', 's3', 's4', 's1', 's5', 's6']);
    const after = clone(state().project);
    protectedContent(after, before); roundTrip(after);
    state().undo(); assert.deepEqual(state().project, before);
    state().redo(); assert.deepEqual(state().project, after);
  });
  check('归幕、解除归属为独立撤销步，不合并或误撤销正文', () => {
    const before = reset();
    state().moveScenesToAct(['s1', 's5'], 'b');
    const grouped = clone(state().project);
    state().moveScenesToAct(['s1', 's5'], undefined);
    const ungrouped = clone(state().project);
    assert.equal(state().past.length, 2);
    assert.deepEqual(ungrouped.elements, grouped.elements);
    state().undo(); assert.deepEqual(state().project, grouped);
    state().undo(); assert.deepEqual(state().project, before);
    state().redo(); state().redo(); assert.deepEqual(state().project, ungrouped);
  });
  check('空操作不占用历史或清空重做栈', () => {
    const before = reset();
    state().moveScenesToAct(['s1'], 'b'); state().undo();
    for (const [ids, destination] of [[[], 'b'], [['missing'], 'b'], [['s1'], 'missing'], [['s5'], undefined]]) state().moveScenesToAct(ids, destination);
    assert.deepEqual(state().project, before);
    assert.equal(state().past.length, 0); assert.equal(state().future.length, 1);
  });
  check('删除幕只解除归属，一次撤销恢复幕与全部归属', () => {
    const before = reset();
    state().removeAct('a');
    const after = clone(state().project);
    assert.deepEqual(after.acts.map(a => a.id), ['b', 'c']);
    assert.deepEqual(after.elements, before.elements);
    assert.equal(actId(after, 's1'), undefined); assert.equal(actId(after, 's2'), undefined);
    assert.equal(actId(after, 's3'), 'b'); assert.equal(state().past.length, 1);
    protectedContent(after, before); roundTrip(after);
    state().undo(); assert.deepEqual(state().project, before);
    state().redo(); assert.deepEqual(state().project, after);
  });
  check('删除最后一幕后保存重开保留零幕，撤销可恢复最后一幕', () => {
    reset(); state().removeAct('a'); state().removeAct('b');
    const beforeLastDelete = clone(state().project);
    state().removeAct('c');
    const after = clone(state().project);
    assert.deepEqual(after.acts, []);
    assert.ok(after.sceneMeta.every(meta => meta.actId === undefined));
    assert.deepEqual(after.elements, beforeLastDelete.elements);
    roundTrip(after);
    state().undo(); assert.deepEqual(state().project, beforeLastDelete);
    state().redo(); assert.deepEqual(state().project, after);
  });
  check('旧工程缺失幕字段仍获得默认幕，与显式空幕区分', () => {
    const p = fixture(); delete p.acts;
    const loaded = parseProject(JSON.stringify(p));
    assert.equal(loaded.acts.length, 1);
    assert.equal(loaded.acts[0].id, 'act-1');
    assert.deepEqual(loaded.elements, p.elements);
    assert.deepEqual(parseProject(JSON.stringify({ ...p, acts: [] })).acts, []);
  });
  const page = (...ids) => ({ items: [{ elements: ids.map(id => ({ id })) }] });
  check('幕页数按实际排版页并集统计，同页多场与重复段不累加', () => {
    const p = fixture(), before = clone(p);
    const pages = [{ items: [] }, page('s1', 'text1', 's2', 'text2', 's1'), page('text1', 'note1'), page('s3', 'text3')];
    const counts = storyboardPageCounts(p, pages);
    assert.equal(counts.get('a'), 2, '两场共享第一页且第一场跨第二页，共两页');
    assert.equal(counts.get('b'), 1);
    assert.equal(counts.get('c') || 0, 0, '空幕没有篇幅');
    assert.deepEqual(p, before, '统计不改正文、素材或设置');
  });
  check('跨幕共享排版页分别计一次，未归幕使用空字符串键', () => {
    const p = fixture();
    const counts = storyboardPageCounts(p, [page('s1', 's2', 's3', 's4', 's5', 's6'), page('text5', 'note6')]);
    assert.equal(counts.get('a'), 1);
    assert.equal(counts.get('b'), 1);
    assert.equal(counts.get(''), 2);
    assert.equal(counts.has(undefined), false);
  });
  check('空标题页、场前文字、未知排版元素均不增加幕页数', () => {
    assert.equal(storyboardPageCounts(fixture(), [{ items: [] }, page('preface'), page('unknown')]).size, 0);
    assert.equal(storyboardPageCounts(fixture(), []).size, 0);
  });
  check('不存在的幕归属按未归幕统计，删除全部幕后统计仍准确', () => {
    const p = fixture();
    p.sceneMeta[0].actId = 'missing';
    assert.equal(storyboardPageCounts(p, [page('s1', 'text1')]).get(''), 1);
    p.acts = [];
    assert.deepEqual([...storyboardPageCounts(p, [page('s1', 's3', 's5'), page('text2')])], [['', 2]]);
  });
  console.log(`PASS 故事板幕行为 ${groups} 组（纯模型 / 真实 store / 工程兼容）`);
})().catch(error => { console.error(error); process.exitCode = 1; });
