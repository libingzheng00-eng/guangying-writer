/** Synthetic annotation admission/anchors. Memory-only build; no user data. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
let checks = 0;
const check = (label, actual, expected = true) => {
  assert.deepEqual(actual, expected, label);
  checks++;
  console.log(`PASS ${label}`);
};

(async () => {
  const built = await esbuild.build({
    stdin: { contents: `export * from './src/model/annotations';`, resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  const filename = path.join(repo, '.annotations-memory.cjs');
  const bundle = new Module(filename, module);
  bundle.filename = filename;
  bundle.paths = Module._nodeModulePaths(repo);
  bundle._compile(built.outputFiles[0].text, filename);
  const { validateAnnotations, validateAnnotationAnchor, reconcileAnnotations, captureTextAnchor,
    captureSceneAnchor, reanchorAnnotation, MAX_ANNOTATIONS, MAX_ANNOTATIONS_BYTES } = bundle.exports;
  const el = (id, text, type = 'action') => ({ id, text, type });
  const a = el('synthetic-a', '<b>合成</b>正文');
  const scene = el('synthetic-scene', '内景 合成空间 日', 'scene_heading');
  const annotation = (patch = {}) => ({ id: 'synthetic-note', createdAt: 10, updatedAt: 20,
    body: '合成批注意见', status: 'pending', anchor: captureTextAnchor(a, 0, 2), anchorState: 'current', ...patch });
  const rejects = (label, value) => {
    let error;
    try { validateAnnotations(value); } catch (caught) { error = caught; }
    check(label, error instanceof Error && error.message === '批注数据无效或超过容量限制。');
  };
  check('missing legacy annotations are empty', validateAnnotations(undefined), []);
  check('empty collection is valid', validateAnnotations([]), []);
  const original = annotation({ reason: '保留的原因', decision: '保留的处理意见' });
  const admitted = validateAnnotations([original]);
  check('valid annotation roundtrips every field', admitted, [original]);
  check('admission copies annotation and anchor', admitted[0] !== original && admitted[0].anchor !== original.anchor);
  for (const status of ['pending', 'resolved', 'declined']) {
    check(`valid ${status} status is retained`, validateAnnotations([annotation({ status, reason: '合成原因' })])[0].status, status);
  }
  for (const anchorState of ['current', 'changed', 'missing']) {
    check(`valid ${anchorState} anchor state is retained`, validateAnnotations([annotation({ anchorState })])[0].anchorState, anchorState);
  }
  const nullRecord = Object.assign(Object.create(null), original);
  check('plain null-prototype data is accepted', validateAnnotations([nullRecord]), [original]);
  for (const value of [null, {}, 'sensitive-invalid-value', 1, true, [null], [[]], [new Date()], new Array(1)]) rejects('invalid collection/item shape', value);
  for (const patch of [
    { id: '' }, { id: ' '.repeat(3) }, { id: 'x'.repeat(513) }, { body: '' }, { body: ' \n ' }, { body: 'x'.repeat(20_001) },
    { body: 7 }, { createdAt: NaN }, { updatedAt: Infinity }, { createdAt: -1 }, { createdAt: 0.5 },
    { updatedAt: 9 }, { createdAt: Number.MAX_SAFE_INTEGER + 1 }, { status: 'accepted' }, { anchorState: 'orphan' },
    { status: 'declined' }, { status: 'declined', reason: ' \n ' }, { reason: null }, { decision: 3 },
    { reason: 'x'.repeat(20_001) }, { decision: 'x'.repeat(20_001) }, { anchor: null },
    { extra: 'sensitive-extra' },
  ]) rejects('invalid annotation field is rejected generically', [annotation(patch)]);
  rejects('duplicate annotation IDs are rejected', [annotation(), annotation()]);
  let getterCalls = 0;
  const getter = annotation();
  Object.defineProperty(getter, 'body', { enumerable: true, get() { getterCalls++; throw new Error('sensitive-getter'); } });
  rejects('accessor object rejected without reading it', [getter]);
  check('annotation getter never executes', getterCalls, 0);
  const getterArray = [];
  Object.defineProperty(getterArray, '0', { enumerable: true, get() { getterCalls++; throw new Error('sensitive-getter'); } });
  rejects('accessor array rejected without reading it', getterArray);
  check('array getter never executes', getterCalls, 0);
  rejects('inherited annotation fields rejected', [Object.create(original)]);
  rejects('prototype pollution key rejected', [JSON.parse(JSON.stringify(original).replace('"id":', '"__proto__":{"polluted":true},"id":'))]);
  const cyclic = annotation(); cyclic.anchor = cyclic;
  rejects('cyclic shape rejected generically', [cyclic]);
  const withToJSON = annotation({ toJSON() { throw new Error('sensitive-toJSON'); } });
  rejects('toJSON hook is rejected', [withToJSON]);
  const withSymbol = annotation(); withSymbol[Symbol('sensitive')] = 1;
  rejects('symbol fields are rejected', [withSymbol]);
  for (const patch of [
    { kind: 'other' }, { elementId: '' }, { start: -1 }, { start: 0.5 }, { end: Infinity }, { end: 0 },
    { end: 100 }, { quote: '不匹配' }, { sourceText: '不匹配' }, { sourceText: 'x'.repeat(200_001) }, { extra: 'hidden' },
  ]) rejects('invalid text anchor rejected', [annotation({ anchor: { ...original.anchor, ...patch } })]);
  rejects('scene anchor cannot contain text fields', [annotation({ anchor: { kind: 'scene', elementId: scene.id, start: 0 } })]);
  check('single anchor validator copies safe scene anchor', validateAnnotationAnchor({ kind: 'scene', elementId: scene.id }), { kind: 'scene', elementId: scene.id });

  const atLimit = Array.from({ length: MAX_ANNOTATIONS }, (_, i) => annotation({ id: `synthetic-${i}` }));
  check('500 annotations are admitted', validateAnnotations(atLimit).length, 500);
  rejects('501 annotations exceed count cap', [...atLimit, annotation({ id: 'synthetic-over' })]);
  const bytesFixture = Array.from({ length: 60 }, (_, i) => annotation({ id: `bytes-${i}`, body: 'x' }));
  const baseBytes = Buffer.byteLength(JSON.stringify(bytesFixture));
  let remaining = MAX_ANNOTATIONS_BYTES - baseBytes;
  for (const item of bytesFixture) {
    const extra = Math.min(19_999, remaining);
    item.body += 'x'.repeat(extra);
    remaining -= extra;
  }
  check('boundary fixture reaches exact UTF8 JSON cap', [remaining, Buffer.byteLength(JSON.stringify(bytesFixture))], [0, MAX_ANNOTATIONS_BYTES]);
  check('exact 1MiB total is admitted', validateAnnotations(bytesFixture).length, bytesFixture.length);
  bytesFixture[bytesFixture.length - 1].body += 'x';
  rejects('one UTF8 byte beyond total is rejected', bytesFixture);
  const unicodeCapacity = Array.from({ length: 20 }, (_, i) => annotation({ id: `unicode-${i}`, body: '中'.repeat(20_000) }));
  check('UTF8 capacity case is below cap in UTF16 but above in bytes', JSON.stringify(unicodeCapacity).length < MAX_ANNOTATIONS_BYTES && Buffer.byteLength(JSON.stringify(unicodeCapacity)) > MAX_ANNOTATIONS_BYTES);
  rejects('capacity uses UTF8 bytes', unicodeCapacity);
  const escapedCapacity = Array.from({ length: 10 }, (_, i) => annotation({ id: `escaped-${i}`, body: '\u0000'.repeat(20_000) + 'a' }));
  // Keep each body within its limit while JSON escaping makes the total too large.
  escapedCapacity.forEach(item => { item.body = item.body.slice(1); });
  rejects('capacity includes JSON escape overhead', escapedCapacity);

  const projection = el('synthetic-projection', '<b>甲</b>&amp;#65;<br>&#x1F3AC;<i>乙</i>');
  const expectedSource = '甲&#65;\n🎬乙';
  const projectionChecks = label => {
    check(`${label} capture preserves UTF16 BR/entity projection`, captureTextAnchor(projection, 6, 9), {
      kind: 'text', elementId: projection.id, start: 6, end: 9, quote: '\n🎬', sourceText: expectedSource,
    });
    for (const [start, end] of [[0, 0], [-1, 2], [0, 11], [2, 1], [NaN, 3], [0.5, 2], [7, 8], [8, 9]]) {
      check(`${label} invalid/empty/split-surrogate range returns null`, captureTextAnchor(projection, start, end), null);
    }
    check(`${label} whitespace selection is still explicit nonempty text`, captureTextAnchor(el('space', '甲  乙'), 1, 3).quote, '  ');
  };
  projectionChecks('SSR');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.document = dom.window.document;
  projectionChecks('DOM');
  check('scene capture accepts stable heading ID', captureSceneAnchor(scene), { kind: 'scene', elementId: scene.id });
  check('scene capture rejects nonheading', captureSceneAnchor(a), null);
  check('capture refuses invalid ID', captureTextAnchor(el('', '合成正文'), 0, 2), null);
  check('capture accepts longest valid legacy element ID', captureTextAnchor(el('x'.repeat(512), '合成正文'), 0, 2)?.elementId, 'x'.repeat(512));
  check('capture rejects element ID above legacy limit', captureTextAnchor(el('x'.repeat(513), '合成正文'), 0, 2), null);

  const frozenAnchor = Object.freeze(original.anchor);
  const frozenAnnotation = Object.freeze({ ...original, anchor: frozenAnchor });
  const notes = Object.freeze([frozenAnnotation]);
  const beforeElements = Object.freeze([Object.freeze(a), Object.freeze(scene)]);
  const saved = JSON.stringify({ beforeElements, notes });
  check('unchanged anchors retain exact array identity', reconcileAnnotations(beforeElements, beforeElements, notes) === notes);
  const formatted = [el(a.id, '<i>合成正</i><b>文</b>'), scene];
  check('pure formatting does not stale text anchor', reconcileAnnotations(beforeElements, formatted, notes) === notes);
  check('text anchor survives type-only change', reconcileAnnotations(beforeElements, [{ ...a, type: 'dialogue' }, scene], notes) === notes);
  check('reordering does not stale anchors', reconcileAnnotations(beforeElements, [scene, a], notes) === notes);
  check('unrelated paragraph edit does not stale anchor', reconcileAnnotations(beforeElements, [a, { ...scene, text: '外景 合成空间 夜' }], notes) === notes);
  for (const html of ['前合成正文', '合成正文后', '合成修改正文', '合成', '别的内容']) {
    const result = reconcileAnnotations(beforeElements, [el(a.id, html), scene], notes);
    check('any target plain text change becomes changed', result[0].anchorState, 'changed');
    check('stale transition preserves all author data and timestamp', { ...result[0], anchorState: 'current' }, frozenAnnotation);
    check('changed annotation shares original anchor data', result[0].anchor === frozenAnchor);
  }
  const repeated = el('repeated', '合成合成合成');
  const repeatedNote = annotation({ anchor: captureTextAnchor(repeated, 2, 4) });
  const repeatedAfter = el(repeated.id, '合成合成');
  check('repeated quote is not silently found at another occurrence', reconcileAnnotations([repeated], [repeatedAfter], [repeatedNote])[0], { ...repeatedNote, anchorState: 'changed' });
  const sourceMismatch = annotation({ anchor: captureTextAnchor(el(a.id, '旧的正文'), 0, 2) });
  check('sourceText mismatch detects already stale current anchor', reconcileAnnotations([a], [a], [sourceMismatch])[0].anchorState, 'changed');
  const sourceMatchesAfter = annotation({ anchor: captureTextAnchor(el(a.id, '新的正文'), 0, 2) });
  check('before/after change is detected even if sourceText matches after', reconcileAnnotations([a], [el(a.id, '新的正文')], [sourceMatchesAfter])[0].anchorState, 'changed');
  const changed = reconcileAnnotations(beforeElements, [el(a.id, '新的正文'), scene], notes);
  check('changed does not revive when original text returns', reconcileAnnotations([el(a.id, '新的正文'), scene], beforeElements, changed) === changed);
  const missing = reconcileAnnotations(beforeElements, [scene], notes);
  check('deleted target becomes missing', missing[0].anchorState, 'missing');
  check('changed target deletion becomes missing', reconcileAnnotations([el(a.id, '新的正文'), scene], [scene], changed)[0].anchorState, 'missing');
  check('missing does not revive when same ID and text return', reconcileAnnotations([scene], beforeElements, missing) === missing);
  check('other identical paragraph cannot take over deleted anchor', reconcileAnnotations([a], [el('different-id', a.text)], notes)[0].anchorState, 'missing');
  const sceneNote = annotation({ anchor: captureSceneAnchor(scene) });
  check('scene anchor survives heading text edit', reconcileAnnotations([scene], [{ ...scene, text: '外景 另一合成空间 夜' }], [sceneNote])[0] === sceneNote);
  const sceneGone = reconcileAnnotations([scene], [{ ...scene, type: 'action' }], [sceneNote]);
  check('scene type change becomes missing', sceneGone[0].anchorState, 'missing');
  check('scene heading type restoration does not auto revive', reconcileAnnotations([{ ...scene, type: 'action' }], [scene], sceneGone) === sceneGone);
  check('scene deletion becomes missing', reconcileAnnotations([scene], [], [sceneNote])[0].anchorState, 'missing');
  check('all input text and historical annotations remain untouched', JSON.stringify({ beforeElements, notes }), saved);
  const mixed = [frozenAnnotation, sceneNote];
  const mixedAfter = reconcileAnnotations(beforeElements, [el(a.id, '新正文'), scene], mixed);
  check('reconcile copies only changed records', mixedAfter !== mixed && mixedAfter[0] !== mixed[0] && mixedAfter[1] === mixed[1]);

  // Project history restores snapshots. It must not recompute stale->current.
  const initialSnapshot = Object.freeze({ elements: beforeElements, annotations: notes });
  const nextElements = Object.freeze([scene]);
  const deletedSnapshot = Object.freeze({ elements: nextElements, annotations: reconcileAnnotations(beforeElements, nextElements, notes) });
  let current = deletedSnapshot;
  current = initialSnapshot;
  check('snapshot undo restores exact original anchor and record', current.annotations === notes && current.annotations[0].anchorState === 'current');
  current = deletedSnapshot;
  check('snapshot redo restores exact missing state', current.annotations === deletedSnapshot.annotations && current.annotations[0].anchorState === 'missing');
  const replacementAnchor = captureTextAnchor(el('explicit-target', '明确重选文字'), 0, 4);
  const reanchored = reanchorAnnotation({ ...missing[0], status: 'declined', reason: '保留原因', decision: '保留处理' }, replacementAnchor, 30);
  check('explicit reanchor restores current and preserves review state', reanchored, {
    ...missing[0], status: 'declined', reason: '保留原因', decision: '保留处理', anchor: replacementAnchor, anchorState: 'current', updatedAt: 30,
  });
  check('explicit reanchor copies anchor rather than owning caller data', reanchored.anchor !== replacementAnchor);
  check('explicit reanchor leaves previous record untouched', missing[0].anchorState, 'missing');
  check('reanchored result passes admission', validateAnnotations([reanchored]), [reanchored]);
  assert.throws(() => reanchorAnnotation(original, replacementAnchor, NaN), /批注数据无效或超过容量限制。/); checks++;
  delete global.document;
  dom.window.close();
  console.log(`annotations: ${checks} checks passed (pure model and DOM projection; no application/IME/PDF validation)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
