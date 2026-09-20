/** 正文查找：仅合成数据，内存构建，不读取工程或写入用户目录。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');

(async () => {
  const built = await esbuild.build({
    entryPoints: [path.join(__dirname, 'search.entry.ts')],
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2020',
    logLevel: 'silent',
  });
  const testModule = new Module(path.join(__dirname, 'search-test.bundle.cjs'), module);
  testModule.filename = path.join(__dirname, 'search-test.bundle.cjs');
  testModule.paths = Module._nodeModulePaths(__dirname);
  testModule._compile(built.outputFiles[0].text, testModule.filename);
  const { searchScript, searchText } = testModule.exports;
  let count = 0;
  const check = (label, actual, expected) => {
    assert.deepEqual(actual, expected, label);
    count++;
    console.log(`  ✓ ${label}`);
  };
  const el = (id, text, type = 'action', extra = {}) => ({ id, text, type, ...extra });
  const hits = (rows, query, opts) => searchScript(rows, query, opts).map(({ elementId, start, end }) => [elementId, start, end]);
  const projectionCases = [
    ['<p>甲</p><div>乙<br>丙</div>', '甲乙\n丙'],
    ['&#65;&#x1F3AC;&#27979;&#35797;', 'A🎬测试'],
    ['&amp;#65;&lt;b&gt;&nbsp;', '&#65;<b>\u00a0'],
    ['<b>甲</b><i>乙</i><!--不显示-->丙', '甲乙丙'],
  ];
  for (const [html, expected] of projectionCases) check('无DOM兜底按文本/BR计偏移', searchText(html), expected);
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.document = dom.window.document;
  for (const [html, expected] of projectionCases) check('DOM投影正确解码且与兜底一致', searchText(html), expected);
  check('空列表无命中', searchScript([], '测试'), []);
  check('空查询无命中', searchScript([el('a', '测试')], ''), []);
  check('中文多次命中与正文顺序', hits([el('a', '测试段测试'), el('b', '测试')], '测试'), [['a', 0, 2], ['a', 3, 5], ['b', 0, 2]]);
  check('默认英文忽略大小写', hits([el('a', 'Find find FIND')], 'find'), [['a', 0, 4], ['a', 5, 9], ['a', 10, 14]]);
  check('可区分英文大小写', hits([el('a', 'Find find FIND')], 'find', { caseSensitive: true }), [['a', 5, 9]]);
  check('特殊正则字符仅按字面搜索', hits([el('a', 'a.*[x](y)?+$^{}|\\ z')], '.*[x](y)?+$^{}|\\'), [['a', 1, 17]]);
  check('空格查询按原文匹配，不修剪用户查询', hits([el('a', '甲  乙')], '  '), [['a', 1, 3]]);
  check('不跨段落拼接搜索', searchScript([el('a', '甲'), el('b', '乙')], '甲乙'), []);
  check('重叠文本按非重叠命中', hits([el('a', 'aaaaa')], 'aa'), [['a', 0, 2], ['a', 2, 4]]);
  check('富文本跨标签命中', hits([el('a', '<b>合成</b><i>测试</i>')], '成测'), [['a', 1, 3]]);
  check('HTML实体与plain一致', hits([el('a', '&lt;A&amp;B&gt;&nbsp;&quot;x&quot;&#39;')], 'A&B'), [['a', 1, 4]]);
  check('换行仅BR计1，块标签不额外计字', hits([el('a', '甲<br>乙<div>丙</div>丁')], '甲\n乙丙丁'), [['a', 0, 5]]);
  check('numeric entity按解码后的UTF16定位', hits([el('a', '&#x1F3AC;&#27979;&#35797;')], '测试'), [['a', 2, 4]]);
  check('不命中HTML标签本身', searchScript([el('a', '<b>正文</b>')], '<b>'), []);
  check('UTF16偏移保留emoji长度', hits([el('a', '🎬测试🎬')], '测试'), [['a', 2, 4]]);
  check('Unicode大小写处理不移动后续偏移', hits([el('a', 'İABC 测试')], 'abc'), [['a', 1, 4]]);
  check('双列返回各列自己的稳定ID', hits([el('left', '合成对白', 'dialogue', { dual: 'left', dualGroup: 'du' }), el('right', '合成对白', 'dialogue', { dual: 'right', dualGroup: 'du' })], '对白'), [['left', 2, 4], ['right', 2, 4]]);
  const types = ['act', 'scene_heading', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'general', 'note'];
  check('所有正文类型与备忘都可查找', searchScript(types.map((type) => el(type, '合成文字', type)), '合成').map((m) => m.type), types);
  check('省略段不静默丢失查找入口', hits([el('omit', '合成文字', 'action', { omit: true })], '文字'), [['omit', 2, 4]]);
  const snippet = searchScript([el('a', '012345合成测试678901')], '测试', { contextLength: 2 })[0];
  check('上下文窗口及高亮相对偏移', [snippet.snippet, snippet.snippetStart, snippet.start - snippet.snippetStart, snippet.end - snippet.snippetStart], ['合成测试67', 6, 2, 4]);
  check('上下文长度零只含命中文字', searchScript([el('a', '甲测试乙')], '测试', { contextLength: 0 })[0].snippet, '测试');
  check('上下文不切开emoji代理对', searchScript([el('a', '🎬测🎬')], '测', { contextLength: 1 })[0].snippet, '🎬测🎬');
  check('非法上下文长度安全回退', searchScript([el('a', '甲测试乙')], '测试', { contextLength: NaN })[0].snippet, '甲测试乙');
  const frozen = Object.freeze([Object.freeze(el('safe', '<b>测试</b>测试'))]);
  const before = JSON.stringify(frozen);
  searchScript(frozen, '测试');
  check('冻结输入不被修改', JSON.stringify(frozen), before);
  const html = '<b>甲</b>&amp;<div>乙<br>丙</div>';
  for (const result of searchScript([el('a', html)], '乙\n丙')) {
    check('定位片段可从DOM投影准确回取', searchText(html).slice(result.start, result.end), '乙\n丙');
  }
  delete global.document;
  dom.window.close();
  console.log(`\n=== search ${count}/${count} PASS ===`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
