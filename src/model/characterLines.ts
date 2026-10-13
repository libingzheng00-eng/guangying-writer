import type { ElementType, ScriptElement, ScriptProject } from './types';
import { ELEMENT_ORDER } from './elements';
import { deriveScenes } from './project';
import { searchText } from './search';

/** Author-owned metadata only. Automatic reading projections never enter this branch. */
export const CHARACTER_WORKSPACE_LIMITS = Object.freeze({ profiles: 500, aliasesPerProfile: 100,
  overrides: 2000, assignments: 2000, noteLinks: 1000, bytes: 2 * 1024 * 1024,
  name: 200, disambiguation: 500, reason: 2000, sourceText: 200000,
  evidence: 50000, discoveredCharacters: 5000, indexCacheEntries: 4 });
export interface CharacterProfile { id: string; canonicalName: string; aliases: string[]; disambiguation?: string }
export type CharacterClassification = 'present' | 'mentioned' | 'irrelevant' | 'uncertain';
export type CharacterAnchorState = 'current' | 'changed' | 'missing';
export interface CharacterSceneAnchor { kind: 'scene'; sceneHeadingId: string }
export interface CharacterTextAnchor {
  kind: 'text'; elementId: string; sceneHeadingId: string | null; sourceType: ElementType;
  start: number; end: number; quote: string; sourceText: string;
}
export type CharacterAnchor = CharacterSceneAnchor | CharacterTextAnchor;
export interface CharacterOverride {
  id: string; characterId: string; anchor: CharacterAnchor; classification: CharacterClassification;
  anchorState: CharacterAnchorState; reason?: string;
}
export interface CharacterAssignment {
  id: string; characterId: string | null; anchor: CharacterTextAnchor;
  anchorState: CharacterAnchorState; reason?: string;
}
export interface CharacterNoteLink {
  annotationId: string; characterId: string; topic?: 'note' | 'relationship' | 'knowledge'; relatedCharacterId?: string;
}
export interface CharacterWorkspace {
  schema: 1; profiles: CharacterProfile[]; overrides: CharacterOverride[];
  assignments: CharacterAssignment[]; noteLinks: CharacterNoteLink[];
}
export interface CharacterLineCharacter extends CharacterProfile {
  registered: boolean; occurrenceIds: string[]; sceneHeadingIds: string[]; speakingCount: number; mentionCount: number;
}
export interface CharacterLineScene {
  headingId: string; number: string; heading: string; storyTime?: string; omitted: boolean; elementIds: string[];
}
export interface CharacterOccurrence {
  id: string; kind: 'speech' | 'mention' | 'manual'; characterId: string | null; characterIds: string[];
  ambiguous: boolean; sceneHeadingId: string | null; elementId: string; elementIndex: number;
  start: number; end: number; quote: string; sourceText: string; sourceType: ElementType; dialogueElementIds: string[];
  classification: CharacterClassification; source: 'cue' | 'name-match' | 'manual-assignment' | 'manual-override';
  confidence: 'explicit' | 'candidate' | 'manual'; explanation: string; anchor: CharacterAnchor;
  overrideId?: string; assignmentId?: string;
  originalSource?: 'cue' | 'name-match' | 'manual-assignment'; originalExplanation?: string;
}
export interface CharacterLineIndex {
  characters: CharacterLineCharacter[]; scenes: CharacterLineScene[]; occurrences: CharacterOccurrence[];
  scope: { includeOmitted: boolean; notesExcluded: true; truncated: boolean; evidenceLimit: number;
    charactersTruncated: boolean; characterLimit: number };
  staleOverrides: CharacterOverride[]; staleAssignments: CharacterAssignment[];
}

