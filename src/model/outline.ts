import type { ScriptElement } from './types';

/** 按稳定场景 ID 把整场放到目标前/后；不改变正文、ID、归幕或素材字段。
 * 返回 null 表示取消/无效/原位落下，调用方必须在此时跳过 mutate 和撤销记录。
 */
export function reorderOutlineScene(
  elements: ScriptElement[], sourceId: string, targetId: string, edge: 'before' | 'after',
): ScriptElement[] | null {
  if (sourceId === targetId) return null;
  const sourceStart = elements.findIndex((element) => element.id === sourceId && element.type === 'scene_heading');
  if (sourceStart < 0 || !elements.some((element) => element.id === targetId && element.type === 'scene_heading')) return null;
  const nextHead = elements.findIndex((element, index) => index > sourceStart && element.type === 'scene_heading');
  const sourceEnd = nextHead < 0 ? elements.length : nextHead;
  const block = elements.slice(sourceStart, sourceEnd);
  const rest = [...elements.slice(0, sourceStart), ...elements.slice(sourceEnd)];
  let insertAt = rest.findIndex((element) => element.id === targetId);
  if (edge === 'after') {
    const next = rest.findIndex((element, index) => index > insertAt && element.type === 'scene_heading');
    insertAt = next < 0 ? rest.length : next;
  }
  const reordered = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
  return reordered.every((element, index) => element === elements[index]) ? null : reordered;
}
