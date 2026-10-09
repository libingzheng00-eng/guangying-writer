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
  // Match fs.promises.realpath used by the asynchronous project saver. The
  // legacy synchronous implementation can retain Windows 8.3/case spellings
  // that native realpath expands, even for the same directory identity.
  const realpath = file => (fileSystem.realpathSync.native || fileSystem.realpathSync)(file);
  // Do not case-fold capabilities: Windows permits case-sensitive directories.
  // A differently-spelled path can be a different file and must be reselected.
  const key = value => value;
  const sameDirectory = (a, b) => a.dev === b.dev && a.ino === b.ino;
  const identity = stat => stat ? { dev: stat.dev, ino: stat.ino } : null;
  const sameFile = (a, b) => !!a && !!b && a.dev === b.dev && a.ino === b.ino;
  const unchangedFile = (a, b) => sameFile(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

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
    const directory = realpath(pathApi.dirname(requested));
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
      try { resolved = realpath(root); } catch { resolved = pathApi.resolve(root); }
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
        const fileIdentity = Number.isFinite(grant?.fileIdentity?.dev) && Number.isFinite(grant?.fileIdentity?.ino)
          ? { dev: grant.fileIdentity.dev, ino: grant.fileIdentity.ino } : null;
        projects.set(key(canonical), { canonical, key: key(canonical), parent: grant.parent, fileIdentity });
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
      const data = JSON.stringify({ version: 1, projects: [...projects.values()].map(grant => ({
        path: grant.canonical, parent: grant.parent, fileIdentity: grant.fileIdentity,
      })) });
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

  function grantProject(selection, fromRead = false) {
    const current = check(selection, 'zhsp');
    if (fromRead && !unchangedFile(current.stat, selection.stat)) rejectRequest();
    load();
    projects.delete(current.key);
    projects.set(current.key, { ...current, fileIdentity: identity(current.stat) });
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

  function readSelection(selection, grant) {
    if (!selection.stat || selection.stat.size > MAX_CONTENT_BYTES) rejectRequest();
    const fd = fileSystem.openSync(selection.canonical, fileSystem.constants.O_RDONLY | (fileSystem.constants.O_NOFOLLOW || 0));
    try {
      const current = fileSystem.fstatSync(fd);
      if (!current.isFile() || !unchangedFile(current, selection.stat) || current.size > MAX_CONTENT_BYTES) rejectRequest();
      const content = fileSystem.readFileSync(fd, 'utf8');
      if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) rejectRequest();
      const after = inspect(selection.requested);
      if (after.key !== selection.key || !sameDirectory(after.parent, selection.parent) ||
          !unchangedFile(after.stat, current) || !unchangedFile(fileSystem.fstatSync(fd), current)) rejectRequest();
      remember(selection);
      // An explicitly opened .zhsp is eligible for ordinary Save. Imports and
      // backup files are read-only selections and cannot grant arbitrary writes.
      if (grant && pathApi.extname(selection.requested).toLowerCase() === '.zhsp') {
        try { grantProject(selection, true); }
        catch { /* A readable protected project may still be opened read-only. */ }
      }
      return { selection, content };
    } finally { fileSystem.closeSync(fd); }
  }

  function readSelected(file) { return readSelection(inspect(file), true); }

  function authorizedReadProject(file) {
    const current = authorizedProject(file);
    if (!current) return null;
    const grant = projects.get(current.key);
    // A saved parent-directory grant is enough for ordinary Save, but automatic
    // reads additionally require the selected file identity. Old ledgers that
    // predate this field remain usable for Save and require native re-selection
    // before automatic reads. An external atomic replacement also re-prompts.
    if (!current.stat || !sameFile(current.stat, grant.fileIdentity)) return null;
    return current;
  }

  function readAuthorizedProject(file) {
    const selection = authorizedReadProject(file);
    if (!selection) rejectRequest();
    return readSelection(selection, false);
  }

  function projectStatus(file) {
    try {
      const current = inspect(file, 'zhsp');
      if (!current.stat) return { missing: true, needsAuthorization: true };
      return { missing: false, needsAuthorization: !authorizedReadProject(file) };
    } catch (error) {
      return { missing: error.code === 'ENOENT' || error.code === 'ENOTDIR', needsAuthorization: true };
    }
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

  return { selected, check, grantProject, authorizedProject, readSelected, readAuthorizedProject,
    projectStatus, writeExport, shownPath, validPath };
}

module.exports = { createFileAccess, LEDGER_NAME };
