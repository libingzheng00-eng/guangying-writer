'use strict';

// Deterministic, offline GitHub API/CLI fixtures. No credentials, network calls,
// real release writes, private documents, or installed applications are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  runRelease, validateExistingRelease, resolveTagCommit,
} = require('./release-assets.cjs');

const repo = 'synthetic-owner/synthetic-writer';
const tag = 'v1.3.0-alpha.18.11';
const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const names = [
  'GuangyingWriter-macOS-arm64.zip',
  `GuangyingWriter-macOS-arm64-${tag}.dmg`,
];
const artifacts = names.map((name, index) => ({
  name,
  path: `/synthetic-release-fixtures/${name}`,
  size: 100 + index,
  digest: `sha256:${String(index + 1).repeat(64)}`,
}));
const releaseRoute = `repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
const refRoute = `repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`;
let checks = 0;
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
function ok(actual, message) { assert.ok(actual, message); checks++; }
function rejected(operation, message) {
  assert.throws(operation, error => {
    ok(error instanceof Error, message || 'failure is an Error');
    return true;
  }, message);
  checks++;
}
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function fault(status) {
  const error = new Error('synthetic API failure');
  if (status !== undefined) error.status = status;
  return error;
}
function asset(artifact) {
  return { name: artifact.name, size: artifact.size, state: 'uploaded', digest: artifact.digest };
}
function completeRelease(draft = false) {
  return {
    id: 101, tag_name: tag, draft,
    html_url: `https://github.com/${repo}/releases/tag/${tag}`,
    assets: artifacts.map(asset),
  };
}

function fixture(initial = completeRelease()) {
  const state = {
    release: clone(initial),
    refs: new Map([[refRoute, { object: { type: 'commit', sha } }]]),
    calls: [], writes: [], releaseReads: 0,
    onRead: null, onWrite: null,
  };
  const api = route => {
    state.calls.push(route);
    if (route === releaseRoute) state.releaseReads++;
    if (state.onRead) {
      const override = state.onRead(route, state);
      if (override !== undefined) return clone(override);
    }
    if (route === releaseRoute) {
      if (state.release === null) throw fault(404);
      return clone(state.release);
    }
    if (state.refs.has(route)) return clone(state.refs.get(route));
    throw new Error(`unexpected synthetic API route: ${route}`);
  };
  const gh = args => {
    state.writes.push([...args]);
    if (state.onWrite) {
      const override = state.onWrite(args, state);
      if (override !== undefined) return override;
    }
    eq(args[0], 'release', 'only release CLI commands are allowed');
    if (args[1] === 'create') {
      ok(args.includes('--verify-tag'), 'new release requires a pre-existing resolved tag');
      ok(args.includes('--draft'), 'automated creation remains a draft');
      ok(args.includes('--prerelease'), 'alpha creation remains prerelease');
      ok(args.includes('--latest=false'), 'alpha is not silently made latest stable');
      ok(!args.includes('--clobber'), 'creation never requests overwrite');
      state.release = { ...completeRelease(true), id: 202, assets: [] };
      return state.release.html_url;
    }
    if (args[1] === 'upload') {
      ok(!args.includes('--clobber'), 'upload must never overwrite existing attachments');
      const matched = artifacts.filter(item => args.includes(item.path));
      eq(matched.length, 1, 'exactly one verified artifact is uploaded per command');
      state.release.assets.push(asset(matched[0]));
      return '';
    }
    throw new Error(`unexpected synthetic gh command: ${JSON.stringify(args)}`);
  };
  state.options = { repo, tag, expectedSha: sha, api, gh, log: () => {} };
  state.run = (mode, extra = {}) => runRelease({ ...state.options, mode, ...extra });
  return state;
}

// A published or complete draft release is already authoritative. It is read
// only even when a hypothetical local rebuild would have different hashes.
for (const draft of [false, true]) {
  for (const mode of ['prepare', 'verify', 'publish']) {
    const f = fixture(completeRelease(draft));
    const result = f.run(mode, {
      artifacts: artifacts.map(item => ({ ...item, digest: `sha256:${'9'.repeat(64)}` })),
    });
    eq(result.needsBuild, false, `${mode}: complete existing release skips rebuilding`);
    eq(result.tagCommit, sha, `${mode}: tag commit is independently resolved`);
    eq(f.writes, [], `${mode}: existing ${draft ? 'draft' : 'public'} release is not changed`);
    eq(f.release, completeRelease(draft), 'existing payload/state remains untouched');
  }
}
{
  const f = fixture();
  const result = f.run('verify', { expectedSha: undefined });
  eq(result.tagCommit, sha, 'verify may resolve tag without checkout SHA');
  eq(f.writes, [], 'verification never changes releases');
}
{
  const release = completeRelease();
  release.assets.push({ name: 'SHA256SUMS.txt', size: 215, state: 'uploaded', digest: `sha256:${'3'.repeat(64)}` });
  validateExistingRelease(release, tag, names);
  checks++;
}

