'use strict';

// Real temporary-directory IO + injected failures, entirely synthetic content.
// This does not pretend to be an Electron dialog/end-to-end Save acceptance test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createProjectSaver, SAVE_BACKUP_SUFFIX } = require('../electron/projectSave');

let checks = 0;
function eq(actual, expected, message) { assert.equal(actual, expected, message || 'expected values to match'); checks++; }
function ok(actual, message) { assert.ok(actual, message || 'expected truthy value'); checks++; }
const a = '{"title":"合成保存甲","image":"data:image/png;base64,AAAA"}';
const b = '{"title":"合成保存乙","text":"<b>中文 & 字面字符</b>"}';
const c = '{"title":"合成保存丙","text":"第三次保存"}';

function error(code) {
  const result = new Error('SYNTHETIC_PRIVATE_BODY data:image/png;base64,SHOULD_NOT_APPEAR');
  result.code = code;
  return result;
}

function injectedFs({ fault, partialWrites = false, onEvent } = {}) {
  let used = false;
  const events = [];
  function event(method, file, args) {
    const entry = { method, file, args };
    events.push(entry);
    onEvent?.(entry);
    if (!used && fault?.(entry)) {
      used = true;
      throw error(fault.code || 'EACCES');
    }
  }
  function wrapHandle(handle, file) {
    return new Proxy(handle, {
      get(target, key) {
        const value = target[key];
        if (typeof value !== 'function') return value;
        return async (...args) => {
          event(`handle.${String(key)}`, file, args);
          if (partialWrites && key === 'write' && args[2] > 1) {
            args[2] = Math.ceil(args[2] / 2);
          }
          return value.apply(target, args);
        };
      },
    });
  }
  const fileSystem = new Proxy(fs.promises, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== 'function') return value;
      return async (...args) => {
        event(String(key), args[0], args);
        const result = await value.apply(target, args);
        return key === 'open' ? wrapHandle(result, args[0]) : result;
      };
    },
  });
  return { fileSystem, events, faultUsed: () => used };
}

