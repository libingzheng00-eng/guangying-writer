import { create } from 'zustand';
import { isWritingView, loadStoredWritingContext, resolveWritingContext, validateWritingContext, type WritingContext } from '../app/writingContext';
import type {
  Act,
  BoardLink,
  Beat,
  ElementType,
  Revision,
  SceneMeta,
  ScriptElement,
  ScriptProject,
  ScriptSettings,
  TitlePage,
} from '../model/types';
import { cloneProject, createProject, newElement, deriveScenes } from '../model/project';
import { sampleProject } from '../model/sample';
import { dualAfterEnter } from '../model/flow';
import { moveStoryboardScenes, type StoryboardPlacement } from '../model/storyboard';
import { searchText } from '../model/search';
import { plain, cnNum } from '../utils/text';
import { uid } from '../utils/id';
import { DEFAULT_FONT_COLOR, normalizeFontColor } from '../model/appearance';
import { clampTargetPages } from '../model/progress';
import { clampSize } from '../model/board';
import { boardBeatPosition, type BoardCardPosition } from '../model/boardWorkspace';
import { reorderOutlineScene } from '../model/outline';
import {
  captureWritingFragment, createNamedVersion, renameNamedVersion, deleteNamedVersion,
  createStashEntry, deleteStashEntry, buildInsertPlan,
} from '../model/revisionWorkspace';
import { captureTextAnchor, captureSceneAnchor, reconcileAnnotations, validateAnnotations, reanchorAnnotation,
  type Annotation, type AnnotationAnchor } from '../model/annotations';
import { buildDeliveryChecks, normalizeDeliveryIgnored } from '../model/deliveryChecks';
import {
  toggleSel,
  selRange,
  clearSel,
  filterBoardLinksToKeep,
  splitBoardSelection,
} from '../model/selection';

export type ViewMode = 'write' | 'cards' | 'board' | 'preview' | 'reports';
export type SidebarMode = 'navigator' | 'outline' | 'inspector';
export type AppTheme = 'night' | 'day';

export interface FocusRequest {
  id: string;
  caret: 'start' | 'end' | number;
  /** 滚动定位策略；普通编辑保持 nearest，场景条跳转使用 start。 */
  scroll: 'nearest' | 'start' | 'center' | 'end';
  ts: number;
}

export interface Toast {
  text: string;
  kind: 'info' | 'error' | 'ok';
  ts: number;
}

/** 保存调用开始时的不可变工程快照；仅用于异步保存结果归属，不写入工程。 */
export interface SaveSnapshot {
  project: ScriptProject;
  documentEpoch: number;
}

interface MutateOptions {
  history?: boolean;
  /** 相同 key 的连续修改会合并为一条撤销记录 */
  coalesce?: string;
}

interface StoreState {
  project: ScriptProject;
  filePath: string | null;
  dirty: boolean;
  view: ViewMode;
  writingContext: WritingContext | null;
  updateWritingContext: (patch: Partial<WritingContext>, expectedEpoch?: number) => void;
  sidebar: SidebarMode;
  sidebarOpen: boolean;
  activeId: string | null;
  activeRev: string | null;
  focus: FocusRequest | null;
  toast: Toast | null;
  version: number;
  /** 每次打开/恢复/新建递增，防止相同工程 ID 的旧异步保存结果串到新会话。 */
  documentEpoch: number;
  pageCount: number;
  zoom: number;
  /** 写作字体颜色（auto 随日夜主题；app 级设置，不写入 .zhsp） */
  fontColor: string;
  /** 应用外观（app 级设置，不写入 .zhsp） */
  appTheme: AppTheme;
  /** 导出期间的临时显示状态，不写入工程、自动保存或撤销栈。 */
  pdfExportMode: 'creative' | 'print' | null;
  past: ScriptProject[];
  future: ScriptProject[];

  /** 自由板多选集合（不写入 .zhsp；load 时清空、save 时忽略） */
  selectedIds: string[];
  /** 写作正文多选状态；纯界面状态，不写入 .zhsp。 */
  writingSelectionMode: boolean;
  writingSelectedIds: string[];

  setView: (v: ViewMode) => void;
  setPdfExportMode: (mode: 'creative' | 'print' | null) => void;
  setSidebar: (s: SidebarMode) => void;
  toggleSidebar: () => void;
  notify: (text: string, kind?: Toast['kind']) => void;
  setPageCount: (n: number) => void;
  setZoom: (n: number) => void;
  setFontColor: (c: string) => void;
  setAppTheme: (theme: AppTheme) => void;

  loadProject: (p: ScriptProject, filePath?: string | null, context?: WritingContext | null) => void;
  newProject: () => void;
  markSaved: (path: string, saved?: SaveSnapshot) => boolean;

  mutate: (fn: (p: ScriptProject) => void, opts?: MutateOptions) => void;
  /** 光标移动/失焦等界面边界只结束输入合并，不改变工程、版本或历史栈。 */
  breakHistoryGroup: () => void;
  undo: () => void;
  redo: () => void;

  setActive: (id: string | null) => void;
  requestFocus: (id: string, caret?: FocusRequest['caret'], scroll?: FocusRequest['scroll']) => void;

  /* 元素操作 */
  insertAfter: (id: string | null, type?: ElementType, text?: string) => string;
  /** 在光标处把一个元素拆成两个（回车） */
  splitBlock: (id: string, before: string, after: string, nextType: ElementType) => string;
  /** Atomic cut/paste or selected-range replacement; never coalesces with typing. */
  replaceWritingRange: (ids: string[], before: string, after: string, inserted: string, nextType?: ElementType) => string | null;
  /** Explicit SmartType acceptance: text + type in one guarded history transaction. */
  commitSmartType: (id: string, expectedText: string, expectedType: ElementType, html: string, targetType: ElementType, expectedEpoch: number) => boolean;
  setType: (id: string, type: ElementType) => void;
  setText: (id: string, text: string) => void;
  removeElement: (id: string) => void;
  deleteWritingElements: (ids: string[]) => void;
  moveElement: (id: string, dir: -1 | 1) => void;
  mergeIntoPrevious: (id: string) => { id: string; offset: number } | null;
  toggleOmit: (id: string) => void;
  setRevision: (id: string, revId: string | null) => void;
  setDual: (id: string, dual: 'left' | 'right' | null) => void;

  /* 场景 / 幕 */
  updateSceneMeta: (elementId: string, patch: Partial<SceneMeta>) => void;
  /** resize 场景卡到指定尺寸；非法值由 clampSize 兜底；独立 coalesce key 与 moveScene / sceneMeta 文本编辑不冲突 */
  resizeSceneMeta: (elementId: string, w: number, h: number) => void;
  moveScene: (index: number, dir: -1 | 1) => void;
  moveSceneTo: (from: number, to: number) => void;
  /** 故事板拖拽落位：移动场景并归入目标幕，一次操作只产生一条撤销记录 */
  dropSceneInAct: (from: number, to: number, elementId: string, actId?: string) => void;
  moveScenesToAct: (ids: string[], actId?: string, placement?: StoryboardPlacement) => void;
  addSceneAfter: (elementId: string) => void;
  /** 删除场景标题及其后续正文，连同场景卡元数据；可由 undo 恢复。 */
  deleteScene: (elementId: string) => boolean;
  updateAct: (id: string, patch: Partial<Act>) => void;
  addAct: () => void;
  removeAct: (id: string) => void;