// Fail closed on incomplete/corrupt release metadata. Neither a public release
// nor an existing draft is an invitation to repair or overwrite its assets.
const invalidReleases = [
  ['missing required attachment', value => { value.assets.pop(); }],
  ['duplicate attachment', value => { value.assets.push(clone(value.assets[0])); }],
  ['zero-byte attachment', value => { value.assets[0].size = 0; }],
  ['negative size', value => { value.assets[0].size = -1; }],
  ['non-numeric size', value => { value.assets[0].size = '100'; }],
  ['fractional size', value => { value.assets[0].size = 1.5; }],
  ['non-finite size', value => { value.assets[0].size = Infinity; }],
  ['unfinished upload', value => { value.assets[0].state = 'starter'; }],
  ['missing digest', value => { delete value.assets[0].digest; }],
  ['invalid digest prefix', value => { value.assets[0].digest = `md5:${'1'.repeat(64)}`; }],
  ['short digest', value => { value.assets[0].digest = `sha256:${'1'.repeat(63)}`; }],
  ['non-hex digest', value => { value.assets[0].digest = `sha256:${'z'.repeat(64)}`; }],
  ['wrong tag', value => { value.tag_name = 'v0.0.0'; }],
  ['invalid release id', value => { value.id = 0; }],
  ['draft is not boolean', value => { value.draft = 'false'; }],
  ['missing release URL', value => { delete value.html_url; }],
  ['missing assets', value => { delete value.assets; }],
  ['assets are not an array', value => { value.assets = {}; }],
];
for (const [reason, mutate] of invalidReleases) {
  for (const draft of [false, true]) {
    for (const mode of ['prepare', 'verify', 'publish']) {
      const value = completeRelease(draft);
      mutate(value);
      const f = fixture(value);
      rejected(() => f.run(mode, { artifacts }), reason);
      eq(f.writes, [], `${reason}: no write to ${draft ? 'draft' : 'public'} release`);
    }
  }
}
for (const value of [null, undefined, [], {}, 'invalid', 0]) {
  rejected(() => validateExistingRelease(value, tag, names), 'invalid API shape fails closed');
}
for (const value of [null, false, 0, '', [], {}, 'invalid']) {
  const f = fixture(null);
  f.onRead = route => { if (route === releaseRoute) return value; };
  rejected(() => f.run('publish', { artifacts }), 'successful invalid release JSON must not be treated as 404');
  eq(f.writes, [], 'only HTTP 404 authorizes draft creation, never invalid API JSON');
}

// Only an actual release-not-found response can lead to creating a new draft.
for (const status of [401, 403, 429, 500, undefined]) {
  for (const mode of ['prepare', 'verify', 'publish']) {
    const f = fixture(null);
    f.onRead = route => { if (route === releaseRoute) throw fault(status); };
    rejected(() => f.run(mode, { artifacts }), `API ${status || 'network'} is not 404`);
    eq(f.writes, [], 'authorization/rate-limit/network/server failures do not create releases');
  }
}
{
  const f = fixture(null);
  const result = f.run('prepare');
  eq(result.needsBuild, true, 'missing release prepare permits a candidate build');
  eq(result.tagCommit, sha, 'prepare proves tag SHA before candidate build');
  eq(f.writes, [], 'prepare never creates a release');
}
{
  const f = fixture(null);
  rejected(() => f.run('verify'), 'verify missing release is not success');
  eq(f.writes, [], 'verify cannot create missing release');
}

