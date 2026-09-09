/** 只使用合成行高与正文，验证分页不丢行、提示预算、场次不孤悬。无需 Electron。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

(async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await esbuild.build({
    stdin: {
      contents: 'export { paginateMeasured } from "./src/hooks/PaginationProvider"; export { createProject } from "./src/model/project";',
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
  });
  const runtime = new Module(path.join(root, 'pagination-safety-runtime.cjs'));
  runtime.filename = path.join(root, 'pagination-safety-runtime.cjs');
  runtime.paths = module.paths;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  runtime._compile(bundle.outputFiles[0].text, runtime.filename);
  const { paginateMeasured, createProject } = runtime.exports;
  let scenarios = 0;
  const run = (typesAndLines, { capacity = 10, margin = 1, showContd = true, moreText = '（更多）' } = {}) => {
    const project = createProject();
    project.titlePage.show = false;
    project.settings.showContd = showContd;
    project.settings.moreText = moreText;
    Object.values(project.settings.indent).forEach((format) => { format.spaceBefore = margin; });
    project.revisions = [{ id: 'revision-test', color: '#ffeecc' }];
    project.elements = typesAndLines.map(([type], i) => ({ id: `element-${i}`, type, text: type === 'character' ? '测试角色' : `合成段落 ${i}`, rev: 'revision-test' }));
    const heights = new Map(typesAndLines.map(([, lines], i) => [`s:element-${i}`, lines * 20]));
    const before = JSON.stringify(project);
    const result = paginateMeasured(project, heights, { lineHeightPx: 20, contentHeightPx: capacity * 20, contentWidthPx: 600 });
    assert.equal(JSON.stringify(project), before, '分页不可写回正文或卡片');
    typesAndLines.forEach(([, count], i) => {
      const chunks = result.pages.flatMap((page) => page.items).filter((chunk) => chunk.elements[0].id === `element-${i}`);
      let consumed = 0;
      for (const chunk of chunks) {
        assert.equal(chunk.skipLines, consumed, '跨页行号必须连续且不重复');
        assert.ok(chunk.lines > 0, '每次分页至少前进一行');
        consumed += chunk.lines;
      }
      assert.equal(consumed, count, '全部正文行必须保留');
      const firstPage = result.pages.findIndex((page) => page.items.some((chunk) => chunk.elements[0].id === `element-${i}`));
      assert.equal(result.pageOf[`element-${i}`], firstPage, '强制分页同样记录跳页映射');
      assert.ok(result.breaks.includes(i), '强制分页同样记录段落索引');
    });
    for (const page of result.pages) {
      const used = page.items.reduce((total, chunk) => total + (chunk.skipLines ? 0 : chunk.spaceBefore) + chunk.lines + (chunk.contd ? 1 : 0) + (chunk.more ? 1 : 0), 0);
      assert.ok(used <= Math.max(1, capacity) + 1e-6, `页高预算溢出: ${used} > ${capacity}`);
      assert.equal(page.revColor, 'revision-test', '所有修订正文分页均保留修订标记');
    }
    scenarios += 1;
    return result;
  };

  const longDialogue = run([['character', 1], ['dialogue', 700]]);
  assert.ok(longDialogue.pages.length > 40, '超长段落不得被 40 次循环上限截断');
  const dialogueChunks = longDialogue.pages.flatMap((page) => page.items).filter((chunk) => chunk.elements[0].type === 'dialogue');
  assert.ok(dialogueChunks.slice(0, -1).every((chunk) => chunk.more), '所有中间对白页都有 MORE');
  assert.ok(dialogueChunks.slice(1).every((chunk) => chunk.contd === '测试角色（续）'), '所有续页包括中间页都有正确 CONT’D');
  assert.equal(dialogueChunks.at(-1).more, false, '最后一页不再出现 MORE');
  run([['action', 2700]]);
  run([['scene_heading', 80], ['action', 3]]);
  const noLabels = run([['character', 1], ['dialogue', 50]], { showContd: false, moreText: '' });
  assert.ok(noLabels.pages.flatMap((page) => page.items).every((chunk) => !chunk.more && !chunk.contd));
  const kept = run([['action', 5], ['scene_heading', 1], ['action', 4]]);
  assert.equal(kept.pageOf['element-1'], kept.pageOf['element-2'], '场次标题预算包括下段留白及至少两行正文');
  assert.equal(kept.pageOf['element-1'], 1, '放不下跟随内容时整个场次标题移到新页');
  const keptCharacter = run([['action', 3], ['scene_heading', 1], ['character', 1], ['dialogue', 4]]);
  assert.equal(keptCharacter.pageOf['element-1'], keptCharacter.pageOf['element-3'], '人物跟随约束不能再次拆散场次标题');
  const keptWithMore = run([['action', 2], ['scene_heading', 1], ['character', 1], ['dialogue', 4]]);
  assert.equal(keptWithMore.pageOf['element-1'], keptWithMore.pageOf['element-3'], '场次跟随预算也计入对白 MORE 提示');

  for (const capacity of [1, 2, 3, 4, 7, 10, 45]) {
    for (const margin of [0, 0.5, 1, 3, 20]) {
      for (const type of ['action', 'dialogue']) {
        run([[type, 131]], { capacity, margin });
      }
    }
  }
  console.log(`pagination safety: ${scenarios} scenarios passed (line continuity, bounds, metadata, continuation, keep-with-next)`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
