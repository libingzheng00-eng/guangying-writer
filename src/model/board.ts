/**
 * 自由板卡片尺寸约束（v1.2.9 同款）。
 *
 * 历史一致性：
 *   - 图片 / 写作图（image / wimg）：min 180×140, max 760×680, default 176×140
 *   - 灵感 / 声音（beat / sound）：min 220×170, max 720×640, default 220×170
 *   - 声音卡虽然不显示 resize 按钮，但保留数值以便 layout 计算与将来扩展
 *
 * resize clamp 必须始终落到合法区间，且不接受负数 / NaN / Infinity：
 *   - input == null / 非 number / NaN / 非有限 → 返回 default
 *   - 负数 / 0 → default（避免把卡片缩没）
 *   - > max → max
 *   - < min → min
 *
 * 函数都是 pure，可在 Node 环境直接断言。
 */
import type { Beat } from './types';

export interface SizeLimit {
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
  defaultW: number;
  defaultH: number;
}

/** 四种卡片类型的尺寸约束（v1.2.9 同款） */
export const RESIZE_LIMITS: Record<NonNullable<Beat['kind']>, SizeLimit> = {
  image: { minW: 180, minH: 140, maxW: 760, maxH: 680, defaultW: 176, defaultH: 140 },
  wimg: { minW: 180, minH: 140, maxW: 760, maxH: 680, defaultW: 176, defaultH: 140 },
  beat: { minW: 220, minH: 170, maxW: 720, maxH: 640, defaultW: 220, defaultH: 170 },
  sound: { minW: 220, minH: 170, maxW: 720, maxH: 640, defaultW: 220, defaultH: 170 },
};

/** 取指定类型的尺寸约束；未知 kind 回退到 beat */
export function sizeLimitFor(kind: Beat['kind'] | undefined): SizeLimit {
  if (kind === 'image' || kind === 'wimg' || kind === 'beat' || kind === 'sound') {
    return RESIZE_LIMITS[kind];
  }
  return RESIZE_LIMITS.beat;
}

/** 默认尺寸（无 w/h 时使用） */
export function defaultSize(kind: Beat['kind'] | undefined): { w: number; h: number } {
  const l = sizeLimitFor(kind);
  return { w: l.defaultW, h: l.defaultH };
}

/**
 * 把 width / height 强制收敛到合法区间。
 *
 * @param kind  卡片类型（image / wimg / beat / sound）
 * @param w     用户传入的宽度（可能是拖动中增量、resize 实时值、或持久化值）
 * @param h     用户传入的高度
 * @returns     { w, h }：被 clamp 后的整数（Math.round），永远 ∈ [min, max]
 *
 * 不抛异常：非数 / NaN / Infinity / null 一律回回 default。
 */
export function clampSize(
  kind: Beat['kind'] | undefined,
  w: unknown,
  h: unknown,
): { w: number; h: number } {
  const l = sizeLimitFor(kind);
  const dw = l.defaultW;
  const dh = l.defaultH;
  // 非法输入（NaN / Infinity / 非数）→ 回退到该类型 default，由 CSS min-width / min-height
  // 在渲染时收敛到 minW/minH；这样 store 里保存的仍是 default，撤销恢复一致。
  const toW = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
  const toH = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
  const nw = toW(w);
  const nh = toH(h);
  return {
    w: nw == null ? dw : Math.max(l.minW, Math.min(l.maxW, nw)),
    h: nh == null ? dh : Math.max(l.minH, Math.min(l.maxH, nh)),
  };
}

/**
 * resize 拖动增量计算：起始尺寸 (ow, oh) 加鼠标位移 (dx, dy)，按 zoom 归一化，
 * 再用 clampSize 收敛到合法区间。
 */
export function resizeBy(
  kind: Beat['kind'] | undefined,
  ow: number,
  oh: number,
  dx: number,
  dy: number,
  zoom = 1,
): { w: number; h: number } {
  // zoom = 1 时像素 = CSS 像素；放大时拖动应该更细腻。
  // 用 zoom 作分母：zoom=2 时拖动 100px 等于 +50px CSS
  const z = zoom > 0 ? zoom : 1;
  return clampSize(kind, ow + dx / z, oh + dy / z);
}