// Lightweight and nested annotated tags are both resolved to an actual commit.
{
  const f = fixture();
  eq(resolveTagCommit(f.options.api, repo, tag), sha, 'lightweight tag resolves');
  const first = 'c'.repeat(40);
  const second = 'd'.repeat(40);
  f.refs.set(refRoute, { object: { type: 'tag', sha: first } });
  f.refs.set(`repos/${repo}/git/tags/${first}`, { object: { type: 'tag', sha: second } });
  f.refs.set(`repos/${repo}/git/tags/${second}`, { object: { type: 'commit', sha } });
  eq(resolveTagCommit(f.options.api, repo, tag), sha, 'nested annotated tag resolves to its commit');
  eq(f.writes, [], 'tag resolution is read only');
}
for (const object of [
  {}, { type: 'tree', sha }, { type: 'commit', sha: '123' },
  { type: 'commit', sha: 'z'.repeat(40) }, { type: 'commit', sha: null },
]) {
  const f = fixture(null);
  f.refs.set(refRoute, { object });
  rejected(() => f.run('publish', { artifacts }), 'invalid tag object rejects publication');
  eq(f.writes, [], 'invalid tag makes zero writes');
}
{
  const f = fixture(null);
  const loop = 'c'.repeat(40);
  f.refs.set(refRoute, { object: { type: 'tag', sha: loop } });
  f.refs.set(`repos/${repo}/git/tags/${loop}`, { object: { type: 'tag', sha: loop } });
  rejected(() => f.run('publish', { artifacts }), 'annotated tag cycle terminates safely');
  eq(f.writes, [], 'tag cycle makes zero writes');
}
{
  const f = fixture(null);
  const nesting = Array.from({ length: 9 }, (_, index) => (index + 1).toString(16).repeat(40));
  f.refs.set(refRoute, { object: { type: 'tag', sha: nesting[0] } });
  nesting.forEach((current, index) => {
    f.refs.set(`repos/${repo}/git/tags/${current}`, {
      object: index + 1 < nesting.length
        ? { type: 'tag', sha: nesting[index + 1] }
        : { type: 'commit', sha },
    });
  });
  rejected(() => f.run('publish', { artifacts }), 'excessive tag nesting is bounded');
  eq(f.writes, [], 'over-nested tag cannot publish');
}
for (const options of [
  { mode: 'delete' }, { repo: '../synthetic' }, { tag: '--delete' },
  { expectedSha: undefined }, { expectedSha: '123' },
]) {
  const f = fixture(null);
  rejected(() => f.run('publish', { artifacts, ...options }), 'unsafe invocation rejected');
  eq(f.writes, [], 'invalid mode/repo/tag/SHA cannot write');
}
for (const initial of [null, completeRelease()]) {
  for (const mode of ['prepare', 'verify', 'publish']) {
    const f = fixture(initial);
    rejected(() => f.run(mode, { artifacts, expectedSha: otherSha }), 'tag / checkout mismatch');
    eq(f.writes, [], 'SHA mismatch cannot change release');
  }
}
for (const status of [404, 401, 403, 429, 500, undefined]) {
  const f = fixture(null);
  f.onRead = route => { if (route === refRoute) throw fault(status); };
  rejected(() => f.run('publish', { artifacts }), 'unresolved tag is not created implicitly');
  eq(f.writes, [], 'tag lookup error makes zero writes');
}

// Successful first upload creates one draft and checks each attachment through
// the API. The second invocation is strictly read only, not an overwrite pass.
{
  const f = fixture(null);
  const result = f.run('publish', { artifacts });
  eq(result.needsBuild, false, 'completed upload does not request another build');
  eq(f.writes.filter(args => args[1] === 'create').length, 1, 'only one draft is created');
  eq(f.writes.filter(args => args[1] === 'upload').length, 2, 'both required files uploaded once');
  eq(f.release.draft, true, 'automation leaves publication to an explicit review');
  eq(f.release.assets, artifacts.map(asset), 'remote metadata exactly matches supplied local metadata');
  ok(f.releaseReads >= 4, 'remote state re-read around sequential uploads');
  const writesBefore = f.writes.length;
  const again = f.run('publish', { artifacts });
  eq(again.needsBuild, false, 'repeat invocation skips a complete draft');
  eq(f.writes.length, writesBefore, 'repeat invocation sends no writes');
}

