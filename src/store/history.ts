import type { StoreApi } from 'zustand';
import type { ScriptProject } from '../model/types';
import { newElement } from '../model/project';
import { captureTextAnchor, captureSceneAnchor, reconcileAnnotations, type AnnotationAnchor } from '../model/annotations';
import { reconcileCharacterWorkspace } from '../model/characterLines';
import { filterBoardLinksToKeep } from '../model/selection';
import type { StoreState, MutateOptions } from './types';

/** 撤销历史与事务边界：所有切片共用同一套合并规则。 */
export const HISTORY_LIMIT = 120;

const COALESCE_IDLE_MS = 1500;
const TEXT_GROUP_MAX_MS = 5000;
let lastCoalesce: { key: string; ts: number; startedAt: number } | null = null;

/** 切断连续输入的合并窗口（新事务、撤销、切换文档时调用）。 */
export function resetCoalesce() { lastCoalesce = null; }

export type BoardCardTarget = { kind: 'scene' | 'beat'; id: string };

/** 新自由板事务验证真实卡片；保留旧选择器使用无前缀 ID 的兼容能力。 */
export function boardCardTarget(project: ScriptProject, raw: string): BoardCardTarget | null {
  if (typeof raw !== 'string' || !raw) return null;
  const isScene = raw.startsWith('scene:');
  const isBeat = raw.startsWith('beat:');
  const id = isScene ? raw.slice(6) : isBeat ? raw.slice(5) : raw;
  if (!isBeat && project.elements.some((element) => element.id === id && element.type === 'scene_heading')) {
    return { kind: 'scene', id };
  }
  if (!isScene && project.beats.some((beat) => beat.id === id)) return { kind: 'beat', id };
  return null;
}

/** A restored snapshot may remove the focused paragraph or selected cards.
 * Keep surviving interface IDs without sending a new focus request.
 */
export function historySelection(state: StoreState, project: ScriptProject) {
  const elements = new Set(project.elements.map((element) => element.id));
  return {
    activeId: state.activeId && elements.has(state.activeId) ? state.activeId : null,
    focus: state.focus && elements.has(state.focus.id) ? state.focus : null,
    selectedIds: state.selectedIds.filter((id) => boardCardTarget(project, id)),
    writingSelectedIds: state.writingSelectedIds.filter((id) => elements.has(id)),
  };
}

/** Both immutable text edits and generic mutations use the same history boundary.
 * `next` must be a new project owned by the caller; never mutate a saved snapshot.
 */
export function projectChange(state: StoreState, next: ScriptProject, opts?: MutateOptions) {
  // Anchors and writing are one undo transaction. Unproven text edits retain the
  // original quote and mark it for review instead of searching for similar text.
  if (next.annotations?.length && next.elements !== state.project.elements) {
    next.annotations = reconcileAnnotations(state.project.elements, next.elements, next.annotations);
  }
  if (next.characterWorkspace && (next.elements !== state.project.elements || next.annotations !== state.project.annotations)) {
    next.characterWorkspace = reconcileCharacterWorkspace(state.project, next, next.characterWorkspace);
  }
  const history = opts?.history !== false;
  const now = Date.now();
  next.updatedAt = now;
  let shouldPush = history;
  if (history && opts?.coalesce) {
    let startedAt = now;
    // 连续输入既按停笔分组，也有绝对时长上限；不能每个字刷新后无限合并。
    // 其他既有 move/resize key 仍沿用原来的空闲时间合并语义。
    if (lastCoalesce && lastCoalesce.key === opts.coalesce &&
        now - lastCoalesce.ts < COALESCE_IDLE_MS &&
        (!opts.coalesce.startsWith('text:') || now - lastCoalesce.startedAt < TEXT_GROUP_MAX_MS)) {
      shouldPush = false;
      startedAt = lastCoalesce.startedAt;
    }
    lastCoalesce = { key: opts.coalesce, ts: now, startedAt };
  } else {
    // 非历史更新也是操作边界；不得合并前后的编辑 / resize。
    lastCoalesce = null;
  }
  return {
    project: next,
    dirty: true,
    version: state.version + 1,
    past: shouldPush ? [...state.past, state.project].slice(-HISTORY_LIMIT) : state.past,
    future: history ? [] : state.future,
  };
}

/** Validate before committing, including the document session captured by a modal. */
export function makeReviewChange(set: StoreApi<StoreState>['setState'], get: StoreApi<StoreState>['getState']) {
  return (expectedEpoch: number | undefined, make: (project: ScriptProject) => ScriptProject): boolean => {
    const state = get();
    if (expectedEpoch !== undefined && state.documentEpoch !== expectedEpoch) {
      state.notify('工程已切换，请重新打开改稿工作台。', 'error');
      return false;
    }
    try {
      const next = make(state.project);
      if (next === state.project) return false;
      set({ ...projectChange(state, next), ...historySelection(state, next) });
      return true;
    } catch (error) {
      state.notify(error instanceof Error ? error.message : '操作未完成，原稿保持不变。', 'error');
      return false;
    }
  };
}

export function assertReviewAnchor(project: ScriptProject, anchor: AnnotationAnchor) {
  const element = project.elements.find(item => item.id === anchor.elementId);
  if (!element) throw new Error('批注原文已不存在，请重新选择。');
  const expected = anchor.kind === 'scene' ? captureSceneAnchor(element) : captureTextAnchor(element, anchor.start, anchor.end);
  if (!expected || expected.kind !== anchor.kind || expected.elementId !== anchor.elementId ||
      (expected.kind === 'text' && anchor.kind === 'text' && (expected.start !== anchor.start || expected.end !== anchor.end || expected.quote !== anchor.quote || expected.sourceText !== anchor.sourceText))) {
    throw new Error('批注原文已变化，请重新选择。');
  }
}

export function removeReviewElements(project: ScriptProject, removed: Set<string>): ScriptProject {
  const associations = new Set([...removed, ...project.sceneMeta.filter(meta => removed.has(meta.elementId)).map(meta => meta.id)]);
  const elements = project.elements.filter(element => !removed.has(element.id));
  return { ...project, elements: elements.length ? elements : [newElement('action', '')],
    sceneMeta: project.sceneMeta.filter(meta => !removed.has(meta.elementId)),
    beats: project.beats.map(beat => {
      if (!beat.sceneId || !associations.has(beat.sceneId)) return beat;
      const next = { ...beat }; delete next.sceneId; return next;
    }), boardLinks: filterBoardLinksToKeep(project.boardLinks || [], associations) };
}
