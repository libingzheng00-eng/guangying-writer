import type { ScriptProject } from '../model/types';

interface AutosaveState {
  version: number;
  project: ScriptProject;
  filePath: string | null;
  documentEpoch?: number;
}

interface AutosaveStore {
  getState: () => AutosaveState;
  subscribe: (listener: (state: AutosaveState, previous: AutosaveState) => void) => () => void;
}

/** Subscribe outside React rendering: typing must not rerender the entire App
 * just to reset a timer. Keep the existing 900ms trailing save and read the latest
 * project/path at execution time (not a captured, potentially stale snapshot).
 * One timer also enforces a 30s upper bound during continuous typing. This is
 * recovery storage, never evidence that the .zhsp file has been saved.
 */
export function subscribeAutosave(
  store: AutosaveStore,
  write: (saved: { project: ScriptProject; filePath: string | null }) => void | boolean,
  // Browser timer functions must be called as globals, not as methods on `clock`.
  clock: {
    set: (fn: () => void, delay?: number) => ReturnType<typeof setTimeout>;
    clear: (timer: ReturnType<typeof setTimeout>) => void;
    now?: () => number;
  } = {
    set: (fn: () => void, delay = 900) => setTimeout(fn, delay),
    clear: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    now: () => performance.now(),
  },
  onPending: () => void = () => {},
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startedAt: number | undefined;
  let lastWriteSucceeded = true;
  let stopped = false;
  const now = () => typeof clock.now === 'function' ? clock.now() : Date.now();
  const flush = () => {
    if (stopped) return lastWriteSucceeded;
    if (timer === undefined && lastWriteSucceeded) return true;
    if (timer !== undefined) clock.clear(timer);
    timer = undefined;
    startedAt = undefined;
    const { project, filePath } = store.getState();
    try { lastWriteSucceeded = write({ project, filePath }) !== false; }
    catch { lastWriteSucceeded = false; }
    return lastWriteSucceeded;
  };
  const schedule = (newDocument = false) => {
    if (stopped) return;
    if (timer !== undefined) clock.clear(timer);
    if (startedAt === undefined || newDocument) startedAt = now();
    const delay = Math.max(0, Math.min(900, 30000 - (now() - startedAt)));
    onPending();
    timer = clock.set(() => {
      // A completed timer no longer covers a later save / save-as association.
      // Clear before writing so a reentrant state update may schedule a new job.
      timer = undefined;
      startedAt = undefined;
      const { project, filePath } = store.getState();
      try { lastWriteSucceeded = write({ project, filePath }) !== false; }
      catch { lastWriteSucceeded = false; }
    }, delay);
  };
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.version !== previous.version) schedule(state.documentEpoch !== previous.documentEpoch);
    else if (state.filePath !== previous.filePath && timer === undefined) schedule();
    // A pending content timer already reads the latest path; do not postpone it
    // for save completion, selection changes, or any other interface update.
  });
  schedule();
  const stop = () => {
    stopped = true;
    unsubscribe();
    if (timer !== undefined) clock.clear(timer);
    timer = undefined;
    startedAt = undefined;
  };
  // Callers explicitly flush on pagehide/beforeunload. Effect cleanup cancels
  // only: React StrictMode cleanup must not write an old document on unmount.
  return Object.assign(stop, { flush });
}
