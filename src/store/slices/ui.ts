import { isWritingView, validateWritingContext } from '../../app/writingContext';
import { DEFAULT_FONT_COLOR, normalizeFontColor } from '../../model/appearance';
import { validateCharacterSourceTarget } from '../../app/characterNavigation';
import { toggleSel, selRange, clearSel } from '../../model/selection';
import type { StoreState, AppTheme, SetState, GetState } from '../types';


/* --------- 写作字体颜色：app 级外观设置，只存 localStorage，不写入 project --------- */
const LS_FONT_COLOR = 'guangying:fontColor';
const LS_APP_THEME = 'guangying:appTheme';
const LEGACY_LS_FONT_COLOR = 'mojiang:fontColor';
const LEGACY_LS_APP_THEME = 'mojiang:appTheme';


export function loadFontColor(): string {
  try {
    const v = localStorage.getItem(LS_FONT_COLOR) || localStorage.getItem(LEGACY_LS_FONT_COLOR);
    // 校验合法性：localStorage 可能被手动改坏，脏值会污染 CSS 变量导致界面异常
    return normalizeFontColor(v);
  } catch {
    return DEFAULT_FONT_COLOR;
  }
}
export function loadAppTheme(): AppTheme {
  try {
    const value = localStorage.getItem(LS_APP_THEME) || localStorage.getItem(LEGACY_LS_APP_THEME);
    // 现代工具外观以日间为默认；明确选过夜间的作者保持夜间。
    return value === 'night' ? 'night' : 'day';
  } catch { return 'day'; }
}

/** 界面状态：视图、侧栏、提示、缩放、外观、焦点与选区。 */
export const createUiSlice = (set: SetState, get: GetState): Partial<StoreState> => {
  return {
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

    setActive: (id) => {
      const state = get();
      if (state.activeId !== id) state.updateWritingContext({ activeId: id || undefined, caret: undefined });
      set({ activeId: id });
    },
    requestFocus: (id, caret = 'end', scroll = 'nearest') => {
      get().updateWritingContext({ activeId: id, caret: typeof caret === 'number' ? caret : caret === 'start' ? 0 : undefined });
      set({ focus: { id, caret, scroll, ts: Date.now() }, activeId: id });
    },
    requestCharacterSource: (target) => {
      const state = get();
      const checked = validateCharacterSourceTarget(target, state);
      if (!checked.ok) {
        state.notify(checked.reason === 'missing-element' ? '原文已不存在，人物记录仍保留。' : '原文或工程已变化，请重新选择当前证据。', 'error');
        return false;
      }
      const source = checked.target;
      state.setView('write');
      get().updateWritingContext({ activeId: source.elementId, caret: source.start });
      set({ activeId: source.elementId, focus: { id: source.elementId, caret: source.start, scroll: 'center', ts: Date.now(), source } });
      return true;
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
  };
};
