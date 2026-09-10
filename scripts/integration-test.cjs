/**
 * 集成测试：用真实 Electron 运行已构建的渲染进程，验证四处修复：
 *  1) PDF 导出有内容（白底深色字，printToPDF 生成非空 PDF）
 *  2) 预览文字为深色（不再是白底浅字）
 *  3) 自由板卡片可拖动（场景卡 / 灵感卡）
 *  4) 故事板新增幕标题为中文数字（第一幕/第二幕…），格式统一
 * 运行： ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/integration-test.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// 渲染进程会通过 preload 调用这些通道（最近文件、应用信息等），测试环境需兜底实现
['dialog:open', 'dialog:save', 'dialog:saveAs', 'pdf:export', 'file:show'].forEach((ch) => {
  ipcMain.handle(ch, () => null);
});
ipcMain.handle('app:recent', () => []);
ipcMain.handle('app:info', () => ({ version: 'test', platform: process.platform }));

// 使用独立的 userData，避免影响真实应用数据
try {
  app.setPath('userData', '/tmp/guangying-test-ud');
} catch (e) {
  /* ignore */
}

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'dist-renderer', 'index.html');
const OUT_PDF = '/tmp/guangying-test.pdf';

const results = [];
const LOG = '/tmp/guangying-test-log.txt';
try { fs.writeFileSync(LOG, ''); } catch (e) {}
function log(line) {
  try { fs.appendFileSync(LOG, line + '\n'); } catch (e) {}
  console.log(line);
}
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 模拟点击原生菜单，与 electron/main.js 里 send('menu:action') 走完全同一条链路 */
async function sendMenu(win, action) {
  win.webContents.send('menu:action', action);
  await sleep(450);
}

async function clickView(win, label) {
  return win.webContents.executeJavaScript(`(function(){
    var btns = Array.from(document.querySelectorAll('.toolbar__group.segmented button'));
    var b = btns.find(function(x){ return x.textContent.trim() === ${JSON.stringify(label)}; });
    if (b) { b.click(); return true; }
    return false;
  })()`);
}

