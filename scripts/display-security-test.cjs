/** Synthetic metadata -> real React/HTML export boundary tests. No user files,
 * native application, clipboard or network are accessed. Pagination is supplied
 * as inert fixture data; jsdom does not verify Chromium decoding or layout. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM, requestInterceptor } = require('jsdom');
const repo = path.resolve(__dirname, '..');
const attemptedResources = [];
const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: 'https://display-security.invalid/', pretendToBeVisual: true,
  resources: { interceptors: [requestInterceptor(request => {
    attemptedResources.push(request.url);
    return new Response(null, { status: 403 });
  })] },
});
const w = dom.window;
const originals = new Map();
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLImageElement', 'Node', 'NodeFilter', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'DOMParser', 'Range', 'Selection', 'MutationObserver', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? w : w[name] });
}
w.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const clone = value => JSON.parse(JSON.stringify(value));
let checks = 0, mounted;
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); checks++; };
const payload = '</style><script id="metadata-script">window.syntheticAttack=1</script><img id="metadata-image" src="file:///synthetic/private.png">';

(async () => {
  const built = await require('esbuild').build({
    stdin: { contents: `
      export {Editor} from './src/components/Editor';
      export {BoardView} from './src/components/BoardView';
      export {CardsView} from './src/components/CardsView';
      export {Sidebar} from './src/components/Sidebar';
      export {Toolbar} from './src/components/Toolbar';
      export {PreviewView} from './src/components/PreviewView';
      export {useStore} from './src/store/store';
      export {createProject} from './src/model/project';
      export {fontStackOf} from './src/model/elements';
      export {toHtml} from './src/io/textscript';
      export {serializeProject} from './src/io/zhsp';
      export {buildCreativePdf} from './src/io/creativePdf';
    `, resolveDir: repo, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    loader: { '.png': 'dataurl', '.css': 'empty' }, logLevel: 'silent',
    plugins: [{ name: 'inert-pagination-fixture', setup(build) {
      build.onResolve({ filter: /hooks\/PaginationProvider$/ }, () => ({ path: 'pagination-fixture', namespace: 'security-fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'security-fixture' }, () => ({ contents: 'export const usePagination = () => globalThis.__displaySecurityPagination;', loader: 'js' }));
    } }],
  });
  const mod = new Module(path.join(repo, '.display-security-memory.cjs'), module);
  mod.filename = path.join(repo, '.display-security-memory.cjs'); mod.paths = module.paths;
  mod._compile(built.outputFiles[0].text, mod.filename);
  const api = mod.exports;

  // Attack each export context independently so one fallback cannot hide another.
  const exportMutations = [
    ['font key', p => { p.settings.fontKey = payload; }],
    ['font size', p => { p.settings.fontSize = payload; }],
    ['line height', p => { p.settings.lineHeight = payload; }],
    ['left indent', p => { p.settings.indent.action.left = '0em; background:url(file:///synthetic/a)" onmouseover="attack'; }],
    ['right indent', p => { p.settings.indent.action.right = '\"><img id="metadata-image" src=x>'; }],
    ['alignment', p => { p.settings.indent.action.align = '\"><script id="metadata-script">attack()</script>'; }],
    ['element type', p => { p.elements[0].type = '\"><img id="metadata-image" src=x>'; }],
  ];
  for (const [label, mutate] of exportMutations) {
    const p = api.createProject('合成导出边界');
    p.elements = [{ id: 'export-action', type: 'action', text: '保留正文<br>&lt;字面标签&gt;' }];
    p.titlePage.show = true; p.titlePage.title = payload;
    mutate(p);
    const before = clone(p);
    const exported = new JSDOM(api.toHtml(p));
    const d = exported.window.document;
    check(`${label}: no active HTML or resource element`, d.querySelectorAll('script,img,iframe,object,embed,link,base,form').length, 0);
    check(`${label}: one trusted stylesheet`, d.querySelectorAll('style').length, 1);
    check(`${label}: no raw metadata in style`, /url\s*\(|<|metadata-script/i.test(d.querySelector('style').textContent), false);
    check(`${label}: attribute cannot escape`, [...d.querySelector('p').attributes].map(a => a.name).sort(), ['class', 'style']);
    check(`${label}: literal title retained`, d.querySelector('h1').textContent, payload);
    check(`${label}: complete plain body and break retained`, d.querySelector('p').innerHTML, '保留正文<br>&lt;字面标签&gt;');
    check(`${label}: standalone export has restrictive CSP`, d.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("default-src 'none'"));
    check(`${label}: export leaves project unchanged`, p, before);
    exported.window.close();
  }
  const valid = api.createProject('合法旧格式');
  valid.settings.fontKey = 'courier'; valid.settings.fontSize = 13.5; valid.settings.lineHeight = 1.75;
  valid.settings.indent.action = { left: 2.25, right: -0.5, align: 'center', spaceBefore: 1 };
  valid.elements = [{ id: 'valid-action', type: 'action', text: '<b>原字</b><br>末行' }];
  const validDoc = new JSDOM(api.toHtml(valid));
  check('trusted preset uses real font stack', validDoc.window.document.querySelector('style').textContent.includes(api.fontStackOf('courier')));
  check('valid finite font settings retained', validDoc.window.document.querySelector('style').textContent.includes('font-size:13.5pt;line-height:1.75'));
  check('valid old indents and alignment retained', validDoc.window.document.querySelector('p').getAttribute('style'), 'margin-left:2.25em;margin-right:-0.5em;text-align:center');
  validDoc.window.close();

  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6vS8AAAAASUVORK5CYII=';
  const safeImages = [`data:image/png;base64,${png}`, `data:application/octet-stream;base64,${png}`, 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E'];
  const blockedImages = ['file:///synthetic/private.png', 'https://outside.invalid/image.png', '../synthetic.png', '//outside.invalid/a.png', 'blob:https://outside.invalid/id'];
  const project = api.createProject('合成元数据安全界面');
  project.elements = [{ id: 'scene-safe', type: 'scene_heading', text: '内景 合成场景 日', rev: 'revision-safe' }, { id: 'action-safe', type: 'action', text: '合法正文' }];
  project.titlePage = { ...project.titlePage, show: true, title: payload, author: payload, contact: payload, notes: payload };
  project.settings.revisionMode = true;
  project.sceneMeta = [{ id: 'scene-meta', elementId: 'scene-safe', title: payload, synopsis: payload, color: 'url(file:///synthetic/scene.png)', actId: 'act-safe' }];
  project.acts = [{ id: 'act-safe', title: payload, color: 'var(--untrusted, url(file:///synthetic/act.png))' }];
  project.revisions = [{ id: 'revision-safe', label: payload, color: 'url(https://outside.invalid/revision.png)' }];
  project.beats = [...safeImages, ...blockedImages].map((img, i) => ({ id: `image-${i}`, kind: 'image', title: `图${i}${payload}`, text: `备注${i}${payload}`, img, color: 'url(file:///synthetic/beat.png)', x: 10 + i * 20, y: 80 + i * 30, boardX: 50 + i * 30, boardY: 100 + i * 40, w: 280, h: 248 }));
  project.boardLinks = [{ id: 'link-safe', from: 'beat:image-0', to: 'beat:image-1', note: payload }];
  const originalProject = clone(project);
  const initialSave = api.serializeProject(project);
  const state = () => api.useStore.getState();
  api.useStore.setState({ project, sidebarOpen: true, sidebar: 'navigator', activeId: 'scene-safe', view: 'write', past: [], future: [], dirty: false });
  globalThis.__displaySecurityPagination = {
    pages: [{ index: 0, revColor: 'url(file:///synthetic/page.png)', items: [{ key: 'line', kind: 'single', elements: [project.elements[0]], spaceBefore: 0 }] }],
    pageOf: { 'scene-safe': 0 }, breaks: [], lineHeightPx: 18, contentWidthPx: 500, contentHeightPx: 700, readyKey: `${state().version}:A4`,
  };
  const commands = { save() {}, open() {}, newFile() {}, exportAs() {}, exportPdf() {}, importAny() {} };
  const cases = [
    ['Editor', {}], ['BoardView', {}], ['CardsView', {}], ['Sidebar', {}, 'navigator'],
    ['Sidebar', {}, 'outline'], ['Sidebar', {}, 'inspector'],
    ['Toolbar', { commands, onOpenSettings() {}, onOpenTitle() {} }], ['PreviewView', { onExportPdf() {} }],
  ];
  for (const [name, props, sidebar] of cases) {
    if (sidebar) api.useStore.setState({ sidebar });
    mounted = createRoot(document.getElementById('root'));
    await act(async () => mounted.render(React.createElement(api[name], props)));
    check(`${name}: no markup from metadata`, document.querySelectorAll('#metadata-script,#metadata-image,script,iframe,object,embed,link,base').length, 0);
    check(`${name}: no external or relative resource src`, [...document.querySelectorAll('[src]')].every(node => node.getAttribute('src').startsWith('data:')));
    check(`${name}: no URL or variable escape in color styles`, [...document.querySelectorAll('[style]')].every(node => !/url\s*\(|outside\.invalid|file:|untrusted|u\\/i.test(node.getAttribute('style'))));
    check(`${name}: no project rewrite`, state().project, originalProject);
    if (name === 'Editor' || name === 'BoardView') {
      const selector = name === 'Editor' ? '.writing-material-card__image' : '.bcard__media-img';
      check(`${name}: all valid embedded formats retained`, [...document.querySelectorAll(selector)].map(node => node.getAttribute('src')), safeImages);
      check(`${name}: blocked images keep original card count`, document.querySelectorAll(name === 'Editor' ? '.writing-material-card--image' : '.bcard--image').length, project.beats.length);
      check(`${name}: blocked media has clear inline explanation`, [...document.querySelectorAll('.bcard__empty-media')].filter(node => node.textContent.includes('图片来源已阻止')).length, blockedImages.length);
      check(`${name}: every image title and note retained`, [...document.querySelectorAll(name === 'Editor' ? '.writing-material-card--image' : '.bcard--image')].every((card, i) => card.querySelector('input').value === project.beats[i].title && card.querySelector('textarea').value === project.beats[i].text));
    }
    if (name === 'Editor') {
      // jsdom does not decode images. This models decoded known synthetic pixels
      // only to test the production snapshot serializer, not Chromium decoding.
      for (const image of document.querySelectorAll('.writing-material-card__image')) Object.defineProperty(image, 'naturalWidth', { value: 1 });
      const snapshot = new JSDOM(api.buildCreativePdf(document.querySelector('.editor__scroll')).html);
      check('creative snapshot preserves all safe embedded image sources', [...snapshot.window.document.images].map(image => image.getAttribute('src')), safeImages);
      check('creative snapshot has no blocked image URL', [...snapshot.window.document.images].every(image => image.src.startsWith('data:')));
      check('creative snapshot retains blocked card explanation and notes', snapshot.window.document.body.textContent.includes('图片来源已阻止') && snapshot.window.document.body.textContent.includes(project.beats.at(-1).text));
      snapshot.window.close();
    }
    await act(async () => mounted.unmount()); mounted = null;
  }
  const savedAfter = JSON.parse(api.serializeProject(state().project));
  const savedBefore = JSON.parse(initialSave); delete savedAfter.savedAt; delete savedBefore.savedAt;
  check('safe projections preserve serialized image/color/title/notes/coordinates', savedAfter, savedBefore);
  check('offline loader saw no external resource attempt', attemptedResources.filter(url => !url.startsWith('data:')), []);
  console.log(`display security: ${checks} checks passed (real React and export DOM; synthetic fixtures, inert pagination; no native decoding/layout claim)`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (mounted) await act(async () => mounted.unmount());
  dom.window.close();
  delete globalThis.__displaySecurityPagination;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
});
