import { create } from 'zustand';
import { createProject } from '../model/project';
import type { StoreState } from './types';
import { loadFontColor, loadAppTheme } from './slices/ui';
import { createUiSlice } from './slices/ui';
import { createDocumentSlice } from './slices/document';
import { createWritingSlice } from './slices/writing';
import { createScenesSlice } from './slices/scenes';
import { createBoardSlice } from './slices/board';
import { createReviewSlice } from './slices/review';
import { createProductionSlice } from './slices/production';
import { createTranslationSlice, loadShownTranslation } from './slices/translation';

export type { ViewMode, SidebarMode, AppTheme, FocusRequest, Toast, SaveSnapshot, ReplaceMatch, WorkspaceSource, ReviewScenePatch } from './types';
export { DEFAULT_FONT_COLOR } from '../model/appearance';

/**
 * 全局状态由几个功能切片组成（slices/）。每个切片只负责自己的一组操作，
 * 共用 history.ts 中的撤销 / 合并规则；新增功能时优先新建切片，而不是继续加长单个文件。
 */
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
  shownTranslation: loadShownTranslation(),
  pdfExportMode: null,
  past: [],
  future: [],
  selectedIds: [],
  writingSelectionMode: false,
  writingSelectedIds: [],

  ...createUiSlice(set, get),
  ...createDocumentSlice(set, get),
  ...createWritingSlice(set, get),
  ...createScenesSlice(set, get),
  ...createBoardSlice(set, get),
  ...createReviewSlice(set, get),
  ...createProductionSlice(set, get),
  ...createTranslationSlice(set, get),
}) as StoreState);
