import type { SceneMeta, ScriptElement, ScriptProject } from './types';
import { ELEMENT_ORDER } from './elements';
import { sanitizeProjectHtml } from '../utils/projectHtml';
import { uid } from '../utils/id';
import { searchText } from './search';

/** Deliberately bounded, text-only project data. Never put a project or media in a version. */
export const REVISION_WORKSPACE_LIMITS = Object.freeze({
  versions: 20, stash: 100, bytes: 2 * 1024 * 1024, name: 120, description: 2000,
});

export interface WritingFragment {
  elements: ScriptElement[];
  sceneMeta: SceneMeta[];
}
export interface NamedVersion {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  content: WritingFragment;
}
export interface FragmentSource {
  projectId: string;
  versionId?: string;
  sceneHeadingId?: string;
  sceneLabel?: string;
  elementIds: string[];
}
export interface StashEntry extends NamedVersion {
  kind: 'deleted' | 'alternative' | 'excerpt';
  source: FragmentSource;
}
export interface RevisionWorkspace {
  schema: 1;
  versions: NamedVersion[];
  stash: StashEntry[];
}
export type FragmentSelection = { kind: 'all' } | { kind: 'scene'; headingId: string }
  | { kind: 'elements'; ids: readonly string[] } | { kind: 'preamble' };
export interface SceneSnapshot extends WritingFragment {
  id: string;
  label: string;
  headingId?: string;
  index: number;
}
export interface SceneDiff {
  id: string;
  label: string;
  headingId?: string;
  before?: SceneSnapshot;
  after?: SceneSnapshot;
  added: boolean;
  deleted: boolean;
  modified: boolean;
  moved: boolean;
}
export interface InsertPlan extends WritingFragment { warnings: string[] }

