/** Explicit Electron 42+ binary preparation; stdout is only the executable path. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

assert.equal(process.argv.length, 2, 'Usage: node scripts/prepare-electron.cjs');
assert.ok(!process.env.ELECTRON_OVERRIDE_DIST_PATH, 'Use an explicit verified RUNTIME_APP for custom macOS packaging');
const packageFile = require.resolve('electron/package.json');
const directory = path.dirname(packageFile);
const version = JSON.parse(fs.readFileSync(packageFile, 'utf8')).version;
// Calling require("electron") first can lazily download and mix progress into
// stdout. Invoke this installed package's CLI explicitly, with bounded time and
// official bundled checksums, then read its completed path file ourselves.
const result = spawnSync(process.execPath, [path.join(directory, 'install.js')], {
  stdio: ['ignore', 2, 2], timeout: 240000,
});
if (result.error) throw result.error;
assert.equal(result.status, 0, 'Electron binary preparation failed');
assert.equal(fs.readFileSync(path.join(directory, 'dist/version'), 'utf8').trim().replace(/^v/, ''), version);
const executable = path.resolve(directory, 'dist', fs.readFileSync(path.join(directory, 'path.txt'), 'utf8').trim());
const relative = path.relative(path.join(directory, 'dist'), executable);
assert.ok(relative && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Electron path must stay in its installed dist');
assert.ok(fs.statSync(executable).isFile(), 'Missing Electron executable');
process.stdout.write(executable + '\n');