async function main() {
  const root = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'guangying-project-save-test-')));
  let index = 0;
  async function fixture(initial = a) {
    const dir = path.join(root, `合成路径 空格-${++index}`);
    await fs.promises.mkdir(dir);
    const file = path.join(dir, '合成.zhsp');
    if (initial !== null) await fs.promises.writeFile(file, initial, { mode: 0o640 });
    return { dir, file, backup: `${file}${SAVE_BACKUP_SUFFIX}` };
  }
  async function content(file) { return fs.promises.readFile(file, 'utf8'); }
  async function clean(dir) {
    const names = await fs.promises.readdir(dir);
    eq(names.filter(name => name.endsWith('.tmp')).length, 0, 'own temp files cleaned');
  }
  async function rejected(save, file, next, code) {
    await assert.rejects(save(file, next), err => {
      eq(err.name, 'ProjectSaveError');
      eq(err.code, code);
      ok(!/SYNTHETIC_PRIVATE_BODY|data:|base64|合成保存/.test(err.message), 'error does not expose data');
      ok(typeof err.phase === 'string', 'failure has safe phase');
      return true;
    });
    checks++;
  }

  try {
    const fresh = await fixture(null);
    const freshSave = createProjectSaver();
    const first = await freshSave(fresh.file, a);
    eq(await content(fresh.file), a, 'new project bytes intact');
    eq(first.path, fresh.file);
    eq(first.backupPath, null, 'new file has no previous backup');
    if (process.platform === 'win32') {
      ok((await fs.promises.stat(fresh.file)).mode & 0o200, 'new Windows project is writable; POSIX privacy bits are not ACLs');
    } else {
      eq((await fs.promises.stat(fresh.file)).mode & 0o777, 0o600, 'new POSIX project is private');
    }
    ok(typeof first.directorySynced === 'boolean');
    await clean(fresh.dir);
    const second = await freshSave(fresh.file, b);
    eq(await content(fresh.file), b, 'replacement bytes intact');
    eq(await content(fresh.backup), a, 'backup preserves preceding version');
    eq(second.backupPath, fresh.backup);
    await freshSave(fresh.file, c);
    eq(await content(fresh.file), c);
    eq(await content(fresh.backup), b, 'backup advances exactly one successful save');
    await clean(fresh.dir);

    const permissions = await fixture();
    await fs.promises.chmod(permissions.file, 0o640);
    await createProjectSaver()(permissions.file, b);
    const expectedMode = process.platform === 'win32' ? 0o666 : 0o640;
    eq((await fs.promises.stat(permissions.file)).mode & 0o777, expectedMode, 'target platform permission bits preserved');
    eq((await fs.promises.stat(permissions.backup)).mode & 0o777, expectedMode, 'backup platform permission bits preserved');

    const backupReadOnly = await fixture();
    await fs.promises.writeFile(backupReadOnly.backup, 'synthetic-protected-backup', { mode: 0o400 });
    await rejected(createProjectSaver(), backupReadOnly.file, b, 'EACCES');
    eq(await content(backupReadOnly.file), a);
    eq(await content(backupReadOnly.backup), 'synthetic-protected-backup', 'read-only backup slot is not silently replaced');
    await clean(backupReadOnly.dir);

    const readOnly = await fixture();
    await fs.promises.chmod(readOnly.file, 0o400);
    await rejected(createProjectSaver(), readOnly.file, b, 'EACCES');
    eq(await content(readOnly.file), a);
    await clean(readOnly.dir);

    // All failures before the destination rename leave the active project intact.
    const failureCases = [
      ['permission-check', 'EACCES', e => e.method === 'access'],
      ['new-temp-open', 'EACCES', e => e.method === 'open' && e.file.includes('.guangying-save-')],
      ['new-data-write', 'ENOSPC', e => e.method === 'handle.writeFile'],
      ['new-data-sync', 'EIO', e => e.method === 'handle.sync' && e.file.includes('.guangying-save-')],
      ['new-temp-close', 'EIO', e => e.method === 'handle.close' && e.file.includes('.guangying-save-')],
      ['source-open', 'EACCES', e => e.method === 'open' && e.file.endsWith('.zhsp')],
      ['backup-temp-open', 'ENOSPC', e => e.method === 'open' && e.file.includes('.guangying-backup-')],
      ['backup-read', 'EIO', e => e.method === 'handle.read'],
      ['backup-write', 'ENOSPC', e => e.method === 'handle.write'],
      ['backup-sync', 'EIO', e => e.method === 'handle.sync' && e.file.includes('.guangying-backup-')],
      ['backup-rename', 'EACCES', e => e.method === 'rename' && e.args[1].endsWith(SAVE_BACKUP_SUFFIX)],
      ['target-rename', 'EACCES', e => e.method === 'rename' && e.args[1].endsWith('.zhsp')],
    ];
    for (const [name, code, predicate] of failureCases) {
      const current = await fixture();
      await fs.promises.writeFile(current.backup, 'synthetic-older-backup');
      const fault = Object.assign(predicate, { code });
      const io = injectedFs({ fault });
      await rejected(createProjectSaver({ fileSystem: io.fileSystem }), current.file, b, code);
      ok(io.faultUsed(), `${name}: injection reached`);
      eq(await content(current.file), a, `${name}: original intact`);
      eq(await content(current.backup), name === 'target-rename' ? a : 'synthetic-older-backup', `${name}: valid backup retained`);
      await clean(current.dir);
    }

    const large = await fixture(a.repeat(14000));
    const partial = injectedFs({ partialWrites: true });
    await createProjectSaver({ fileSystem: partial.fileSystem })(large.file, b);
    eq(await content(large.backup), a.repeat(14000), 'bounded copy handles multi-chunk/partial writes');
    eq(await content(large.file), b);
    const firstRename = partial.events.findIndex(e => e.method === 'rename');
    ok(partial.events.slice(0, firstRename).filter(e => e.method === 'handle.sync').length === 2, 'both file bodies fsynced before rename');
    eq(partial.events.filter(e => e.method === 'rename')[0].args[1], large.backup);
    eq(partial.events.filter(e => e.method === 'rename')[1].args[1], large.file);
    await clean(large.dir);

    const concurrent = await fixture();
    const queued = createProjectSaver();
    await Promise.all([queued(concurrent.file, b), queued(concurrent.file, c)]);
    eq(await content(concurrent.file), c, 'same-path concurrent requests serialize');
    eq(await content(concurrent.backup), b, 'second request backs up first successful request');
    await clean(concurrent.dir);

    const alias = await fixture();
    const aliasDir = path.join(root, 'same-parent-alias');
    await fs.promises.symlink(alias.dir, aliasDir, process.platform === 'win32' ? 'junction' : 'dir');
    const aliasSave = createProjectSaver();
    await Promise.all([aliasSave(alias.file, b), aliasSave(path.join(aliasDir, '合成.zhsp'), c)]);
    eq(await content(alias.file), c, 'parent-directory aliases share the same save queue');
    eq(await content(alias.backup), b);
    await clean(alias.dir);

    // Model Windows case-insensitive filename lookup even on a case-sensitive
    // development volume, and run the same case directly on Windows below.
    const caseAlias = await fixture();
    const upperCaseFile = caseAlias.file.replace(/\.zhsp$/, '.ZHSP');
    const lowerCasePath = value => typeof value === 'string' && value.startsWith(upperCaseFile)
      ? caseAlias.file + value.slice(upperCaseFile.length) : value;
    const insensitiveFs = new Proxy(fs.promises, {
      get(target, key) {
        const value = target[key];
        if (typeof value !== 'function') return value;
        return (...args) => value.apply(target, args.map(lowerCasePath));
      },
    });
    const insensitiveSave = createProjectSaver({ fileSystem: insensitiveFs, platform: 'win32' });
    await Promise.all([insensitiveSave(caseAlias.file, b), insensitiveSave(upperCaseFile, c)]);
    eq(await content(caseAlias.file), c, 'Windows case aliases serialize in request order');
    eq(await content(caseAlias.backup), b, 'case alias backup contains the prior successful snapshot');
    await clean(caseAlias.dir);
    if (process.platform === 'win32') {
      const nativeCase = await fixture();
      const nativeSave = createProjectSaver();
      await Promise.all([nativeSave(nativeCase.file, b), nativeSave(nativeCase.file.replace(/\.zhsp$/, '.ZHSP'), c)]);
      eq(await content(nativeCase.file), c, 'real Windows filesystem case aliases serialize');
      eq(await content(nativeCase.backup), b);
      await clean(nativeCase.dir);
    }

    const recoverQueue = await fixture();
    const failsOnce = injectedFs({ fault: Object.assign(e => e.method === 'handle.writeFile', { code: 'ENOSPC' }) });
    const reusable = createProjectSaver({ fileSystem: failsOnce.fileSystem });
    await rejected(reusable, recoverQueue.file, b, 'ENOSPC');
    await reusable(recoverQueue.file, c);
    eq(await content(recoverQueue.file), c, 'failed request does not poison queue');
    eq(await content(recoverQueue.backup), a);
    await clean(recoverQueue.dir);

    const linked = await fixture();
    const link = path.join(linked.dir, '链接.zhsp');
    await fs.promises.symlink(linked.file, link);
    await rejected(createProjectSaver(), link, b, 'EUNSAFEPATH');
    eq(await content(linked.file), a, 'symlink referent untouched');
    ok((await fs.promises.lstat(link)).isSymbolicLink(), 'symlink not replaced');
    const badBackup = await fixture();
    const unrelated = path.join(badBackup.dir, 'unrelated.txt');
    await fs.promises.writeFile(unrelated, 'synthetic-unrelated');
    await fs.promises.symlink(unrelated, badBackup.backup);
    await rejected(createProjectSaver(), badBackup.file, b, 'EUNSAFEPATH');
    eq(await content(badBackup.file), a);
    eq(await content(unrelated), 'synthetic-unrelated', 'backup symlink referent untouched');

    const hardLinkedBackup = await fixture();
    await fs.promises.link(hardLinkedBackup.file, hardLinkedBackup.backup);
    await rejected(createProjectSaver(), hardLinkedBackup.file, b, 'EUNSAFEPATH');
    eq(await content(hardLinkedBackup.file), a, 'backup cannot alias active target inode');
    eq(await content(hardLinkedBackup.backup), a);
    await clean(hardLinkedBackup.dir);

    const directoryTarget = await fixture(null);
    await fs.promises.mkdir(directoryTarget.file);
    await rejected(createProjectSaver(), directoryTarget.file, b, 'EUNSAFEPATH');
    ok((await fs.promises.stat(directoryTarget.file)).isDirectory(), 'directory target untouched');
    const directoryBackup = await fixture();
    await fs.promises.mkdir(directoryBackup.backup);
    await rejected(createProjectSaver(), directoryBackup.file, b, 'EUNSAFEPATH');
    eq(await content(directoryBackup.file), a);

    const collides = await fixture();
    const collision = path.join(collides.dir, '.guangying-save-fixed.tmp');
    await fs.promises.writeFile(collision, 'not-our-temp');
    await rejected(createProjectSaver({ token: () => 'fixed' }), collides.file, b, 'EEXIST');
    eq(await content(collision), 'not-our-temp', 'exclusive-open collision never overwritten/cleaned');
    eq(await content(collides.file), a);

    const invalidTempName = await fixture();
    await rejected(createProjectSaver({ token: () => '../not-safe' }), invalidTempName.file, b, 'ETEMPNAME');
    eq(await content(invalidTempName.file), a);
    await clean(invalidTempName.dir);

    const failsToClean = await fixture();
    const priorFailure = injectedFs({ fault: Object.assign(e => e.method === 'handle.writeFile', { code: 'ENOSPC' }) });
    const cleanupFs = new Proxy(priorFailure.fileSystem, {
      get(target, key) {
        if (key === 'unlink') return async () => { throw error('EACCES'); };
        return target[key];
      },
    });
    await rejected(createProjectSaver({ fileSystem: cleanupFs }), failsToClean.file, b, 'ENOSPC');
    eq(await content(failsToClean.file), a, 'cleanup failure cannot discard original');
    eq((await fs.promises.readdir(failsToClean.dir)).filter(name => name.endsWith('.tmp')).length, 1, 'failed cleanup can leave only this invocation-owned temporary file');

    const zeroWrite = await fixture();
    const zeroIo = new Proxy(fs.promises, {
      get(target, key) {
        if (key !== 'open') return target[key];
        return async (...args) => {
          const handle = await target.open(...args);
          if (!String(args[0]).includes('.guangying-backup-')) return handle;
          return new Proxy(handle, {
            get(h, method) {
              if (method === 'write') return async () => ({ bytesWritten: 0 });
              return typeof h[method] === 'function' ? h[method].bind(h) : h[method];
            },
          });
        };
      },
    });
    await rejected(createProjectSaver({ fileSystem: zeroIo }), zeroWrite.file, b, 'EIO');
    eq(await content(zeroWrite.file), a, 'zero-length partial write stops rather than spinning forever');
    await clean(zeroWrite.dir);

    const external = await fixture();
    let changed = false;
    const externalIo = injectedFs({ onEvent(e) {
      if (!changed && e.method === 'handle.sync' && e.file.includes('.guangying-save-')) {
        fs.writeFileSync(external.file, 'synthetic-external-writer');
        changed = true;
      }
    } });
    await rejected(createProjectSaver({ fileSystem: externalIo.fileSystem }), external.file, b, 'ECONCURRENT');
    eq(await content(external.file), 'synthetic-external-writer', 'detected external changes not overwritten');
    await clean(external.dir);

    for (const code of ['EINVAL', 'EIO']) {
      const syncWarning = await fixture();
      // Inject at directory open: Windows can reject directory handles before
      // .sync() is reachable. This still exercises the real post-commit result.
      const syncIo = injectedFs({ fault: Object.assign(e => e.method === 'open' && e.file === syncWarning.dir, { code }) });
      const result = await createProjectSaver({ fileSystem: syncIo.fileSystem })(syncWarning.file, b);
      eq(await content(syncWarning.file), b, 'post-commit directory sync does not masquerade as failed save');
      eq(await content(syncWarning.backup), a);
      eq(result.directorySynced, false);
      eq(result.durabilityWarning, code === 'EINVAL' ? 'directory-sync-unavailable' : 'directory-sync-EIO');
      ok(syncIo.faultUsed(), 'the intended post-commit directory failure was reached');
    }

    const invalid = await fixture();
    await rejected(createProjectSaver(), invalid.file, { text: 'synthetic' }, 'EINVAL');
    await rejected(createProjectSaver(), path.join(invalid.dir, 'not-project.pdf'), b, 'EFORMAT');
    eq(await content(invalid.file), a);
    await clean(invalid.dir);
    console.log(`project-save: ${checks} assertions passed (synthetic real IO + failure injection; no Electron dialog test)`);
  } finally {
    // Exactly the mkdtemp-owned synthetic directory; never app/user files.
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
