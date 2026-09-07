/**
 * 用 jsdom 真实挂载 React 应用，验证首屏渲染与副作用不报错，并输出关键状态。
 * 用法： node scripts/render-test.cjs
 */
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

const w = dom.window;
global.window = w;
global.document = w.document;
global.navigator = w.navigator;
global.self = w;
global.location = w.location;
global.history = w.history;
[
  'HTMLElement',
  'HTMLDivElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'Node',
  'NodeFilter',
  'Element',
  'Event',
  'KeyboardEvent',
  'MouseEvent',
  'DOMParser',
  'Blob',
  'Range',
  'Selection',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'localStorage',
  'sessionStorage',
  'MutationObserver',
].forEach((k) => {
  if (w[k] !== undefined) global[k] = w[k];
});
if (!global.requestAnimationFrame) global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
// 注意：不要把 global.performance 指向 jsdom 的实现，会造成递归

const errors = [];
const origError = console.error;
console.error = (...args) => {
  errors.push(args.map(String).join(' '));
  origError(...args);
};
w.addEventListener('error', (e) => errors.push(`window.error: ${e.message}`));

// Tests use synthetic, non-user content. The shipped first-run project stays blank.
localStorage.setItem('mojiang:autosave', JSON.stringify({
  project: {
    id: 'qa-project',
    name: '功能测试稿',
    createdAt: 1,
    updatedAt: 1,
    titlePage: {},
    elements: [
      { id: 'qa-scene-1', type: 'scene_heading', text: '内景 测试地点 日' },
      { id: 'qa-character-1', type: 'character', text: '角色甲' },
      { id: 'qa-dialogue-1', type: 'dialogue', text: '测试对白。' },
      { id: 'qa-scene-2', type: 'scene_heading', text: '外景 测试地点 夜' },
      { id: 'qa-character-2', type: 'character', text: '角色甲（V.O）' },
      { id: 'qa-dialogue-2', type: 'dialogue', text: '第二句测试对白。' },
    ],
    sceneMeta: [],
    beats: [
      { id: 'qa-beat-1', text: '测试卡片甲', color: '#FCEBEB', x: 40, y: 40 },
      { id: 'qa-beat-2', text: '测试卡片乙', color: '#E6F1FB', x: 340, y: 240 },
    ],
    boardLinks: [],
    targetPages: 100,
    acts: [{ id: 'act-1', title: '第一幕', color: '#cfe4ff' }],
    revisions: [],
    settings: {},
  },
  filePath: null,
}));

// 用与生产代码相同的入口生成可由 Node/jsdom 执行的临时 CJS 包。
// 原脚本假定 .tmp-app.cjs 已由外部流程生成，导致干净克隆后的测试必然失败。
const bundle = process.env.APP_BUNDLE || path.join(__dirname, '..', '.tmp-app.cjs');
const temporaryBundle = !process.env.APP_BUNDLE;
const cleanTemporaryBundle = () => {
  if (!temporaryBundle) return;
  for (const file of [bundle, bundle.replace(/\.cjs$/, '.css')]) {
    try { fs.unlinkSync(file); } catch { /* 不存在即可 */ }
  }
};
process.on('exit', cleanTemporaryBundle);