type RecordValue = Record<string, unknown>;
const elementTypes = new Set<string>(ELEMENT_ORDER);
const reservedIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const elementKeys = ['id', 'type', 'text', 'dual', 'dualGroup', 'rev', 'omit', 'sceneId'];
// Board geometry is not part of a text version. Story fields are captured without
// material cards or references to an older version/workspace.
const metaKeys = ['id', 'elementId', 'title', 'synopsis', 'color', 'actId', 'omit', 'location', 'storyTime', 'revisionStatus'];
const sourceKeys = ['projectId', 'versionId', 'sceneHeadingId', 'sceneLabel', 'elementIds'];
const entryKeys = ['id', 'name', 'description', 'createdAt', 'content'];
const bad = () => new Error('版本或暂存内容格式不正确，原稿未修改。');
const tooLarge = () => new Error('版本和暂存合计超过 2 MiB，请先管理已有条目；原稿未修改。');
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad();
  return value as RecordValue;
}
function onlyKeys(value: RecordValue, keys: readonly string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw bad();
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 ||
    /[\u0000-\u001f\u007f"'\\<>]/.test(value) || reservedIds.has(value)) throw bad();
  return value;
}
function text(value: unknown, maximum = REVISION_WORKSPACE_LIMITS.bytes): string {
  if (typeof value !== 'string' || value.length > maximum) throw bad();
  return value;
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请填写版本或暂存名称。');
  if (value.length > REVISION_WORKSPACE_LIMITS.name) throw new Error('名称不能超过 120 个字符。');
  return value.trim();
}
function description(value: unknown): string {
  if (typeof value !== 'string') throw bad();
  if (value.length > REVISION_WORKSPACE_LIMITS.description) throw new Error('说明不能超过 2000 个字符。');
  return value;
}
function array(value: unknown, maximum = 100_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw bad();
  return value;
}
function byteLength(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
  catch { throw bad(); }
}
function unique(values: readonly string[]) {
  if (new Set(values).size !== values.length) throw bad();
}
function pick(source: RecordValue, keys: readonly string[]): RecordValue {
  const result: RecordValue = {};
  for (const key of keys) if (source[key] !== undefined) result[key] = source[key];
  return result;
}

function parseElement(value: unknown): ScriptElement {
  const item = record(value);
  onlyKeys(item, elementKeys);
  const result: ScriptElement = {
    id: id(item.id), type: item.type as ScriptElement['type'], text: sanitizeProjectHtml(text(item.text)),
  };
  if (!elementTypes.has(result.type)) throw bad();
  for (const key of ['dualGroup', 'rev', 'sceneId'] as const) if (item[key] !== undefined) result[key] = id(item[key]);
  if (item.dual !== undefined) {
    if (item.dual !== 'left' && item.dual !== 'right') throw bad();
    result.dual = item.dual;
  }
  if (item.omit !== undefined) {
    if (typeof item.omit !== 'boolean') throw bad();
    result.omit = item.omit;
  }
  return result;
}
function parseMeta(value: unknown): SceneMeta {
  const item = record(value);
  onlyKeys(item, metaKeys);
  const result: RecordValue = { id: id(item.id), elementId: id(item.elementId),
    title: text(item.title), synopsis: text(item.synopsis), color: text(item.color) };
  if (item.actId !== undefined) result.actId = id(item.actId);
  if (item.omit !== undefined) {
    if (typeof item.omit !== 'boolean') throw bad();
    result.omit = item.omit;
  }
  // Restored story fields must satisfy the active-project parser as well.
  for (const key of ['location', 'storyTime']) if (item[key] !== undefined) result[key] = text(item[key], 500);
  if (item.revisionStatus !== undefined) {
    if (!['todo', 'revising', 'done'].includes(item.revisionStatus as string)) throw bad();
    result.revisionStatus = item.revisionStatus;
  }
  return result as unknown as SceneMeta;
}
/** Archive data has a stricter allowlist than the legacy active-project parser. */
export function parseWritingFragment(value: unknown): WritingFragment {
  const item = record(value);
  onlyKeys(item, ['elements', 'sceneMeta']);
  if (byteLength(value) > REVISION_WORKSPACE_LIMITS.bytes) throw tooLarge();
  const elements = array(item.elements).map(parseElement);
  const sceneMeta = array(item.sceneMeta).map(parseMeta);
  unique(elements.map(element => element.id));
  unique(sceneMeta.map(meta => meta.id));
  unique(sceneMeta.map(meta => meta.elementId));
  const headings = new Set(elements.filter(element => element.type === 'scene_heading').map(element => element.id));
  if (sceneMeta.some(meta => !headings.has(meta.elementId))) throw bad();
  return { elements, sceneMeta };
}
function parseSource(value: unknown): FragmentSource {
  const item = record(value);
  onlyKeys(item, sourceKeys);
  const result: FragmentSource = { projectId: id(item.projectId), elementIds: array(item.elementIds).map(id) };
  unique(result.elementIds);
  for (const key of ['versionId', 'sceneHeadingId'] as const) if (item[key] !== undefined) result[key] = id(item[key]);
  if (item.sceneLabel !== undefined) result.sceneLabel = text(item.sceneLabel, 2000);
  return result;
}
function parseEntry(value: unknown, stash: boolean): NamedVersion | StashEntry {
  const item = record(value);
  onlyKeys(item, stash ? [...entryKeys, 'kind', 'source'] : entryKeys);
  if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt) || item.createdAt < 0) throw bad();
  const entry: NamedVersion = { id: id(item.id), name: name(item.name), description: description(item.description),
    createdAt: item.createdAt, content: parseWritingFragment(item.content) };
  if (!stash) return entry;
  if (!['deleted', 'alternative', 'excerpt'].includes(item.kind as string) || !entry.content.elements.length) throw bad();
  const source = parseSource(item.source);
  if (source.elementIds.length !== entry.content.elements.length ||
    source.elementIds.some((elementId, index) => elementId !== entry.content.elements[index].id)) throw bad();
  return { ...entry, kind: item.kind as StashEntry['kind'], source };
}

export function revisionWorkspaceUsage(workspace?: RevisionWorkspace): { versions: number; stash: number; bytes: number } {
  return { versions: workspace?.versions.length ?? 0, stash: workspace?.stash.length ?? 0,
    bytes: workspace ? byteLength(workspace) : 0 };
}
/** Missing old fields stay missing. Invalid/unknown archive schemas never silently disappear. */
export function parseRevisionWorkspace(value: unknown): RevisionWorkspace | undefined {
  if (value === undefined) return undefined;
  const item = record(value);
  onlyKeys(item, ['schema', 'versions', 'stash']);
  if (item.schema !== 1) throw new Error('暂不支持这个版本工作区格式，原文件未修改。');
  if (!Array.isArray(item.versions) || !Array.isArray(item.stash)) throw bad();
  if (item.versions.length > REVISION_WORKSPACE_LIMITS.versions) throw new Error('最多保存 20 个正文版本，请先管理已有版本。');
  if (item.stash.length > REVISION_WORKSPACE_LIMITS.stash) throw new Error('最多保存 100 条暂存，请先管理已有暂存。');
  if (byteLength(value) > REVISION_WORKSPACE_LIMITS.bytes) throw tooLarge();
  const versions = item.versions.map(entry => parseEntry(entry, false) as NamedVersion);
  const stash = item.stash.map(entry => parseEntry(entry, true) as StashEntry);
  unique([...versions, ...stash].map(entry => entry.id));
  return { schema: 1, versions, stash };
}

