import { deriveScenes } from '../../model/project';
import { moveStoryboardScenes } from '../../model/storyboard';
import { cnNum } from '../../utils/text';
import { uid } from '../../utils/id';
import { clampSize } from '../../model/board';
import type { StoreState, SetState, GetState } from '../types';


/** 场景与幕：场景信息、整场移动、归幕、增删幕。 */
export const createScenesSlice = (set: SetState, get: GetState): Partial<StoreState> => {
  return {
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
  };
};
