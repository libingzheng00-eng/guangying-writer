/** Read-only derived-state equivalence and cache invalidation. Synthetic data only.
 * Timings below cover Node model helpers, never DOM/input/IME latency.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');

(async () => {
  const result = await require('esbuild').build({
    stdin: { contents: `export { shouldShowContdSuffix, deriveWritingElements, nextTypeOnTab } from './src/model/flow';
      export { buildSmartTypeCatalog, createSmartTypeCatalogReader, getSmartTypeSuggestions } from './src/model/smarttype';`,
      resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
  });
  const mod = new Module(path.join(root, '.writing-derivation-memory.cjs'), module);
  mod.filename = path.join(root, '.writing-derivation-memory.cjs');
  mod.paths = Module._nodeModulePaths(root);
  mod._compile(result.outputFiles[0].text, mod.filename);
  const api = mod.exports;
  let groups = 0, assertions = 0;
  const check = (label, run) => { run(); groups++; console.log(`PASS ${label}`); };
  const same = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
  const el = (id, text = '合成文字', type = 'action', extra = {}) => ({ id, text, type, ...extra });
  const equivalence = (elements) => {
    const before = JSON.stringify(elements);
    const derived = api.deriveWritingElements(elements);
    for (const element of elements) {
      same(derived.indexByElement.get(element), elements.indexOf(element), 'first-reference indexOf semantics');
      for (const enabled of [undefined, true, false]) same(
        enabled !== false && derived.contdCharacters.has(element),
        api.shouldShowContdSuffix({ elements, settings: { contdCharacter: enabled } }, element),
        `legacy CONT'D equivalence: ${element.id}`,
      );
    }
    same(JSON.stringify(elements), before, 'derivation is read-only');
    assert.equal(api.deriveWritingElements(elements), derived, 'same immutable array shares visible/measurement derivation');
    return derived;
  };

  check('60-position lookback remains exact including all intervening element kinds', () => {
    for (const distance of [1, 59, 60, 61, 80]) {
      const rows = [el('first', '合成甲', 'character'),
        ...Array.from({ length: distance - 1 }, (_, i) => el(`gap-${i}`, '不省略计距', i % 2 ? 'note' : 'dialogue', { omit: true })),
        el('last', '合成甲', 'character')];
      const derived = equivalence(rows);
      same(derived.contdCharacters.has(rows.at(-1)), distance <= 60, `distance ${distance}`);
    }
  });
  check('barriers, empty/dual/manual predecessors and normalized names retain original semantics', () => {
    const rows = [el('a', '<b>合成甲</b>', 'character'), el('b', '合成甲（V.O.）:', 'character'),
      el('c', '合成甲', 'character', { dual: 'left' }), el('d', '合成甲', 'character'),
      el('e', '', 'character'), el('f', '合成甲', 'character'),
      el('g', "合成甲 (CONT'D)", 'character'), el('h', '合成甲', 'character'),
      el('i', '合成甲CONT’D', 'character'), el('j', '合成乙', 'character'),
      el('k', '合成甲', 'character'), el('act', '第一幕', 'act'), el('l', '合成甲', 'character'),
      el('m', '合成甲', 'character'), el('scene', '内景 合成空间 日', 'scene_heading'), el('n', '合成甲', 'character')];
    equivalence(rows);
  });
  check('duplicate IDs and repeated object references retain first-index behavior', () => {
    const repeat = el('same-id', '合成甲', 'character');
    equivalence([repeat, el('gap'), el('same-id', '合成甲', 'character'), repeat, el('final', '合成甲', 'character')]);
    const later = el('later', '合成甲', 'character');
    equivalence([el('first', '合成甲', 'character'), later, el('change', '合成乙', 'character'), later]);
  });
  check('deterministic randomized oracle comparison and immutable update/undo invalidation', () => {
    let seed = 73421;
    const random = (limit) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % limit; };
    const types = ['action', 'dialogue', 'parenthetical', 'general', 'note', 'character', 'character', 'scene_heading', 'act'];
    const names = ['合成甲', '合成乙', '', '<b>合成甲</b>（V.O.）', "合成甲 (CONT'D)", '合成甲:', '合成甲CONT’D'];
    for (let trial = 0; trial < 120; trial++) {
      const rows = Array.from({ length: 100 }, (_, i) => el(`trial-${trial}-${i}`, names[random(names.length)], types[random(types.length)],
        { ...(random(10) === 0 ? { dual: 'left', dualGroup: 'g' } : {}), ...(random(8) === 0 ? { omit: true } : {}) }));
      rows.forEach(Object.freeze); Object.freeze(rows);
      const original = equivalence(rows);
      const updated = [...rows]; updated[49] = el('changed', '合成乙', 'character');
      assert.notEqual(equivalence(updated), original);
      same(api.deriveWritingElements(rows), original, 'undo snapshot remains reusable');
    }
  });

  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.document = dom.window.document;
  try {
    check('SmartType cache preserves all catalogs while invalidating actual sources and document load', () => {
      const reader = api.createSmartTypeCatalogReader();
      let rows = [el('c1', '<b>合成甲</b>（旁白）', 'character'), el('c2', '合成乙', 'character'),
        el('s1', '内景 合成大厅 日', 'scene_heading'), el('s2', 'INT. TEST ROOM - NIGHT', 'scene_heading'),
        el('t', '合成切至:', 'transition'), el('shot', '合成镜头', 'shot'), el('a'), el('d', '合成对白', 'dialogue')];
      const read = (active = 'a', epoch = 1) => {
        const actual = reader({ elements: rows }, active, epoch);
        same(actual, api.buildSmartTypeCatalog({ elements: rows }, active), 'catalog oracle equivalence');
        return actual;
      };
      const baseline = read();
      rows = rows.map(row => row.id === 'a' ? { ...row, text: '<i>新合成动作</i>' } : row);
      same(read(), baseline, 'ordinary input does not rebuild catalog');
      assert.equal(read('d'), baseline, 'switch between non-source paragraphs does not rebuild');
      const excluded = read('c1'); assert.notEqual(excluded, baseline);
      same(excluded.characters, ['合成乙'], 'active character excluded');
      rows = rows.map(row => row.id === 'c1' ? { ...row, text: '合成改名甲' } : row);
      assert.equal(read('c1'), excluded, 'editing excluded vocabulary line does not rebuild other sources');
      const renamed = read(); assert.notEqual(renamed, baseline);
      same(renamed.characters, ['合成改名甲', '合成乙'], 'rename visible after focus moves');
      const beforeDelete = rows;
      rows = rows.filter(row => row.id !== 's1'); const removed = read();
      same(removed.locations.includes('合成大厅'), false, 'deleted heading leaves vocabulary');
      rows = beforeDelete; const undone = read();
      same(undone.locations.includes('合成大厅'), true, 'undo restores heading source');
      rows = rows.map(row => row.id === 'a' ? { ...row, type: 'character', text: '新合成角色' } : row);
      same(read('d').characters.includes('新合成角色'), true, 'Tab source type entry invalidates');
      rows = rows.map(row => row.id === 'a' ? { ...row, type: 'action' } : row);
      same(read().characters.includes('新合成角色'), false, 'Tab source type exit invalidates');
      const previous = read(); const reloaded = read('a', 2);
      assert.notEqual(reloaded, previous, 'same-ID document load epoch resets reader');
      const beforeReorder = rows; rows = [...rows].reverse();
      same(read().characters, ['合成乙', '合成改名甲'], 'vocabulary preserves first-occurrence order');
      rows = beforeReorder.map(row => ({ ...row })); const cloned = read();
      rows = rows.map(row => ({ ...row, omit: true }));
      assert.equal(read(), cloned, 'non-vocabulary fields do not force parser work');
      rows.find(row => row.id === 'c1').text = '测试原地修改';
      same(read().characters[0], '测试原地修改', 'signature guards mutable caller text');
      rows.push(el('c1', '同ID另一来源', 'character'));
      same(read('c1').characters, ['合成乙'], 'all duplicate active IDs excluded as original builder');
      const separateReader = api.createSmartTypeCatalogReader();
      const separate = separateReader({ elements: rows }, 'a', 2);
      same(separate, read('a', 2), 'independent reader content agrees');
      assert.notEqual(separate, read('a', 2), 'readers do not share cross-document mutable catalogs');
    });
    check('ordinary input and repeated reads do not reproject unchanged vocabulary HTML', () => {
      let projections = 0;
      const originalCreate = document.createElement.bind(document);
      document.createElement = (name, ...args) => { if (name === 'template') projections++; return originalCreate(name, ...args); };
      try {
        const reader = api.createSmartTypeCatalogReader();
        const character = el('cached-character', '<b>独立缓存角色</b>', 'character');
        let rows = [character, el('typing')];
        const first = reader({ elements: rows }, 'typing', 12);
        same(projections, 1, 'first source projected');
        for (let i = 0; i < 25; i++) {
          rows = [character, el('typing', `普通合成输入${i}`)];
          assert.equal(reader({ elements: rows }, 'typing', 12), first);
        }
        same(projections, 1, 'ordinary input parses no additional HTML');
        rows = [{ ...character, text: '<b>独立缓存角色乙</b>' }, rows[1]];
        same(reader({ elements: rows }, 'typing', 12).characters, ['独立缓存角色乙'], 'new source content visible');
        same(projections, 2, 'only new vocabulary source is projected');
      } finally { document.createElement = originalCreate; }
    });
  } finally { delete global.document; dom.window.close(); }

  check('Editor and measurement renderer use the same projection without changing pagination/Tab', () => {
    const editor = fs.readFileSync(path.join(root, 'src/components/Editor.tsx'), 'utf8');
    const pagination = fs.readFileSync(path.join(root, 'src/hooks/PaginationProvider.tsx'), 'utf8');
    assert.ok(editor.includes('deriveWritingElements(project.elements)'));
    assert.ok(pagination.includes('deriveWritingElements(project.elements)'));
    assert.ok(!editor.includes('project.elements.indexOf(e)'));
    assert.ok(!editor.includes('shouldShowContdSuffix(project, el)'));
    assert.ok(!pagination.includes('shouldShowContdSuffix(project, e)'));
    assert.ok(editor.includes('readSmartTypeCatalog(project, activeId || undefined, documentEpoch)'));
    assert.ok(pagination.includes('}, 180);'), 'measurement scheduling retained');
    const cycle = ['action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'scene_heading', 'general', 'note'];
    same(cycle.map(type => api.nextTypeOnTab(type)), [...cycle.slice(1), cycle[0]], 'nine-type Tab unchanged');
    same(cycle.map(type => api.nextTypeOnTab(type, true)), [cycle.at(-1), ...cycle.slice(0, -1)], 'reverse cycle unchanged');
  });

  const timed = (run) => { const start = performance.now(); const value = run(); return { ms: performance.now() - start, value }; };
  const longRows = Array.from({ length: 3600 }, (_, i) => el(`long-${i}`, i % 3 === 0 ? '合成性能人物' : `合成动作${i}`, i % 3 === 0 ? 'character' : 'action'));
  const baseline = timed(() => longRows.map(row => [longRows.indexOf(row), api.shouldShowContdSuffix({ elements: longRows, settings: {} }, row)]));
  const optimized = timed(() => {
    const derived = api.deriveWritingElements(longRows);
    return longRows.map(row => [derived.indexByElement.get(row), derived.contdCharacters.has(row)]);
  });
  same(optimized.value, baseline.value, 'long-script derivative output exactly equivalent');
  const longCatalogRows = Array.from({ length: 2400 }, (_, i) => el(`catalog-${i}`,
    i % 4 === 0 ? `内景 合成地点${i} 日` : i % 4 === 1 ? `合成角色${i}` : '普通合成输入',
    i % 4 === 0 ? 'scene_heading' : i % 4 === 1 ? 'character' : 'dialogue'));
  const reader = api.createSmartTypeCatalogReader(); reader({ elements: longCatalogRows }, 'typing', 1);
  const oldCatalog = timed(() => { for (let i = 0; i < 12; i++) api.buildSmartTypeCatalog({ elements: [...longCatalogRows, el('typing', `合成${i}`)] }, 'typing'); });
  const cachedCatalog = timed(() => { for (let i = 0; i < 12; i++) reader({ elements: [...longCatalogRows, el('typing', `合成${i}`)] }, 'typing', 1); });
  console.log(`MODEL-ONLY timings (not browser input latency): 3600 elements legacy index/CONT'D ${baseline.ms.toFixed(2)}ms; linear ${optimized.ms.toFixed(2)}ms.`);
  console.log(`MODEL-ONLY timings: 12 ordinary edits / 1200 vocabulary rows rebuild ${oldCatalog.ms.toFixed(2)}ms; source-signature reuse ${cachedCatalog.ms.toFixed(2)}ms.`);
  console.log(`=== writing derivation ${groups}/${groups} groups, ${assertions} equivalence assertions PASS ===`);
})().catch(error => { console.error(error); process.exitCode = 1; });