(async () => {
  if (temporaryBundle) {
    await esbuild.build({
      entryPoints: [path.join(__dirname, '..', 'src', 'main.tsx')],
      bundle: true,
      outfile: bundle,
      platform: 'node',
      format: 'cjs',
      loader: { '.css': 'css' },
      plugins: [
        // jsdom 不渲染真实图片，PNG 资源退化为空模块，避免测试 bundle 报错。
        // 视觉效果在真实 Electron 集成测试中验证。
        {
          name: 'png-as-empty',
          setup(build) {
            build.onLoad({ filter: /\.png$/ }, () => ({
              contents: 'module.exports = "";',
              loader: 'js',
            }));
          },
        },
      ],
    });
  }
  require(bundle);

  setTimeout(() => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const txt = (s) => (q(s) ? q(s).textContent.replace(/\s+/g, ' ').trim().slice(0, 300) : null);

  // 第五项：进度条主题 / 场景条带 / 终点图标等只渲染在写作视图，必须先在写作视图抓。
  // 兼容旧 alpha.1：用 .target-pages / .typewriter-progress__pointer；新 alpha.5 用 .write-progress__goal / .write-progress__marker。
  const targetPagesVisible =
    !!q('.target-pages input') ||
    !!q('.write-progress__goal input');
  const typewriterPointerVisible =
    !!q('.typewriter-progress__pointer') ||
    !!q('.write-progress__marker img');
  // 单一打字机进度条：不再显示主题切换按钮。
  const progressSceneBands = qa('.write-progress__scene').length;
  const progressThemeButtonRemoved = !q('.write-progress__theme');
  const progressEndIcon = !!q('.write-progress__end');
  const progressFillBar = !!q('.write-progress__fill');

  // Item 6a：所有自由板卡片（scene / image / wimg / beat / sound）都应显示 .bcard__resize 手柄。
  // 实际检查在「自由板」视图的 board 对象里跑（板视图后才渲染 bcard）；
  // 这里仅占位，featureChecks.allBcardsHaveResize 从 board.allBcardsHaveResize 读取。
  void 0;

  const report = {
    title: document.title,
    mounted: !!q('.app-shell'),
    toolbarButtons: qa('.toolbar button').length,
    sidebarTabs: qa('.sidebar__tab').map((n) => n.textContent),
    editorBlocks: qa('.script-flow .sc-el').length,
    blockTypes: qa('.script-flow .sc-el').map((n) => n.dataset.type).slice(0, 12),
    firstBlocks: qa('.script-flow .sc-el').slice(0, 6).map((n) => n.innerHTML.slice(0, 40)),
    measureBlocks: qa('.sc-measure .sc-el').length,
    statusbar: txt('.statusbar'),
    navItems: qa('.nav-item').length,
    navFirst: txt('.nav-item'),
    placeholders: qa('.script-flow .sc-el.is-empty').length,
    progressBar: txt('.write-progress') || '(未渲染)',
  };

  // 切换到其他视图，验证不崩溃
  const clickByText = (label) => {
    const btn = qa('button').find((b) => b.textContent.trim() === label);
    if (btn) btn.click();
    return !!btn;
  };
  const switches = {};
  ['故事板', '预览', '统计', '写作', '自由板'].forEach((label) => {
    switches[label] = clickByText(label);
  });

  setTimeout(() => {
    // 自由板为最后一个视图，此时 React 已完成渲染
    const board = switches['自由板']
      ? {
          canvas: !!q('.board__canvas'),
          world: !!q('.board__world'),
          sceneCards: qa('.bcard--scene').length,
          beatCards: qa('.bcard--beat').length,
          zoomCtl: !!q('.zoom-ctl'),
          linkSelects: qa('.bcard__link').length,
          // alpha.16：自由板工具栏必须存在三分区和全部颜色控制；否则背景层级回退时会再次整条消失。
          subTabs: qa('.board__subtabs [role="tab"]').length,
          colorControls: qa('.board__color-bar button[aria-label^="卡片颜色"]').length,
          // Item 6a：所有自由板卡片（scene / image / wimg / beat / sound）都应有 resize 手柄
          allBcardsHaveResize: qa('.bcard').length > 0 && qa('.bcard__resize').length >= qa('.bcard').length,
        }
      : null;

    // 新功能回归：两张卡建立关系线；备注控件和目标页数必须可见。
    const connectors = qa('.bcard__connect');
    if (connectors.length > 1) {
      connectors[0].click();
    }
    setTimeout(() => {
      const nextConnector = qa('.bcard__connect').find((node) => !node.classList.contains('is-active'));
      if (nextConnector) nextConnector.click();
      setTimeout(() => {
      const relationInput = q('.board-link-note input');
      if (relationInput) {
        relationInput.value = '人物关系';
        relationInput.dispatchEvent(new w.Event('input', { bubbles: true }));
      }
      const featureChecks = {
        // 兼容：alpha.1 旧选择器也接受，便于在不同 commit 之间跑回归
        targetPagesVisible,
        typewriterPointerVisible,
        // 第五项进度条独有
        progressSceneBands,
        progressThemeButtonRemoved,
        progressEndIcon,
        progressFillBar,
        // Item 6a：所有自由板卡片（scene / image / wimg / beat / sound）都应有 resize 手柄
        allBcardsHaveResize: !!(board && board.allBcardsHaveResize),
        boardSubTabsVisible: !!(board && board.subTabs === 3),
        boardColorControlsVisible: !!(board && board.colorControls === 8),
        boardRelationCreated: qa('.board-links line').length >= 1,
        boardRelationNoteEditable: !!relationInput,
      };
      clickByText('统计');
      setTimeout(() => {
        const characterInput = q('.character-name-edit');
        if (characterInput) {
          const oldName = characterInput.value;
          characterInput.focus();
          characterInput.value = '角色甲·改';
          characterInput.blur();
          featureChecks.characterRenameControl = oldName !== '';
        } else featureChecks.characterRenameControl = false;
        setTimeout(() => {
          clickByText('写作');
          setTimeout(() => {
            featureChecks.characterRenameSynced = qa('.script-flow .sc-el[data-type="character"]').some((node) => node.textContent.trim() === '角色甲·改');
            console.log('=== 渲染检查 ===');
            console.log(JSON.stringify({ ...report, viewSwitch: switches, board, featureChecks }, null, 2));
            console.log('\n=== 切回写作视图后的元素数 ===');
            console.log('blocks after roundtrip:', qa('.script-flow .sc-el').length);
            console.log('\n=== console.error 输出 ===');
            console.log(errors.length ? errors.slice(0, 20).join('\n---\n') : '(无错误)');
            const failed = Object.entries(featureChecks).filter(([, ok]) => !ok).map(([name]) => name);
            if (failed.length) console.log(`\n=== 功能回归失败 ===\n${failed.join(', ')}`);
            process.exit(errors.length || failed.length ? 1 : 0);
          }, 400);
        }, 250);
      }, 250);
      }, 150);
    }, 250);
    return;
  }, 1200);
}, 1200);
})();
