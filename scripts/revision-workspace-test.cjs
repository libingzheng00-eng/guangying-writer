/** Named text versions and explicit stash: synthetic data only, no app or user storage. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const repo = path.resolve(__dirname, '..');
let checks = 0;
function check(name, actual, ...expected) { assert.deepEqual(actual, expected.length ? expected[0] : true, name); checks++; }
function rejects(name, action) { assert.throws(action, undefined, name); checks++; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)) };
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-revision-workspace-'));
  try {
    const bundle = path.join(temporary, 'revision-workspace.cjs');
    await esbuild.build({
      stdin: { contents: `export * from './src/model/revisionWorkspace';
        export { createProject } from './src/model/project';
        export { parseProject, serializeProject } from './src/io/zhsp';
        export * from './src/app/autosaveStorage';`, resolveDir: repo, loader: 'ts' },
      bundle: true, outfile: bundle, platform: 'node', format: 'cjs', target: 'es2020', logLevel: 'silent',
    });
    const api = require(bundle);
    const { captureWritingFragment, createNamedVersion, renameNamedVersion, deleteNamedVersion,
      createStashEntry, renameStashEntry, deleteStashEntry, buildInsertPlan,
      compareWritingSnapshots, parseRevisionWorkspace, revisionWorkspaceUsage,
      REVISION_WORKSPACE_LIMITS: limits, createProject, parseProject, serializeProject,
      writeRecovery, readRecovery, AUTOSAVE_KEY, UNREADABLE_AUTOSAVE_KEY } = api;

    function fixture() {
      const project = createProject('合成版本专项');
      project.elements = [
        { id: 'pre-action', type: 'action', text: '合成场前说明' },
        { id: 'scene-a', type: 'scene_heading', text: '内景 合成甲场 日' },
        { id: 'action-a', type: 'action', text: '<b>合成动作甲</b><br>第二行', rev: 'rev-a', sceneId: 'meta-a' },
        { id: 'left-character', type: 'character', text: '合成人物左', dual: 'left', dualGroup: 'dual-a' },
        { id: 'left-dialogue', type: 'dialogue', text: '合成左列对白', dual: 'left', dualGroup: 'dual-a' },
        { id: 'right-character', type: 'character', text: '合成人物右', dual: 'right', dualGroup: 'dual-a' },
        { id: 'right-dialogue', type: 'dialogue', text: '合成右列对白', dual: 'right', dualGroup: 'dual-a' },
        { id: 'scene-b', type: 'scene_heading', text: '外景 合成乙场 夜', omit: true },
        { id: 'action-b', type: 'action', text: '合成动作乙' },
        { id: 'scene-c', type: 'scene_heading', text: '内景 合成丙场 日' },
        { id: 'action-c', type: 'action', text: '合成动作丙' },
      ];
      project.sceneMeta = [
        { id: 'meta-a', elementId: 'scene-a', title: '合成甲标题', synopsis: '合成甲梗概', color: '#cfe4ff', actId: 'act-1', x: 40, y: 50 },
        { id: 'meta-b', elementId: 'scene-b', title: '合成乙标题', synopsis: '合成乙梗概', color: '#ffe08a', omit: true },
        { id: 'meta-c', elementId: 'scene-c', title: '合成丙标题', synopsis: '合成丙梗概', color: '#ffffff' },
      ];
      project.beats = [{ id: 'image-a', kind: 'image', text: '合成图片备注', title: '合成图片', color: '#fff', x: 500, y: 50,
        img: 'data:image/png;base64,c3ludGhldGlj', sceneId: 'meta-a' }];
      project.boardLinks = [{ id: 'link-a', from: 'scene:scene-a', to: 'beat:image-a', note: '合成关系' }];
      return project;
    }
    const empty = () => ({ schema: 1, versions: [], stash: [] });
    const source = (project, fragment = { elements: project.elements.slice(1, 7) }) => ({ projectId: project.id, sceneHeadingId: 'scene-a', sceneLabel: '合成甲场', elementIds: fragment.elements.map(item => item.id) });
    const content = (text = '合成短文') => ({ elements: [{ id: 'fragment-action', type: 'action', text }], sceneMeta: [] });

    console.log('revision-workspace: capture and image isolation');
    const project = freeze(fixture());
    const original = JSON.stringify(project);
    const all = captureWritingFragment(project, { kind: 'all' });
    check('all capture preserves screenplay order and formatted text', all.elements, project.elements);
    check('all capture has only text and scene metadata', Object.keys(all).sort(), ['elements', 'sceneMeta']);
    check('all capture retains scene synopsis', all.sceneMeta.find(meta => meta.elementId === 'scene-a').synopsis, '合成甲梗概');
    check('text snapshot excludes board geometry', all.sceneMeta.some(meta => 'x' in meta || 'y' in meta || 'w' in meta || 'h' in meta), false);
    const scene = captureWritingFragment(project, { kind: 'scene', headingId: 'scene-a' });
    check('scene capture stops before the next heading', scene.elements.map(item => item.id), project.elements.slice(1, 7).map(item => item.id));
    check('scene capture keeps only its metadata', scene.sceneMeta.map(item => item.elementId), ['scene-a']);
    const selected = captureWritingFragment(project, { kind: 'elements', ids: ['action-b', 'action-a'] });
    check('selected elements follow document order', selected.elements.map(item => item.id), ['action-a', 'action-b']);
    check('unselected scene headings do not bring unrelated scene metadata', selected.sceneMeta, []);
    check('preamble capture excludes every scene', captureWritingFragment(project, { kind: 'preamble' }).elements.map(item => item.id), ['pre-action']);
    rejects('missing scene fails without choosing a different scene', () => captureWritingFragment(project, { kind: 'scene', headingId: 'missing' }));
    rejects('unknown selection ID is rejected', () => captureWritingFragment(project, { kind: 'elements', ids: ['missing'] }));
    check('capture never mutates the source project', JSON.stringify(project), original);
    const oldPartial = fixture(); oldPartial.sceneMeta[0] = { id: 'meta-a', elementId: 'scene-a' };
    const capturedPartial = captureWritingFragment(oldPartial, { kind: 'scene', headingId: 'scene-a' });
    check('old partial scene metadata remains capturable', [capturedPartial.sceneMeta[0].id, capturedPartial.sceneMeta[0].elementId], ['meta-a', 'scene-a']);
    check('old missing story fields receive safe capture defaults', [typeof capturedPartial.sceneMeta[0].title, typeof capturedPartial.sceneMeta[0].synopsis, typeof capturedPartial.sceneMeta[0].color], ['string', 'string', 'string']);
    check('capture defaults do not write back into an old project', Object.keys(oldPartial.sceneMeta[0]).sort(), ['elementId', 'id']);
    const hiddenImages = fixture();
    hiddenImages.elements[2].img = 'data:image/png;base64,syntheticElementImage';
    hiddenImages.sceneMeta[0].img = 'data:image/png;base64,syntheticMetaImage';
    hiddenImages.revisionWorkspace = { syntheticIgnored: 'data:image/png;base64,syntheticNestedImage' };
    const hiddenCapture = captureWritingFragment(hiddenImages);
    check('unexpected image fields and nested workspace do not enter captured writing', /data:image|syntheticIgnored|revisionWorkspace/.test(JSON.stringify(hiddenCapture)), false);

    const largeImages = fixture();
    largeImages.beats[0].img = 'data:image/png;base64,' + 'A'.repeat(20 * 1024 * 1024);
    largeImages.revisionWorkspace = createNamedVersion(fixture(), '合成先前版本');
    const imageReference = largeImages.beats[0].img;
    const imageVersion = createNamedVersion(largeImages, '合成含大图工程的文本版');
    check('new version is added without copying old versions into itself', imageVersion.versions.length, 2);
    check('existing and new version contents never recursively include a workspace', imageVersion.versions.map(version => Object.keys(version.content).sort()), [['elements', 'sceneMeta'], ['elements', 'sceneMeta']]);
    check('20 MiB image is absent from every text version', JSON.stringify(imageVersion).includes('data:image/'), false);
    check('text workspace remains small despite large source image', revisionWorkspaceUsage(imageVersion).bytes < 32 * 1024);
    check('capture leaves original image exactly intact', largeImages.beats[0].img, imageReference);
    delete largeImages.beats[0].img;

    console.log('revision-workspace: names, limits and immutable operations');
    check('published capacity limits remain explicit', [limits.versions, limits.stash, limits.bytes, limits.name, limits.description], [20, 100, 2 * 1024 * 1024, 120, 2000]);
    let workspace = createNamedVersion(project, '合成第一稿', '合成版本说明');
    check('version metadata is complete', [workspace.schema, workspace.versions[0].name, workspace.versions[0].description,
      typeof workspace.versions[0].id, Number.isFinite(workspace.versions[0].createdAt)], [1, '合成第一稿', '合成版本说明', 'string', true]);
    check('version starts with an empty explicit stash', workspace.stash, []);
    check('creation leaves original document and revision colors untouched', JSON.stringify(project), original);
    const frozenWorkspace = freeze(clone(workspace));
    const named = renameNamedVersion(frozenWorkspace, frozenWorkspace.versions[0].id, '合成改名', '合成新说明');
    check('rename returns edited metadata', [named.versions[0].name, named.versions[0].description], ['合成改名', '合成新说明']);
    check('rename preserves captured text', named.versions[0].content, frozenWorkspace.versions[0].content);
    check('rename leaves old workspace unchanged', frozenWorkspace.versions[0].name, '合成第一稿');
    check('deleting version does not affect source workspace', [deleteNamedVersion(named, named.versions[0].id).versions.length, named.versions.length], [0, 1]);
    for (const badName of ['', '   ', '名'.repeat(limits.name + 1), {}, null]) {
      rejects('invalid version name rejected', () => createNamedVersion(project, badName));
    }
    rejects('overlong version description rejected', () => createNamedVersion(project, '合成版本', '述'.repeat(limits.description + 1)));
    check('maximum name and description remain accepted', createNamedVersion(project, '名'.repeat(limits.name), '述'.repeat(limits.description)).versions[0].name.length, limits.name);
    for (let index = 1; index < limits.versions; index++) workspace = createNamedVersion({ ...project, revisionWorkspace: workspace }, `合成版本${index}`);
    check('all allowed versions fit', workspace.versions.length, limits.versions);
    const fullVersions = JSON.stringify(workspace);
    rejects('version count refuses overflow without dropping oldest', () => createNamedVersion({ ...project, revisionWorkspace: freeze(workspace) }, '合成超限版本'));
    check('version overflow leaves all existing versions unchanged', JSON.stringify(workspace), fullVersions);

    let stashWorkspace = createStashEntry(empty(), scene, { name: '合成删稿', description: '合成删除说明', kind: 'deleted', source: source(project) });
    const initialStash = freeze(clone(stashWorkspace));
    check('stash source and reason survive creation', [stashWorkspace.stash[0].kind, stashWorkspace.stash[0].source], ['deleted', source(project)]);
    stashWorkspace = renameStashEntry(initialStash, initialStash.stash[0].id, '合成保留稿', '合成补充说明');
    check('stash rename edits metadata only', [stashWorkspace.stash[0].name, stashWorkspace.stash[0].description, stashWorkspace.stash[0].content],
      ['合成保留稿', '合成补充说明', initialStash.stash[0].content]);
    check('stash rename leaves old value unchanged', initialStash.stash[0].name, '合成删稿');
    check('stash deletion returns an empty stash without modifying source', [deleteStashEntry(stashWorkspace, stashWorkspace.stash[0].id).stash.length, stashWorkspace.stash.length], [0, 1]);
    for (const kind of ['alternative', 'excerpt']) {
      const saved = createStashEntry(empty(), content(), { name: '合成片段', kind, source: { projectId: project.id, elementIds: ['fragment-action'] } });
      check(`explicit ${kind} kind retained`, saved.stash[0].kind, kind);
    }
    rejects('stash invalid name rejected', () => createStashEntry(empty(), content(), { name: ' ', source: source(project) }));
    rejects('stash overlong description rejected', () => createStashEntry(empty(), content(), { name: '合成片段', description: '述'.repeat(limits.description + 1), source: source(project) }));
    for (let index = 1; index < limits.stash; index++) stashWorkspace = createStashEntry(stashWorkspace, content(), { name: `合成片段${index}`, kind: 'excerpt', source: source(project, content()) });
    check('all allowed stash entries fit', stashWorkspace.stash.length, limits.stash);
    const fullStash = JSON.stringify(stashWorkspace);
    rejects('stash count refuses overflow without deleting an existing draft', () => createStashEntry(freeze(stashWorkspace), content(), { name: '合成超限片段', source: source(project, content()) }));
    check('stash overflow is immutable', JSON.stringify(stashWorkspace), fullStash);
    const asciiProject = fixture(); asciiProject.elements = content('a'.repeat(800000)).elements; asciiProject.sceneMeta = [];
    const asciiVersion = createNamedVersion(asciiProject, '合成英文容量');
    check('an 800000-byte body fits the two-MiB workspace', revisionWorkspaceUsage(asciiVersion).bytes < limits.bytes);
    check('usage reports actual serialized UTF-8 bytes', revisionWorkspaceUsage(asciiVersion).bytes, Buffer.byteLength(JSON.stringify(asciiVersion), 'utf8'));
    const twoAsciiVersions = createNamedVersion({ ...asciiProject, revisionWorkspace: asciiVersion }, '合成英文容量二');
    check('two individually large versions share one budget and still fit', [twoAsciiVersions.versions.length, revisionWorkspaceUsage(twoAsciiVersions).bytes < limits.bytes], [2, true]);
    const beforeCombinedOverflow = JSON.stringify(twoAsciiVersions);
    rejects('individually valid third version cannot exceed aggregate workspace budget', () => createNamedVersion({ ...asciiProject, revisionWorkspace: freeze(twoAsciiVersions) }, '合成累计超限'));
    check('aggregate overflow never prunes or changes old versions', JSON.stringify(twoAsciiVersions), beforeCombinedOverflow);
    const largeStash = content('a'.repeat(1400000));
    rejects('versions and stash share the same total byte budget', () => createStashEntry(freeze(asciiVersion), largeStash, { name: '合成混合累计超限', source: source(project, largeStash) }));
    const chineseProject = fixture(); chineseProject.elements = content('文'.repeat(800000)).elements; chineseProject.sceneMeta = [];
    rejects('UTF-8 capacity catches text below code-unit limit', () => createNamedVersion(chineseProject, '合成中文超限'));
    rejects('UTF-8 capacity applies equally to stash content', () => createStashEntry(empty(), content('文'.repeat(800000)), { name: '合成片段超限', source: source(project, content()) }));

    console.log('revision-workspace: insertion identity and scene comparisons');
    const plan = buildInsertPlan(freeze(scene));
    const again = buildInsertPlan(scene);
    const oldIds = new Set([...scene.elements, ...scene.sceneMeta].map(item => item.id));
    const insertedIds = new Set([...plan.elements, ...plan.sceneMeta].map(item => item.id));
    check('each inserted element and metadata gets a unique new ID', insertedIds.size, plan.elements.length + plan.sceneMeta.length);
    check('inserted IDs cannot alias captured IDs', [...insertedIds].some(id => oldIds.has(id)), false);
    check('repeated insertion generates another independent set of IDs', [...again.elements, ...again.sceneMeta].some(item => insertedIds.has(item.id)), false);
    check('insert plan preserves order, basic format and dual side', plan.elements.map(({ type, text, dual }) => ({ type, text, dual })), scene.elements.map(({ type, text, dual }) => ({ type, text, dual })));
    check('inserted scene metadata points to the new heading', plan.sceneMeta[0].elementId, plan.elements[0].id);
    check('unavailable revision/act references are not imported', plan.elements.some(item => item.rev !== undefined) || plan.sceneMeta.some(item => item.actId !== undefined), false);
    check('internal scene association is remapped to inserted metadata', plan.elements[1].sceneId, plan.sceneMeta[0].id);
    const duals = plan.elements.filter(item => item.dualGroup).map(item => item.dualGroup);
    check('dual dialogue keeps one shared newly allocated group', [duals.length, new Set(duals).size, duals.includes('dual-a')], [4, 1, false]);
    check('insertion does not mutate captured content', scene.elements[1].rev, 'rev-a');
    const targetPlan = buildInsertPlan(scene, project);
    check('target project permits existing revision and act IDs', [targetPlan.elements[1].rev, targetPlan.sceneMeta[0].actId], ['rev-a', 'act-1']);
    const externalReference = clone(scene); externalReference.elements[1].sceneId = 'unavailable-scene';
    check('unavailable scene association is removed rather than pointing into another draft', buildInsertPlan(externalReference).elements[1].sceneId, undefined);
    const storyFields = clone(scene);
    Object.assign(storyFields.sceneMeta[0], { location: '地'.repeat(500), storyTime: '合成次日', revisionStatus: 'revising' });
    const storyPlan = buildInsertPlan(storyFields, project);
    check('restoration preserves bounded story review fields', [storyPlan.sceneMeta[0].location, storyPlan.sceneMeta[0].storyTime, storyPlan.sceneMeta[0].revisionStatus], ['地'.repeat(500), '合成次日', 'revising']);
    storyFields.sceneMeta[0].location += '地';
    rejects('archive cannot restore a location the active project parser would reject', () => buildInsertPlan(storyFields, project));
    const partialDual = captureWritingFragment(project, { kind: 'elements', ids: ['left-character', 'left-dialogue'] });
    const partialPlan = buildInsertPlan(partialDual);
    check('partial dual dialogue becomes ordinary text with warning', [partialPlan.elements.some(item => item.dual || item.dualGroup), partialPlan.warnings.length > 0], [false, true]);

    const before = captureWritingFragment(project);
    const identical = compareWritingSnapshots(before, clone(before));
    check('identical snapshots have no change flags', identical.some(item => item.added || item.deleted || item.modified || item.moved), false);
    const comparisonLeft = freeze(clone(before)), comparisonRight = freeze(clone(before));
    const comparisonBytes = [JSON.stringify(comparisonLeft), JSON.stringify(comparisonRight)];
    compareWritingSnapshots(comparisonLeft, comparisonRight);
    check('no-op comparison preserves both input objects and all data', [JSON.stringify(comparisonLeft), JSON.stringify(comparisonRight)], comparisonBytes);
    const absentMeta = { elements: clone(before.elements), sceneMeta: [] };
    const defaultMeta = clone(absentMeta);
    defaultMeta.sceneMeta = [{ id: 'later-meta', elementId: 'scene-a', title: '', synopsis: '', color: '#cfe4ff' }];
    check('lazily added empty default metadata does not mark unchanged prose modified', compareWritingSnapshots(absentMeta, defaultMeta).some(item => item.modified), false);
    const boardMoved = clone(before); boardMoved.sceneMeta[0].x = 999; boardMoved.sceneMeta[0].y = 888; boardMoved.sceneMeta[0].w = 700; boardMoved.sceneMeta[0].h = 600;
    check('board-only geometry changes do not mark text scenes modified', compareWritingSnapshots(before, boardMoved).some(item => item.modified), false);
    const prepended = clone(before);
    prepended.elements.splice(1, 0, { id: 'scene-new', type: 'scene_heading', text: '外景 合成新增场 日' }, { id: 'action-new', type: 'action', text: '合成新增动作' });
    const insertionDiff = compareWritingSnapshots(before, prepended);
    check('prepending a scene adds one scene', insertionDiff.filter(item => item.added).length, 1);
    check('prepending does not falsely mark every later scene moved', insertionDiff.some(item => item.moved), false);
    const reordered = clone(before);
    const lastScene = reordered.elements.splice(9, 2);
    reordered.elements.splice(1, 0, ...lastScene);
    const movementDiff = compareWritingSnapshots(before, reordered);
    check('one scene reordered produces a minimal moved scene set', movementDiff.filter(item => item.moved).length, 1);
    check('moving intact scenes does not claim added/deleted/modified', movementDiff.some(item => item.added || item.deleted || item.modified), false);
    const changed = clone(before); changed.elements.find(item => item.id === 'action-b').text = '合成乙动作改稿';
    const changedDiff = compareWritingSnapshots(before, changed);
    check('a body edit modifies exactly its containing scene', changedDiff.filter(item => item.modified).length, 1);
    check('a body edit does not claim moves or structural additions', changedDiff.some(item => item.added || item.deleted || item.moved), false);
    const deleted = clone(before); deleted.elements.splice(7, 2); deleted.sceneMeta = deleted.sceneMeta.filter(meta => meta.elementId !== 'scene-b');
    const deletedDiff = compareWritingSnapshots(before, deleted);
    check('deleting one scene reports one deletion without downstream moves', [deletedDiff.filter(item => item.deleted).length, deletedDiff.some(item => item.moved)], [1, false]);
    const preambleChanged = clone(before); preambleChanged.elements[0].text = '合成场前改稿';
    check('scene-free preamble changes remain visible', compareWritingSnapshots(before, preambleChanged).filter(item => item.modified).length, 1);

    console.log('revision-workspace: untrusted input and project/recovery round trips');
    check('missing workspace stays absent', parseRevisionWorkspace(undefined), undefined);
    for (const invalid of [null, [], 1, { schema: 2, versions: [], stash: [] }, { schema: 1, versions: {}, stash: [] }, { schema: 1, versions: [], stash: {} }]) {
      rejects('malformed workspace is rejected rather than replaced by blank', () => parseRevisionWorkspace(invalid));
    }
    const valid = createNamedVersion(project, '合成持久版', '合成持久说明');
    valid.stash = createStashEntry(valid, scene, { name: '合成持久暂存', kind: 'alternative', source: { ...source(project), versionId: valid.versions[0].id } }).stash;
    const hostile = clone(valid);
    hostile.versions[0].content.elements[1].text = '<script>syntheticAttack()</script><b onclick="syntheticAttack()">合成安全字</b><img src="https://fixture.invalid/secret">';
    const cleaned = parseRevisionWorkspace(hostile);
    const cleanText = cleaned.versions[0].content.elements[1].text;
    check('snapshot HTML sanitization retains supported formatted text', cleanText.includes('<b>合成安全字</b>'));
    check('snapshot HTML removes active content and resource URLs', /script|onclick|<img|fixture\.invalid|syntheticAttack/i.test(cleanText), false);
    const hostileStash = clone(valid); hostileStash.stash[0].content.elements[1].text = '<iframe src="https://fixture.invalid"></iframe><i>合成暂存字</i>';
    check('stash uses the same HTML sanitizer', parseRevisionWorkspace(hostileStash).stash[0].content.elements[1].text, '<i>合成暂存字</i>');
    for (const mutate of [
      value => { value.versions[0].id = '__proto__'; },
      value => { value.versions[0].name = {}; },
      value => { value.versions[0].name = '名'.repeat(limits.name + 1); },
      value => { value.versions[0].description = '述'.repeat(limits.description + 1); },
      value => { value.versions[0].createdAt = 'yesterday'; },
      value => { value.versions[0].content.beats = [{ img: 'data:image/png;base64,AA==' }]; },
      value => { value.versions[0].content.elements = {}; },
      value => { value.versions[0].content.elements[0].id = 'bad"id'; },
      value => { value.versions[0].content.elements[0].text = {}; },
      value => { value.versions[0].content.elements.push(clone(value.versions[0].content.elements[0])); },
      value => { value.stash[0].source.elementIds = 'bad'; },
      value => { value.stash[0].kind = 'unknown'; },
      value => { value.stash[0].id = value.versions[0].id; },
      value => { value.stash[0].source.elementIds.reverse(); },
    ]) {
      const malformed = clone(valid); mutate(malformed);
      rejects('malformed nested version/stash input is rejected', () => parseRevisionWorkspace(malformed));
    }
    const oversizedInput = clone(valid); oversizedInput.versions[0].content.elements = content('文'.repeat(800000)).elements;
    rejects('loaded workspace obeys the same aggregate UTF-8 limit', () => parseRevisionWorkspace(oversizedInput));
    const tooMany = clone(valid); tooMany.versions = Array.from({ length: limits.versions + 1 }, (_, index) => ({ ...clone(valid.versions[0]), id: `version-cap-${index}` }));
    rejects('loaded workspace cannot bypass version count limit', () => parseRevisionWorkspace(tooMany));
    const tooManyStash = clone(valid); tooManyStash.stash = Array.from({ length: limits.stash + 1 }, (_, index) => ({ ...clone(valid.stash[0]), id: `stash-cap-${index}` }));
    rejects('loaded workspace cannot bypass stash count limit', () => parseRevisionWorkspace(tooManyStash));

    const legacy = fixture(); legacy.trash = [{ id: 'legacy-deleted', type: 'dialogue', text: '<u>合成旧删稿</u>' }];
    const reopenedLegacy = parseProject(serializeProject(legacy));
    check('known legacy trash survives save and reopen', reopenedLegacy.trash, legacy.trash);
    check('old project is not silently given an empty new workspace', reopenedLegacy.revisionWorkspace, undefined);
    const withWorkspace = { ...legacy, revisionWorkspace: valid };
    const reopened = parseProject(serializeProject(withWorkspace));
    check('named versions and stash round trip in zhsp', reopened.revisionWorkspace, valid);
    check('legacy trash remains independent of explicit stash', [reopened.trash, reopened.revisionWorkspace.stash.length], [legacy.trash, 1]);
    check('text history does not change main screenplay, image or old revision palette', [reopened.elements, reopened.beats, reopened.revisions], [legacy.elements, legacy.beats, legacy.revisions]);
    const storage = memoryStorage();
    writeRecovery(storage, { project: withWorkspace, filePath: '/synthetic/revision-workspace.zhsp' });
    const restored = readRecovery(storage);
    check('recovery preserves named versions, explicit stash and old trash', [restored.snapshot.project.revisionWorkspace, restored.snapshot.project.trash], [valid, legacy.trash]);
    check('normal recovery continues to have only one full project payload', storage.values.size, 1);
    const acceptedRaw = storage.values.get(AUTOSAVE_KEY);
    const corruptProject = { ...withWorkspace, revisionWorkspace: { ...valid, schema: 999 } };
    rejects('outgoing invalid workspace cannot overwrite valid recovery', () => writeRecovery(storage, { project: corruptProject, filePath: null }));
    check('rejected outgoing workspace leaves exact prior recovery bytes', storage.values.get(AUTOSAVE_KEY), acceptedRaw);
    const rejectedRaw = JSON.stringify({ project: corruptProject, filePath: null });
    const rejectedStorage = memoryStorage({ [AUTOSAVE_KEY]: rejectedRaw });
    check('bad workspace schema does not restore a silently truncated project', readRecovery(rejectedStorage).snapshot, null);
    writeRecovery(rejectedStorage, { project: fixture(), filePath: null });
    check('bad workspace recovery is protected byte for byte before replacement', rejectedStorage.values.get(UNREADABLE_AUTOSAVE_KEY), rejectedRaw);

    console.log(`revision-workspace: ${checks} assertions passed (synthetic model/schema/memory storage; no UI or Electron test)`);
  } finally {
    // This exact mkdtemp-owned directory contains only this test's generated bundle.
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