// Race, upload failures and metadata mismatches stop subsequent attachment
// writes. Never recover by deleting files, editing the release, or --clobber.
for (const reason of ['id-changed', 'made-public', 'wrong-tag', 'api-error']) {
  const f = fixture(null);
  f.onRead = (route, state) => {
    if (route === releaseRoute && state.release && state.writes.length === 1) {
      if (reason === 'id-changed') state.release.id++;
      if (reason === 'made-public') state.release.draft = false;
      if (reason === 'wrong-tag') state.release.tag_name = 'v0.0.0';
      if (reason === 'api-error') throw fault(403);
    }
  };
  rejected(() => f.run('publish', { artifacts }), `post-create race ${reason}`);
  eq(f.writes.filter(args => args[1] === 'upload').length, 0, `${reason}: no upload after losing owned draft`);
}
for (const reason of ['id-changed', 'made-public', 'digest-changed', 'size-changed', 'duplicate-name']) {
  const f = fixture(null);
  f.onRead = (route, state) => {
    if (route === releaseRoute && state.release && state.writes.length === 2) {
      if (reason === 'id-changed') state.release.id++;
      if (reason === 'made-public') state.release.draft = false;
      if (reason === 'digest-changed') state.release.assets[0].digest = `sha256:${'e'.repeat(64)}`;
      if (reason === 'size-changed') state.release.assets[0].size++;
      if (reason === 'duplicate-name') state.release.assets.push(clone(state.release.assets[0]));
    }
  };
  rejected(() => f.run('publish', { artifacts }), `post-upload race ${reason}`);
  eq(f.writes.filter(args => args[1] === 'upload').length, 1, `${reason}: second upload is blocked`);
}
{
  const f = fixture(null);
  f.onWrite = args => { if (args[1] === 'create') throw new Error('synthetic already-exists race'); };
  rejected(() => f.run('publish', { artifacts }), 'create race does not adopt an externally created draft');
  eq(f.writes.length, 1, 'failed create has no follow-up uploads');
}
for (const draft of [false, true]) {
  const f = fixture(null);
  f.onWrite = (args, state) => {
    if (args[1] === 'create') {
      state.release = completeRelease(draft);
      throw new Error('synthetic concurrent publisher completed before create');
    }
  };
  const result = f.run('publish', { artifacts });
  eq(result.needsBuild, false, 'complete concurrent release can be verified and skipped');
  eq(f.writes.length, 1, 'create conflict is followed only by reads, not asset changes');
  eq(f.release, completeRelease(draft), 'complete concurrent release remains intact');
}
{
  const f = fixture(null);
  f.onWrite = (args, state) => {
    if (args[1] === 'create') {
      state.release = { ...completeRelease(true), assets: [] };
      throw new Error('synthetic concurrent incomplete draft');
    }
  };
  rejected(() => f.run('publish', { artifacts }), 'incomplete concurrent draft is not adopted');
  eq(f.writes.length, 1, 'no repair upload into someone else\'s partial draft');
}
{
  const f = fixture(null);
  f.onWrite = args => { if (args[1] === 'upload') throw new Error('synthetic upload failure'); };
  rejected(() => f.run('publish', { artifacts }), 'upload failure stops immediately');
  eq(f.writes.filter(args => args[1] === 'upload').length, 1, 'no later upload after failure');
  eq(f.release.assets, [], 'failed upload is not represented as success');
}
for (const reason of ['missing', 'duplicate', 'zero-size', 'bad-digest', 'wrong-name']) {
  const f = fixture(null);
  const local = clone(artifacts);
  if (reason === 'missing') local.pop();
  if (reason === 'duplicate') local.push(clone(local[0]));
  if (reason === 'zero-size') local[0].size = 0;
  if (reason === 'bad-digest') local[0].digest = 'not-a-digest';
  if (reason === 'wrong-name') local[0].name = 'unexpected.zip';
  rejected(() => f.run('publish', { artifacts: local }), `invalid local descriptor: ${reason}`);
  eq(f.writes, [], 'bad artifact list cannot create even a draft');
}

// Static CI contract: manual checks are read-only and only an explicit prepare
// result can enable dependency installation, packaging, DMG creation or upload.
const root = path.resolve(__dirname, '..');
const releaseWorkflow = fs.readFileSync(path.join(root, '.github/workflows/release-macos.yml'), 'utf8');
const coreWorkflow = fs.readFileSync(path.join(root, '.github/workflows/core-checks.yml'), 'utf8');
ok(/workflow_dispatch:[\s\S]*?inputs:[\s\S]*?tag:/.test(releaseWorkflow), 'manual workflow takes an explicit release tag');
ok(/concurrency:[\s\S]*?cancel-in-progress:\s*false/.test(releaseWorkflow), 'concurrent runs do not cancel an active publisher mid-upload');
ok(/if \[ "\$GITHUB_EVENT_NAME" = "workflow_dispatch" \]; then\s*\n\s*node scripts\/release-assets\.cjs --mode verify/.test(releaseWorkflow), 'manual dispatch uses only read-only verify mode');
ok(/else\s*\n\s*node scripts\/release-assets\.cjs --mode prepare/.test(releaseWorkflow), 'tag push prepares with no implicit release write');
const buildSteps = releaseWorkflow.split(/\n\s{6}- name:/).slice(1).filter(step =>
  /npm ci|bash package\.sh|hdiutil create|--mode publish/.test(step));
eq(buildSteps.length, 4, 'four mutation/build steps are explicitly represented');
for (const step of buildSteps) {
  ok(/if:\s*steps\.release-plan\.outputs\.needs-build == 'true'/.test(step), 'existing release skips each build/upload step');
}
ok(!/--clobber|gh release (?:delete|edit)|git (?:tag|push)/.test(releaseWorkflow), 'workflow never overwrites/deletes assets, publishes existing drafts, or moves tags');
ok(releaseWorkflow.includes('node scripts/release-assets-test.cjs'), 'release CI runs offline release safety tests');
ok(coreWorkflow.includes('node scripts/release-assets-test.cjs'), 'core CI runs the same release safety tests');

console.log(`release-assets: ${checks} assertions passed (offline synthetic API/CLI only)`);
