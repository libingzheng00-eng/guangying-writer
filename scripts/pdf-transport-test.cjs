// 合成快照 + Electron mock；验证传输/隔离/清理契约，不替代真实 PDF 渲染验收。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(failAt) {
  const sessions = [];
  const windows = [];
  const privateError = () => { throw new Error('PRIVATE_SCREENPLAY data:image/png;base64,PRIVATE_IMAGE'); };
  const electron = {
    session: {
      fromPartition(partition, options) {
        if (failAt === 'session') privateError();
        const state = { partition, options, active: false, unhandled: 0 };
        const instance = {
          setPermissionRequestHandler(fn) { state.permission = fn; },
          setPermissionCheckHandler(fn) { state.permissionCheck = fn; },
          on(event, fn) { state[event] = fn; },
          webRequest: { onBeforeRequest(fn) { state.filter = fn; } },
          protocol: {
            handle(scheme, handler) {
              if (failAt === 'register') privateError();
              state.scheme = scheme; state.handler = handler; state.active = true;
            },
            unhandle(scheme) {
              assert.equal(scheme, state.scheme);
              state.active = false; state.handler = null; state.unhandled++;
              if (failAt === 'cleanup-protocol') privateError();
            },
          },
          state,
        };
        sessions.push(state);
        return instance;
      },
    },
    BrowserWindow: class {
      constructor(options) {
        if (failAt === 'create') privateError();
        this.options = options;
        this.destroyed = false;
        this.order = [];
        this.webContents = {
          setWindowOpenHandler: fn => { this.openHandler = fn; },
          on: (event, fn) => { this[event] = fn; },
          executeJavaScript: async script => {
            this.order.push('fonts-images'); this.script = script;
            if (failAt === 'fonts') privateError();
          },
          printToPDF: async options => {
            this.order.push('pdf'); this.pdfOptions = options;
            if (failAt === 'print') privateError();
            return Buffer.from('synthetic-pdf');
          },
        };
        windows.push(this);
      }
      async loadURL(url) {
        this.order.push('load'); this.url = url;
        const state = this.options.webPreferences.session.state;
        const response = await state.handler({ url, method: 'GET' });
        this.html = await response.text();
        this.headers = response.headers;
        this.wrongPathStatus = (await state.handler({ url: `${url}/other`, method: 'GET' })).status;
        this.wrongMethodStatus = (await state.handler({ url, method: 'POST' })).status;
        if (failAt === 'load') privateError();
      }
      isDestroyed() { return this.destroyed; }
      destroy() { this.destroyed = true; if (failAt === 'cleanup-window') privateError(); }
    },
  };
  const sandbox = { module: { exports: {} }, Response, require: name => name === 'electron' ? electron :
    name === './security' ? require('../electron/security') : require(name) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/pdf.js'), 'utf8'), sandbox);
  return { renderPdf: sandbox.module.exports.renderPdf, sessions, windows };
}

