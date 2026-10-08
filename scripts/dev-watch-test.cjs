/**
 * Standalone Vite watcher isolation regression (not part of test:core).
 * Reads watch options with Vite's official config loader, then maps only the
 * repository-anchored prefix to a generated temporary fixture root. Globs,
 * symbolic-link predicates and followSymlinks semantics are otherwise unchanged.
 * Never watches the real
 * release tree, installed applications, production userData, or a browser.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const repo = path.resolve(__dirname, '..');
// macOS aliases /var to /private/var. Use a canonical fixture root so Vite's
// strict file-serving check and its realpath-resolved module ID agree.
const out = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guangying-dev-watch-')));
const fixture = path.join(out, 'project');
const external = path.join(out, 'external-fixture');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assertions = [];
let server;
let observed;

function writeFixture(relative, content = 'synthetic fixture\n') {
  const file = path.join(fixture, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { flag: 'wx' });
  return file;
}
function check(label, value) {
  assert.ok(value, label);
  assertions.push(label);
  console.log(`PASS ${label}`);
}
async function until(label, condition, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await pause(30);
  }
  throw new Error(`Timed out: ${label}`);
}
(async () => {
  const { createServer, loadConfigFromFile, normalizePath } = await import('vite');
  fs.mkdirSync(external, { recursive: true });
  const source = writeFixture('src/main.ts', 'export const marker = "WATCH_BEFORE";\nif (import.meta.hot) import.meta.hot.accept();\n');
  writeFixture('index.html', '<script type="module" src="/src/main.ts"></script>');
  const excludedFiles = [
    writeFixture('release/dmg-content/staged.txt'),
    writeFixture('release-archive/artifact.txt'),
    writeFixture('tmp/test-runtime.txt'),
    writeFixture('Fixture.app/Contents/Resources/main.js'),
  ];
  const outsideFile = path.join(external, 'outside.txt');
  fs.writeFileSync(outsideFile, 'external synthetic fixture\n', { flag: 'wx' });
  // Both targets are this test's sibling temporary directory, NOT /Applications.
  // A directory junction exercises the same lstat/followSymlinks boundary on
  // Windows without requiring Developer Mode or elevated symlink privileges.
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(external, path.join(fixture, 'release/dmg-content/Applications'), linkType);
  fs.symlinkSync(external, path.join(fixture, 'src/ExternalFixtures'), linkType);

  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, path.join(repo, 'vite.config.ts'), repo, 'silent');
  assert.ok(loaded, 'Actual vite.config.ts must load successfully');
  const actual = loaded.config.server?.watch;
  assert.ok(actual && Array.isArray(actual.ignored), 'Actual config must provide an ignored array');
  const repoRoot = normalizePath(repo);
  const fixtureRoot = normalizePath(fixture);
  check('actual Vite config disables symbolic-link following', actual.followSymlinks === false);
  check('actual release root is anchored to the repository', actual.ignored.includes(`${repoRoot}/release`));
  check('actual release descendants are anchored to the repository', actual.ignored.includes(`${repoRoot}/release/**`));
  check('actual release-* roots and descendants are both pruned', actual.ignored.includes(`${repoRoot}/release-*`) && actual.ignored.includes(`${repoRoot}/release-*/**`));
  check('actual tmp root and descendants are repository-specific', actual.ignored.includes(`${repoRoot}/tmp`) && actual.ignored.includes(`${repoRoot}/tmp/**`));
  check('actual app roots and descendants are both pruned', actual.ignored.includes('**/*.app') && actual.ignored.includes('**/*.app/**'));
  check('config cannot globally ignore a temporary-root src directory', !actual.ignored.includes('**/tmp/**') && !actual.ignored.includes('**/tmp'));
  const linkPruners = actual.ignored.filter(pattern => typeof pattern === 'function');
  check('actual config explicitly prunes symbolic-link entries', linkPruners.length > 0 && linkPruners.some(prune => prune(path.join(fixture, 'src/ExternalFixtures'))));
  check('actual symbolic-link predicate keeps normal source files', linkPruners.every(prune => !prune(source)));
  check('actual symbolic-link predicate tolerates missing entries', linkPruners.every(prune => !prune(path.join(fixture, 'missing-fixture.ts'))));
  const ignored = actual.ignored.map(pattern => {
    // Preserve the actual lstat-based predicate by reference. It has no
    // repository-anchored path; string roots alone need fixture remapping.
    if (typeof pattern === 'function') return pattern;
    assert.equal(typeof pattern, 'string', 'Other ignore types need explicit faithful fixture mapping');
    return pattern.startsWith(`${repoRoot}/`) ? fixtureRoot + pattern.slice(repoRoot.length) : pattern;
  });
  const events = [];
  const hmr = [];
  const rawEvents = [];
  const watcherErrors = [];
  const readiness = { readyObserved: false, readyAt: null };
  observed = { events, hmr, rawEvents, watcherErrors, readiness };
  server = await createServer({
    configFile: false, envFile: false, root: fixture, publicDir: false,
    cacheDir: path.join(fixture, '.vite-cache'), logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{
      name: 'synthetic-watch-observation',
      configureServer(viteServer) {
        viteServer.watcher.on('all', (event, file) => events.push({ event, file: normalizePath(file) }));
        viteServer.watcher.on('raw', (event, file) => rawEvents.push({ event, file }));
        viteServer.watcher.on('error', error => watcherErrors.push(String(error)));
        viteServer.watcher.once('ready', () => {
          readiness.readyObserved = true;
          readiness.readyAt = Date.now();
        });
      },
    }],
    // Official Vite HMR channel API keeps the real update pipeline enabled,
    // with middleware/ws:false so this test opens no network listener or UI.
    server: { middlewareMode: true, ws: false, watch: { ...actual, ignored } },
  });
  server.hot.addChannel({
    name: 'dev-watch-fixture', send: payload => hmr.push(payload),
    on() {}, off() {}, listen() {}, async close() {},
  });
  // Backend options are diagnostic evidence only; never override them.
  observed.backend = Object.fromEntries(['followSymlinks', 'useFsEvents', 'usePolling', 'alwaysStat'].map(key => [key, server.watcher.options?.[key] ?? null]));
  const watched = () => server.watcher.getWatched();
  const watchedPaths = () => Object.entries(watched()).flatMap(([dir, names]) => [normalizePath(dir), ...names.map(name => normalizePath(path.join(dir, name)))]);
  // Vite starts its watcher before createServer resolves, so a subsequent
  // once('ready') can miss the event. Wait on public registration state instead;
  // this does not enable the polling backend or synthesize watcher/HMR events.
  await until('initial src watcher registration', () => watchedPaths().includes(normalizePath(source)));
  await pause(500);
  const before = await server.transformRequest('/src/main.ts');
  check('temporary-root src transforms through the actual Vite server', !!before?.code.includes('WATCH_BEFORE'));
  check('src fixture is a self-accepting HMR module', server.moduleGraph.getModuleById(normalizePath(source))?.isSelfAccepting === true);
  check('normal src file is registered with the watcher', watchedPaths().includes(normalizePath(source)));
  fs.appendFileSync(source, '\nexport const secondMarker = "WATCH_AFTER";\n');
  await until('src change event', () => events.some(item => item.event === 'change' && item.file === normalizePath(source)));
  await until('normal src HMR update', () => hmr.some(item => item.type === 'update' && item.updates?.some(update => update.path === '/src/main.ts')));
  check('normal src modification emits a real watcher change', true);
  check('normal src modification produces a real Vite HMR update payload', true);
  check('Vite invalidates and retransforms changed source', (await server.transformRequest('/src/main.ts'))?.code.includes('WATCH_AFTER'));

  const ignoredRoots = ['release', 'release-archive', 'tmp', 'Fixture.app'].map(name => normalizePath(path.join(fixture, name)));
  const targetRoot = normalizePath(external);
  const forbidden = file => ignoredRoots.some(dir => file === dir || file.startsWith(dir + '/')) || file === targetRoot || file.startsWith(targetRoot + '/') || file.startsWith(`${fixtureRoot}/src/ExternalFixtures/`);
  check('ignored directory roots are pruned before descendant traversal', !watchedPaths().some(file => ignoredRoots.some(dir => file === dir || file.startsWith(dir + '/'))));
  observed.afterInitialScan = watched();
  const eventsBeforeIgnoredEdits = events.length;
  const hmrBeforeIgnoredEdits = hmr.length;
  for (const file of [...excludedFiles, outsideFile]) fs.appendFileSync(file, 'synthetic modification\n');
  for (const name of ['release/dmg-content/new.txt', 'release-archive/new.txt', 'tmp/new.txt', 'Fixture.app/Contents/Resources/new.txt']) writeFixture(name);
  fs.writeFileSync(path.join(external, 'new-outside.txt'), 'external new fixture\n', { flag: 'wx' });
  await pause(1000);
  check('excluded artifact edits and new files emit no watched events', !events.slice(eventsBeforeIgnoredEdits).some(item => forbidden(item.file)));
  check('excluded artifacts do not trigger HMR messages', hmr.length === hmrBeforeIgnoredEdits);
  check('no external symbolic-link target or descendant is registered', !watchedPaths().some(file => file === targetRoot || file.startsWith(targetRoot + '/') || file.startsWith(`${fixtureRoot}/src/ExternalFixtures/`)));
  check('ignored and external trees remain unwatched after edits', !watchedPaths().some(forbidden));
  const allowedParent = normalizePath(path.dirname(fixture));
  const outsideDirectories = Object.keys(watched()).map(normalizePath).filter(dir => dir !== fixtureRoot && !dir.startsWith(fixtureRoot + '/') && dir !== allowedParent);
  check('watch bookkeeping has no unintended outside directories', outsideDirectories.length === 0);
  check('no watcher errors occur', watcherErrors.length === 0);
  const hmrBeforeSecondSourceEdit = hmr.length;
  fs.appendFileSync(source, '\nexport const finalMarker = "WATCH_STILL_LIVE";\n');
  await until('source stays live after negative checks', () => hmr.slice(hmrBeforeSecondSourceEdit).some(item => item.type === 'update' && item.updates?.some(update => update.path === '/src/main.ts')));
  check('normal src HMR remains live after artifact isolation checks', true);
  check('second normal source modification transforms correctly', (await server.transformRequest('/src/main.ts'))?.code.includes('WATCH_STILL_LIVE'));
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({
    assertions: assertions.length, assertionLabels: assertions, config: loaded.path,
    mapping: 'Only actual repository-anchored string prefixes mapped to independent temporary fixture root; functions kept by reference, glob suffixes and followSymlinks copied unchanged.',
    originalWatch: actual, mappedWatch: { ...actual, ignored }, events, hmr,
    backend: observed.backend, readiness, rawEvents, afterInitialScan: observed.afterInitialScan,
    watched: watched(), outsideDirectories, externalWatchedPaths: watchedPaths().filter(file => file === targetRoot || file.startsWith(targetRoot + '/')),
  }, (key, value) => typeof value === 'function' ? `[actual predicate: ${value.toString()}]` : value, 2));
  console.log(JSON.stringify({ assertions: assertions.length, outsideDirectories, externalWatchedPaths: [], output: out }, null, 2));
})().catch(error => {
  console.error(error);
  if (server) {
    const diagnostic = { ...observed, watched: server.watcher.getWatched(), config: server.config.server.watch };
    fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify(diagnostic, null, 2));
    console.log(JSON.stringify(diagnostic, null, 2));
  }
  console.log(`OUTPUT ${out}`);
  process.exitCode = 1;
}).finally(async () => { if (server) await server.close(); });
