/** Real-store integration with synthetic projects and memory-only storage.
 * No native app, user project, filesystem save, or clipboard is accessed. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const repo = path.resolve(__dirname, '..');
let checks = 0;
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); checks++; };
const same = (label, actual, expected) => { assert.equal(actual, expected, label); checks++; };
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}

(async () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const result = await esbuild.build({ stdin: { contents: `
    export {useStore} from './src/store/store';
    export {createProject} from './src/model/project';
    export {captureTextAnchor, captureSceneAnchor} from './src/model/annotations';
    export {captureCharacterTextAnchor, captureCharacterSceneAnchor, buildCharacterLineIndex} from './src/model/characterLines';
    export {captureCharacterSourceTarget, validateCharacterSourceTarget} from './src/app/characterNavigation';
    export {serializeProject, parseProject} from './src/io/zhsp';
    export {writeRecovery, readRecovery} from './src/app/autosaveStorage';
  `, resolveDir: repo, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' });
  const filename = path.join(repo, '.character-lines-store-memory.cjs');
  const compiled = new Module(filename, module);
  compiled.filename = filename; compiled.paths = Module._nodeModulePaths(repo);
  compiled._compile(result.outputFiles[0].text, filename);
  const { useStore, createProject, captureTextAnchor, captureSceneAnchor, captureCharacterTextAnchor, captureCharacterSceneAnchor,
    buildCharacterLineIndex, captureCharacterSourceTarget, validateCharacterSourceTarget, serializeProject, parseProject,
    writeRecovery, readRecovery } = compiled.exports;
  const state = () => useStore.getState();
  const epoch = () => state().documentEpoch;
  const element = id => state().project.elements.find(item => item.id === id);
  const profileA = () => ({ id: 'person-A', canonicalName: '合成甲', aliases: ['合成甲别名'] });
  const profileB = () => ({ id: 'person-B', canonicalName: '合成乙', aliases: [] });
  function fixture(withProfiles = true) {
    const p = createProject('合成人物事务'); p.id = 'character-store-synthetic';
    p.elements = [
      { id: 'heading-A', type: 'scene_heading', text: '内景 合成空间A 日' },
      { id: 'action-A', type: 'action', text: '合成甲看向合成乙。' },
      { id: 'cue-A', type: 'character', text: '合成甲' },
      { id: 'dialogue-A', type: 'dialogue', text: '<b>合成乙</b>，🎬<br>合成对白。' },
      { id: 'note-A', type: 'note', text: '合成备忘' },
      { id: 'heading-B', type: 'scene_heading', text: '外景 合成空间B 夜' },
      { id: 'action-B', type: 'action', text: '合成乙走来。' },
      { id: 'cue-B', type: 'character', text: '合成乙' },
      { id: 'dialogue-B', type: 'dialogue', text: '合成甲别名在吗？' },
      { id: 'heading-C', type: 'scene_heading', text: '内景 合成空间C 日' },
      { id: 'action-C', type: 'action', text: '合成空镜。' },
    ];
    p.sceneMeta = ['A', 'B', 'C'].map(letter => ({ id: `meta-${letter}`, elementId: `heading-${letter}`, title: `合成场${letter}`, synopsis: '', color: '#abcdef' }));
    if (withProfiles) p.characterWorkspace = { schema: 1, profiles: [profileA(), profileB()], overrides: [], assignments: [], noteLinks: [] };
    return p;
  }
  function reset(project = fixture()) {
    state().loadProject(project, '/synthetic/character-store.zhsp');
    useStore.setState({ toast: null }); state().breakHistoryGroup();
    return state().project;
  }
  function protectedState() {
    const s = state();
    return Object.fromEntries(['project', 'past', 'future', 'dirty', 'version', 'documentEpoch', 'filePath', 'activeId', 'focus', 'view', 'writingContext', 'selectedIds', 'writingSelectedIds'].map(key => [key, s[key]]));
  }
  function unchanged(label, before) {
    const after = protectedState();
    for (const key of Object.keys(before)) same(`${label}: ${key} unchanged`, after[key], before[key]);
  }
  function atomic(label, action, verify = () => {}) {
    const before = state(); const returned = action(); const after = state();
    check(`${label}: commits`, returned !== false && before.project !== after.project);
    same(`${label}: one undo entry`, after.past.length, before.past.length + 1);
    same(`${label}: dirty`, after.dirty, true); verify(after.project);
    state().undo(); same(`${label}: exact undo`, state().project, before.project);
    state().redo(); same(`${label}: exact redo`, state().project, after.project);
    return after.project;
  }
  function refuses(label, action) {
    const before = protectedState(); same(`${label}: refuses`, action(), false); unchanged(label, before);
  }
  const override = (id = 'override-A', elementId = 'action-A', characterId = 'person-A') => ({
    id, characterId, anchor: captureCharacterTextAnchor(state().project, elementId, 0, 3), classification: 'present', anchorState: 'current', reason: '合成明确分类',
  });
  const assignment = (id = 'assignment-A', elementId = 'cue-A', characterId = 'person-A') => ({
    id, characterId, anchor: captureCharacterTextAnchor(state().project, elementId), anchorState: 'current', reason: '合成明确归属',
  });
  function populated() {
    reset();
    check('fixture override A', state().setCharacterOverride(override(), epoch()));
    check('fixture override B', state().setCharacterOverride(override('override-B', 'action-B', 'person-B'), epoch()));
    check('fixture assignment A', state().setCharacterAssignment(assignment(), epoch()));
    check('fixture assignment B', state().setCharacterAssignment(assignment('assignment-B', 'cue-B', 'person-B'), epoch()));
    return state().project;
  }

  console.log('character-lines-store: registration and explicit evidence');
  const original = reset(fixture(false));
  atomic('register profile', () => state().upsertCharacterProfile(profileA(), epoch()), p => {
    same('registration does not rewrite body', p.elements, original.elements);
    check('registration persists identity', p.characterWorkspace.profiles, [profileA()]);
  });
  const beforeRename = state().project.elements;
  atomic('rename profile', () => state().upsertCharacterProfile({ ...profileA(), canonicalName: '合成甲新名' }, epoch()), p => {
    check('previous canonical retained as alias', p.characterWorkspace.profiles[0].aliases.includes('合成甲'));
    same('identity rename leaves screenplay unchanged', p.elements, beforeRename);
  });
  atomic('register same-name identity', () => state().upsertCharacterProfile({ id: 'person-other', canonicalName: '合成甲', aliases: [], disambiguation: '合成同名者' }, epoch()), p => {
    const speech = buildCharacterLineIndex(p).occurrences.find(item => item.kind === 'speech' && item.elementId === 'cue-A');
    check('same spelling remains ambiguous', speech.ambiguous);
    check('same spelling retains both identities', [...speech.characterIds].sort(), ['person-A', 'person-other']);
    same('ambiguity does not silently create assignment', p.characterWorkspace.assignments.length, 0);
  });
  reset();
  atomic('set override', () => state().setCharacterOverride(override(), epoch()), p => same('override current', p.characterWorkspace.overrides[0].anchorState, 'current'));
  atomic('set assignment', () => state().setCharacterAssignment(assignment(), epoch()), p => same('assignment explicit', p.characterWorkspace.assignments[0].characterId, 'person-A'));
  atomic('unknown speaker assignment', () => state().setCharacterAssignment({ ...assignment(), characterId: null }, epoch()), p => same('unknown is explicit null', p.characterWorkspace.assignments[0].characterId, null));
  atomic('delete assignment', () => state().deleteCharacterAssignment('assignment-A', epoch()), p => same('assignment removed', p.characterWorkspace.assignments.length, 0));
  state().undo();
  atomic('delete override', () => state().deleteCharacterOverride('override-A', epoch()), p => same('override removed', p.characterWorkspace.overrides.length, 0));
  atomic('explicit scene evidence', () => state().setCharacterOverride({ ...override(), anchor: captureCharacterSceneAnchor(state().project, 'heading-A') }, epoch()), p => same('scene heading identity stored', p.characterWorkspace.overrides[0].anchor.sceneHeadingId, 'heading-A'));

  console.log('character-lines-store: invalid, stale and unchanged requests preserve redo');
  populated(); state().setText('action-C', '合成重做分支'); state().undo();
  check('failure fixture has redo', state().future.length > 0);
  const aOverride = state().project.characterWorkspace.overrides[0], aAssignment = state().project.characterWorkspace.assignments[0];
  const noteAnchor = captureTextAnchor(element('action-A'), 0, 3);
  for (const [label, action] of [
    ['profile no-op', () => state().upsertCharacterProfile(profileA(), epoch())],
    ['non-last override no-op', () => state().setCharacterOverride(aOverride, epoch())],
    ['non-last assignment no-op', () => state().setCharacterAssignment(aAssignment, epoch())],
    ['missing profile removal', () => state().removeCharacterProfile('missing', epoch())],
    ['missing override removal', () => state().deleteCharacterOverride('missing', epoch())],
    ['missing assignment removal', () => state().deleteCharacterAssignment('missing', epoch())],
    ['invalid name', () => state().upsertCharacterProfile({ ...profileA(), canonicalName: '' }, epoch())],
    ['invalid duplicate alias', () => state().upsertCharacterProfile({ ...profileA(), aliases: ['别名', '别名'] }, epoch())],
    ['unregistered override identity', () => state().setCharacterOverride({ ...aOverride, characterId: 'missing' }, epoch())],
    ['unregistered assignment identity', () => state().setCharacterAssignment({ ...aAssignment, characterId: 'missing' }, epoch())],
    ['stale override source', () => state().setCharacterOverride({ ...aOverride, anchor: { ...aOverride.anchor, sourceText: aOverride.anchor.sourceText + '变' } }, epoch())],
    ['stale assignment source', () => state().setCharacterAssignment({ ...aAssignment, anchor: { ...aAssignment.anchor, sourceText: '合成丙', quote: '合成丙' } }, epoch())],
    ['assignment action is invalid', () => state().setCharacterAssignment({ ...aAssignment, anchor: captureCharacterTextAnchor(state().project, 'action-A') }, epoch())],
    ['partial cue assignment invalid', () => state().setCharacterAssignment({ ...aAssignment, anchor: captureCharacterTextAnchor(state().project, 'cue-A', 0, 2) }, epoch())],
    ['changed override cannot self-revive', () => state().setCharacterOverride({ ...aOverride, anchorState: 'changed' }, epoch())],
    ['missing note identity', () => state().addCharacterNote('missing', noteAnchor, '合成拒绝', { topic: 'note', status: 'resolved' }, epoch())],
    ['empty note body', () => state().addCharacterNote('person-A', noteAnchor, '', { topic: 'note', status: 'resolved' }, epoch())],
    ['note needs explicit state', () => state().addCharacterNote('person-A', noteAnchor, '合成拒绝', { topic: 'note' }, epoch())],
    ['invalid related identity', () => state().addCharacterNote('person-A', noteAnchor, '合成拒绝', { topic: 'relationship', relatedCharacterId: 'missing', status: 'resolved' }, epoch())],
  ]) refuses(label, action);
  for (const [label, action] of [
    ['stale profile', () => state().upsertCharacterProfile(profileB(), epoch() - 1)],
    ['stale profile removal', () => state().removeCharacterProfile('person-A', epoch() - 1)],
    ['stale override', () => state().setCharacterOverride(aOverride, epoch() - 1)],
    ['stale override deletion', () => state().deleteCharacterOverride(aOverride.id, epoch() - 1)],
    ['stale assignment', () => state().setCharacterAssignment(aAssignment, epoch() - 1)],
    ['stale assignment deletion', () => state().deleteCharacterAssignment(aAssignment.id, epoch() - 1)],
    ['stale character note', () => state().addCharacterNote('person-A', noteAnchor, '合成拒绝', { topic: 'note', status: 'resolved' }, epoch() - 1)],
  ]) refuses(label, action);

  console.log('character-lines-store: linked notes and profile removal');
  populated();
  const explicitAnchor = captureTextAnchor(element('action-A'), 0, 3);
  atomic('default explicit resolved note', () => state().addCharacterNote('person-A', explicitAnchor, '合成创作记录', { topic: 'note', status: 'resolved' }, epoch()), p => {
    same('resolved status persisted', p.annotations.at(-1).status, 'resolved');
    same('note link references annotation', p.characterWorkspace.noteLinks.at(-1).annotationId, p.annotations.at(-1).id);
  });
  const resolvedId = state().project.annotations.at(-1).id;
  atomic('explicit pending relationship note', () => state().addCharacterNote('person-A', captureSceneAnchor(element('heading-A')), '合成关系待办',
    { topic: 'relationship', relatedCharacterId: 'person-B', status: 'pending' }, epoch()), p => {
    same('pending status persisted', p.annotations.at(-1).status, 'pending');
    same('relationship references target identity', p.characterWorkspace.noteLinks.at(-1).relatedCharacterId, 'person-B');
  });
  const relationshipId = state().project.annotations.at(-1).id;
  const branches = state().project.characterWorkspace;
  atomic('add knowledge note', () => state().addCharacterNote('person-A', explicitAnchor, '合成知情记录', { topic: 'knowledge', status: 'resolved' }, epoch()), p => {
    same('note addition shares profiles', p.characterWorkspace.profiles, branches.profiles);
    same('note addition shares overrides', p.characterWorkspace.overrides, branches.overrides);
    same('note addition shares assignments', p.characterWorkspace.assignments, branches.assignments);
  });
  const notesWorkspace = state().project.characterWorkspace;
  atomic('edit note body', () => state().updateAnnotation(resolvedId, { body: '合成更新记录' }, epoch()), p => same('body edit shares identity workspace', p.characterWorkspace, notesWorkspace));
  atomic('delete annotation clears character link', () => state().deleteAnnotation(resolvedId, epoch()), p => {
    check('annotation removed', !p.annotations.some(item => item.id === resolvedId));
    check('only its link removed', !p.characterWorkspace.noteLinks.some(item => item.annotationId === resolvedId));
    check('relationship note retained', p.annotations.some(item => item.id === relationshipId));
  });
  const annotationsBeforeRemove = state().project.annotations;
  atomic('delete relationship object clears reference', () => state().removeCharacterProfile('person-B', epoch()), p => {
    same('target deletion preserves annotations', p.annotations, annotationsBeforeRemove);
    same('relationship remains but clears deleted target', p.characterWorkspace.noteLinks.find(item => item.annotationId === relationshipId).relatedCharacterId, undefined);
    check('deleted target overrides removed', p.characterWorkspace.overrides.every(item => item.characterId !== 'person-B'));
    check('deleted target assignments removed', p.characterWorkspace.assignments.every(item => item.characterId !== 'person-B'));
  });
  atomic('delete owner profile preserves ordinary annotations', () => state().removeCharacterProfile('person-A', epoch()), p => {
    same('owner deletion preserves all annotation text', p.annotations, annotationsBeforeRemove);
    same('owner links removed', p.characterWorkspace.noteLinks.length, 0);
    same('owner overrides removed', p.characterWorkspace.overrides.length, 0);
    same('owner assignments removed', p.characterWorkspace.assignments.length, 0);
  });

  console.log('character-lines-store: immutable sharing and structural reconciliation');
  populated();
  const workspace = freeze(state().project.characterWorkspace), oldProject = state().project;
  const stringify = JSON.stringify; let serializations = 0, workspaceSerializations = 0;
  JSON.stringify = function(value, ...rest) { serializations++; if (value === workspace || value?.characterWorkspace === workspace) workspaceSerializations++; return stringify.call(JSON, value, ...rest); };
  try { state().setText('action-C', '合成不相关输入'); } finally { JSON.stringify = stringify; }
  same('typing performs no JSON serialization', serializations, 0);
  same('typing shares unaffected immutable workspace', state().project.characterWorkspace, workspace);
  same('typing leaves prior snapshot intact', oldProject.elements.find(item => item.id === 'action-C').text, '合成空镜。');
  JSON.stringify = function(value, ...rest) { if (value === workspace || value?.characterWorkspace === workspace) workspaceSerializations++; return stringify.call(JSON, value, ...rest); };
  try { state().setType('action-C', 'general'); } finally { JSON.stringify = stringify; }
  same('generic mutate does not serialize workspace', workspaceSerializations, 0);
  same('generic mutate shares unchanged workspace', state().project.characterWorkspace, workspace);
  const beforeMove = state().project.characterWorkspace;
  atomic('move entire scene retains references', () => state().moveReviewScene('heading-A', 'heading-C', 'after', epoch()), p => {
    same('whole-scene move keeps workspace identity', p.characterWorkspace, beforeMove);
    same('whole-scene move retains current evidence', p.characterWorkspace.overrides[0].anchorState, 'current');
    same('whole-scene move retains assignment', p.characterWorkspace.assignments[0].anchorState, 'current');
  });
  atomic('move paragraph across scenes marks changed', () => state().mutate(p => {
    const index = p.elements.findIndex(item => item.id === 'action-A'); const [moved] = p.elements.splice(index, 1);
    p.elements.splice(p.elements.findIndex(item => item.id === 'heading-B') + 1, 0, moved);
  }), p => same('same text moved across heading is changed', p.characterWorkspace.overrides.find(item => item.id === 'override-A').anchorState, 'changed'));
  const stale = state().project.characterWorkspace.overrides.find(item => item.id === 'override-A');
  state().mutate(p => { const index = p.elements.findIndex(item => item.id === 'action-A'); const [moved] = p.elements.splice(index, 1); p.elements.splice(p.elements.findIndex(item => item.id === 'heading-A') + 1, 0, moved); });
  same('moving identical text back does not auto-revive', state().project.characterWorkspace.overrides.find(item => item.id === 'override-A'), stale);
  populated();
  atomic('delete source scene reconciles refs atomically', () => state().stashWritingElements(['heading-A', 'action-A', 'cue-A', 'dialogue-A', 'note-A'], '合成删场', '', true, epoch()), p => {
    same('deleted override source missing', p.characterWorkspace.overrides.find(item => item.id === 'override-A').anchorState, 'missing');
    same('deleted assignment source missing', p.characterWorkspace.assignments.find(item => item.id === 'assignment-A').anchorState, 'missing');
    same('other scene override current', p.characterWorkspace.overrides.find(item => item.id === 'override-B').anchorState, 'current');
  });
  state().undo();
  same('delete undo restores current source evidence', state().project.characterWorkspace.overrides[0].anchorState, 'current');
  atomic('source edit makes evidence stale in writing transaction', () => state().setText('action-A', '合成甲换了动作。'), p => {
    same('changed full source marked changed', p.characterWorkspace.overrides[0].anchorState, 'changed');
    same('old evidence excerpt retained', p.characterWorkspace.overrides[0].anchor.sourceText, '合成甲看向合成乙。');
  });

  console.log('character-lines-store: copies, persistence and source navigation');
  populated();
  const sourceWorkspace = state().project.characterWorkspace;
  atomic('create named version excludes character workspace', () => state().createNamedVersion('合成人物版本', epoch()), p => same('version contains no identity library', p.revisionWorkspace.versions[0].content.characterWorkspace, undefined));
  const versionId = state().project.revisionWorkspace.versions[0].id;
  let originalIds = new Set(state().project.elements.map(item => item.id));
  atomic('version restore is new source copy', () => state().restoreWorkspaceContent({ kind: 'version', id: versionId, elementIds: ['action-A', 'cue-A', 'dialogue-A'] }, 'action-C', epoch()), p => {
    const copies = p.elements.filter(item => !originalIds.has(item.id));
    same('version restored three new elements', copies.length, 3);
    same('version restoration retains original metadata branch', p.characterWorkspace, sourceWorkspace);
    check('new copies inherit no old evidence IDs', p.characterWorkspace.overrides.every(item => !copies.some(copy => copy.id === item.anchor.elementId)));
    check('new copies inherit no old assignment IDs', p.characterWorkspace.assignments.every(item => !copies.some(copy => copy.id === item.anchor.elementId)));
  });
  atomic('stash source is plain screenplay copy', () => state().stashWritingElements(['cue-A', 'dialogue-A'], '合成人物暂存', '', false, epoch()), p => same('stash contains no identity library', p.revisionWorkspace.stash[0].content.characterWorkspace, undefined));
  const stashId = state().project.revisionWorkspace.stash[0].id;
  originalIds = new Set(state().project.elements.map(item => item.id));
  atomic('stash restoration assigns new source IDs', () => state().restoreWorkspaceContent({ kind: 'stash', id: stashId }, 'action-C', epoch()), p => {
    const copies = p.elements.filter(item => !originalIds.has(item.id)); same('stash restores two new paragraphs', copies.length, 2);
    same('stash restoration retains metadata branch', p.characterWorkspace, sourceWorkspace);
    check('stash copies never inherit assignment anchors', p.characterWorkspace.assignments.every(item => !copies.some(copy => copy.id === item.anchor.elementId)));
  });
  atomic('persistence linked note', () => state().addCharacterNote('person-A', captureTextAnchor(element('action-A'), 0, 3), '合成往返记录', { topic: 'knowledge', status: 'resolved' }, epoch()));
  const snapshot = state().project;
  const reopened = parseProject(serializeProject(snapshot));
  check('project roundtrip preserves identity metadata', reopened.characterWorkspace, snapshot.characterWorkspace);
  check('project roundtrip preserves linked annotations', reopened.annotations, snapshot.annotations);
  writeRecovery(storage, { project: snapshot, filePath: '/synthetic/character-store.zhsp' });
  const recovery = readRecovery(storage);
  check('recovery accepted', !!recovery.snapshot && recovery.warning === null);
  check('recovery preserves identity metadata', recovery.snapshot.project.characterWorkspace, snapshot.characterWorkspace);
  check('recovery preserves notes', recovery.snapshot.project.annotations, snapshot.annotations);
  same('recovery preserves path', recovery.snapshot.filePath, '/synthetic/character-store.zhsp');
  const legacy = fixture(false); same('old project has no invented library', parseProject(serializeProject(legacy)).characterWorkspace, undefined);
  const invalid = { ...snapshot, characterWorkspace: { ...snapshot.characterWorkspace, profiles: [{ ...profileA(), id: 'missing-owner' }] } };
  assert.throws(() => serializeProject(invalid), /人物线/); checks++;
  const beforeRecovery = memory.get('guangying:autosave'); assert.throws(() => writeRecovery(storage, { project: invalid, filePath: null }), /人物线/); checks++;
  same('invalid metadata cannot overwrite recovery', memory.get('guangying:autosave'), beforeRecovery);

  reset(); state().setText('action-C', '合成跳转重做'); state().undo(); state().setView('character-lines');
  const target = captureCharacterSourceTarget(element('dialogue-A'), epoch(), 4, 6);
  check('UTF16 target captured', !!target);
  check('pure source target validates', validateCharacterSourceTarget(target, state()).ok);
  for (const [label, value] of [
    ['source epoch expired', { ...target, documentEpoch: epoch() - 1 }],
    ['source element missing', { ...target, elementId: 'missing' }],
    ['source text changed', { ...target, sourceText: target.sourceText + '变' }],
    ['source negative range', { ...target, start: -1 }],
    ['source out of bounds', { ...target, end: 10000 }],
    ['source surrogate split', { ...target, start: 5 }],
  ]) refuses(label, () => state().requestCharacterSource(value));
  const protectedBeforeJump = protectedState();
  check('valid source request succeeds', state().requestCharacterSource(target));
  for (const key of ['project', 'past', 'future', 'dirty', 'version']) same(`jump leaves ${key} unchanged`, state()[key], protectedBeforeJump[key]);
  same('jump opens writing view', state().view, 'write');
  same('jump focuses source element', state().focus.id, target.elementId);
  same('jump retains UTF16 caret', state().focus.caret, target.start);
  check('jump retains verified range evidence', state().focus.source, target);
  check('jump stores a validated copy', state().focus.source !== target);
  const staleTarget = captureCharacterSourceTarget(element('action-A'), epoch(), 0, 3);
  state().setText('action-A', '合成甲看向另一处。');
  refuses('source actual text edit invalidates old target', () => state().requestCharacterSource(staleTarget));
  reset(fixture()); refuses('same-ID reload invalidates prior epoch', () => state().requestCharacterSource(staleTarget));
  console.log(`character-lines-store ${checks}/${checks} PASS`);
})().catch(error => { console.error(error); process.exitCode = 1; });
