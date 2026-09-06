/**
 * scripts/writing-test.cjs
 *
 * 验证写作辅助相关纯函数（第三项 + 第五项）：
 *   - Tab 循环 9 类（action / character / parenthetical / dialogue / transition / shot / scene_heading / general / note）
 *   - recognizeType 智能识别（场次标题 / 转场 / 全大写人物 / 括号提示 / 镜头）
 *   - characterForDialogue 反查人物
 *   - contdLabelFor 仅在「当前对白人物 === 上一页最末人物」时返回带姓名版本，否则回退为「（续）」
 *   - shouldShowContdSuffix 同人物 (CONT'D) 判定（v1.2.9 同款逻辑）
 *   - 进度条主题循环、场景条带、调色板、超目标（第五项）
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

  const {
    recognizeType,
    characterForDialogue,
    contdLabelFor,
    nextTypeOnTab,
    nextTypeOnEnter,
    shouldShowContdSuffix,
    CONTD_SUFFIX,
    computeSceneBands,
    writtenPagesExcludingTitle,
    overPages,
    nextProgressTheme,
    normalizeProgressTheme,
    SCENE_BAND_PALETTE,
    PROGRESS_THEME_ORDER,
    clampTargetPages,
    normalizeTargetPages,
  } = require(bundle);

  const failures = [];
  const ok = (name, cond) => {
    if (cond) console.log(`  \u2713 ${name}`);
    else { console.log(`  \u2717 ${name}`); failures.push(name); }
  };

  console.log('\n== Tab 九类循环（v1.2.9 同款） ==');
  ok('action → Tab → character', nextTypeOnTab('action') === 'character');
  ok('character → Tab → parenthetical', nextTypeOnTab('character') === 'parenthetical');
  ok('parenthetical → Tab → dialogue', nextTypeOnTab('parenthetical') === 'dialogue');
  ok('dialogue → Tab → transition', nextTypeOnTab('dialogue') === 'transition');
  ok('transition → Tab → shot', nextTypeOnTab('transition') === 'shot');
  ok('shot → Tab → scene_heading', nextTypeOnTab('shot') === 'scene_heading');
  ok('scene_heading → Tab → general', nextTypeOnTab('scene_heading') === 'general');
  ok('general → Tab → note', nextTypeOnTab('general') === 'note');
  ok('note → Tab → action（循环）', nextTypeOnTab('note') === 'action');
  ok('note → Shift+Tab → general（反向循环）', nextTypeOnTab('note', true) === 'general');
  ok('act 不在循环里 → Tab → action', nextTypeOnTab('act') === 'action');
  ok('act → Shift+Tab → note', nextTypeOnTab('act', true) === 'note');

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

  console.log('\n== shouldShowContdSuffix (CONT\'D 同人物续说) ==');
  // 共享工程：一个场景里 A → 对白 → 动作 → A → 切换场景 → A
  const baseProject = {
    settings: { contdCharacter: true, contdText: '（续）', sceneNumber: 'left' },
    elements: [
      { id: 'sc1', type: 'scene_heading', text: '1. 内景 测试地点 日' },
      { id: 'ch1', type: 'character', text: '角色甲' },
      { id: 'd1', type: 'dialogue', text: '你好。' },
      { id: 'a1', type: 'action', text: '他走到窗边。' },
      { id: 'ch2', type: 'character', text: '角色甲' },
      { id: 'd2', type: 'dialogue', text: '再看一眼。' },
      { id: 'ch3', type: 'character', text: '角色乙' },
      { id: 'd3', type: 'dialogue', text: '早上好。' },
      { id: 'ch4', type: 'character', text: '角色甲' },
      { id: 'sc2', type: 'scene_heading', text: '2. 外景 测试地点 夜' },
      { id: 'ch5', type: 'character', text: '角色甲' },
      { id: 'ch6', type: 'character', text: '角色甲（V.O）' }, // 与上文角色甲比较，括号去掉后一致
      { id: 'ch7', type: 'character', text: '角色甲（CONT\'D）' }, // 作者已写，不追加
      { id: 'ch8', type: 'character', text: '角色甲' }, // 双重说话，紧跟前一个 A
    ],
  };

  ok('场景 1：A → 对白 → 动作 → A → 续说', shouldShowContdSuffix(baseProject, baseProject.elements[4]) === true);
  ok('场景 2：A → B 紧接，B 不续说', shouldShowContdSuffix(baseProject, baseProject.elements[6]) === false);
  ok('场景 3：场景切换后 A 不续说（遇 scene_heading 截止）', shouldShowContdSuffix(baseProject, baseProject.elements[10]) === false);
  ok('场景 4：括号提示变体（角色甲（V.O））与角色甲视为同人物', shouldShowContdSuffix(baseProject, baseProject.elements[11]) === true);
  ok('场景 5：作者已写 (CONT\'D) → 不再追加', shouldShowContdSuffix(baseProject, baseProject.elements[12]) === false);
  ok('场景 6：连续两次角色甲 → 后者续说', shouldShowContdSuffix(baseProject, baseProject.elements[13]) === true);
  ok('场景 7：第一个角色元素（无前序）→ 不续说', shouldShowContdSuffix(baseProject, baseProject.elements[1]) === false);

  // 不同人物连续说话
  const diffCharProject = {
    settings: { contdCharacter: true },
    elements: [
      { id: 'ch1', type: 'character', text: '角色甲' },
      { id: 'ch2', type: 'character', text: '角色乙' },
      { id: 'ch3', type: 'character', text: '角色甲' },
    ],
  };
  ok('场景 8：甲→乙 紧接 → 乙不续说（不同人物）', shouldShowContdSuffix(diffCharProject, diffCharProject.elements[1]) === false);
  // v1.2.9 行为：一旦中间插入不同人物，续说链即断开。第二个甲不会显示 (CONT'D)。
  ok('场景 9：甲→乙→甲 → 第二个甲不续说（中间被不同人物打断）', shouldShowContdSuffix(diffCharProject, diffCharProject.elements[2]) === false);

  // 设置关闭 → 一律不续说
  const offProject = { ...baseProject, settings: { ...baseProject.settings, contdCharacter: false } };
  ok('场景 10：设置关闭 → 即使符合也不续说', shouldShowContdSuffix(offProject, baseProject.elements[4]) === false);

  // 缺省视为开启
  const defaultProject = { settings: {}, elements: baseProject.elements };
  ok('场景 11：未设置 contdCharacter → 视为开启', shouldShowContdSuffix(defaultProject, baseProject.elements[4]) === true);

  // 双列对白不参与
  const dualProject = {
    settings: { contdCharacter: true },
    elements: [
      { id: 'ch1', type: 'character', text: '角色甲' },
      { id: 'ch2', type: 'character', text: '角色甲', dual: 'left' },
    ],
  };
  ok('场景 12：双列对白中的角色不参与续说', shouldShowContdSuffix(dualProject, dualProject.elements[1]) === false);

  // 非 character 类型直接 false
  const actionEl = { id: 'a', type: 'action', text: '动作' };
  ok('场景 13：action 元素 → 不续说', shouldShowContdSuffix(baseProject, actionEl) === false);

  // 续说后缀常量与 v1.2.9 一致
  ok("CONTD_SUFFIX 固定为 (CONT'D)", CONTD_SUFFIX === "(CONT'D)");

  // 后缀不进正文：元素的 text 字段不应被函数修改
  const before = JSON.stringify(baseProject.elements[4]);
  shouldShowContdSuffix(baseProject, baseProject.elements[4]);
  ok('shouldShowContdSuffix 不会修改元素 text 字段', before === JSON.stringify(baseProject.elements[4]));

  // 不污染：项目整体对象不变
  const projectBefore = JSON.stringify(baseProject);
  shouldShowContdSuffix(baseProject, baseProject.elements[4]);
  ok('shouldShowContdSuffix 不会修改 project 其它字段', projectBefore === JSON.stringify(baseProject));

  console.log('\n== 进度条主题循环（v1.2.9 同款） ==');
  ok('PROGRESS_THEME_ORDER 顺序为 cigarette → car → key', JSON.stringify(PROGRESS_THEME_ORDER) === '["cigarette","car","key"]');
  ok('cigarette → car', nextProgressTheme('cigarette') === 'car');
  ok('car → key', nextProgressTheme('car') === 'key');
  ok('key → cigarette（循环）', nextProgressTheme('key') === 'cigarette');
  ok('undefined → car（视为默认 cigarette 的下一个）', nextProgressTheme(undefined) === 'car');
  ok('未知值 → car（视为默认 cigarette 的下一个）', nextProgressTheme('rocket') === 'car');
  ok('normalizeProgressTheme 已知通过', normalizeProgressTheme('car') === 'car');
  ok('normalizeProgressTheme 未知回退', normalizeProgressTheme('whatever') === 'cigarette');
  ok('normalizeProgressTheme undefined 回退', normalizeProgressTheme(undefined) === 'cigarette');

  console.log('\n== overPages 超目标计算 ==');
  ok('未超目标 → 0', overPages(50, 100) === 0);
  ok('正好等于 → 0', overPages(100, 100) === 0);
  ok('超出 10 页 → 10', overPages(110, 100) === 10);
  ok('target=0 → 0', overPages(50, 0) === 0);
  ok('负数 writtenPages → 0（不出现负值）', overPages(-5, 100) === 0);

  console.log('\n== writtenPagesExcludingTitle 去除标题页 ==');
  const proj1 = {
    titlePage: { show: true },
    settings: { titlePageBreak: true },
  };
  ok('标题页独立 + pageCount=2 → 1（减去标题）', writtenPagesExcludingTitle(2, proj1) === 1);
  ok('标题页独立 + pageCount=0 → 0', writtenPagesExcludingTitle(0, proj1) === 0);
  ok('标题页独立 + pageCount=1 → 1（保底 1）', writtenPagesExcludingTitle(1, proj1) === 1);
  const proj2 = { titlePage: { show: false }, settings: { titlePageBreak: true } };
  ok('标题页未开 → 不减', writtenPagesExcludingTitle(3, proj2) === 3);
  const proj3 = { titlePage: { show: true }, settings: { titlePageBreak: false } };
  ok('标题页开了但未独立成页 → 不减', writtenPagesExcludingTitle(3, proj3) === 3);

  console.log('\n== computeSceneBands 场景条带（v1.2.9 同款） ==');
  const bandProject = {
    settings: {
      autoNumberScenes: true,
      indent: {
        action: { left: 0, right: 0, align: 'left', spaceBefore: 1 },
        character: { left: 0, right: 0, align: 'left', spaceBefore: 1 },
        dialogue: { left: 0, right: 0, align: 'left', spaceBefore: 0 },
        scene_heading: { left: 0, right: 0, align: 'left', spaceBefore: 0 },
        note: { left: 0, right: 0, align: 'left', spaceBefore: 0 },
        act: { left: 0, right: 0, align: 'left', spaceBefore: 0 },
        parenthetical: { left: 0, right: 0, align: 'left', spaceBefore: 0 },
        transition: { left: 0, right: 0, align: 'left', spaceBefore: 0 },
        shot: { left: 0, right: 0, align: 'left', spaceBefore: 0 },
        general: { left: 0, right: 0, align: 'left', spaceBefore: 0 },
      },
    },
    sceneMeta: [],
    elements: [
      { id: 'sc1', type: 'scene_heading', text: '1. 内景 测试地点 日' },
      { id: 'a1', type: 'action', text: '人物走过镜头。' },
      { id: 'c1', type: 'character', text: '角色甲' },
      { id: 'd1', type: 'dialogue', text: '你好。' },
      { id: 'n1', type: 'note', text: '备注不计入' },
      { id: 'om1', type: 'action', text: '省略场景', omit: true },
      { id: 'sc2', type: 'scene_heading', text: '2. 外景 测试地点 夜' },
      { id: 'a2', type: 'action', text: '夜风吹过。' },
      { id: 'c2', type: 'character', text: '角色乙' },
      { id: 'd2', type: 'dialogue', text: '晚上好。' },
    ],
  };

  const bands = computeSceneBands(bandProject);
  ok('得到 2 个场景带', bands.length === 2);
  ok('场景 1 编号 = "1"', bands[0] && bands[0].number === '1');
  ok('场景 2 编号 = "2"', bands[1] && bands[1].number === '2');
  ok('场景 1 颜色 = palette[0]', bands[0] && bands[0].color === SCENE_BAND_PALETTE[0]);
  ok('场景 2 颜色 = palette[1]', bands[1] && bands[1].color === SCENE_BAND_PALETTE[1]);
  ok('场景 1 weight > 0（不含 note/omit/act）', bands[0] && bands[0].weight > 0);
  ok('场景 1 weight = scene_heading 1 + action 2 + character 2 + dialogue 1 = 6（含 scene_heading，note/omit 跳过）',
    bands[0] && bands[0].weight === 6);
  ok('场景 2 weight = scene_heading 1 + action 2 + character 2 + dialogue 1 = 6',
    bands[1] && bands[1].weight === 6);
  ok('pct 之和 ≈ 100', Math.round(bands.reduce((s, b) => s + b.pct, 0)) === 100);
  ok('pct 是 number', typeof (bands[0] && bands[0].pct) === 'number');

  // palette 循环：第 11 个场景应回到 palette[0]
  const manySceneProj = {
    settings: { ...bandProject.settings },
    sceneMeta: [],
    elements: [],
  };
  for (let i = 0; i < 11; i += 1) {
    manySceneProj.elements.push({ id: `sc${i}`, type: 'scene_heading', text: `${i + 1}. 测试场景 ${i + 1}` });
    manySceneProj.elements.push({ id: `a${i}`, type: 'action', text: '短动作。' });
  }
  const manyBands = computeSceneBands(manySceneProj);
  ok('调色板循环：第 1 场 = palette[0]', manyBands[0].color === SCENE_BAND_PALETTE[0]);
  ok('调色板循环：第 10 场 = palette[9]', manyBands[9].color === SCENE_BAND_PALETTE[9]);
  ok('调色板循环：第 11 场 = palette[0]', manyBands[10].color === SCENE_BAND_PALETTE[0]);

  // 空场景
  ok('空项目 → 空数组', computeSceneBands({ settings: { indent: bandProject.settings.indent }, sceneMeta: [], elements: [] }).length === 0);
  // 没场景时 pct 为 0（不会 NaN）
  const zeroProj = {
    settings: { indent: bandProject.settings.indent, autoNumberScenes: true },
    sceneMeta: [],
    elements: [{ id: 'sc1', type: 'scene_heading', text: '1. 测试' }, { id: 'a1', type: 'action', text: '' }],
  };
  const zeroBands = computeSceneBands(zeroProj);
  ok('单场景 pct = 100', zeroBands.length === 1 && Math.round(zeroBands[0].pct) === 100);

  // 不会修改 project
  const projectBefore2 = JSON.stringify(bandProject);
  computeSceneBands(bandProject);
  ok('computeSceneBands 不会修改 project', JSON.stringify(bandProject) === projectBefore2);

  console.log('\n== 三套主题（与 v1.2.9 一致） ==');
  ok('默认主题 = cigarette', normalizeProgressTheme('cigarette') === 'cigarette');
  ok('car 主题有效', normalizeProgressTheme('car') === 'car');
  ok('key 主题有效', normalizeProgressTheme('key') === 'key');

  console.log('\n== clampTargetPages：0 / 负数 / NaN / 超大数 边界兜底 ==');
  ok('undefined → 0', clampTargetPages(undefined) === 0);
  ok('null → 0', clampTargetPages(null) === 0);
  ok('NaN → 0', clampTargetPages(NaN) === 0);
  ok('Infinity → 0', clampTargetPages(Infinity) === 0);
  ok('-Infinity → 0', clampTargetPages(-Infinity) === 0);
  ok('字符串 "abc" → 0', clampTargetPages('abc') === 0);
  ok('字符串 "100" → 0（typeof 检查，非 number 都视为 0）', clampTargetPages('100') === 0);
  ok('对象 {} → 0', clampTargetPages({}) === 0);
  ok('-5 → 0', clampTargetPages(-5) === 0);
  ok('-0.1 → 0', clampTargetPages(-0.1) === 0);
  ok('0 → 0（关闭目标）', clampTargetPages(0) === 0);
  ok('0.4 → 0（<=0 视为关闭）', clampTargetPages(0.4) === 0);
  ok('0.5 → 1（四舍五入到 1）', clampTargetPages(0.5) === 1);
  ok('100 → 100', clampTargetPages(100) === 100);
  ok('99.6 → 100（round）', clampTargetPages(99.6) === 100);
  ok('9999 → 9999', clampTargetPages(9999) === 9999);
  ok('10000 → 9999（封顶）', clampTargetPages(10000) === 9999);
  ok('12000 → 9999', clampTargetPages(12000) === 9999);
  ok('1e20 → 9999（Infinity 之前）', clampTargetPages(1e20) === 9999);
  ok('1.5 → 2（round）', clampTargetPages(1.5) === 2);

  console.log('\n== normalizeTargetPages：加载时保留 undefined ==');
  ok('undefined → undefined（视为未设）', normalizeTargetPages(undefined) === undefined);
  ok('null → undefined', normalizeTargetPages(null) === undefined);
  ok('NaN → undefined', normalizeTargetPages(NaN) === undefined);
  ok('字符串 → undefined', normalizeTargetPages('100') === undefined);
  ok('0 → undefined（历史工程语义模糊）', normalizeTargetPages(0) === undefined);
  ok('-5 → undefined', normalizeTargetPages(-5) === undefined);
  ok('100 → 100（合法保留）', normalizeTargetPages(100) === 100);
  ok('99.4 → 99', normalizeTargetPages(99.4) === 99);
  ok('10000 → 9999（封顶）', normalizeTargetPages(10000) === 9999);

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