  /* 自由画布：场景卡坐标 */
  setScenePos: (elementId: string, x: number, y: number) => void;
  /** 自由板新建空场景：正文与坐标一次提交，保持当前视图与写作焦点；非法坐标不操作。 */
  addBoardScene: (x: number, y: number) => string | null;
  /** 一次自由板拖动提交，可移动多张卡；不写入素材的写作 / PDF 坐标，也不合并其他手势。 */
  moveBoardCards: (positions: BoardCardPosition[]) => void;
  /** 调用方提供当前可见卡片 ID；批量改色为一次独立撤销事务。 */
  setBoardCardColors: (ids: string[], color: string) => void;
  /** 一次自由板缩放提交；保留既有类型尺寸限制，不与前后缩放或文本编辑合并。 */
  resizeBoardCard: (id: string, w: number, h: number) => void;

  /* 自由画布：节拍卡 / 灵感卡 */
  addBeat: (x: number, y: number, text?: string, kind?: Beat['kind'], material?: Pick<Beat, 'title' | 'img'>) => string;
  updateBeat: (id: string, patch: Partial<Beat>) => void;
  /** 自由板标题编辑确认后独立提交；不与正文输入或其他已完成的标题编辑合并。 */
  commitBoardCardTitle: (beatId: string, title: string) => void;
  /** resize 节拍卡到指定尺寸，coalesce 合并连续 resize；非法值由 clampSize 兜底 */
  resizeBeat: (id: string, w: number, h: number) => void;
  moveBeat: (id: string, x: number, y: number) => void;
  deleteBeat: (id: string) => void;
  linkBeat: (id: string, sceneId?: string) => void;
  addBoardLink: (from: string, to: string) => void;
  updateBoardLink: (id: string, patch: Partial<BoardLink>) => void;
  /** 自由板关系备注编辑确认后独立提交；旧即时更新 API 保持兼容。 */
  commitBoardLinkNote: (linkId: string, note: string) => void;
  deleteBoardLink: (id: string) => void;

  /* 多选 / 框选（自由板） */
  setSelectedIds: (ids: string[]) => void;
  toggleSelection: (id: string) => void;
  selectRange: (sortedIds: string[], anchor: string | null | undefined, target: string) => void;
  clearSelection: () => void;
  setWritingSelectionMode: (enabled: boolean) => void;
  setWritingSelectedIds: (ids: string[]) => void;
  toggleWritingSelection: (id: string) => void;
  clearWritingSelection: () => void;
  /** 批量删除自由板中选中的场景与卡片；场景删除包含正文整场内容。 */
  deleteSelectedBoardCards: () => { scenes: number; beats: number };
  /** 兼容旧调用方：只删除选中的 beats。 */
  deleteSelectedBeats: () => number;

  /* 人物 / 篇幅 */
  renameCharacter: (from: string, to: string) => boolean;
  setTargetPages: (pages: number) => void;

  /* 文档级 */
  updateSettings: (patch: Partial<ScriptSettings>) => void;
  updateIndent: (type: ElementType, patch: Partial<ScriptSettings['indent'][ElementType]>) => void;
  updateTitlePage: (patch: Partial<TitlePage>) => void;
  updateRevisions: (list: Revision[]) => void;
  renameProject: (name: string) => void;

  createNamedVersion: (name: string, expectedEpoch?: number) => boolean;
  renameNamedVersion: (id: string, name: string, expectedEpoch?: number) => boolean;
  deleteNamedVersion: (id: string, expectedEpoch?: number) => boolean;
  stashWritingElements: (ids: string[], name: string, note: string, remove: boolean, expectedEpoch?: number) => boolean;
  deleteStashEntry: (id: string, expectedEpoch?: number) => boolean;
  restoreWorkspaceContent: (source: WorkspaceSource, afterId: string | null, expectedEpoch?: number) => boolean;
  addAnnotation: (anchor: AnnotationAnchor, body: string, expectedEpoch?: number) => boolean;
  updateAnnotation: (id: string, patch: Partial<Pick<Annotation, 'body' | 'status' | 'reason' | 'decision'>>, expectedEpoch?: number) => boolean;
  deleteAnnotation: (id: string, expectedEpoch?: number) => boolean;
  reanchorAnnotation: (id: string, anchor: AnnotationAnchor, expectedEpoch?: number) => boolean;
  setDeliveryIgnored: (signature: string, ignored: boolean, expectedEpoch?: number) => boolean;
  clearDeliveryIgnored: (expectedEpoch?: number) => boolean;
  commitReviewSceneMeta: (elementId: string, patch: ReviewScenePatch, expectedEpoch?: number) => boolean;
  moveReviewScene: (sourceId: string, targetId: string, edge: 'before' | 'after', expectedEpoch?: number) => boolean;
}

export type WorkspaceSource = { kind: 'version'; id: string; elementIds: string[] } | { kind: 'stash'; id: string };
export type ReviewScenePatch = Pick<Partial<SceneMeta>, 'synopsis' | 'location' | 'storyTime' | 'revisionStatus'>;

const HISTORY_LIMIT = 120;

/* --------- 写作字体颜色：app 级外观设置，只存 localStorage，不写入 project --------- */
const LS_FONT_COLOR = 'guangying:fontColor';
const LS_APP_THEME = 'guangying:appTheme';
const LEGACY_LS_FONT_COLOR = 'mojiang:fontColor';
const LEGACY_LS_APP_THEME = 'mojiang:appTheme';
export { DEFAULT_FONT_COLOR } from '../model/appearance';

function loadFontColor(): string {
  try {
    const v = localStorage.getItem(LS_FONT_COLOR) || localStorage.getItem(LEGACY_LS_FONT_COLOR);
    // 校验合法性：localStorage 可能被手动改坏，脏值会污染 CSS 变量导致界面异常
    return normalizeFontColor(v);
  } catch {
    return DEFAULT_FONT_COLOR;
  }
}
function loadAppTheme(): AppTheme {
  try {
    const value = localStorage.getItem(LS_APP_THEME) || localStorage.getItem(LEGACY_LS_APP_THEME);
    return value === 'day' ? 'day' : 'night';
  } catch { return 'night'; }
}
const COALESCE_IDLE_MS = 1500;
const TEXT_GROUP_MAX_MS = 5000;
let lastCoalesce: { key: string; ts: number; startedAt: number } | null = null;

type BoardCardTarget = { kind: 'scene' | 'beat'; id: string };

