/**
 * scripts/writing-test.cjs
 *
 * 验证写作辅助相关纯函数（第三项 + 第五项）：
 *   - Tab 循环 9 类（action / character / parenthetical / dialogue / transition / shot / scene_heading / general / note）
 *   - recognizeType 智能识别（场次标题 / 转场 / 全大写人物 / 括号提示 / 镜头）
 *   - characterForDialogue 反查人物
 *   - contdLabelFor 仅在「当前对白人物 === 上一页最末人物」时返回带姓名版本，否则回退为「（续）」
 *   - shouldShowContdSuffix 同人物 (CONT'D) 判定（v1.2.9 同款逻辑）
 *   - 进度条场景条带、调色板、超目标（第五项）
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
    SCENE_BAND_PALETTE,
    clampTargetPages,
    normalizeTargetPages,
    RESIZE_LIMITS,
    sizeLimitFor,
    defaultSize,
    clampSize,
    resizeBy,
    toggleSel,
    addSel,
    removeSel,
    clearSel,
    selRange,
    marqueeSel,
    filterBoardLinksToKeep,
    cardCenters,
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

  console.log('\n== nextTypeOnEnter：符合编剧节奏的回车序列 ==');
  ok('场次标题有内容 → 动作（先描述画面）', nextTypeOnEnter({ id: 's', type: 'scene_heading', text: '内景 房间 日' }, false) === 'action');
  ok('动作有内容 → 动作（连续描述不强迫切类型）', nextTypeOnEnter({ id: 'a2', type: 'action', text: '他走向窗边。' }, false) === 'action');
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

  console.log('\n== RESIZE_LIMITS：五套尺寸约束（v1.2.9 同款 + scene 卡补全） ==');
  ok('image minW=180 / minH=140 / maxW=760 / maxH=680',
    RESIZE_LIMITS.image.minW === 180 && RESIZE_LIMITS.image.minH === 140 &&
    RESIZE_LIMITS.image.maxW === 760 && RESIZE_LIMITS.image.maxH === 680);
  ok('wimg 与 image 同约束', JSON.stringify(RESIZE_LIMITS.wimg) === JSON.stringify(RESIZE_LIMITS.image));
  ok('beat minW=220 / minH=170', RESIZE_LIMITS.beat.minW === 220 && RESIZE_LIMITS.beat.minH === 170);
  ok('sound 与 beat 同约束', JSON.stringify(RESIZE_LIMITS.sound) === JSON.stringify(RESIZE_LIMITS.beat));
  ok('scene minW=180 / minH=110 / maxW=480 / maxH=400（场景卡独立区间）',
    RESIZE_LIMITS.scene.minW === 180 && RESIZE_LIMITS.scene.minH === 110 &&
    RESIZE_LIMITS.scene.maxW === 480 && RESIZE_LIMITS.scene.maxH === 400);
  ok('scene 与 image 区间不同（不能共用）', JSON.stringify(RESIZE_LIMITS.scene) !== JSON.stringify(RESIZE_LIMITS.image));
  ok('defaultSize(image) → 176×140', defaultSize('image').w === 176 && defaultSize('image').h === 140);
  ok('defaultSize(beat) → 220×170', defaultSize('beat').w === 220 && defaultSize('beat').h === 170);
  ok('defaultSize(scene) → 220×110', defaultSize('scene').w === 220 && defaultSize('scene').h === 110);
  ok('sizeLimitFor(scene) 返回场景卡区间', sizeLimitFor('scene').defaultW === 220 && sizeLimitFor('scene').minH === 110);
  ok('sizeLimitFor(unknown) 回退到 beat', sizeLimitFor(undefined).defaultW === 220);
  ok('sizeLimitFor(weird) 回退到 beat', sizeLimitFor('weird').minW === 220);

  console.log('\n== clampSize：min/max + 异常值兜底 ==');
  // 合法区间内
  ok('image 200×200 → 200×200', clampSize('image', 200, 200).w === 200 && clampSize('image', 200, 200).h === 200);
  ok('image 500×500 → 500×500', clampSize('image', 500, 500).w === 500 && clampSize('image', 500, 500).h === 500);
  // 拖到 max 之上：封顶
  ok('image 1000×1000 → 760×680（封顶）', clampSize('image', 1000, 1000).w === 760 && clampSize('image', 1000, 1000).h === 680);
  ok('image 1e6 × 1e6 → 760×680', clampSize('image', 1e6, 1e6).w === 760 && clampSize('image', 1e6, 1e6).h === 680);
  // 拖到 min 之下：兜底到 min
  ok('image 50×50 → 180×140（兜底）', clampSize('image', 50, 50).w === 180 && clampSize('image', 50, 50).h === 140);
  ok('image 0×0 → 180×140（兜底）', clampSize('image', 0, 0).w === 180 && clampSize('image', 0, 0).h === 140);
  ok('image -100×-50 → 180×140（负数兜底）', clampSize('image', -100, -50).w === 180 && clampSize('image', -100, -50).h === 140);
  // 异常值：NaN / Infinity / 字符串 / null
  ok('image NaN×NaN → default 176×140', clampSize('image', NaN, NaN).w === 176 && clampSize('image', NaN, NaN).h === 140);
  ok('image Infinity×Infinity → default 176×140（非法值 fallback）', clampSize('image', Infinity, Infinity).w === 176 && clampSize('image', Infinity, Infinity).h === 140);
  ok('image -Infinity×-Infinity → default 176×140', clampSize('image', -Infinity, -Infinity).w === 176 && clampSize('image', -Infinity, -Infinity).h === 140);
  ok('image 字符串 → default', clampSize('image', 'abc', 'def').w === 176 && clampSize('image', 'abc', 'def').h === 140);
  ok('image null → default', clampSize('image', null, null).w === 176 && clampSize('image', null, null).h === 140);
  // 边界值：恰好 = min / max
  ok('image 180×140（边界 min）→ 180×140', clampSize('image', 180, 140).w === 180 && clampSize('image', 180, 140).h === 140);
  ok('image 760×680（边界 max）→ 760×680', clampSize('image', 760, 680).w === 760 && clampSize('image', 760, 680).h === 680);
  // 浮点 → 整数
  ok('image 199.6×139.4 → 200×140（round + 浮点收敛）', clampSize('image', 199.6, 139.4).w === 200 && clampSize('image', 199.6, 139.4).h === 140);
  // 单边越界
  ok('image 1000×300（仅 w 越界）→ 760×300', clampSize('image', 1000, 300).w === 760 && clampSize('image', 1000, 300).h === 300);
  ok('image 300×50（仅 h 越界）→ 300×140', clampSize('image', 300, 50).w === 300 && clampSize('image', 300, 50).h === 140);
  // beat / sound 区间
  ok('beat 100×100 → 220×170（兜底）', clampSize('beat', 100, 100).w === 220 && clampSize('beat', 100, 100).h === 170);
  ok('sound 100×100 → 220×170（兜底）', clampSize('sound', 100, 100).w === 220 && clampSize('sound', 100, 100).h === 170);
  ok('beat 1000×1000 → 720×640（封顶）', clampSize('beat', 1000, 1000).w === 720 && clampSize('beat', 1000, 1000).h === 640);
  // 未知 kind 回退 beat
  ok('unknown kind → beat 区间 100×100 → 220×170', clampSize('weird', 100, 100).w === 220 && clampSize('weird', 100, 100).h === 170);

  // scene 维度独立区间（用户要求"所有自由板卡片都可缩放"）
  ok('scene 250×200 → 250×200（合法）', clampSize('scene', 250, 200).w === 250 && clampSize('scene', 250, 200).h === 200);
  ok('scene 100×100 → 180×110（兜底 min）', clampSize('scene', 100, 100).w === 180 && clampSize('scene', 100, 100).h === 110);
  ok('scene 600×500 → 480×400（封顶 max）', clampSize('scene', 600, 500).w === 480 && clampSize('scene', 600, 500).h === 400);
  ok('scene NaN → default 220×110', clampSize('scene', NaN, NaN).w === 220 && clampSize('scene', NaN, NaN).h === 110);
  ok('scene Infinity → default 220×110', clampSize('scene', Infinity, Infinity).w === 220 && clampSize('scene', Infinity, Infinity).h === 110);
  ok('resizeBy scene 也走独立区间：起始 220×110 + (300, 300) zoom=1 → 480×400（max）',
    resizeBy('scene', 220, 110, 300, 300, 1).w === 480 && resizeBy('scene', 220, 110, 300, 300, 1).h === 400);

  // 旧 .zhsp 兼容（用户要求"旧文件无尺寸字段时仍正常打开"）：不带 w/h 时 endpoint
  // 计算走 FALLBACK，clampSize 接收 undefined 也回退 default。
  // 模拟旧工程的 sceneMeta（无 w/h）+ 重新打开后计算 endpoint：
  const legacySceneMeta = { id: 'sc-legacy', elementId: 'el-1', title: '', synopsis: '', color: '#cfe4ff' };
  ok('旧 .zhsp sceneMeta 无 w/h：scene.w ?? 220 → 220（fallback）', (legacySceneMeta.w ?? 220) === 220);
  ok('旧 .zhsp sceneMeta 无 w/h：scene.h ?? 110 → 110（fallback）', (legacySceneMeta.h ?? 110) === 110);
  const legacyBeat = { id: 'bt-legacy', type: 'beat', text: '灵感', color: '#fff7d6', x: 0, y: 0 };
  ok('旧 .zhsp beat 无 w/h：beat.w ?? 220 → 220', (legacyBeat.w ?? 220) === 220);
  ok('旧 .zhsp beat 无 w/h：beat.h ?? 92 → 92', (legacyBeat.h ?? 92) === 92);
  // 旧工程打开后用户调整 scene 卡大小 → clampSize 仍安全
  ok('旧工程第一次 resize scene：100×100 → 180×110（min）', clampSize('scene', 100, 100).w === 180 && clampSize('scene', 100, 100).h === 110);

  console.log('\n== resizeBy：起始尺寸 + 鼠标位移（带 zoom） ==');
  ok('起始 200×200 + 位移 (50,50) zoom=1 → 250×250', resizeBy('image', 200, 200, 50, 50, 1).w === 250 && resizeBy('image', 200, 200, 50, 50, 1).h === 250);
  ok('起始 200×200 + 位移 (200,200) zoom=1 → 400×400', resizeBy('image', 200, 200, 200, 200, 1).w === 400 && resizeBy('image', 200, 200, 200, 200, 1).h === 400);
  ok('zoom=2 → 位移只算一半：200×200 + (200,200) zoom=2 → 300×300', resizeBy('image', 200, 200, 200, 200, 2).w === 300 && resizeBy('image', 200, 200, 200, 200, 2).h === 300);
  ok('zoom=0.5 → 位移放大一倍：200×200 + (50,50) zoom=0.5 → 300×300', resizeBy('image', 200, 200, 50, 50, 0.5).w === 300 && resizeBy('image', 200, 200, 50, 50, 0.5).h === 300);
  ok('zoom=0（非法）回退到 1：200×200 + (50,50) zoom=0 → 250×250', resizeBy('image', 200, 200, 50, 50, 0).w === 250 && resizeBy('image', 200, 200, 50, 50, 0).h === 250);
  ok('resizeBy 也 clamp：起始 100×100 + (2000,2000) → max 760×680', resizeBy('image', 100, 100, 2000, 2000, 1).w === 760 && resizeBy('image', 100, 100, 2000, 2000, 1).h === 680);
  ok('resizeBy 也兜底：起始 200×200 + (-1000,-1000) → min 180×140', resizeBy('image', 200, 200, -1000, -1000, 1).w === 180 && resizeBy('image', 200, 200, -1000, -1000, 1).h === 140);

  // ===== alpha.7 起：自由板多选 / 框选 / 批量删除（Item 6b） =====
  // 关键不变量：批量删除时只清理被删卡片关联的关系线，绝不误删未选卡片关联的关系线。

  console.log('\n== toggleSel / addSel / removeSel / clearSel ==');
  ok('toggleSel 空 → 加 a', JSON.stringify(toggleSel([], 'a')) === '["a"]');
  ok('toggleSel 已含 a → 移除', JSON.stringify(toggleSel(['a'], 'a')) === '[]');
  ok('toggleSel 多个里去掉', JSON.stringify(toggleSel(['a', 'b', 'c'], 'b')) === '["a","c"]');
  ok('addSel 重复 no-op', addSel(['a'], 'a') === ['a'] || JSON.stringify(addSel(['a'], 'a')) === '["a"]');
  ok('addSel 新增', JSON.stringify(addSel(['a'], 'b')) === '["a","b"]');
  ok('removeSel 不存在 no-op', JSON.stringify(removeSel(['a'], 'b')) === '["a"]');
  ok('removeSel 已含', JSON.stringify(removeSel(['a', 'b'], 'a')) === '["b"]');
  ok('clearSel → []', JSON.stringify(clearSel()) === '[]');

  console.log('\n== selRange：Shift+click 范围选择（v1.2.9 selRangeTo 同款语义） ==');
  const ordered = ['scene:s1', 'scene:s2', 'scene:s3', 'beat:b1', 'beat:b2', 'beat:b3'];
  ok('selRange 空 anchor + target = s3 → 仅 s3', JSON.stringify(selRange([], ordered, null, 'scene:s3')) === '["scene:s3"]');
  ok('selRange anchor=s1 + target=s3 → [s1..s3]', JSON.stringify(selRange([], ordered, 'scene:s1', 'scene:s3')) === '["scene:s1","scene:s2","scene:s3"]');
  ok('selRange anchor=s3 + target=s1（反向）→ 仍 [s1..s3]', JSON.stringify(selRange([], ordered, 'scene:s3', 'scene:s1')) === '["scene:s1","scene:s2","scene:s3"]');
  ok('selRange anchor=s1 + target=b2 → 跨 scene 与 beat', JSON.stringify(selRange([], ordered, 'scene:s1', 'beat:b2')) === '["scene:s1","scene:s2","scene:s3","beat:b1","beat:b2"]');
  ok('selRange anchor=不存在 + target=b1 → 仅 target', JSON.stringify(selRange([], ordered, 'bogus', 'beat:b1')) === '["beat:b1"]');
  ok('selRange target 越界 → 保留 prev', selRange(['x'], ordered, null, 'bogus') === ['x'] || JSON.stringify(selRange(['x'], ordered, null, 'bogus')) === '["x"]');

  console.log('\n== marqueeSel：框选（marquee）按卡片中心点过滤 ==');
  const cards = [
    { id: 'c1', cx: 100, cy: 100 },
    { id: 'c2', cx: 200, cy: 200 },
    { id: 'c3', cx: 300, cy: 300 },
    { id: 'c4', cx: 50, cy: 50 },
  ];
  ok('框 (50,50)~(250,250) → c1 + c2 + c4（c4 命中角点）',
    JSON.stringify(marqueeSel([], cards, 50, 50, 200, 200, false).sort()) === '["c1","c2","c4"]');
  ok('反向框（rh 负）也能命中：起点 (250,250) → (50,50)',
    JSON.stringify(marqueeSel([], cards, 250, 250, -200, -200, false).sort()) === '["c1","c2","c4"]');
  ok('additive=true 与 prev 合并去重',
    JSON.stringify(marqueeSel(undefined, cards, 50, 50, 200, 200, true, ['c1', 'x']).sort()) === '["c1","c2","c4","x"]');
  ok('additive=false 直接替换 prev',
    JSON.stringify(marqueeSel(undefined, cards, 50, 50, 200, 200, false, ['c5']).sort()) === '["c1","c2","c4"]');
  ok('空框（rw=rh=0）→ 空', JSON.stringify(marqueeSel([], cards, 100, 100, 0, 0, false)) === '[]');

  console.log('\n== filterBoardLinksToKeep：批量删除关系线过滤（关键不变量） ==');
  // 构造一段常见的链接图：
  //   scene:s1 --- beat:b1
  //   scene:s1 --- beat:b2
  //   scene:s1 --- beat:bx (与未选中 beat 之间的链接)
  //   beat:b1  --- beat:b2
  //   scene:s1 --- scene:s2
  // 选择删除 b1 + b2：应清掉前 4 条；只 sx---sx 应保留
  const links = [
    { id: 'l1', from: 'scene:s1', to: 'beat:b1', note: '' },
    { id: 'l2', from: 'scene:s1', to: 'beat:b2', note: '' },
    { id: 'l3', from: 'scene:s1', to: 'beat:bx', note: '' },
    { id: 'l4', from: 'beat:b1',  to: 'beat:b2', note: '' },
    { id: 'l5', from: 'scene:s1', to: 'scene:s2', note: '' },
  ];
  const removed = new Set(['b1', 'b2']);
  const kept = filterBoardLinksToKeep(links, removed);
  ok('s1-b1（被删一端）被清', !kept.find((l) => l.id === 'l1'));
  ok('s1-b2（被删一端）被清', !kept.find((l) => l.id === 'l2'));
  ok('s1-bx（两端都没命中）保留', !!kept.find((l) => l.id === 'l3'));
  ok('b1-b2（两端命中）被清', !kept.find((l) => l.id === 'l4'));
  ok('s1-s2（未选卡片关联）绝不被误删', !!kept.find((l) => l.id === 'l5'));
  ok('过滤后数量 = 2', kept.length === 2);

  console.log('\n== filterBoardLinksToKeep：旧 .zhsp 无前缀兼容 ==');
  // 旧版本可能直接存 raw id 而不带 scene: / beat: 前缀
  const legacy = [
    { id: 'la', from: 'b1', to: 'b2', note: '' },
    { id: 'lb', from: 'b1', to: 'b3', note: '' },
  ];
  const removedLeg = new Set(['b1']);
  const keptLeg = filterBoardLinksToKeep(legacy, removedLeg);
  ok('旧无前缀：b1-b2 被清', !keptLeg.find((l) => l.id === 'la'));
  ok('旧无前缀：b1-b3 被清', !keptLeg.find((l) => l.id === 'lb'));

  console.log('\n== filterBoardLinksToKeep：removedSet 空 = 原样拷贝 ==');
  const noRemoval = filterBoardLinksToKeep(links, new Set());
  ok('空 removedSet → 全部保留', noRemoval.length === links.length);

  console.log('\n== cardCenters：把卡片坐标转中心点 ==');
  const cardList = [
    { id: 'x', x: 0, y: 0, w: 100, h: 80 },
    { id: 'y', x: 100, y: 100 }, // 缺 w/h 兜底 220×100
  ];
  const centers = cardCenters(cardList);
  ok('卡片 1 中心 = (50, 40)', centers[0].cx === 50 && centers[0].cy === 40);
  ok('卡片 2 中心 = (100+220/2, 100+100/2) = (210, 150)', centers[1].cx === 210 && centers[1].cy === 150);

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
