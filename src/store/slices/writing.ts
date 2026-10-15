import type { SceneMeta, ScriptElement } from '../../model/types';
import { newElement } from '../../model/project';
import { dualAfterEnter } from '../../model/flow';
import { searchText, replaceTextRanges } from '../../model/search';
import { plain, escapeHtml } from '../../utils/text';
import { uid } from '../../utils/id';
import { clampTargetPages } from '../../model/progress';
import { saveCharacterProfile } from '../../model/characterActions';
import { filterBoardLinksToKeep } from '../../model/selection';
import type { StoreState, ReplaceMatch, SetState, GetState } from '../types';
import { resetCoalesce, projectChange, makeReviewChange } from '../history';


/** 正文编辑：段落增删改、分段、替换、快捷输入、多选删除、人物改名与工程设置。 */
export const createWritingSlice = (set: SetState, get: GetState): Partial<StoreState> => {
  const reviewChange = makeReviewChange(set, get);
  return {
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
        resetCoalesce();
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
        resetCoalesce();
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
        resetCoalesce();
        return;
      }
      // 输入性能红线：只复制元素列表和当前段落，禁止每个字 JSON 复制整个工程。
      // 未改段落 / 图片 / 设置保持引用；通用 mutate 在草稿副本上修改，再把没变的部分换回原对象，同样不碰撤销快照。
      const elements = project.elements.slice();
      elements[index] = { ...elements[index], text };
      set(projectChange(state, { ...project, elements }, { coalesce: `text:${id}` }));
    },

    replaceMatches: (matches, replacement, expectedEpoch) => {
      const state = get();
      resetCoalesce();
      if (state.documentEpoch !== expectedEpoch || !matches.length) return 0;
      const byElement = new Map<string, ReplaceMatch[]>();
      for (const match of matches) byElement.set(match.elementId, [...(byElement.get(match.elementId) || []), match]);
      const elements = state.project.elements.slice();
      for (const [id, list] of byElement) {
        const index = elements.findIndex(element => element.id === id);
        if (index < 0) return 0;
        const source = searchText(elements[index].text);
        if (list.some(match => source.slice(match.start, match.end) !== match.text)) return 0;
        const html = replaceTextRanges(elements[index].text, list, replacement);
        if (html === null) return 0;
        elements[index] = { ...elements[index], text: html };
      }
      // 与 setText 一样只复制改动的段落；不设 coalesce，整次替换是独立的一步撤销。
      set(projectChange(state, { ...state.project, elements }));
      return matches.length;
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

    renameCharacter: (from, to) => {
      const nextName = to.trim();
      if (!nextName || nextName === from) return false;
      const exists = get().project.elements.some((el) => el.type === 'character' && plain(el.text).trim() === nextName);
      if (exists) {
        get().notify('已有同名人物，请先合并或使用其他名称', 'error');
        return false;
      }
      const changed = reviewChange(undefined, project => {
        const sourceProfiles = project.characterWorkspace?.profiles.filter(profile => profile.canonicalName === from || profile.aliases.includes(from)) || [];
        if (sourceProfiles.length && project.characterWorkspace?.profiles.some(profile =>
          !sourceProfiles.some(source => source.id === profile.id) && (profile.canonicalName === nextName || profile.aliases.includes(nextName)))) {
          throw new Error('新名称已属于另一个已登记人物，请先在人物线中核对身份。');
        }
        let count = 0;
        const elements = project.elements.map(element => {
          if (element.type !== 'character' || plain(element.text).trim() !== from) return element;
          count++;
          return { ...element, text: escapeHtml(nextName) };
        });
        if (!count) return project;
        let next = { ...project, elements };
        for (const profile of sourceProfiles) {
          if (profile.canonicalName !== nextName && !profile.aliases.includes(nextName)) {
            next = saveCharacterProfile(next, { ...profile, aliases: [...profile.aliases, nextName] });
          }
        }
        return next;
      });
      if (changed) get().notify(`已将 ${from} 改为 ${nextName}`, 'ok');
      return changed;
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
  };
};
