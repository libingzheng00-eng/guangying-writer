/**
 * Shared raw distributable startup; Windows/macOS wrappers select the platform.
 * --app <unpacked-app-or-.app> --output <new-dir> [--manifest <build-manifest.json>]
 * Runs only on an ephemeral GitHub-hosted runner. No product file, entry
 * point, dialog, preload, project or browser storage is replaced/seeded.
 *
 * Electron 44.7.0 isolation source evidence (checked before implementing this):
 * https://github.com/electron/electron/blob/v44.7.0/shell/app/electron_main_delegate.cc#L233-L242
 * PreSandboxStartup maps --user-data-dir to chrome::DIR_USER_DATA before app JS.
 * https://github.com/electron/electron/blob/v44.7.0/shell/browser/api/electron_api_app.cc#L396-L399
 * app.getPath uses PathService (same file L894-L902).
 * https://github.com/electron/electron/blob/v44.7.0/shell/common/electron_paths.cc#L44-L46
 * DIR_SESSION_DATA defaults to DIR_USER_DATA.
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

const root = path.resolve(__dirname, '..');
const verifiedElectronVersion = '44.7.0';
const isolationSources = [
  `https://github.com/electron/electron/blob/v${verifiedElectronVersion}/shell/app/electron_main_delegate.cc#L233-L242`,
  `https://github.com/electron/electron/blob/v${verifiedElectronVersion}/shell/common/electron_paths.cc#L44-L46`,
  `https://github.com/electron/electron/blob/v${verifiedElectronVersion}/shell/browser/api/electron_api_app.cc#L894-L902`,
];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const samePath = (a, b) => {
  const canonical = value => {
    const resolved = fs.realpathSync(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return canonical(a) === canonical(b);
};
const outside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
};

function inventory(root, { allowContainedSymlinks = false } = {}) {
  root = path.resolve(root);
  const canonicalRoot = fs.realpathSync(root);
  const files = {};
  function visit(absolute, relative) {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      assert.ok(allowContainedSymlinks && relative, `Distributable contains a symbolic link: ${relative}`);
      const target = fs.readlinkSync(absolute);
      // Framework links are normal on macOS. Inventory their text, never walk
      // them, and reject absolute, escaping, dangling or cyclic links.
      assert.ok(!path.isAbsolute(target) && !outside(root, path.resolve(path.dirname(absolute), target)), `Link escapes distributable: ${relative}`);
      assert.ok(!outside(canonicalRoot, fs.realpathSync(absolute)), `Link resolves outside distributable: ${relative}`);
      files[relative] = { type: 'symlink', target };
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(absolute, name), relative ? `${relative}/${name}` : name);
    } else {
      assert.ok(stat.isFile(), `Distributable contains a nonregular file: ${relative}`);
      files[relative] = { ...(allowContainedSymlinks ? { type: 'file' } : {}), bytes: stat.size, sha256: sha256(fs.readFileSync(absolute)) };
    }
  }
  visit(root, '');
  return files;
}

function command(file, args, cwd = root) {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${path.basename(file)} failed: ${result.stderr || result.signal || result.status}`);
  return result.stdout.trim();
}

function layout(source, platform) {
  if (platform === 'win32') return {
    appRoot: path.join(source, 'resources', 'app'), exe: path.join(source, 'GuangyingWriter.exe'), arch: 'x64',
  };
  assert.ok(source.endsWith('.app'), 'macOS raw startup requires a real .app bundle');
  const plist = path.join(source, 'Contents', 'Info.plist');
  const executable = command('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', plist]);
  assert.ok(executable && executable !== '.' && executable !== '..' && !/[\\/\0\r\n]/.test(executable), 'CFBundleExecutable must be one filename');
  const exe = path.join(source, 'Contents', 'MacOS', executable);
  assert.ok(fs.lstatSync(exe).isFile(), 'The app executable must be a regular file');
  const architectures = command('/usr/bin/lipo', ['-archs', exe]).split(/\s+/);
  assert.equal(architectures.length, 1, 'Raw acceptance requires a single-architecture arm64 or x64 candidate');
  const arch = { arm64: 'arm64', x86_64: 'x64' }[architectures[0]];
  assert.ok(arch, 'Unsupported macOS bundle architecture');
  return { appRoot: path.join(source, 'Contents', 'Resources', 'app'), exe, arch };
}

function sourceBinding(sourceApp, before, platform, arch, manifestPath) {
  assert.equal(command('git', ['status', '--porcelain', '--untracked-files=all']), '', 'Raw acceptance requires a clean checkout of the final head');
  const commit = command('git', ['rev-parse', 'HEAD']);
  assert.match(commit, /^[a-f0-9]{40}$/);
  const checkout = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8'));
  for (const [label, version] of Object.entries({
    package: checkout.devDependencies?.electron,
    lockRoot: lock.packages?.['']?.devDependencies?.electron,
    lockRuntime: lock.packages?.['node_modules/electron']?.version,
    installed: installed.version,
  })) assert.equal(version, verifiedElectronVersion, `${label} must pin the Electron version whose isolation source was reviewed`);
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceApp, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'guangying-writer');
  assert.equal(manifest.main, 'electron/main.js');
  assert.deepEqual(manifest, checkout, 'Packaged manifest must match the final checkout');
  const allowed = ['LICENSE', 'dist-renderer', 'electron', 'package.json'];
  assert.deepEqual(fs.readdirSync(sourceApp).sort(), allowed, 'Only production resources belong in the app');
  const sourceHashes = inventory(sourceApp); // Production resources never permit links.
  for (const entry of allowed.filter(entry => entry !== 'package.json')) {
    assert.deepEqual(inventory(path.join(sourceApp, entry)), inventory(path.join(root, entry)), `Packaged ${entry} must match the final checkout`);
  }
  let sourceManifestSHA256 = null;
  if (manifestPath) {
    const bytes = fs.readFileSync(manifestPath);
    const build = JSON.parse(bytes.toString('utf8'));
    assert.equal(build.commit, commit, 'Build manifest must name the checked-out final head');
    assert.equal(build.version, manifest.version);
    assert.equal(build.electronVersion, verifiedElectronVersion);
    assert.equal(build.platform, platform); assert.equal(build.arch, arch);
    assert.deepEqual(build.files, before, 'Raw input must be the exact runtime and resources in the build manifest');
    sourceManifestSHA256 = sha256(bytes);
  }
  return { commit, electronVersion: verifiedElectronVersion, sourceManifestSHA256, sourceHashes,
    packageLockSHA256: sha256(fs.readFileSync(path.join(root, 'package-lock.json'))), manifest };
}

function cleanEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => {
    const key = name.toUpperCase();
    return key !== 'NODE_OPTIONS' && key !== 'NODE_PATH' && key !== 'ZS_DEV' &&
      !key.startsWith('ELECTRON_') && !key.startsWith('GUANGYING_WINDOWS_SMOKE_') && !key.startsWith('GUANGYING_DESKTOP_SMOKE_') &&
      !key.startsWith('DYLD_') && !key.startsWith('LD_');
  }));
}

async function terminateOwned(child, platform) {
  if (!child.pid) return;
  if (platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
    await pause(250);
    return { method: 'owned PID tree', code: result.status, error: result.error?.message };
  }
  // detached:true creates this child's own POSIX process group. Never discover
  // or terminate apps by executable name or touch an unrelated desktop session.
  const signal = name => { try { process.kill(-child.pid, name); return true; } catch (error) { if (error.code !== 'ESRCH') throw error; return false; } };
  const term = signal('SIGTERM');
  if (term) await pause(1000);
  const kill = signal(0) && signal('SIGKILL');
  if (kill) await pause(250);
  return { method: 'owned POSIX process group', term, kill };
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

async function main(platform) {
  assert.ok(platform === 'win32' || platform === 'darwin', 'Choose the Windows or macOS raw startup wrapper');
  assert.equal(process.platform, platform, 'Raw startup must run on its native platform');
  if (platform === 'win32') assert.equal(process.arch, 'x64', 'Raw Windows startup supports x64 only');
  else assert.ok(['arm64', 'x64'].includes(process.arch), 'Raw macOS startup supports arm64 or x64 only');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Run only on a disposable GitHub Actions runner');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'A clean GitHub-hosted runner is required; never run against a personal desktop profile');
  const args = process.argv.slice(2);
  assert.ok(args.length === 4 || args.length === 6, 'Usage: --app <unpacked-app-or-.app> --output <new-directory> [--manifest <build-manifest.json>]');
  assert.equal(args[0], '--app'); assert.equal(args[2], '--output');
  if (args.length === 6) assert.equal(args[4], '--manifest');
  const source = fs.realpathSync(args[1]);
  const output = path.resolve(args[3]);
  assert.ok(outside(source, output), 'Evidence must be outside the distributable');
  assert.ok(!fs.existsSync(output), 'Evidence directory already exists; choose a new directory');
  const inventoryOptions = { allowContainedSymlinks: platform === 'darwin' };
  const before = inventory(source, inventoryOptions);
  const { appRoot: sourceApp, exe, arch } = layout(source, platform);
  assert.equal(process.arch, arch, 'Runner architecture must match the actual app executable');
  assert.ok(fs.lstatSync(exe).isFile(), 'The distributed executable must be a regular file');
  const binding = sourceBinding(sourceApp, before, platform, arch, args[5]);
  const { manifest } = binding;
  assert.ok(binding.sourceHashes['electron/main.js'] && binding.sourceHashes['electron/preload.js'] && binding.sourceHashes['dist-renderer/index.html']);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  assert.ok(outside(source, path.join(fs.realpathSync(path.dirname(output)), path.basename(output))), 'Evidence parent must not alias the distributable');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'package-before.json'), JSON.stringify(before, null, 2) + '\n', { flag: 'wx' });

  const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'guangying-raw-launch-'));
  const userData = path.join(temporary, '独立首启数据');
  fs.mkdirSync(userData);
  assert.deepEqual(fs.readdirSync(userData), []);
  const report = {
    status: 'running', scope: 'raw distributed executable with original package.json, main, preload and renderer bytes',
    version: manifest.version, platform: process.platform, architecture: process.arch,
    commit: binding.commit, electronVersion: binding.electronVersion, sourceManifestSHA256: binding.sourceManifestSHA256,
    sourceHashes: binding.sourceHashes, packageLockSHA256: binding.packageLockSHA256,
    runtime: { executable: exe, sha256: sha256(fs.readFileSync(exe)), arch },
    isolation: { userData, nativeSwitch: '--user-data-dir', preEntryInjection: false,
      source: isolationSources[0], sources: isolationSources },
    instrumentation: `Loopback Node inspector and renderer CDP: read-only runtime/DOM checks, screenshot, then ${platform === 'darwin' ? 'app.quit()' : 'BrowserWindow.close()'} through the production close guard; no method replacement or data seeding`,
    limitations: ['This is startup acceptance, not system IME, native picker, installer, signing or SmartScreen acceptance',
      'Screenshot captures the renderer viewport; it is not a native desktop screenshot'],
    checks: [], errors: [],
  };
  const journal = () => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  const pass = name => { report.checks.push(name); journal(); console.log('PASS', name); };
  journal();
  const env = cleanEnvironment(process.env);
  const child = spawn(exe, [`--user-data-dir=${userData}`, '--inspect=127.0.0.1:0', '--remote-debugging-port=0'], {
    cwd: source, env, detached: platform === 'darwin', stdio: ['ignore', 'pipe', 'pipe'],
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
        electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
        platform: process.platform, arch: process.arch, isPackaged: app.isPackaged };
    })()`), 'original entry and native isolated paths');
    report.native = native;
    assert.ok(samePath(native.userData, userData), '--user-data-dir must change actual app.getPath(userData)');
    assert.ok(samePath(native.sessionData, userData), 'Chromium session data must also be isolated');
    assert.ok(samePath(native.execPath, exe), 'The distributed executable itself must run');
    assert.ok(samePath(native.appPath, sourceApp));
    assert.ok(samePath(native.main, path.join(sourceApp, 'electron', 'main.js')), 'The original production entry must run');
    assert.equal(native.isPackaged, true);
    assert.equal(native.platform, platform); assert.equal(native.arch, arch);
    assert.equal(native.electron, binding.electronVersion, 'Runtime must match the locked Electron version with reviewed directory-switch isolation');
    report.runtime = { ...report.runtime, electron: native.electron, chrome: native.chrome, node: native.node };
    pass('unaltered packaged executable executes its original main entry with verified temporary userData and sessionData');

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
    await until(async () => evaluate(pageClient, `document.readyState === 'complete' && !!document.querySelector('.startup') && document.querySelector('.startup__recent-content')?.getAttribute('aria-busy') === 'false' && !!window.api?.isElectron`), 'real packaged startup page and preload bridge ready');
    const snapshot = await evaluate(pageClient, `(async () => ({
      url: location.href, info: await window.api.getInfo(), recent: await window.api.getRecent(),
      paragraphs: Array.from(document.querySelectorAll('.script-flow .sc-el')).map(e => e.textContent),
      cards: document.querySelectorAll('.writing-material-card').length,
      title: document.querySelector('.startup h1')?.textContent.trim(), dirty: !!document.querySelector('.dot-dirty'),
      titleFocused: document.activeElement === document.querySelector('.startup h1'),
      continueAvailable: !!document.querySelector('.startup__continue'),
      homePreference: !!document.querySelector('.startup__preference input[value="home"]:checked'),
      autosave: localStorage.getItem('guangying:autosave'), legacyAutosave: localStorage.getItem('mojiang:autosave')
    }))()`);
    assert.equal(snapshot.url, expectedUrl);
    assert.deepEqual(snapshot.info, { version: manifest.version, platform });
    assert.deepEqual(snapshot.recent, []);
    assert.deepEqual(snapshot.paragraphs, []);
    assert.equal(snapshot.cards, 0); assert.equal(snapshot.title, '光影写手'); assert.equal(snapshot.dirty, false);
    assert.equal(snapshot.titleFocused, true); assert.equal(snapshot.continueAvailable, false); assert.equal(snapshot.homePreference, true);
    assert.equal(snapshot.legacyAutosave, null);
    assert.equal(snapshot.autosave, null);
    await pause(1100);
    assert.equal(await evaluate(pageClient, `localStorage.getItem('guangying:autosave')`), null, 'Idle startup must not generate a blank recovery point');
    report.renderer = snapshot;
    pass('first launch shows the focused default-home startup page with no editor, recent projects, recovery point, or unsaved changes');
    pass('production contextBridge reports the expected alpha version and native platform');
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

    // Schedule a genuine native close after the inspector response. macOS keeps
    // running with no windows, so request a normal app quit on that platform.
    // app.quit still runs the production beforeunload/close guard. Close
    // debugging connections so Node does not wait for an attached debugger to quit.
    // A broken beforeunload/close path must time out and FAIL, never be bypassed.
    await evaluate(mainClient, `(() => {
      const { app, BrowserWindow } = process.mainModule.require('electron');
      const wins = BrowserWindow.getAllWindows();
      if (wins.length !== 1 || wins[0].id !== ${windows[0].id}) throw new Error('Unexpected window during close');
      setTimeout(() => ${platform === 'darwin' ? 'app.quit()' : 'wins[0].close()'}, 250); return 'native-close-scheduled';
    })()`);
    closing = true;
    pageClient.close(); mainClient.close();
    await until(() => exit, 'normal production window close and process exit', 20000);
    assert.equal(exit.code, 0); assert.equal(exit.signal, null);
    assert.ok(!/\[光影写手\] 主进程异常|Uncaught Exception:/.test(logText), 'Startup/close must not log a fatal main exception');
    assert.deepEqual(report.errors, []);
    report.exit = exit;
    pass(`untouched startup page closes through ${platform === 'darwin' ? 'app.quit' : 'BrowserWindow.close'} and the production beforeunload/lifecycle, with exit code 0`);
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
      try { report.failureCleanup = await terminateOwned(child, platform); }
      catch (error) { report.failureCleanup = { error: error.message }; }
      child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
    }
    await new Promise(resolve => log.end(resolve));
    try {
      const after = inventory(source, inventoryOptions);
      fs.writeFileSync(path.join(output, 'package-after.json'), JSON.stringify(after, null, 2) + '\n', { flag: 'wx' });
      assert.deepEqual(after, before, 'Raw launch must not alter any distributable byte or framework link, including executable or manifest');
      assert.equal(command('git', ['rev-parse', 'HEAD']), binding.commit, 'Final head changed during raw acceptance');
      assert.equal(command('git', ['status', '--porcelain', '--untracked-files=all']), '', 'Checkout changed during raw acceptance');
      report.packageUnchanged = true;
      report.packageFiles = Object.keys(before).length;
    } catch (error) {
      report.status = 'failed'; report.packageUnchanged = false; report.integrityError = error.message;
    }
    journal();
  }
  assert.equal(report.status, 'passed', report.integrityError || report.error || 'Raw startup failed');
  console.log(`PASS raw ${platform} distributable startup: ${output}`);
}

if (require.main === module) {
  console.error('Use windows-launch.cjs or macos-launch.cjs for the native platform.');
  process.exitCode = 1;
}
module.exports = { main, inventory, layout, sourceBinding, cleanEnvironment, verifiedElectronVersion };
