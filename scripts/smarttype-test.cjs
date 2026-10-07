/** SmartType field completion. Synthetic fixtures only; no user data or disk bundle. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');

(async () => {
  const built = await esbuild.build({
    entryPoints: [path.join(__dirname, 'smarttype.entry.ts')], bundle: true,
    write: false, platform: 'node', format: 'cjs', target: 'es2020', logLevel: 'silent',
  });
  const loaded = new Module(path.join(__dirname, 'smarttype-test.bundle.cjs'), module);
  loaded.filename = path.join(__dirname, 'smarttype-test.bundle.cjs');
  loaded.paths = Module._nodeModulePaths(__dirname);
  loaded._compile(built.outputFiles[0].text, loaded.filename);
  const { buildSmartTypeCatalog, getSmartTypeSuggestions, nextTypeOnTab, nextTypeOnEnter } = loaded.exports;
  let count = 0;
  const check = (label, actual, expected) => { assert.deepEqual(actual, expected, label); count++; console.log(`  ✓ ${label}`); };
  const el = (id, text, type = 'scene_heading') => ({ id, text, type });
  const rows = [
    el('c1', '<b>测试角色</b>（旁白）', 'character'), el('c2', 'Test Person (V.O.)', 'character'),
    el('c3', 'TEST PERSON (O.S.)', 'character'), el('c4', '测试乙 (CONT\'D)', 'character'),
    el('s1', '1. 内景 工作室 日'), el('s2', '外-城市街道-雨夜'),
    el('s3', '内·旧书店·夜'), el('s4', 'INT. OLD-TOWN STUDIO - NIGHT'),
    el('s5', 'I/E. TRAIN CAR - DAY'), el('s6', 'INT/EXT. COURTYARD - DAWN'),
    el('s7', '内外景 放映室 黄昏'), el('s8', '内-三楼-办公室-夜'),
    el('s9', 'INT. OLD TOWN - DAY'), el('s10', '外景 公园 午后'), el('s11', '港口场景'),
    el('s12', '内景 工作室 同样时刻'), el('s13', '内景 城市广场 未知时段'),
    el('t1', 'JUMP CUT TO:', 'transition'), el('shot1', '航拍 -', 'shot'),
  ];
  const project = { elements: rows };
  const before = JSON.stringify(project);
  const catalog = buildSmartTypeCatalog(project);
  const query = (text, type = 'scene_heading', cat = catalog, offset = text.length) => getSmartTypeSuggestions(el('editing', text, type), offset, cat);
  const result = (text, label, type = 'scene_heading', cat = catalog) => {
    const answer = query(text, type, cat);
    const item = answer?.items.find(item => item.label === label);
    assert.ok(item, `${text} should suggest ${label}`);
    return { answer, item, text: text.slice(0, answer.start) + item.value + text.slice(answer.end) };
  };
  check('catalog build does not mutate project', JSON.stringify(project), before);
  check('character qualifiers removed and case-insensitive names deduplicated', catalog.characters, ['测试角色', 'Test Person', '测试乙']);
  check('CONT\'D is not a typed extension suggestion', catalog.extensions.includes("CONT'D"), false);
  check('known Chinese time extracted from hyphen heading', catalog.locations.includes('旧书店'), true);
  check('internal hyphens in Chinese location survive parsing', catalog.locations.includes('三楼-办公室'), true);
  check('internal hyphens/spaces in English location survive parsing', catalog.locations.includes('OLD-TOWN STUDIO'), true);
  check('combined INT/EXT heading is recognized', catalog.locations.includes('COURTYARD'), true);
  check('I/E heading is recognized', catalog.locations.includes('TRAIN CAR'), true);
  check('same-moment Chinese time is not included in location', catalog.locations.includes('工作室 同样时刻'), false);
  check('ambiguous unrecognized trailing field is not misidentified as location', catalog.locations.includes('城市广场 未知时段'), false);
  check('custom transitions survive', catalog.transitions.includes('JUMP CUT TO:'), true);
  check('custom shots survive', catalog.shots.includes('航拍 -'), true);
  check('active row omitted before querying', buildSmartTypeCatalog(project, 'c1').characters.includes('测试角色'), false);
  check('single active scene cannot supply its own location', buildSmartTypeCatalog({ elements: [el('solo', '内景 自己的地点 日')] }, 'solo').locations, []);
  check('empty project has no invented characters', buildSmartTypeCatalog({ elements: [] }).characters, []);
  check('blank character query has existing names', query('', 'character').items.map(item => item.label), catalog.characters);
  check('blank scene query begins with setting tokens', query('').kind, 'intro');
  check('English character prefix is case-insensitive', result('test p', 'Test Person', 'character').text, 'Test Person');
  check('exact name is not offered as its own candidate', query('test person', 'character'), null);
  check('character qualification remains when completing name', result('测（旁白）', '测试角色', 'character').text, '测试角色（旁白）');
  check('qualified name replacement range covers retained qualifier once', result('测 (V.O.)', '测试角色', 'character').text, '测试角色 (V.O.)');
  check('ASCII extension gets matching closing bracket', result('测试角色 (v', 'V.O.', 'character').text, '测试角色 (V.O.)');
  check('Chinese extension gets matching closing bracket', result('测试角色 （旁', '旁白', 'character').text, '测试角色 （旁白）');
  check('extension field starts after opening bracket', query('测试角色 (', 'character').start, 6);
  check('extension retains base name exactly', result('  TEST PERSON (o', 'O.S.', 'character').text, '  TEST PERSON (O.S.)');
  check('completed qualifier does not get another closing bracket', query('Test Person (V.O.)', 'character'), null);
  check('complete extension still offers its missing closing bracket only', query('测试角色 (v.o.', 'character').items.map(item => [item.label, item.value]), [['V.O.', 'V.O.)']]);
  check('partial Chinese setting completes independently', result('内/', '内/外景').text, '内/外景');
  check('partial English setting completes case-insensitively', result('int', 'INT.').text, 'INT.');
  check('intro item requests a following field separator', result('int', 'INT.').item.separator, ' ');
  check('location completion does not replace heading prefix', result('内景 工', '工作室').text, '内景 工作室');
  check('location item requests a following time separator', result('内景 工', '工作室').item.separator, ' ');
  check('location after empty slot exposes vocabulary', query('内景 ').kind, 'location');
  check('single-letter Chinese setting works', result('内-三楼', '三楼-办公室').text, '内-三楼-办公室');
  check('middle dot separator survives', result('内·旧', '旧书店').text, '内·旧书店');
  check('combined setting prefix survives', result('INT/EXT. COUR', 'COURTYARD').text, 'INT/EXT. COURTYARD');
  check('numbered heading prefix survives', result('12. 内景 工', '工作室').text, '12. 内景 工作室');
  check('Chinese numbered heading prefix survives', result('第十二场 内景 工', '工作室').text, '第十二场 内景 工作室');
  check('location spaces survive', result('INT. OLD T', 'OLD TOWN').text, 'INT. OLD TOWN');
  check('location hyphens survive', result('INT. OLD-', 'OLD-TOWN STUDIO').text, 'INT. OLD-TOWN STUDIO');
  check('known location followed by whitespace opens time slot', query('内景 工作室 ').kind, 'time');
  check('known hyphenated location followed by hyphen opens time slot', query('内-三楼-办公室-').kind, 'time');
  check('time only replaces last field', result('内景 工作室 清', '清晨').text, '内景 工作室 清晨');
  check('English time prefix is case-insensitive', result('INT. OLD-TOWN STUDIO - n', 'NIGHT').text, 'INT. OLD-TOWN STUDIO - NIGHT');
  check('time field does not append trailing whitespace', result('内景 工作室 清', '清晨').item.separator, undefined);
  check('complete time for a new location does not expand into longer time', query('内-新地点-夜'), null);
  check('new location and complete time remain untouched', query('内景 新地点 夜'), null);
  check('complete known time 夜 does not become 夜晚 on Enter', query('内景 工作室 夜'), null);
  check('complete known location does not fall back to a longer whole heading', query('内景 工作室'), null);
  const exactPeople = buildSmartTypeCatalog({ elements: [el('short-name', 'AL', 'character'), el('long-name', 'ALICE', 'character'), el('ch-short', '测试', 'character'), el('ch-long', '测试角色', 'character'), el('role-short', 'TEST ROLE', 'character'), el('role-long', 'TEST ROLE TWO', 'character')] });
  check('complete AL does not become ALICE on Enter', query('AL', 'character', exactPeople), null);
  check('complete 测试 does not become 测试角色 on Enter', query('测试', 'character', exactPeople), null);
  check('case-insensitive complete name preserves typed case instead of expanding', query('test role', 'character', exactPeople), null);
  check('complete qualified name does not become longer character name', query('AL (V.O.)', 'character', exactPeople), null);
  check('same-moment time prefix completes only last field', result('内景 工作室 同样时', '同样时刻').text, '内景 工作室 同样时刻');
  check('unknown location with trailing space remains safe to type manually', query('内景 新地点 '), null);
  check('new hyphenated location is not fragmented into guessed fields', query('内-新-未知地点'), null);
  check('location whose end resembles partial time remains location', result('内-OLD-', 'OLD-TOWN STUDIO').answer.kind, 'location');
  check('unrecognized heading has safe complete-heading fallback', result('港口', '港口场景').answer.kind, 'scene_heading');
  check('English transitions remain available', result('cut', 'CUT TO:', 'transition').text, 'CUT TO:');
  check('Chinese shots remain available', result('特', '特写 -', 'shot').text, '特写 -');
  check('typed custom shots remain available', result('航', '航拍 -', 'shot').text, '航拍 -');
  for (const type of ['action', 'dialogue', 'parenthetical', 'general', 'note', 'act']) check(`${type} has no automatic completion`, query('测', type), null);
  check('middle-of-line caret never offers destructive completion', query('测试角色', 'character', catalog, 1), null);
  check('negative caret is ignored', query('测', 'character', catalog, -1), null);
  check('NaN caret is ignored', query('测', 'character', catalog, NaN), null);
  check('soft line break does not become a single-field completion', query('测\n试', 'character'), null);
  const many = buildSmartTypeCatalog({ elements: Array.from({ length: 20 }, (_, i) => el(`many-${i}`, `测试${i}`, 'character')) });
  check('candidate list is bounded to eight', query('测', 'character', many).items.length, 8);
  const immutable = Object.freeze({ elements: Object.freeze(rows.map(row => Object.freeze({ ...row }))) });
  const immutableBefore = JSON.stringify(immutable);
  buildSmartTypeCatalog(immutable, 'c1');
  for (const sample of ['内景 工', '内景 工作室 清', 'INT. OLD-']) query(sample);
  check('frozen fixtures remain unchanged', JSON.stringify(immutable), immutableBefore);
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.document = dom.window.document;
  const literal = buildSmartTypeCatalog({ elements: [el('literal', '&lt;测试&amp;角色&gt;', 'character')] });
  check('HTML entities project to literal candidate text', literal.characters, ['<测试&角色>']);
  const formatted = getSmartTypeSuggestions(el('editing', '<b>测</b>', 'character'), 1, catalog);
  check('inline formatting does not corrupt text offsets', [formatted.start, formatted.end, formatted.query], [0, 1, '测']);
  const emoji = buildSmartTypeCatalog({ elements: [el('emoji', '🎬测试角色', 'character')] });
  const emojiResult = getSmartTypeSuggestions(el('editing', '&#x1F3AC;测', 'character'), 3, emoji);
  check('decoded numeric entity obeys UTF16 offsets', [emojiResult.start, emojiResult.end], [0, 3]);
  const originalCreate = document.createElement.bind(document);
  let projections = 0;
  document.createElement = (name, ...args) => { if (name === 'template') projections++; return originalCreate(name, ...args); };
  const performanceRows = Array.from({ length: 300 }, (_, i) => el(`ordinary-${i}`, `<b>合成动作${i}</b>`, i % 2 ? 'action' : 'dialogue'));
  const vocabularyRow = el('perf-character', '<b>缓存角色</b>', 'character');
  const performanceProject = { elements: [...performanceRows, vocabularyRow] };
  buildSmartTypeCatalog(performanceProject);
  check('catalog skips DOM projection for all action/dialogue paragraphs', projections, 1);
  buildSmartTypeCatalog(performanceProject);
  check('unchanged element reference reuses plain projection', projections, 1);
  buildSmartTypeCatalog({ elements: [...performanceRows, { ...vocabularyRow, text: '<b>缓存角色乙</b>' }] });
  check('new edited element alone creates new projection', projections, 2);
  vocabularyRow.text = '<b>缓存角色丙</b>';
  check('cache guards source text even if a caller mutates a fixture', buildSmartTypeCatalog(performanceProject).characters, ['缓存角色丙']);
  check('changed source text invalidates its cached projection', projections, 3);
  document.createElement = originalCreate;
  delete global.document;
  dom.window.close();
  const types = ['action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'scene_heading', 'general', 'note'];
  check('SmartType does not change nine-class Tab loop', types.map(type => nextTypeOnTab(type)), [...types.slice(1), 'action']);
  check('character Enter rhythm still advances to dialogue', nextTypeOnEnter(el('c', '测试角色', 'character'), false), 'dialogue');
  check('scene Enter rhythm still advances to action', nextTypeOnEnter(el('s', '内景 工作室 日'), false), 'action');
  console.log(`\n=== smarttype ${count}/${count} PASS ===`);
})().catch(error => { console.error(error); process.exitCode = 1; });