async function main() {
  let sourceReads = 0;
  let sourcePrints = 0;
  const sourceWindow = { get webContents() {
    sourceReads++;
    return { printToPDF: async () => { sourcePrints++; return Buffer.from('MUTATED_LIVE_DOCUMENT'); } };
  } };
  const invalid = harness();
  for (const opts of [undefined, null, {}, { html: '<section class="print-sheet"></section>' }, { mode: 'other' },
    { mode: 'print' }, { mode: 'print', html: '' }, { mode: 'print', html: 'PRIVATE_SCREENPLAY' },
    { mode: 'print', html: '<section class="export-sheet"></section>' },
    { mode: 'print', html: '<section class="not-print-sheet"></section>' },
    { mode: 'print', html: '<section data-class="print-sheet"></section>' }]) {
    await assert.rejects(invalid.renderPdf(sourceWindow, opts), error => {
      assert.match(error.message, /ESECURITY/);
      assert.doesNotMatch(error.message, /PRIVATE_SCREENPLAY/);
      return true;
    });
  }
  assert.equal(invalid.sessions.length, 0, 'invalid requests never allocate a print session');
  assert.equal(sourceReads, 0, 'invalid or missing options never fall back to the live window');

  const missing = harness();
  await assert.rejects(missing.renderPdf(null, { mode: 'creative', html: '' }), /缺少创作版画布快照/);
  assert.equal(missing.sessions.length, 0);

  // 超过旧 data URL 的 2 MB 边界；正文与超大内嵌图必须逐字保留，不能截断/重新排版。
  const html = '<!doctype html><meta charset="utf-8"><section class="export-sheet"><p>合成测试</p><img src="data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024) + '"></section>';
  const pageSize = { width: 356393, height: 1000000 };
  const opts = { mode: 'creative', html, pageSize };
  const printHTML = '<!doctype html><html><head><style>@page{size:A4;margin:0}</style></head><body><section class="print-sheet"><p>合成第一页</p></section><section class="print-sheet title-sheet"><p>合成第二页</p></section></body></html>';
  const printOpts = { mode: 'print', html: printHTML, pageSize: { width: 210000, height: 297000 } };
  for (const snapshot of [opts, printOpts]) {
  const h = harness();
  const result = await h.renderPdf(sourceWindow, snapshot);
  assert.equal(result.toString(), 'synthetic-pdf');
  assert.equal(snapshot.html, snapshot.mode === 'creative' ? html : printHTML, 'caller snapshot is never mutated');
  const w = h.windows[0];
  const s = h.sessions[0];
  assert.equal(w.html, snapshot.html, 'frozen HTML arrives intact in response body');
  assert.doesNotMatch(w.html, /MUTATED_LIVE_DOCUMENT/, 'live renderer content cannot replace the captured snapshot');
  assert.ok(w.url.length < 100 && !w.url.includes('data:'), 'navigation URL stays short');
  assert.equal(w.pdfOptions.pageSize, snapshot.mode === 'creative' ? pageSize : 'A4', 'creative dimensions and A4 paper semantics are preserved');
  assert.equal(w.pdfOptions.preferCSSPageSize, true);
  assert.equal(w.pdfOptions.landscape, false);
  assert.equal(w.pdfOptions.printBackground, true);
  assert.deepEqual(JSON.parse(JSON.stringify(w.pdfOptions.margins)), { top: 0, bottom: 0, left: 0, right: 0 });
  assert.deepEqual(w.order, ['load', 'fonts-images', 'pdf']);
  assert.match(w.script, /document\.fonts\.ready/);
  assert.match(w.script, /image\.decode\(\)/);
  assert.equal(w.wrongPathStatus, 403);
  assert.equal(w.wrongMethodStatus, 403);
  assert.equal(w.headers.get('cache-control'), 'no-store');
  assert.match(w.headers.get('content-security-policy'), /script-src 'none'/);
  assert.match(w.headers.get('content-security-policy'), /img-src data:/);
  assert.equal(w.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(w.options.webPreferences.sandbox, true);
  assert.equal(w.options.webPreferences.nodeIntegration, false);
  assert.equal(w.options.webPreferences.contextIsolation, true);
  assert.equal(w.openHandler().action, 'deny');
  let navigationPrevented = false;
  w['will-navigate']({ preventDefault() { navigationPrevented = true; } });
  assert.ok(navigationPrevented);
  assert.ok(!s.partition.startsWith('persist:'));
  assert.equal(s.options.cache, false);
  let permission;
  s.permission(null, 'geolocation', allowed => { permission = allowed; });
  assert.equal(permission, false);
  assert.equal(s.permissionCheck(), false);
  let downloadPrevented = false;
  s['will-download']({ preventDefault() { downloadPrevented = true; } });
  assert.equal(downloadPrevented, true, 'snapshot cannot initiate downloads outside the native export route');
  for (const url of ['https://example.invalid/x', 'http://example.invalid/x', 'file:///private/secret', 'ws://example.invalid/x', 'wss://example.invalid/x', 'ftp://example.invalid/x', `${w.url}/other`]) {
    let cancelled;
    s.filter({ url }, result => { cancelled = result.cancel; });
    assert.equal(cancelled, true, `deny external/resource request: ${url}`);
  }
  for (const url of [w.url, 'data:image/png;base64,AAAA', 'data:font/woff2;base64,AAAA']) {
    s.filter({ url }, result => assert.equal(result.cancel, false));
  }
  assert.equal(w.destroyed, true);
  assert.equal(s.active, false);
  assert.equal(s.handler, null);
  assert.equal(s.unhandled, 1);
  }

  for (const snapshot of [opts, printOpts]) {
  for (const failAt of ['session', 'register', 'create', 'load', 'fonts', 'print', 'cleanup-window', 'cleanup-protocol']) {
    const failure = harness(failAt);
    await assert.rejects(failure.renderPdf(sourceWindow, snapshot), error => {
      assert.match(error.message, snapshot.mode === 'creative' ? /创作版 PDF 导出失败/ : /A4 打印版 PDF 导出失败/);
      assert.doesNotMatch(error.message, /PRIVATE|data:|base64/);
      return true;
    });
    if (failAt !== 'session') {
      assert.equal(failure.sessions[0].active, false, `${failAt}: protocol removed`);
      assert.equal(failure.sessions[0].unhandled, failAt === 'register' ? 0 : 1);
    }
    assert.ok(failure.windows.every(window => window.destroyed), `${failAt}: window destroyed`);
  }
  }

  const concurrent = harness();
  const otherHTML = '<section class="export-sheet">独立合成内容</section>';
  await Promise.all([concurrent.renderPdf(sourceWindow, opts), concurrent.renderPdf(sourceWindow, { ...opts, html: otherHTML }), concurrent.renderPdf(sourceWindow, printOpts)]);
  assert.equal(new Set(concurrent.sessions.map(s => s.partition)).size, 3);
  assert.equal(new Set(concurrent.windows.map(w => w.url)).size, 3);
  assert.deepEqual(concurrent.windows.map(w => w.html), [html, otherHTML, printHTML]);
  assert.ok(concurrent.sessions.every(s => !s.active && s.unhandled === 1));
  assert.ok(concurrent.windows.every(w => w.destroyed));
  assert.equal(sourceReads, 0, 'no PDF path reads the live renderer');
  assert.equal(sourcePrints, 0, 'sourceWindow.printToPDF is never called');
  console.log('PASS: PDF transport (3 MB creative HTML, frozen A4 pages, no live-window fallback, isolated concurrent exports, offline/download security, failure cleanup, safe errors). Mock checks only; run pdf-layout-electron for actual PDF.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
