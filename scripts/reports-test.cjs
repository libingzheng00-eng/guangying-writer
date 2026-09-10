/** 统计面板契约：只用合成工程，在内存 bundle 中验证；不加载用户资料或应用。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const fs = require('node:fs');

(async () => {
  const bundle = await require('esbuild').build({ stdin: {
    contents: `export { buildReport, parseSceneHeading, reportCsvCell } from './src/model/reports';
      export { createProject } from './src/model/project';
      export { useStore } from './src/store/store';
      export { countWords } from './src/utils/text';`,
    resolveDir: path.resolve(__dirname, '..'), loader: 'ts',
  }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' });
  const mod = new Module(path.join(__dirname, 'reports-test.bundle.cjs'), module);
  mod.filename = path.join(__dirname, 'reports-test.bundle.cjs');
  mod.paths = Module._nodeModulePaths(__dirname);
  mod._compile(bundle.outputFiles[0].text, mod.filename);
  const { buildReport, parseSceneHeading, reportCsvCell, createProject, useStore, countWords } = mod.exports;
  const clone = value => JSON.parse(JSON.stringify(value));
  const fixture = () => {
    const p = createProject('合成统计契约');
    p.settings.wordsPerMinute = 120;
    p.acts = [{ id: 'a', title: '合成幕甲', color: '#fff' }, { id: 'b', title: '合成空幕', color: '#fff' }];
    p.elements = [
      { id: 'pre', type: 'general', text: '合成序言' },
      { id: 'pre-note', type: 'note', text: '不得统计的场前备忘' },
      { id: 's1', type: 'scene_heading', text: '内景 合成房间 日' },
      { id: 'a1', type: 'action', text: '<b>合成动作</b> hello world。' },
      { id: 'c1', type: 'character', text: '合成甲' },
      { id: 'd1', type: 'dialogue', text: '你好，world！' },
      { id: 'n1', type: 'note', text: '不应打断对白归属' },
      { id: 'd2', type: 'dialogue', text: '继续。' },
      { id: 'a2', type: 'action', text: '转身' },
      { id: 'd3', type: 'dialogue', text: '无人物归属' },
      { id: 'c2', type: 'character', text: '合成甲 (V.O.)' },
      { id: 'p1', type: 'parenthetical', text: '轻声' },
      { id: 'd4', type: 'dialogue', text: '第二次发言' },
      { id: 'omit-c', type: 'character', text: '合成隐藏人物', omit: true },
      { id: 'omit-d', type: 'dialogue', text: '不可进入统计', omit: true },
      { id: 's2', type: 'scene_heading', text: '外景 合成院落 夜' },
      { id: 'a-empty', type: 'action', text: '<br> ' },
      { id: 'n2', type: 'note', text: '合成待写' },
      { id: 's3', type: 'scene_heading', text: '内景 合成省略场 日', omit: true },
      { id: 's3-a', type: 'action', text: '整场省略后全部不计' },
      { id: 's3-c', type: 'character', text: '合成省略人物' },
      { id: 's3-d', type: 'dialogue', text: '不可进入统计' },
      { id: 's4', type: 'scene_heading', text: '外景 合成元数据省略场 晨' },
      { id: 's4-a', type: 'action', text: '元数据省略后也不计' },
      { id: 's5', type: 'scene_heading', text: '无法解析的合成场景' },
      { id: 'c5', type: 'character', text: '合成乙' },
      { id: 'd5', type: 'dialogue', text: '合成结尾' },
    ];
    p.sceneMeta = [
      { id: 'm1', elementId: 's1', title: '', synopsis: '合成故事信息', color: '#fff', actId: 'a' },
      { id: 'm2', elementId: 's2', title: '', synopsis: '', color: '#fff' },
      { id: 'm3', elementId: 's3', title: '', synopsis: '', color: '#fff', actId: 'a' },
      { id: 'm4', elementId: 's4', title: '', synopsis: '', color: '#fff', omit: true },
      { id: 'm5', elementId: 's5', title: '', synopsis: '', color: '#fff', actId: 'orphan' },
    ];
    p.beats = [{ id: 'image', kind: 'image', text: '合成卡片备注不计正文', title: '合成参考图', img: 'data:image/png;base64,c3ludGhldGlj', color: '#fff', x: 100, y: 100 }];
    p.boardLinks = [{ id: 'link', from: 'scene:s1', to: 'beat:image', note: '合成关系' }];
    return p;
  };
  const omitted = new Set(['pre-note', 'n1', 'n2', 'omit-c', 'omit-d', 's3', 's3-a', 's3-c', 's3-d', 's4', 's4-a']);
  const eligible = p => p.elements.filter(e => !omitted.has(e.id));
  const wordSum = elements => elements.reduce((sum, e) => sum + countWords(e.text), 0);
  const scene = (report, id) => report.scenes.find(s => s.id === id);
  const character = (report, name) => report.characters.find(c => c.name === name);
  let groups = 0;
  const check = (label, fn) => { fn(); groups++; console.log(`PASS ${label}`); };

  check('统一过滤整场省略、单段省略、备忘，元素比例使用同一分母', () => {
    const p = fixture(), report = buildReport(p);
    assert.deepEqual(report.scenes.map(s => s.id), ['s1', 's2', 's5']);
    assert.equal(report.words, wordSum(eligible(p)));
    assert.equal(report.elementTotal, eligible(p).length);
    assert.equal(Object.values(report.elementCounts).reduce((sum, value) => sum + value, 0), report.elementTotal);
    assert.equal(report.elementCounts.note || 0, 0);
    assert.equal(report.dialogueWords, wordSum(eligible(p).filter(e => e.type === 'dialogue')));
    assert.equal(report.actionWords, 8); // 四个中文 + 两个英语词 + 两个中文；空动作不增加字数。
    assert.equal(report.pages, null);
  });

  check('归幕字数与场景字数可核对，场前正文单列，失效幕归为未归幕', () => {
    const p = fixture(), report = buildReport(p);
    assert.equal(report.unscopedWords, 4);
    assert.equal(report.words, report.scenes.reduce((sum, s) => sum + s.words, 0) + report.unscopedWords);
    assert.equal(report.acts.find(a => a.id === 'a').words, scene(report, 's1').words);
    assert.equal(report.acts.find(a => a.id === 'a').scenes, 1);
    assert.equal(report.acts.find(a => a.id === 'b').scenes, 0);
    assert.equal(scene(report, 's5').actId, '');
    assert.equal(report.acts.find(a => a.id === '').words, scene(report, 's2').words + scene(report, 's5').words);
    assert.equal(report.acts.reduce((sum, a) => sum + a.words, 0), report.words - report.unscopedWords);
  });

  check('发言人物归一，同场重复计发言次数，但场数与矩阵不重复', () => {
    const report = buildReport(fixture()), a = character(report, '合成甲');
    assert.equal(report.characters.length, 2);
    assert.equal(a.lines, 2);
    assert.equal(a.words, 10); // 你好 world=3，继续=2，第二次发言=5。
    assert.deepEqual(a.scenes, ['s1']);
    assert.equal(a.byScene.s1, 2);
    assert.deepEqual(scene(report, 's1').characters, ['合成甲']);
    assert.equal(character(report, '合成乙').words, 4);
    assert.equal(character(report, '合成隐藏人物'), undefined);
    assert.equal(character(report, '合成省略人物'), undefined);
    assert.equal(report.dialogueWords - report.characters.reduce((sum, c) => sum + c.words, 0), 5, '未挂接人物的对白计总量、不虚构发言人');
  });

  check('备忘不打断对白归属，动作和跨场景会截止，空白人物不计人', () => {
    const p = fixture();
    p.elements.push({ id: 's6', type: 'scene_heading', text: '内景 合成新场 日' },
      { id: 's6-d', type: 'dialogue', text: '不可沿用上一场人物' },
      { id: 's6-c', type: 'character', text: ' ' }, { id: 's6-d2', type: 'dialogue', text: '空人物对白' });
    const report = buildReport(p);
    assert.equal(character(report, '合成乙').words, 4);
    assert.equal(report.characters.length, 2);
    assert.deepEqual(scene(report, 's6').characters, []);
    assert.equal(character(report, '合成甲').words, 10);
  });

  check('待处理项只描述事实，空白正文、梗概和备忘分开计数', () => {
    const report = buildReport(fixture());
    assert.equal(scene(report, 's1').empty, false);
    assert.equal(scene(report, 's1').missingSynopsis, false);
    assert.equal(scene(report, 's1').notes, 1);
    assert.equal(scene(report, 's2').empty, true);
    assert.equal(scene(report, 's2').missingSynopsis, true);
    assert.equal(scene(report, 's2').notes, 1);
    assert.equal(scene(report, 's5').empty, false);
  });

  check('正文页数按有效元素所在页去重，不含标题空页及仅省略/备忘页', () => {
    const page = ids => ({ items: [{ elements: ids.map(id => ({ id })) }] });
    const pages = [page([]), page(['pre']), page(['s1', 's1', 'a1']), page(['d1', 's2']), page(['s5', 'd5']), page(['n1', 's3-a', 'omit-d'])];
    const before = clone(pages), report = buildReport(fixture(), pages);
    assert.equal(report.pages, 4);
    assert.equal(scene(report, 's1').pages, 2);
    assert.equal(scene(report, 's2').pages, 1);
    assert.equal(scene(report, 's5').pages, 1);
    assert.deepEqual(pages, before);
    assert.equal(buildReport(fixture(), []).pages, 0);
  });

  check('估算阅读时长使用有效正文字数而非影视成片时长', () => {
    const p = fixture(), report = buildReport(p);
    assert.equal(report.readingSeconds, Math.round(report.words / 120 * 60));
    for (const speed of [0, -20, NaN, Infinity]) {
      p.settings.wordsPerMinute = speed;
      const seconds = buildReport(p).readingSeconds;
      assert.ok(Number.isFinite(seconds) && seconds >= 0);
    }
  });

  check('场景地点识别仅使用明确标题结构，未识别不瞎猜', () => {
    assert.deepEqual(parseSceneHeading('内景 合成房间 日'), { location: '合成房间', setting: '内景', time: '日' });
    assert.deepEqual(parseSceneHeading('外景 合成院落 夜'), { location: '合成院落', setting: '外景', time: '夜' });
    const unknown = parseSceneHeading('没有固定格式的合成标题');
    assert.equal(unknown.setting, '未识别');
    assert.equal(unknown.time, '未识别');
    assert.equal(unknown.location, '未识别');
    const english = parseSceneHeading('INT. SYNTHETIC ROOM - NIGHT');
    assert.equal(english.location, 'SYNTHETIC ROOM');
    assert.equal(english.setting, '内景');
    assert.notEqual(english.time, '未识别');
    assert.equal(parseSceneHeading('INT./EXT. SYNTHETIC CAR - DAY').setting, '内外景');
    const report = buildReport(fixture());
    for (const field of ['locations', 'settings', 'times']) {
      assert.equal(report[field].reduce((sum, row) => sum + row.count, 0), 3);
      assert.equal(report[field].find(row => row.name === '未识别').count, 1);
    }
  });

  check('空工程与只有备忘/省略正文时保持零值，不产生 NaN', () => {
    const p = fixture(); p.elements = []; p.sceneMeta = []; p.acts = [];
    let report = buildReport(p, []);
    for (const name of ['words', 'cjk', 'dialogueWords', 'actionWords', 'elementTotal', 'readingSeconds', 'unscopedWords', 'pages']) assert.equal(report[name], 0);
    assert.deepEqual(report.scenes, []); assert.deepEqual(report.characters, []);
    p.elements = [{ id: 'note-only', type: 'note', text: '合成备忘' }, { id: 'omitted-only', type: 'general', text: '合成省略', omit: true }];
    report = buildReport(p);
    assert.equal(report.words, 0); assert.equal(report.elementTotal, 0);
  });

  check('统计为只读派生，正文、设置、素材、关联、幕和元数据均不变', () => {
    const p = fixture(), before = clone(p);
    buildReport(p); buildReport(p);
    assert.deepEqual(p, before);
  });

  check('CSV 双引号、逗号和换行正确转义，公式前缀按纯文本导出', () => {
    assert.equal(reportCsvCell('合成,内容'), '"合成,内容"');
    assert.equal(reportCsvCell('合成"内容'), '"合成""内容"');
    assert.equal(reportCsvCell('合成\n内容'), '"合成\n内容"');
    assert.equal(reportCsvCell(42), '"42"');
    for (const text of ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1,2)', ' \t=1+1']) {
      assert.equal(reportCsvCell(text), `"'${text}"`, '不让人物名/场名在表格中执行为公式');
    }
  });

  check('人物/场景 ID 与对象原型同名仍可安全统计', () => {
    const p = fixture();
    p.elements = [{ id: '__proto__', type: 'scene_heading', text: '内景 合成房间 日' },
      { id: 'special-character', type: 'character', text: 'constructor' },
      { id: 'special-dialogue', type: 'dialogue', text: '合成发言' }];
    p.sceneMeta = [];
    const report = buildReport(p);
    assert.equal(character(report, 'constructor').byScene.__proto__, 1);
    assert.deepEqual(character(report, 'constructor').scenes, ['__proto__']);
    assert.equal(scene(report, '__proto__').characters[0], 'constructor');
  });

  check('统计样式仅在 screen 与自身作用域内，组件不读写存储或调用保存动作', () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    try {
      const style = dom.window.document.createElement('style');
      style.textContent = fs.readFileSync(path.join(__dirname, '../src/styles/reports.css'), 'utf8');
      dom.window.document.head.appendChild(style);
      assert.ok(style.sheet, 'CSS 可解析');
      // 只分顶层逗号，不能把 :is(.a, .b) 内的逗号误判为独立选择器。
      const selectors = value => {
        let depth = 0, quote = '', start = 0;
        const items = [];
        for (let i = 0; i < value.length; i++) {
          const c = value[i];
          if (quote) { if (c === quote && value[i - 1] !== '\\') quote = ''; continue; }
          if (c === '"' || c === "'") { quote = c; continue; }
          if (c === '(' || c === '[') depth++;
          if (c === ')' || c === ']') depth--;
          if (c === ',' && depth === 0) { items.push(value.slice(start, i)); start = i + 1; }
        }
        items.push(value.slice(start));
        return items;
      };
      let styles = 0;
      const visit = (rules, screenOnly = false) => {
        for (const rule of rules) {
          if (rule.type === dom.window.CSSRule.MEDIA_RULE) {
            const conditions = rule.media.mediaText.split(',');
            const mediaIsScreen = conditions.every(value => /^(?:only\s+)?screen(?:\s|$)/i.test(value.trim()));
            assert.ok(!conditions.some(value => /\b(?:print|speech)\b/i.test(value)), '不扩展到打印或其他输出');
            visit(rule.cssRules, screenOnly || mediaIsScreen);
          } else if (rule.type === dom.window.CSSRule.STYLE_RULE) {
            styles++;
            assert.ok(screenOnly, `不得全局/打印生效: ${rule.selectorText}`);
            for (const selector of selectors(rule.selectorText)) assert.match(selector, /\.reports--analysis(?:[\s.#:[>+~]|$)/, `越出统计作用域: ${selector}`);
          } else {
            assert.fail(`统计专用样式含未审查规则类型 ${rule.type}`);
          }
        }
      };
      visit(style.sheet.cssRules);
      assert.ok(styles > 0, '确实检查到样式而非空文件');
    } finally { dom.window.close(); }
    const source = fs.readFileSync(path.join(__dirname, '../src/components/ReportsView.tsx'), 'utf8');
    assert.match(source, /from\s+['"]\.\.\/model\/reports['"]/);
    assert.doesNotMatch(source, /from\s+['"][^'"]*model\/stats['"]/);
    assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB|serializeProject|parseProject|loadProject|saveProject|saveAs|saveFile|writeFile|writeFileSync)\b/);
  });

  check('现有统计角色改名真实 store 同步全部精确人物元素，一次撤销恢复', () => {
    const p = fixture();
    p.elements.find(e => e.id === 'c2').text = '合成甲';
    p.elements.find(e => e.id === 'a1').text = '合成甲出现在动作中但不应自动替换';
    useStore.getState().loadProject(p);
    useStore.setState({ past: [], future: [] });
    const state = () => useStore.getState(), before = clone(state().project);
    assert.equal(state().renameCharacter('合成甲', '合成改名'), true);
    assert.equal(state().past.length, 1);
    for (const id of ['c1', 'c2']) assert.equal(state().project.elements.find(e => e.id === id).text, '合成改名');
    assert.equal(state().project.elements.find(e => e.id === 'a1').text, before.elements.find(e => e.id === 'a1').text);
    assert.equal(character(buildReport(state().project), '合成改名').lines, 2);
    assert.equal(character(buildReport(state().project), '合成甲'), undefined);
    assert.deepEqual(state().project.beats, before.beats); assert.deepEqual(state().project.boardLinks, before.boardLinks);
    const after = clone(state().project);
    state().undo(); assert.deepEqual(state().project, before);
    state().redo(); assert.deepEqual(state().project, after);
    assert.equal(state().renameCharacter('合成改名', '合成乙'), false, '不覆盖已有名字');
    assert.equal(state().renameCharacter('合成改名', ' '), false, '不允许空名字');
  });

  check('精确人物变体可以单独改名并撤销，不误改同名基本形式', () => {
    useStore.getState().loadProject(fixture());
    useStore.setState({ past: [], future: [] });
    const state = () => useStore.getState(), before = clone(state().project);
    assert.equal(state().renameCharacter('合成甲 (V.O.)', '合成改名 (V.O.)'), true);
    assert.equal(state().project.elements.find(e => e.id === 'c2').text, '合成改名 (V.O.)');
    assert.equal(state().project.elements.find(e => e.id === 'c1').text, '合成甲');
    assert.equal(state().past.length, 1);
    assert.equal(character(buildReport(state().project), '合成改名').lines, 1);
    assert.equal(character(buildReport(state().project), '合成甲').lines, 1);
    state().undo();
    assert.deepEqual(state().project, before);
    assert.equal(character(buildReport(state().project), '合成甲').lines, 2);
  });
  console.log(`reports: ${groups}/${groups} groups passed (synthetic data only)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
