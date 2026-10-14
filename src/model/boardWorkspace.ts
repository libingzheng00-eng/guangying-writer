import type { Beat } from './types';

export interface BoardPosition {
  x: number;
  y: number;
}

export interface BoardCardPosition extends BoardPosition {
  /** scene:场景标题元素 ID 或 beat:灵感卡 ID。 */
  id: string;
}

export const BOARD_GRID_SIZE = 28;

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** 只读自由板坐标投影；旧卡片缺失新字段时不改写写作 / PDF 的 x/y。 */
export function boardBeatPosition(beat: Pick<Beat, 'x' | 'y' | 'boardX' | 'boardY'>): BoardPosition {
  return {
    x: finite(beat.boardX, finite(beat.x, 0)),
    y: finite(beat.boardY, finite(beat.y, 0)),
  };
}

/**
 * 主动拖动时使用的磁性吸附投影。开启吸附或打开工程时不调用它写回坐标。
 * 开启后每个轴都落到最近的 28 世界单位网格线上（与画布参考网格一致），拖动时卡片整齐对齐；Alt 可临时绕过。
 */
export function snapBoardPosition(
  position: BoardPosition,
  enabled = false,
  bypass = false,
): BoardPosition {
  if (!enabled || bypass) return { ...position };
  const snapAxis = (value: number): number => Number.isFinite(value) ? Math.round(value / BOARD_GRID_SIZE) * BOARD_GRID_SIZE || 0 : value;
  return { x: snapAxis(position.x), y: snapAxis(position.y) };
}
