import type { SceneMeta } from '../../model/types';
import { deriveScenes } from '../../model/project';
import { uid } from '../../utils/id';
import { reorderOutlineScene } from '../../model/outline';
import { captureWritingFragment, createNamedVersion, renameNamedVersion, deleteNamedVersion, createStashEntry, deleteStashEntry, buildInsertPlan } from '../../model/revisionWorkspace';
import { validateAnnotations, reanchorAnnotation, type Annotation } from '../../model/annotations';
import { buildDeliveryChecks, normalizeDeliveryIgnored } from '../../model/deliveryChecks';
import { emptyCharacterWorkspace, withCharacterWorkspace, saveCharacterProfile, removeCharacterProfile, saveCharacterOverride, saveCharacterAssignment, removeCharacterRecord } from '../../model/characterActions';
import type { StoreState, ReviewScenePatch, SetState, GetState } from '../types';
import { makeReviewChange, assertReviewAnchor, removeReviewElements } from '../history';


/** 改稿与人物线：版本、暂存、批注、交稿检查、人物登记。 */
export const createReviewSlice = (set: SetState, get: GetState): Partial<StoreState> => {
  const reviewChange = makeReviewChange(set, get);
  return {
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
    upsertCharacterProfile: (profile, epoch) => reviewChange(epoch, project => saveCharacterProfile(project, profile)),
    removeCharacterProfile: (id, epoch) => reviewChange(epoch, project => removeCharacterProfile(project, id)),
    setCharacterOverride: (record, epoch) => reviewChange(epoch, project => saveCharacterOverride(project, record)),
    deleteCharacterOverride: (id, epoch) => reviewChange(epoch, project => removeCharacterRecord(project, 'overrides', id)),
    setCharacterAssignment: (record, epoch) => reviewChange(epoch, project => saveCharacterAssignment(project, record)),
    deleteCharacterAssignment: (id, epoch) => reviewChange(epoch, project => removeCharacterRecord(project, 'assignments', id)),
    addCharacterNote: (characterId, anchor, body, options, epoch) => reviewChange(epoch, project => {
      assertReviewAnchor(project, anchor);
      if (!options || !['pending', 'resolved'].includes(options.status)) throw new Error('人物记录状态无效。');
      const now = Date.now();
      const annotation: Annotation = { id: uid('annotation'), createdAt: now, updatedAt: now, body: body.trim(), status: options.status, anchor, anchorState: 'current' };
      const annotations = validateAnnotations([...(project.annotations || []), annotation]);
      const workspace = project.characterWorkspace || emptyCharacterWorkspace();
      return withCharacterWorkspace({ ...project, annotations }, { ...workspace, noteLinks: [...workspace.noteLinks,
        { annotationId: annotation.id, characterId, topic: options.topic, ...(options.relatedCharacterId ? { relatedCharacterId: options.relatedCharacterId } : {}) },
      ] });
    }),
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
  };
};
