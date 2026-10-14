/**
 * Final Draft (.fdx) export/import against the structure of Final Draft's own files:
 * the body in <Content>, the title page as a top-level <TitlePage>, fonts/indents in
 * <ElementSettings>, dual dialogue as <Paragraph Type="General"><DualDialogue>.
 * Synthetic data only. When Final Draft is installed, its bundled sample script is
 * imported read-only as an extra check. Opening the file in Final Draft itself is manual QA.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const w = new JSDOM('').window;
globalThis.DOMParser = w.DOMParser;
let checks = 0;
const txt = (node) => Array.from(node.children).filter((n) => n.tagName === 'Text').map((n) => n.textContent).join('');
const check = (name, actual, expected = true) => { assert.deepEqual(actual, expected, name); checks++; console.log(`  ✓ ${name}`); };

// Element types Final Draft 13's screenplay templates define (ElementSettings Type=…).
const FD_TYPES = new Set(['General', 'Scene Heading', 'Action', 'Character', 'Parenthetical', 'Dialogue', 'Transition', 'Shot', 'Cast List', 'New Act', 'Sequence', 'End of Act', 'Summary', 'Outline 1', 'Outline 2', 'Outline 3', 'Note']);

(async () => {
  const repo = path.resolve(__dirname, '..');
  const built = await esbuild.build({ stdin: { contents: `
    export { toFdx, fromFdx, fdxColor, fdxRuns } from './src/io/fdx';
    export { createProject } from './src/model/project';
  `, resolveDir: repo, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const filename = path.join(__dirname, 'fdx.bundle.cjs');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(__dirname); mod._compile(built.outputFiles[0].text, filename);
  const { toFdx, fromFdx, fdxColor, fdxRuns, createProject } = mod.exports;

  check('颜色转成 Final Draft 的 16 位格式', [fdxColor('#cfe4ff'), fdxColor('#abc'), fdxColor('red')], ['#CFCFE4E4FFFF', '#AAAABBBBCCCC', '']);
  check('粗斜体合并为一个 Style，换行拆段', fdxRuns('<b>甲<i>乙</i></b>丙<br>丁'), [['<Text Style="Bold">甲</Text>', '<Text Style="Bold+Italic">乙</Text>', '<Text>丙</Text>'], ['<Text>丁</Text>']]);

  const p = createProject('合成导出');
  Object.assign(p.titlePage, { show: true, title: '合成片名', subtitle: '第一稿', author: '编剧\n合成作者', basedOn: '', date: '2026-10-15', contact: 'test@example.invalid' });
  p.elements = [
    { id: 'a0', type: 'act', text: '第一幕' },
    { id: 's1', type: 'scene_heading', text: '内景 合成车站 日' },
    { id: 'x1', type: 'action', text: '雨 & 风 <b>很大</b> "引号" \u0007' },
    { id: 'c1', type: 'character', text: '林舟' },
    { id: 'p1', type: 'parenthetical', text: '（低声）' },
    { id: 'd1', type: 'dialogue', text: '你来了。<br>坐吧。' },
    { id: 'n1', type: 'note', text: '内部备忘不该导出' },
    { id: 'o1', type: 'action', text: '被省略的动作', omit: true },
    { id: 'L1', type: 'character', text: '甲', dual: 'left', dualGroup: 'g1' },
    { id: 'L2', type: 'dialogue', text: '左边', dual: 'left', dualGroup: 'g1' },
    { id: 'R1', type: 'character', text: '乙', dual: 'right', dualGroup: 'g1' },
    { id: 'R2', type: 'dialogue', text: '右边', dual: 'right', dualGroup: 'g1' },
    { id: 's2', type: 'scene_heading', text: '外景 合成码头 夜' },
    { id: 'x2', type: 'action', text: '整场被省略' },
    { id: 's3', type: 'scene_heading', text: '内景 合成船舱 夜' },
    { id: 't3', type: 'transition', text: '切至：' },
  ];
  p.sceneMeta = [
    { id: 'm1', elementId: 's1', title: '候船', synopsis: '林舟<b>等人</b>', color: '#cfe4ff' },
    { id: 'm2', elementId: 's2', title: '', synopsis: '', color: '#ffd9e0', omit: true },
  ];
  const xml = toFdx(p);
  const doc = new w.DOMParser().parseFromString(xml, 'application/xml');
  check('导出的是合法 XML', doc.getElementsByTagName('parsererror').length, 0);
  const root = doc.documentElement;
  const top = Array.from(root.children).map((n) => n.tagName);
  check('根节点与 Final Draft 一致', [root.tagName, root.getAttribute('DocumentType'), root.getAttribute('Template')], ['FinalDraft', 'Script', 'No']);
  check('标题页与正文并列，不在 Content 里', [top[0], top.includes('TitlePage'), !!root.querySelector('Content > TitlePage')], ['Content', true, false]);
  const content = root.querySelector(':scope > Content');
  const paras = Array.from(content.children);
  check('正文段落类型全是 Final Draft 认识的类型', paras.every((n) => n.tagName === 'Paragraph' && FD_TYPES.has(n.getAttribute('Type'))), true);
  const settings = Array.from(root.querySelectorAll(':scope > ElementSettings'));
  check('每种用到的类型都有版式设置，字体用 Final Draft 自带的中文字体',
    [...new Set(paras.map((n) => n.getAttribute('Type')))].every((type) => settings.some((s) => s.getAttribute('Type') === type && s.querySelector('FontSpec').getAttribute('Font') === 'Sans Mono CJK Final Draft')), true);
  // 本机 Final Draft 11 实测：AutomaticCharacterContinueds="Yes" 会让它打开后随机崩溃，必须写 No。
  check("(MORE)/(CONT'D) 和场号设置都带字体，页眉页脚齐全",
    [!!root.querySelector(':scope > MoresAndContinueds > FontSpec[Font="Sans Mono CJK Final Draft"]'), !!root.querySelector(':scope > MoresAndContinueds > DialogueBreaks'), !!root.querySelector(':scope > MoresAndContinueds > SceneBreaks'),
      !!root.querySelector(':scope > HeaderAndFooter > Header DynamicLabel[Type="Page #"]'), root.querySelector(':scope > HeaderAndFooter').getAttribute('HeaderVisible'),
      !!root.querySelector(':scope > SceneNumberOptions > FontSpec[Font="Sans Mono CJK Final Draft"]'),
      root.querySelector(':scope > MoresAndContinueds > DialogueBreaks').getAttribute('AutomaticCharacterContinueds')],
    [true, true, true, true, 'Yes', true, 'No']);
  check('A4 纸张', [root.querySelector('PageLayout > PageSize').getAttribute('Width'), root.querySelector('PageLayout > PageSize').getAttribute('Height')], ['8.27', '11.69']);
  const dialogueSpec = settings.find((s) => s.getAttribute('Type') === 'Dialogue').querySelector('ParagraphSpec');
  check('对白缩进按「元素缩进」换算（左 6 字、右 8 字）', [dialogueSpec.getAttribute('LeftIndent'), dialogueSpec.getAttribute('RightIndent')], ['2.38', '5.95']);
  const heading = paras.find((n) => n.getAttribute('Type') === 'Scene Heading');
  check('场次标题带场号和场景卡信息', [heading.getAttribute('Number'), heading.querySelector('SceneProperties').getAttribute('Title'), heading.querySelector('SceneProperties').getAttribute('Color'), heading.querySelector('Summary').textContent.trim(), heading.querySelector(':scope > Text').textContent],
    ['1', '候船', '#CFCFE4E4FFFF', '林舟等人', '内景 合成车站 日']);
  check('幕标题用 New Act', paras[0].getAttribute('Type'), 'New Act');
  const action = paras.find((n) => n.getAttribute('Type') === 'Action');
  check('特殊字符被转义、控制字符被去掉、粗体保留', [txt(action), action.querySelector('Text[Style="Bold"]').textContent], ['雨 & 风 很大 "引号" ', '很大']);
  check('对白里的换行拆成两段对白', paras.filter((n) => n.getAttribute('Type') === 'Dialogue').map(txt), ['你来了。', '坐吧。']);
  check('备忘和省略内容不导出，省略整场后场号仍保持原编号', [xml.includes('内部备忘'), xml.includes('被省略的动作'), xml.includes('合成码头'), paras.filter((n) => n.getAttribute('Type') === 'Scene Heading').map((n) => n.getAttribute('Number'))], [false, false, false, ['1', '3']]);
  const dual = paras.find((n) => n.querySelector(':scope > DualDialogue'));
  check('双列对白按 Final Draft 的写法', [dual.getAttribute('Type'), Array.from(dual.querySelector('DualDialogue').children).map((n) => `${n.getAttribute('Type')}:${txt(n)}`)],
    ['General', ['Character:甲', 'Dialogue:左边', 'Character:乙', 'Dialogue:右边']]);
  const titleLines = Array.from(root.querySelectorAll(':scope > TitlePage > Content > Paragraph')).map((n) => [n.getAttribute('Alignment'), txt(n)]).filter(([, t]) => t);
  check('标题页：片名居中、联系方式靠左', titleLines, [['Center', '合成片名'], ['Center', '第一稿'], ['Center', '编剧'], ['Center', '合成作者'], ['Left', '2026-10-15'], ['Left', 'test@example.invalid']]);

  const sparse = createProject('旧工程');
  sparse.titlePage = { show: true, title: '只有片名' };
  sparse.sceneMeta = [{ id: 'mx', elementId: sparse.elements.find((e) => e.type === 'scene_heading')?.id || 'none' }];
  check('旧工程缺字段也能导出', new w.DOMParser().parseFromString(toFdx(sparse), 'application/xml').getElementsByTagName('parsererror').length, 0);

  // ---- round trip ----
  const back = fromFdx(xml);
  check('导出再导入：元素类型与文字不变（换行拆成的两段除外）', back.elements.map((e) => `${e.type}:${e.text}`), [
    'act:第一幕', 'scene_heading:内景 合成车站 日', 'action:雨 &amp; 风 <b>很大</b> &quot;引号&quot; ', 'character:林舟', 'parenthetical:（低声）', 'dialogue:你来了。', 'dialogue:坐吧。',
    'character:甲', 'dialogue:左边', 'character:乙', 'dialogue:右边', 'scene_heading:内景 合成船舱 夜', 'transition:切至：']);
  check('双列对白读回左右两列', back.elements.filter((e) => e.dualGroup).map((e) => e.dual), ['left', 'left', 'right', 'right']);
  check('场景标题 / 梗概 / 颜色读回场景卡', back.sceneMeta.map((m) => [m.title, m.synopsis, m.color]), [['候船', '林舟等人', '#cfe4ff']]);
  check('场景梗概不会混进场次标题', back.elements[1].text, '内景 合成车站 日');
  check('标题页读回（「编剧」标签不进作者名）', [back.title.title, back.title.subtitle, back.title.author, back.title.contact], ['合成片名', '第一稿', '合成作者', '2026-10-15\ntest@example.invalid']);
  const plainAuthor = createProject('只写名字');
  Object.assign(plainAuthor.titlePage, { show: true, title: '片名', author: '某作者', subtitle: '', basedOn: '', date: '', contact: '' });
  const plainXml = new w.DOMParser().parseFromString(toFdx(plainAuthor), 'application/xml');
  check('作者没写标签时，Final Draft 标题页自动加「编剧」', Array.from(plainXml.querySelectorAll(':scope > TitlePage > Content > Paragraph')).map(txt).filter(Boolean), ['片名', '编剧', '某作者']);
  check('再导入作者仍是名字本身', fromFdx(toFdx(plainAuthor)).title.author, '某作者');

  // ---- older Guangying exports stay readable ----
  const legacy = '<?xml version="1.0"?><FinalDraft><Content><TitlePage><Paragraph Type="Title"><Text>旧片名</Text></Paragraph></TitlePage><Paragraph Type="Dual Dialogue"><DualDialogue><Paragraph Type="Character"><Text>甲</Text></Paragraph><Paragraph Type="Dialogue"><Text>一</Text></Paragraph><Paragraph Type="Character"><Text>乙</Text></Paragraph><Paragraph Type="Dialogue"><Text>二</Text></Paragraph></DualDialogue></Paragraph><Paragraph Type="Act Heading"><Text>第二幕</Text></Paragraph></Content></FinalDraft>';
  const old = fromFdx(legacy);
  check('旧版导出的文件仍能读：标题、双列、幕', [old.title.title, old.elements.map((e) => `${e.type}/${e.dual || ''}`)], ['旧片名', ['character/left', 'dialogue/left', 'character/right', 'dialogue/right', 'act/']]);
  assert.throws(() => fromFdx('<FinalDraft><Content>'), /FDX 解析失败/); checks++; console.log('  ✓ 坏文件明确报错');

  // ---- Final Draft's own sample script, read-only, when installed ----
  const sample = '/Applications/Final Draft 11.app/Contents/Resources/Data/Tutorial/Airship FD 11 - Script.fdxt';
  if (fs.existsSync(sample)) {
    const real = fromFdx(fs.readFileSync(sample, 'utf8'));
    const headings = real.elements.filter((e) => e.type === 'scene_heading');
    check('Final Draft 范例：读到场次、双列、标题页，梗概不混进场次标题',
      [headings.length > 3, real.elements.some((e) => e.dualGroup), real.title.title, real.title.author, headings.every((e) => !/Deanna's running/.test(e.text)), real.sceneMeta.length > 0],
      [true, true, 'Airship', "Pete D'Alessandro", true, true]);
  } else console.log('  - 本机没有 Final Draft 11 范例，跳过真实文件导入');
  // 本机装了 Final Draft 时，把它自带的全部模板和范例逐个导入（只读）：都不能报错，大纲类段落进「备忘」。
  const fdRoots = ['/Applications/Final Draft 11.app', '/Applications/Final Draft 13.app'].filter((dir) => fs.existsSync(dir));
  if (fdRoots.length) {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(path.join(dir, d.name)) : /\.fdxt?$/i.test(d.name) ? [path.join(dir, d.name)] : []);
    const files = fdRoots.flatMap(walk);
    const failures = files.filter((file) => { try { fromFdx(fs.readFileSync(file, 'utf8')); return false; } catch { return true; } });
    check(`Final Draft 自带的 ${files.length} 份模板 / 范例全部能导入`, failures, []);
    const outline = files.find((file) => /Outline\.fdxt$/.test(file) && /Tangle/.test(file));
    if (outline) check('大纲类段落导入成备忘', fromFdx(fs.readFileSync(outline, 'utf8')).elements.some((e) => e.type === 'note'), true);
  }

  console.log(`\n=== fdx ${checks}/${checks} PASS (synthetic + optional Final Draft sample; opening in Final Draft is manual QA) ===`);
})().catch((error) => { console.error(error); process.exit(1); });
