import { create } from 'zustand';
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
import { cloneProject, createProject, defaultActs, newElement } from '../model/project';
import { dualAfterEnter } from '../model/flow';
import { plain, cnNum } from '../utils/text';
import { uid } from '../utils/id';
import { isHexColor } from '../utils/color';
import { clampTargetPages } from '../model/progress';
import { clampSize } from '../model/board';
import {
  toggleSel,
  selRange,
  clearSel,
  filterBoardLinksToKeep,
} from '../model/selection';

export type ViewMode = 'write' | 'cards' | 'board' | 'preview' | 'reports';
export type SidebarMode = 'navigator' | 'outline' | 'inspector';

export interface FocusRequest {
  id: string;
  caret: 'start' | 'end' | number;
  ts: number;
}

export interface Toast {
  text: string;
  kind: 'info' | 'error' | 'ok';
  ts: number;
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
  sidebar: SidebarMode;
  sidebarOpen: boolean;
  activeId: string | null;
  activeRev: string | null;
  focus: FocusRequest | null;
  toast: Toast | null;
  version: number;
  pageCount: number;
  zoom: number;
  /** 写作字体颜色（app 级外观设置，不写入 .zhsp） */
  fontColor: string;
  past: ScriptProject[];
  future: ScriptProject[];

  /** 自由板多选集合（不写入 .zhsp；load 时清空、save 时忽略） */
  selectedIds: string[];

  setView: (v: ViewMode) => void;
  setSidebar: (s: SidebarMode) => void;
  toggleSidebar: () => void;
  notify: (text: string, kind?: Toast['kind']) => void;
  setPageCount: (n: number) => void;
  setZoom: (n: number) => void;
  setFontColor: (c: string) => void;

  loadProject: (p: ScriptProject, filePath?: string | null) => void;
  newProject: () => void;
  markSaved: (path: string) => void;

  mutate: (fn: (p: ScriptProject) => void, opts?: MutateOptions) => void;
  undo: () => void;
  redo: () => void;

  setActive: (id: string | null) => void;
  requestFocus: (id: string, caret?: FocusRequest['caret']) => void;

  /* 元素操作 */
  insertAfter: (id: string | null, type?: ElementType, text?: string) => string;
  /** 在光标处把一个元素拆成两个（回车） */
  splitBlock: (id: string, before: string, after: string, nextType: ElementType) => string;
  setType: (id: string, type: ElementType) => void;
  setText: (id: string, text: string) => void;
  removeElement: (id: string) => void;
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
  addSceneAfter: (elementId: string) => void;
  updateAct: (id: string, patch: Partial<Act>) => void;
  addAct: () => void;
  removeAct: (id: string) => void;

  /* 自由画布：场景卡坐标 */
  setScenePos: (elementId: string, x: number, y: number) => void;

  /* 自由画布：节拍卡 / 灵感卡 */
  addBeat: (x: number, y: number, text?: string, kind?: Beat['kind']) => string;
  updateBeat: (id: string, patch: Partial<Beat>) => void;
  /** resize 节拍卡到指定尺寸，coalesce 合并连续 resize；非法值由 clampSize 兜底 */
  resizeBeat: (id: string, w: number, h: number) => void;
  moveBeat: (id: string, x: number, y: number) => void;
  deleteBeat: (id: string) => void;
  linkBeat: (id: string, sceneId?: string) => void;
  addBoardLink: (from: string, to: string) => void;
  updateBoardLink: (id: string, patch: Partial<BoardLink>) => void;
  deleteBoardLink: (id: string) => void;

  /* 多选 / 框选（自由板） */
  setSelectedIds: (ids: string[]) => void;
  toggleSelection: (id: string) => void;
  selectRange: (sortedIds: string[], anchor: string | null | undefined, target: string) => void;
  clearSelection: () => void;
  /** 批量删除：只清掉 selectedIds 里的 beats + 与任一端相关的关系线；不波及未选卡片 */
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
}

const HISTORY_LIMIT = 120;

/* --------- 写作字体颜色：app 级外观设置，只存 localStorage，不写入 project --------- */
const LS_FONT_COLOR = 'mojiang:fontColor';
export const DEFAULT_FONT_COLOR = '#e9ff3a';

function loadFontColor(): string {
  try {
    const v = localStorage.getItem(LS_FONT_COLOR);
    // 校验合法性：localStorage 可能被手动改坏，脏值会污染 CSS 变量导致界面异常
    return v && isHexColor(v) ? v : DEFAULT_FONT_COLOR;
  } catch {
    return DEFAULT_FONT_COLOR;
  }
}
let lastCoalesce: { key: string; ts: number } | null = null;

