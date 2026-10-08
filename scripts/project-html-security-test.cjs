/** Synthetic .zhsp/automatic-recovery HTML boundary regression. Uses no user
 * documents, network, Electron profile or disk project. DOM assertions cover
 * renderer output; actual Electron execution is a separate acceptance layer.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const repo = path.resolve(__dirname, '..');
let checks = 0;
const check = (label, actual, expected = true) => {
  assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`);
};
const dom = new JSDOM('<!doctype html><div id="host"></div>', { url: 'http://project-html-test.invalid/' });
const document = dom.window.document;
const host = document.getElementById('host');
const clone = value => JSON.parse(JSON.stringify(value));

(async () => {
  // Deliberately do not expose window/document globals. Project loading must also
  // work in the existing pure Node compatibility/model checks.
  const built = await require('esbuild').build({
    stdin: { contents: `export * from './src/utils/projectHtml';
      export {parseProject, serializeProject} from './src/io/zhsp';
      export {createProject, deriveScenes} from './src/model/project';
      export {paginateMeasured} from './src/hooks/PaginationProvider';
      export {useStore} from './src/store/store';
      export * from './src/app/autosaveStorage';
      export {StaticBlock} from './src/components/ScriptBlock';
      export {toFdx, fromFdx} from './src/io/fdx';
      export {toHtml, toPlainText, fromPlainText} from './src/io/textscript';`, resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react', 'react-dom', 'zustand', 'zustand/*'], logLevel: 'silent',
  });
  const filename = path.join(repo, '.project-html-memory.cjs');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(repo);
  mod._compile(built.outputFiles[0].text, filename);
  const api = mod.exports;
  const sanitize = api.sanitizeProjectHtml;
  const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'SPAN', 'DIV', 'P', 'S', 'STRIKE', 'DEL', 'SUB', 'SUP']);
  const safeDom = html => {
    host.innerHTML = html;
    for (const node of host.querySelectorAll('*')) {
      assert.ok(allowed.has(node.tagName), `unapproved output tag ${node.tagName}`);
      assert.equal(node.namespaceURI, 'http://www.w3.org/1999/xhtml');
      for (const attr of node.attributes) {
        assert.equal(attr.name, 'style', `unapproved output attribute ${attr.name}`);
        for (const name of node.style) assert.ok(['font-weight', 'font-style', 'text-decoration', 'text-decoration-line'].includes(name));
      }
    }
  };

  const historical = [
    '', '  合成\n正文\t"引号" \'单引号\' & 尾  ',
    '<b>粗体</b><i>斜体</i><u>下划线</u><br>尾',
    '<strong>强调<em>嵌套</em></strong><BR /><br/><br>软换行',
    '<div>首行</div><div><br></div><p>次行<span> 原有空白 </span></p>',
    '<b>&lt;script&gt; &amp; &#39; &quot; &nbsp; &#160; &#x1f642;</b>',
    '<span>甲\u00a0乙　丙</span><s>删线</s><strike>旧删线</strike><del>删</del><sub>下</sub><sup>上</sup>',
    '<B><I>大写旧标签</I></B>',
    '&lt;img src=x onerror=bad()&gt; &amp;lt;script&amp;gt; &#60;svg onload=bad()&#62;',
  ];
  for (const [index, html] of historical.entries()) {
    check(`safe historical HTML ${index} retains exact bytes`, sanitize(html), html);
    safeDom(sanitize(html));
  }

  const styles = '<span style="font-weight: 700; font-style: italic; text-decoration: underline">合成样式</span><b><span style="font-weight: normal">恢复普通</span></b>';
  check('old inline basic format and explicit normal reset survive', sanitize(styles), styles);
  check('safe style sanitization is stable on repeated loads', sanitize(sanitize(styles)), styles);
  safeDom(sanitize(styles));
  check('arbitrary CSS cannot accompany approved formatting',
    sanitize('<span style="font-weight:bold; color:red; position:fixed; inset:0; background:url(https://fixture.invalid/x); font-size:9999px; font-style:italic">合成</span>'),
    '<span style="font-weight: bold; font-style: italic">合成</span>');
  for (const value of ['url(https://fixture.invalid/x)', 'var(--anything)', 'b\\6fld', 'bold!important', 'bold/*x*/', 'expression(bad())', '700; --x: red']) {
    const clean = sanitize(`<span style="font-weight:${value}">合成</span>`);
    safeDom(clean);
    check(`CSS attack spelling ${value} is not emitted`, /url|var\(|\\|!important|\/\*|expression|--x/.test(clean), false);
  }

  const attacks = [
    ['script body', '<script>window.__projectPwned=1</script>', ''],
    ['style body', '<style>body{display:none}</style>', ''],
    ['image event/network', '<img src="https://fixture.invalid/image" onerror="bad()">', ''],
    ['SVG namespace', '<svg onload="bad()"><foreignObject><b>不引入</b></foreignObject></svg>', ''],
    ['MathML namespace', '<math><mtext>不引入</mtext></math>', ''],
    ['frame srcdoc', '<iframe srcdoc="<script>bad()</script>">不引入</iframe>', ''],
    ['template fragment', '<template><b>不引入</b></template>', ''],
    ['noscript raw text', '<noscript><img src=x onerror=bad()></noscript>', ''],
    ['raw text', '<xmp><img src=x onerror=bad()></xmp>', ''],
    ['object document', '<object data="file:///synthetic.txt">不引入</object>', ''],
    ['event and identity', '<b OnClick="bad()" id="root" class="app-shell" data-native-edit-history>保留</b>', '<b>保留</b>'],
    ['javascript link', '<a href="javascript:bad()" target="_top">保留链接文字</a>', '保留链接文字'],
    ['encoded URL', '<a href="java&#x73;cript:bad()">保留</a>', '保留'],
    ['metadata navigation', '<base href="https://fixture.invalid"><meta http-equiv="refresh" content="0;url=https://fixture.invalid"><link rel="stylesheet" href="https://fixture.invalid">', ''],
    ['malformed attributes', '<b/onmouseover=bad()>保留</b>', '<b>保留</b>'],
    ['quoted angle', '<b title="<img src=x onerror=bad()>">保留</b>', '<b>保留</b>'],
    ['comments/declaration', '<!--<img src=x onerror=bad()>--><!doctype html><b>保留</b>', '<b>保留</b>'],
    ['unsafe line break', '<br onmouseover="bad()"><br style="background:url(https://fixture.invalid)">', '<br><br>'],
    ['null in tag', '<scr\0ipt>不可执行</scr\0ipt><b>保留</b>', '不可执行<b>保留</b>'],
  ];
  for (const [name, html, expected] of attacks) {
    const clean = sanitize(html);
    check(`removes ${name}`, clean, expected);
    safeDom(clean);
    check(`cleaned ${name} is idempotent`, sanitize(clean), clean);
  }
  for (const [index, html] of [
    '<b><i>错位</b></i>', '<p>一<div>二</div>三</p>',
    '<svg><p><b onclick=bad()>保留词</b></p></svg>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=bad()>">',
    '<form><button formaction="javascript:bad()">词</button><input autofocus onfocus=bad()></form>',
  ].entries()) {
    const clean = sanitize(html);
    safeDom(clean);
    check(`malformed/mutation case ${index} stays safe after reparse`, sanitize(clean), clean);
  }

  for (const [name, html] of [
    ['oversized plaintext', '文'.repeat(api.MAX_PROJECT_HTML_LENGTH + 1)],
    ['deep allowlisted markup', '<b>'.repeat(api.MAX_PROJECT_HTML_DEPTH + 1) + '文' + '</b>'.repeat(api.MAX_PROJECT_HTML_DEPTH + 1)],
    ['deep unknown markup', '<unknown>'.repeat(api.MAX_PROJECT_HTML_DEPTH + 1) + '文' + '</unknown>'.repeat(api.MAX_PROJECT_HTML_DEPTH + 1)],
    ['deep detached templates', '<template>'.repeat(api.MAX_PROJECT_HTML_DEPTH + 1) + '文' + '</template>'.repeat(api.MAX_PROJECT_HTML_DEPTH + 1)],
    ['excessive sibling nodes', '<img>'.repeat(api.MAX_PROJECT_HTML_NODES + 1)],
    ['excessive comment nodes', '<!--合成-->'.repeat(api.MAX_PROJECT_HTML_NODES + 1)],
    ['excessive mixed text nodes', '文<!--合成-->'.repeat(api.MAX_PROJECT_HTML_NODES / 2 + 1)],
    ['excessive fast-path text nodes', '文<br>'.repeat(api.MAX_PROJECT_HTML_NODES / 2 + 1)],
  ]) {
    assert.throws(() => sanitize(html), /过大或嵌套过深/, name);
    checks++; console.log(`PASS rejects ${name} without truncation`);
  }
  check('large legitimate plain paragraph remains exact', sanitize('文'.repeat(api.MAX_PROJECT_HTML_LENGTH)).length, api.MAX_PROJECT_HTML_LENGTH);
  const manyAttributes = Array.from({ length: 50_000 }, (_, i) => `a${i}`).join(' ');
  for (const [name, payload] of [
    ['many unique attributes', `<b ${manyAttributes}>合成</b>`],
    ['attributes on end tag', `合成</b ${manyAttributes}>`],
    ['slash-separated attributes', `<b/${manyAttributes.replaceAll(' ', '/')}>合成</b>`],
    ['mixed HTML whitespace', `<b ${manyAttributes.replaceAll(' ', '\t\r\n\f')}>合成</b>`],
    ['quoted angle brackets', `<b ${Array.from({ length: 1000 }, (_, i) => `a${i}=">"`).join(' ')}>合成</b>`],
    ['adjacent quoted attributes', `<b ${Array.from({ length: 1000 }, (_, i) => `a${i}=""`).join('')}>合成</b>`],
    ['quote in unquoted value', `<b initial=one' ${manyAttributes}>合成</b>`],
    ['false earlier tag in comment', `<!-- <b title=" --> <b ${manyAttributes}>合成</b>">`],
    ['long unfinished tag', '<b title="' + '合成'.repeat(10_000)],
    ['overlapping apparent tags', '<b title="' + '<b title="'.repeat(2000) + '合成'],
  ]) {
    // A real synchronous timeout also bounds a regressed tokenizer: this test
    // never waits for the intentionally quadratic attribute payload to finish.
    assert.throws(() => vm.runInNewContext('sanitize(payload)', { sanitize, payload }, { timeout: 2000 }), /过大或嵌套过深/, name);
    checks++; console.log(`PASS rejects ${name} before expensive tokenization`);
  }
  check('ordinary historical attributes and quoted angle text still sanitize',
    sanitize('<b title="合成 > <i>引号内" data-old=one\'two><span style="font-weight: 700">正文</span></b>'),
    '<b><span style="font-weight: 700">正文</span></b>');

  const project = api.createProject('合成安全工程');
  project.titlePage.show = false;
  project.acts = [];
  const unsafe = '合成前<b onclick="window.__projectPwned=1">粗体</b><br><i>斜体</i><img src="https://security-fixture.invalid/asset" onerror="window.__projectPwned=1"><svg onload="window.__projectPwned=1"><text>丢弃</text></svg><script>window.__projectPwned=1</script>合成后';
  const expected = '合成前<b>粗体</b><br><i>斜体</i>合成后';
  project.elements = [
    { id: 'safe-action', type: 'action', text: unsafe, rev: 'old-rev', omit: false, sceneId: 'meta-old' },
    { id: 'safe-dialogue', type: 'dialogue', text: historical[2], dual: 'left', dualGroup: 'old-dual' },
    { id: 'safe-note', type: 'note', text: historical[4] },
  ];
  project.sceneMeta = [{ id: 'meta-old', elementId: 'safe-action', title: '合成标题', synopsis: '合成摘要', color: '#fff', x: 2, y: 3 }];
  project.beats = [{ id: 'image-old', kind: 'image', text: '合成图片注释', img: 'data:application/octet-stream;base64,AA==', x: 4, y: 5, color: '#fff' }];
  const raw = JSON.stringify({ app: 'zh-screenwriter', fileVersion: 1, project });
  const parsed = api.parseProject(raw);
  const safeProject = clone(project); safeProject.elements[0].text = expected;
  check('legacy envelope migration changes only hostile rich text', parsed, safeProject);
  check('bare legacy project follows the same boundary', api.parseProject(JSON.stringify(project)), safeProject);
  check('source project fixture is not mutated by migration', project.elements[0].text, unsafe);
  check('save/reopen preserves clean HTML and all legacy metadata', api.parseProject(api.serializeProject(parsed)), parsed);
  const absentText = clone(project); delete absentText.elements[0].text;
  check('old missing text remains an empty paragraph', api.parseProject(JSON.stringify(absentText)).elements[0].text, '');
  for (const value of [42, {}, [], false]) {
    const broken = clone(project); broken.elements[0].text = value;
    assert.throws(() => api.parseProject(JSON.stringify(broken)), /工程正文格式不正确/); checks++;
  }
  const rejectedProject = (name, mutate) => {
    const broken = clone(project); mutate(broken);
    assert.throws(() => api.parseProject(JSON.stringify(broken)), /工程.*格式不正确/, name);
    checks++; console.log(`PASS rejects ${name} without dropping paragraphs`);
  };
  for (const value of [null, [], 5, '工程', true, { project: null }, { project: [] }, { project: 7 }]) {
    assert.throws(() => api.parseProject(JSON.stringify(value)), /工程结构格式不正确/);
    checks++;
  }
  for (const key of ['elements', 'sceneMeta', 'beats', 'boardLinks', 'acts', 'revisions']) {
    for (const value of [null, {}, '非数组']) rejectedProject(`${key} invalid container`, p => { p[key] = value; });
    for (const value of [null, [], 42]) rejectedProject(`${key} invalid entry`, p => { p[key] = [value]; });
  }
  for (const value of [{}, 7, '', '__proto__', 'constructor', 'bad"selector', 'line\nbreak']) {
    rejectedProject('invalid paragraph ID', p => { p.elements[0].id = value; });
  }
  for (const value of Object.getOwnPropertyNames(Object.prototype)) {
    rejectedProject(`inherited ID ${value}`, p => { p.elements[0].id = value; });
  }
  rejectedProject('duplicate paragraph IDs', p => { p.elements[1].id = p.elements[0].id; });
  rejectedProject('duplicate card IDs', p => { p.beats.push({ ...p.beats[0], text: '另一张卡' }); });
  rejectedProject('scene and beat share a deletion ID', p => { p.elements[0].type = 'scene_heading'; p.beats[0].id = p.elements[0].id; });
  rejectedProject('ordinary paragraph and beat share a future scene ID', p => { p.beats[0].id = p.elements[0].id; });
  rejectedProject('bare ID aliases another beat address', p => { p.elements[0].id = `beat:${p.beats[0].id}`; });
  rejectedProject('bare ID aliases another scene address', p => { p.beats[0].id = `scene:${p.elements[0].id}`; });
  for (const value of [{}, 7, '', 'unknown', '__proto__', 'action" onclick="bad()']) {
    rejectedProject('invalid paragraph type', p => { p.elements[0].type = value; });
  }
  for (const [name, mutate] of [
    ['paragraph omit object', p => { p.elements[0].omit = {}; }],
    ['paragraph dual enum', p => { p.elements[0].dual = 'other'; }],
    ['paragraph reference object', p => { p.elements[0].rev = {}; }],
    ['project ID object', p => { p.id = {}; }],
    ['project name object', p => { p.name = {}; }],
    ['project timestamp string', p => { p.createdAt = 'now'; }],
    ['title page array', p => { p.titlePage = []; }],
    ['title page text object', p => { p.titlePage.notes = {}; }],
    ['title page show object', p => { p.titlePage.show = {}; }],
    ['scene metadata element ID', p => { p.sceneMeta[0].elementId = {}; }],
    ['scene metadata title', p => { p.sceneMeta[0].title = {}; }],
    ['scene metadata coordinate', p => { p.sceneMeta[0].x = {}; }],
    ['board link endpoint', p => { p.boardLinks = [{ id: 'link', from: {}, to: 'beat:image-old' }]; }],
    ['board link note', p => { p.boardLinks = [{ id: 'link', from: 'scene:s1', to: 'beat:image-old', note: {} }]; }],
    ['act title', p => { p.acts = [{ id: 'act', title: {}, color: '#fff' }]; }],
    ['revision label', p => { p.revisions[0].label = {}; }],
    ['revision color', p => { p.revisions[0].color = {}; }],
    ['image field object', p => { p.beats[0].img = {}; }],
    ['beat prose object', p => { p.beats[0].text = {}; }],
    ['settings array', p => { p.settings = []; }],
    ['settings null', p => { p.settings = null; }],
    ['font size string injection', p => { p.settings.fontSize = '12; background:url(https://fixture.invalid)'; }],
    ['font name object', p => { p.settings.fontKey = {}; }],
    ['continuation text object', p => { p.settings.moreText = {}; }],
    ['settings boolean object', p => { p.settings.showPageNumbers = {}; }],
    ['near-zero line height pagination attack', p => { p.settings.lineHeight = 1e-12; p.settings.marginTop = 1000; }],
    ['near-zero line height alone', p => { p.settings.lineHeight = 1e-12; }],
    ['near-zero font size', p => { p.settings.fontSize = 1e-12; }],
    ['negative line height', p => { p.settings.lineHeight = -1; }],
    ['enormous font size', p => { p.settings.fontSize = 1e100; }],
    ['enormous line height', p => { p.settings.lineHeight = 1e100; }],
    ['enormous negative margin', p => { p.settings.marginTop = -1e100; }],
    ['nonpositive content height', p => { p.settings.marginTop = 15; p.settings.marginBottom = 15; }],
    ['nonpositive content width', p => { p.settings.marginLeft = 11; p.settings.marginRight = 11; }],
    ['Letter-only width cannot break A4 preview', p => { p.settings.paper = 'letter'; p.settings.marginLeft = 10.2; p.settings.marginRight = 10.2; }],
    ['unknown paper size', p => { p.settings.paper = '__proto__'; }],
    ['indent container array', p => { p.settings.indent = []; }],
    ['indent entry null', p => { p.settings.indent.action = null; }],
    ['indent CSS string', p => { p.settings.indent.action.left = '0" onmouseover="bad()'; }],
    ['indent allocation overflow', p => { p.settings.indent.action.left = 1e100; }],
    ['indent alignment injection', p => { p.settings.indent.action.align = 'left; background:url(https://fixture.invalid)'; }],
    ['indent boolean object', p => { p.settings.indent.action.bold = {}; }],
  ]) rejectedProject(name, mutate);
  for (const property of ['fontSize', 'lineHeight', 'wordsPerMinute']) {
    const rawOverflow = JSON.stringify(project).replace(`"${property}":${project.settings[property]}`, `"${property}":1e999`);
    assert.throws(() => api.parseProject(rawOverflow), /工程结构格式不正确/); checks++;
  }
  const minimalLegacy = api.parseProject(JSON.stringify({ elements: [{ id: 'legacy-one', type: 'general' }] }));
  check('missing legacy optional data receives defaults without dropping the paragraph',
    [minimalLegacy.elements, minimalLegacy.beats, minimalLegacy.boardLinks, minimalLegacy.acts.length],
    [[{ id: 'legacy-one', type: 'general', text: '' }], [], [], 1]);
  const partialSettings = clone(safeProject);
  partialSettings.settings = { fontKey: 'historic-custom-font', indent: { action: { left: -2 } }, futureOption: { kept: true } };
  const partialLoaded = api.parseProject(JSON.stringify(partialSettings));
  check('old partial indent gets defaults while valid custom values survive', partialLoaded.settings.indent.action,
    { ...api.createProject().settings.indent.action, left: -2 });
  check('old custom font name and unknown non-rendered settings extension survive',
    [partialLoaded.settings.fontKey, partialLoaded.settings.futureOption], ['historic-custom-font', { kept: true }]);
  check('optional paragraph flags remain absent in old minimal projects', Object.keys(minimalLegacy.elements[0]).sort(), ['id', 'text', 'type']);
  check('explicit zero acts still survives structural validation', parsed.acts, []);
  const duplicateMeta = clone(safeProject);
  duplicateMeta.elements[0].type = 'scene_heading';
  duplicateMeta.sceneMeta.push({ ...duplicateMeta.sceneMeta[0], id: 'meta-second', title: '第二条旧元数据' });
  const legacyMetaLoaded = api.parseProject(JSON.stringify(duplicateMeta));
  check('legacy duplicate scene metadata preserves both entries and first-match title',
    [legacyMetaLoaded.sceneMeta, api.deriveScenes(legacyMetaLoaded)[0].title],
    [duplicateMeta.sceneMeta, duplicateMeta.sceneMeta[0].title]);
  const boardFixture = api.createProject('合成选择命名空间');
  boardFixture.elements = [
    { id: 'board-scene-one', type: 'scene_heading', text: '内景 合成甲 日' },
    { id: 'board-body-one', type: 'action', text: '第一场正文必须保留' },
    { id: 'board-scene-two', type: 'scene_heading', text: '外景 合成乙 夜' },
    { id: 'board-body-two', type: 'action', text: '第二场正文必须保留' },
  ];
  boardFixture.sceneMeta = [
    { id: 'shared-meta', elementId: 'board-scene-one', title: '第一场', synopsis: '', color: '#fff' },
    { id: 'meta-two', elementId: 'board-scene-two', title: '第二场', synopsis: '', color: '#fff' },
  ];
  boardFixture.beats = [
    { id: 'shared-meta', text: '仅删除此卡', x: 0, y: 0, color: '#fff', sceneId: 'shared-meta' },
    { id: 'keep-beat', text: '另一场关联素材', x: 1, y: 1, color: '#fff', sceneId: 'meta-two' },
  ];
  boardFixture.boardLinks = [{ id: 'keep-link', from: 'scene:board-scene-two', to: 'beat:keep-beat', note: '保留关系' }];
  const boardLoaded = api.parseProject(JSON.stringify(boardFixture));
  const state = () => api.useStore.getState();
  state().loadProject(boardLoaded);
  state().setSelectedIds(['beat:shared-meta']);
  check('metadata ID matching a beat cannot turn beat deletion into scene deletion', state().deleteSelectedBoardCards(), { scenes: 0, beats: 1 });
  check('beat deletion retains every paragraph, metadata record and unrelated association/link',
    [state().project.elements, state().project.sceneMeta, state().project.beats, state().project.boardLinks],
    [boardLoaded.elements, boardLoaded.sceneMeta, [boardLoaded.beats[1]], boardLoaded.boardLinks]);
  state().undo();
  check('metadata/beat ID overlap deletion undoes to the entire loaded project', state().project, boardLoaded);
  state().setSelectedIds(['scene:board-scene-one']);
  check('scene deletion with a metadata/beat ID overlap deletes only the requested scene', state().deleteSelectedBoardCards(), { scenes: 1, beats: 0 });
  const unlinkedBeat = { ...boardLoaded.beats[0] }; delete unlinkedBeat.sceneId;
  check('scene deletion keeps both cards and the other scene association and link',
    [state().project.elements, state().project.beats, state().project.boardLinks],
    [boardLoaded.elements.slice(2), [unlinkedBeat, boardLoaded.beats[1]], boardLoaded.boardLinks]);
  state().undo();
  check('scene deletion with overlapping metadata ID fully restores on undo', state().project, boardLoaded);
  const ambiguousBoard = clone(boardFixture); ambiguousBoard.beats[0].id = 'board-scene-one';
  const beforeRejectedLoad = state();
  assert.throws(() => state().loadProject(api.parseProject(JSON.stringify(ambiguousBoard))), /工程结构格式不正确/);
  checks++;
  check('ambiguous imported IDs are rejected before replacing the current store or history',
    [state().project === beforeRejectedLoad.project, state().past === beforeRejectedLoad.past, state().future === beforeRejectedLoad.future], [true, true, true]);
  for (const layout of [
    { fontSize: 7.5, lineHeight: 1.25, marginTop: 1.75, marginBottom: 2.25, marginLeft: 2, marginRight: 2 },
    { fontSize: 48, lineHeight: 0.75, marginTop: -0.5, marginBottom: 0, marginLeft: 0, marginRight: 0 },
    { fontSize: 1, lineHeight: 0.5, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 },
  ]) {
    const custom = api.createProject('合成合法自定义版式');
    custom.elements = [{ id: 'custom-layout', type: 'action', text: '合成正文' }];
    Object.assign(custom.settings, layout);
    const loaded = api.parseProject(JSON.stringify(custom));
    check('valid historical custom layout round-trips without clamping', loaded, custom);
    const fontPx = layout.fontSize * 96 / 72, linePx = fontPx * layout.lineHeight;
    const result = api.paginateMeasured(loaded, new Map([['s:custom-layout', Math.ceil(Math.max(linePx, fontPx * 1.4))]]), {
      lineHeightPx: linePx, contentWidthPx: (210 - (layout.marginLeft + layout.marginRight) * 10) * 96 / 25.4,
      contentHeightPx: (297 - (layout.marginTop + layout.marginBottom) * 10) * 96 / 25.4,
    });
    check('accepted custom layout paginates one measured block with its own page mapping',
      [result.pages.length, result.pageOf['custom-layout'], Object.hasOwn(result.pageOf, 'custom-layout')], [1, 0, true]);
  }
  for (const key of [api.AUTOSAVE_KEY, api.LEGACY_AUTOSAVE_KEY]) {
    const recoveryRaw = JSON.stringify({ project, filePath: '/synthetic/project.zhsp' });
    const values = new Map([[key, recoveryRaw]]);
    const storage = { getItem: name => values.get(name) ?? null, setItem: (name, value) => values.set(name, value) };
    check(`${key} migration cleans before restoration`, api.readRecovery(storage).snapshot.project, safeProject);
    check(`${key} read preserves original stored payload`, [...values], [[key, recoveryRaw]]);
  }
  api.useStore.getState().loadProject(parsed);
  api.useStore.getState().setText('safe-action', `${expected}<u>新输入</u>`);
  api.useStore.getState().undo();
  check('undo after imported edit returns to sanitized history', api.useStore.getState().project.elements[0].text, expected);
  api.useStore.getState().redo();
  check('redo preserves legal formatting without resurrecting payload', api.useStore.getState().project.elements[0].text, `${expected}<u>新输入</u>`);
  const rendered = renderToStaticMarkup(React.createElement(api.StaticBlock, { el: parsed.elements[0], settings: parsed.settings }));
  host.innerHTML = rendered;
  check('actual screenplay static renderer only receives sanitized body', host.firstElementChild.innerHTML, expected);
  check('rendered body has no active imported descendants', host.querySelectorAll('script,img,svg,iframe,[onclick],[onerror]').length, 0);
  const fdx = api.toFdx(parsed), html = api.toHtml(parsed), text = api.toPlainText(parsed);
  check('FDX preserves rich bold and italic export', [fdx.includes('Style="Bold"'), fdx.includes('Style="Italic"')], [true, true]);
  check('all exports exclude removed executable payload', /__projectPwned|security-fixture/.test(fdx + html + text), false);
  const literal = '<img src=x onerror=bad()>合成字面文本 & 另行';
  const importedText = api.fromPlainText(literal);
  host.innerHTML = importedText.map(element => element.text).join('');
  check('existing TXT import keeps literal markup as words', [host.textContent, host.querySelectorAll('*').length], [literal, 0]);
  console.log(`project HTML security: ${checks} checks passed (synthetic .zhsp/recovery/model/DOM; no native execution claim)`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(() => dom.window.close());
