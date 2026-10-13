import type { ScriptElement } from '../model/types';
import { searchText } from '../model/search';

/** Reader navigation is application metadata, never screenplay or writing state. */
export interface CharacterReadingBookmark {
  version: 1;
  projectId: string;
  characterKey?: string;
  /** The scene heading element ID, not SceneMeta.id or a displayed scene number. */
  sceneId?: string;
  /** Stable first element of the visible reading chunk. */
  elementId?: string;
  scrollTop?: number;
  mode?: 'scene' | 'dialogue';
  filter?: 'all' | 'speaking' | 'present' | 'mentioned' | 'uncertain';
  includeOmitted?: boolean;
  query?: string;
  updatedAt?: number;
}

export const CHARACTER_READING_BOOKMARKS_KEY = 'guangying:character-reading-bookmarks';
export const MAX_CHARACTER_READING_BOOKMARKS = 32;
export const MAX_CHARACTER_READING_BYTES = 256 * 1024;
export type CharacterNavigationStorage = Pick<Storage, 'getItem' | 'setItem'>;

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 && !!value.trim();
const validPath = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && value.length > 0 && value.length <= 4096);
const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Only own data fields are read; callers cannot persist getters or toJSON hooks. */
function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return null;
    result[key] = descriptor.value;
  }
  return result;
}

/** Whitelist bounded scalar fields; malformed optional fields are discarded. */
export function parseCharacterReadingBookmark(value: unknown, projectId: string): CharacterReadingBookmark | null {
  try {
    const raw = record(value);
    if (!raw || raw.version !== 1 || !validId(projectId) || raw.projectId !== projectId) return null;
    const bookmark: CharacterReadingBookmark = { version: 1, projectId };
    for (const field of ['characterKey', 'sceneId', 'elementId'] as const) {
      if (validId(raw[field])) bookmark[field] = raw[field];
    }
    if (typeof raw.scrollTop === 'number' && Number.isFinite(raw.scrollTop) && raw.scrollTop >= 0 && raw.scrollTop <= 10_000_000) bookmark.scrollTop = raw.scrollTop;
    if (raw.mode === 'scene' || raw.mode === 'dialogue') bookmark.mode = raw.mode;
    if (raw.filter === 'all' || raw.filter === 'speaking' || raw.filter === 'present' || raw.filter === 'mentioned' || raw.filter === 'uncertain') bookmark.filter = raw.filter;
    if (typeof raw.includeOmitted === 'boolean') bookmark.includeOmitted = raw.includeOmitted;
    if (typeof raw.query === 'string' && raw.query.length <= 500) bookmark.query = raw.query;
    if (nonnegativeInteger(raw.updatedAt)) bookmark.updatedAt = raw.updatedAt;
    return bookmark;
  } catch { return null; }
}

interface BookmarkEntry { filePath: string | null; bookmark: CharacterReadingBookmark }
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

function readEntries(storage: CharacterNavigationStorage): BookmarkEntry[] {
  // A storage read failure must reach save's catch rather than overwrite old data.
  const raw = storage.getItem(CHARACTER_READING_BOOKMARKS_KEY);
  if (!raw || raw.length > MAX_CHARACTER_READING_BYTES || byteLength(raw) > MAX_CHARACTER_READING_BYTES) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const envelope = record(parsed);
  if (!envelope || envelope.version !== 1 || !Array.isArray(envelope.entries)) return [];
  const entries: BookmarkEntry[] = [];
  for (const value of envelope.entries.slice(-MAX_CHARACTER_READING_BOOKMARKS)) {
    const entry = record(value);
    const data = entry && record(entry.bookmark);
    const bookmark = data && validId(data.projectId) ? parseCharacterReadingBookmark(data, data.projectId) : null;
    if (entry && validPath(entry.filePath) && bookmark) entries.push({ filePath: entry.filePath, bookmark });
  }
  return entries;
}

/** Exact path + project ID; no filename matching, path normalization or migration. */
export function loadCharacterReadingBookmark(
  projectId: string,
  filePath: string | null,
  storage?: CharacterNavigationStorage,
): CharacterReadingBookmark | null {
  if (!validId(projectId) || !validPath(filePath)) return null;
  try {
    return readEntries(storage ?? localStorage).reverse()
      .find(entry => entry.filePath === filePath && entry.bookmark.projectId === projectId)?.bookmark ?? null;
  } catch { return null; }
}