async function getText(win, sel) {
  return win.webContents.executeJavaScript(`(function(){
    var n = document.querySelector(${JSON.stringify(sel)});
    return n ? n.textContent.trim() : null;
  })()`);
}

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    webPreferences: {
      // 必须加载与生产一致的 preload：菜单 action 经由它进入渲染进程。
      // 不加载的话 isElectron() 为 false，App 会走浏览器降级分支，
      // 测到的就不是「原生菜单 → store」这条真实链路了。
      preload: path.join(ROOT, 'electron', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.on('console-message', () => {});
  await win.loadFile(RENDERER);
  await sleep(1500);

  // ---- 2) 预览文字深色 + 1) PDF 有内容 ----
  await clickView(win, '预览');
  await sleep(1800);

  const pageCount = await win.webContents.executeJavaScript(
    `document.querySelectorAll('.preview__page').length`,
  );
  check('预览生成分页（页数 > 0）', pageCount > 0, `pages=${pageCount}`);

  const colorDark = await win.webContents.executeJavaScript(`(function(){
    var el = document.querySelector('.preview__page .sc-el');
    if (!el) return null;
    var c = getComputedStyle(el).color; // rgb(r,g,b)
    var m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(c);
    if (!m) return c;
    var lum = (+m[1]) + (+m[2]) + (+m[3]);
    return lum; // 越小越深
  })()`);
  check('预览剧本文字为深色（非白底浅字）', colorDark !== null && Number(colorDark) < 500, `luma=${colorDark}`);

  try {
    const data = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'none' },
      preferCSSPageSize: false,
      landscape: false,
    });
    fs.writeFileSync(OUT_PDF, data);
    const sz = fs.statSync(OUT_PDF).size;
    const head = fs.readFileSync(OUT_PDF).slice(0, 5).toString('latin1');
    check('PDF 导出有内容（非空且为合法 PDF）', sz > 8000 && head === '%PDF-', `bytes=${sz}`);
  } catch (e) {
    check('PDF 导出有内容', false, String(e && e.message));
  }

  // ---- 3) 自由板卡片可拖动 ----
  await clickView(win, '自由板');
  await sleep(900);

  const hasCanvas = await win.webContents.executeJavaScript(`!!document.querySelector('.board__canvas')`);
  check('自由板画布已渲染', hasCanvas);

  async function dragFirstCard(cls) {
    const before = await win.webContents.executeJavaScript(`(function(){
      var c = document.querySelector(${JSON.stringify(cls)});
      return c ? c.style.left : null;
    })()`);
    if (before === null) return { before: null, after: null };
    await win.webContents.executeJavaScript(`(function(){
      var c = document.querySelector(${JSON.stringify(cls)});
      var r = c.getBoundingClientRect();
      var mk = function(type, x, y){ return new MouseEvent(type, {clientX:x, clientY:y, button:0, bubbles:true, cancelable:true}); };
      c.dispatchEvent(mk('mousedown', r.left + 20, r.top + 20));
      window.dispatchEvent(mk('mousemove', r.left + 140, r.top + 90));
      window.dispatchEvent(mk('mouseup', r.left + 140, r.top + 90));
    })()`);
    await sleep(350);
    const after = await win.webContents.executeJavaScript(`(function(){
      var c = document.querySelector(${JSON.stringify(cls)});
      return c ? c.style.left : null;
    })()`);
    return { before, after };
  }

  const beat = await dragFirstCard('.bcard--beat');
  check('自由板·灵感卡可拖动', beat.before !== null && beat.after !== null && beat.before !== beat.after,
    `left ${beat.before} → ${beat.after}`);

  const scene = await dragFirstCard('.bcard--scene');
  check('自由板·场景卡可拖动', scene.before !== null && scene.after !== null && scene.before !== scene.after,
    `left ${scene.before} → ${scene.after}`);

  // ---- 3b) 拖卡后通过真实菜单链路撤销，按一次应完全回退 ----
  await sendMenu(win, 'edit:undo');
  const sceneUndo = await win.webContents.executeJavaScript(`(function(){
    var c = document.querySelector('.bcard--scene');
    return c ? c.style.left : null;
  })()`);
  check('自由板·拖卡后按一次「撤销」回到原位（菜单链路生效）',
    scene.before !== null && sceneUndo === scene.before,
    `before=${scene.before} dragged=${scene.after} undo=${sceneUndo}`);

  // ---- 4) 故事板新增幕标题为中文数字 ----
  await clickView(win, '故事板');
  await sleep(900);
  // 只取真正的「幕」标题：它们是 <input class="cards__act-title">，
  // 未归幕分区用的是 <span class="cards__act-title">未归幕</span>，必须排除。
  const readActTitles = `Array.from(document.querySelectorAll('input.cards__act-title')).map(function(n){return n.value || n.textContent;})`;
  const titlesBefore = await win.webContents.executeJavaScript(readActTitles);
  // 点击“新增幕”
  await win.webContents.executeJavaScript(`(function(){
    var btn = Array.from(document.querySelectorAll('.cards__bar button')).find(function(b){ return b.textContent.indexOf('新增幕') >= 0; });
    if (btn) btn.click();
  })()`);
  await sleep(700);
  const titlesAfter = await win.webContents.executeJavaScript(readActTitles);
  const newTitle = titlesAfter[titlesAfter.length - 1];
  const isChinese = /^第[一二三四五六七八九十百零]+幕$/.test(newTitle || '');
  const addedOne = titlesAfter.length === titlesBefore.length + 1;
  check('故事板新增幕会新增一个分区', addedOne, `before=${titlesBefore.length} after=${titlesAfter.length}`);
  check('故事板新增幕标题为中文数字', addedOne && isChinese, `newTitle=${newTitle}`);
  check('幕标题格式统一（均为中文数字）', titlesAfter.every((t) => /^第[一二三四五六七八九十百零]+幕$/.test(t || '')),
    `titles=${JSON.stringify(titlesAfter)}`);

  // ---- 4b) 故事板：把「未归幕」的卡片拖入某个幕，验证归入该幕（用户原报 bug：拖不进第几幕）----
  // 完整签名：各分区标题 + 区内卡片文本，用于校验撤销后是否完全还原
  const readBoardSig = `Array.from(document.querySelectorAll('.cards__act')).map(function(s){
    var t = s.querySelector('input.cards__act-title');
    var name = t ? t.value : 'UNGROUPED';
    var cards = Array.from(s.querySelectorAll('.card')).map(function(c){ return (c.textContent || '').trim().slice(0, 24); });
    return name + '>' + cards.join('|');
  }).join(' // ')`;
  const sigBefore = await win.webContents.executeJavaScript(readBoardSig);

  const dragResult = await win.webContents.executeJavaScript(`(function(){
    function fire(el, type){
      var dt = { effectAllowed:'', dropEffect:'', setData:function(){}, getData:function(){return '';} };
      var ev = new Event(type, { bubbles:true, cancelable:true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      el.dispatchEvent(ev);
    }
    var sections = Array.from(document.querySelectorAll('.cards__act'));
    var ungrouped = sections.find(function(s){ return s.classList.contains('cards__act--ungrouped'); });
    var target = sections.find(function(s){ return !s.classList.contains('cards__act--ungrouped'); });
    if (!ungrouped || !target) return JSON.stringify({ err:'no-sections' });
    var card = ungrouped.querySelector('.card');
    if (!card) return JSON.stringify({ err:'no-card-in-ungrouped' });
    var beforeTarget = target.querySelectorAll('.card').length;
    var beforeUngrouped = ungrouped.querySelectorAll('.card').length;
    fire(card, 'dragstart');
    return new Promise(function(res){
      setTimeout(function(){
        fire(target, 'drop');
        setTimeout(function(){
          var afterTarget = target.querySelectorAll('.card').length;
          var afterUngrouped = ungrouped.querySelectorAll('.card').length;
          res(JSON.stringify({ beforeTarget: beforeTarget, afterTarget: afterTarget, beforeUngrouped: beforeUngrouped, afterUngrouped: afterUngrouped }));
        }, 450);
      }, 250);
    });
  })()`);
  let dr;
  try { dr = JSON.parse(dragResult); } catch (e) { dr = { err: String(e) }; }
  const movedIn = dr && !dr.err && dr.afterTarget === dr.beforeTarget + 1 && dr.afterUngrouped === dr.beforeUngrouped - 1;
  check('故事板：卡片可拖入指定幕（归入该幕）', movedIn, JSON.stringify(dr));

  // ---- 4c) 拖入幕后按一次「撤销」应同时还原「顺序」与「归幕」（一次操作 = 一条撤销记录）----
  const sigAfter = await win.webContents.executeJavaScript(readBoardSig);
  await sendMenu(win, 'edit:undo');
  const sigUndo = await win.webContents.executeJavaScript(readBoardSig);
  check('故事板·拖入幕后按一次「撤销」完全还原（顺序 + 归幕同步回退）',
    sigBefore !== sigAfter && sigUndo === sigBefore,
    `changed=${sigBefore !== sigAfter} restored=${sigUndo === sigBefore}`);

  // ---- 5) 写作字体颜色可设置 ----
  const readFontVar = () => win.webContents.executeJavaScript(
    `getComputedStyle(document.documentElement).getPropertyValue('--neon-yellow').trim()`,
  );
  // 通过菜单打开设置（同时验证 file:settings 链路）
  await sendMenu(win, 'file:settings');
  const openedAppearance = await win.webContents.executeJavaScript(`(function(){
    var tabs = Array.from(document.querySelectorAll('.modal .tabs button'));
    var t = tabs.find(function(b){ return b.textContent.trim() === '外观'; });
    if (!t) return false;
    t.click();
    return true;
  })()`);
  await sleep(400);
  const chipCount = await win.webContents.executeJavaScript(
    `document.querySelectorAll('.modal .rev-picker .rev-chip').length`,
  );
  const pick = async (i) => {
    await win.webContents.executeJavaScript(`(function(){
      var chips = document.querySelectorAll('.modal .rev-picker .rev-chip');
      if (chips[${i}]) chips[${i}].click();
    })()`);
    await sleep(400);
    return readFontVar();
  };
  // 双向验证：先选纯白（#ffffff），再选回荧光黄（#e9ff3a），不受上次运行残留影响
  const varWhite = await pick(1);
  const varYellow = await pick(0);
  check('设置·外观：字体颜色可切换（CSS 变量随选择变化）',
    openedAppearance && chipCount >= 2 && varWhite.toLowerCase() === '#ffffff' && varYellow.toLowerCase() === '#e9ff3a',
    `white=${varWhite} yellow=${varYellow} chips=${chipCount}`);

  await win.webContents.executeJavaScript(`(function(){
    var b = Array.from(document.querySelectorAll('.modal__foot button')).find(function(x){ return x.textContent.indexOf('完成') >= 0; });
    if (b) b.click();
  })()`);
  await sleep(400);

  await clickView(win, '写作');
  await sleep(700);
  const editorColor = await win.webContents.executeJavaScript(`(function(){
    var el = document.querySelector('.sc-el--editable');
    return el ? getComputedStyle(el).color : null;
  })()`);
  check('写作视图正文颜色跟随字体设置', editorColor === 'rgb(233, 255, 58)', `color=${editorColor}`);

  // ---- 6) 静态检查：防止已修复的 bug 回归 ----
  try {
    const mainSrc = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
    const grab = (act) => new RegExp('\\{[^{}]*' + act + '[^{}]*\\}').exec(mainSrc);
    const noRole = (m) => !!m && !/\brole\s*:/.test(m[0]);
    const u = grab('edit:undo');
    const r = grab('edit:redo');
    check('静态检查·编辑菜单「撤销」未设 role（否则 click 被原生 undo 吞掉）', noRole(u),
      u ? u[0].replace(/\s+/g, ' ').slice(0, 72) : 'not-found');
    check('静态检查·编辑菜单「重做」未设 role', noRole(r),
      r ? r[0].replace(/\s+/g, ' ').slice(0, 72) : 'not-found');
  } catch (e) {
    check('静态检查·编辑菜单 role', false, String(e && e.message));
  }
  try {
    const cv = fs.readFileSync(path.join(ROOT, 'src', 'components', 'CardsView.tsx'), 'utf8');
    check('静态检查·故事板落位用 moveScenesToAct 一次成型（单场/多场共享原子操作）',
      /moveScenesToAct\s*\(/.test(cv) && !/moveSceneTo\s*\(/.test(cv), '');
  } catch (e) {
    check('静态检查·CardsView 落位', false, String(e && e.message));
  }

  // 汇总
  const failed = results.filter((r) => !r.ok);
  log('\n=== 测试汇总 ===');
  log(`通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) log('失败项：' + failed.map((f) => f.name).join('; '));
  try {
    fs.writeFileSync('/tmp/guangying-test-result.json', JSON.stringify({ pass: results.length - failed.length, total: results.length, failed: failed.map((f) => f.name) }, null, 2));
  } catch (e) {}

  win.close();
  app.quit();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  try { fs.appendFileSync(LOG, '测试异常：' + (e && e.stack ? e.stack : String(e)) + '\n'); } catch (_) {}
  console.error('测试异常：', e);
  process.exit(2);
});
