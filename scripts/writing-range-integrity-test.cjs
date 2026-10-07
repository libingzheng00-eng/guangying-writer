/** Synthetic cross-paragraph range/merge integrity; no files or user data loaded.
 * Exercises the real store and both SSR/browser text projections. This does not
 * substitute for native keyboard or clipboard verification.
 */
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
    stdin: { contents: `export {useStore} from './src/store/store'; export {createProject} from './src/model/project';
      export {domLength, setCaret, caretOffset} from './src/utils/dom';`, resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
  });
  const filename = path.join(repo, '.writing-range-integrity-memory.cjs');
  const bundle = new Module(filename, module);
  bundle.filename = filename;
  bundle.paths = Module._nodeModulePaths(repo);
  bundle._compile(built.outputFiles[0].text, filename);
  const { useStore, createProject, domLength, setCaret, caretOffset } = bundle.exports;
  const state = () => useStore.getState();
  const fixture = () => {
    const p = createProject('合成跨段完整性');
    p.elements = [
      { id: 'range-s1', type: 'scene_heading', text: '内景 合成空间一 日' },
      { id: 'range-a1', type: 'action', text: '<b>第一场合成前文</b>' },
      { id: 'range-s2', type: 'scene_heading', text: '外景 合成空间二 夜' },
      { id: 'range-a2', type: 'action', text: '第二场合成正文' },
      { id: 'range-s3', type: 'scene_heading', text: '内景 合成空间三 日' },
      { id: 'range-a3', type: 'action', text: '第三场合成正文' },
    ];
    p.sceneMeta = [1, 2, 3].map(n => ({ id: `range-m${n}`, elementId: `range-s${n}`, title: `合成场${n}`, synopsis: '合成摘要', color: '#fff' }));
    p.beats = [
      { id: 'range-image', kind: 'image', title: '合成图片', text: '保留的图片备注', img: 'data:image/png;base64,AA==', sceneId: 'range-m2', color: '#fff', x: 10, y: 20, boardX: 50, boardY: 60, w: 300, h: 220 },
      { id: 'range-sound', kind: 'sound', title: '合成声音', text: '保留的声音内容', sceneId: 'range-s2', color: '#fff', x: 100, y: 200 },
      { id: 'range-first', text: '第一场保留素材', sceneId: 'range-m1', color: '#fff', x: 0, y: 0 },
      { id: 'range-third', kind: 'image', title: '第三场保留图片', text: '保留文字', img: 'data:image/png;base64,AQ==', sceneId: 'range-m3', color: '#fff', x: 30, y: 40 },
      { id: 'range-free', text: '未关联的合成素材', color: '#fff', x: 50, y: 70 },
    ];
    p.boardLinks = [
      { id: 'range-element-link', from: 'scene:range-s2', to: 'beat:range-third', note: '删除标题ID关系' },
      { id: 'range-meta-link', from: 'scene:range-m2', to: 'beat:range-third', note: '删除规范ID关系' },
      { id: 'range-raw-meta-link', from: 'range-m2', to: 'range-free', note: '删除旧裸ID关系' },
      { id: 'range-meta-target-link', from: 'beat:range-image', to: 'scene:range-m2', note: '删除目标端关系' },
      { id: 'range-keep-link', from: 'scene:range-s3', to: 'beat:range-third', note: '保留第三场关系' },
      { id: 'range-keep-beats-link', from: 'beat:range-image', to: 'beat:range-sound', note: '保留素材之间关系' },
    ];
    return p;
  };
  const reset = p => {
    state().loadProject(p);
    useStore.setState({ toast: null });
  };
  const unlinkedBeats = p => p.beats.map(beat => {
    if (beat.sceneId !== 'range-m2' && beat.sceneId !== 'range-s2') return beat;
    const result = { ...beat };
    delete result.sceneId;
    return result;
  });
  const keptLinks = p => p.boardLinks.filter(link => link.id.startsWith('range-keep'));

  const cutProject = fixture();
  reset(cutProject);
  const beforeCut = JSON.stringify(cutProject);
  const result = state().replaceWritingRange(['range-a1', 'range-s2', 'range-a2'], '<b>保留前界</b>', '保留后界', '合成替换');
  check('continuous replacement returns surviving first element', result, 'range-a1');
  check('continuous replacement removes exactly selected tail elements', state().project.elements.map(el => el.id), ['range-s1', 'range-a1', 'range-s3', 'range-a3']);
  check('replacement keeps exact boundary markup and literal inserted HTML', state().project.elements[1].text, '<b>保留前界</b>合成替换保留后界');
  check('replacement removes only deleted heading metadata', state().project.sceneMeta, [cutProject.sceneMeta[0], cutProject.sceneMeta[2]]);
  check('replacement unlinks canonical and legacy IDs but preserves every material field', state().project.beats, unlinkedBeats(cutProject));
  check('replacement cleans prefixed/raw metadata and heading endpoints only', state().project.boardLinks, keptLinks(cutProject));
  check('replacement does not mutate original snapshot', JSON.stringify(cutProject), beforeCut);
  check('replacement is one complete undo transaction', state().past.length, 1);
  const afterCut = JSON.stringify(state().project);
  state().undo();
  check('replacement undo restores exact paragraphs, scenes, images and links', JSON.stringify(state().project), beforeCut);
  state().redo();
  check('replacement redo restores exact cleanup snapshot', JSON.stringify(state().project), afterCut);

  reset(fixture());
  const beforeInvalid = state().project;
  state().setText('range-a1', '合成临时修改');
  state().undo();
  for (const ids of [[], ['range-a1', 'range-a2'], ['range-s2', 'range-a1'], ['range-a1', 'range-s2', 'range-s2'], ['missing'], ['range-a3', 'missing'], null]) {
    const before = state();
    check(`invalid/noncontiguous range ${JSON.stringify(ids)} is rejected`, state().replaceWritingRange(ids, '', '', '不应写入'), null);
    check(`rejected range ${JSON.stringify(ids)} preserves entire store and redo`, state() === before && state().project === beforeInvalid && state().future.length === 1);
  }
  state().redo();
  check('redo remains available after every invalid range', state().project.elements[1].text, '合成临时修改');
  reset(fixture());
  state().setText('range-a1', '合成分组A');
  state().replaceWritingRange(['range-a1', 'range-a2'], '', '', '不应替换');
  state().setText('range-a1', '合成分组B');
  check('invalid range breaks prior typing coalescing without its own history', state().past.length, 2);

  const splitProject = fixture();
  reset(splitProject);
  const beforeSplit = JSON.stringify(splitProject);
  const splitId = state().replaceWritingRange(['range-a1', 'range-s2', 'range-a2'], '分段前界', '分段尾部', '', 'action');
  check('selected Enter creates exact next paragraph and preserves trailing text', state().project.elements.map(el => [el.id, el.text]), [
    ['range-s1', splitProject.elements[0].text], ['range-a1', '分段前界'], [splitId, '分段尾部'],
    ['range-s3', splitProject.elements[4].text], ['range-a3', splitProject.elements[5].text],
  ]);
  check('selected Enter shares canonical/legacy material cleanup', state().project.beats, unlinkedBeats(splitProject));
  check('selected Enter shares endpoint cleanup and one transaction', [state().project.boardLinks, state().past.length], [keptLinks(splitProject), 1]);
  state().undo();
  check('selected Enter undo restores all scene associations and content', JSON.stringify(state().project), beforeSplit);

  const ownHeading = fixture();
  reset(ownHeading);
  state().replaceWritingRange(['range-s2'], '', '', '外景 合成新标题 夜');
  check('editing a surviving heading keeps its metadata and association', [state().project.sceneMeta, state().project.beats, state().project.boardLinks], [ownHeading.sceneMeta, ownHeading.beats, ownHeading.boardLinks]);

  const formatted = '<div>前</div><p>文&#x1F3AC;<br>&amp;lt;</p>';
  const expectedOffset = '前文🎬\n&lt;'.length;
  for (const browser of [false, true]) {
    const dom = browser ? new JSDOM('<!doctype html>') : null;
    if (dom) {
      globalThis.document = dom.window.document;
      globalThis.window = dom.window;
      globalThis.Node = dom.window.Node;
      globalThis.NodeFilter = dom.window.NodeFilter;
    }
    try {
      const mergeProject = fixture();
      mergeProject.elements[1].text = formatted;
      reset(mergeProject);
      const beforeMerge = JSON.stringify(mergeProject);
      const merged = state().mergeIntoPrevious('range-s2');
      check(`${browser ? 'browser' : 'SSR'} merge caret counts text/BR once and decodes entities once`, merged, { id: 'range-a1', offset: expectedOffset });
      check(`${browser ? 'browser' : 'SSR'} merge preserves formatted text and every remaining paragraph`, state().project.elements.map(el => [el.id, el.text]), [
        ['range-s1', mergeProject.elements[0].text], ['range-a1', formatted + mergeProject.elements[2].text],
        ['range-a2', mergeProject.elements[3].text], ['range-s3', mergeProject.elements[4].text], ['range-a3', mergeProject.elements[5].text],
      ]);
      check(`${browser ? 'browser' : 'SSR'} heading merge removes only its metadata`, state().project.sceneMeta, [mergeProject.sceneMeta[0], mergeProject.sceneMeta[2]]);
      check(`${browser ? 'browser' : 'SSR'} heading merge keeps images and unlinks both scene ID forms`, state().project.beats, unlinkedBeats(mergeProject));
      check(`${browser ? 'browser' : 'SSR'} heading merge cleans only affected relation endpoints`, state().project.boardLinks, keptLinks(mergeProject));
      check(`${browser ? 'browser' : 'SSR'} merge requests model-consistent caret`, [state().focus.id, state().focus.caret, state().past.length], ['range-a1', expectedOffset, 1]);
      if (browser) {
        const node = document.createElement('div');
        node.innerHTML = formatted;
        document.body.appendChild(node);
        check('browser DOM length matches merge offset', domLength(node), expectedOffset);
        setCaret(node, expectedOffset);
        check('requested merge caret reaches exact previous text end', caretOffset(node), expectedOffset);
      }
      const afterMerge = JSON.stringify(state().project);
      state().undo();
      check(`${browser ? 'browser' : 'SSR'} merge undo restores exact paragraph and scene integrity`, JSON.stringify(state().project), beforeMerge);
      state().redo();
      check(`${browser ? 'browser' : 'SSR'} merge redo restores exact integrity snapshot`, JSON.stringify(state().project), afterMerge);
      check(`${browser ? 'browser' : 'SSR'} merge never modifies original image-bearing snapshot`, JSON.stringify(mergeProject), beforeMerge);
    } finally {
      if (dom) { dom.window.close(); delete globalThis.document; delete globalThis.window; delete globalThis.Node; delete globalThis.NodeFilter; }
    }
  }
  console.log(`PASS writing range integrity: ${checks} synthetic checks.`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
