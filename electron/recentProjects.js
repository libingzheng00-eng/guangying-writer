'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { rejectRequest } = require('./security');

const MAX_RECENT = 100;
const MAX_RECENT_BYTES = 4 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);

// This registry is display metadata, never a file capability. Even migrated
// paths must go through the independent native-selection authorization ledger.
function createRecentProjects({ fileSystem = fs, pathApi = path, userData, fileAccess,
  now = Date.now, token = randomUUID } = {}) {
  const location = () => pathApi.join(userData(), 'recent.json');

  function nameFor(value, file) {
    if (value === undefined) return pathApi.basename(file);
    if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) rejectRequest();
    return value.trim() || pathApi.basename(file);
  }

  function load() {
    let stat;
    try { stat = fileSystem.lstatSync(location()); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RECENT_BYTES) rejectRequest();
    const fd = fileSystem.openSync(location(), fileSystem.constants.O_RDONLY | (fileSystem.constants.O_NOFOLLOW || 0));
    let raw;
    try {
      const current = fileSystem.fstatSync(fd);
      if (!current.isFile() || current.dev !== stat.dev || current.ino !== stat.ino || current.size > MAX_RECENT_BYTES) rejectRequest();
      raw = fileSystem.readFileSync(fd, 'utf8');
    } finally { fileSystem.closeSync(fd); }
    if (Buffer.byteLength(raw, 'utf8') > MAX_RECENT_BYTES) rejectRequest();
    const input = JSON.parse(raw);
    if (!Array.isArray(input) || input.length > MAX_RECENT) rejectRequest();
    const ids = new Set(), paths = new Set(), entries = [];
    for (const item of input) {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
          !Number.isFinite(item.updatedAt) || item.updatedAt < 0 ||
          (item.pinned !== undefined && typeof item.pinned !== 'boolean')) rejectRequest();
      const file = fileAccess.validPath(item.path);
      // Older versions also remembered imported text. These have no project
      // association and cannot be reopened as a .zhsp from this project list.
      if (pathApi.extname(file).toLowerCase() !== '.zhsp') continue;
      const name = nameFor(item.name, file);
      const id = item.id === undefined
        ? `legacy-${createHash('sha256').update(file).digest('hex').slice(0, 32)}` : item.id;
      if (!validId(id) || ids.has(id)) rejectRequest();
      if (paths.has(file)) continue;
      ids.add(id); paths.add(file);
      entries.push({ id, path: file, name, updatedAt: item.updatedAt, pinned: item.pinned === true });
    }
    return entries;
  }

  const sorted = list => [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);

  function persist(list) {
    if (list.length > MAX_RECENT) rejectRequest();
    const data = JSON.stringify(sorted(list), null, 2);
    if (Buffer.byteLength(data, 'utf8') > MAX_RECENT_BYTES) rejectRequest();
    const id = token();
    if (!validId(id)) rejectRequest();
    const temporary = pathApi.join(userData(), `.recent-projects-${id}.tmp`);
    let descriptor, created = false;
    try {
      let existing;
      try { existing = fileSystem.lstatSync(location()); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (existing && (!existing.isFile() || existing.isSymbolicLink())) rejectRequest();
      descriptor = fileSystem.openSync(temporary,
        fileSystem.constants.O_WRONLY | fileSystem.constants.O_CREAT | fileSystem.constants.O_EXCL, 0o600);
      created = true;
      fileSystem.writeFileSync(descriptor, data, 'utf8');
      fileSystem.fsyncSync(descriptor);
      fileSystem.closeSync(descriptor); descriptor = undefined;
      fileSystem.renameSync(temporary, location());
      created = false;
    } finally {
      if (descriptor !== undefined) { try { fileSystem.closeSync(descriptor); } catch { /* own descriptor */ } }
      if (created) { try { fileSystem.unlinkSync(temporary); } catch { /* only our newly created metadata temp */ } }
    }
  }

  function list() {
    return sorted(load()).map(entry => ({ ...entry, ...fileAccess.projectStatus(entry.path) }));
  }

  function find(id) {
    if (!validId(id)) rejectRequest();
    const entry = load().find(item => item.id === id);
    if (!entry) rejectRequest();
    return entry;
  }

  function commit({ path: input, name, replaceId, opened = true }) {
    const file = fileAccess.validPath(input);
    if (pathApi.extname(file).toLowerCase() !== '.zhsp') rejectRequest();
    const items = load();
    const replaced = replaceId === undefined ? null : items.find(item => item.id === replaceId);
    // Removed/replaced records cannot be resurrected by an outstanding token.
    if (replaceId !== undefined && (!validId(replaceId) || !replaced)) rejectRequest();
    const previous = replaced || items.find(item => item.path === file);
    const duplicate = items.find(item => item.path === file);
    const id = previous?.id || token();
    if (!validId(id) || (!previous && items.some(item => item.id === id))) rejectRequest();
    const timestamp = now();
    if (!Number.isFinite(timestamp) || timestamp < 0) rejectRequest();
    const entry = { id, path: file, name: nameFor(name ?? previous?.name, file),
      updatedAt: opened || !previous ? timestamp : previous.updatedAt,
      pinned: previous?.pinned === true || duplicate?.pinned === true };
    const next = items.filter(item => item.id !== id && item.path !== file);
    next.push(entry);
    while (next.length > MAX_RECENT) {
      const oldest = next.filter(item => !item.pinned && item !== entry).sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!oldest) rejectRequest(); // Never silently evict a pinned project.
      next.splice(next.indexOf(oldest), 1);
    }
    persist(next);
    return entry;
  }

  function pin(id, pinned) {
    if (!validId(id) || typeof pinned !== 'boolean') rejectRequest();
    const items = load(), entry = items.find(item => item.id === id);
    if (!entry) rejectRequest();
    entry.pinned = pinned;
    persist(items);
    return list();
  }

  function remove(id) {
    if (!validId(id)) rejectRequest();
    const items = load();
    if (!items.some(item => item.id === id)) rejectRequest();
    persist(items.filter(item => item.id !== id));
    return list();
  }

  return { list, find, commit, pin, remove };
}

module.exports = { createRecentProjects, MAX_RECENT, MAX_RECENT_BYTES, validId };
