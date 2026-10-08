/** Preserve complete advisory evidence; do not auto-fix or treat omit=dev as app safety. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
assert.equal(process.argv.length, 3, 'Usage: node scripts/dependency-audit.cjs <new-output.json>');
const destination = path.resolve(process.argv[2]);
assert.ok(!fs.existsSync(destination), 'Do not overwrite an earlier audit');
const result = spawnSync('npm', ['audit', '--json'], {
  cwd: root, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024,
  // npm.cmd requires cmd.exe on Windows. Both executable and arguments are fixed,
  // and no user path/content is interpolated into this command.
  shell: process.platform === 'win32', windowsHide: true,
});
if (result.error) throw result.error;
assert.ok(result.status === 0 || result.status === 1, 'Dependency audit failed to execute');
const report = JSON.parse(result.stdout);
assert.ok(!report.error && report.metadata?.vulnerabilities && report.vulnerabilities, 'Audit did not return a complete advisory report');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
// These development-server advisories are explicitly reviewed in
// SECURITY_UPGRADE.md. A new advisory, including one in the same package,
// requires fresh review rather than silently inheriting this exception.
const reviewed = new Map([
  ['https://github.com/advisories/GHSA-67mh-4wv8-2f99', ['esbuild', 'moderate']],
  ['https://github.com/advisories/GHSA-4w7w-66w2-5vf9', ['vite', 'moderate']],
  ['https://github.com/advisories/GHSA-v6wh-96g9-6wx3', ['vite', 'moderate']],
  ['https://github.com/advisories/GHSA-fx2h-pf6j-xcff', ['vite', 'high']],
]);
for (const [name, item] of Object.entries(report.vulnerabilities)) {
  assert.ok(name === 'vite' || name === 'esbuild', `Unreviewed affected dependency: ${name}`);
  assert.equal(item.severity, name === 'vite' ? 'high' : 'moderate', `Unreviewed severity: ${name}`);
  for (const advisory of item.via) {
    if (typeof advisory === 'string') {
      assert.ok(name === 'vite' && advisory === 'esbuild', 'Unreviewed transitive advisory');
    } else {
      assert.deepEqual(reviewed.get(advisory.url), [name, advisory.severity], 'Unreviewed advisory');
    }
  }
}
assert.equal(report.metadata.vulnerabilities.critical, 0);
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
assert.equal(lock.packages['node_modules/electron'].version, '44.7.0');
assert.equal(lock.packages['node_modules/parse5'].version, '8.0.1');
console.log('Dependency audit preserved:', JSON.stringify(report.metadata.vulnerabilities), '(remaining Vite/esbuild development risks documented)');
