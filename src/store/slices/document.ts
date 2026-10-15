import { loadStoredWritingContext, resolveWritingContext } from '../../app/writingContext';
import type { ScriptProject } from '../../model/types';
import { sampleProject } from '../../model/sample';
import { cnNum } from '../../utils/text';
import type { StoreState, SetState, GetState } from '../types';
import { HISTORY_LIMIT, resetCoalesce, projectChange, historySelection } from '../history';
import { draftCopy, keepUnchanged } from '../structural';


/** 文档生命周期与撤销历史：打开、新建、保存标记、通用修改、撤销重做。 */
export const createDocumentSlice = (set: SetState, get: GetState): Partial<StoreState> => {
  return {
    loadProject: (p, filePath = null, context) => {
      const current = get();
      // Reopening the same file before the metadata timer fires must use the live
      // bookmark, not replace it with an older persisted position. An unassociated
      // in-memory load is a new session; draft recovery supplies its own context.
      const live = filePath !== null && current.project.id === p.id && current.filePath === filePath ? current.writingContext : null;
      const restored = resolveWritingContext(p, context === undefined ? live || loadStoredWritingContext(p.id, filePath) : context);
      // 启动恢复/打开工程建立独立历史，避免撤销上一文件内容却沿用当前文件路径。
      resetCoalesce();
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
      resetCoalesce();
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
      const { revisionWorkspace, annotations, characterWorkspace, ...body } = project;
      // 草稿只复制对象外壳，图片等长字符串共用；不再整份 JSON 复制工程。
      const next = draftCopy(body) as ScriptProject;
      if (revisionWorkspace) next.revisionWorkspace = revisionWorkspace;
      if (annotations) next.annotations = annotations;
      if (characterWorkspace) next.characterWorkspace = characterWorkspace;
      fn(next);
      const { revisionWorkspace: nextWorkspace, annotations: nextAnnotations, characterWorkspace: nextCharacters } = next;
      delete next.revisionWorkspace;
      delete next.annotations;
      delete next.characterWorkspace;
      // 没改到的段落、卡片、设置换回原对象：撤销历史不再每步复制整部剧本和图片，
      // 写作页也只重画真正改动的段落。
      const kept = keepUnchanged(body as ScriptProject, next);
      // 组件可能在每次输入事件都调用 mutate；没有实际数据变化时不应制造
      // 撤销点、清空重做栈或把 dirty 标成 true。
      if (nextWorkspace === revisionWorkspace && nextAnnotations === annotations && nextCharacters === characterWorkspace && kept === body) {
        resetCoalesce();
        return;
      }
      const result = (kept === body ? { ...body } : kept) as ScriptProject;
      if (nextWorkspace !== undefined) result.revisionWorkspace = nextWorkspace;
      if (nextAnnotations !== undefined) result.annotations = nextAnnotations;
      if (nextCharacters !== undefined) result.characterWorkspace = nextCharacters;
      set(projectChange(get(), result, opts));
    },

    breakHistoryGroup: () => { resetCoalesce(); },

    undo: () => {
      const state = get();
      const { past, project, future } = state;
      resetCoalesce();
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
      resetCoalesce();
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
  };
};