/** Capture in manuscript order, copying only the documented text/story fields. */
export function captureWritingFragment(
  source: Pick<ScriptProject, 'elements' | 'sceneMeta'>,
  selection: FragmentSelection = { kind: 'all' },
): WritingFragment {
  let chosen: ScriptElement[];
  if (selection.kind === 'all') chosen = source.elements;
  else if (selection.kind === 'preamble') {
    const firstHeading = source.elements.findIndex(element => element.type === 'scene_heading');
    chosen = source.elements.slice(0, firstHeading < 0 ? source.elements.length : firstHeading);
  } else if (selection.kind === 'scene') {
    const start = source.elements.findIndex(element => element.id === selection.headingId && element.type === 'scene_heading');
    if (start < 0) throw new Error('这个场景已不存在，请重新选择。');
    const next = source.elements.findIndex((element, index) => index > start && element.type === 'scene_heading');
    chosen = source.elements.slice(start, next < 0 ? source.elements.length : next);
  } else {
    const ids = new Set(selection.ids);
    const validIds = new Set(source.elements.map(element => element.id));
    if (!ids.size || ids.size !== selection.ids.length || [...ids].some(id => !validIds.has(id))) {
      throw new Error('所选段落已变化，请重新选择。');
    }
    chosen = source.elements.filter(element => ids.has(element.id));
  }
  const headings = new Set(chosen.filter(element => element.type === 'scene_heading').map(element => element.id));
  const seen = new Set<string>();
  const sceneMeta = source.sceneMeta.filter(meta => {
    if (!headings.has(meta.elementId) || seen.has(meta.elementId)) return false;
    seen.add(meta.elementId); return true;
  }).map(meta => ({ title: '', synopsis: '', color: '#cfe4ff', ...pick(meta as unknown as RecordValue, metaKeys) }));
  return parseWritingFragment({ elements: chosen.map(element => pick(element as unknown as RecordValue, elementKeys)), sceneMeta });
}

