/** Synthetic internal-clipboard/model regression. In-memory bundle + inert jsdom only;
 * never launches Electron, reads userData, or tests a native OS clipboard gesture.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html>', { url: 'http://clipboard-format-test.invalid/' });
const originals = new Map();
for (const key of ['document', 'window', 'localStorage']) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : dom.window[key] });
}
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.values(value).forEach(freeze);
  Object.freeze(value);
}
const view = html => { const node = document.createElement('div'); node.innerHTML = html; return node; };

(async () => {
  const built = await require('esbuild').build({
    stdin: { contents: "export * from './src/utils/writingClipboard'; export { createProject } from './src/model/project'; export { useStore } from './src/store/store';", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
  });
  const mod = new Module(path.join(root, '.clipboard-format-memory.cjs'), module);
  mod.filename = path.join(root, '.clipboard-format-memory.cjs');
  mod.paths = Module._nodeModulePaths(root);
  mod._compile(built.outputFiles[0].text, mod.filename);
  const api = mod.exports;
  let groups = 0;
  const check = (label, run) => { run(); groups++; console.log(`PASS ${label}`); };
  const fragment = (type = 'action', html = '合成内容') => ({ type, html });
  const payload = fragments => JSON.stringify({ version: 1, fragments });
  const fixture = () => {
    const p = api.createProject('合成内部剪贴板');
    p.elements = [
      { id: 'prefix', type: 'general', text: '合成前言' },
      { id: 'keep-heading', type: 'scene_heading', text: '内景 保留场 日' },
      { id: 'first', type: 'action', text: '<b>前</b>选择开始', rev: 'rev-a', omit: false },
      { id: 'remove-heading', type: 'scene_heading', text: '外景 被选场 夜' },
      { id: 'remove-body', type: 'dialogue', text: '合成选区对白' },
      { id: 'last', type: 'dialogue', text: '选择结束<u>后</u>' },
      { id: 'tail', type: 'action', text: '完全保留的合成尾段' },
    ];
    p.sceneMeta = [
      { id: 'keep-meta', elementId: 'keep-heading', title: '保留元数据', synopsis: '合成梗概', color: '#abcdef', x: 20, y: 30, actId: p.acts[0].id },
      { id: 'remove-meta', elementId: 'remove-heading', title: '被选元数据', synopsis: '', color: '#abc' },
      { id: 'remove-meta-duplicate', elementId: 'remove-heading', title: '历史重复元数据', synopsis: '', color: '#def' },
    ];
    p.beats = [
      { id: 'canonical', kind: 'image', text: '合成图片批注', img: 'data:image/png;base64,c3ludGhldGlj', sceneId: 'remove-meta', color: '#fff', x: 8, y: 9, w: 220, h: 200 },
      { id: 'legacy', kind: 'sound', text: '合成声音', sceneId: 'remove-heading', color: '#abc', x: 20, y: 50, boardX: 80, boardY: 90 },
      { id: 'duplicate-meta', kind: 'beat', text: '合成重复元数据关联', sceneId: 'remove-meta-duplicate', color: '#def', x: 0, y: 0 },
      { id: 'keep-beat', kind: 'beat', text: '保留关联', sceneId: 'keep-meta', color: '#fff', x: 10, y: 20 },
    ];
    p.boardLinks = [
      { id: 'removed-element', from: 'scene:remove-heading', to: 'beat:canonical', note: '被选场景关系' },
      { id: 'removed-meta', from: 'remove-meta', to: 'beat:legacy' },
      { id: 'removed-duplicate', from: 'scene:remove-meta-duplicate', to: 'beat:duplicate-meta' },
      { id: 'kept-materials', from: 'beat:canonical', to: 'beat:legacy', note: '素材之间关系保留' },
      { id: 'kept-scene', from: 'scene:keep-heading', to: 'beat:keep-beat' },
    ];
    return p;
  };
  const ids = Object.freeze(['first', 'remove-heading', 'remove-body', 'last']);
  const fragments = [fragment('character', '<b>合成甲</b>'), fragment('scene_heading', '<i>内景 新合成场 日</i>'), fragment('dialogue', '<u>片二</u><br>尾🙂')];
  freeze(fragments);

  check('版本1只包含type/html；十类内部元素与基础格式可往返', () => {
    const types = ['act', 'scene_heading', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'general', 'note'];
    const source = types.map(type => ({ type, html: '<b>合成</b><i>斜</i><u>下</u><strong>强</strong><em>意</em><br>尾', id: 'NEVER_COPY_ID', dual: 'right', dualGroup: 'NEVER_COPY_GROUP', rev: 'NEVER_COPY_REV', sceneId: 'NEVER_COPY_SCENE', boardLinks: [{ id: 'NEVER_COPY_LINK' }], img: 'NEVER_COPY_IMAGE' }));
    freeze(source);
    const encoded = api.encodeWritingClipboard(source);
    assert.equal(api.WRITING_CLIPBOARD_MIME, 'application/x-guangying-script+json');
    const data = JSON.parse(encoded);
    assert.deepEqual(Object.keys(data), ['version', 'fragments']);
    assert.equal(data.version, 1);
    assert.ok(data.fragments.every(item => Object.keys(item).join(',') === 'type,html'));
    assert.ok(!encoded.includes('NEVER_COPY'));
    assert.deepEqual(api.decodeWritingClipboard(encoded), source.map(({ type, html }) => ({ type, html })));
  });

  check('清洗保留格式和未知标签文字；script/style/img、属性与注释全部移除', () => {
    const dirty = '<unknown>外壳文字</unknown><b onclick="evil()" style="color:red">粗</b><i class="sc-el" data-id="secret">斜</i><u id="secret">下</u><strong title="tip">强</strong><em>意</em><br class="unsafe"><script>evil()</script><style>body{display:none}</style><img src="https://unsafe.invalid/img" onerror="evil()"><svg onload="evil()"><text>矢量文字</text></svg><!--secret-->';
    const clean = api.sanitizeClipboardHtml(dirty);
    assert.equal(clean, '外壳文字<b>粗</b><i>斜</i><u>下</u><strong>强</strong><em>意</em><br>矢量文字');
    const node = view(clean);
    assert.ok([...node.querySelectorAll('*')].every(item => ['B', 'I', 'U', 'STRONG', 'EM', 'BR'].includes(item.tagName) && item.attributes.length === 0));
    const decoded = api.decodeWritingClipboard(payload([{ type: 'dialogue', html: dirty, id: 'injected', dual: 'left', sceneId: 'private' }]));
    assert.deepEqual(decoded, [{ type: 'dialogue', html: clean }]);
  });

  check('字面尖括号、amp与实体仅解码一次；UTF-16 emoji和br正确保留', () => {
    const source = '<b>&lt;img&gt; &amp;lt;script&amp;gt; &amp; &quot; &#39; &nbsp;🙂</b><br>尾';
    const encoded = api.encodeWritingClipboard([fragment('action', source)]);
    const decoded = api.decodeWritingClipboard(encoded);
    const node = view(decoded[0].html);
    assert.equal(node.textContent, '<img> &lt;script&gt; & " \' \u00a0🙂尾');
    assert.equal(node.querySelectorAll('img,script').length, 0);
    assert.equal(node.querySelectorAll('br').length, 1);
    assert.equal(api.encodeWritingClipboard(decoded), encoded, '多次应用往返不改变安全编码');
  });

  check('非法结构/版本/类型/长度整体拒绝，调用方可以原plain fallback', () => {
    const invalid = ['', '{', 'null', '[]', '{}', JSON.stringify({ version: '1', fragments: [fragment()] }), JSON.stringify({ version: 2, fragments: [fragment()] }), payload([]), payload([null]), payload([[]]), payload([{ type: 'constructor', html: '文本' }]), payload([{ type: '__proto__', html: '文本' }]), payload([{ type: 'action', html: 42 }]), payload([{ type: 'action' }]), payload([fragment(), fragment('unsafe', '文本')])];
    invalid.forEach(value => assert.equal(api.decodeWritingClipboard(value), null));
    assert.equal(api.decodeWritingClipboard(' '.repeat(api.MAX_CLIPBOARD_PAYLOAD_LENGTH + 1)), null);
    assert.equal(api.decodeWritingClipboard(payload([fragment('action', '文'.repeat(api.MAX_CLIPBOARD_FRAGMENT_LENGTH + 1))])), null);
    assert.equal(api.decodeWritingClipboard(payload(Array.from({ length: api.MAX_CLIPBOARD_FRAGMENTS + 1 }, () => fragment('action', '')))), null);
    assert.equal(api.encodeWritingClipboard([]), null);
    assert.equal(api.encodeWritingClipboard([fragment('unknown')]), null);
    assert.equal(api.encodeWritingClipboard(Array.from({ length: 11 }, () => fragment('action', '文'.repeat(api.MAX_CLIPBOARD_FRAGMENT_LENGTH)))), null);
    assert.equal(api.encodeWritingClipboard([fragment('action', '&'.repeat(api.MAX_CLIPBOARD_FRAGMENT_LENGTH))]), null, '清洗放大超过单片段限制也拒绝');
    const boundary = api.encodeWritingClipboard([fragment('general', '文'.repeat(api.MAX_CLIPBOARD_FRAGMENT_LENGTH))]);
    assert.equal(api.decodeWritingClipboard(boundary)[0].html.length, api.MAX_CLIPBOARD_FRAGMENT_LENGTH);
    const empty = api.decodeWritingClipboard(api.encodeWritingClipboard([fragment('note', '')]));
    assert.deepEqual(empty, [fragment('note', '')], '真实空段落仍是合法内部片段');
  });

  check('深层未知包装迭代清洗，不递归溢出也不引入任意标签', () => {
    const nested = '<unknown>'.repeat(4_000) + '<b>保留</b>' + '</unknown>'.repeat(4_000);
    assert.equal(api.sanitizeClipboardHtml(nested), '<b>保留</b>');
  });

  check('单片段保留目标type/ID/metadata，前后富文本与caret保持准确', () => {
    const p = fixture();
    p.elements[2] = { ...p.elements[2], type: 'dialogue', dual: 'left', dualGroup: 'existing-target-group' };
    const before = clone(p);
    const focus = api.replaceClipboardRange(p, ['first'], '<b>前🙂</b><br>', '<u>后</u>', [fragment('scene_heading', '<i>贴🙂</i><br>行')]);
    assert.deepEqual(focus, { focusId: 'first', caret: 9 }); // 前🙂\n=4, 贴🙂\n行=5 UTF-16 units.
    assert.deepEqual(p.elements[2], { ...before.elements[2], text: '<b>前🙂</b><br><i>贴🙂</i><br>行<u>后</u>' });
    assert.deepEqual(p.elements.slice(0, 2), before.elements.slice(0, 2));
    assert.deepEqual(p.elements.slice(3), before.elements.slice(3));
    for (const key of ['sceneMeta', 'beats', 'boardLinks', 'settings', 'acts', 'revisions', 'titlePage', 'updatedAt']) assert.deepEqual(p[key], before[key]);
  });

  check('多片段保留internal types、新段新ID，无源双列/修订/素材metadata', () => {
    const p = fixture(), before = clone(p);
    p.elements[2].dual = 'right'; p.elements[2].dualGroup = 'old-target-group';
    const source = fragments.map(item => ({ ...item, id: 'source-id', rev: 'source-rev', dual: 'left', dualGroup: 'source-group', sceneId: 'source-scene' }));
    freeze(source);
    const focus = api.replaceClipboardRange(p, ids, '<b>前</b>', '<u>后</u>', source);
    assert.deepEqual(p.elements.map(item => item.type), ['general', 'scene_heading', 'character', 'scene_heading', 'dialogue', 'action']);
    assert.equal(p.elements[2].id, 'first');
    assert.equal(p.elements[2].text, '<b>前</b><b>合成甲</b>');
    assert.equal(p.elements[2].rev, 'rev-a', '保留目标自己的修订信息');
    assert.ok(!('dual' in p.elements[2]) && !('dualGroup' in p.elements[2]), '目标类型变更时清旧双列标记');
    for (const element of p.elements.slice(3, 5)) {
      assert.ok(!before.elements.some(item => item.id === element.id));
      assert.deepEqual(Object.keys(element).sort(), ['id', 'text', 'type']);
    }
    assert.notEqual(p.elements[3].id, p.elements[4].id);
    assert.equal(p.elements[3].text, '<i>内景 新合成场 日</i>');
    assert.equal(p.elements[4].text, '<u>片二</u><br>尾🙂<u>后</u>');
    assert.deepEqual(focus, { focusId: p.elements[4].id, caret: 6 });
    assert.deepEqual(p.elements[0], before.elements[0]);
    assert.deepEqual(p.elements[1], before.elements[1]);
    assert.deepEqual(p.elements.at(-1), before.elements.at(-1));
    assert.deepEqual(source, fragments.map(item => ({ ...item, id: 'source-id', rev: 'source-rev', dual: 'left', dualGroup: 'source-group', sceneId: 'source-scene' })));
  });

  check('替换清理被删场景元素/meta两类关联与关系，素材本体完整保留', () => {
    const p = fixture(), before = clone(p);
    api.replaceClipboardRange(p, ids, '<b>前</b>', '<u>后</u>', fragments);
    assert.deepEqual(p.sceneMeta, [before.sceneMeta[0]]);
    assert.deepEqual(p.beats, before.beats.map(beat => { const item = { ...beat }; if (['remove-meta', 'remove-heading', 'remove-meta-duplicate'].includes(item.sceneId)) delete item.sceneId; return item; }));
    assert.deepEqual(p.boardLinks, before.boardLinks.filter(link => link.id.startsWith('kept-')));
    for (const key of ['settings', 'acts', 'revisions', 'titlePage', 'name', 'id', 'createdAt', 'updatedAt']) assert.deepEqual(p[key], before[key]);
    const missingLinks = fixture(); delete missingLinks.boardLinks;
    api.replaceClipboardRange(missingLinks, ids, '', '', [fragment()]);
    assert.ok(!('boardLinks' in missingLinks), '历史缺省关系字段不物化');
  });

  check('首目标场景改成非场景同步清meta/关联；保留场景type时保持原meta', () => {
    const p = fixture(), original = clone(p);
    const focus = api.replaceClipboardRange(p, ['keep-heading'], '', '', [fragment('character', '甲'), fragment('dialogue', '对白')]);
    assert.equal(p.elements[1].id, 'keep-heading');
    assert.equal(p.elements[1].type, 'character');
    assert.ok(!p.sceneMeta.some(meta => meta.elementId === 'keep-heading'));
    assert.ok(!p.beats.find(beat => beat.id === 'keep-beat').sceneId);
    assert.ok(!p.boardLinks.some(link => link.id === 'kept-scene'));
    assert.ok(focus.focusId !== 'keep-heading');
    const same = clone(original);
    api.replaceClipboardRange(same, ['keep-heading'], '', '', [fragment('scene_heading', '内景 改标题 日'), fragment('action', '新动作')]);
    assert.deepEqual(same.sceneMeta, original.sceneMeta);
    assert.deepEqual(same.beats, original.beats);
    assert.deepEqual(same.boardLinks, original.boardLinks);
  });

  check('无效/乱序/不连续ID、非法片段均不改draft，禁止跨段静默误删', () => {
    const candidates = [[], ['missing'], ['first', 'first'], ['last', 'first'], ['first', 'remove-body'], ['first', 'remove-heading', 'missing']];
    for (const range of candidates) {
      const p = fixture(), before = clone(p);
      assert.equal(api.replaceClipboardRange(p, range, '前', '后', fragments), null);
      assert.deepEqual(p, before);
    }
    for (const invalid of [[], [fragment('invalid')], [fragment('action', '文'.repeat(api.MAX_CLIPBOARD_FRAGMENT_LENGTH + 1))]]) {
      const p = fixture(), before = clone(p);
      assert.equal(api.replaceClipboardRange(p, ['first'], '', '', invalid), null);
      assert.deepEqual(p, before);
    }
  });

  check('真实store一次mutate提交，撤销完整恢复、重做保留新ID/格式/关系清理', () => {
    const state = () => api.useStore.getState();
    state().loadProject(fixture());
    const before = clone(state().project), version = state().version;
    let focus;
    state().mutate(draft => { focus = api.replaceClipboardRange(draft, ids, '<b>前</b>', '<u>后</u>', fragments); });
    const after = clone(state().project);
    assert.equal(state().past.length, 1);
    assert.equal(state().version, version + 1);
    assert.equal(state().dirty, true);
    assert.ok(after.elements.some(item => item.id === focus.focusId));
    state().undo();
    assert.deepEqual(state().project, before);
    assert.equal(state().future.length, 1);
    state().redo();
    assert.deepEqual(state().project, after);
    state().undo();
    const future = state().future, project = state().project, history = state().past, versionAfterUndo = state().version;
    state().mutate(draft => { assert.equal(api.replaceClipboardRange(draft, ['first', 'last'], '', '', fragments), null); });
    assert.equal(state().project, project);
    assert.equal(state().past, history);
    assert.equal(state().future, future);
    assert.equal(state().version, versionAfterUndo);
  });

  console.log(`clipboard format: ${groups}/${groups} groups passed (synthetic jsdom + real store; native clipboard/IME/browser gestures still require manual validation)`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});
