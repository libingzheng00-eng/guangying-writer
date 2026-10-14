import { deriveScenes } from '../../model/project';
import { addAlt, deleteCurrentAlt, selectAlt } from '../../model/altDialogue';
import type { PageLock, ScriptElement } from '../../model/types';
import type { StoreState, SetState, GetState } from '../types';

/** 拍摄稿：场号 / 页码锁定，以及备选台词。都走 mutate，一步可撤销。 */
export const createProductionSlice = (_set: SetState, get: GetState): Partial<StoreState> => {
  const onElement = (id: string, change: (el: ScriptElement) => void) =>
    get().mutate((p) => { const el = p.elements.find((e) => e.id === id); if (el) change(el); });
  return {
    lockSceneNumbers: () => get().mutate((p) => {
      const numbers: Record<string, string> = {};
      for (const scene of deriveScenes(p)) if (scene.number) numbers[scene.elementId] = scene.number;
      p.sceneLock = { lockedAt: Date.now(), numbers };
    }),
    unlockSceneNumbers: () => get().mutate((p) => { delete p.sceneLock; }),
    lockPages: (pages: PageLock['pages']) => get().mutate((p) => { p.pageLock = { lockedAt: Date.now(), pages }; }),
    unlockPages: () => get().mutate((p) => { delete p.pageLock; }),
    addAltVersion: (id) => onElement(id, addAlt),
    selectAltVersion: (id, n) => onElement(id, (el) => selectAlt(el, n)),
    deleteAltVersion: (id) => onElement(id, deleteCurrentAlt),
  };
};
