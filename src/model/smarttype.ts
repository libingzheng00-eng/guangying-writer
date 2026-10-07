import type { ScriptElement, ScriptProject } from './types';
import { COMMON_SHOTS, COMMON_TRANSITIONS } from './elements';
import { stripSceneNumber } from '../utils/text';
import { searchText } from './search';

/** SmartType is a read-only, current-project vocabulary. It never changes typing flow. */
export interface SmartTypeCatalog {
  characters: string[];
  extensions: string[];
  intros: string[];
  locations: string[];
  times: string[];
  transitions: string[];
  shots: string[];
  /** Safe whole-heading fallback when a field boundary cannot be established. */
  headings: string[];
}

export type SmartTypeKind = 'character' | 'extension' | 'intro' | 'location' | 'time'
  | 'scene_heading' | 'transition' | 'shot';

export interface SmartTypeItem {
  label: string;
  /** Plain text for just start..end, not HTML and not an unrelated whole line. */
  value: string;
  /** Caret within the replacement; defaults to value.length. */
  caret?: number;
  /** Append on field acceptance if not already present. Never used by Enter. */
  separator?: string;
}

/** Item alias kept explicit for Editor consumers. */
export type SmartTypeSuggestion = SmartTypeItem;

export interface SmartTypeSuggestions {
  kind: SmartTypeKind;
  query: string;
  /** UTF-16 offsets in the same text/BR projection as the editing DOM. */
  start: number;
  end: number;
  items: SmartTypeItem[];
}

const DEFAULT_INTROS = ['内景', '外景', '内/外景', 'INT.', 'EXT.', 'INT./EXT.', 'I/E.'];
const DEFAULT_TIMES = ['日', '夜', '清晨', '早晨', '上午', '中午', '下午', '午后', '傍晚', '黄昏',
  '深夜', '凌晨', '白天', '夜晚', '雨夜', '晨', '晚', '同一时刻', '同样时刻', '同一时间',
  '同样时间', '同日', '当日', '次日', '翌日', '连续', '稍后',
  'DAY', 'NIGHT', 'DAWN', 'DUSK', 'MORNING', 'AFTERNOON', 'EVENING', 'LATER', 'CONTINUOUS', 'SAME TIME'];