function base(workspace?: RevisionWorkspace): RevisionWorkspace {
  // Validate before modifying; retain the immutable old entries rather than
  // installing parser copies on every rename/remove operation.
  parseRevisionWorkspace(workspace);
  return workspace ?? { schema: 1, versions: [], stash: [] };
}
function checked(workspace: RevisionWorkspace): RevisionWorkspace {
  parseRevisionWorkspace(workspace);
  return workspace;
}
export function createNamedVersion(project: ScriptProject, versionName: string, versionDescription = ''): RevisionWorkspace {
  const old = base(project.revisionWorkspace);
  const entry: NamedVersion = { id: uid('version'), name: name(versionName), description: description(versionDescription),
    createdAt: Date.now(), content: captureWritingFragment(project) };
  return checked({ ...old, versions: [...old.versions, entry] });
}
export function renameNamedVersion(workspace: RevisionWorkspace | undefined, entryId: string, entryName: string, entryDescription?: string): RevisionWorkspace {
  const old = base(workspace);
  const entry = old.versions.find(entry => entry.id === entryId);
  if (!entry) throw new Error('这个正文版本已不存在。');
  const nextName = name(entryName), nextDescription = entryDescription === undefined ? entry.description : description(entryDescription);
  if (nextName === entry.name && nextDescription === entry.description) return old;
  return checked({ ...old, versions: old.versions.map(item => item.id === entryId ? { ...item, name: nextName, description: nextDescription } : item) });
}
export function deleteNamedVersion(workspace: RevisionWorkspace | undefined, entryId: string): RevisionWorkspace {
  const old = base(workspace);
  if (!old.versions.some(entry => entry.id === entryId)) throw new Error('这个正文版本已不存在。');
  return checked({ ...old, versions: old.versions.filter(entry => entry.id !== entryId) });
}
export function createStashEntry(workspace: RevisionWorkspace | undefined, content: WritingFragment, options: {
  name: string; description?: string; kind?: StashEntry['kind']; source: FragmentSource;
}): RevisionWorkspace {
  const old = base(workspace);
  const entry: StashEntry = { id: uid('stash'), name: name(options.name), description: description(options.description ?? ''),
    createdAt: Date.now(), kind: options.kind ?? 'excerpt', source: parseSource(options.source), content: parseWritingFragment(content) };
  return checked({ ...old, stash: [...old.stash, entry] });
}
export function renameStashEntry(workspace: RevisionWorkspace | undefined, entryId: string, entryName: string, entryDescription?: string): RevisionWorkspace {
  const old = base(workspace);
  const entry = old.stash.find(entry => entry.id === entryId);
  if (!entry) throw new Error('这条暂存已不存在。');
  const nextName = name(entryName), nextDescription = entryDescription === undefined ? entry.description : description(entryDescription);
  if (nextName === entry.name && nextDescription === entry.description) return old;
  return checked({ ...old, stash: old.stash.map(item => item.id === entryId ? { ...item, name: nextName, description: nextDescription } : item) });
}
export function deleteStashEntry(workspace: RevisionWorkspace | undefined, entryId: string): RevisionWorkspace {
  const old = base(workspace);
  if (!old.stash.some(entry => entry.id === entryId)) throw new Error('这条暂存已不存在。');
  return checked({ ...old, stash: old.stash.filter(entry => entry.id !== entryId) });
}

/** Build an insertion copy, never a whole-project restore. The store owns anchor/epoch checks. */
export function buildInsertPlan(fragment: WritingFragment, targetProject?: ScriptProject): InsertPlan {
  const content = parseWritingFragment(fragment);
  if (!content.elements.length) throw new Error('所选内容为空，未插入正文。');
  const existing = new Set([
    ...content.elements.map(element => element.id), ...content.sceneMeta.map(meta => meta.id),
    ...content.elements.flatMap(element => element.dualGroup ? [element.dualGroup] : []),
    ...(targetProject ? [...targetProject.elements, ...targetProject.beats, ...targetProject.sceneMeta].map(item => item.id) : []),
    ...(targetProject?.elements.flatMap(element => element.dualGroup ? [element.dualGroup] : []) ?? []),
  ]);
  const fresh = (prefix: string): string => {
    let result: string;
    do { result = uid(prefix); } while (existing.has(result) || existing.has(`scene:${result}`) || existing.has(`beat:${result}`));
    existing.add(result); return result;
  };
  const elementIds = new Map(content.elements.map(element => [element.id, fresh('el')]));
  const metaIds = new Map(content.sceneMeta.map(meta => [meta.id, fresh('sc')]));
  const groups = new Map<string, string>();
  const headingIds = new Set(content.elements.filter(element => element.type === 'scene_heading').map(element => element.id));
  const sides = new Map<string, Set<string>>();
  for (const element of content.elements) if (element.dualGroup && element.dual) {
    const group = sides.get(element.dualGroup) ?? new Set<string>();
    group.add(element.dual); sides.set(element.dualGroup, group);
  }
  const warnings = new Set<string>();
  const revs = new Set(targetProject?.revisions.map(revision => revision.id));
  const acts = new Set(targetProject?.acts.map(act => act.id));
  const elements = content.elements.map(element => {
    const result = { ...element, id: elementIds.get(element.id)! };
    if (result.rev && !revs.has(result.rev)) { delete result.rev; warnings.add('未保留当前工程中不存在的修订颜色。'); }
    if (result.sceneId) {
      const associated = metaIds.get(result.sceneId) ?? (headingIds.has(result.sceneId) ? elementIds.get(result.sceneId) : undefined);
      if (associated) result.sceneId = associated;
      else delete result.sceneId;
    }
    if (result.dual || result.dualGroup) {
      if (result.dualGroup && sides.get(result.dualGroup)?.size === 2) {
        if (!groups.has(result.dualGroup)) groups.set(result.dualGroup, fresh('dg'));
        result.dualGroup = groups.get(result.dualGroup);
      } else {
        delete result.dual; delete result.dualGroup;
        warnings.add('所选双列对白不完整，已作为普通段落插入。');
      }
    }
    return result;
  });
  const sceneMeta = content.sceneMeta.map(meta => {
    const result = { ...meta, id: metaIds.get(meta.id)!, elementId: elementIds.get(meta.elementId)! };
    if (result.actId && !acts.has(result.actId)) { delete result.actId; warnings.add('原幕已不存在，取回的场景保持未归幕。'); }
    return result;
  });
  return { elements, sceneMeta, warnings: [...warnings] };
}

