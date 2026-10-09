import type { ScriptProject } from '../model/types';

/** Navigation is application metadata, never part of a project or its history. */
export interface WritingContext {
  version: 1;
  projectId: string;
  view: 'write' | 'cards' | 'board';
  activeId?: string;
  sceneId?: string;
  caret?: number;
  writeScrollTop?: number;
  cardsScrollTop?: number;
  board?: { panX: number; panY: number; zoom: number };
  updatedAt?: number;
}
export const WRITING_CONTEXT_KEY = 'guangying:writing-contexts';
export const MAX_WRITING_CONTEXTS = 32;
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
const MAX_RAW_LENGTH = 256 * 1024;
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512;
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
export const isWritingView = (value: unknown): value is WritingContext['view'] => value === 'write' || value === 'cards' || value === 'board';

/** Whitelist small scalar fields. Malformed optional fields are simply omitted. */
export function validateWritingContext(value: unknown, projectId: string): WritingContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || raw.projectId !== projectId || !id(raw.projectId) || !isWritingView(raw.view)) return null;
  const result: WritingContext = { version: 1, projectId, view: raw.view };
  if (id(raw.activeId)) result.activeId = raw.activeId;
  if (id(raw.sceneId)) result.sceneId = raw.sceneId;
  if (finite(raw.caret, 0, 10000000)) result.caret = Math.floor(raw.caret);
  if (finite(raw.writeScrollTop, 0, 10000000)) result.writeScrollTop = raw.writeScrollTop;
  if (finite(raw.cardsScrollTop, 0, 10000000)) result.cardsScrollTop = raw.cardsScrollTop;
  if (finite(raw.updatedAt, 0, Number.MAX_SAFE_INTEGER)) result.updatedAt = raw.updatedAt;
  const board = raw.board as Record<string, unknown> | null;
  if (board && typeof board === 'object' && !Array.isArray(board) &&
      finite(board.panX, -10000000, 10000000) && finite(board.panY, -10000000, 10000000) && finite(board.zoom, .4, 2)) {
    result.board = { panX: board.panX, panY: board.panY, zoom: board.zoom };
  }
  return result;
}

/** Validate document IDs once at a load boundary, never on caret movement. */
export function resolveWritingContext(project: ScriptProject, value?: unknown): WritingContext {
  const parsed = validateWritingContext(value, project.id);
  const context: WritingContext = parsed || { version: 1, projectId: project.id, view: 'write' };
  const elements = new Map(project.elements.map(element => [element.id, element]));
  let scene = context.sceneId && elements.get(context.sceneId)?.type === 'scene_heading' ? context.sceneId : undefined;
  const active = context.activeId && elements.has(context.activeId) ? context.activeId : undefined;
  if (active && context.view === 'write') {
    let preceding: string | undefined;
    for (const element of project.elements) {
      if (element.type === 'scene_heading') preceding = element.id;
      if (element.id === active) { scene = preceding; break; }
    }
  }
  const fallback = active || scene || project.elements[0]?.id;
  const result = { ...context, activeId: fallback, sceneId: scene };
  if (!active) delete result.caret;
  // A removed paragraph's old absolute scroll may point into a different scene.
  // Let the surviving scene/first paragraph anchor the fallback instead.
  if (context.activeId && !active) delete result.writeScrollTop;
  return result;
}

interface Entry { filePath: string | null; context: WritingContext }
const validPath = (value: unknown): value is string | null => value === null || (typeof value === 'string' && value.length > 0 && value.length <= 4096);
function entries(storage: StoragePort): Entry[] {
  try {
    const raw = storage.getItem(WRITING_CONTEXT_KEY);
    if (!raw || raw.length > MAX_RAW_LENGTH) return [];
    const decoded = JSON.parse(raw);
    if (!decoded || decoded.version !== 1 || !Array.isArray(decoded.entries)) return [];
    return decoded.entries.slice(-MAX_WRITING_CONTEXTS).flatMap((entry: unknown): Entry[] => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Entry;
      const context = validateWritingContext(item.context, item.context?.projectId);
      return validPath(item.filePath) && context ? [{ filePath: item.filePath, context }] : [];
    });
  } catch { return []; }
}

/** Exact path + document ID; filenames and IDs alone never identify disk files. */
export function readWritingContext(storage: StoragePort, projectId: string, filePath: string | null): WritingContext | null {
  return entries(storage).reverse().find(entry => entry.filePath === filePath && entry.context.projectId === projectId)?.context || null;
}
export function writeWritingContext(storage: StoragePort, value: WritingContext, filePath: string | null): void {
  const context = validateWritingContext(value, value.projectId);
  if (!context || !validPath(filePath)) return;
  const retained = entries(storage).filter(entry => entry.filePath !== filePath || entry.context.projectId !== context.projectId);
  retained.push({ filePath, context });
  const bounded = retained.slice(-MAX_WRITING_CONTEXTS);
  let raw = JSON.stringify({ version: 1, entries: bounded });
  while (raw.length > MAX_RAW_LENGTH && bounded.length > 1) {
    bounded.shift();
    raw = JSON.stringify({ version: 1, entries: bounded });
  }
  storage.setItem(WRITING_CONTEXT_KEY, raw);
}
export function loadStoredWritingContext(projectId: string, filePath: string | null): WritingContext | null {
  try { return readWritingContext(localStorage, projectId, filePath); } catch { return null; }
}

interface ContextState {
  documentEpoch?: number;
  filePath: string | null;
  writingContext?: WritingContext | null;
  pdfExportMode?: 'creative' | 'print' | null;
}
interface ContextStore {
  getState: () => ContextState;
  subscribe: (listener: (state: ContextState, previous: ContextState) => void) => () => void;
}
/** Activate only after a user has entered a document. Small metadata has its
 * own timer so scrolling never serializes an image-heavy recovery snapshot.
 * The caller flushes before closing, going home or replacing a document.
 */
export function subscribeWritingContextPersistence(
  store: ContextStore,
  getStorage: () => StoragePort = () => localStorage,
  clock = { set: (fn: () => void, delay: number) => setTimeout(fn, delay), clear: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer) },
  onError: () => void = () => {},
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let pending = true;
  let lastWriteSucceeded = true;
  let errorReported = false;
  const persist = (state: ContextState) => {
    if (!state.writingContext) return true;
    try { writeWritingContext(getStorage(), state.writingContext, state.filePath); errorReported = false; return true; }
    catch {
      if (!errorReported) { errorReported = true; onError(); }
      return false;
    }
  };
  const flush = () => {
    if (stopped) return lastWriteSucceeded;
    if (timer !== undefined) clock.clear(timer);
    timer = undefined;
    if (pending || !lastWriteSucceeded) lastWriteSucceeded = persist(store.getState());
    pending = !lastWriteSucceeded;
    return lastWriteSucceeded;
  };
  const schedule = () => {
    pending = true;
    // Fixed trailing window, rather than postponing forever during scrolling.
    if (timer === undefined) timer = clock.set(flush, 350);
  };
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.documentEpoch !== previous.documentEpoch) {
      // Also protect callers that replace a project synchronously before React
      // has had an opportunity to clean up its previous subscription.
      persist(previous);
    }
    if (state.writingContext !== previous.writingContext || state.filePath !== previous.filePath || state.documentEpoch !== previous.documentEpoch) schedule();
  });
  schedule();
  return Object.assign(() => {
    stopped = true; unsubscribe();
    if (timer !== undefined) clock.clear(timer);
    timer = undefined;
  }, { flush });
}
