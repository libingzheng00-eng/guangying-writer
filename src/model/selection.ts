/**
 * src/model/selection.ts
 *
 * 自由板多选 / 框选 / 范围选择 / 批量删除关系线过滤 的纯函数。
 *
 * 全部纯函数：可以在 node 环境直接断言。BoardView / store / 单测共享同一套实现。
 *
 * 设计要点：
 *   - 用 string[] 表示选中集（不引入 Set 容器，方便 JSON.stringify 与 React 渲染）
 *   - selRange 接受有序 ids 列表与 anchor / target，按下标区间取子集
 *   - filterBoardLinksToKeep 严格按「from / to 必须都保留」过滤，确保批量删除
 *     时只清理被删除卡片关联的关系线，不误删未选卡片之间的关系线
 *
 * v1.2.9 的 selIds 是元素 id 数组（写作视图范围选），我们复用相同数据结构，
 * 但覆盖自由板的 beats + scenes 两种 id。
 */
import type { BoardLink } from './types';

/** 切换单个 id 选中状态 */
export function toggleSel(prev: string[], id: string): string[] {
  const idx = prev.indexOf(id);
  if (idx >= 0) {
    const out = prev.slice();
    out.splice(idx, 1);
    return out;
  }
  return prev.concat([id]);
}

/** 把 id 加入选中集合（已存在则 no-op） */
export function addSel(prev: string[], id: string): string[] {
  if (prev.indexOf(id) >= 0) return prev;
  return prev.concat([id]);
}

/** 从选中集合移除 id（不存在则 no-op） */
export function removeSel(prev: string[], id: string): string[] {
  const idx = prev.indexOf(id);
  if (idx < 0) return prev;
  const out = prev.slice();
  out.splice(idx, 1);
  return out;
}

/** 清空选中集合 */
export function clearSel(): string[] {
  return [];
}

/**
 * 范围选择（v1.2.9 selRangeTo 同款语义）：
 *   - sortedIds 是稳定的有序列表（如 derivedScenes 顺序或 beats 顺序）
 *   - anchor / target 是 sortedIds 中真实存在的 id
 *   - 顺序：先按 sortedIds 找到下标，取 [min, max] 全闭区间
 *
 * 这种做法的视觉等价于「Shift+click 选两点之间所有卡片」。
 * 越界 / 找不到 id 时回退到把 target 单独加入 / 保留 prev 不变。
 */
export function selRange(
  prev: string[],
  sortedIds: string[],
  anchor: string | null | undefined,
  target: string,
): string[] {
  const tIdx = sortedIds.indexOf(target);
  if (tIdx < 0) return prev;
  let aIdx = anchor ? sortedIds.indexOf(anchor) : -1;
  if (aIdx < 0) aIdx = tIdx;
  const lo = Math.min(aIdx, tIdx);
  const hi = Math.max(aIdx, tIdx);
  return sortedIds.slice(lo, hi + 1);
}

/**
 * 框选（marquee）：按 rect ∈ canvas 平铺坐标过滤所有卡片中心点。
 *
 * 中心点在矩形内的卡片视为选中。矩形为空或没有中心点时返回空数组。
 *
 * 注：纯函数 - 输入坐标是 canvas 内部坐标（已除 pan / zoom），不是 clientX/Y。
 * Box 起点 (rx, ry) 与宽高 (rw, rh) 是对 canvas 原点的偏移；rh < 0 / rw < 0 表示
 * 用户拖向上 / 左，把它们翻正成 [rx, rx+|rw|] × [ry, ry+|rh|]。
 */
export function marqueeSel(
  _allIds: string[],
  points: { id: string; cx: number; cy: number }[],
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  additive: boolean,
  prev: string[] = [],
): string[] {
  const safePrev = Array.isArray(prev) ? prev : [];
  // 退化框（位移几乎为 0）视作未画框：additive 模式保留 prev，否则返回 []
  if (Math.abs(rw) < 2 && Math.abs(rh) < 2) {
    return additive ? safePrev.slice() : [];
  }
  const x1 = rx;
  const y1 = ry;
  const x2 = rx + rw;
  const y2 = ry + rh;
  const loX = Math.min(x1, x2);
  const hiX = Math.max(x1, x2);
  const loY = Math.min(y1, y2);
  const hiY = Math.max(y1, y2);
  const hit = points
    .filter((p) => p.cx >= loX && p.cx <= hiX && p.cy >= loY && p.cy <= hiY)
    .map((p) => p.id);
  if (additive) {
    // 合并 safePrev 与 hit（去重）
    const seen = new Set(safePrev);
    const out = safePrev.slice();
    hit.forEach((id) => {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    });
    return out;
  }
  return hit;
}

/**
 * 关系线过滤（关键不变量）：
 *
 *   - 保留 from 与 to 都不在 removedSet 内的关系线
 *   - 一端命中 removedSet 就视为孤儿，必须清理
 *   - 与 removedSet 完全无关的关系线全部保留
 *
 * 重要：removedSet 是「被删除的 id」集合，_links_ 是当前所有关系线。
 * 这个函数纯函数化后才能在 node 环境被 100% 单测覆盖；store 批量删除时
 * 直接复用同一套语义，确保「绝不误删未选卡片之间的关系线」。
 */
export function filterBoardLinksToKeep(
  links: BoardLink[],
  removedSet: ReadonlySet<string>,
): BoardLink[] {
  if (removedSet.size === 0) return links.slice();
  // 解析 endpoint（去掉前缀 scene: 或 beat:）— 旧 .zhsp 可能无前缀
  const parse = (ep: string): string => {
    if (ep.startsWith('scene:')) return ep.slice(6); // 'scene:' = 6 chars
    if (ep.startsWith('beat:')) return ep.slice(5); // 'beat:'  = 5 chars
    return ep;
  };
  return links.filter((link) => {
    const fromId = parse(link.from);
    const toId = parse(link.to);
    return !removedSet.has(fromId) && !removedSet.has(toId);
  });
}

/**
 * 卡片坐标 → 中心点（供 marqueeSel 使用）
 */
export function cardCenters(
  cards: { id: string; x: number; y: number; w?: number; h?: number }[],
): { id: string; cx: number; cy: number }[] {
  return cards.map((c) => {
    const w = typeof c.w === 'number' && Number.isFinite(c.w) ? c.w : 220;
    const h = typeof c.h === 'number' && Number.isFinite(c.h) ? c.h : 100;
    return { id: c.id, cx: c.x + w / 2, cy: c.y + h / 2 };
  });
}
