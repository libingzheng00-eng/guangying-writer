'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { MAX_CONTENT_BYTES, rejectRequest } = require('./security');
const LEDGER_NAME = 'file-authorizations-v1.json';
const MAX_GRANTS = 128;

// Only the main process calls grantProject, after a successful native selection.
// recent.json and renderer recovery paths are deliberately not inputs to this
// ledger. Local processes that can modify userData are outside this IPC boundary.
function createFileAccess({ fileSystem = fs, pathApi = path, platform = process.platform, userData, protectedRoots = [], warn = () => {} } = {}) {
  const projects = new Map();
  const shown = new Map();
  let loaded = false;
  const ledger = () => pathApi.join(userData(), LEDGER_NAME);
  // Do not case-fold capabilities: Windows permits case-sensitive directories.
  // A differently-spelled path can be a different file and must be reselected.
  const key = value => value;
  const sameDirectory = (a, b) => a.dev === b.dev && a.ino === b.ino;

  function validPath(file) {
    if (typeof file !== 'string' || !file || file.length > 32768 || /[\0\r\n]/.test(file) || !pathApi.isAbsolute(file)) rejectRequest();
    if (platform === 'win32') {
      const qualified = pathApi.normalize(file);
      if (!/^(?:[a-z]:[\\/]|\\\\[^\\/]+\\[^\\/]+\\)/i.test(qualified)) rejectRequest();
      if (/^\\\\[?.]\\/.test(file) || /:/.test(file.replace(/^[a-z]:/i, '')) ||
          /(?:^|[\\/])(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|[\\/]|$)/i.test(file) || /[. ]$/.test(file)) rejectRequest();
    }
    return pathApi.resolve(file);
  }

  function inspect(file, extension) {
    const requested = validPath(file);
    if (extension && pathApi.extname(requested).toLowerCase() !== `.${extension.toLowerCase()}`) rejectRequest();
    const directory = fileSystem.realpathSync(pathApi.dirname(requested));
    const parent = fileSystem.statSync(directory);
    if (!parent.isDirectory()) rejectRequest();
    const canonical = pathApi.join(directory, pathApi.basename(requested));
    let stat = null;
    try { stat = fileSystem.lstatSync(canonical); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) rejectRequest();
    return { requested, canonical, key: key(canonical), parent: { dev: parent.dev, ino: parent.ino }, stat };
  }

  function writable(selection) {
    // Even a selected export must not overwrite application code or the ledger /
    // recovery store. Resolve roots too, so a directory alias cannot bypass this.
    for (const root of [...protectedRoots, userData()]) {
      let resolved;
      try { resolved = fileSystem.realpathSync(root); } catch { resolved = pathApi.resolve(root); }
      const relative = pathApi.relative(platform === 'win32' ? resolved.toLowerCase() : resolved,
        platform === 'win32' ? selection.canonical.toLowerCase() : selection.canonical);
      if (!relative || (!relative.startsWith(`..${pathApi.sep}`) && relative !== '..' && !pathApi.isAbsolute(relative))) rejectRequest();
    }
    return selection;
  }

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const stat = fileSystem.lstatSync(ledger());
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return;
      const saved = JSON.parse(fileSystem.readFileSync(ledger(), 'utf8'));
      if (saved?.version !== 1 || !Array.isArray(saved.projects) || saved.projects.length > MAX_GRANTS) return;
      for (const grant of saved.projects) {
        if (typeof grant?.path !== 'string' || pathApi.extname(grant.path).toLowerCase() !== '.zhsp' ||
            !Number.isFinite(grant?.parent?.dev) || !Number.isFinite(grant?.parent?.ino)) continue;
        const canonical = validPath(grant.path);
        projects.set(key(canonical), { canonical, key: key(canonical), parent: grant.parent });
      }
    } catch { /* Missing/invalid grants require a native selection; never infer. */ }
  }

  function persist() {
    let temporary;
    let descriptor;
    let created = false;
    try {
      let existing;
      try { existing = fileSystem.lstatSync(ledger()); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (existing && (!existing.isFile() || existing.isSymbolicLink())) rejectRequest();
      temporary = pathApi.join(userData(), `.file-authorizations-${randomUUID()}.tmp`);
      const data = JSON.stringify({ version: 1, projects: [...projects.values()].map(grant => ({ path: grant.canonical, parent: grant.parent })) });
      descriptor = fileSystem.openSync(temporary, fileSystem.constants.O_WRONLY | fileSystem.constants.O_CREAT | fileSystem.constants.O_EXCL, 0o600);
      created = true;
      fileSystem.writeFileSync(descriptor, data, 'utf8');
      fileSystem.fsyncSync(descriptor);
      fileSystem.closeSync(descriptor); descriptor = undefined;
      fileSystem.renameSync(temporary, ledger());
      temporary = null;
    } catch {
      // A successful project save stays successful. This session retains its
      // grant; after restart the user may need to confirm the destination again.
      warn('文件保存授权未能持久化；下次启动可能需要重新确认保存位置。');
    } finally {
      if (descriptor !== undefined) { try { fileSystem.closeSync(descriptor); } catch { /* own descriptor */ } }
      if (temporary && created) { try { fileSystem.unlinkSync(temporary); } catch { /* own temp only */ } }
    }
  }

  function remember(selection) {
    shown.set(selection.key, selection);
    if (shown.size > MAX_GRANTS) shown.delete(shown.keys().next().value);
  }

  function selected(file, extension) { return writable(inspect(file, extension)); }

  function check(selection, extension) {
    const current = selected(selection.requested || selection.canonical, extension);
    if (current.key !== selection.key || !sameDirectory(current.parent, selection.parent)) rejectRequest();
    return current;
  }

  function grantProject(selection) {
    const current = check(selection, 'zhsp');
    load();
    projects.delete(current.key);
    projects.set(current.key, current);
    if (projects.size > MAX_GRANTS) projects.delete(projects.keys().next().value);
    remember(current); persist();
  }

  function authorizedProject(file) {
    const current = selected(file, 'zhsp');
    load();
    const grant = projects.get(current.key);
    if (!grant) return null;
    if (!sameDirectory(current.parent, grant.parent)) rejectRequest();
    return current;
  }

  function readSelected(file) {
    const selection = inspect(file);
    if (!selection.stat || selection.stat.size > MAX_CONTENT_BYTES) rejectRequest();
    const fd = fileSystem.openSync(selection.canonical, fileSystem.constants.O_RDONLY | (fileSystem.constants.O_NOFOLLOW || 0));
    try {
      const current = fileSystem.fstatSync(fd);
      if (!current.isFile() || current.dev !== selection.stat.dev || current.ino !== selection.stat.ino || current.size > MAX_CONTENT_BYTES) rejectRequest();
      const content = fileSystem.readFileSync(fd, 'utf8');
      if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) rejectRequest();
      remember(selection);
      // An explicitly opened .zhsp is eligible for ordinary Save. Imports and
      // backup files are read-only selections and cannot grant arbitrary writes.
      if (pathApi.extname(file).toLowerCase() === '.zhsp') {
        try { grantProject(selection); }
        catch { /* A readable protected project may still be opened read-only. */ }
      }
      return { selection, content };
    } finally { fileSystem.closeSync(fd); }
  }

  function writeExport(selection, data, encoding) {
    const current = check(selection);
    const flags = fileSystem.constants.O_WRONLY | (fileSystem.constants.O_NOFOLLOW || 0) |
      (current.stat ? 0 : fileSystem.constants.O_CREAT | fileSystem.constants.O_EXCL);
    const fd = fileSystem.openSync(current.canonical, flags, 0o600);
    try {
      const stat = fileSystem.fstatSync(fd);
      if (!stat.isFile() || stat.nlink > 1 || (current.stat && (stat.dev !== current.stat.dev || stat.ino !== current.stat.ino))) rejectRequest();
      fileSystem.ftruncateSync(fd, 0);
      fileSystem.writeFileSync(fd, data, encoding);
      remember(current);
    } finally { fileSystem.closeSync(fd); }
  }

  function shownPath(file) {
    const current = inspect(file);
    load();
    const grant = shown.get(current.key) || projects.get(current.key);
    if (!grant || !sameDirectory(current.parent, grant.parent)) rejectRequest();
    return current.canonical;
  }

  return { selected, check, grantProject, authorizedProject, readSelected, writeExport, shownPath, validPath };
}

module.exports = { createFileAccess, LEDGER_NAME };
