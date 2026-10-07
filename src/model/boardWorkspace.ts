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
export const BOARD_SNAP_TOLERANCE_PX = 6;

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
 * 每个轴独立靠近 28 世界单位网格，容差保持为 6 个屏幕像素；Alt 可临时绕过。
 */
export function snapBoardPosition(
  position: BoardPosition,
  zoom = 1,
  enabled = false,
  bypass = false,
): BoardPosition {
  if (!enabled || bypass) return { ...position };
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const tolerance = BOARD_SNAP_TOLERANCE_PX / scale;
  const snapAxis = (value: number): number => {
    if (!Number.isFinite(value)) return value;
    const grid = Math.round(value / BOARD_GRID_SIZE) * BOARD_GRID_SIZE;
    return Math.abs(grid - value) <= tolerance ? grid : value;
  };
  return { x: snapAxis(position.x), y: snapAxis(position.y) };
}
