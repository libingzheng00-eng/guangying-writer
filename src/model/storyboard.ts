import type { ScriptProject } from './types';
import { deriveScenes } from './project';
import { uid } from '../utils/id';

export interface StoryboardPlacement { targetId: string; edge: 'before' | 'after' }

/** 幕分组核心契约：移回未归幕只解除归属；归入幕才按落点移动整场。
 * 多选保持正文中的相对顺序，调用方须用一次 mutate 包裹，完整撤销。
 * 不改场景正文内容、素材/关系线/坐标，也不把分组名写入正文幕元素。
 */
export function moveStoryboardScenes(
  project: ScriptProject, ids: string[], actId?: string, placement?: StoryboardPlacement,
): void {
  if (actId && !project.acts.some(act => act.id === actId)) return;
  const wanted = new Set(ids);
  const scenes = deriveScenes(project);
  const moving = scenes.filter(scene => wanted.has(scene.elementId));
  if (!moving.length) return;
  const selected = new Set(moving.map(scene => scene.elementId));

  if (actId) {
    if (placement && (!scenes.some(scene => scene.elementId === placement.targetId && scene.actId === actId)
      || selected.has(placement.targetId))) return;
    // 使用原数组的插入边界，移除源块后再计算落点，避免向后移动偏一场。
    let boundary: number;
    if (placement) {
      const target = scenes.find(scene => scene.elementId === placement.targetId)!;
      boundary = placement.edge === 'before' ? target.start : target.end;
    } else {
      const members = scenes.filter(scene => scene.actId === actId && !selected.has(scene.elementId));
      if (members.length) boundary = members[members.length - 1].end;
      else {
        const actIndex = project.acts.findIndex(act => act.id === actId);
        const later = new Set(project.acts.slice(actIndex + 1).map(act => act.id));
        const next = scenes.find(scene => !selected.has(scene.elementId) && scene.actId && later.has(scene.actId));
        boundary = next?.start ?? project.elements.length;
        // 本幕仅有选中的场景：原位放到幕末不改变它们和未归幕场景的相对位置。
        if (moving.every(scene => scene.actId === actId)) boundary = moving[moving.length - 1].end;
      }
    }
    const movedIndices = new Set<number>();
    const blocks = moving.flatMap(scene => {
      for (let i = scene.start; i < scene.end; i += 1) movedIndices.add(i);
      return project.elements.slice(scene.start, scene.end);
    });
    const before = project.elements.filter((_, i) => i < boundary && !movedIndices.has(i));
    const after = project.elements.filter((_, i) => i >= boundary && !movedIndices.has(i));
    const reordered = [...before, ...blocks, ...after];
    if (!reordered.every((element, i) => element === project.elements[i])) project.elements = reordered;
  }
  for (const scene of moving) {
    let meta = project.sceneMeta.find(item => item.elementId === scene.elementId);
    if (!actId) {
      if (meta) delete meta.actId;
    } else {
      if (!meta) {
        meta = { id: uid('sc'), elementId: scene.elementId, title: '', synopsis: '', color: scene.color };
        project.sceneMeta.push(meta);
      }
      meta.actId = actId;
    }
  }
}

/** 实际排版页的并集：同一页多场只计一次；跨幕共页可各计一次。不修改排版。 */
export function storyboardPageCounts(project: ScriptProject, pages: { items: { elements: { id: string }[] }[] }[]) {
  const actIds = new Set(project.acts.map(act => act.id));
  const groupOf = new Map<string, string>();
  for (const scene of deriveScenes(project)) {
    const group = scene.actId && actIds.has(scene.actId) ? scene.actId : '';
    for (let i = scene.start; i < scene.end; i += 1) groupOf.set(project.elements[i].id, group);
  }
  const counts = new Map<string, number>();
  for (const page of pages) {
    const groups = new Set<string>();
    for (const item of page.items) for (const element of item.elements) {
      const group = groupOf.get(element.id);
      if (group !== undefined) groups.add(group);
    }
    for (const group of groups) counts.set(group, (counts.get(group) || 0) + 1);
  }
  return counts;
}
