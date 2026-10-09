/** Synthetic integration coverage for the real review store. No app, clipboard,
 * userData, user project, or filesystem save is opened by this test. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const repo = path.resolve(__dirname, '..');
let checks = 0;
function check(label, actual, expected = true) { assert.deepEqual(actual, expected, label); checks++; }
function same(label, actual, expected) { assert.equal(actual, expected, label); checks++; }
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }

(async () => {
  // The real store imports application preferences. Supply an isolated in-memory
  // port before evaluating it so no host recovery/preferences storage is read.
  const memory = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key),
  } });
  const result = await esbuild.build({ stdin: { contents: `
    export {useStore} from './src/store/store';
    export {createProject} from './src/model/project';
    export {captureTextAnchor, captureSceneAnchor} from './src/model/annotations';
    export {createNamedVersion, captureWritingFragment, createStashEntry} from './src/model/revisionWorkspace';
    export {buildDeliveryChecks, activeDeliveryChecks} from './src/model/deliveryChecks';
    export {serializeProject, parseProject} from './src/io/zhsp';
  `, resolveDir: repo, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' });
  const filename = path.join(repo, '.review-store-memory.cjs');
  const compiled = new Module(filename, module);
  compiled.filename = filename; compiled.paths = Module._nodeModulePaths(repo);
  compiled._compile(result.outputFiles[0].text, filename);
  const { useStore, createProject, captureTextAnchor, captureSceneAnchor, createNamedVersion, captureWritingFragment,
    createStashEntry, buildDeliveryChecks, activeDeliveryChecks, serializeProject, parseProject } = compiled.exports;
  const state = () => useStore.getState();
  function fixture() {
    const p = createProject('合成改稿事务');
    p.id = 'review-store-project';
    p.elements = ['A', 'B', 'C', 'D'].flatMap((letter, index) => [
      { id: `heading-${letter}`, type: 'scene_heading', text: `内景 合成空间${letter} 日` },
      { id: `action-${letter}`, type: 'action', text: index === 3 ? '' : `合成${letter}动作` },
    ]);
    p.sceneMeta = ['A', 'B', 'C'].map(letter => ({ id: `meta-${letter}`, elementId: `heading-${letter}`,
      title: `合成${letter}`, synopsis: `合成${letter}概要`, color: '#cfe4ff', actId: 'act-1' }));
    p.beats = [
      { id: 'image-canonical', kind: 'image', img: 'data:image/png;base64,c3ludGhldGlj', title: '合成图片', text: '合成图片说明', color: '#fff', x: 7, y: 11, sceneId: 'meta-A' },
      { id: 'beat-legacy', text: '合成旧关联', color: '#fff', x: 10, y: 20, sceneId: 'heading-A' },
      { id: 'beat-kept', text: '合成保留关联', color: '#fff', x: 30, y: 40, sceneId: 'meta-B' },
    ];
    p.boardLinks = [
      { id: 'link-heading', from: 'scene:heading-A', to: 'beat:beat-kept' },
      { id: 'link-meta', from: 'scene:meta-A', to: 'beat:beat-kept' },
      { id: 'link-old-meta', from: 'meta-A', to: 'beat-kept' },
      { id: 'link-kept', from: 'scene:heading-B', to: 'beat:beat-kept' },
    ];
    return p;
  }
  const reset = (project = fixture()) => {
    state().loadProject(project, '/synthetic/review-store.zhsp');
    useStore.setState({ toast: null });
    state().breakHistoryGroup();
    return state().project;
  };
  const protectedState = () => {
    const s = state();
    return { project: s.project, past: s.past, future: s.future, dirty: s.dirty, version: s.version,
      documentEpoch: s.documentEpoch, filePath: s.filePath, activeId: s.activeId, focus: s.focus,
      selectedIds: s.selectedIds, writingSelectedIds: s.writingSelectedIds };
  };
  const unchanged = (label, before) => {
    const after = protectedState();
    for (const key of Object.keys(before)) same(`${label}: unchanged ${key}`, after[key], before[key]);
  };
  function atomic(label, action, verify = () => {}) {
    const before = state();
    check(`${label}: commits`, action());
    const after = state();
    same(`${label}: exactly one undo entry`, after.past.length, before.past.length + 1);
    same(`${label}: dirty`, after.dirty, true);
    verify(after.project);
    state().undo(); same(`${label}: one undo restores exact project`, state().project, before.project);
    state().redo(); same(`${label}: one redo restores exact project`, state().project, after.project);
    return after.project;
  }

  console.log('review-store: named versions and explicit stash');
  const initial = reset();
  atomic('create named version', () => state().createNamedVersion('合成版本一', state().documentEpoch), p => {
    same('version capture leaves active elements shared', p.elements, initial.elements);
    check('version captures current text', p.revisionWorkspace.versions[0].content.elements, initial.elements);
    same('version preserves current media branch', p.beats, initial.beats);
  });
  const versionId = state().project.revisionWorkspace.versions[0].id;
  atomic('rename named version', () => state().renameNamedVersion(versionId, '合成版本改名', state().documentEpoch), p => {
    same('new version label saved', p.revisionWorkspace.versions[0].name, '合成版本改名');
  });
  atomic('delete named version', () => state().deleteNamedVersion(versionId, state().documentEpoch), p => same('version removed', p.revisionWorkspace.versions.length, 0));
  state().undo();
  const snapshotBeforeStash = state().project;
  atomic('stash noncontiguous copy', () => state().stashWritingElements(['action-C', 'action-A'], '合成备选', '合成来源说明', false, state().documentEpoch), p => {
    same('stash copy keeps body identity', p.elements, snapshotBeforeStash.elements);
    check('stash source follows original document order', p.revisionWorkspace.stash[0].source.elementIds, ['action-A', 'action-C']);
    same('stash does not copy media', JSON.stringify(p.revisionWorkspace).includes('data:image/'), false);
  });
  const stashId = state().project.revisionWorkspace.stash[0].id;
  atomic('delete stash', () => state().deleteStashEntry(stashId, state().documentEpoch), p => same('stash removed', p.revisionWorkspace.stash.length, 0));
  state().undo();
  const beforeDelete = state().project;
  atomic('stash and delete scene', () => state().stashWritingElements(['heading-A', 'action-A'], '合成删场', '合成删稿说明', true, state().documentEpoch), p => {
    check('explicit delete removes selected whole scene only', p.elements.map(el => el.id), beforeDelete.elements.slice(2).map(el => el.id));
    check('canonical and legacy material associations both released', p.beats.map(beat => beat.sceneId), [undefined, undefined, 'meta-B']);
    same('material data untouched', p.beats[0].img, beforeDelete.beats[0].img);
    check('relations use both heading and metadata IDs', p.boardLinks.map(link => link.id), ['link-kept']);
    same('one captured deleted entry', p.revisionWorkspace.stash.at(-1).kind, 'deleted');
    check('captured scene metadata remains recoverable', p.revisionWorkspace.stash.at(-1).content.sceneMeta.map(meta => meta.id), ['meta-A']);
  });

  console.log('review-store: insertion copies and stale operations');
  const beforeRestore = state().project;
  atomic('partial old-version restore', () => state().restoreWorkspaceContent({ kind: 'version', id: versionId, elementIds: ['action-A'] }, 'action-B', state().documentEpoch), p => {
    const inserted = p.elements.find(el => !beforeRestore.elements.some(old => old.id === el.id));
    check('restored paragraph gets a fresh ID', !!inserted && inserted.id !== 'action-A');
    same('restored paragraph has original text', inserted.text, '合成A动作');
    check('all existing paragraphs stay intact', p.elements.filter(el => beforeRestore.elements.some(old => old.id === el.id)), beforeRestore.elements);
    same('restoring preserves archive', p.revisionWorkspace, beforeRestore.revisionWorkspace);
    same('restoring preserves media', p.beats, beforeRestore.beats);
    same('restoring preserves relations', p.boardLinks, beforeRestore.boardLinks);
    same('restoring does not replace project identity', p.id, beforeRestore.id);
  });
  const deletedEntry = state().project.revisionWorkspace.stash.at(-1);
  const previousIds = new Set(state().project.elements.map(el => el.id));
  atomic('whole stash restore', () => state().restoreWorkspaceContent({ kind: 'stash', id: deletedEntry.id }, 'action-C', state().documentEpoch), p => {
    const inserted = p.elements.filter(el => !previousIds.has(el.id));
    check('stash restores both paragraphs', inserted.map(el => el.type), ['scene_heading', 'action']);
    check('stash copied IDs do not reuse source IDs', inserted.every(el => !deletedEntry.source.elementIds.includes(el.id)));
    check('new scene metadata references new heading', p.sceneMeta.some(meta => meta.elementId === inserted[0].id && meta.id !== 'meta-A'));
    check('stash remains reusable after restore', p.revisionWorkspace.stash.some(entry => entry.id === deletedEntry.id));
  });
  const anchor = captureTextAnchor(state().project.elements.find(el => el.id === 'action-B'), 0, 2);
  check('annotation preparation', state().addAnnotation(anchor, '合成待处理意见', state().documentEpoch));
  const annotationId = state().project.annotations[0].id;
  const deliverySignature = buildDeliveryChecks(state().project)[0].signature;
  state().setText('action-B', '合成临时分支'); state().undo();
  check('failure fixture has redo branch', state().future.length > 0);
  const staleEpoch = state().documentEpoch - 1;
  const staleActions = [
    () => state().createNamedVersion('合成过期', staleEpoch),
    () => state().renameNamedVersion(versionId, '合成过期', staleEpoch),
    () => state().deleteNamedVersion(versionId, staleEpoch),
    () => state().stashWritingElements(['action-B'], '合成过期', '', true, staleEpoch),
    () => state().deleteStashEntry(deletedEntry.id, staleEpoch),
    () => state().restoreWorkspaceContent({ kind: 'stash', id: deletedEntry.id }, 'action-B', staleEpoch),
    () => state().addAnnotation(anchor, '合成过期', staleEpoch),
    () => state().updateAnnotation(annotationId, { body: '合成过期' }, staleEpoch),
    () => state().deleteAnnotation(annotationId, staleEpoch),
    () => state().reanchorAnnotation(annotationId, anchor, staleEpoch),
    () => state().setDeliveryIgnored(deliverySignature, true, staleEpoch),
    () => state().commitReviewSceneMeta('heading-B', { location: '合成过期地点' }, staleEpoch),
    () => state().moveReviewScene('heading-B', 'heading-C', 'after', staleEpoch),
  ];
  staleActions.forEach((action, index) => { const before = protectedState(); same(`stale action ${index} refuses`, action(), false); unchanged(`stale action ${index}`, before); });
  for (const action of [
    () => state().restoreWorkspaceContent({ kind: 'stash', id: deletedEntry.id }, 'missing-anchor', state().documentEpoch),
    () => state().restoreWorkspaceContent({ kind: 'version', id: versionId, elementIds: ['missing-source'] }, 'action-B', state().documentEpoch),
    () => state().stashWritingElements(['action-B', 'missing-source'], '合成拒绝', '', true, state().documentEpoch),
  ]) { const before = protectedState(); same('invalid content/anchor refuses atomically', action(), false); unchanged('invalid selection', before); }

  console.log('review-store: capacity rejection and immutable archive branches');
  const full = fixture();
  const fragment = captureWritingFragment(full, { kind: 'elements', ids: ['action-A'] });
  const one = createStashEntry(undefined, fragment, { name: '合成容量', source: { projectId: full.id, elementIds: ['action-A'] } }).stash[0];
  full.revisionWorkspace = { schema: 1, versions: [], stash: Array.from({ length: 100 }, (_, index) => ({ ...one, id: `full-stash-${index}` })) };
  reset(full); state().setText('action-B', '合成创建重做'); state().undo();
  let protectedBefore = protectedState();
  same('full stash refuses deletion transaction', state().stashWritingElements(['heading-A', 'action-A'], '合成超量删场', '', true, state().documentEpoch), false);
  unchanged('stash count capacity', protectedBefore);
  check('capacity refusal leaves original scene and image linkage', state().project.elements.some(el => el.id === 'heading-A') && state().project.beats[0].sceneId === 'meta-A');
  const bytesFull = fixture();
  bytesFull.elements.find(el => el.id === 'action-A').text = '中'.repeat(40_000);
  const largeSnapshot = { ...fixture(), elements: [{ id: 'capacity-text', type: 'action', text: 'x'.repeat(1_000_000) }], sceneMeta: [] };
  let largeWorkspace = createNamedVersion(largeSnapshot, '合成容量一');
  largeWorkspace = createNamedVersion({ ...largeSnapshot, revisionWorkspace: largeWorkspace }, '合成容量二');
  bytesFull.revisionWorkspace = largeWorkspace; reset(bytesFull);
  protectedBefore = protectedState();
  same('aggregate byte capacity refuses deletion transaction', state().stashWritingElements(['action-A'], '合成总容量', '', true, state().documentEpoch), false);
  unchanged('stash byte capacity', protectedBefore);
  reset(); check('archive fixture creation', state().createNamedVersion('合成不可变库'));
  const archive = freeze(state().project.revisionWorkspace);
  const oldProject = state().project;
  const stringify = JSON.stringify; let serializations = 0, archiveSerializations = 0;
  JSON.stringify = function(value, ...rest) { serializations++; if (value === archive || value?.revisionWorkspace === archive) archiveSerializations++; return stringify.call(JSON, value, ...rest); };
  try { state().setText('action-B', '合成热路径输入'); }
  finally { JSON.stringify = stringify; }
  same('setText performs no JSON serialization', serializations, 0);
  same('setText shares the immutable archive branch', state().project.revisionWorkspace, archive);
  same('saved snapshot not mutated by later text input', oldProject.elements.find(el => el.id === 'action-B').text, '合成B动作');
  JSON.stringify = function(value, ...rest) { if (value === archive || value?.revisionWorkspace === archive) archiveSerializations++; return stringify.call(JSON, value, ...rest); };
  try { state().setType('action-B', 'general'); }
  finally { JSON.stringify = stringify; }
  same('generic mutate avoids serializing archive', archiveSerializations, 0);
  same('generic mutate shares immutable archive', state().project.revisionWorkspace, archive);
  const saved = { project: state().project, documentEpoch: state().documentEpoch };
  check('another named snapshot commits while a save is pending', state().createNamedVersion('合成保存等待中新版本'));
  check('old save result can bind same-session path', state().markSaved('/synthetic/saved.zhsp', saved));
  same('new version after save snapshot keeps dirty', state().dirty, true);
  same('file association is still valid', state().filePath, '/synthetic/saved.zhsp');

  console.log('review-store: annotation lifecycle and explicit reattachment');
  reset();
  const oldAnchor = captureTextAnchor(state().project.elements.find(el => el.id === 'action-A'), 0, 2);
  atomic('add annotation', () => state().addAnnotation(oldAnchor, '合成批注意见', state().documentEpoch));
  const noteId = state().project.annotations[0].id;
  for (const patch of [
    { id: 'forged-id' }, { anchorState: 'current' }, { anchor: captureSceneAnchor(state().project.elements[0]) },
    { createdAt: 0 }, { extra: 'unrecognized' }, { status: 'declined' }, { body: '' },
  ]) {
    const before = protectedState();
    same('runtime annotation patch refuses identity/anchor/invalid value', state().updateAnnotation(noteId, patch, state().documentEpoch), false);
    unchanged('annotation patch validation', before);
  }
  atomic('resolve annotation', () => state().updateAnnotation(noteId, { status: 'resolved', decision: '合成已处理' }, state().documentEpoch));
  atomic('decline annotation with reason', () => state().updateAnnotation(noteId, { status: 'declined', reason: '合成保留安排' }, state().documentEpoch));
  atomic('delete annotation', () => state().deleteAnnotation(noteId, state().documentEpoch), p => same('annotation deleted', p.annotations.length, 0));
  state().undo();
  const originalAnnotated = state().project;
  state().breakHistoryGroup(); state().setText('action-A', '合成替换正文');
  same('changed quote becomes stale with same writing transaction', state().project.annotations[0].anchorState, 'changed');
  same('changed quote retains captured source', state().project.annotations[0].anchor.sourceText, '合成A动作');
  state().undo(); same('undo writing restores exact annotation state', state().project, originalAnnotated);
  same('undo writing revalidates original captured anchor', state().project.annotations[0].anchorState, 'current');
  state().redo(); state().breakHistoryGroup(); state().setText('action-A', '合成A动作');
  same('typing equal original text does not automatically reattach', state().project.annotations[0].anchorState, 'changed');
  const newAnchor = captureTextAnchor(state().project.elements.find(el => el.id === 'action-A'), 0, 2);
  atomic('explicit annotation reanchor', () => state().reanchorAnnotation(noteId, newAnchor, state().documentEpoch), p => same('explicit reanchor is current', p.annotations[0].anchorState, 'current'));
  atomic('delete annotated paragraph into stash', () => state().stashWritingElements(['action-A'], '合成批注删稿', '', true, state().documentEpoch), p => same('deleted paragraph leaves missing annotation', p.annotations[0].anchorState, 'missing'));
  const missing = state().project.annotations[0];
  state().insertAfter('heading-A', 'action', '合成A动作');
  same('new equal paragraph never auto-attaches missing annotation', state().project.annotations[0], missing);
  const wrong = { ...oldAnchor, quote: '过期', sourceText: '过期', start: 0, end: 2 };
  protectedBefore = protectedState();
  same('stale quote refuses annotation creation', state().addAnnotation(wrong, '合成拒绝', state().documentEpoch), false);
  unchanged('stale annotation source', protectedBefore);

  const loadedAnchor = fixture();
  const originalSource = loadedAnchor.elements.find(element => element.id === 'action-A');
  loadedAnchor.annotations = [{ id: 'loaded-annotation', createdAt: 1, updatedAt: 1, body: '合成载入批注', status: 'pending',
    anchorState: 'current', anchor: captureTextAnchor(originalSource, 0, 2) }];
  loadedAnchor.elements = loadedAnchor.elements.map(element => element.id === 'action-A' ? { ...element, text: '合成已改原文' } : element);
  same('opening mismatched current text anchor marks changed', parseProject(JSON.stringify({ project: loadedAnchor })).annotations[0].anchorState, 'changed');
  loadedAnchor.elements = loadedAnchor.elements.filter(element => element.id !== 'action-A');
  same('opening deleted current text anchor marks missing', parseProject(JSON.stringify({ project: loadedAnchor })).annotations[0].anchorState, 'missing');
  loadedAnchor.annotations[0].anchor = captureSceneAnchor(loadedAnchor.elements.find(element => element.id === 'heading-A'));
  loadedAnchor.elements = loadedAnchor.elements.map(element => element.id === 'heading-A' ? { ...element, type: 'general' } : element);
  same('opening former scene anchor now pointing to general text marks missing', parseProject(JSON.stringify({ project: loadedAnchor })).annotations[0].anchorState, 'missing');
  same('parser does not mutate the original annotation state', loadedAnchor.annotations[0].anchorState, 'current');

  console.log('review-store: scene order, metadata, ignore and roundtrip');
  reset();
  const sceneBody = state().project.elements;
  atomic('move first scene down', () => state().moveReviewScene('heading-A', 'heading-B', 'after', state().documentEpoch), p => {
    check('ABCD A down is BACD', p.elements.filter(el => el.type === 'scene_heading').map(el => el.id), ['heading-B', 'heading-A', 'heading-C', 'heading-D']);
    check('whole first scene follows heading', p.elements.slice(2, 4), sceneBody.slice(0, 2));
  });
  atomic('commit scene fields', () => state().commitReviewSceneMeta('heading-A', { synopsis: '合成改稿摘要', location: '合成地点', storyTime: '合成次日', revisionStatus: 'revising' }, state().documentEpoch));
  protectedBefore = protectedState();
  same('unchanged fields are no-op', state().commitReviewSceneMeta('heading-A', { location: '合成地点' }, state().documentEpoch), false);
  unchanged('scene metadata noop', protectedBefore);
  protectedBefore = protectedState();
  same('empty patch does not materialize old missing metadata', state().commitReviewSceneMeta('heading-D', {}, state().documentEpoch), false);
  unchanged('empty metadata patch', protectedBefore);
  same('empty defaults do not materialize old missing metadata', state().commitReviewSceneMeta('heading-D', { synopsis: '', location: '', storyTime: '', revisionStatus: undefined }, state().documentEpoch), false);
  unchanged('absent metadata defaults', protectedBefore);
  const emptyIssue = buildDeliveryChecks(state().project).find(issue => issue.kind === 'empty-scene');
  check('synthetic empty scene produces delivery issue', !!emptyIssue);
  atomic('ignore delivery issue', () => state().setDeliveryIgnored(emptyIssue.signature, true, state().documentEpoch), p => {
    check('ignored issue excluded from active checks', !activeDeliveryChecks(p).some(issue => issue.signature === emptyIssue.signature));
  });
  protectedBefore = protectedState();
  same('same ignore is no-op', state().setDeliveryIgnored(emptyIssue.signature, true, state().documentEpoch), false);
  unchanged('delivery ignore noop', protectedBefore);
  atomic('unignore delivery issue', () => state().setDeliveryIgnored(emptyIssue.signature, false, state().documentEpoch));
  state().undo();
  check('roundtrip setup named version', state().createNamedVersion('合成全部新字段'));
  check('roundtrip setup stash', state().stashWritingElements(['action-B'], '合成保留片段', '合成来源', false));
  check('roundtrip setup annotation', state().addAnnotation(captureSceneAnchor(state().project.elements.find(el => el.id === 'heading-A')), '合成整场意见'));
  const allNewData = state().project;
  const reopened = parseProject(serializeProject(allNewData));
  for (const key of ['revisionWorkspace', 'annotations', 'deliveryIgnored', 'sceneMeta', 'elements', 'beats', 'boardLinks']) {
    check(`save/reopen preserves ${key}`, reopened[key], allNewData[key]);
  }
  same('roundtrip validation never replaces live project', state().project, allNewData);
  const capped = fixture();
  capped.deliveryIgnored = Array.from({ length: 1000 }, (_, index) => `delivery:1:empty-scene:${index.toString(16).padStart(16, '0')}`);
  reset(capped);
  protectedBefore = protectedState();
  same('clearing ignores rejects stale epoch', state().clearDeliveryIgnored(state().documentEpoch - 1), false);
  unchanged('stale clear ignores', protectedBefore);
  atomic('explicit clearing releases all expired ignore records', () => state().clearDeliveryIgnored(state().documentEpoch), p => {
    check('all historical ignores cleared', p.deliveryIgnored, []);
    check('body remains identical', p.elements, capped.elements);
  });
  protectedBefore = protectedState();
  same('empty ignore clearing is no-op', state().clearDeliveryIgnored(state().documentEpoch), false);
  unchanged('empty clear ignores', protectedBefore);
  console.log(`review-store: ${checks} assertions passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
