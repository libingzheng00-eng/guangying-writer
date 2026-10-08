/** Native security probes, loaded only by the temporary QA manifest.
 * Calls the real production preload/IPC. No handler capture or trusted-sender
 * bypass; probe files/windows belong exclusively to this synthetic test.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { BrowserWindow } = require('electron');

const hostileHtml = '合成前<b onclick="window.__projectPwned=1">粗体</b><br><i>斜体</i><img src="https://security-fixture.invalid/asset" onerror="window.__projectPwned=1"><svg onload="window.__projectPwned=1"><text>丢弃</text></svg><script>window.__projectPwned=1</script>合成后';
const safeHtml = '合成前<b>粗体</b><br><i>斜体</i>合成后';
const hostileMetadata = '</style><script id="metadata-script">window.syntheticAttack=1</script><img id="metadata-image" src="file:///synthetic/private.png">';
const hostileImage = 'https://outside.invalid/native-qa.png';
const hostileColor = 'url(file:///synthetic/beat.png)';

function bounded(task, label, timeout = 10000) {
  let timer;
  return Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), timeout); })])
    .finally(() => clearTimeout(timer));
}

async function observeRequests(window) {
  const requests = [];
  window.webContents.debugger.attach('1.3');
  const observe = (_event, method, params) => {
    if (method !== 'Network.requestWillBeSent') return;
    const url = params.request.url;
    if (/^(?:https?|ftp):/i.test(url) || /^file:\/\/\/synthetic\//i.test(url)) requests.push(url);
  };
  window.webContents.debugger.on('message', observe);
  const stop = () => {
    window.webContents.debugger.removeListener('message', observe);
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
    return requests;
  };
  try { await bounded(window.webContents.debugger.sendCommand('Network.enable'), 'Network.enable on initialized QA renderer'); }
  catch (error) { stop(); throw error; }
  return { stop };
}

async function verifyDisplaySafety(run) {
  const value = await run(`(() => {
    const cards=[...document.querySelectorAll('.writing-material-card--image')];
    const blocked=cards.find(e=>e.querySelector('input')?.value==='合成阻止外部图片');
    return { count:cards.length, imageCount:cards.reduce((n,e)=>n+e.querySelectorAll('img').length,0),
      blocked:!!blocked&&!blocked.querySelector('img')&&blocked.textContent.includes('图片来源已阻止'),
      note:blocked?.querySelector('textarea')?.value };
  })()`);
  assert.deepEqual(value, { count: 2, imageCount: 1, blocked: true, note: '外部地址必须保留为备注，不能请求资源。' });
}

async function verifyHtmlExport({ win, run, until, pause, temporary, output, saveChoices, pass }) {
  async function click(expression) {
    const point = await run(`(() => {const e=${expression};if(!e)throw Error('Missing HTML export control');const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,hit:!!hit&&(hit===e||e.contains(hit))};})()`);
    assert.equal(point.hit, true, 'HTML export click target must be topmost');
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, button: 'left', clickCount: 1, x: Math.round(point.x), y: Math.round(point.y) });
    await pause(100);
  }
  const exportedFile = path.join(temporary, '合成网页导出.html');
  saveChoices.push({ path: exportedFile, extension: 'html' });
  await click(`document.querySelector('.toolbar [aria-haspopup="menu"]')`);
  await until('!!document.querySelector(\'[role="menu"]\')', 'HTML export menu opens');
  await click(`Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()==='导出网页 HTML…')`);
  await until(() => fs.existsSync(exportedFile), 'HTML export writes through production saveAs IPC');
  fs.copyFileSync(exportedFile, path.join(output, 'export-security.html'));
  const proof = new BrowserWindow({ width: 1024, height: 768, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'qa-html-' + randomUUID() } });
  const evidence = { status: 'running', windowId: proof.id, stages: [] };
  const journal = () => fs.writeFileSync(path.join(output, 'html-export-stages.json'), JSON.stringify(evidence, null, 2));
  const step = async (name, action, timeout = 10000) => {
    evidence.current = name; journal();
    const started = Date.now();
    try {
      const result = await bounded(Promise.resolve().then(action), `HTML proof ${name}`, timeout);
      evidence.stages.push({ name, status: 'passed', durationMs: Date.now() - started }); journal();
      return result;
    } catch (error) {
      evidence.stages.push({ name, status: 'failed', durationMs: Date.now() - started, error: String(error.message) }); journal();
      throw error;
    }
  };
  let observer;
  try {
    // A newly constructed hidden window may not yet own a renderer/CDP target.
    // Initialize only inert about:blank, then enable observation BEFORE the
    // exported document's first load so its earliest requests remain covered.
    await step('blank-ready', () => proof.loadURL('about:blank'));
    observer = await step('network-ready', () => observeRequests(proof));
    await step('export-loaded', () => proof.loadFile(exportedFile));
    proof.show(); proof.focus();
    await step('painted', () => proof.webContents.executeJavaScript('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))'));
    const value = await step('DOM-read', () => proof.webContents.executeJavaScript(`(() => ({
      active:document.querySelectorAll('script,img,iframe,object,embed,link,base,form').length,
      styles:document.querySelectorAll('style').length,
      unsafeStyle:/url\\s*\\(|<|metadata-script/i.test(document.querySelector('style')?.textContent||''),
      title:document.title, executed:typeof window.syntheticAttack!=='undefined',
      csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,
      text:document.body.textContent
    }))()`));
    assert.equal(value.active, 0); assert.equal(value.styles, 1); assert.equal(value.unsafeStyle, false);
    assert.equal(value.title, hostileMetadata); assert.equal(value.executed, false);
    assert.ok(value.csp.includes("default-src 'none'"));
    assert.ok(value.text.includes('合成前粗体斜体合成后'));
    await pause(150);
    evidence.requests = observer.stop(); observer = null;
    assert.deepEqual(evidence.requests, [], 'Exported HTML must not attempt remote or synthetic private-file requests');
    fs.writeFileSync(path.join(output, 'html-export-dom.json'), JSON.stringify(value, null, 2));
    evidence.stages.push({ name: 'DOM-verified', status: 'passed' }); journal();
    await step('captured', async () => fs.writeFileSync(path.join(output, 'html-export.png'), (await proof.webContents.capturePage()).toPNG()), 8000);
    evidence.status = 'passed'; journal();
    pass('real toolbar HTML export retains literal hostile title and body; actual Chromium DOM has one trusted stylesheet, restrictive CSP, no active/resource nodes, execution or external requests');
  } catch (error) {
    evidence.status = 'failed'; evidence.error = String(error.message); journal();
    throw error;
  } finally {
    if (observer && !proof.isDestroyed()) observer.stop();
    if (!proof.isDestroyed()) proof.destroy();
    win.show(); win.focus();
  }
}

async function verifySanitizedProject(run) {
  const value = await run(`(() => {
    const e=document.querySelector('.script-flow [data-id="security-html"]');
    return { html:e?.innerHTML, executed:typeof window.__projectPwned!=='undefined',
      unsafe:!!e?.querySelector('img,svg,math,script,iframe,object,embed'),
      eventAttribute:[...(e?.querySelectorAll('*')||[])].some(n=>[...n.attributes].some(a=>/^on/i.test(a.name))) };
  })()`);
  assert.deepEqual(value, { html: safeHtml, executed: false, unsafe: false, eventAttribute: false }, 'Untrusted .zhsp HTML must be sanitized before entering the live editor');
}

async function runSecurityChecks({ win, run, until, pause, root, temporary, saveChoices, report, pass }) {
  const checks = [];
  const mark = name => { checks.push(name); pass(name); };
  async function rejects(expression, label, evaluate = run) {
    const outcome = await evaluate(`(async()=>{try{await (${expression});return {rejected:false};}catch(error){return {rejected:true,message:String(error?.message||error)};}})()`);
    assert.equal(outcome.rejected, true, label + ' must reject');
    assert.match(outcome.message, /ESECURITY/, label + ' exposes only the static security rejection');
    assert.ok(!outcome.message.includes(temporary), label + ' must not disclose a local path');
  }

  const deniedPath = path.join(temporary, '未经授权写入.zhsp');
  const content = JSON.stringify({ app: 'guangying-writer', fileVersion: 1, project: {
    id: 'security-only', name: '合成授权探针', createdAt: 1, updatedAt: 1, titlePage: { show: false }, settings: {},
    acts: [], sceneMeta: [], boardLinks: [], revisions: [], elements: [{ id: 'security-empty', type: 'action', text: '' }], beats: [],
  } });
  const dialogsBefore = report.dialogs.length;
  saveChoices.push({ canceled: true, extension: 'zhsp' });
  const result = await run(`window.api.saveProject(${JSON.stringify({ path: deniedPath, content, name: '未经授权写入' })})`);
  assert.equal(result, null);
  assert.equal(report.dialogs.length, dialogsBefore + 1, 'Unknown absolute project target must request native approval');
  assert.equal(fs.existsSync(deniedPath), false);
  mark('unapproved absolute project path requests a native save choice; cancellation creates no file');

  const dialogsAfterCancel = report.dialogs.length;
  const invalidCallsBefore = { ...report.nativeCalls };
  await rejects(`window.api.saveProject(${JSON.stringify({ path: '../outside.zhsp', content })})`, 'Relative save target');
  await rejects(`window.api.showInFolder(${JSON.stringify(deniedPath)})`, 'Unapproved reveal target');
  for (const options of [
    { mode: 'untrusted', html: '<p>fixture</p>' },
    { mode: 'creative', html: '<p>missing export-sheet</p>', pageSize: { width: 210000, height: 297000 } },
    { mode: 'creative', html: '<section class="export-sheet">fixture</section>', pageSize: { width: 999999999, height: 297000 } },
  ]) await rejects(`window.api.exportPdf(${JSON.stringify(options)})`, 'Malformed PDF options');
  assert.equal(report.dialogs.length, dialogsAfterCancel, 'Rejected IPC must not reach a native dialog');
  assert.deepEqual(report.nativeCalls, invalidCallsBefore, 'Malformed IPC must reject before a native stub can throw for an empty choice queue');
  assert.equal(fs.existsSync(deniedPath), false);
  mark('real renderer IPC rejects relative writes, unauthorized reveal and invalid PDF options before filesystem/dialog work');

  // Obtain one capability through the trusted native-selection boundary, never
  // by seeding the authorization ledger. Foreign save/reveal probes must use
  // otherwise valid arguments, so path rejection cannot mask a missing sender
  // check. Stub entry counters below also expose a rejected empty mock queue.
  const authorizedPath = path.join(temporary, '可信选择的合成工程.zhsp');
  saveChoices.push({ path: authorizedPath, extension: 'zhsp' });
  assert.equal(await run(`window.api.saveProjectAs(${JSON.stringify({ content, name: '可信选择的合成工程', ext: 'zhsp' })})`), authorizedPath);
  assert.equal(fs.readFileSync(authorizedPath, 'utf8'), content);
  const foreignDialogsBefore = report.dialogs.length;
  const foreignCallsBefore = { ...report.nativeCalls };

  // A distinct real webContents with the exact production URL and preload is
  // still not the trusted editor. This isolates window identity from URL checks.
  const probeFile = path.join(temporary, 'untrusted-origin.html');
  fs.writeFileSync(probeFile, '<!doctype html><meta charset="utf-8"><title>Synthetic IPC origin probe</title><p>Only synthetic QA content.</p>', { flag: 'wx' });
  const hostile = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(root, 'electron', 'preload.js'), sandbox: true,
    contextIsolation: true, nodeIntegration: false, partition: 'qa-security-' + randomUUID(),
  } });
  try {
    await Promise.race([hostile.loadFile(path.join(root, 'dist-renderer', 'index.html')), pause(10000).then(() => { throw Error('Untrusted QA window load timed out'); })]);
    assert.equal(hostile.webContents.getURL(), win.webContents.getURL(), 'Foreign window must use the same URL, not merely fail an origin check');
    const foreignRun = js => Promise.race([hostile.webContents.executeJavaScript(js), pause(8000).then(() => { throw Error('Untrusted IPC probe timed out'); })]);
    assert.equal(await foreignRun('!!window.api?.isElectron'), true, 'Probe must use the actual production preload');
    for (const expression of ['window.api.getInfo()', 'window.api.getRecent()', 'window.api.openProject()',
      `window.api.saveProject(${JSON.stringify({ content, path: authorizedPath })})`,
      `window.api.saveProjectAs(${JSON.stringify({ content, name: 'fixture', ext: 'zhsp' })})`,
      `window.api.exportPdf(${JSON.stringify({ mode: 'print', html: '<p>fixture</p>' })})`,
      `window.api.showInFolder(${JSON.stringify(authorizedPath)})`]) await rejects(expression, 'Foreign webContents ' + expression.split('(')[0], foreignRun);
    assert.equal(report.dialogs.length, foreignDialogsBefore, 'Foreign IPC cannot open a dialog');
    assert.deepEqual(report.nativeCalls, foreignCallsBefore, 'Foreign IPC must reject before any native stub entry, not because an empty mock choice queue threw');
    assert.equal(fs.readFileSync(authorizedPath, 'utf8'), content);
    assert.equal(fs.existsSync(authorizedPath + '.guangying-backup'), false, 'Rejected foreign save cannot create a backup or touch an authorized project');
    assert.equal(fs.existsSync(deniedPath), false);
    mark('all seven production preload invoke channels reject a separate real webContents at the exact production URL without side effects');
  } finally { if (!hostile.isDestroyed()) hostile.destroy(); }

  const originalUrl = win.webContents.getURL();
  const originalWindowCount = BrowserWindow.getAllWindows().length;
  const targetUrl = pathToFileURL(probeFile).href;
  const navigations = [];
  // Electron dispatches will-frame-navigate first. A production guard that
  // cancels it correctly prevents the later will-navigate event altogether.
  const navigationObservers = ['will-frame-navigate', 'will-navigate'].map(name => {
    const observe = (event, url) => { navigations.push({ event: name, url: typeof url === 'string' ? url : event.url, prevented: event.defaultPrevented }); };
    win.webContents.on(name, observe);
    return [name, observe];
  });
  try {
    await run(`window.open(${JSON.stringify(targetUrl)}, '_blank'); null`);
    await pause(250);
    assert.equal(BrowserWindow.getAllWindows().length, originalWindowCount, 'Untrusted popup must not create a new browser window');
    await run(`location.href=${JSON.stringify(targetUrl)}; null`);
    await until(() => navigations.length > 0, 'real renderer navigation attempt reaches the production guard');
    await pause(150);
    assert.equal(win.webContents.getURL(), originalUrl, 'Production editor must remain at its trusted entry');
    assert.ok(navigations.some(item => item.url === targetUrl && item.prevented), 'Navigation guard must visibly prevent the actual attempt');
    mark('real renderer popup and file navigation attempts are blocked without leaving the trusted editor');
  } finally { for (const [name, observe] of navigationObservers) win.webContents.removeListener(name, observe); }
  win.show(); win.focus();
  return { status: 'passed', checks, limitations: ['Subframe identity rejection is covered by the main-process regression harness; this native probe proves a separate webContents is rejected'] };
}

module.exports = { runSecurityChecks, verifySanitizedProject, verifyDisplaySafety, verifyHtmlExport, observeRequests, hostileHtml, safeHtml, hostileMetadata, hostileImage, hostileColor };