/** 新自由板事务验证真实卡片；保留旧选择器使用无前缀 ID 的兼容能力。 */
function boardCardTarget(project: ScriptProject, raw: string): BoardCardTarget | null {
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
function historySelection(state: StoreState, project: ScriptProject) {
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
function projectChange(state: StoreState, next: ScriptProject, opts?: MutateOptions) {
  // Anchors and writing are one undo transaction. Unproven text edits retain the
  // original quote and mark it for review instead of searching for similar text.
  if (next.annotations?.length && next.elements !== state.project.elements) {
    next.annotations = reconcileAnnotations(state.project.elements, next.elements, next.annotations);
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

export const useStore = create<StoreState>((set, get) => ({
  project: createProject(),
  filePath: null,
  dirty: false,
  view: 'write',
  writingContext: null,
  sidebar: 'navigator',
  sidebarOpen: true,
  activeId: null,
  activeRev: null,
  focus: null,
  toast: null,
  version: 0,
  documentEpoch: 0,
  pageCount: 0,
  zoom: 1,
  fontColor: loadFontColor(),
  appTheme: loadAppTheme(),
  pdfExportMode: null,
  past: [],
  future: [],
  selectedIds: [],
  writingSelectionMode: false,
  writingSelectedIds: [],

  setView: (view) => {
    const state = get();
    if (!state.pdfExportMode && isWritingView(view)) state.updateWritingContext({ view });
    set({ view, ...(view !== 'write' ? { focus: null } : {}) });
  },
  updateWritingContext: (patch, expectedEpoch) => {
    const state = get();
    if (state.pdfExportMode || (expectedEpoch !== undefined && expectedEpoch !== state.documentEpoch)) return;
    const previous = state.writingContext || { version: 1 as const, projectId: state.project.id, view: 'write' as const };
    const context = validateWritingContext({ ...previous, ...patch, version: 1, projectId: state.project.id }, state.project.id);
    if (!context) return;
    // This is a bounded scalar object, never a project serialization/comparison.
    if (JSON.stringify(context) === JSON.stringify(previous)) return;
    context.updatedAt = Math.min(Number.MAX_SAFE_INTEGER, Math.max(Date.now(), (previous.updatedAt || 0) + 1));
    set({ writingContext: context });
  },
  setPdfExportMode: (pdfExportMode) => set({ pdfExportMode }),
  setSidebar: (s) => set({ sidebar: s, sidebarOpen: true }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  notify: (text, kind = 'info') => set({ toast: { text, kind, ts: Date.now() } }),
  setPageCount: (n) => set({ pageCount: n }),
  setZoom: (n) => set({ zoom: Math.max(0.6, Math.min(1.8, n)) }),

  setFontColor: (c) => {
    const fontColor = normalizeFontColor(c);
    try {
      localStorage.setItem(LS_FONT_COLOR, fontColor);
    } catch {
      /* 忽略存储失败 */
    }
    set({ fontColor });
  },
  setAppTheme: (appTheme) => {
    try { localStorage.setItem(LS_APP_THEME, appTheme); } catch { /* 忽略存储失败 */ }
    set({ appTheme });
  },

  loadProject: (p, filePath = null, context) => {
    const current = get();
    // Reopening the same file before the metadata timer fires must use the live
    // bookmark, not replace it with an older persisted position. An unassociated
    // in-memory load is a new session; draft recovery supplies its own context.
    const live = filePath !== null && current.project.id === p.id && current.filePath === filePath ? current.writingContext : null;
    const restored = resolveWritingContext(p, context === undefined ? live || loadStoredWritingContext(p.id, filePath) : context);
    // 启动恢复/打开工程建立独立历史，避免撤销上一文件内容却沿用当前文件路径。
    lastCoalesce = null;
    // 规范化幕标题：把「第2幕」这类阿拉伯数字写法统一为「第二幕」，避免格式不统一
    p.acts.forEach((a) => {
      const m = /^第(\d+)幕$/.exec(a.title);
      if (m) a.title = `第${cnNum(parseInt(m[1], 10))}幕`;
    });
    set((s) => ({
      project: p,
      view: restored.view,
      writingContext: restored,
      filePath,
      dirty: false,
      past: [],
      future: [],
      activeId: restored.activeId ?? null,
      focus: null,
      version: s.version + 1,
      documentEpoch: s.documentEpoch + 1,
      pageCount: 0,
      selectedIds: [],
      writingSelectionMode: false,
      writingSelectedIds: [],
    }));
  },

  newProject: () => {
    // 新建工程必须切断上一工程的 coalesce 状态，并使用真正空白的模板。
    lastCoalesce = null;
    const p = sampleProject();
    set((s) => ({
      project: p,
      view: 'write',
      writingContext: resolveWritingContext(p),
      filePath: null,
      dirty: false,
      past: [],
      future: [],
      activeId: p.elements[0]?.id ?? null,
      focus: null,
      version: s.version + 1,
      documentEpoch: s.documentEpoch + 1,
      pageCount: 0,
      selectedIds: [],
      writingSelectionMode: false,
      writingSelectedIds: [],
    }));
  },

  markSaved: (path, saved) => {
    const state = get();
    if (saved && state.documentEpoch !== saved.documentEpoch) return false;
    // 同一工程仍可绑定另存为路径；保存等待期间的后续修改不能被误标为已保存。
    set({ filePath: path, dirty: saved ? state.project !== saved.project : false });
    return true;
  },

  mutate: (fn, opts) => {
    const { project } = get();
    // Review libraries are immutable branches. Ordinary typing/structure edits
    // must not duplicate every saved version into every undo snapshot.
    const { revisionWorkspace, annotations, ...body } = project;
    const next = cloneProject(body as ScriptProject);
    if (revisionWorkspace) next.revisionWorkspace = revisionWorkspace;
    if (annotations) next.annotations = annotations;
    fn(next);
    // 组件可能在每次输入事件都调用 mutate；没有实际数据变化时不应制造
    // 撤销点、清空重做栈或把 dirty 标成 true。
    const { revisionWorkspace: nextWorkspace, annotations: nextAnnotations, ...nextBody } = next;
    if (nextWorkspace === revisionWorkspace && nextAnnotations === annotations && JSON.stringify(nextBody) === JSON.stringify(body)) {
      lastCoalesce = null;
      return;
    }
    set(projectChange(get(), next, opts));
  },

  breakHistoryGroup: () => { lastCoalesce = null; },

  undo: () => {
    const state = get();
    const { past, project, future } = state;
    lastCoalesce = null;
    if (!past.length) {
      get().notify('没有可撤销的操作');
      return;
    }
    const prev = past[past.length - 1];
    set({
      project: prev,
      past: past.slice(0, -1),
      future: [project, ...future].slice(0, HISTORY_LIMIT),
      dirty: true,
      version: state.version + 1,
      ...historySelection(state, prev),
    });
  },

  redo: () => {
    const state = get();
    const { past, project, future } = state;
    lastCoalesce = null;
    if (!future.length) {
      get().notify('没有可重做的操作');
      return;
    }
    const next = future[0];
    set({
      project: next,
      past: [...past, project].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      dirty: true,
      version: state.version + 1,
      ...historySelection(state, next),
    });
  },

  setActive: (id) => {
    const state = get();
    if (state.activeId !== id) state.updateWritingContext({ activeId: id || undefined, caret: undefined });
    set({ activeId: id });
  },
  requestFocus: (id, caret = 'end', scroll = 'nearest') => {
    get().updateWritingContext({ activeId: id, caret: typeof caret === 'number' ? caret : caret === 'start' ? 0 : undefined });
    set({ focus: { id, caret, scroll, ts: Date.now() }, activeId: id });
  },

  insertAfter: (id, type = 'action', text = '') => {
    const el = newElement(type, text);
    get().mutate((p) => {
      const idx = id ? p.elements.findIndex((e) => e.id === id) : -1;
      const at = idx < 0 ? p.elements.length : idx + 1;
      p.elements.splice(at, 0, el);
    });
    get().requestFocus(el.id, 'end');
    return el.id;
  },

  splitBlock: (id, before, after, nextType) => {
    const nid = uid('el');
    get().mutate((p) => {
      const idx = p.elements.findIndex((e) => e.id === id);
      if (idx < 0) return;
      const cur = p.elements[idx];
      cur.text = before;
      const next: ScriptElement = { id: nid, type: nextType, text: after };
      const d = dualAfterEnter(cur, nextType);
      if (d.dual) {
        next.dual = d.dual;
        next.dualGroup = cur.dualGroup || uid('dg');
        cur.dualGroup = next.dualGroup;
      }
      p.elements.splice(idx + 1, 0, next);
    });
    get().requestFocus(nid, 'start');
    return nid;
  },

  replaceWritingRange: (ids, before, after, inserted, nextType) => {
    const { project } = get();
    const elements = project.elements;
    const start = Array.isArray(ids) && ids.length ? elements.findIndex(e => e.id === ids[0]) : -1;
    if (start < 0 || new Set(ids).size !== ids.length ||
        ids.some((id, offset) => elements[start + offset]?.id !== id)) {
      lastCoalesce = null;
      return null;
    }
    const first = elements[start];
    const removed = new Set(ids.slice(1));
    // 素材使用规范 SceneMeta.id；旧工程也可能关联场次元素 ID 或用其作为线端点。
    const removedAssociations = new Set([
      ...removed,
      ...project.sceneMeta.filter(meta => removed.has(meta.elementId)).map(meta => meta.id),
    ]);
    const nextId = nextType ? uid('el') : first.id;
    get().mutate(p => {
      p.elements = p.elements.filter(e => !removed.has(e.id));
      const index = p.elements.findIndex(e => e.id === first.id);
      const current = p.elements[index];
      current.text = before + inserted + (nextType ? '' : after);
      if (nextType) {
        const next: ScriptElement = { id: nextId, type: nextType, text: after };
        const dual = dualAfterEnter(current, nextType);
        if (dual.dual) {
          next.dual = dual.dual;
          next.dualGroup = current.dualGroup || uid('dg');
          current.dualGroup = next.dualGroup;
        }
        p.elements.splice(index + 1, 0, next);
      }
      p.sceneMeta = p.sceneMeta.filter(meta => !removed.has(meta.elementId));
      p.beats.forEach(beat => { if (beat.sceneId && removedAssociations.has(beat.sceneId)) delete beat.sceneId; });
      p.boardLinks = filterBoardLinksToKeep(p.boardLinks || [], removedAssociations);
    });
    return nextId;
  },

  commitSmartType: (id, expectedText, expectedType, html, targetType, expectedEpoch) => {
    const state = get();
    const current = state.project.elements.find(element => element.id === id);
    if (state.documentEpoch !== expectedEpoch || !current ||
        current.text !== expectedText || current.type !== expectedType ||
        (targetType !== current.type && (current.dual || current.dualGroup)) ||
        (targetType !== current.type && !['character', 'scene_heading', 'shot', 'transition'].includes(targetType))) {
      lastCoalesce = null;
      return false;
    }
    // Never call setText then setType: that would split a single acceptance into
    // two undos. The existing mutate path preserves immutable saved snapshots.
    get().mutate(project => {
      const element = project.elements.find(item => item.id === id)!;
      element.text = html;
      element.type = targetType;
      if (!['character', 'parenthetical', 'dialogue'].includes(targetType)) {
        delete element.dual;
        delete element.dualGroup;
      }
    });
    return true;
  },

  setType: (id, type) => {
    get().mutate((p) => {
      const el = p.elements.find((e) => e.id === id);
      if (!el) return;
      el.type = type;
      if (type !== 'character' && type !== 'parenthetical' && type !== 'dialogue') {
        delete el.dual;
        delete el.dualGroup;
      }
    });
  },

  setText: (id, text) => {
    const state = get();
    const { project } = state;
    const index = project.elements.findIndex((e) => e.id === id);
    if (index < 0 || project.elements[index].text === text) {
      // 与 mutate 的 no-op 完全一致：保留 redo/dirty/version，只切断合并窗口。
      lastCoalesce = null;
      return;
    }
    // 输入性能红线：只复制元素列表和当前段落，禁止每个字 JSON 复制整个工程。
    // 未改段落 / 图片 / 设置保持引用；后续通用 mutate 仍深拷贝，保护撤销快照。
    const elements = project.elements.slice();
    elements[index] = { ...elements[index], text };
    set(projectChange(state, { ...project, elements }, { coalesce: `text:${id}` }));
  },

  removeElement: (id) => {
    const { project, requestFocus } = get();
    const idx = project.elements.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const prev = project.elements[idx - 1];
    get().mutate((p) => {
      p.elements.splice(idx, 1);
    });
    if (prev) requestFocus(prev.id, 'end');
  },

  moveElement: (id, dir) => {
    get().mutate((p) => {
      const idx = p.elements.findIndex((e) => e.id === id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= p.elements.length) return;
      const [el] = p.elements.splice(idx, 1);
      p.elements.splice(to, 0, el);
    });
  },

  mergeIntoPrevious: (id) => {
    const { project } = get();
    const idx = project.elements.findIndex((e) => e.id === id);
    if (idx <= 0) return null;
    const prev = project.elements[idx - 1];
    const offset = searchText(prev.text).length;
    const removedAssociations = new Set([
      id,
      ...project.sceneMeta.filter(meta => meta.elementId === id).map(meta => meta.id),
    ]);
    get().mutate((p) => {
      const a = p.elements[idx - 1];
      const b = p.elements[idx];
      a.text = a.text + b.text;
      p.elements.splice(idx, 1);
      p.sceneMeta = p.sceneMeta.filter(meta => meta.elementId !== id);
      p.beats.forEach(beat => { if (beat.sceneId && removedAssociations.has(beat.sceneId)) delete beat.sceneId; });
      p.boardLinks = filterBoardLinksToKeep(p.boardLinks || [], removedAssociations);
    });
    get().requestFocus(prev.id, offset);
    return { id: prev.id, offset };
  },

  toggleOmit: (id) => {
    get().mutate((p) => {
      const el = p.elements.find((e) => e.id === id);
      if (el) el.omit = !el.omit;
    });
  },

  setRevision: (id, revId) => {
    get().mutate((p) => {
      const el = p.elements.find((e) => e.id === id);
      if (!el) return;
      if (revId) el.rev = revId;
      else delete el.rev;
    });
  },

  setDual: (id, dual) => {
    get().mutate((p) => {
      const el = p.elements.find((e) => e.id === id);
      if (!el) return;
      if (!dual) {
        delete el.dual;
        delete el.dualGroup;
        return;
      }
      el.dual = dual;
      // 与相邻的双列元素归为一组
      const idx = p.elements.findIndex((e) => e.id === id);
      const neighbor = p.elements[idx - 1] || p.elements[idx + 1];
      el.dualGroup = neighbor?.dualGroup || uid('dg');
    });
  },

  updateSceneMeta: (elementId, patch) => {
    get().mutate(
      (p) => {
        let m = p.sceneMeta.find((s) => s.elementId === elementId);
        if (!m) {
          m = { id: uid('sc'), elementId, title: '', synopsis: '', color: '#cfe4ff' };
          p.sceneMeta.push(m);
        }
        Object.assign(m, patch);
      },
      { coalesce: `scene:${elementId}` },
    );
  },

  /**
   * resize 场景卡：与 updateSceneMeta 共享同一条 mutate，但走独立 coalesce key，
   * 让连续 resize 不与 synopsis / title 编辑混在同一 undo 步。
   * 非法输入（NaN / Infinity / 负数 / 巨大数）由 clampSize('scene', ...) 兜底。
   */
  resizeSceneMeta: (elementId, w, h) => {
    get().mutate(
      (p) => {
        let m = p.sceneMeta.find((s) => s.elementId === elementId);
        if (!m) {
          m = { id: uid('sc'), elementId, title: '', synopsis: '', color: '#cfe4ff' };
          p.sceneMeta.push(m);
        }
        const next = clampSize('scene', w, h);
        m.w = next.w;
        m.h = next.h;
      },
      { coalesce: `sceneresize:${elementId}` },
    );
  },

  moveScene: (index, dir) => get().moveSceneTo(index, index + dir),

  moveSceneTo: (from, to) => {
    const scenes = deriveScenes(get().project);
    if (!Number.isInteger(from) || !Number.isInteger(to) || !scenes[from]) return;
    const target = Math.max(0, Math.min(scenes.length - 1, to));
    if (target !== from) get().moveReviewScene(scenes[from].elementId, scenes[target].elementId, target > from ? 'after' : 'before');
  },

  /**
   * 故事板拖拽落位：把场景移动到目标位置，同时归入目标幕。
   * 必须合并为一次 mutate —— 若拆成 moveSceneTo + updateSceneMeta 两次调用，
   * 会产生两条撤销记录，用户按一次 Cmd+Z 只能回退一半（表现为「撤销不了」）。
   */
  dropSceneInAct: (_from, to, elementId, actId) => {
    // 旧调用兼容；未归幕的新契约是只解除归属，不移动正文。
    const scenes = deriveScenes(get().project);
    if (!Number.isInteger(to)) return;
    const target = scenes[to];
    get().moveScenesToAct([elementId], actId,
      actId && target?.actId === actId ? { targetId: target.elementId, edge: 'before' } : undefined);
  },

  moveScenesToAct: (ids, actId, placement) => get().mutate(p => moveStoryboardScenes(p, ids, actId, placement)),

  addSceneAfter: (elementId) => {
    const { insertAfter, project } = get();
    const idx = project.elements.findIndex((e) => e.id === elementId);
    if (idx < 0) return;
    // 跳到该场景末尾
    let end = idx + 1;
    while (end < project.elements.length && project.elements[end].type !== 'scene_heading') end += 1;
    const before = project.elements[end - 1];
    const id = insertAfter(before.id, 'scene_heading');
    insertAfter(id, 'action');
  },

  deleteScene: (elementId) => {
    const exists = get().project.elements.some((el) => el.id === elementId && el.type === 'scene_heading');
    if (!exists) return false;
    set({ selectedIds: [`scene:${elementId}`] });
    return get().deleteSelectedBoardCards().scenes > 0;
  },

  updateAct: (id, patch) => {
    get().mutate((p) => {
      const a = p.acts.find((x) => x.id === id);
      if (a) Object.assign(a, patch);
    });
  },

  addAct: () => {
    const id = uid('act');
    get().mutate((p) => {
      p.acts.push({ id, title: `第${cnNum(p.acts.length + 1)}幕`, color: '#cfe4ff' });
    });
  },

  removeAct: (id) => {
    get().mutate((p) => {
      p.acts = p.acts.filter((a) => a.id !== id);
      p.sceneMeta.forEach((m) => {
        if (m.actId === id) delete m.actId;
      });
    });
  },

  setScenePos: (elementId, x, y) => {
    get().mutate(
      (p) => {
        let m = p.sceneMeta.find((s) => s.elementId === elementId);
        if (!m) {
          m = { id: uid('sc'), elementId, title: '', synopsis: '', color: '#cfe4ff' };
          p.sceneMeta.push(m);
        }
        m.x = x;
        m.y = y;
      },
      { coalesce: `scenepos:${elementId}` },
    );
  },

  moveBoardCards: (positions) => {
    const project = get().project;
    if (!Array.isArray(positions)) {
      lastCoalesce = null;
      return;
    }
    const movements = new Map<string, BoardCardPosition & { target: BoardCardTarget }>();
    for (const position of positions) {
      const target = position && boardCardTarget(project, position.id);
      if (!target || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
        lastCoalesce = null;
        return;
      }
      // 同一卡片只采用最后一个落点；原位批次不因中间重复项制造历史。
      movements.set(`${target.kind}:${target.id}`, { ...position, target });
    }
    get().mutate((p) => {
      for (const position of movements.values()) {
        const { target } = position;
        if (target.kind === 'scene') {
          let meta = p.sceneMeta.find((item) => item.elementId === target.id);
          if (!meta) {
            meta = { id: uid('sc'), elementId: target.id, title: '', synopsis: '', color: '#cfe4ff' };
            p.sceneMeta.push(meta);
          }
          meta.x = position.x;
          meta.y = position.y;
        } else {
          const beat = p.beats.find((item) => item.id === target.id)!;
          const current = boardBeatPosition(beat);
          // 原位拖动不为旧工程凭空增加 boardX/boardY，也不清空 redo。
          if (current.x === position.x && current.y === position.y) continue;
          beat.boardX = position.x;
          beat.boardY = position.y;
        }
      }
    });
  },

  addBoardScene: (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      lastCoalesce = null;
      return null;
    }
    const heading = newElement('scene_heading');
    const action = newElement('action');
    get().mutate((p) => {
      // 与 addSceneAfter 的空场布局相同；最后一场的完整正文保留在新场之前。
      p.elements.push(heading, action);
      p.sceneMeta.push({ id: uid('sc'), elementId: heading.id, title: '', synopsis: '', color: '#cfe4ff', x, y });
    });
    return heading.id;
  },

  setBoardCardColors: (ids, color) => {
    const project = get().project;
    if (!Array.isArray(ids) || typeof color !== 'string' || !color || ids.some((id) => !boardCardTarget(project, id))) {
      lastCoalesce = null;
      return;
    }
    get().mutate((p) => {
      for (const id of new Set(ids)) {
        const target = boardCardTarget(p, id)!;
        if (target.kind === 'scene') {
          let meta = p.sceneMeta.find((item) => item.elementId === target.id);
          if (!meta) {
            if (color === '#cfe4ff') continue;
            meta = { id: uid('sc'), elementId: target.id, title: '', synopsis: '', color: '#cfe4ff' };
            p.sceneMeta.push(meta);
          }
          meta.color = color;
        } else {
          p.beats.find((item) => item.id === target.id)!.color = color;
        }
      }
    });
  },

  resizeBoardCard: (id, w, h) => {
    const target = boardCardTarget(get().project, id);
    if (!target) {
      lastCoalesce = null;
      return;
    }
    get().mutate((p) => {
      if (target.kind === 'scene') {
        let meta = p.sceneMeta.find((item) => item.elementId === target.id);
        if (!meta) {
          meta = { id: uid('sc'), elementId: target.id, title: '', synopsis: '', color: '#cfe4ff' };
          p.sceneMeta.push(meta);
        }
        const next = clampSize('scene', w, h);
        meta.w = next.w;
        meta.h = next.h;
      } else {
        const beat = p.beats.find((item) => item.id === target.id)!;
        const next = clampSize(beat.kind, w, h);
        beat.w = next.w;
        beat.h = next.h;
      }
    });
  },

  addBeat: (x, y, text = '', kind, material) => {
    const id = uid('bt');
    get().mutate((p) => {
      const color = kind === 'sound' ? '#ccb887' : '#fff7d6';
      // 图片读取成功后一次写入完整卡片；一次撤销不能留下无图的空卡。
      const beat: Beat = { id, text, color, x, y, ...material };
      if (kind) beat.kind = kind;
      p.beats.push(beat);
    });
    return id;
  },

  updateBeat: (id, patch) => {
    get().mutate(
      (p) => {
        const b = p.beats.find((x) => x.id === id);
        if (b) Object.assign(b, patch);
      },
      { coalesce: `beat:${id}` },
    );
  },

  commitBoardCardTitle: (beatId, title) => {
    get().mutate((p) => {
      const beat = p.beats.find((item) => item.id === beatId);
      if (!beat || typeof title !== 'string' || (beat.title ?? '') === title) return;
      beat.title = title;
    });
  },

  /**
   * resize 节拍卡：使用独立 coalesce key（`beatresize:${id}`），与 text 编辑互不干扰。
   * 非法输入（NaN / Infinity / 负数 / 巨大数）由 clampSize 收敛到合法区间。
   */
  resizeBeat: (id, w, h) => {
    get().mutate(
      (p) => {
        const b = p.beats.find((x) => x.id === id);
        if (!b) return;
        const next = clampSize(b.kind, w, h);
        b.w = next.w;
        b.h = next.h;
      },
      { coalesce: `beatresize:${id}` },
    );
  },

  moveBeat: (id, x, y) => {
    get().mutate(
      (p) => {
        const b = p.beats.find((x) => x.id === id);
        if (b) {
          b.x = x;
          b.y = y;
        }
      },
      { coalesce: `beatmove:${id}` },
    );
  },

  deleteBeat: (id) => {
    get().mutate((p) => {
      p.beats = p.beats.filter((x) => x.id !== id);
      p.boardLinks = (p.boardLinks || []).filter((link) => link.from !== `beat:${id}` && link.to !== `beat:${id}`);
    });
  },

  linkBeat: (id, sceneId) => {
    get().mutate((p) => {
      const b = p.beats.find((x) => x.id === id);
      if (b) b.sceneId = sceneId;
    });
  },

  addBoardLink: (from, to) => {
    if (!from || !to || from === to) return;
    get().mutate((p) => {
      const links = (p.boardLinks ||= []);
      if (links.some((link) => (link.from === from && link.to === to) || (link.from === to && link.to === from))) return;
      links.push({ id: uid('link'), from, to, note: '' });
    });
  },

  updateBoardLink: (id, patch) => {
    get().mutate(
      (p) => {
        const link = (p.boardLinks || []).find((x) => x.id === id);
        if (link) Object.assign(link, patch);
      },
      { coalesce: `boardlink:${id}` },
    );
  },

  commitBoardLinkNote: (linkId, note) => {
    get().mutate((p) => {
      const link = (p.boardLinks || []).find((item) => item.id === linkId);
      if (!link || typeof note !== 'string' || (link.note ?? '') === note) return;
      link.note = note;
    });
  },

  deleteBoardLink: (id) => {
    get().mutate((p) => {
      p.boardLinks = (p.boardLinks || []).filter((link) => link.id !== id);
    });
  },

  /* 多选 / 框选（自由板） */
  setSelectedIds: (ids) => set({ selectedIds: Array.isArray(ids) ? ids : [] }),

  toggleSelection: (id) => {
    set((s) => ({ selectedIds: toggleSel(s.selectedIds, id) }));
  },

  selectRange: (sortedIds, anchor, target) => {
    set((s) => ({
      selectedIds: selRange(s.selectedIds, sortedIds, anchor, target),
    }));
  },

  clearSelection: () => set({ selectedIds: clearSel() }),

  setWritingSelectionMode: (enabled) => set({ writingSelectionMode: enabled, writingSelectedIds: enabled ? get().writingSelectedIds : [] }),
  setWritingSelectedIds: (ids) => {
    const valid = new Set(get().project.elements.map((el) => el.id));
    set({ writingSelectedIds: [...new Set(ids)].filter((id) => valid.has(id)) });
  },
  toggleWritingSelection: (id) => set((s) => ({ writingSelectedIds: toggleSel(s.writingSelectedIds, id) })),
  clearWritingSelection: () => set({ writingSelectedIds: [] }),

  deleteWritingElements: (ids) => {
    const before = get();
    const previousElements = before.project.elements;
    const removed = new Set(ids.filter((id) => previousElements.some((el) => el.id === id)));
    if (!removed.size) return;
    // 如果当前编辑段落仍在，删除其他段落不能把作者突然带回文稿开头。
    // 当前段落被删时，优先落到其后的幸存段；没有则落到前一段。
    const activeIndex = previousElements.findIndex((el) => el.id === before.activeId);
    const survivors = previousElements.filter((el) => !removed.has(el.id));
    const nextActiveId = before.activeId && !removed.has(before.activeId)
      ? before.activeId
      : survivors[Math.min(Math.max(activeIndex, 0), survivors.length - 1)]?.id ?? null;
    get().mutate((p) => {
      p.elements = p.elements.filter((el) => !removed.has(el.id));
      if (!p.elements.length) p.elements = [newElement('action', '')];
      const associations = new Set([...removed, ...p.sceneMeta.filter(meta => removed.has(meta.elementId)).map(meta => meta.id)]);
      p.sceneMeta = p.sceneMeta.filter((meta) => !removed.has(meta.elementId));
      p.beats.forEach((beat) => { if (beat.sceneId && associations.has(beat.sceneId)) delete beat.sceneId; });
      p.boardLinks = filterBoardLinksToKeep(p.boardLinks || [], associations);
    });
    set({ activeId: nextActiveId || get().project.elements[0]?.id || null, focus: null, writingSelectedIds: [] });
  },

  deleteSelectedBoardCards: () => {
    const ids = get().selectedIds;
    if (!ids || ids.length === 0) return { scenes: 0, beats: 0 };
    const project = get().project;
    const scenes = deriveScenes(project);
    const sceneIdSet = new Set(scenes.map((scene) => scene.elementId));
    const beatIdSet = new Set(project.beats.map((beat) => beat.id));
    const selected = splitBoardSelection(ids, sceneIdSet, beatIdSet);
    if (selected.sceneIds.length === 0 && selected.beatIds.length === 0) return { scenes: 0, beats: 0 };

    const selectedScenes = new Set(selected.sceneIds);
    const selectedBeats = new Set(selected.beatIds);
    // Beat.sceneId 使用 SceneMeta.id；旧工程也可能保存场景标题元素 ID。
    // 删除元数据前收齐两种关联值，解除幸存素材对已删除场景的引用。
    const removedSceneAssociations = new Set([
      ...selected.sceneIds,
      ...project.sceneMeta.filter((meta) => selectedScenes.has(meta.elementId)).map((meta) => meta.id),
    ]);
    const removedElementIds = new Set<string>();
    scenes.forEach((scene) => {
      if (!selectedScenes.has(scene.elementId)) return;
      for (let i = scene.start; i < scene.end; i += 1) {
        const el = project.elements[i];
        if (el) removedElementIds.add(el.id);
      }
    });

    get().mutate((p) => {
      p.elements = p.elements.filter((el) => !removedElementIds.has(el.id));
      p.sceneMeta = p.sceneMeta.filter((meta) => !selectedScenes.has(meta.elementId));
      p.beats = p.beats
        .filter((beat) => !selectedBeats.has(beat.id))
        .map((beat) => {
          if (beat.sceneId && removedSceneAssociations.has(beat.sceneId)) {
            const next = { ...beat };
            delete next.sceneId;
            return next;
          }
          return beat;
        });
      const removedEndpoints = new Set([...removedElementIds, ...selected.sceneIds, ...selected.beatIds]);
      p.boardLinks = filterBoardLinksToKeep(p.boardLinks || [], removedEndpoints);
    });
    const remaining = get().project.elements;
    const currentActive = get().activeId;
    set({
      selectedIds: [],
      activeId: currentActive && remaining.some((el) => el.id === currentActive) ? currentActive : (remaining[0]?.id ?? null),
      focus: null,
    });
    return { scenes: selected.sceneIds.length, beats: selected.beatIds.length };
  },

  /**
   * 旧接口保留给历史调用方；新 UI 统一使用 deleteSelectedBoardCards。
   */
  deleteSelectedBeats: () => {
    return get().deleteSelectedBoardCards().beats;
  },

  renameCharacter: (from, to) => {
    const nextName = to.trim();
    if (!nextName || nextName === from) return false;
    const exists = get().project.elements.some((el) => el.type === 'character' && plain(el.text).trim() === nextName);
    if (exists) {
      get().notify('已有同名人物，请先合并或使用其他名称', 'error');
      return false;
    }
    let changed = 0;
    get().mutate((p) => {
      p.elements.forEach((el) => {
        if (el.type === 'character' && plain(el.text).trim() === from) {
          el.text = nextName;
          changed += 1;
        }
      });
    });
    if (changed) get().notify(`已将 ${from} 改为 ${nextName}`, 'ok');
    return changed > 0;
  },

  setTargetPages: (pages) => {
    // 边界兜底：0 / 负数 / NaN / 非数 → 0（关闭目标页数，进度条隐藏）
    // >9999 → 9999；整数化后落入 [0, 9999]。
    const next = clampTargetPages(pages);
    get().mutate(
      (p) => {
        p.targetPages = next;
      },
      { coalesce: 'target-pages' },
    );
  },

  updateSettings: (patch) => {
    get().mutate((p) => {
      Object.assign(p.settings, patch);
      p.settings.indent = p.settings.indent; // 保持引用
    });
  },

  updateIndent: (type, patch) => {
    get().mutate((p) => {
      p.settings.indent[type] = { ...p.settings.indent[type], ...patch };
    });
  },

  updateTitlePage: (patch) => {
    get().mutate(
      (p) => {
        Object.assign(p.titlePage, patch);
      },
      { coalesce: 'titlepage' },
    );
  },

  updateRevisions: (list) => {
    get().mutate((p) => {
      p.revisions = list;
    });
  },

  renameProject: (name) => {
    get().mutate(
      (p) => {
        p.name = name;
      },
      { coalesce: 'rename' },
    );
  },

  createNamedVersion: (name, epoch) => reviewChange(epoch, project => ({ ...project, revisionWorkspace: createNamedVersion(project, name) })),
  renameNamedVersion: (id, name, epoch) => reviewChange(epoch, project => {
    if (!project.revisionWorkspace) throw new Error('该正文版本已不存在。');
    const revisionWorkspace = renameNamedVersion(project.revisionWorkspace, id, name);
    return revisionWorkspace === project.revisionWorkspace ? project : { ...project, revisionWorkspace };
  }),
  deleteNamedVersion: (id, epoch) => reviewChange(epoch, project => {
    if (!project.revisionWorkspace) throw new Error('该正文版本已不存在。');
    return { ...project, revisionWorkspace: deleteNamedVersion(project.revisionWorkspace, id) };
  }),
  stashWritingElements: (ids, name, note, remove, epoch) => reviewChange(epoch, project => {
    const available = new Set(project.elements.map(element => element.id));
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !available.has(id))) {
      throw new Error('所选原文已变化，请重新选择后存入暂存。');
    }
    const content = captureWritingFragment(project, { kind: 'elements', ids });
    const firstIndex = project.elements.findIndex(element => element.id === content.elements[0]?.id);
    const scene = deriveScenes(project).find(item => firstIndex >= item.start && firstIndex < item.end);
    // Capture and capacity validation happen before any deletion.
    const revisionWorkspace = createStashEntry(project.revisionWorkspace, content, {
      name, description: note, kind: remove ? 'deleted' : 'excerpt',
      source: { projectId: project.id, sceneHeadingId: scene?.elementId, sceneLabel: scene?.heading.slice(0, 2000), elementIds: content.elements.map(element => element.id) },
    });
    return { ...(remove ? removeReviewElements(project, new Set(ids)) : project), revisionWorkspace };
  }),
  deleteStashEntry: (id, epoch) => reviewChange(epoch, project => {
    if (!project.revisionWorkspace) throw new Error('该暂存条目已不存在。');
    return { ...project, revisionWorkspace: deleteStashEntry(project.revisionWorkspace, id) };
  }),
  restoreWorkspaceContent: (source, afterId, epoch) => {
    let warnings: string[] = [];
    const restored = reviewChange(epoch, project => {
    if (afterId === null && project.elements.length) throw new Error('请先选择一个正文插入位置。');
    const index = afterId === null ? -1 : project.elements.findIndex(element => element.id === afterId);
    if (afterId !== null && index < 0) throw new Error('插入位置已不存在，请关闭工作台并重新选择位置。');
    const entry = source.kind === 'version'
      ? project.revisionWorkspace?.versions.find(item => item.id === source.id)
      : project.revisionWorkspace?.stash.find(item => item.id === source.id);
    if (!entry) throw new Error('取回来源已不存在。');
    const content = source.kind === 'version'
      ? captureWritingFragment({ ...project, elements: entry.content.elements, sceneMeta: entry.content.sceneMeta }, { kind: 'elements', ids: source.elementIds })
      : entry.content;
    const plan = buildInsertPlan(content, project);
    warnings = plan.warnings;
    if (!plan.elements.length) throw new Error('请选择要取回的段落。');
    if (project.elements.length + plan.elements.length > 100000 || project.sceneMeta.length + plan.sceneMeta.length > 100000) {
      throw new Error('取回内容超过工程容量，请减少所选段落。');
    }
    return { ...project, elements: [...project.elements.slice(0, index + 1), ...plan.elements, ...project.elements.slice(index + 1)], sceneMeta: [...project.sceneMeta, ...plan.sceneMeta] };
    });
    if (restored && warnings.length) get().notify(`已插入副本。${warnings.join('')}`);
    return restored;
  },
  addAnnotation: (anchor, body, epoch) => reviewChange(epoch, project => {
    assertReviewAnchor(project, anchor);
    const now = Date.now();
    const annotation: Annotation = { id: uid('annotation'), createdAt: now, updatedAt: now, body: body.trim(), status: 'pending', anchor, anchorState: 'current' };
    const annotations = validateAnnotations([...(project.annotations || []), annotation]);
    return { ...project, annotations };
  }),
  updateAnnotation: (id, patch, epoch) => reviewChange(epoch, project => {
    if (!patch || Object.keys(patch).some(key => !['body', 'status', 'reason', 'decision'].includes(key))) throw new Error('批注修改内容无效。');
    const current = project.annotations?.find(item => item.id === id);
    if (!current) throw new Error('该批注已不存在。');
    const next = { ...current, ...patch };
    if (JSON.stringify(next) === JSON.stringify(current)) return project;
    next.updatedAt = Date.now();
    return { ...project, annotations: validateAnnotations(project.annotations!.map(item => item.id === id ? next : item)) };
  }),
  deleteAnnotation: (id, epoch) => reviewChange(epoch, project => {
    if (!project.annotations?.some(item => item.id === id)) return project;
    return { ...project, annotations: project.annotations.filter(item => item.id !== id) };
  }),
  reanchorAnnotation: (id, anchor, epoch) => reviewChange(epoch, project => {
    assertReviewAnchor(project, anchor);
    const current = project.annotations?.find(item => item.id === id);
    if (!current) throw new Error('该批注已不存在。');
    const next = reanchorAnnotation(current, anchor, Date.now());
    return { ...project, annotations: validateAnnotations(project.annotations!.map(item => item.id === id ? next : item)) };
  }),
  setDeliveryIgnored: (signature, ignored, epoch) => reviewChange(epoch, project => {
    const existing = project.deliveryIgnored || [];
    if (existing.includes(signature) === ignored) return project;
    if (ignored && !buildDeliveryChecks(project).some(issue => issue.signature === signature)) throw new Error('检查结果已变化，请重新检查。');
    return { ...project, deliveryIgnored: normalizeDeliveryIgnored(ignored ? [...existing, signature] : existing.filter(item => item !== signature)) };
  }),
  clearDeliveryIgnored: epoch => reviewChange(epoch, project => project.deliveryIgnored?.length ? { ...project, deliveryIgnored: [] } : project),
  commitReviewSceneMeta: (elementId, patch, epoch) => reviewChange(epoch, project => {
    if (!project.elements.some(element => element.id === elementId && element.type === 'scene_heading')) throw new Error('该场景已不存在。');
    const keys = Object.keys(patch);
    if (keys.some(key => !['synopsis', 'location', 'storyTime', 'revisionStatus'].includes(key))) throw new Error('场景信息格式无效。');
    for (const key of ['synopsis', 'location', 'storyTime'] as const) {
      if (patch[key] !== undefined && (typeof patch[key] !== 'string' || patch[key]!.length > (key === 'synopsis' ? 20000 : 500))) throw new Error('场景信息过长或格式无效。');
    }
    if (patch.revisionStatus !== undefined && !['todo', 'revising', 'done'].includes(patch.revisionStatus)) throw new Error('场景修改状态无效。');
    const current = project.sceneMeta.find(meta => meta.elementId === elementId);
    if (!keys.length || (!current && keys.every(key => patch[key as keyof ReviewScenePatch] === undefined || patch[key as keyof ReviewScenePatch] === ''))) return project;
    if (current && keys.every(key => current[key as keyof SceneMeta] === patch[key as keyof ReviewScenePatch])) return project;
    const next: SceneMeta = { ...(current || { id: uid('sc'), elementId, title: '', synopsis: '', color: '#cfe4ff' }), ...patch };
    return { ...project, sceneMeta: current ? project.sceneMeta.map(meta => meta === current ? next : meta) : [...project.sceneMeta, next] };
  }),
  moveReviewScene: (sourceId, targetId, edge, epoch) => reviewChange(epoch, project => {
    if (edge !== 'before' && edge !== 'after') throw new Error('场景移动位置无效。');
    const elements = reorderOutlineScene(project.elements, sourceId, targetId, edge);
    return elements ? { ...project, elements } : project;
  }),
}));

/** Validate before committing, including the document session captured by a modal. */
function reviewChange(expectedEpoch: number | undefined, make: (project: ScriptProject) => ScriptProject): boolean {
  const state = useStore.getState();
  if (expectedEpoch !== undefined && state.documentEpoch !== expectedEpoch) {
    state.notify('工程已切换，请重新打开改稿工作台。', 'error');
    return false;
  }
  try {
    const next = make(state.project);
    if (next === state.project) return false;
    useStore.setState({ ...projectChange(state, next), ...historySelection(state, next) });
    return true;
  } catch (error) {
    state.notify(error instanceof Error ? error.message : '操作未完成，原稿保持不变。', 'error');
    return false;
  }
}

function assertReviewAnchor(project: ScriptProject, anchor: AnnotationAnchor) {
  const element = project.elements.find(item => item.id === anchor.elementId);
  if (!element) throw new Error('批注原文已不存在，请重新选择。');
  const expected = anchor.kind === 'scene' ? captureSceneAnchor(element) : captureTextAnchor(element, anchor.start, anchor.end);
  if (!expected || expected.kind !== anchor.kind || expected.elementId !== anchor.elementId ||
      (expected.kind === 'text' && anchor.kind === 'text' && (expected.start !== anchor.start || expected.end !== anchor.end || expected.quote !== anchor.quote || expected.sourceText !== anchor.sourceText))) {
    throw new Error('批注原文已变化，请重新选择。');
  }
}

function removeReviewElements(project: ScriptProject, removed: Set<string>): ScriptProject {
  const associations = new Set([...removed, ...project.sceneMeta.filter(meta => removed.has(meta.elementId)).map(meta => meta.id)]);
  const elements = project.elements.filter(element => !removed.has(element.id));
  return { ...project, elements: elements.length ? elements : [newElement('action', '')],
    sceneMeta: project.sceneMeta.filter(meta => !removed.has(meta.elementId)),
    beats: project.beats.map(beat => {
      if (!beat.sceneId || !associations.has(beat.sceneId)) return beat;
      const next = { ...beat }; delete next.sceneId; return next;
    }), boardLinks: filterBoardLinksToKeep(project.boardLinks || [], associations) };
}
