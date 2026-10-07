import { parseProject } from '../io/zhsp';
import type { ScriptProject } from '../model/types';

export const AUTOSAVE_KEY = 'guangying:autosave';
export const LEGACY_AUTOSAVE_KEY = 'mojiang:autosave';
// Only used to protect an unreadable recovery payload before replacing it.
// Never delete or overwrite a different payload already protected here.
export const UNREADABLE_AUTOSAVE_KEY = 'guangying:autosave:unreadable';
export interface RecoverySnapshot { project: ScriptProject; filePath: string | null }
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;

function decode(raw: string): RecoverySnapshot {
  const saved = JSON.parse(raw);
  if (!saved || typeof saved.project !== 'object' || !saved.project || !Array.isArray(saved.project.elements)) {
    throw new Error('Invalid recovery snapshot');
  }
  return { project: parseProject(raw),
    filePath: typeof saved.filePath === 'string' && saved.filePath ? saved.filePath : null };
}

/** Reading/restoring must not depend on a later migration write succeeding. */
export function readRecovery(storage: StoragePort): {
  snapshot: RecoverySnapshot | null;
  source: 'current' | 'legacy' | null;
  warning: string | null;
} {
  let unreadable = false;
  let unavailable = false;
  for (const [key, source] of [[AUTOSAVE_KEY, 'current'], [LEGACY_AUTOSAVE_KEY, 'legacy']] as const) {
    let raw: string | null;
    try { raw = storage.getItem(key); }
    catch { unavailable = true; continue; }
    if (!raw) continue;
    try {
      return { snapshot: decode(raw), source, warning: unreadable || unavailable
        ? '已从备用恢复点恢复；原恢复点读取异常，未删除。请另存工程文件。' : null };
    } catch { unreadable = true; }
  }
  return { snapshot: null, source: null, warning: unavailable
    ? '无法读取自动恢复存储。请手动保存工程文件。'
    : unreadable ? '自动恢复点无法解析，原数据仍保留。请打开已保存的工程文件。' : null };
}

/** localStorage.setItem replaces a value atomically; a failed write must leave
 * the previous recovery point intact. No second full-image copy for normal saves.
 */
export function createRecoveryWriter(getStorage: () => StoragePort) {
  // One result only; do not retain a sequence of image-heavy serialized drafts.
  let validatedRaw: string | null = null;
  return (snapshot: RecoverySnapshot): void => {
    const next = JSON.stringify(snapshot);
    const storage = getStorage();
    const current = storage.getItem(AUTOSAVE_KEY);
    if (current && current !== validatedRaw) {
      let invalid = false;
      try {
        const envelope = JSON.parse(current);
        invalid = !envelope?.project || typeof envelope.project !== 'object' || !Array.isArray(envelope.project.elements);
      } catch { invalid = true; }
      if (invalid) {
        const protectedRaw = storage.getItem(UNREADABLE_AUTOSAVE_KEY);
        if (protectedRaw !== null && protectedRaw !== current) throw new Error('Unreadable recovery already protected');
        if (protectedRaw === null) storage.setItem(UNREADABLE_AUTOSAVE_KEY, current);
        // If protection fails (quota/permissions), do NOT replace the original.
      }
    }
    storage.setItem(AUTOSAVE_KEY, next);
    validatedRaw = next;
  };
}

export function writeRecovery(storage: StoragePort, snapshot: RecoverySnapshot): void {
  createRecoveryWriter(() => storage)(snapshot);
}

export function recoveryErrorMessage(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  return name === 'QuotaExceededError'
    ? '自动恢复空间不足，请立即保存或另存为工程文件。'
    : '自动恢复点保存失败，请手动保存或另存为工程文件。';
}
