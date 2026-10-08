/**
 * Raw distributable startup, separate from the instrumented QA-copy smoke test.
 * Usage: node scripts/windows-launch.cjs --app <unpacked-app> --output <new-dir>
 * Runs only on an ephemeral GitHub-hosted Windows runner. No product file, entry
 * point, dialog, preload, project or browser storage is replaced/seeded.
 *
 * Electron 31.7.7 isolation source evidence (checked before implementing this):
 * https://github.com/electron/electron/blob/v31.7.7/shell/app/electron_main_delegate.cc#L303-L308
 * PreSandboxStartup maps --user-data-dir to chrome::DIR_USER_DATA before app JS.
 * https://github.com/electron/electron/blob/v31.7.7/shell/browser/api/electron_api_app.cc#L379
 * app.getPath('userData') uses this same PathService key (GetPath: L844-L852).
 * DIR_SESSION_DATA defaults to DIR_USER_DATA (electron_main_delegate.cc L134-L136).
 * The runtime checks below also verify both paths, the actual executable, and
 * the original main filename. Inspector/CDP are observation and close controls;
 * no pre-entry injection, app.setPath, app.exit, win.destroy or dialog stubs.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { spawn, spawnSync } = require('node:child_process');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const outside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
};

function inventory(root) {
  const files = {};
  function visit(absolute, relative) {
    const stat = fs.lstatSync(absolute);
    assert.ok(!stat.isSymbolicLink(), `Distributable contains a symbolic link: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(absolute, name), relative ? `${relative}/${name}` : name);
    } else {
      assert.ok(stat.isFile(), `Distributable contains a nonregular file: ${relative}`);
      files[relative] = { bytes: stat.size, sha256: createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') };
    }
  }
  visit(root, '');
  return files;
}

async function connect(url, onEvent) {
  assert.ok(/^ws:\/\/127\.0\.0\.1:\d+\//.test(url), 'Debugging must stay on loopback');
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  let intentionalClose = false;
  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Debug WebSocket connection timed out')); }, 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Debug WebSocket connection failed')); }, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result);
    } else onEvent(message);
  });
  socket.addEventListener('close', () => {
    if (!intentionalClose) onEvent({ method: 'Transport.closed' });
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(`Debug socket closed during ${request.method}`)); }
    pending.clear();
  });
  socket.addEventListener('error', () => { if (!intentionalClose) onEvent({ method: 'Transport.error' }); });
  await opened;
  return {
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
        pending.set(id, { resolve, reject, timer, method });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    close() { intentionalClose = true; socket.close(); },
  };
}

async function evaluate(client, expression) {
  const response = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}

async function main() {
  assert.equal(process.platform, 'win32', 'Raw Windows startup must run on Windows');
  assert.equal(process.arch, 'x64', 'Raw Windows startup supports x64 only');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Run only on a disposable GitHub Actions runner');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'A clean GitHub-hosted runner is required; never run against a personal desktop profile');
  const args = process.argv.slice(2);
  assert.equal(args.length, 4, 'Usage: node scripts/windows-launch.cjs --app <unpacked-app> --output <new-directory>');
  assert.equal(args[0], '--app'); assert.equal(args[2], '--output');
  const source = fs.realpathSync(args[1]);
  const output = path.resolve(args[3]);
  assert.ok(outside(source, output), 'Evidence must be outside the distributable');
  assert.ok(!fs.existsSync(output), 'Evidence directory already exists; choose a new directory');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  assert.ok(outside(source, path.join(fs.realpathSync(path.dirname(output)), path.basename(output))), 'Evidence parent must not alias the distributable');
  fs.mkdirSync(output);
  const sourceApp = path.join(source, 'resources', 'app');
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceApp, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'guangying-writer');
  assert.equal(manifest.main, 'electron/main.js');
  const exe = path.join(source, 'GuangyingWriter.exe');
  const before = inventory(source);
  assert.ok(before['GuangyingWriter.exe'] && before['resources/app/electron/main.js'] && before['resources/app/dist-renderer/index.html']);
  fs.writeFileSync(path.join(output, 'package-before.json'), JSON.stringify(before, null, 2) + '\n', { flag: 'wx' });

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-raw-launch-'));
  const userData = path.join(temporary, '独立首启数据');
  fs.mkdirSync(userData);
  assert.deepEqual(fs.readdirSync(userData), []);
  const report = {
    status: 'running', scope: 'raw distributed EXE with original package.json, main, preload and renderer bytes',
    version: manifest.version, platform: process.platform, architecture: process.arch,
    isolation: { userData, nativeSwitch: '--user-data-dir', preEntryInjection: false,
      source: 'https://github.com/electron/electron/blob/v31.7.7/shell/app/electron_main_delegate.cc#L303-L308' },
    instrumentation: 'Loopback Node inspector and renderer CDP: read-only runtime/DOM checks, screenshot, then BrowserWindow.close(); no method replacement or data seeding',
    limitations: ['This is startup acceptance, not system IME, native picker, installer, signing or SmartScreen acceptance',
      'Screenshot captures the renderer viewport; it is not a native Windows desktop screenshot'],
    checks: [], errors: [],
  };
  const journal = () => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  const pass = name => { report.checks.push(name); journal(); console.log('PASS', name); };
  journal();
  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR', 'NODE_OPTIONS', 'ZS_DEV',
    'GUANGYING_WINDOWS_SMOKE_CONFIG', 'GUANGYING_WINDOWS_SMOKE_PHASE']) delete env[key];
  const child = spawn(exe, [`--user-data-dir=${userData}`, '--inspect=127.0.0.1:0', '--remote-debugging-port=0'], {
    cwd: source, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  report.pid = child.pid;
  let exit = null, spawnError = null, logText = '', mainClient, pageClient, closing = false;
  const log = fs.createWriteStream(path.join(output, 'raw-startup.log'), { flags: 'wx' });
  for (const stream of [child.stdout, child.stderr]) {
    // Decode across chunk boundaries so a split Chinese exception message is
    // still preserved verbatim and recognized by the fatal-log assertion.
    stream.setEncoding('utf8');
    stream.on('data', data => { log.write(data); logText += data; });
  }
  child.on('error', error => { spawnError = error; });
  child.on('close', (code, signal) => { exit = { code, signal }; });
  const started = Date.now();
  async function until(check, description, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (exit && !closing) throw new Error(`Application exited before ${description}: ${JSON.stringify(exit)}`);
      if (Date.now() - started > 100000) throw new Error('Raw startup overall deadline exceeded');
      const value = await check();
      if (value) return value;
      await pause(100);
    }
    throw new Error(`Timeout: ${description}`);
  }
  function events(origin) {
    return message => {
      if (message.method === 'Runtime.exceptionThrown') report.errors.push({ origin, kind: 'exception', details: message.params.exceptionDetails });
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        report.errors.push({ origin, kind: 'console.error', args: message.params.args.map(arg => arg.value ?? arg.description) });
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') report.errors.push({ origin, kind: 'log', details: message.params.entry });
      if (message.method === 'Inspector.targetCrashed') report.errors.push({ origin, kind: 'renderer-crash' });
      if (message.method === 'Transport.closed' || message.method === 'Transport.error') report.errors.push({ origin, kind: 'unexpected-debug-disconnect' });
    };
  }
  try {
    const inspectorUrl = await until(() => logText.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1], 'main inspector address');
    mainClient = await connect(inspectorUrl, events('main'));
    await mainClient.call('Runtime.enable');
    const native = await until(async () => evaluate(mainClient, `(() => {
      if (!process.mainModule?.filename) return null;
      const { app, BrowserWindow } = process.mainModule.require('electron');
      if (!app.isReady() || !BrowserWindow.getAllWindows().length) return null;
      return { userData: app.getPath('userData'), sessionData: app.getPath('sessionData'),
        appPath: app.getAppPath(), execPath: process.execPath, main: process.mainModule.filename,
        electron: process.versions.electron, isPackaged: app.isPackaged };
    })()`), 'original entry and native isolated paths');
    report.native = native;
    assert.ok(samePath(native.userData, userData), '--user-data-dir must change actual app.getPath(userData)');
    assert.ok(samePath(native.sessionData, userData), 'Chromium session data must also be isolated');
    assert.ok(samePath(native.execPath, exe), 'The distributed executable itself must run');
    assert.ok(samePath(native.appPath, sourceApp));
    assert.ok(samePath(native.main, path.join(sourceApp, 'electron', 'main.js')), 'The original production entry must run');
    assert.equal(native.isPackaged, true);
    assert.equal(native.electron, '31.7.7', 'Recheck native directory-switch isolation when upgrading Electron');
    pass('unaltered packaged EXE executes its original main entry with verified temporary userData and sessionData');

    const port = await until(() => {
      const file = path.join(userData, 'DevToolsActivePort');
      if (!fs.existsSync(file)) return null;
      const value = Number(fs.readFileSync(file, 'utf8').split(/\r?\n/)[0]);
      return Number.isInteger(value) && value > 0 && value < 65536 ? value : null;
    }, 'native DevToolsActivePort in isolated session directory');
    const expectedUrl = pathToFileURL(path.join(sourceApp, 'dist-renderer', 'index.html')).href;
    const target = await until(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
      assert.ok(response.ok, 'CDP target inventory must load');
      return (await response.json()).find(item => item.type === 'page' && item.url === expectedUrl && item.webSocketDebuggerUrl);
    }, 'packaged renderer target');
    pageClient = await connect(target.webSocketDebuggerUrl, events('renderer'));
    await pageClient.call('Runtime.enable');
    await pageClient.call('Log.enable');
    await pageClient.call('Page.enable');
    await pageClient.call('Inspector.enable');
    await until(async () => evaluate(pageClient, `document.readyState === 'complete' && !!document.querySelector('.editor__scroll[data-ready=true]') && !!window.api?.isElectron`), 'real packaged renderer and preload bridge ready');
    const snapshot = await evaluate(pageClient, `(async () => ({
      url: location.href, info: await window.api.getInfo(), recent: await window.api.getRecent(),
      paragraphs: Array.from(document.querySelectorAll('.script-flow .sc-el')).map(e => e.textContent),
      cards: document.querySelectorAll('.writing-material-card').length,
      title: document.querySelector('.doc-title')?.textContent.trim(), dirty: !!document.querySelector('.dot-dirty'),
      autosave: localStorage.getItem('guangying:autosave'), legacyAutosave: localStorage.getItem('mojiang:autosave')
    }))()`);
    assert.equal(snapshot.url, expectedUrl);
    assert.deepEqual(snapshot.info, { version: manifest.version, platform: 'win32' });
    assert.deepEqual(snapshot.recent, []);
    assert.deepEqual(snapshot.paragraphs, ['', '']);
    assert.equal(snapshot.cards, 0); assert.equal(snapshot.title, '未命名剧本'); assert.equal(snapshot.dirty, false);
    assert.equal(snapshot.legacyAutosave, null);
    if (snapshot.autosave) {
      const recovered = JSON.parse(snapshot.autosave);
      assert.ok(recovered.project.elements.every(element => element.text === ''));
      assert.deepEqual(recovered.project.beats, []); assert.equal(recovered.filePath, null);
    }
    report.renderer = { ...snapshot, autosave: snapshot.autosave ? 'blank generated recovery point' : null };
    pass('first launch is genuinely blank: two empty paragraphs, no cards, recent files, legacy recovery, or unsaved changes');
    pass('production contextBridge reports the expected alpha version and win32 platform');
    await evaluate(pageClient, 'document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
    const screenshot = await pageClient.call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    const png = Buffer.from(screenshot.data, 'base64');
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    fs.writeFileSync(path.join(output, 'raw-first-launch.png'), png, { flag: 'wx' });
    await pause(750);
    assert.deepEqual(report.errors, [], 'No main/renderer exceptions, console errors, resource errors or renderer crash');
    const windows = await evaluate(mainClient, `process.mainModule.require('electron').BrowserWindow.getAllWindows().map(win => ({ id: win.id, visible: win.isVisible(), url: win.webContents.getURL() }))`);
    assert.equal(windows.length, 1); assert.equal(windows[0].visible, true); assert.equal(windows[0].url, expectedUrl);
    report.windows = windows;
    pass('packaged renderer is visible and stable, with no fatal main/renderer errors; screenshot captured');

    // Schedule a genuine native window close after the inspector response. Close
    // debugging connections so Node does not wait for an attached debugger to quit.
    // A broken beforeunload/close path must time out and FAIL, never be bypassed.
    await evaluate(mainClient, `(() => {
      const wins = process.mainModule.require('electron').BrowserWindow.getAllWindows();
      if (wins.length !== 1 || wins[0].id !== ${windows[0].id}) throw new Error('Unexpected window during close');
      setTimeout(() => wins[0].close(), 250); return 'native-close-scheduled';
    })()`);
    closing = true;
    pageClient.close(); mainClient.close();
    await until(() => exit, 'normal production window close and process exit', 20000);
    assert.equal(exit.code, 0); assert.equal(exit.signal, null);
    assert.ok(!/\[光影写手\] 主进程异常|Uncaught Exception:/.test(logText), 'Startup/close must not log a fatal main exception');
    assert.deepEqual(report.errors, []);
    report.exit = exit;
    pass('blank document closes through BrowserWindow.close and the production beforeunload/lifecycle, with exit code 0');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.stack || String(error);
    throw error;
  } finally {
    pageClient?.close(); mainClient?.close();
    if (!exit && child.pid) {
      // Failure cleanup is limited to our owned synthetic process tree and is
      // always reported as failure; it can never count as successful close.
      report.forcedFailureCleanup = true;
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
      await pause(250);
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
    }
    await new Promise(resolve => log.end(resolve));
    try {
      const after = inventory(source);
      fs.writeFileSync(path.join(output, 'package-after.json'), JSON.stringify(after, null, 2) + '\n', { flag: 'wx' });
      assert.deepEqual(after, before, 'Raw launch must not alter any distributable byte, including EXE or manifest');
      report.packageUnchanged = true;
      report.packageFiles = Object.keys(before).length;
    } catch (error) {
      report.status = 'failed'; report.packageUnchanged = false; report.integrityError = error.message;
    }
    journal();
  }
  assert.equal(report.status, 'passed', report.integrityError || report.error || 'Raw startup failed');
  console.log(`PASS raw Windows distributable startup: ${output}`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { inventory };
