import type { Beat, SceneMeta } from '../../model/types';
import { newElement, deriveScenes } from '../../model/project';
import { uid } from '../../utils/id';
import { clampSize } from '../../model/board';
import { boardBeatPosition, type BoardCardPosition } from '../../model/boardWorkspace';
import { filterBoardLinksToKeep, splitBoardSelection } from '../../model/selection';
import type { StoreState, SetState, GetState } from '../types';
import { resetCoalesce, boardCardTarget, type BoardCardTarget } from '../history';


/** 自由板：卡片位置/尺寸/颜色、素材卡、关系线、批量删除。 */
export const createBoardSlice = (set: SetState, get: GetState): Partial<StoreState> => {
  return {
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
        resetCoalesce();
        return;
      }
      const movements = new Map<string, BoardCardPosition & { target: BoardCardTarget }>();
      for (const position of positions) {
        const target = position && boardCardTarget(project, position.id);
        if (!target || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
          resetCoalesce();
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
        resetCoalesce();
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
        resetCoalesce();
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

    setScenesRevisionStatus: (elementIds, status) => {
      const project = get().project;
      const headings = new Set(project.elements.filter((element) => element.type === 'scene_heading').map((element) => element.id));
      if (!Array.isArray(elementIds) || !elementIds.length || elementIds.some((id) => !headings.has(id)) ||
          (status !== null && status !== undefined && !['todo', 'revising', 'done'].includes(status))) { resetCoalesce(); return; }
      get().mutate((p) => {
        for (const elementId of new Set(elementIds)) {
          let meta = p.sceneMeta.find((item) => item.elementId === elementId);
          if (!meta) {
            if (!status) continue;
            meta = { id: uid('sc'), elementId, title: '', synopsis: '', color: '#cfe4ff' };
            p.sceneMeta.push(meta);
          }
          if (status) meta.revisionStatus = status; else delete meta.revisionStatus;
        }
      });
    },

    resizeBoardCard: (id, w, h) => {
      const target = boardCardTarget(get().project, id);
      if (!target) {
        resetCoalesce();
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
  };
};
