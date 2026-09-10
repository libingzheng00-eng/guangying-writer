import type { ScriptProject } from '../model/types';

interface AutosaveState {
  version: number;
  project: ScriptProject;
  filePath: string | null;
}

interface AutosaveStore {
  getState: () => AutosaveState;
  subscribe: (listener: (state: AutosaveState, previous: AutosaveState) => void) => () => void;
}

/** Subscribe outside React rendering: typing must not rerender the entire App
 * just to reset a timer. Keep the existing 900ms trailing save and read the latest
 * project/path at execution time (not a captured, potentially stale snapshot).
 */
export function subscribeAutosave(
  store: AutosaveStore,
  write: (saved: { project: ScriptProject; filePath: string | null }) => void,
  // Browser timer functions must be called as globals, not as methods on `clock`.
  clock = {
    set: (fn: () => void) => setTimeout(fn, 900),
    clear: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  },
) {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    clock.clear(timer);
    timer = clock.set(() => {
      const { project, filePath } = store.getState();
      write({ project, filePath });
    });
  };
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.version !== previous.version) schedule();
  });
  schedule();
  return () => {
    unsubscribe();
    clock.clear(timer);
  };
}
