/**
 * Manual native acceptance entry, loaded ONLY by an independent QA app bundle.
 * The QA manifest must be named `guangying-native-acceptance-qa`.
 *
 * This creates new synthetic fixture files and a unique temporary userData,
 * then runs the CURRENT production main/preload/renderer and real OS menu.
 * It does not attach to a user's app, preload a personal file, read the system
 * clipboard, alter macOS security settings, or install/replace an application.
 * Open the printed fixture paths through the app's normal File > Open command.
 * No seed/reload injection is used: first launch remains the real blank template,
 * and new close/reload safety must not be bypassed by the test harness.
 */
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = fs.realpathSync(process.env.GUANGYING_TEST_ROOT || path.resolve(__dirname, '..'));
const qaManifest = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
if (qaManifest.name !== 'guangying-native-acceptance-qa') {
  throw new Error('Native acceptance requires the independent QA manifest; production app execution refused.');
}
const renderer = path.join(root, 'dist-renderer', 'index.html');
const main = path.join(root, 'electron', 'main.js');
for (const file of [renderer, main, path.join(root, 'electron', 'preload.js')]) {
  if (!fs.existsSync(file)) throw new Error('Candidate build is incomplete; run the checked source build first.');
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-native-acceptance-'));
app.setPath('userData', path.join(out, 'userData'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const image = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'src/assets/typewriter-pointer.png')).toString('base64');
const createdAt = Date.now();

function baseProject(id, name) {
  return {
    id, name, createdAt, updatedAt: createdAt,
    titlePage: { show: false, title: '', author: '', contact: '', notes: '' },
    settings: { smartQuotes: true, contdCharacter: true },
    acts: [], sceneMeta: [], boardLinks: [], revisions: [], elements: [], beats: [], targetPages: 100,
  };
}
function writeFixture(name, project) {
  const file = path.join(out, name);
  fs.writeFileSync(file, JSON.stringify({ app: 'guangying-writer', fileVersion: 1, savedAt: createdAt, project }, null, 2), { flag: 'wx' });
  return file;
}

const editing = baseProject('native-acceptance-editing', '合成验收：编辑与保存（不是用户剧本）');
editing.elements = [
  { id: 'qa-edit-scene', type: 'scene_heading', text: '内景 合成测试房间 日' },
  { id: 'qa-edit-action', type: 'action', text: '前半段后半段' },
  { id: 'qa-edit-rich', type: 'action', text: '<b>加粗测试</b><br><i>斜体测试</i>与普通文字' },
  { id: 'qa-edit-character', type: 'character', text: '测试甲' },
  { id: 'qa-edit-dialogue', type: 'dialogue', text: '在这一段测试智能引号、中文输入、复制剪切和粘贴。' },
  { id: 'qa-edit-keep', type: 'action', text: '未选中的合成文字必须保留。' },
  { id: 'qa-edit-character-again', type: 'character', text: '测试甲' },
  { id: 'qa-edit-dialogue-again', type: 'dialogue', text: '这一行只用于确认同人物续说标记。' },
];
editing.beats = [
  { id: 'qa-edit-image', kind: 'image', title: '合成参考图', text: '图片仅为项目内打字机指针。', img: image, color: '#fff7d6', x: 850, y: 120, boardX: 480, boardY: 100, w: 280, h: 210 },
  { id: 'qa-edit-sound', kind: 'sound', title: '合成声音备注', text: '仅用于验收的声音描述。', color: '#ccb887', x: 850, y: 360, boardX: 480, boardY: 360, w: 280, h: 180 },
];

const longScript = baseProject('native-acceptance-long', '合成验收：300段长稿（不是用户剧本）');
for (let index = 0; index < 300; index++) {
  const position = index % 10;
  const scene = Math.floor(index / 10) + 1;
  const type = position === 0 ? 'scene_heading' : position === 2 || position === 6 ? 'character'
    : position === 3 || position === 7 ? 'dialogue' : 'action';
  const text = type === 'scene_heading' ? `内景 合成场景${scene} 日`
    : type === 'character' ? `测试角色${scene % 7}`
      : type === 'dialogue' ? `第${scene}场合成对白，仅供输入和续说性能验收。`.repeat(4)
        : `合成长稿第${index + 1}段，只用于测试排版与输入，不包含用户资料。`.repeat(5);
  longScript.elements.push({ id: `qa-long-${index}`, type, text });
}
longScript.beats = [{ ...editing.beats[0], id: 'qa-long-image', y: 800 }];

const fixtures = {
  editing: writeFixture('editing-fixture.zhsp', editing),
  longScript: writeFixture('long-script-fixture.zhsp', longScript),
};
const result = {
  startedAt: new Date().toISOString(), root, renderer,
  candidateVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  rendererIndexSHA256: createHash('sha256').update(fs.readFileSync(renderer)).digest('hex'),
  userData: app.getPath('userData'), fixtures,
  loads: 0, closeRequests: 0, rendererCrashes: 0,
};
const journal = path.join(out, 'environment.json');
const record = () => fs.writeFileSync(journal, JSON.stringify(result, null, 2));
record();
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('did-finish-load', () => { result.loads++; record(); });
  win.webContents.on('render-process-gone', () => { result.rendererCrashes++; record(); });
  win.on('close', () => { result.closeRequests++; record(); });
});

console.log('QA_ROOT', out);
console.log('QA_RENDERER', renderer);
console.log('QA_EDITING_FIXTURE', fixtures.editing);
console.log('QA_LONG_FIXTURE', fixtures.longScript);
console.log('Only open these new synthetic fixture files. First launch is intentionally blank.');
console.log('Use the real menu/keyboard to test clipboard, undo, Tab, save, close and reload.');
console.log('No system clipboard is read by this harness. No user app or existing data is changed.');

require(main);