const INVALID = '人物线数据无效或超过容量限制，原稿未修改。';
const elementTypes = new Set<string>(ELEMENT_ORDER);
const reservedIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const states = new Set(['current', 'changed', 'missing']);
const classifications = new Set(['present', 'mentioned', 'irrelevant', 'uncertain']);
const projectedText = new WeakMap<ScriptElement, { html: string; text: string }>();
function elementText(element: ScriptElement): string {
  const cached = projectedText.get(element);
  if (cached?.html === element.text) return cached.text;
  const text = searchText(element.text);
  projectedText.set(element, { html: element.text, text });
  return text;
}
function invalid(): never { throw new Error(INVALID); }
function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) return invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
    result[key] = descriptor.value;
  }
  return result;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum ||
      Reflect.ownKeys(value).length !== value.length + 1) return invalid();
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const slot = Object.getOwnPropertyDescriptor(value, String(i));
    if (!slot || !('value' in slot) || !slot.enumerable) return invalid();
    result.push(slot.value);
  }
  return result;
}
function text(value: unknown, max: number, nonempty = false): string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim())) return invalid();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 512, true);
  if (/[\u0000-\u001f\u007f"'\\<>]/.test(result) || reservedIds.has(result)) return invalid();
  return result;
}
function name(value: unknown): string {
  const result = text(value, CHARACTER_WORKSPACE_LIMITS.name, true);
  if (result.trim() !== result || /[\u0000-\u001f\u007f]/.test(result)) return invalid();
  return result;
}
function unique(values: string[]) { if (new Set(values).size !== values.length) invalid(); }
function boundary(value: string, offset: unknown): offset is number {
  return typeof offset === 'number' && Number.isSafeInteger(offset) && offset >= 0 && offset <= value.length &&
    !(offset > 0 && offset < value.length && /[\uD800-\uDBFF]/.test(value[offset - 1]) && /[\uDC00-\uDFFF]/.test(value[offset]));
}
export function validateCharacterAnchor(value: unknown): CharacterAnchor {
  const item = record(value, ['kind', 'elementId', 'sceneHeadingId', 'sourceType', 'start', 'end', 'quote', 'sourceText']);
  if (item.kind === 'scene') {
    if (Object.keys(item).some(key => key !== 'kind' && key !== 'sceneHeadingId')) return invalid();
    return { kind: 'scene', sceneHeadingId: id(item.sceneHeadingId) };
  }
  if (item.kind !== 'text' || !elementTypes.has(item.sourceType as string) || item.sourceType === 'note') return invalid();
  const sourceText = text(item.sourceText, CHARACTER_WORKSPACE_LIMITS.sourceText);
  const quote = text(item.quote, CHARACTER_WORKSPACE_LIMITS.sourceText);
  if (!boundary(sourceText, item.start) || !boundary(sourceText, item.end) || item.start >= item.end ||
      sourceText.slice(item.start, item.end) !== quote) return invalid();
  return { kind: 'text', elementId: id(item.elementId), sceneHeadingId: item.sceneHeadingId === null ? null : id(item.sceneHeadingId),
    sourceType: item.sourceType as ElementType, start: item.start, end: item.end, quote, sourceText };
}
/** Strict admission without invoking accessors, toJSON hooks, or inherited fields. */
export function parseCharacterWorkspace(value: unknown): CharacterWorkspace | undefined {
  if (value === undefined) return undefined;
  try {
    const item = record(value, ['schema', 'profiles', 'overrides', 'assignments', 'noteLinks']);
    if (item.schema !== 1) return invalid();
    const profiles = array(item.profiles, CHARACTER_WORKSPACE_LIMITS.profiles).map(raw => {
      const profile = record(raw, ['id', 'canonicalName', 'aliases', 'disambiguation']);
      const aliases = array(profile.aliases, CHARACTER_WORKSPACE_LIMITS.aliasesPerProfile).map(name);
      unique(aliases);
      const result: CharacterProfile = { id: id(profile.id), canonicalName: name(profile.canonicalName), aliases };
      if (profile.disambiguation !== undefined) result.disambiguation = text(profile.disambiguation, CHARACTER_WORKSPACE_LIMITS.disambiguation);
      return result;
    });
    unique(profiles.map(profile => profile.id));
    const profileIds = new Set(profiles.map(profile => profile.id));
    const profileId = (value: unknown): string => { const result = id(value); if (!profileIds.has(result)) return invalid(); return result; };
    const overrides = array(item.overrides, CHARACTER_WORKSPACE_LIMITS.overrides).map(raw => {
      const override = record(raw, ['id', 'characterId', 'anchor', 'classification', 'anchorState', 'reason']);
      if (!states.has(override.anchorState as string) || !classifications.has(override.classification as string)) return invalid();
      const result: CharacterOverride = { id: id(override.id), characterId: profileId(override.characterId),
        anchor: validateCharacterAnchor(override.anchor), classification: override.classification as CharacterClassification,
        anchorState: override.anchorState as CharacterAnchorState };
      if (override.reason !== undefined) result.reason = text(override.reason, CHARACTER_WORKSPACE_LIMITS.reason);
      return result;
    });
    const assignments = array(item.assignments, CHARACTER_WORKSPACE_LIMITS.assignments).map(raw => {
      const assignment = record(raw, ['id', 'characterId', 'anchor', 'anchorState', 'reason']);
      const anchor = validateCharacterAnchor(assignment.anchor);
      if (!states.has(assignment.anchorState as string) || anchor.kind !== 'text' ||
          !['character', 'dialogue'].includes(anchor.sourceType) || anchor.start !== 0 || anchor.end !== anchor.sourceText.length) return invalid();
      const result: CharacterAssignment = { id: id(assignment.id), characterId: assignment.characterId === null ? null : profileId(assignment.characterId),
        anchor, anchorState: assignment.anchorState as CharacterAnchorState };
      if (assignment.reason !== undefined) result.reason = text(assignment.reason, CHARACTER_WORKSPACE_LIMITS.reason);
      return result;
    });
    const noteLinks = array(item.noteLinks, CHARACTER_WORKSPACE_LIMITS.noteLinks).map(raw => {
      const link = record(raw, ['annotationId', 'characterId', 'topic', 'relatedCharacterId']);
      const result: CharacterNoteLink = { annotationId: id(link.annotationId), characterId: profileId(link.characterId) };
      if (link.topic !== undefined) {
        if (!['note', 'relationship', 'knowledge'].includes(link.topic as string)) return invalid();
        result.topic = link.topic as CharacterNoteLink['topic'];
      }
      if (link.relatedCharacterId !== undefined) result.relatedCharacterId = profileId(link.relatedCharacterId);
      return result;
    });
    unique([...overrides, ...assignments].map(entry => entry.id));
    unique(overrides.filter(entry => entry.anchorState === 'current').map(entry => JSON.stringify([entry.characterId, entry.anchor])));
    unique(assignments.filter(entry => entry.anchorState === 'current').map(entry => entry.anchor.elementId));
    unique(noteLinks.map(link => JSON.stringify([link.annotationId, link.characterId])));
    const result: CharacterWorkspace = { schema: 1, profiles, overrides, assignments, noteLinks };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > CHARACTER_WORKSPACE_LIMITS.bytes) return invalid();
    return result;
  } catch { return invalid(); }
}