export const useStore = create<StoreState>((set, get) => ({
  project: createProject(),
  filePath: null,
  dirty: false,
  view: 'write',
  sidebar: 'navigator',
  sidebarOpen: true,
  activeId: null,
  activeRev: null,
  focus: null,
  toast: null,
  version: 0,
  pageCount: 0,
  zoom: 1,
  fontColor: loadFontColor(),
  past: [],
  future: [],
  selectedIds: [],

  setView: (v) => set({ view: v }),
  setSidebar: (s) => set({ sidebar: s, sidebarOpen: true }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  notify: (text, kind = 'info') => set({ toast: { text, kind, ts: Date.now() } }),
  setPageCount: (n) => set({ pageCount: n }),
  setZoom: (n) => set({ zoom: Math.max(0.6, Math.min(1.8, n)) }),

  setFontColor: (c) => {
    try {
      localStorage.setItem(LS_FONT_COLOR, c);
    } catch {
      /* 忽略存储失败 */
    }
    set({ fontColor: c });
  },

  loadProject: (p, filePath = null) => {
    // 工程切换必须切断上一工程的 resize 合并窗口，避免两个工程的操作串成一条撤销记录。
    lastCoalesce = null;
    // 规范化幕标题：把「第2幕」这类阿拉伯数字写法统一为「第二幕」，避免格式不统一
    p.acts.forEach((a) => {
      const m = /^第(\d+)幕$/.exec(a.title);
      if (m) a.title = `第${cnNum(parseInt(m[1], 10))}幕`;
    });
    set((s) => ({
      project: p,
      filePath,
      dirty: false,
      past: [...s.past, s.project].slice(-HISTORY_LIMIT),
      future: [],
      activeId: p.elements[0]?.id ?? null,
      version: s.version + 1,
      pageCount: 0,
      selectedIds: [],
    }));
  },

  newProject: () => {
    // 新建工程必须切断上一工程的 coalesce 状态。
    lastCoalesce = null;
    const p = createProject();
    set((s) => ({
      project: p,
      filePath: null,
      dirty: false,
      past: [...s.past, s.project].slice(-HISTORY_LIMIT),
      future: [],
      activeId: p.elements[0]?.id ?? null,
      version: s.version + 1,
      pageCount: 0,
      selectedIds: [],
    }));
  },

  markSaved: (path) => set({ filePath: path, dirty: false }),

  mutate: (fn, opts) => {
    const { project, past } = get();
    const next = cloneProject(project);
    fn(next);
    const history = opts?.history !== false;
    // 组件可能在每次输入事件都调用 mutate；没有实际数据变化时不应制造
    // 撤销点、清空重做栈或把 dirty 标成 true。
    if (JSON.stringify(next) === JSON.stringify(project)) {
      lastCoalesce = null;
      return;
    }
    next.updatedAt = Date.now();
    let shouldPush = history;
    if (history && opts?.coalesce) {
      const now = Date.now();
      if (lastCoalesce && lastCoalesce.key === opts.coalesce && now - lastCoalesce.ts < 1500) {
        shouldPush = false;
      }
      lastCoalesce = { key: opts.coalesce, ts: now };
    } else if (history) {
      lastCoalesce = null;
    } else {
      // 非历史状态更新也是一次操作边界，不能与前后的 resize 合并。
      lastCoalesce = null;
    }
    set({
      project: next,
      dirty: true,
      version: get().version + 1,
      past: shouldPush ? [...past, project].slice(-HISTORY_LIMIT) : past,
      future: history ? [] : get().future,
    });
  },

  undo: () => {
    const { past, project, future } = get();
    if (!past.length) {
      get().notify('没有可撤销的操作');
      return;
    }
    const prev = past[past.length - 1];
    lastCoalesce = null;
    set({
      project: prev,
      past: past.slice(0, -1),
      future: [project, ...future].slice(0, HISTORY_LIMIT),
      dirty: true,
      version: get().version + 1,
    });
  },

  redo: () => {
    const { past, project, future } = get();
    if (!future.length) {
      get().notify('没有可重做的操作');
      return;
    }
    const next = future[0];
    lastCoalesce = null;
    set({
      project: next,
      past: [...past, project].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      dirty: true,
      version: get().version + 1,
    });
  },

  setActive: (id) => set({ activeId: id }),
  requestFocus: (id, caret = 'end') => set({ focus: { id, caret, ts: Date.now() }, activeId: id }),

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
    get().mutate(
      (p) => {
        const el = p.elements.find((e) => e.id === id);
        if (el) el.text = text;
      },
      { coalesce: `text:${id}` },
    );
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
    const cur = project.elements[idx];
    const offset = plain(prev.text).length;
    get().mutate((p) => {
      const a = p.elements[idx - 1];
      const b = p.elements[idx];
      a.text = a.text + b.text;
      p.elements.splice(idx, 1);
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

  moveSceneTo: (from, to) => get().mutate((p) => moveSceneBlock(p, from, to)),

  /**
   * 故事板拖拽落位：把场景移动到目标位置，同时归入目标幕。
   * 必须合并为一次 mutate —— 若拆成 moveSceneTo + updateSceneMeta 两次调用，
   * 会产生两条撤销记录，用户按一次 Cmd+Z 只能回退一半（表现为「撤销不了」）。
   */
  dropSceneInAct: (from, to, elementId, actId) => {
    get().mutate((p) => {
      moveSceneBlock(p, from, to);
      let m = p.sceneMeta.find((s) => s.elementId === elementId);
      if (!m) {
        m = { id: uid('sc'), elementId, title: '', synopsis: '', color: '#cfe4ff' };
        p.sceneMeta.push(m);
      }
      if (actId) m.actId = actId;
      else delete m.actId;
    });
  },

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

  addBeat: (x, y, text = '', kind) => {
    const id = uid('bt');
    get().mutate((p) => {
      const color = kind === 'sound' ? '#ccb887' : '#fff7d6';
      const beat: Beat = { id, text, color, x, y };
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

  /**
   * 批量删除选中 beats 与对应 boardLinks（一端在被删集中就清掉）。
   * 不影响未选中 beats / scenes，也不影响未选中的纯关系线（保留两端都不在被删集中的）。
   * 返回被删除的 beat 数量（便于 toast 提示）。
   */
  deleteSelectedBeats: () => {
    const ids = get().selectedIds;
    if (!ids || ids.length === 0) return 0;
    // 仅删除同时是 beat 的项目：用户也可能选中场景卡，场景卡删除要单独走 store.removeElement
    const beatIds = ids.filter((id) => get().project.beats.some((b) => b.id === id));
    if (beatIds.length === 0) return 0;
    const removed = new Set(beatIds);
    get().mutate(
      (p) => {
        p.beats = p.beats.filter((b) => !removed.has(b.id));
        p.boardLinks = filterBoardLinksToKeep(p.boardLinks || [], removed);
      },
      { history: true, coalesce: 'beat-bulk-delete' },
    );
    // 清空 selectedIds；调用方重新同步选区（典型场景：删后不再保留任何选中）
    set({ selectedIds: [] });
    return beatIds.length;
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
}));

/** 便捷：当前元素 */
export function useActiveElement(): ScriptElement | null {
  return useStore((s) => s.project.elements.find((e) => e.id === s.activeId) || null);
}

export function defaultActsList() {
  return defaultActs();
}

/**
 * 把第 from 个场景（连同其后续元素）整体移动到第 to 个场景的位置，直接修改 p.elements。
 * 抽成纯函数，供 moveSceneTo 与 dropSceneInAct 复用。
 */
function moveSceneBlock(p: ScriptProject, from: number, to: number) {
  // 找到第 from 个与第 to 个 scene_heading，整体移动该场景的区块
  const heads: number[] = [];
  p.elements.forEach((el, i) => {
    if (el.type === 'scene_heading') heads.push(i);
  });
  if (from < 0 || from >= heads.length) return;
  const target = Math.max(0, Math.min(heads.length - 1, to));
  if (target === from) return;
  const start = heads[from];
  const end = from + 1 < heads.length ? heads[from + 1] : p.elements.length;
  const block = p.elements.slice(start, end);
  const rest = p.elements.filter((_, i) => i < start || i >= end);
  // 在 rest 中定位插入点：第 target 个 scene_heading 之前
  let count = -1;
  let insertAt = rest.length;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].type === 'scene_heading') {
      count += 1;
      if (count === target) {
        insertAt = i;
        break;
      }
    }
  }
  if (target > from) {
    // 向后移动：插入到目标场景之后
    let seen = -1;
    insertAt = rest.length;
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i].type === 'scene_heading') {
        seen += 1;
        if (seen === target) {
          let j = i + 1;
          while (j < rest.length && rest[j].type !== 'scene_heading') j += 1;
          insertAt = j;
          break;
        }
      }
    }
  }
  p.elements = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
}