export function sceneSnapshots(fragment: WritingFragment): SceneSnapshot[] {
  const headings: number[] = [];
  fragment.elements.forEach((element, index) => { if (element.type === 'scene_heading') headings.push(index); });
  const starts = headings[0] === 0 ? headings : [0, ...headings];
  if (!fragment.elements.length) return [];
  return starts.map((start, index) => {
    const element = fragment.elements[start];
    const headingId = element.type === 'scene_heading' ? element.id : undefined;
    return { id: headingId ? `scene:${headingId}` : 'preamble', headingId,
      label: headingId ? searchText(element.text).trim() || '未命名场景' : '场前文字', index,
      elements: fragment.elements.slice(start, starts[index + 1] ?? fragment.elements.length),
      sceneMeta: headingId ? fragment.sceneMeta.filter(meta => meta.elementId === headingId) : [] };
  });
}
function semanticScene(scene: SceneSnapshot): string {
  // Identity and numbering are used for alignment, not prose-change detection.
  // Creating a formerly absent card only to move it on the board is not a story
  // edit. Compare the same defaults used by the live scene projection.
  const meta = scene.sceneMeta[0] as (SceneMeta & { location?: string; storyTime?: string; revisionStatus?: string }) | undefined;
  return JSON.stringify({ elements: scene.elements.map(({ id: _id, ...element }) => element),
    sceneMeta: scene.headingId ? { title: meta?.title || '', synopsis: meta?.synopsis || '', color: meta?.color || '#cfe4ff',
      actId: meta?.actId ?? null, omit: !!meta?.omit, location: meta?.location || '', storyTime: meta?.storyTime || '',
      revisionStatus: meta?.revisionStatus ?? null } : null });
}
/** Longest increasing subsequence marks a minimal, deterministic set of moved survivors. */
function stationaryIds(before: SceneSnapshot[], after: SceneSnapshot[]): Set<string> {
  const ranks = new Map(before.filter(scene => scene.headingId).map((scene, index) => [scene.id, index]));
  const sequence = after.filter(scene => scene.headingId && ranks.has(scene.id));
  const tails: number[] = [], parents: number[] = [];
  for (let i = 0; i < sequence.length; i++) {
    const rank = ranks.get(sequence[i].id)!;
    let low = 0, high = tails.length;
    while (low < high) { const middle = (low + high) >>> 1; if (ranks.get(sequence[tails[middle]].id)! < rank) low = middle + 1; else high = middle; }
    parents[i] = low > 0 ? tails[low - 1] : -1;
    tails[low] = i;
  }
  const result = new Set<string>();
  for (let index = tails[tails.length - 1]; index !== undefined && index >= 0; index = parents[index]) result.add(sequence[index].id);
  return result;
}
export function compareWritingSnapshots(before: WritingFragment, after: WritingFragment): SceneDiff[] {
  const oldScenes = sceneSnapshots(before), newScenes = sceneSnapshots(after);
  const oldById = new Map(oldScenes.map(scene => [scene.id, scene])), newById = new Map(newScenes.map(scene => [scene.id, scene]));
  const stationary = stationaryIds(oldScenes, newScenes);
  // Current manuscript order first; removed scenes retain their own former order.
  return [...newScenes.map(scene => scene.id), ...oldScenes.filter(scene => !newById.has(scene.id)).map(scene => scene.id)].map(id => {
    const previous = oldById.get(id), current = newById.get(id), visible = current ?? previous!;
    return { id, label: visible.label, headingId: visible.headingId, before: previous, after: current,
      added: !previous, deleted: !current,
      modified: !!previous && !!current && semanticScene(previous) !== semanticScene(current),
      moved: !!previous?.headingId && !!current && !stationary.has(id) };
  });
}