type AnchorProject = Pick<ScriptProject, 'elements'>;
type ReconcileProject = Pick<ScriptProject, 'elements' | 'annotations'>;
function contextFor(elements: readonly ScriptElement[]) {
  const byId = new Map<string, ScriptElement>();
  const sceneFor = new Map<string, string | null>();
  let sceneId: string | null = null;
  for (const element of elements) {
    if (element.type === 'scene_heading') sceneId = element.id;
    byId.set(element.id, element); sceneFor.set(element.id, sceneId);
  }
  return { byId, sceneFor };
}
type Context = ReturnType<typeof contextFor>;
function anchorState(anchor: CharacterAnchor, context: Context): CharacterAnchorState {
  if (anchor.kind === 'scene') return context.byId.get(anchor.sceneHeadingId)?.type === 'scene_heading' ? 'current' : 'missing';
  const element = context.byId.get(anchor.elementId);
  if (!element || (anchor.sceneHeadingId !== null && context.byId.get(anchor.sceneHeadingId)?.type !== 'scene_heading')) return 'missing';
  if (element.type !== anchor.sourceType || context.sceneFor.get(element.id) !== anchor.sceneHeadingId || elementText(element) !== anchor.sourceText) return 'changed';
  return 'current';
}
export function isCharacterAnchorCurrent(project: AnchorProject, anchor: CharacterAnchor): boolean {
  try { return anchorState(validateCharacterAnchor(anchor), contextFor(project.elements)) === 'current'; } catch { return false; }
}
export function captureCharacterTextAnchor(project: AnchorProject, elementId: string, start = 0, end?: number): CharacterTextAnchor | null {
  const context = contextFor(project.elements), element = context.byId.get(elementId);
  if (!element || element.type === 'note') return null;
  const sourceText = elementText(element), finish = end ?? sourceText.length;
  try { return validateCharacterAnchor({ kind: 'text', elementId, sceneHeadingId: context.sceneFor.get(elementId) ?? null,
    sourceType: element.type, start, end: finish, quote: sourceText.slice(start, finish), sourceText }) as CharacterTextAnchor; } catch { return null; }
}
export function captureCharacterSceneAnchor(project: AnchorProject, sceneHeadingId: string): CharacterSceneAnchor | null {
  return project.elements.some(element => element.id === sceneHeadingId && element.type === 'scene_heading') ? { kind: 'scene', sceneHeadingId } : null;
}
/** No text searching, automatic revival, or new IDs. Undo restores the original snapshot. */
export function reconcileCharacterWorkspace(_before: ReconcileProject, after: ReconcileProject, workspace?: CharacterWorkspace): CharacterWorkspace | undefined {
  if (!workspace) return workspace;
  let changed = false;
  const context = workspace.overrides.length || workspace.assignments.length ? contextFor(after.elements) : undefined;
  function reconcile<T extends CharacterOverride | CharacterAssignment>(entry: T): T {
    if (entry.anchorState === 'missing') return entry;
    const state = anchorState(entry.anchor, context!);
    const next = state === 'missing' ? 'missing' : entry.anchorState === 'changed' ? 'changed' : state;
    if (next === entry.anchorState) return entry;
    changed = true; return { ...entry, anchorState: next };
  }
  const overrides = workspace.overrides.map(reconcile), assignments = workspace.assignments.map(reconcile);
  const annotationIds = new Set((after.annotations || []).map(annotation => annotation.id));
  const noteLinks = workspace.noteLinks.filter(link => annotationIds.has(link.annotationId));
  if (noteLinks.length !== workspace.noteLinks.length) changed = true;
  return changed ? { ...workspace,
    overrides: overrides.every((entry, index) => entry === workspace.overrides[index]) ? workspace.overrides : overrides,
    assignments: assignments.every((entry, index) => entry === workspace.assignments[index]) ? workspace.assignments : assignments,
    noteLinks: noteLinks.length === workspace.noteLinks.length ? workspace.noteLinks : noteLinks } : workspace;
}

