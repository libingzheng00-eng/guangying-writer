'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Reserved recovery slot: the immediately preceding successfully replaced .zhsp.
// It is never used as the active save target or deleted during ordinary saving.
const SAVE_BACKUP_SUFFIX = '.guangying-backup';
const UNSUPPORTED_DIRECTORY_SYNC = new Set(['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EACCES']);

function saveError(error, phase) {
  // Do not forward arbitrary error messages: callers must never display script HTML,
  // an image data URL, or file contents received through IPC in an error dialog.
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
    ? error.code : 'ESAVE';
  const safe = new Error(`工程保存未完成（${phase} / ${code}）。未直接截断原文件。`);
  safe.name = 'ProjectSaveError';
  safe.code = code;
  safe.phase = phase;
  return safe;
}

function fail(code) {
  const error = new Error('Project save rejected');
  error.code = code;
  throw error;
}

function sameFile(a, b) {
  if (!a || !b) return a === b;
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.mode === b.mode;
}

/**
 * Asynchronous, same-directory .zhsp replacement. There is intentionally no JSON
 * conversion here: the renderer's immutable snapshot is written byte-for-byte.
 *
 * File data is fsynced before either rename. Directory fsync is best effort after
 * commit because Windows/some filesystems do not support it; a post-commit sync
 * failure is reported in the result, not as a failed save that has actually saved.
 * Atomic rename is not a distributed lock: external writers must not concurrently
 * edit this file. Detectable changes during preparation are rejected conservatively.
 */
