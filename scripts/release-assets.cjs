/* Release-only tooling: never replace an existing asset or create/move a tag. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const requiredNames = tag => [
  'GuangyingWriter-macOS-arm64.zip',
  `GuangyingWriter-macOS-arm64-${tag}.dmg`,
];

function resolveTagCommit(api, repo, tag) {
  let object = api(`repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`).object;
  const visited = new Set();
  for (let depth = 0; depth < 8; depth++) {
    if (!object || !SHA.test(object.sha)) throw new Error('Invalid Git tag response.');
    if (object.type === 'commit') return object.sha;
    if (object.type !== 'tag' || visited.has(object.sha)) throw new Error('Unresolvable Git tag.');
    visited.add(object.sha);
    object = api(`repos/${repo}/git/tags/${object.sha}`).object;
  }
  throw new Error('Git tag nesting limit exceeded.');
}

function assertRelease(release, tag) {
  if (!release || !Number.isSafeInteger(release.id) || release.id <= 0 ||
      release.tag_name !== tag || typeof release.draft !== 'boolean' ||
      !Array.isArray(release.assets) || typeof release.html_url !== 'string') {
    throw new Error('Invalid or mismatched release metadata; no writes allowed.');
  }
}

function checkedAsset(assets, name) {
  const matching = assets.filter(asset => asset && asset.name === name);
  if (matching.length !== 1) throw new Error(`Missing or duplicate release asset: ${name}`);
  const asset = matching[0];
  if (asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 || !DIGEST.test(asset.digest)) {
    throw new Error(`Incomplete release asset: ${name}`);
  }
  return asset;
}

function validateExistingRelease(release, tag, names) {
  assertRelease(release, tag);
  for (const name of names) checkedAsset(release.assets, name);
  return release;
}

function runRelease({ mode, repo, tag, expectedSha, artifacts = [], api, gh, log = () => {} }) {
  if (!['prepare', 'verify', 'publish'].includes(mode) ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ||
      !/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(tag)) {
    throw new Error('Invalid release mode, repository or version tag.');
  }
  if ((mode !== 'verify' || expectedSha !== undefined) && !SHA.test(expectedSha)) {
    throw new Error('A full expected source SHA is required.');
  }
  const tagCommit = resolveTagCommit(api, repo, tag);
  if (expectedSha !== undefined && tagCommit !== expectedSha) {
    throw new Error('Git tag does not point at the expected source; no writes allowed.');
  }
  const names = requiredNames(tag);
  const readRelease = () => {
    try {
      const release = api(`repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
      assertRelease(release, tag);
      return release;
    }
    catch (error) { if (error.status === 404) return null; throw error; }
  };
  const unchanged = release => {
    validateExistingRelease(release, tag, names);
    log(`Existing ${release.draft ? 'draft' : 'public'} release verified; all assets left unchanged.`);
    return { needsBuild: false, tagCommit, releaseUrl: release.html_url, unchanged: true };
  };
  const existing = readRelease();
  if (existing) return unchanged(existing);
  if (mode === 'verify') throw new Error('Release not found; verification never creates one.');
  if (mode === 'prepare') return { needsBuild: true, tagCommit };

  // Validate both local artifacts before any remote mutation.
  if (artifacts.length !== names.length || new Set(artifacts.map(a => a.name)).size !== names.length) {
    throw new Error('Exactly the two expected local artifacts are required.');
  }
  for (const name of names) {
    const artifact = artifacts.find(a => a.name === name);
    if (!artifact || typeof artifact.path !== 'string' || !artifact.path ||
        !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || !DIGEST.test(artifact.digest)) {
      throw new Error(`Invalid local artifact: ${name}`);
    }
  }
  try {
    gh(['release', 'create', tag, '--repo', repo, '--verify-tag', '--draft', '--prerelease',
      '--latest=false', '--title', `光影写手 ${tag}`, '--generate-notes']);
  } catch (error) {
    // A concurrent publisher may have finished; only a complete existing release is safe to skip.
    const raced = readRelease();
    if (raced) return unchanged(raced);
    throw error;
  }
  const created = readRelease();
  assertRelease(created, tag);
  if (!created.draft || created.assets.length !== 0) {
    throw new Error('New draft changed externally; stop without replacing any assets.');
  }
  for (const artifact of artifacts) {
    const current = readRelease();
    assertRelease(current, tag);
    if (current.id !== created.id || !current.draft) {
      throw new Error('Draft identity/publication changed; stop without further uploads.');
    }
    for (const name of names) {
      if (!current.assets.some(a => a && a.name === name)) continue;
      const remote = checkedAsset(current.assets, name);
      const local = artifacts.find(a => a.name === name);
      if (remote.size !== local.size || remote.digest !== local.digest) {
        throw new Error(`Draft asset changed externally: ${name}`);
      }
    }
    if (!current.assets.some(a => a && a.name === artifact.name)) {
      // No --clobber: a racing upload remains an explicit failure, never an overwrite.
      gh(['release', 'upload', tag, artifact.path, '--repo', repo]);
    }
  }
  const finished = readRelease();
  validateExistingRelease(finished, tag, names);
  if (finished.id !== created.id || !finished.draft) throw new Error('Draft changed during upload.');
  for (const artifact of artifacts) {
    const remote = checkedAsset(finished.assets, artifact.name);
    if (remote.size !== artifact.size || remote.digest !== artifact.digest) {
      throw new Error(`Uploaded artifact checksum/size mismatch: ${artifact.name}`);
    }
  }
  log('New artifacts uploaded and verified; release remains a draft pending package acceptance.');
  return { needsBuild: false, tagCommit, releaseUrl: finished.html_url, createdDraft: true };
}

function command(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.signal) {
    const error = new Error(`GitHub command failed: ${result.stderr.trim() || result.signal || result.status}`);
    const status = result.stderr.match(/\bHTTP (\d{3})\b/);
    if (status) error.status = Number(status[1]);
    throw error;
  }
  return result.stdout;
}

function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!['--mode', '--repo', '--tag', '--sha', '--dir'].includes(key) || !argv[index + 1]) {
      throw new Error('Usage: release-assets.cjs --mode prepare|verify|publish --repo owner/name --tag vVERSION [--sha FULL_SHA] [--dir release]');
    }
    options[key.slice(2)] = argv[index + 1];
  }
  const artifacts = options.mode === 'publish' ? requiredNames(options.tag).map(name => {
    const file = path.resolve(options.dir || 'release', name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error(`Artifact must be a regular file: ${name}`);
    return { name, path: file, size: stat.size,
      digest: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}` };
  }) : [];
  const result = runRelease({ mode: options.mode, repo: options.repo, tag: options.tag,
    expectedSha: options.sha, artifacts,
    api: route => JSON.parse(command(['api', route])), gh: command,
    log: message => console.error(message) });
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `needs-build=${result.needsBuild}\n`);
  }
}

module.exports = { runRelease, validateExistingRelease, resolveTagCommit };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
