/** Synthetic, in-memory navigation checks; never opens projects or native apps. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');

(async () => {
  const built = await esbuild.build({
    stdin: {
      contents: "export * from './src/app/characterNavigation'; export { makeTextRange } from './src/utils/dom';",
      resolveDir: path.join(__dirname, '..'), loader: 'ts',
    },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2021', logLevel: 'silent',
  });
  const bundled = new Module(path.join(__dirname, 'character-navigation-test.bundle.cjs'), module);
  bundled.filename = path.join(__dirname, 'character-navigation-test.bundle.cjs');
  bundled.paths = Module._nodeModulePaths(__dirname);
  bundled._compile(built.outputFiles[0].text, bundled.filename);
  const {
    CHARACTER_READING_BOOKMARKS_KEY: KEY, MAX_CHARACTER_READING_BOOKMARKS: MAX,
    MAX_CHARACTER_READING_BYTES: MAX_BYTES, parseCharacterReadingBookmark: parse,
    loadCharacterReadingBookmark: load, saveCharacterReadingBookmark: save,
    captureCharacterSourceTarget: capture, validateCharacterSourceTarget: validate, makeTextRange,
  } = bundled.exports;
  let checks = 0;
  const check = (label, actual, expected) => { assert.deepEqual(actual, expected, label); checks += 1; };
  const storage = () => {
    const data = new Map();
    let writes = 0;
    return { data, get writes() { return writes; }, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); writes++; } };
  };
  const bookmark = (projectId = 'synthetic-project', extra = {}) => ({
    version: 1, projectId, characterKey: '合成甲', sceneId: 'scene-heading', elementId: 'paragraph',
    scrollTop: 125.5, mode: 'scene', filter: 'present', includeOmitted: false, query: '合成', updatedAt: 42, ...extra,
  });
  const base = Object.freeze(bookmark());
  check('bookmark scalars round-trip', parse(base, base.projectId), base);
  check('different project ID rejected', parse(base, 'another-project'), null);
  check('unsupported bookmark version rejected', parse({ ...base, version: 2 }, base.projectId), null);
  check('non-record bookmark rejected', parse([], base.projectId), null);
  check('unknown data never enters bookmark', parse({ ...base, sourceText: 'do not persist', project: { elements: [] }, writingContext: {} }, base.projectId), base);
  check('malformed optional metadata discarded', parse(bookmark('synthetic-project', {
    characterKey: '', sceneId: 's'.repeat(513), elementId: 4, scrollTop: Infinity, mode: 'write', filter: 'invalid',
    includeOmitted: 'true', query: 'x'.repeat(501), updatedAt: -1,
  }), base.projectId), { version: 1, projectId: base.projectId });
  for (const scrollTop of [-1, NaN, 10_000_001]) check('invalid scroll discarded', parse({ ...base, scrollTop }, base.projectId).scrollTop, undefined);
  check('zero scroll and blank query retained', parse({ ...base, scrollTop: 0, query: '', includeOmitted: true }, base.projectId).scrollTop, 0);
  check('query boundary retained', parse({ ...base, query: '测'.repeat(500) }, base.projectId).query.length, 500);
  let getterCalled = false;
  const accessor = { ...base, get query() { getterCalled = true; return 'bad'; } };
  check('accessors rejected without executing', parse(accessor, base.projectId), null);
  check('no getter executed', getterCalled, false);

  const memory = storage();
  memory.data.set('guangying:writing-contexts', 'untouched-writing-state');
  check('save succeeds', save(base, '/synthetic/a.zhsp', memory), true);
  check('same project and path restores', load(base.projectId, '/synthetic/a.zhsp', memory), base);
  check('same project, another path isolated', load(base.projectId, '/synthetic/b.zhsp', memory), null);
  check('same path, another project isolated', load('other', '/synthetic/a.zhsp', memory), null);
  check('unsaved path isolated', load(base.projectId, null, memory), null);
  check('null-path bookmark stored separately', save({ ...base, scrollTop: 900 }, null, memory), true);
  check('null-path bookmark restored', load(base.projectId, null, memory).scrollTop, 900);
  check('saved bookmark remains unchanged', load(base.projectId, '/synthetic/a.zhsp', memory), base);
  check('reader save leaves writing storage alone', memory.data.get('guangying:writing-contexts'), 'untouched-writing-state');
  check('only dedicated storage key added', [...memory.data.keys()], ['guangying:writing-contexts', KEY]);
  check('empty path rejected', save(base, '', memory), false);
  check('oversized path rejected', save(base, 'x'.repeat(4097), memory), false);
  check('bookmark update succeeds', save({ ...base, scrollTop: 42 }, '/synthetic/a.zhsp', memory), true);
  check('update replaces exact pair', JSON.parse(memory.data.get(KEY)).entries.length, 2);
  check('updated position restored', load(base.projectId, '/synthetic/a.zhsp', memory).scrollTop, 42);
  for (const raw of ['{', '{"version":2,"entries":[]}', '{"version":1,"entries":{}}', 'x'.repeat(MAX_BYTES + 1)]) {
    const broken = storage(); broken.data.set(KEY, raw);
    check('bad stored metadata safely ignored', load(base.projectId, null, broken), null);
    check('read does not rewrite corrupt metadata', broken.writes, 0);
  }
  const bounded = storage();
  for (let i = 0; i < MAX + 5; i++) save(bookmark(`project-${i}`), `/synthetic/${i}.zhsp`, bounded);
  check('entry count bounded', JSON.parse(bounded.data.get(KEY)).entries.length, MAX);
  check('oldest metadata evicted', load('project-0', '/synthetic/0.zhsp', bounded), null);
  check('latest metadata retained', load(`project-${MAX + 4}`, `/synthetic/${MAX + 4}.zhsp`, bounded).projectId, `project-${MAX + 4}`);
  const byteBounded = storage();
  for (let i = 0; i < MAX; i++) save(bookmark(`p-${i}`, { characterKey: '人'.repeat(512), sceneId: '场'.repeat(512), elementId: '段'.repeat(512), query: '词'.repeat(500) }), `${i}${'路'.repeat(4000)}`, byteBounded);
  check('UTF-8 payload bounded', Buffer.byteLength(byteBounded.data.get(KEY), 'utf8') <= MAX_BYTES, true);
  check('byte bound evicts before count bound', JSON.parse(byteBounded.data.get(KEY)).entries.length < MAX, true);
  let writeAfterReadFailure = false;
  const unreadable = { getItem() { throw new Error('synthetic read failure'); }, setItem() { writeAfterReadFailure = true; } };
  check('read failure returns no bookmark', load(base.projectId, null, unreadable), null);
  check('save read failure reported', save(base, null, unreadable), false);
  check('read failure never overwrites old entries', writeAfterReadFailure, false);
  check('quota failure reported', save(base, null, { getItem: () => null, setItem() { throw new Error('synthetic quota failure'); } }), false);
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('synthetic unavailable storage'); } });
  try {
    check('missing browser storage loads safely', load(base.projectId, null), null);
    check('missing browser storage save fails explicitly', save(base, null), false);
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  }

  const element = Object.freeze({ id: 'synthetic-paragraph', type: 'dialogue', text: '<b>甲</b>&amp;<div>🎬<br>乙</div>尾' });
  const state = Object.freeze({ documentEpoch: 4, project: Object.freeze({ elements: Object.freeze([element]) }), dirty: false, past: Object.freeze([]), writingContext: base });
  const before = JSON.stringify(state);
  const target = capture(element, 4, 4, 6);
  check('source uses text/BR offsets', target, { documentEpoch: 4, elementId: element.id, start: 4, end: 6, sourceText: '甲&🎬\n乙尾' });
  check('same source validates', validate(target, state), { ok: true, target });
  check('default target is start caret', capture(element, 4).start, 0);
  check('default target is collapsed', capture(element, 4).end, 0);
  check('end defaults to supplied caret', capture(element, 4, 6).end, 6);
  check('empty paragraph caret supported', capture({ id: 'empty', type: 'action', text: '' }, 4), { documentEpoch: 4, elementId: 'empty', start: 0, end: 0, sourceText: '' });
  check('epoch boundary rejected even with same IDs/text', validate(target, { ...state, documentEpoch: 5 }), { ok: false, reason: 'stale-document' });
  check('removed element rejected', validate(target, { ...state, project: { elements: [] } }), { ok: false, reason: 'missing-element' });
  check('matching quote in different element never redirects', validate(target, { ...state, project: { elements: [{ ...element, id: 'different' }] } }), { ok: false, reason: 'missing-element' });
  check('duplicate IDs rejected', validate(target, { ...state, project: { elements: [element, { ...element }] } }), { ok: false, reason: 'missing-element' });
  check('changed full source rejected even with same quote', validate(target, { ...state, project: { elements: [{ ...element, text: element.text + '改' }] } }), { ok: false, reason: 'changed-source' });
  check('formatting-only source change remains valid', validate(target, { ...state, project: { elements: [{ ...element, text: '甲&amp;🎬<br><i>乙尾</i>' }] } }).ok, true);
  for (const [start, end] of [[-1, 0], [0, 50], [5, 4], [0.5, 1], [NaN, 1], [3, 4], [2, 3]]) {
    check('invalid or split-surrogate range rejected at capture', capture(element, 4, start, end), null);
    check('invalid or split-surrogate range rejected at use', validate({ ...target, start, end }, state), { ok: false, reason: 'invalid-range' });
  }
  check('bad target epoch rejected', capture(element, -1), null);
  check('NaN current epoch rejected', validate(target, { ...state, documentEpoch: NaN }), { ok: false, reason: 'invalid-range' });
  const dualLeft = { ...element, id: 'left', dual: 'left', dualGroup: 'synthetic-dual' };
  const dualRight = { ...element, id: 'right', dual: 'right', dualGroup: 'synthetic-dual' };
  const rightTarget = capture(dualRight, 4, 5, 6);
  check('right column keeps its own source ID', validate(rightTarget, { ...state, project: { elements: [dualLeft, dualRight] } }).target.elementId, 'right');
  check('validation never mutates project/history/writing state', JSON.stringify(state), before);

  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.document = dom.window.document;
  global.Node = dom.window.Node;
  global.NodeFilter = dom.window.NodeFilter;
  const block = document.createElement('div'); block.innerHTML = element.text;
  const domTarget = capture(element, 4, 4, 6);
  check('browser and fallback source projection agree', domTarget, target);
  check('target range selects actual DOM newline and text', makeTextRange(block, domTarget.start, domTarget.end).toString(), '乙');
  check('range endpoints retain BR position', !!makeTextRange(block, domTarget.start, domTarget.end).cloneContents().querySelector('br'), true);
  dom.window.close();
  delete global.document; delete global.Node; delete global.NodeFilter;
  console.log(`character-navigation ${checks}/${checks} PASS`);
})().catch(error => { console.error(error); process.exitCode = 1; });