function createProjectSaver({ fileSystem = fs.promises, token = randomUUID, platform = process.platform } = {}) {
  const queues = new Map();
  let admissions = Promise.resolve();

  async function inspect(file) {
    try {
      const stat = await fileSystem.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('EUNSAFEPATH');
      return stat;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function requireWritable(file, stat) {
    if (!stat) return;
    // Rename would otherwise silently replace a deliberately read-only file when
    // the directory is writable. Preserve the ordinary Save permission contract.
    if ((stat.mode & 0o222) === 0) fail('EACCES');
    await fileSystem.access(file, fs.constants.W_OK);
  }

  async function commit(file, content) {
    const directory = path.dirname(file);
    const backup = `${file}${SAVE_BACKUP_SUFFIX}`;
    const temporary = new Set();
    const handles = new Set();
    let phase = '检查目标';

    async function temp(role, mode) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const id = token();
        if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) fail('ETEMPNAME');
        const name = path.join(directory, `.guangying-${role}-${id}.tmp`);
        try {
          const handle = await fileSystem.open(name, 'wx', mode);
          temporary.add(name);
          handles.add(handle);
          return { name, handle };
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
      fail('EEXIST');
    }

    async function close(handle) {
      await handle.close();
      handles.delete(handle);
    }

    async function assertUnchanged(filePath, original) {
      if (!sameFile(await inspect(filePath), original)) fail('ECONCURRENT');
    }

    try {
      const original = await inspect(file);
      const oldBackup = await inspect(backup);
      if (original && oldBackup && original.dev === oldBackup.dev && original.ino === oldBackup.ino) {
        fail('EUNSAFEPATH');
      }
      await requireWritable(file, original);
      await requireWritable(backup, oldBackup);

      phase = '准备新文件';
      // New files are private by default. Existing ordinary permission bits survive.
      const prepared = await temp('save', original ? original.mode & 0o777 : 0o600);
      await prepared.handle.writeFile(content, 'utf8');
      if (original) await prepared.handle.chmod(original.mode & 0o777);
      await prepared.handle.sync();
      await close(prepared.handle);

      let preparedBackup = null;
      if (original) {
        phase = '准备恢复备份';
        const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
        const source = await fileSystem.open(file, flags);
        handles.add(source);
        if (!sameFile(await source.stat(), original)) fail('ECONCURRENT');
        preparedBackup = await temp('backup', original.mode & 0o777);
        // Stream the preceding version in bounded chunks rather than keeping a
        // second image-heavy project in memory. Handle partial writes explicitly.
        const buffer = Buffer.allocUnsafe(256 * 1024);
        let position = 0;
        while (true) {
          const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
          if (!bytesRead) break;
          let written = 0;
          while (written < bytesRead) {
            const result = await preparedBackup.handle.write(buffer, written, bytesRead - written, position + written);
            if (!result.bytesWritten) fail('EIO');
            written += result.bytesWritten;
          }
          position += bytesRead;
        }
        if (!sameFile(await source.stat(), original)) fail('ECONCURRENT');
        await close(source);
        await preparedBackup.handle.chmod(original.mode & 0o777);
        await preparedBackup.handle.sync();
        await close(preparedBackup.handle);
      }

      phase = '核对文件状态';
      await assertUnchanged(file, original);
      await assertUnchanged(backup, oldBackup);
      if (preparedBackup) {
        phase = '保留恢复备份';
        await fileSystem.rename(preparedBackup.name, backup);
        temporary.delete(preparedBackup.name);
      }
      // Never unlink/truncate the destination. Until this one rename succeeds the
      // active file remains the old version, even if a backup rename has succeeded.
      phase = '替换工程';
      await assertUnchanged(file, original);
      await fileSystem.rename(prepared.name, file);
      temporary.delete(prepared.name);

      let directorySynced = false;
      let durabilityWarning = null;
      let directoryHandle;
      try {
        directoryHandle = await fileSystem.open(directory, fs.constants.O_RDONLY);
        await directoryHandle.sync();
        directorySynced = true;
      } catch (error) {
        const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'ESYNC';
        durabilityWarning = UNSUPPORTED_DIRECTORY_SYNC.has(code) ? 'directory-sync-unavailable' : `directory-sync-${code}`;
      } finally {
        if (directoryHandle) await directoryHandle.close().catch(() => {});
      }
      return { path: file, backupPath: original ? backup : null, directorySynced, durabilityWarning };
    } catch (error) {
      throw saveError(error, phase);
    } finally {
      for (const handle of handles) await handle.close().catch(() => {});
      // Only paths created by this invocation are eligible for cleanup. A stale or
      // unrelated temp file is never swept; failed cleanup cannot remove the target.
      for (const name of temporary) await fileSystem.unlink(name).catch(() => {});
    }
  }

  return async function saveProjectFile(file, content) {
    if (typeof file !== 'string' || !file || typeof content !== 'string') {
      throw saveError({ code: 'EINVAL' }, '检查请求');
    }
    if (path.extname(file).toLowerCase() !== '.zhsp') {
      throw saveError({ code: 'EFORMAT' }, '检查工程格式');
    }
    // Serialize only path resolution/admission so asynchronous realpath completion
    // cannot reverse two successive snapshots. Actual saves to different files may
    // still proceed concurrently; aliases of the same parent share one file queue.
    const admission = admissions.then(async () => {
      let destination;
      try {
        const directory = await fileSystem.realpath(path.dirname(path.resolve(file)));
        destination = path.join(directory, path.basename(file));
      } catch (error) {
        throw saveError(error, '检查目录');
      }
      // On ordinary Windows volumes, differently cased names address one file.
      // Serialize those aliases too. On opt-in case-sensitive Windows directories
      // this is only conservative serialization; the actual paths stay unchanged.
      const queueKey = platform === 'win32' ? destination.toLowerCase() : destination;
      const previous = queues.get(queueKey) || Promise.resolve();
      const pending = previous.catch(() => {}).then(() => commit(destination, content));
      queues.set(queueKey, pending);
      // Do not adopt pending here: admission must not wait for a whole disk save.
      return { queueKey, pending };
    });
    admissions = admission.then(() => {}, () => {});
    const { queueKey, pending } = await admission;
    try {
      return await pending;
    } finally {
      if (queues.get(queueKey) === pending) queues.delete(queueKey);
    }
  };
}

const saveProjectFile = createProjectSaver();
module.exports = { createProjectSaver, saveProjectFile, SAVE_BACKUP_SUFFIX };