/** Bounded oldest-first eviction applies only to disposable reader metadata. */
export function saveCharacterReadingBookmark(
  value: CharacterReadingBookmark,
  filePath: string | null,
  storage?: CharacterNavigationStorage,
): boolean {
  try {
    const data = record(value);
    const bookmark = data && validId(data.projectId) ? parseCharacterReadingBookmark(data, data.projectId) : null;
    if (!bookmark || !validPath(filePath)) return false;
    const target = storage ?? localStorage;
    const entries = readEntries(target).filter(entry => entry.filePath !== filePath || entry.bookmark.projectId !== bookmark.projectId);
    entries.push({ filePath, bookmark });
    const bounded = entries.slice(-MAX_CHARACTER_READING_BOOKMARKS);
    let raw = JSON.stringify({ version: 1, entries: bounded });
    while (byteLength(raw) > MAX_CHARACTER_READING_BYTES && bounded.length > 1) {
      bounded.shift();
      raw = JSON.stringify({ version: 1, entries: bounded });
    }
    if (byteLength(raw) > MAX_CHARACTER_READING_BYTES) return false;
    target.setItem(CHARACTER_READING_BOOKMARKS_KEY, raw);
    return true;
  } catch { return false; }
}

/** Transient source evidence, never stored in a reading bookmark or project. */
export interface CharacterSourceTarget {
  documentEpoch: number;
  elementId: string;
  /** UTF-16 offsets, BR=1, end exclusive; equal endpoints mean a caret. */
  start: number;
  end: number;
  sourceText: string;
}

export type CharacterSourceValidation =
  | { ok: true; target: CharacterSourceTarget }
  | { ok: false; reason: 'stale-document' | 'missing-element' | 'changed-source' | 'invalid-range' };

function textBoundary(text: string, value: unknown): value is number {
  if (!nonnegativeInteger(value) || value > text.length) return false;
  return !(value > 0 && value < text.length &&
    /[\uD800-\uDBFF]/.test(text[value - 1]) && /[\uDC00-\uDFFF]/.test(text[value]));
}

function readSourceTarget(value: unknown): CharacterSourceTarget | null {
  const raw = record(value);
  if (!raw || !nonnegativeInteger(raw.documentEpoch) || !validId(raw.elementId) || typeof raw.sourceText !== 'string' ||
      !textBoundary(raw.sourceText, raw.start) || !textBoundary(raw.sourceText, raw.end) || raw.end < raw.start) return null;
  return { documentEpoch: raw.documentEpoch, elementId: raw.elementId, start: raw.start, end: raw.end, sourceText: raw.sourceText };
}

export function captureCharacterSourceTarget(
  element: ScriptElement,
  documentEpoch: number,
  start = 0,
  end = start,
): CharacterSourceTarget | null {
  try {
    return readSourceTarget({ documentEpoch, elementId: element.id, start, end, sourceText: searchText(element.text) });
  } catch { return null; }
}

/** Revalidate immediately before focus/selection. Never search for matching text
 * elsewhere, clamp stale offsets, change the view or mutate application state.
 */
export function validateCharacterSourceTarget(
  value: CharacterSourceTarget,
  state: { documentEpoch: number; project: { elements: readonly ScriptElement[] } },
): CharacterSourceValidation {
  try {
    const target = readSourceTarget(value);
    if (!target || !nonnegativeInteger(state.documentEpoch)) return { ok: false, reason: 'invalid-range' };
    if (target.documentEpoch !== state.documentEpoch) return { ok: false, reason: 'stale-document' };
    let found: ScriptElement | undefined;
    for (const element of state.project.elements) {
      if (element.id !== target.elementId) continue;
      // Duplicate IDs are just as unsafe to navigate as a missing element.
      if (found) return { ok: false, reason: 'missing-element' };
      found = element;
    }
    if (!found) return { ok: false, reason: 'missing-element' };
    if (searchText(found.text) !== target.sourceText) return { ok: false, reason: 'changed-source' };
    return { ok: true, target };
  } catch { return { ok: false, reason: 'invalid-range' }; }
}
