/** Synthetic read-only checks, all text converters and DOM snapshot boundaries.
 * No native application, user files, clipboard or network is used. Geometry is
 * synthetic: this cannot replace actual hidden Electron/PDF acceptance. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
let checks = 0;
function check(label, actual, expected = true) { assert.deepEqual(actual, expected, label); checks++; }
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

(async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://delivery.invalid/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLImageElement', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : dom.window[name] });
  }
  // jsdom does not implement pseudo computed style, and styles are irrelevant to
  // these structural/geometry assertions. Native screenshots remain separate.
  globalThis.getComputedStyle = node => dom.window.getComputedStyle(node);
  const built = await esbuild.build({
    stdin: { contents: `
      export * from './src/model/deliveryChecks';
      export {createProject} from './src/model/project';
      export {toFdx} from './src/io/fdx';
      export {toPlainText,toMarkdown,toHtml} from './src/io/textscript';
      export {buildCreativePdf,creativeKeepRanges,creativePageCuts} from './src/io/creativePdf';
      export {paginateMeasured,PaginationProvider} from './src/hooks/PaginationProvider';
      export {PreviewView} from './src/components/PreviewView';
      export {useStore} from './src/store/store';
    `, resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent',
  });
  const runtime = new Module(path.join(root, 'delivery-checks-runtime.cjs'));
  runtime.filename = path.join(root, 'delivery-checks-runtime.cjs'); runtime.paths = module.paths;
  runtime._compile(built.outputFiles[0].text, runtime.filename);
  const api = runtime.exports;
  const element = (id, type, text = '', extra = {}) => ({ id, type, text, ...extra });
  const project = () => { const p = api.createProject(); p.titlePage.show = false; return p; };
  const byKind = (p, kind) => api.buildDeliveryChecks(p).filter(issue => issue.kind === kind);

  const p = project();
  p.elements = [element('s1', 'scene_heading', '内景 合成空场 日'), element('a1', 'action', '<b> </b><br>&nbsp;'), element('n1', 'note', '备忘不充当正文'),
    element('s2', 'scene_heading', '内景 合成有内容 日'), element('a2', 'action', '有效正文'),
    element('s3', 'scene_heading', '内景 合成省略 日'), element('a3', 'action', '', { omit: true })];
  p.sceneMeta = [{ id: 'meta3', elementId: 's3', title: '', synopsis: '', color: '#fff', omit: true }];
  const before = clone(p);
  freeze(p);
  const empty = byKind(p, 'empty-scene');
  check('empty scene ignores notes, blank rich text and omitted scenes', empty.map(issue => issue.elementIds), [['s1']]);
  check('checking frozen project changes nothing', p, before);
  const moved = clone(p); moved.elements = [...moved.elements.slice(3, 5), ...moved.elements.slice(0, 3), ...moved.elements.slice(5)];
  check('scene movement/number changes preserve signature', byKind(moved, 'empty-scene')[0].signature, empty[0].signature);
  moved.deliveryIgnored = [empty[0].signature];
  check('ignore suppresses only matching current issue', api.activeDeliveryChecks(moved).length, 0);
  moved.elements.find(e => e.id === 's1').text = '内景 改动后的合成标题 日';
  check('relevant content edit requires renewed review', api.activeDeliveryChecks(moved).length, 1);
  moved.elements.find(e => e.id === 'a1').text = '现在有正文';
  check('adding body resolves empty-scene issue', byKind(moved, 'empty-scene').length, 0);
  check('ignore validation deduplicates valid entries', api.normalizeDeliveryIgnored([empty[0].signature, empty[0].signature]), [empty[0].signature]);
  for (const invalid of [null, {}, [null], ['random'], ['delivery:1:unknown:0000000000000000']]) {
    assert.throws(() => api.normalizeDeliveryIgnored(invalid), /忽略记录格式不正确/); checks++;
  }
  check('legacy project may omit ignore field', api.normalizeDeliveryIgnored(undefined), []);
  const validMany = Array.from({ length: 1100 }, (_, i) => `delivery:1:empty-scene:${i.toString(16).padStart(16, '0')}`);
  assert.throws(() => api.normalizeDeliveryIgnored(validMany), /1000/); checks++;
  check('exactly 1000 ignored signatures are preserved', api.normalizeDeliveryIgnored(validMany.slice(0, 1000)).length, 1000);

  const names = (values) => { const value = project(); value.elements = values.map((name, i) => element(`name-${i}`, 'character', name)); return value; };
  check('case/width/spacing variation prompts', byKind(names(['ALICE', 'Ａｌｉｃｅ']), 'character-name').length, 1);
  check('recognized speaking extensions are not a rename discrepancy', byKind(names(['林小明', '林小明（V.O.）', '林小明 (CONT’D)']), 'character-name').length, 0);
  check('age qualifiers remain intentional names', byKind(names(['林小明（青年）', '林小明（老年）']), 'character-name').length, 0);
  check('short names and family suffixes are not guessed', byKind(names(['小明', '小朋', '小明妈妈', '小明']), 'character-name').length, 0);
  check('role variants are not guessed', byKind(names(['警察甲', '警察甲', '警察甲', '警察乙']), 'character-name').length, 0);
  check('rare long-name one-character mismatch is advisory', byKind(names(['林小明', '林小明', '林小明', '林晓明']), 'character-name').length, 1);
  check('two established near names are not guessed', byKind(names(['林小明', '林小明', '林小明', '林晓明', '林晓明']), 'character-name').length, 0);
  const named = names(['ALICE', 'Alice']);
  const nameSignature = byKind(named, 'character-name')[0].signature;
  named.elements.reverse();
  check('name issue identity does not depend on source order', byKind(named, 'character-name')[0].signature, nameSignature);
  named.deliveryIgnored = [nameSignature];
  named.elements[0].text = 'alice';
  check('different spelling is reviewed again', api.activeDeliveryChecks(named).length, 1);

  const annotated = project(); annotated.elements = [element('body1', 'action', 'PUBLIC_BODY_SENTINEL')];
  annotated.annotations = [
    { id: 'pending', body: 'ANNOTATION_SECRET_SENTINEL', status: 'pending', createdAt: 1, updatedAt: 1, anchorState: 'current', anchor: { kind: 'text', elementId: 'body1', start: 0, end: 2, quote: 'PU', sourceText: 'PUBLIC_BODY_SENTINEL' } },
    { id: 'orphan', body: 'ORPHAN_SECRET_SENTINEL', status: 'pending', createdAt: 1, updatedAt: 1, anchorState: 'missing', anchor: { kind: 'text', elementId: 'gone', start: 0, end: 1, quote: 'x', sourceText: 'x' } },
    { id: 'resolved', body: 'RESOLVED_SECRET_SENTINEL', status: 'resolved', createdAt: 1, updatedAt: 1, anchorState: 'current', anchor: { kind: 'text', elementId: 'body1', start: 0, end: 2, quote: 'PU', sourceText: 'PUBLIC_BODY_SENTINEL' } },
    { id: 'rejected', body: 'DECLINED_SECRET_SENTINEL', status: 'declined', reason: 'DECISION_SECRET_SENTINEL', createdAt: 1, updatedAt: 1, anchorState: 'current', anchor: { kind: 'text', elementId: 'body1', start: 0, end: 2, quote: 'PU', sourceText: 'PUBLIC_BODY_SENTINEL' } },
  ];
  let pending = byKind(annotated, 'pending-annotation');
  check('resolved and declined excluded, pending orphan retained', pending.map(issue => [issue.annotationId, issue.elementIds]), [['pending', ['body1']], ['orphan', []]]);
  annotated.deliveryIgnored = [pending[0].signature, pending[1].signature];
  check('both pending annotations can be explicitly ignored', api.activeDeliveryChecks(annotated).length, 0);
  annotated.annotations[0].body += ' 内容修改';
  check('edited annotation is reviewed again', api.activeDeliveryChecks(annotated).map(issue => issue.annotationId), ['pending']);
  pending = byKind(annotated, 'pending-annotation'); annotated.deliveryIgnored = pending.map(issue => issue.signature);
  annotated.annotations[0].updatedAt = 2;
  check('reopened annotation revision is reviewed again', api.activeDeliveryChecks(annotated).length, 1);

  annotated.revisionWorkspace = { schema: 1,
    versions: [{ id: 'version', name: 'VERSION_SECRET_SENTINEL', description: '', createdAt: 1, content: { elements: [element('old-body', 'action', 'VERSION_BODY_SECRET_SENTINEL')], sceneMeta: [] } }],
    stash: [{ id: 'scrap', name: '合成暂存', description: '', createdAt: 1, kind: 'deleted', content: { elements: [element('deleted-body', 'action', 'SCRAP_SECRET_SENTINEL')], sceneMeta: [] }, source: { projectId: annotated.id, elementIds: ['deleted-body'] } }],
  };
  annotated.annotations[0].decision = 'DECISION_SECRET_SENTINEL';
  annotated.trash = [element('trash', 'action', 'TRASH_SECRET_SENTINEL')];
  const secrets = ['ANNOTATION_SECRET_SENTINEL', 'ORPHAN_SECRET_SENTINEL', 'RESOLVED_SECRET_SENTINEL', 'DECLINED_SECRET_SENTINEL', 'DECISION_SECRET_SENTINEL', 'VERSION_SECRET_SENTINEL', 'VERSION_BODY_SECRET_SENTINEL', 'SCRAP_SECRET_SENTINEL', 'TRASH_SECRET_SENTINEL'];
  const clean = clone(annotated);
  delete clean.annotations; delete clean.revisionWorkspace; delete clean.trash; delete clean.deliveryIgnored;
  freeze(annotated);
  for (const name of ['toFdx', 'toPlainText', 'toMarkdown', 'toHtml']) {
    const output = api[name](annotated);
    check(`${name}: workspace data cannot alter export bytes`, output, api[name](clean));
    check(`${name}: public body survives`, output.includes('PUBLIC_BODY_SENTINEL'));
    for (const secret of secrets) check(`${name}: no ${secret}`, output.includes(secret), false);
  }
  const notes = project(); notes.elements = [element('n', 'note', 'AUTHOR_PRINT_NOTE')];
  for (const enabled of [false, true]) {
    notes.settings.printNotes = enabled;
    for (const name of ['toPlainText', 'toHtml']) check(`${name}: printNotes=${enabled} preserved`, api[name](notes).includes('AUTHOR_PRINT_NOTE'), enabled);
    for (const name of ['toFdx', 'toMarkdown']) check(`${name}: existing note policy unchanged`, api[name](notes).includes('AUTHOR_PRINT_NOTE'), false);
  }
  const exportedHtml = new JSDOM(api.toHtml(clean));
  check('standalone HTML retains protective CSP', exportedHtml.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("default-src 'none'"));
  check('standalone HTML has print keep rules', exportedHtml.window.document.querySelector('style').textContent.includes('break-after:avoid'));
  exportedHtml.window.close();

  const range = (type, top, bottom) => ({ type, top, bottom });
  const units = [range('action', 0, 55), range('scene_heading', 60, 65), range('character', 70, 75), range('parenthetical', 80, 85), range('dialogue', 90, 110), range('character', 115, 120), range('dialogue', 125, 130)];
  const kept = api.creativeKeepRanges(units);
  check('heading and cue protection stops at first complete dialogue', kept[0], { top: 60, bottom: 110 });
  check('no protection swallows next speaking unit', kept.filter(item => item.top < 110).every(item => item.bottom === 110));
  check('creative boundary moves above heading and opening speech', api.creativePageCuts(150, [...units, ...kept], 100), [0, 60, 150]);
  const shorts = Array.from({ length: 8 }, (_, i) => [range('character', i * 20, i * 20 + 8), range('dialogue', i * 20 + 9, i * 20 + 18)]).flat();
  const shortRanges = api.creativeKeepRanges(shorts);
  check('short speech pairs never become one chained range', shortRanges.every(item => item.bottom - item.top === 18));
  check('short pair density retained', api.creativePageCuts(160, [...shorts, ...shortRanges], 100), [0, 100, 160]);
  check('unrelated scene is never attached to empty cue', api.creativeKeepRanges([range('character', 0, 10), range('scene_heading', 20, 30)]), []);
  assert.throws(() => api.creativePageCuts(250, [{ top: 0, bottom: 210 }], 100), /超长/); checks++;

  const rect = (left, top, width, height) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() {} });
  const setRect = (node, left, top, width, height) => { node.getBoundingClientRect = () => rect(left, top, width, height); };
  document.body.innerHTML = '<div class="app-shell"><div class="editor__scroll"><div class="script-flow"><div class="sc-el" data-id="heading" data-type="scene_heading">PUBLIC_HEADING</div><div class="sc-el" data-id="cue" data-type="character">PUBLIC_CUE</div><div class="sc-el" data-id="speech" data-type="dialogue">PUBLIC_SPEECH</div></div><article class="writing-material-card"><textarea>KEEP_MATERIAL_NOTE</textarea></article><aside data-export-exclude><div class="sc-el" data-type="scene_heading">ANNOTATION_SECRET_SENTINEL</div><input value="VERSION_SECRET_SENTINEL"><textarea>SCRAP_SECRET_SENTINEL</textarea></aside></div></div>';
  const canvas = document.querySelector('.editor__scroll'), flow = document.querySelector('.script-flow');
  // Scene itself exceeds 18000px: the historical complete-scene protection
  // deliberately does not apply, so this exercises the new semantic boundary.
  setRect(canvas, 0, 0, 1000, 40000); setRect(flow, 0, 0, 600, 40000);
  setRect(document.querySelector('[data-id=heading]'), 0, 17900, 600, 20);
  setRect(document.querySelector('[data-id=cue]'), 0, 17950, 600, 20);
  setRect(document.querySelector('[data-id=speech]'), 0, 18010, 600, 100);
  setRect(document.querySelector('.writing-material-card'), 700, 17800, 250, 100);
  setRect(document.querySelector('[data-export-exclude] .sc-el'), 50000, 0, 50000, 40000);
  const sourceBefore = document.body.innerHTML;
  const creative = api.buildCreativePdf(canvas);
  const captured = new JSDOM(creative.html);
  for (const secret of secrets) check(`creative snapshot excludes ${secret} entirely`, creative.html.includes(secret), false);
  check('creative materials remain present', creative.html.includes('KEEP_MATERIAL_NOTE'));
  check('creative exclusion does not affect dimensions', creative.pageSize.width < 300000);
  check('long-scene semantic keep begins next sheet at heading', captured.window.document.querySelector('.export-sheet').style.height, '17900px');
  check('source DOM/geometry is not rewritten by export', document.body.innerHTML, sourceBefore);
  check('private excluded input/textarea is not cloned', captured.window.document.querySelector('[data-export-exclude]'), null);
  captured.window.close();
  setRect(document.querySelector('[data-id=heading]'), 0, 0, 600, 20);
  const openingAction = document.createElement('div'); openingAction.className = 'sc-el'; openingAction.dataset.type = 'action'; openingAction.textContent = 'PUBLIC_OPENING';
  flow.insertBefore(openingAction, document.querySelector('[data-id=cue]')); setRect(openingAction, 0, 50, 600, 100);
  const cueSnapshot = new JSDOM(api.buildCreativePdf(canvas).html);
  check('long scene cut protects cue even far from scene heading', cueSnapshot.window.document.querySelector('.export-sheet').style.height, '17950px');
  cueSnapshot.window.close();

  flow.innerHTML = '<div class="sc-el" data-type="scene_heading">DUAL_HEADING</div><div class="sc-dual-row"><div class="sc-dual-col"><div class="sc-el" data-type="character">LEFT_CUE</div><div class="sc-el" data-type="dialogue">LEFT_FIRST</div><div class="sc-el" data-type="character">LEFT_NEXT</div><div class="sc-el" data-type="dialogue">LEFT_NEXT_SPEECH</div></div><div class="sc-dual-col"><div class="sc-el" data-type="character">RIGHT_CUE</div><div class="sc-el" data-type="dialogue">RIGHT_FIRST</div><div class="sc-el" data-type="character">RIGHT_NEXT</div><div class="sc-el" data-type="dialogue">RIGHT_NEXT_SPEECH</div></div></div>';
  setRect(flow.firstElementChild, 0, 0, 600, 20);
  setRect(flow.querySelector('.sc-dual-row'), 0, 100, 600, 39000);
  for (const [side, column] of [...flow.querySelectorAll('.sc-dual-col')].entries()) {
    for (const [index, node] of [...column.children].entries()) {
      const top = [100, 130, 17950, 18010][index];
      setRect(node, side * 300, top, 300, index % 2 ? 100 : 20);
    }
  }
  const dualSnapshot = new JSDOM(api.buildCreativePdf(canvas).html);
  check('tall dual row stays exportable without binding entire row to heading', dualSnapshot.window.document.querySelector('.export-sheet').style.height, '17950px');
  check('both dual columns survive semantic protection', ['LEFT_NEXT_SPEECH', 'RIGHT_NEXT_SPEECH'].every(text => dualSnapshot.window.document.body.textContent.includes(text)));
  dualSnapshot.window.close();

  // Actual A4 view and measurement provider, using synthetic jsdom heights.
  document.body.innerHTML = '<div id="root"></div>';
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require('react'); const { createRoot } = require('react-dom/client');
  const mounted = createRoot(document.getElementById('root'));
  api.useStore.setState({ project: annotated, version: 30, view: 'preview' });
  await React.act(async () => { mounted.render(React.createElement(api.PaginationProvider, null, React.createElement(api.PreviewView, { onExportPdf() {} }))); });
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 240)); });
  const preview = document.querySelector('.preview');
  check('A4 preview ready for current measured version', preview.dataset.ready, 'true');
  check('A4 preview includes current public body', preview.textContent.includes('PUBLIC_BODY_SENTINEL'));
  for (const secret of secrets) check(`A4 preview excludes ${secret}`, preview.outerHTML.includes(secret), false);
  await React.act(async () => mounted.unmount());
  dom.window.close();
  console.log(`delivery checks: ${checks} checks passed (pure checks/ignore identity, all converters, preview/snapshot privacy, semantic cuts; synthetic geometry only)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