const DEFAULT_EXTENSIONS = ['V.O.', 'O.S.', 'O.C.', '画外音', '旁白', '电话声', '画外'];
const ENGLISH_TRANSITIONS = ['CUT TO:', 'DISSOLVE TO:', 'FADE IN:', 'FADE OUT.', 'MATCH CUT TO:', 'SMASH CUT TO:'];
const ENGLISH_SHOTS = ['CLOSE UP', 'WIDE SHOT', 'ANGLE ON', 'INSERT', 'POV', 'TRACKING SHOT'];
const DELIMITER = /[\s\u00a0·・\-－—–:：]/;
const LEADING_DELIMITERS = /^[\s\u00a0·・\-－—–:：]+/;
// Match only an actual setting token followed by a separator/end, not 内心/INTELLIGENCE.
const INTRO = /^(内\s*\/\s*外景|外\s*\/\s*内景|内外景|外内景|内\s*\/\s*外|外\s*\/\s*内|内景|外景|内外|外内|内|外|INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|E\/I\.?|INT\.?|EXT\.?)(?=$|[\s\u00a0·・\-－—–:：])/i;
/** Store updates replace only the edited element; never re-project all unchanged HTML. */
const projectionCache = new WeakMap<ScriptElement, { source: string; text: string }>();
function elementText(element: ScriptElement): string {
  const cached = projectionCache.get(element);
  if (cached?.source === element.text) return cached.text;
  const text = searchText(element.text);
  projectionCache.set(element, { source: element.text, text });
  return text;
}
const key = (value: string) => value.trim().toLocaleLowerCase();
const unique = (values: readonly string[]) => {
  const seen = new Set<string>();
  return values.map(value => value.trim()).filter(value => {
    const normalized = key(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

/** Keep original indices; never normalize whitespace before calculating replacements. */
function headingStart(text: string): number {
  const unnumbered = stripSceneNumber(text);
  return text.length - unnumbered.length + (unnumbered.match(/^\s*/)?.[0].length || 0);
}

function trailingTime(text: string, from: number, times: readonly string[]) {
  const trimmedEnd = text.trimEnd().length;
  for (const time of [...times].sort((a, b) => b.length - a.length)) {
    const start = trimmedEnd - time.length;
    if (start <= from || !DELIMITER.test(text[start - 1]) || key(text.slice(start, trimmedEnd)) !== key(time)) continue;
    // Remove only delimiters immediately preceding the known time. Internal location dashes stay intact.
    let locationEnd = start;
    while (locationEnd > from && DELIMITER.test(text[locationEnd - 1])) locationEnd--;
    if (locationEnd > from) return { start, end: trimmedEnd, locationEnd, time: text.slice(start, trimmedEnd) };
  }
  return null;
}

/** Build from complete current project elements, optionally omitting the editing line. */
export function buildSmartTypeCatalog(
  project: Pick<ScriptProject, 'elements'>,
  activeId?: string,
): SmartTypeCatalog {
  const catalog: SmartTypeCatalog = {
    characters: [], extensions: [...DEFAULT_EXTENSIONS], intros: [...DEFAULT_INTROS],
    locations: [], times: [...DEFAULT_TIMES],
    transitions: [...COMMON_TRANSITIONS, ...ENGLISH_TRANSITIONS],
    shots: [...COMMON_SHOTS, ...ENGLISH_SHOTS], headings: [],
  };
  for (const element of project.elements) {
    if (element.id === activeId) continue;
    // Actions/dialogue/notes are not a vocabulary source. Avoid even creating their DOM projections.
    if (!['character', 'scene_heading', 'transition', 'shot'].includes(element.type)) continue;
    const text = elementText(element).trim();
    if (!text || text.includes('\n')) continue;
    if (element.type === 'character') {
      const extensions = [...text.matchAll(/[（(]([^）)]*)[）)]/g)];
      const name = text.replace(/\s*[（(][^）)]*[）)]/g, '').replace(/[:：]\s*$/, '').trim();
      if (name) catalog.characters.push(name);
      for (const match of extensions) {
        const extension = match[1].trim();
        if (extension && extension.length <= 24 && !/CONT\s*['’]?\s*D/i.test(extension)) catalog.extensions.push(extension);
      }
    } else if (element.type === 'scene_heading') {
      const body = text.slice(headingStart(text));
      catalog.headings.push(body);
      const intro = INTRO.exec(body);
      if (!intro) continue;
      catalog.intros.push(intro[0]);
      const locationStart = intro[0].length + (body.slice(intro[0].length).match(LEADING_DELIMITERS)?.[0].length || 0);
      if (locationStart === body.length) continue;
      const tail = trailingTime(body, locationStart, catalog.times);
      const location = body.slice(locationStart, tail ? tail.locationEnd : body.length).trim();
      // Without a known time token, multiple fields are ambiguous: keep only whole-heading fallback.
      if (location && (tail || ![...location].some(char => DELIMITER.test(char)))) catalog.locations.push(location);
      if (tail) catalog.times.push(tail.time);
    } else if (element.type === 'transition') catalog.transitions.push(text);
    else if (element.type === 'shot') catalog.shots.push(text);
  }
  for (const field of Object.keys(catalog) as (keyof SmartTypeCatalog)[]) catalog[field] = unique(catalog[field]);
  return catalog;
}

/** One-result, document-local reader. Cheap source signatures still inspect the
 * current array, but action/dialogue edits do not parse/deduplicate a vocabulary
 * again. Compare actual source fields (not only object identity), preserve order
 * and active-line exclusion, and reset on the caller's document epoch. No catalog
 * is persisted or retained globally across documents.
 */
export function createSmartTypeCatalogReader() {
  type Source = { id: string; type: ScriptElement['type']; text: string };
  let previousSources: Source[] | undefined;
  let previousScope: unknown;
  let previousCatalog: SmartTypeCatalog | undefined;
  return (project: Pick<ScriptProject, 'elements'>, activeId?: string, scope?: unknown): SmartTypeCatalog => {
    let sourceIndex = 0;
    let unchanged = previousCatalog !== undefined && previousScope === scope;
    for (const element of project.elements) {
      if (element.id === activeId ||
          (element.type !== 'character' && element.type !== 'scene_heading' &&
           element.type !== 'transition' && element.type !== 'shot')) continue;
      const old = previousSources?.[sourceIndex++];
      if (!old || old.id !== element.id || old.type !== element.type || old.text !== element.text) unchanged = false;
    }
    if (sourceIndex !== previousSources?.length) unchanged = false;
    if (unchanged) return previousCatalog!;
    previousCatalog = buildSmartTypeCatalog(project, activeId);
    previousSources = project.elements.filter(element => element.id !== activeId &&
      (element.type === 'character' || element.type === 'scene_heading' ||
       element.type === 'transition' || element.type === 'shot'))
      .map(element => ({ id: element.id, type: element.type, text: element.text }));
    previousScope = scope;
    return previousCatalog;
  };
}

function candidates(
  kind: SmartTypeKind,
  text: string,
  start: number,
  end: number,
  pool: readonly string[],
  options: { separator?: string; suffix?: string; closing?: string } = {},
): SmartTypeSuggestions | null {
  const query = text.slice(start, end).trim();
  const normalized = key(query);
  const values = unique(pool);
  const exact = normalized ? values.find(value => key(value) === normalized) : undefined;
  // A complete, known field must not be silently expanded on Enter (夜 → 夜晚, AL → ALICE).
  // The only exception is an unfinished qualifier whose matching closing bracket is still missing.
  if (exact && !options.closing) return null;
  const items = (exact ? [exact] : values.filter(value => key(value).startsWith(normalized) && key(value) !== normalized))
    .slice(0, 8).map(value => ({
      label: value,
      value: value + (options.closing || '') + (options.suffix || ''),
      ...(options.separator ? { separator: options.separator } : {}),
    }));
  return items.length ? { kind, query, start, end, items } : null;
}

function characterSuggestions(text: string, catalog: SmartTypeCatalog): SmartTypeSuggestions | null {
  const open = /([（(])([^）)]*)$/.exec(text);
  if (open) {
    return candidates('extension', text, open.index + 1, text.length, catalog.extensions,
      { closing: open[1] === '（' ? '）' : ')' });
  }
  const start = text.match(/^\s*/)?.[0].length || 0;
  const suffixStart = text.search(/\s*[（(]/);
  if (suffixStart < 0) return candidates('character', text, start, text.length, catalog.characters);
  // A completed qualifier is not a reason to replace/drop it when completing a name.
  if (!/^(?:\s*[（(][^）)]*[）)])+\s*$/.test(text.slice(suffixStart))) return null;
  const suggestion = candidates('character', text, start, suffixStart, catalog.characters,
    { suffix: text.slice(suffixStart) });
  return suggestion ? { ...suggestion, end: text.length } : null;
}

function sceneSuggestions(text: string, catalog: SmartTypeCatalog): SmartTypeSuggestions | null {
  const start = headingStart(text);
  const body = text.slice(start);
  const fallback = () => candidates('scene_heading', text, start, text.length, catalog.headings);
  const intro = INTRO.exec(body);
  if (!intro) {
    return candidates('intro', text, start, text.length, catalog.intros, { separator: ' ' }) || fallback();
  }
  const introEnd = start + intro[0].length;
  const delimiters = text.slice(introEnd).match(LEADING_DELIMITERS)?.[0] || '';
  if (!delimiters) return candidates('intro', text, start, introEnd, catalog.intros, { separator: ' ' });
  const locationStart = introEnd + delimiters.length;
  if (locationStart === text.length) return candidates('location', text, locationStart, text.length, catalog.locations, { separator: ' ' });
  const tail = trailingTime(text, locationStart, catalog.times);
  if (tail) return candidates('time', text, tail.start, text.length, catalog.times);
  // A known complete location followed by a separator gives an unambiguous time slot.
  // Do not split an unfamiliar location on its internal spaces or hyphens.
  const remainder = text.slice(locationStart);
  for (const location of [...catalog.locations].sort((a, b) => b.length - a.length)) {
    if (key(remainder.slice(0, location.length)) !== key(location)) continue;
    const gap = remainder.slice(location.length).match(LEADING_DELIMITERS)?.[0];
    if (!gap) continue;
    const timeStart = locationStart + location.length + gap.length;
    const query = key(text.slice(timeStart));
    if (!query || catalog.times.some(time => key(time).startsWith(query))) {
      return candidates('time', text, timeStart, text.length, catalog.times);
    }
    // A longer, known location can share a shorter location's prefix.
  }
  if (catalog.locations.some(location => key(location) === key(remainder))) return null;
  return candidates('location', text, locationStart, text.length, catalog.locations, { separator: ' ' }) || fallback();
}

/**
 * Query only at the paragraph end. Editor additionally requires a collapsed selection,
 * ignores composition/modifier keys, and owns Escape/acceptance. Tab is never acceptance.
 * Empty-field results are available for explicit/focus-triggered menus, not auto-insertion.
 */
export function getSmartTypeSuggestions(
  element: ScriptElement,
  caretOffset: number,
  catalog: SmartTypeCatalog,
): SmartTypeSuggestions | null {
  const text = elementText(element);
  if (caretOffset !== text.length || text.includes('\n')) return null;
  if (element.type === 'character') return characterSuggestions(text, catalog);
  if (element.type === 'scene_heading') return sceneSuggestions(text, catalog);
  const start = text.match(/^\s*/)?.[0].length || 0;
  if (element.type === 'transition') return candidates('transition', text, start, text.length, catalog.transitions);
  if (element.type === 'shot') return candidates('shot', text, start, text.length, catalog.shots);
  return null;
}
