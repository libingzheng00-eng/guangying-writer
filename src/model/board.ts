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

/** 自由板所有可缩放元素的尺寸约束（v1.2.9 同款 + scene 卡补全） */
export const RESIZE_LIMITS: Record<ResizableKind, SizeLimit> = {
  // 场景卡：比节拍卡略宽一点用于容纳 synopsis；上限留足可自定义空间
  scene: { minW: 180, minH: 110, maxW: 480, maxH: 400, defaultW: 220, defaultH: 110 },
  // 图片 / 写作图
  image: { minW: 180, minH: 140, maxW: 760, maxH: 680, defaultW: 176, defaultH: 140 },
  wimg: { minW: 180, minH: 140, maxW: 760, maxH: 680, defaultW: 176, defaultH: 140 },
  // 灵感 / 声音
  beat: { minW: 220, minH: 170, maxW: 720, maxH: 640, defaultW: 220, defaultH: 170 },
  sound: { minW: 220, minH: 170, maxW: 720, maxH: 640, defaultW: 220, defaultH: 170 },
};

/**
  * 取指定类型的尺寸约束。
  *
  * 支持 `'scene' | 'image' | 'wimg' | 'beat' | 'sound'` 与 undefined。
  * 未来新增 kind 时：先在 RESIZE_LIMITS 里加项，再让 BoardView 在 canResize 里 include。
  */
export type ResizableKind = 'scene' | 'image' | 'wimg' | 'beat' | 'sound';

export function sizeLimitFor(kind: ResizableKind | Beat['kind'] | undefined): SizeLimit {
  if (
    kind === 'scene' || kind === 'image' || kind === 'wimg' ||
    kind === 'beat' || kind === 'sound'
  ) {
    return RESIZE_LIMITS[kind];
  }
  return RESIZE_LIMITS.beat;
}

/** 默认尺寸（无 w/h 时使用） */
export function defaultSize(kind: Beat['kind'] | ResizableKind | undefined): { w: number; h: number } {
  const l = sizeLimitFor(kind);
  return { w: l.defaultW, h: l.defaultH };
}

/**
 * 卡片宽度的兜底值（用于无尺寸字段的旧工程 / sceneMeta 缺省时）。
 *
 * 旧工程（alpha.6 之前保存的）没有 scene.w / beat.w 字段；BoardView 计算 endpoint
 * 时用 `scene.w ?? FALLBACK_CARD_W`、`beat.w ?? FALLBACK_CARD_W`。这样：
 *   - resize 后的卡片，w/h 在 store 里，endpoint 跟随卡片中心走；
 *   - 旧工程未设 w/h，endpoint 仍按历史默认位置算；
 *   - 关掉 resize 的卡片尺寸 ≠ 默认值时不会被 fallback 静默吞掉。
 */
export const FALLBACK_CARD_W = 220;
export const FALLBACK_SCENE_H = 96;
export const FALLBACK_BEAT_H = 92;

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
  kind: Beat['kind'] | ResizableKind | undefined,
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
  kind: Beat['kind'] | ResizableKind | undefined,
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