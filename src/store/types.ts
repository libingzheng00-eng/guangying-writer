import type { StoreApi } from 'zustand';
/** 共享的状态类型：各功能切片按此接口实现自己的部分。 */
import { type WritingContext } from '../app/writingContext';
import type { Act, BoardLink, Beat, ElementType, PageLock, Revision, SceneMeta, ScriptProject, ScriptSettings, TitlePage } from '../model/types';
import { type StoryboardPlacement } from '../model/storyboard';
import { clampSize } from '../model/board';
import { type BoardCardPosition } from '../model/boardWorkspace';
import { createNamedVersion, renameNamedVersion, deleteNamedVersion, deleteStashEntry } from '../model/revisionWorkspace';
import { reanchorAnnotation, type Annotation, type AnnotationAnchor } from '../model/annotations';
import { type CharacterProfile, type CharacterOverride, type CharacterAssignment } from '../model/characterLines';
import { removeCharacterProfile } from '../model/characterActions';
import { type CharacterSourceTarget } from '../app/characterNavigation';

export type ViewMode = 'write' | 'cards' | 'board' | 'preview' | 'reports' | 'character-lines';
export type SidebarMode = 'navigator' | 'outline' | 'inspector';
export type AppTheme = 'night' | 'day';

export interface FocusRequest {
  id: string;
  caret: 'start' | 'end' | number;
  /** 滚动定位策略；普通编辑保持 nearest，场景条跳转使用 start。 */
  scroll: 'nearest' | 'start' | 'center' | 'end';
  ts: number;
  /** An explicit read-only evidence jump, revalidated after the editor mounts. */
  source?: CharacterSourceTarget;
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

export interface ReplaceMatch { elementId: string; start: number; end: number; /** 命中时的原文，用于校验未被改动 */ text: string }

export interface MutateOptions {
  history?: boolean;
  /** 相同 key 的连续修改会合并为一条撤销记录 */
  coalesce?: string;
}

export interface StoreState {
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
  requestCharacterSource: (target: CharacterSourceTarget) => boolean;

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
  /** 查找替换：一次撤销步骤；任一命中的原文已变化、文档已切换时整体拒绝，返回替换数。 */
  replaceMatches: (matches: ReplaceMatch[], replacement: string, expectedEpoch: number) => number;
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
  /** 一次为多个场景设定修改状态（空值清除），一步撤销。 */
  setScenesRevisionStatus: (elementIds: string[], status: SceneMeta['revisionStatus'] | null) => void;
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
  upsertCharacterProfile: (profile: CharacterProfile, expectedEpoch: number) => boolean;
  removeCharacterProfile: (id: string, expectedEpoch: number) => boolean;
  setCharacterOverride: (record: CharacterOverride, expectedEpoch: number) => boolean;
  deleteCharacterOverride: (id: string, expectedEpoch: number) => boolean;
  setCharacterAssignment: (record: CharacterAssignment, expectedEpoch: number) => boolean;
  deleteCharacterAssignment: (id: string, expectedEpoch: number) => boolean;
  addCharacterNote: (characterId: string, anchor: AnnotationAnchor, body: string,
    options: { topic: 'note' | 'relationship' | 'knowledge'; relatedCharacterId?: string; status: 'pending' | 'resolved' }, expectedEpoch: number) => boolean;
  updateAnnotation: (id: string, patch: Partial<Pick<Annotation, 'body' | 'status' | 'reason' | 'decision'>>, expectedEpoch?: number) => boolean;
  deleteAnnotation: (id: string, expectedEpoch?: number) => boolean;
  reanchorAnnotation: (id: string, anchor: AnnotationAnchor, expectedEpoch?: number) => boolean;
  setDeliveryIgnored: (signature: string, ignored: boolean, expectedEpoch?: number) => boolean;
  clearDeliveryIgnored: (expectedEpoch?: number) => boolean;
  commitReviewSceneMeta: (elementId: string, patch: ReviewScenePatch, expectedEpoch?: number) => boolean;
  moveReviewScene: (sourceId: string, targetId: string, edge: 'before' | 'after', expectedEpoch?: number) => boolean;
  lockSceneNumbers: () => void;
  unlockSceneNumbers: () => void;
  lockPages: (pages: PageLock['pages']) => void;
  unlockPages: () => void;
  addAltVersion: (id: string) => void;
  selectAltVersion: (id: string, n: number) => void;
  deleteAltVersion: (id: string) => void;
}

export type WorkspaceSource = { kind: 'version'; id: string; elementIds: string[] } | { kind: 'stash'; id: string };
export type ReviewScenePatch = Pick<Partial<SceneMeta>, 'synopsis' | 'location' | 'storyTime' | 'revisionStatus'>;

/** 切片构造函数拿到的 set / get。 */
export type SetState = StoreApi<StoreState>['setState'];
export type GetState = StoreApi<StoreState>['getState'];