const cueExtension = /\s*[（(]\s*(V\.?\s*O\.?|O\.?\s*S\.?|O\.?\s*C\.?|CONT['’]?D|续|画外音|旁白|电话)\s*[）)]\s*$/i;
/** Only known performance suffixes are removed. Ages, versions, and collective cues remain intact. */
export function parseCharacterCue(raw: string): { name: string; extensions: string[] } {
  let name = raw.trim().replace(/[:：]\s*$/, '').trim();
  const extensions: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = cueExtension.exec(name))) { extensions.unshift(match[1]); name = name.slice(0, match.index).trim(); }
  return { name, extensions };
}

interface NameNode { children: Map<string, NameNode>; name?: string }
function nameTrie(names: Iterable<string>): NameNode {
  const root: NameNode = { children: new Map() };
  for (const name of names) {
    let node = root;
    for (let i = 0; i < name.length; i++) {
      let next = node.children.get(name[i]);
      if (!next) { next = { children: new Map() }; node.children.set(name[i], next); }
      node = next;
    }
    node.name = name;
  }
  return root;
}
function latinBoundary(text: string, start: number, end: number, name: string): boolean {
  const word = /[\p{Script=Latin}\p{N}_]/u;
  // Latin names are whole words; Chinese text has no general whitespace boundary.
  if (word.test(name[0]) && start > 0 && word.test(text[start - 1])) return false;
  if (word.test(name[name.length - 1]) && end < text.length && word.test(text[end])) return false;
  return true;
}
function nameMatches(text: string, root: NameNode, maximum: number) {
  const matches: { name: string; start: number; end: number }[] = [];
  for (let start = 0; start < text.length; start++) {
    let node = root, found: { name: string; start: number; end: number } | undefined;
    for (let i = start; i < text.length; i++) {
      const next = node.children.get(text[i]);
      if (!next) break;
      node = next;
      if (node.name && latinBoundary(text, start, i + 1, node.name)) found = { name: node.name, start, end: i + 1 };
    }
    if (found) {
      matches.push(found); start = found.end - 1;
      // One extra match proves the visible projection was truncated without
      // allocating a record for every repeated single-letter alias in a large paragraph.
      if (matches.length > maximum) break;
    }
  }
  return matches;
}
type CacheEntry = { elements: ScriptElement[]; sceneMeta: ScriptProject['sceneMeta']; profiles: CharacterProfile[] | undefined;
  overrides: CharacterOverride[] | undefined; assignments: CharacterAssignment[] | undefined;
  autoNumber: boolean; includeOmitted: boolean; result: CharacterLineIndex };
// Undo keeps up to 120 old element arrays alive. A WeakMap keyed by those arrays
// would therefore retain 120 complete reading projections; bound the full cache.
const indexCache: CacheEntry[] = [];
/** Opt-in read-only projection; call only while its reader is open. No subscription or persisted cache. */
export function buildCharacterLineIndex(project: ScriptProject, options: { includeOmitted?: boolean } = {}): CharacterLineIndex {
  const includeOmitted = !!options.includeOmitted;
  const hitIndex = indexCache.findIndex(entry => entry.elements === project.elements && entry.sceneMeta === project.sceneMeta && entry.profiles === project.characterWorkspace?.profiles &&
    entry.overrides === project.characterWorkspace?.overrides && entry.assignments === project.characterWorkspace?.assignments &&
    entry.autoNumber === project.settings.autoNumberScenes && entry.includeOmitted === includeOmitted);
  if (hitIndex >= 0) { const hit = indexCache.splice(hitIndex, 1)[0]; indexCache.push(hit); return hit.result; }
  const workspace = project.characterWorkspace;
  const context = contextFor(project.elements);
  const sceneList = deriveScenes(project);
  const omittedSceneIds = new Set(sceneList.filter(scene => scene.omit).map(scene => scene.elementId));
  const eligible = (element: ScriptElement) => element.type !== 'note' && (includeOmitted || (!element.omit && !omittedSceneIds.has(context.sceneFor.get(element.id) || '')));
  const scenes: CharacterLineScene[] = sceneList.filter(scene => includeOmitted || !scene.omit).map(scene => ({
    headingId: scene.elementId, number: scene.number, heading: scene.heading, storyTime: scene.storyTime,
    omitted: !!scene.omit, elementIds: project.elements.slice(scene.start, scene.end).filter(eligible).map(element => element.id),
  }));
  const characters: CharacterLineCharacter[] = (workspace?.profiles || []).map(profile => ({ ...profile, registered: true,
    occurrenceIds: [], sceneHeadingIds: [], speakingCount: 0, mentionCount: 0 }));
  const characterIds = new Set(characters.map(character => character.id));
  let discoveredCharacters = 0, charactersTruncated = false, truncated = false;
  const names = new Map<string, string[]>();
  const addName = (name: string, characterId: string) => {
    if (!name) return;
    const found = names.get(name) || [];
    if (!found.includes(characterId)) found.push(characterId);
    names.set(name, found);
  };
  for (const profile of characters) for (const raw of [profile.canonicalName, ...profile.aliases]) addName(parseCharacterCue(raw).name, profile.id);
  for (const element of project.elements) {
    if (!eligible(element) || element.type !== 'character') continue;
    const name = parseCharacterCue(elementText(element)).name;
    if (!name || names.has(name)) continue;
    if (name.length > CHARACTER_WORKSPACE_LIMITS.name || discoveredCharacters >= CHARACTER_WORKSPACE_LIMITS.discoveredCharacters) {
      charactersTruncated = true; continue;
    }
    discoveredCharacters++;
    // JSON string encoding also accepts lone surrogates from valid legacy text.
    let characterId = `auto:${JSON.stringify(name)}`;
    while (characterIds.has(characterId)) characterId = `auto:${characterId}`;
    characterIds.add(characterId);
    characters.push({ id: characterId, canonicalName: name, aliases: [], registered: false,
      occurrenceIds: [], sceneHeadingIds: [], speakingCount: 0, mentionCount: 0 });
    addName(name, characterId);
  }
  const trie = nameTrie(names.keys());
  const assignments = new Map<string, CharacterAssignment>();
  const staleAssignments: CharacterAssignment[] = [];
  for (const assignment of workspace?.assignments || []) {
    if (assignment.anchorState === 'current' && anchorState(assignment.anchor, context) === 'current') assignments.set(assignment.anchor.elementId, assignment);
    else staleAssignments.push(assignment);
  }
  const occurrences: CharacterOccurrence[] = [];
  const makeTextOccurrence = (element: ScriptElement, elementIndex: number, start: number, end: number, ids: string[], kind: 'speech' | 'mention', source: CharacterOccurrence['source'], explanation: string): CharacterOccurrence => {
    const sourceText = elementText(element), sceneHeadingId = context.sceneFor.get(element.id) ?? null;
    const anchor: CharacterTextAnchor = { kind: 'text', elementId: element.id, sceneHeadingId, sourceType: element.type,
      start, end, quote: sourceText.slice(start, end), sourceText };
    return { id: `${kind}:${element.id}:${start}:${end}`, kind, characterId: ids.length === 1 ? ids[0] : null, characterIds: [...ids],
      ambiguous: ids.length > 1, sceneHeadingId, elementId: element.id, elementIndex, start, end, quote: anchor.quote,
      sourceText, sourceType: element.type, dialogueElementIds: [], classification: kind === 'mention' && element.type === 'dialogue' ? 'mentioned' : 'uncertain',
      source, confidence: source === 'manual-assignment' ? 'manual' : kind === 'speech' ? 'explicit' : 'candidate', explanation, anchor };
  };
  let currentSpeech: CharacterOccurrence | undefined;
  let currentDualGroup: string | undefined;
  const dualSpeeches = new Map<string, CharacterOccurrence>();
  const clearSpeech = () => { currentSpeech = undefined; currentDualGroup = undefined; dualSpeeches.clear(); };
  for (let index = 0; index < project.elements.length; index++) {
    if (occurrences.length >= CHARACTER_WORKSPACE_LIMITS.evidence) { truncated = true; break; }
    const element = project.elements[index], sourceText = elementText(element);
    if (element.type === 'scene_heading' || element.type === 'act') clearSpeech();
    if (element.type === 'character') {
      currentSpeech = undefined;
      if (!element.dual || !element.dualGroup || element.dualGroup !== currentDualGroup) dualSpeeches.clear();
      currentDualGroup = element.dual && element.dualGroup ? element.dualGroup : undefined;
    }
    if (!eligible(element)) { if (element.type !== 'parenthetical' && element.type !== 'note') clearSpeech(); continue; }
    if (element.type === 'character') {
      const cue = parseCharacterCue(sourceText), assignment = assignments.get(element.id);
      if (!cue.name || !sourceText.length) continue;
      const ids = assignment ? assignment.characterId === null ? [] : [assignment.characterId] : names.get(cue.name) || [];
      currentSpeech = makeTextOccurrence(element, index, 0, sourceText.length, ids, 'speech', assignment ? 'manual-assignment' : 'cue',
        assignment ? assignment.characterId === null ? '作者将这处说话归属标为未知。' : '作者明确指定这处人物段落的说话归属。' :
        `${ids.length > 1 ? '这个名字对应多个人物，归属待确认。' : '来自明确的人物段落。'}${cue.extensions.length ? `表演后缀：${cue.extensions.join('、')}。` : ''}说话记录不证明实际在场。`);
      if (assignment) currentSpeech.assignmentId = assignment.id;
      occurrences.push(currentSpeech);
      if (element.dual && element.dualGroup) dualSpeeches.set(element.dual, currentSpeech);
    } else if (element.type === 'dialogue') {
      const assignment = assignments.get(element.id);
      if (assignment && sourceText.length) {
        const speech = makeTextOccurrence(element, index, 0, sourceText.length, assignment.characterId === null ? [] : [assignment.characterId], 'speech', 'manual-assignment',
          assignment.characterId === null ? '作者将这段对白的说话归属标为未知。' : '作者明确指定这段对白的说话归属。');
        speech.assignmentId = assignment.id; speech.dialogueElementIds.push(element.id); occurrences.push(speech);
      } else {
        const speaker = element.dual || element.dualGroup
          ? element.dual && element.dualGroup === currentDualGroup ? dualSpeeches.get(element.dual) : undefined
          : currentDualGroup ? undefined : currentSpeech;
        if (speaker) speaker.dialogueElementIds.push(element.id);
        else if (sourceText.trim()) {
        const speech = makeTextOccurrence(element, index, 0, sourceText.length, [], 'speech', 'cue', '这段对白前没有可确认的人物段落，说话归属未知。');
        speech.dialogueElementIds.push(element.id); occurrences.push(speech);
        }
      }
    } else if (element.type !== 'parenthetical') clearSpeech();
    if (element.type === 'action' || element.type === 'dialogue' || element.type === 'parenthetical' || element.type === 'general') {
      const remaining = CHARACTER_WORKSPACE_LIMITS.evidence - occurrences.length;
      const matches = nameMatches(sourceText, trie, remaining);
      if (matches.length > remaining) truncated = true;
      for (const match of matches.slice(0, remaining)) {
        occurrences.push(makeTextOccurrence(element, index, match.start, match.end, names.get(match.name)!, 'mention', 'name-match',
          element.type === 'dialogue' ? `对白文字精确出现“${match.name}”；只说明被提及，不证明实际在场。` :
          `文字精确出现“${match.name}”；可能是动作、转述、回忆或假设，实际出场待作者确认。`));
      }
    }
  }
  const staleOverrides: CharacterOverride[] = [];
  const positions = new Map(project.elements.map((element, index) => [element.id, index]));
  const occurrencesByRange = new Map<string, CharacterOccurrence[]>();
  const rangeKey = (elementId: string, start: number, end: number) => JSON.stringify([elementId, start, end]);
  for (const occurrence of occurrences) {
    const key = rangeKey(occurrence.elementId, occurrence.start, occurrence.end);
    const found = occurrencesByRange.get(key) || []; found.push(occurrence); occurrencesByRange.set(key, found);
  }
  for (const override of workspace?.overrides || []) {
    if (override.anchorState !== 'current' || anchorState(override.anchor, context) !== 'current') { staleOverrides.push(override); continue; }
    const anchor = override.anchor;
    const elementId = anchor.kind === 'scene' ? anchor.sceneHeadingId : anchor.elementId;
    const element = context.byId.get(elementId)!;
    if (!eligible(element)) continue;
    const candidates = anchor.kind === 'text' ? (occurrencesByRange.get(rangeKey(anchor.elementId, anchor.start, anchor.end)) || [])
      .filter(occurrence => occurrence.characterIds.includes(override.characterId)) : [];
    if (candidates.length === 1 && candidates[0].characterIds.length === 1) {
      const occurrence = candidates[0];
      occurrence.originalSource = occurrence.source as CharacterOccurrence['originalSource']; occurrence.originalExplanation = occurrence.explanation;
      occurrence.classification = override.classification; occurrence.source = 'manual-override'; occurrence.confidence = 'manual';
      occurrence.overrideId = override.id; occurrence.explanation = `作者纠正分类。${override.reason || ''}`;
    } else {
      if (occurrences.length >= CHARACTER_WORKSPACE_LIMITS.evidence) { truncated = true; continue; }
      const sourceText = elementText(element), sceneHeadingId = anchor.kind === 'scene' ? anchor.sceneHeadingId : anchor.sceneHeadingId;
      occurrences.push({ id: `manual:${override.id}`, kind: 'manual', characterId: override.characterId, characterIds: [override.characterId], ambiguous: false,
        sceneHeadingId, elementId, elementIndex: positions.get(elementId)!, start: anchor.kind === 'text' ? anchor.start : 0,
        end: anchor.kind === 'text' ? anchor.end : sourceText.length, quote: anchor.kind === 'text' ? anchor.quote : sourceText,
        sourceText, sourceType: element.type, dialogueElementIds: [], classification: override.classification,
        source: 'manual-override', confidence: 'manual', explanation: `作者${anchor.kind === 'scene' ? '对本场' : '对这处文字'}明确记录。${override.reason || ''}`,
        anchor, overrideId: override.id });
    }
  }
  occurrences.sort((a, b) => a.elementIndex - b.elementIndex || a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const characterById = new Map(characters.map(character => [character.id, character]));
  const sceneSets = new Map(characters.map(character => [character.id, new Set<string>()]));
  for (const occurrence of occurrences) for (const characterId of occurrence.characterIds) {
    const character = characterById.get(characterId);
    if (!character) continue;
    character.occurrenceIds.push(occurrence.id);
    if (occurrence.sceneHeadingId) sceneSets.get(characterId)!.add(occurrence.sceneHeadingId);
    if (!occurrence.ambiguous && occurrence.classification !== 'irrelevant') {
      if (occurrence.kind === 'speech' && occurrence.dialogueElementIds.length) character.speakingCount++;
      if (occurrence.kind === 'mention') character.mentionCount++;
    }
  }
  for (const character of characters) character.sceneHeadingIds = [...sceneSets.get(character.id)!];
  const result: CharacterLineIndex = { characters, scenes, occurrences, scope: { includeOmitted, notesExcluded: true, truncated,
    evidenceLimit: CHARACTER_WORKSPACE_LIMITS.evidence, charactersTruncated, characterLimit: CHARACTER_WORKSPACE_LIMITS.discoveredCharacters }, staleOverrides, staleAssignments };
  indexCache.push({ elements: project.elements, sceneMeta: project.sceneMeta, profiles: workspace?.profiles,
    overrides: workspace?.overrides, assignments: workspace?.assignments, autoNumber: project.settings.autoNumberScenes, includeOmitted, result });
  while (indexCache.length > CHARACTER_WORKSPACE_LIMITS.indexCacheEntries) indexCache.shift();
  return result;
}
