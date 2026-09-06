/**
 * scripts/writing-test.cjs
 *
 * 验证写作辅助相关纯函数（第三项）：
 *   - Tab 循环 7 类（action / character / parenthetical / dialogue / transition / shot / scene_heading）
 *   - recognizeType 智能识别（场次标题 / 转场 / 全大写人物 / 括号提示 / 镜头）
 *   - characterForDialogue 反查人物
 *   - contdLabelFor 仅在「当前对白人物 === 上一页最末人物」时返回带姓名版本，否则回退为「（续）」
 *
 * 所有断言仅使用合成数据，不包含任何真实剧本内容。
 * 用法： node scripts/writing-test.cjs
 */
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const entry = path.join(__dirname, 'writing.entry.ts');
const bundle = path.join(__dirname, '..', '.tmp-writing.cjs');
process.on('exit', () => {
  try { fs.unlinkSync(bundle); } catch (_) { /* 不存在即可 */ }
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

  const { recognizeType, characterForDialogue, contdLabelFor, nextTypeOnTab, nextTypeOnEnter } = require(bundle);

  const failures = [];
  const ok = (name, cond) => {
    if (cond) console.log(`  \u2713 ${name}`);
    else { console.log(`  \u2717 ${name}`); failures.push(name); }
  };

  console.log('\n== Tab 七类循环 ==');
  ok('action → Tab → character', nextTypeOnTab('action') === 'character');
  ok('character → Tab → parenthetical', nextTypeOnTab('character') === 'parenthetical');
  ok('parenthetical → Tab → dialogue', nextTypeOnTab('parenthetical') === 'dialogue');
  ok('dialogue → Tab → transition', nextTypeOnTab('dialogue') === 'transition');
  ok('transition → Tab → shot', nextTypeOnTab('transition') === 'shot');
  ok('shot → Tab → scene_heading', nextTypeOnTab('shot') === 'scene_heading');
  ok('scene_heading → Tab → action（循环）', nextTypeOnTab('scene_heading') === 'action');
  ok('action → Shift+Tab → scene_heading（反向循环）', nextTypeOnTab('action', true) === 'scene_heading');
  ok('note 不在循环里 → Tab → action', nextTypeOnTab('note') === 'action');
  ok('act 不在循环里 → Tab → action', nextTypeOnTab('act') === 'action');
  ok('general 不在循环里 → Shift+Tab → scene_heading', nextTypeOnTab('general', true) === 'scene_heading');

  console.log('\n== recognizeType 智能识别 ==');
  ok('内景 → scene_heading', recognizeType('内景 咖啡厅 日') === 'scene_heading');
  ok('外景 → scene_heading', recognizeType('外景 街道 夜') === 'scene_heading');
  ok('数字+点 → scene_heading', recognizeType('1. 内景 咖啡厅 日') === 'scene_heading');
  ok('第一场 → scene_heading', recognizeType('第一场') === 'scene_heading');
  ok('INT → scene_heading', recognizeType('INT. CAFE - DAY') === 'scene_heading');
  ok('EXT → scene_heading', recognizeType('EXT STREET - NIGHT') === 'scene_heading');
  ok('切至：→ transition', recognizeType('切至：') === 'transition');
  ok('淡出。 → transition', recognizeType('淡出。') === 'transition');
  ok('FADE IN → transition', recognizeType('FADE IN:') === 'transition');
  ok('（低声地）→ parenthetical', recognizeType('（低声地）') === 'parenthetical');
  ok('(beat) → parenthetical', recognizeType('(beat)') === 'parenthetical');
  ok('特写 → shot', recognizeType('特写') === 'shot');
  ok('近景 → shot', recognizeType('近景') === 'shot');
  ok('主观镜头 → shot', recognizeType('主观镜头') === 'shot');
  ok('全大写 → character', recognizeType('JOHN') === 'character');
  ok('JOHN SMITH → character', recognizeType('JOHN SMITH') === 'character');
  ok('首字母大写但有空格不算 character', recognizeType('Hello world this is too long for a character') === null);
  ok('空字符串 → null', recognizeType('') === null);
  ok('普通中文长句 → null', recognizeType('他走到窗边，看着外面的雨。') === null);

  console.log('\n== characterForDialogue 反查人物 ==');
  const project = {
    elements: [
      { id: 'sc1', type: 'scene_heading', text: '1. 内景 咖啡厅 日' },
      { id: 'ch1', type: 'character', text: '角色甲' },
      { id: 'd1', type: 'dialogue', text: '你好。' },
      { id: 'd2', type: 'dialogue', text: '再见。' },
      { id: 'sc2', type: 'scene_heading', text: '2. 外景 街道 夜' },
      { id: 'ch2', type: 'character', text: '角色乙' },
      { id: 'd3', type: 'dialogue', text: '夜晚。' },
    ],
  };
  ok('d1 上一人物是 角色甲', characterForDialogue(project, 'd1') === '角色甲');
  ok('d2 上一人物仍是 角色甲', characterForDialogue(project, 'd2') === '角色甲');
  ok('d3 上一人物是 角色乙（跨场次后）', characterForDialogue(project, 'd3') === '角色乙');
  ok('不存在 id 返回 null', characterForDialogue(project, 'nope') === null);

  console.log('\n== contdLabelFor：仅「同人物」时显示角色名（续） ==');
  const settings = { contdText: '（续）', sceneNumber: 'left' };
  const dlg = { elements: [{ id: 'd1', type: 'dialogue', text: '' }] };
  ok('同一人物 → 角色甲（续）', contdLabelFor(dlg, { elements: project.elements, settings }, '角色甲') === '角色甲（续）');
  ok('不同人物 → （续）', contdLabelFor(dlg, { elements: project.elements, settings }, '角色乙') === '（续）');
  ok('上一页没有人物 → （续）', contdLabelFor(dlg, { elements: project.elements, settings }, null) === '（续）');
  ok('对白前没有人物 → （续）', contdLabelFor({ elements: [{ id: 'lone', type: 'dialogue', text: '' }] }, { elements: [{ id: 'lone', type: 'dialogue', text: '' }], settings }, '角色甲') === '（续）');

  console.log('\n== nextTypeOnEnter：空块回车保持动作 ==');
  ok('action 空块回车 → action', nextTypeOnEnter({ id: 'a', type: 'action', text: '' }, true) === 'action');
  ok('character 空块回车 → action（避免空对白）', nextTypeOnEnter({ id: 'c', type: 'character', text: '' }, true) === 'action');
  ok('character 有内容回车 → dialogue', nextTypeOnEnter({ id: 'c', type: 'character', text: 'X' }, false) === 'dialogue');
  ok('dialogue 回车 → character', nextTypeOnEnter({ id: 'd', type: 'dialogue', text: 'X' }, false) === 'character');

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
