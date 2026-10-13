/** Character reading: synthetic data only; memory-only compilation, no application startup. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');
const repo = path.resolve(__dirname, '..');
let checks = 0;
function check(label, actual, expected) { assert.deepEqual(actual, arguments.length < 3 ? true : expected, label); checks++; }
const el = (id, type, text, patch = {}) => ({ id, type, text, ...patch });
const empty = () => ({ schema: 1, profiles: [], overrides: [], assignments: [], noteLinks: [] });
const profile = (id, canonicalName, aliases = []) => ({ id, canonicalName, aliases });
const copy = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; };

(async () => {
  const built = await esbuild.build({ stdin: { contents: `export * from './src/model/characterLines';
    export {createProject} from './src/model/project'; export {serializeProject,parseProject} from './src/io/zhsp';
    export {captureWritingFragment,buildInsertPlan} from './src/model/revisionWorkspace';
    export {toFdx} from './src/io/fdx'; export {toPlainText,toMarkdown,toHtml} from './src/io/textscript';`,
    resolveDir: repo, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const filename = path.join(repo, '.character-lines-model-memory.cjs');
  const module = new Module(filename); module.filename = filename; module.paths = Module._nodeModulePaths(repo);
  module._compile(built.outputFiles[0].text, filename);
  const api = module.exports;
  const { parseCharacterWorkspace: parse, reconcileCharacterWorkspace: reconcile, buildCharacterLineIndex: index,
    captureCharacterTextAnchor: capture, captureCharacterSceneAnchor: sceneAnchor, isCharacterAnchorCurrent: current } = api;
  const project = () => ({ ...api.createProject(), id: 'synthetic-project', elements: [], sceneMeta: [] });
  function rejects(label, value) { let error; try { parse(value); } catch (caught) { error = caught; }
    check(label, error instanceof Error && error.message === '人物线数据无效或超过容量限制，原稿未修改。'); }
  check('missing legacy workspace stays missing', parse(undefined), undefined);
  check('empty workspace roundtrips', parse(empty()), empty());
  const original = { ...empty(), profiles: [profile('p1', '合成人物甲', ['合成阿甲'])] };
  check('parser copies arrays and profiles', parse(original).profiles !== original.profiles && parse(original).profiles[0] !== original.profiles[0]);
  for (const value of [null, '', 1, [], new Date(), {}, { ...empty(), schema: 2 }, { ...empty(), extra: true }, { ...empty(), profiles: new Array(1) }]) rejects('invalid workspace structure rejected', value);
  for (const patch of [{ id: '' }, { id: '__proto__' }, { id: 'bad"id' }, { id: 'x'.repeat(513) }, { canonicalName: '' },
    { canonicalName: ' padded ' }, { canonicalName: 'line\nbreak' }, { canonicalName: 'x'.repeat(201) }, { aliases: ['same', 'same'] },
    { aliases: Array.from({ length: 101 }, (_, i) => `alias${i}`) }, { disambiguation: 'x'.repeat(501) }, { extra: true }]) {
    rejects('invalid profile field rejected', { ...empty(), profiles: [{ ...profile('p', '合成'), ...patch }] });
  }
  rejects('duplicate profile ids rejected', { ...empty(), profiles: [profile('p', '甲'), profile('p', '乙')] });
  check('same name with different identities is admitted', parse({ ...empty(), profiles: [profile('p1', '甲'), profile('p2', '甲')] }).profiles.length, 2);
  rejects('501 profiles exceed count', { ...empty(), profiles: Array.from({ length: 501 }, (_, i) => profile(`p${i}`, `人${i}`)) });
  let getterCalls = 0;
  const getter = { ...empty() }; Object.defineProperty(getter, 'profiles', { enumerable: true, get() { getterCalls++; throw new Error('private'); } });
  rejects('getter rejected without execution', getter); check('getter invocation count', getterCalls, 0);
  const badArray = []; Object.defineProperty(badArray, '0', { enumerable: true, get() { getterCalls++; return profile('p', '甲'); } });
  rejects('array getter rejected', { ...empty(), profiles: badArray }); check('array getter invocation count', getterCalls, 0);
  rejects('toJSON hook rejected', { ...empty(), toJSON() { throw new Error('private'); } });
  const symbol = empty(); symbol[Symbol('bad')] = 1; rejects('symbol field rejected', symbol);
  rejects('inherited object rejected', Object.create(empty()));
  check('null prototype plain record accepted', parse(Object.assign(Object.create(null), empty())), empty());
  const overBytes = { ...empty(), profiles: Array.from({ length: 110 }, (_, i) => profile(`p${i}`, `人${i}`, Array.from({ length: 100 }, (_, j) => `${j}${'中'.repeat(100)}`))) };
  rejects('workspace capacity uses UTF8 JSON bytes', overBytes);

  check('VO suffix is parsed', api.parseCharacterCue('合成甲（V.O.）：'), { name: '合成甲', extensions: ['V.O.'] });
  check('multiple known suffixes parsed', api.parseCharacterCue('合成甲 (CONT\'D)（电话）'), { name: '合成甲', extensions: ["CONT'D", '电话'] });
  check('age qualifiers are identity', api.parseCharacterCue('合成甲（少年）').name, '合成甲（少年）');
  check('group cue is not split', api.parseCharacterCue('合成甲 / 合成乙').name, '合成甲 / 合成乙');
  const p = project();
  p.elements = [el('pre', 'dialogue', '合成场前孤立对白'), el('s1', 'scene_heading', '内景 合成厅 日'),
    el('cue1', 'character', '小明（V.O.）'), el('note1', 'note', '私人备忘小明'), el('line1', 'dialogue', '小明妈妈说小明会来，Ann不在。'),
    el('action1', 'action', '🎬<b>小明妈妈</b>走进来。<br>小明并没有进门，Anna转述Ann昨天来过。'),
    el('age1', 'character', '小明（少年）'), el('line2', 'dialogue', '合成对白'), el('cue2', 'character', '小明妈妈'),
    el('line3', 'dialogue', '合成乙对白'), el('group', 'character', '合成甲 / 合成乙'), el('line4', 'dialogue', '集体回应'),
    el('s2', 'scene_heading', '外景 合成路 夜'), el('cue3', 'character', '阿明'), el('line5', 'dialogue', '合成末尾对白'),
    el('s3', 'scene_heading', '内景 合成省略场 日', { omit: true }), el('hidden', 'character', '省略人物'),
    el('hiddenLine', 'dialogue', '秘密小明'), el('hiddenSingle', 'action', '小明', { omit: true })];
  p.sceneMeta = [{ id: 'meta1', elementId: 's1', title: '', synopsis: '', color: '#fff', storyTime: '作者填写的第七天' }];
  p.characterWorkspace = { ...empty(), profiles: [profile('ming', '小明', ['阿明']), profile('mom', '小明妈妈'), profile('ann', 'Ann')] };
  freeze(p); const snapshot = JSON.stringify(p), result = index(p);
  check('reading does not mutate project', JSON.stringify(p), snapshot);
  check('unchanged index is shared', index(p) === result);
  check('default excludes omitted scenes', result.scenes.map(s => s.headingId), ['s1', 's2']);
  check('notes always excluded', result.occurrences.some(item => item.elementId === 'note1'), false);
  check('storyTime shown exactly', result.scenes[0].storyTime, '作者填写的第七天');
  check('longer names prevent prefix double match', result.occurrences.filter(item => item.elementId === 'action1' && item.start === 2).map(item => item.characterId), ['mom']);
  check('Latin name does not match Anna', result.occurrences.filter(item => item.elementId === 'action1' && item.characterId === 'ann').length, 1);
  check('only explicit alias resolves cue', result.occurrences.find(item => item.elementId === 'cue3').characterId, 'ming');
  check('age qualifier kept as separate discovered identity', result.characters.some(item => item.canonicalName === '小明（少年）' && !item.registered));
  check('collective cue kept whole', result.characters.some(item => item.canonicalName === '合成甲 / 合成乙'));
  check('no automatic actual-presence claim', result.occurrences.some(item => item.classification === 'present'), false);
  check('VO is explained without asserting presence', result.occurrences.find(item => item.elementId === 'cue1').explanation.includes('V.O.') && result.occurrences.find(item => item.elementId === 'cue1').classification === 'uncertain');
  check('note between cue and dialogue does not break speech', result.occurrences.find(item => item.elementId === 'cue1').dialogueElementIds, ['line1']);
  check('orphan preamble dialogue is unknown', [result.occurrences[0].kind, result.occurrences[0].characterId, result.occurrences[0].sceneHeadingId], ['speech', null, null]);
  check('dialogue name is mention only', result.occurrences.find(item => item.kind === 'mention' && item.elementId === 'line1').classification, 'mentioned');
  check('results follow manuscript order', result.occurrences.every((item, i, all) => !i || all[i - 1].elementIndex <= item.elementIndex));
  check('include omitted is explicit separate scope', index(p, { includeOmitted: true }).scenes.map(s => s.headingId), ['s1', 's2', 's3']);
  check('included omissions still exclude notes', index(p, { includeOmitted: true }).occurrences.some(item => item.elementId === 'note1'), false);
  check('cached excluded scope survives included read', index(p) === result);
  check('note association changes reuse recognition', index({ ...p, characterWorkspace: { ...p.characterWorkspace,
    noteLinks: [{ annotationId: 'later-note', characterId: 'ming' }] } }) === result);
  const anchor = capture(p, 'action1', 2, 6);
  check('UTF16 formatted anchor', [anchor.start, anchor.end, anchor.quote, anchor.sourceText.includes('\n')], [2, 6, '小明妈妈', true]);
  check('emoji split rejected', capture(p, 'action1', 1, 2), null);
  check('notes cannot be evidence anchors', capture(p, 'note1'), null);
  check('missing evidence rejected', capture(p, 'missing'), null);
  check('scene anchor uses heading ID', sceneAnchor(p, 's1'), { kind: 'scene', sceneHeadingId: 's1' });
  check('metadata ID is not scene identity', sceneAnchor(p, 'meta1'), null);
  check('fresh anchor is current', current(p, anchor));
  const dom = new JSDOM('<!doctype html>'); global.document = dom.window.document;
  check('DOM and fallback offsets agree', capture({ elements: p.elements.map(item => ({ ...item })) }, 'action1', 2, 6), anchor);
  delete global.document; dom.window.close();

  const ambiguous = { ...p, characterWorkspace: { ...p.characterWorkspace, profiles: [...p.characterWorkspace.profiles, profile('other-ming', '小明', [],)] } };
  check('same-name conflict remains ambiguous', index(ambiguous).occurrences.find(item => item.elementId === 'cue1').characterIds, ['ming', 'other-ming']);
  check('ambiguous speech is not a confirmed count', index(ambiguous).characters.find(item => item.id === 'ming').speakingCount, 1);
  const assignment = { id: 'assignment1', characterId: 'other-ming', anchor: capture(ambiguous, 'cue1'), anchorState: 'current', reason: '作者确认合成同名角色' };
  const assigned = { ...ambiguous, characterWorkspace: { ...ambiguous.characterWorkspace, assignments: [assignment] } };
  check('manual assignment resolves exact cue', [index(assigned).occurrences.find(item => item.elementId === 'cue1').characterId,
    index(assigned).occurrences.find(item => item.elementId === 'cue1').source], ['other-ming', 'manual-assignment']);
  const unknown = { ...assigned, characterWorkspace: { ...assigned.characterWorkspace, assignments: [{ ...assignment, characterId: null }] } };
  check('explicit unknown overrides automatic candidates', index(unknown).occurrences.find(item => item.elementId === 'cue1').characterIds, []);
  const dialogueAssignment = { id: 'assignment2', characterId: 'ming', anchor: capture(p, 'pre'), anchorState: 'current' };
  check('orphan dialogue can be manually assigned', index({ ...p, characterWorkspace: { ...p.characterWorkspace, assignments: [dialogueAssignment] } }).occurrences[0].characterId, 'ming');
  const override = { id: 'override1', characterId: 'mom', anchor, classification: 'present', anchorState: 'current', reason: '作者确认动作中的出场' };
  const corrected = { ...p, characterWorkspace: { ...p.characterWorkspace, overrides: [override] } };
  const correctedOccurrence = index(corrected).occurrences.find(item => item.overrideId === override.id);
  check('manual presence carries source and reason', [correctedOccurrence.classification, correctedOccurrence.source, correctedOccurrence.confidence], ['present', 'manual-override', 'manual']);
  check('same evidence not duplicated by correction', index(corrected).occurrences.length, result.occurrences.length);
  check('manual classification preserves original evidence explanation', correctedOccurrence.originalSource === 'name-match' && correctedOccurrence.originalExplanation.includes('实际出场待作者确认'));
  const sceneOverride = { ...override, id: 'scene-override', characterId: 'ming', anchor: sceneAnchor(p, 's2') };
  check('manual nonspeaking appearance is possible', index({ ...p, characterWorkspace: { ...p.characterWorkspace, overrides: [sceneOverride] } }).occurrences.find(item => item.id === 'manual:scene-override').classification, 'present');
  check('valid corrected workspace roundtrips', parse(corrected.characterWorkspace), corrected.characterWorkspace);
  for (const patch of [{ characterId: 'missing' }, { classification: 'speaks' }, { anchorState: 'orphan' }, { reason: 'x'.repeat(2001) },
    { anchor: { ...anchor, quote: 'wrong' } }, { anchor: { ...anchor, start: 1 } }, { anchor: { ...anchor, sourceType: 'note' } },
    { anchor: { ...anchor, sceneHeadingId: undefined } }, { anchor: { ...sceneAnchor(p, 's1'), elementId: 'extra' } }]) {
    rejects('invalid override rejected', { ...corrected.characterWorkspace, overrides: [{ ...override, ...patch }] });
  }
  rejects('duplicate correction IDs rejected', { ...corrected.characterWorkspace, overrides: [override, { ...override }] });
  rejects('duplicate correction evidence rejected', { ...corrected.characterWorkspace, overrides: [override, { ...override, id: 'second' }] });
  rejects('assignment must cover complete cue or dialogue', { ...assigned.characterWorkspace, assignments: [{ ...assignment, anchor: { ...assignment.anchor, end: 1, quote: assignment.anchor.sourceText.slice(0, 1) } }] });
  rejects('assignment cannot attach action', { ...p.characterWorkspace, assignments: [{ ...assignment, characterId: 'ming', anchor }] });
  rejects('duplicate assignments on same paragraph rejected', { ...assigned.characterWorkspace, assignments: [assignment, { ...assignment, id: 'second' }] });
  check('stale assignment can coexist with explicit replacement', parse({ ...assigned.characterWorkspace,
    assignments: [{ ...assignment, id: 'old', anchorState: 'changed' }, assignment] }).assignments.length, 2);
  check('stale override can coexist with explicit replacement', parse({ ...corrected.characterWorkspace,
    overrides: [{ ...override, id: 'old', anchorState: 'changed' }, override] }).overrides.length, 2);

  for (const interleaved of [false, true]) {
    const left = { dual: 'left', dualGroup: 'synthetic-dual' }, right = { dual: 'right', dualGroup: 'synthetic-dual' };
    const leftCue = el('dual-left-cue', 'character', '小明', left), rightCue = el('dual-right-cue', 'character', '小明妈妈', right);
    const leftLine = el('dual-left-line', 'dialogue', '合成左列', left), rightLine = el('dual-right-line', 'dialogue', '合成右列', right);
    const dualProject = { ...p, elements: [el('dual-heading', 'scene_heading', '内景 合成双列 日'),
      ...(interleaved ? [leftCue, rightCue, leftLine, rightLine] : [leftCue, leftLine, rightCue, rightLine])] };
    const dualIndex = index(dualProject);
    check(`dual ${interleaved ? 'interleaved' : 'sequential'} left attribution`, dualIndex.occurrences.find(item => item.elementId === leftCue.id).dialogueElementIds, [leftLine.id]);
    check(`dual ${interleaved ? 'interleaved' : 'sequential'} right attribution`, dualIndex.occurrences.find(item => item.elementId === rightCue.id).dialogueElementIds, [rightLine.id]);
    const unmatched = { ...dualProject, elements: [...dualProject.elements, el('dual-wrong-group', 'dialogue', '合成不明对白', { ...left, dualGroup: 'other' })] };
    check('different dual group is not attributed to last speaker', index(unmatched).occurrences.find(item => item.elementId === 'dual-wrong-group').characterId, null);
  }

  check('reconcile unchanged branch shares identity', reconcile(corrected, corrected, corrected.characterWorkspace) === corrected.characterWorkspace);
  const changed = { ...corrected, elements: corrected.elements.map(item => item.id === 'action1' ? { ...item, text: item.text + '新增' } : item) };
  const changedWorkspace = reconcile(corrected, changed, corrected.characterWorkspace);
  check('editing evidence conservatively stales correction', changedWorkspace.overrides[0].anchorState, 'changed');
  check('stale correction retains original quote', changedWorkspace.overrides[0].anchor, anchor);
  check('matching text later never revives stale anchor', reconcile(changed, corrected, changedWorkspace).overrides[0].anchorState, 'changed');
  check('stale correction is visible but not applied', [index({ ...changed, characterWorkspace: changedWorkspace }).staleOverrides.length,
    index({ ...changed, characterWorkspace: changedWorkspace }).occurrences.some(item => item.classification === 'present')], [1, false]);
  const deleted = { ...corrected, elements: corrected.elements.filter(item => item.id !== 'action1') };
  const missingWorkspace = reconcile(corrected, deleted, corrected.characterWorkspace);
  check('deleted evidence becomes missing', missingWorkspace.overrides[0].anchorState, 'missing');
  check('recreated same ID does not revive missing', reconcile(deleted, corrected, missingWorkspace).overrides[0].anchorState, 'missing');
  check('undo snapshot restores original source and state', corrected.characterWorkspace.overrides[0].anchorState, 'current');
  const s2Index = p.elements.findIndex(item => item.id === 's2'), s3Index = p.elements.findIndex(item => item.id === 's3');
  const moved = { ...corrected, elements: [...p.elements.slice(s2Index, s3Index), ...p.elements.slice(0, s2Index), ...p.elements.slice(s3Index)] };
  check('whole scene move preserves evidence anchor', reconcile(corrected, moved, corrected.characterWorkspace) === corrected.characterWorkspace);
  check('scene order follows actual move', index(moved).scenes.map(scene => scene.headingId), ['s2', 's1']);
  const crossScene = { ...corrected, elements: corrected.elements.filter(item => item.id !== 'action1') };
  crossScene.elements = [...crossScene.elements.slice(0, s3Index - 1), p.elements.find(item => item.id === 'action1'), ...crossScene.elements.slice(s3Index - 1)];
  check('single paragraph moved to another scene stales meaning', reconcile(corrected, crossScene, corrected.characterWorkspace).overrides[0].anchorState, 'changed');
  const renamedScene = { ...corrected, elements: corrected.elements.map(item => item.id === 's1' ? { ...item, text: '外景 合成新标题 夜' } : item) };
  check('scene heading text edit preserves element-based evidence', reconcile(corrected, renamedScene, corrected.characterWorkspace) === corrected.characterWorkspace);
  const changedType = { ...corrected, elements: corrected.elements.map(item => item.id === 'action1' ? { ...item, type: 'general' } : item) };
  check('same text with changed source type stales evidence', reconcile(corrected, changedType, corrected.characterWorkspace).overrides[0].anchorState, 'changed');
  const removedHeading = { ...corrected, elements: corrected.elements.filter(item => item.id !== 's1') };
  check('removed scene heading makes old scene context missing', reconcile(corrected, removedHeading, corrected.characterWorkspace).overrides[0].anchorState, 'missing');
  const changedAssigned = { ...assigned, elements: assigned.elements.map(item => item.id === 'cue1' ? { ...item, text: '阿明' } : item) };
  check('speaker edit stales exact assignment', reconcile(assigned, changedAssigned, assigned.characterWorkspace).assignments[0].anchorState, 'changed');

  const annotation = { id: 'note1', createdAt: 1, updatedAt: 1, body: 'CHARACTER_NOTE_PRIVATE_SENTINEL', status: 'resolved',
    anchor: { kind: 'scene', elementId: 's1' }, anchorState: 'current' };
  const noted = { ...corrected, annotations: [annotation], characterWorkspace: { ...corrected.characterWorkspace,
    noteLinks: [{ annotationId: 'note1', characterId: 'ming', topic: 'knowledge', relatedCharacterId: 'mom' }] } };
  check('plain annotation is reused without fields', Object.keys(annotation).sort(), ['anchor', 'anchorState', 'body', 'createdAt', 'id', 'status', 'updatedAt']);
  check('note link schema roundtrips', parse(noted.characterWorkspace).noteLinks, noted.characterWorkspace.noteLinks);
  check('deleting annotation removes only empty association', reconcile(noted, { ...noted, annotations: [] }, noted.characterWorkspace).noteLinks, []);
  check('cleanup never mutates old annotation', noted.annotations[0], annotation);
  rejects('invalid related profile rejected', { ...noted.characterWorkspace, noteLinks: [{ ...noted.characterWorkspace.noteLinks[0], relatedCharacterId: 'missing' }] });
  rejects('unknown note category rejected', { ...noted.characterWorkspace, noteLinks: [{ ...noted.characterWorkspace.noteLinks[0], topic: 'diagnosis' }] });
  const saved = api.serializeProject(noted), reopened = api.parseProject(saved);
  check('save reopen preserves stable character IDs and corrections', reopened.characterWorkspace, noted.characterWorkspace);
  check('save reopen preserves ordinary annotation', reopened.annotations, noted.annotations);
  const mismatched = copy(noted); mismatched.elements.find(item => item.id === 'action1').text += ' changed';
  check('open mismatched current anchor stales it', api.parseProject(JSON.stringify(mismatched)).characterWorkspace.overrides[0].anchorState, 'changed');
  check('legacy project gains no character field', Object.hasOwn(api.parseProject(JSON.stringify(project())), 'characterWorkspace'), false);
  const orphanLink = copy(noted); delete orphanLink.annotations;
  check('opening orphan annotation link safely removes association', api.parseProject(JSON.stringify(orphanLink)).characterWorkspace.noteLinks, []);
  const fragment = api.captureWritingFragment(noted), restored = api.buildInsertPlan(fragment, noted);
  check('versions remain only text and scene metadata', Object.keys(fragment).sort(), ['elements', 'sceneMeta']);
  check('restored text is a new identity', restored.elements.every(item => !noted.elements.some(old => old.id === item.id)));
  const copiedEvidence = { ...noted, elements: restored.elements, sceneMeta: restored.sceneMeta };
  check('restored copy never inherits original source anchor', reconcile(noted, copiedEvidence, noted.characterWorkspace).overrides[0].anchorState, 'missing');
  const privateProject = copy(noted); privateProject.characterWorkspace.profiles[0].disambiguation = 'CHARACTER_IDENTITY_PRIVATE_SENTINEL';
  privateProject.characterWorkspace.overrides[0].reason = 'CHARACTER_OVERRIDE_PRIVATE_SENTINEL';
  const clean = { ...privateProject }; delete clean.characterWorkspace; delete clean.annotations;
  for (const method of ['toFdx', 'toPlainText', 'toMarkdown', 'toHtml']) {
    check(`${method} output excludes character data byte-for-byte`, api[method](privateProject), api[method](clean));
  }
  check('all earlier snapshots remain unchanged', JSON.stringify(p), snapshot);
  console.log(`character-lines-model: ${checks} checks passed (synthetic admission, identity, evidence, anchors, compatibility, exports; no native validation)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
