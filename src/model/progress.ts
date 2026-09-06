/**
 * 写作进度条场景条带计算（v1.2.9 同款，v3.3-scene-strips）。
 *
 * 算法：按 scene_heading 切场景；每个场景按元素类型 charsPerLine 折算「预计排版行数」，
 *       跳过 omit / note / act，加上 indent.spaceBefore 的前置行；调色板 10 色按场景下标循环。
 *
 * 该函数只读取 project，不会修改它；可作为 Editor 顶部 ProgressBar 的纯数据源，
 * 也可由 scripts/writing-test.cjs 在 Node 环境直接验证。
 */
import type { ScriptElement, ScriptProject } from './types';
import { deriveScenes } from './project';
import { plain } from '../utils/text';

/** 每个元素类型每行容纳的全角字符数（v1.2.9 同款） */
export const CHARS_PER_LINE: Partial<Record<string, number>> = {
  scene_heading: 28,
  action: 32,
  character: 14,
  parenthetical: 18,
  dialogue: 20,
  transition: 24,
  shot: 28,
  general: 32,
};
const DEFAULT_CHARS_PER_LINE = 30;

/** 场景条带调色板（v1.2.9 同款 10 色循环） */
export const SCENE_BAND_PALETTE = [
  '#78938b',
  '#6c827d',
  '#879b94',
  '#627873',
  '#92a49e',
  '#718983',
  '#82968f',
  '#5e746f',
  '#8b9f98',
  '#69807a',
];

export interface SceneBand {
  elementId: string;
  /** 该场景在 elements 数组中的 [start, end) 区间 */
  start: number;
  end: number;
  number: string;
  heading: string;
  /** 预计排版行数（v1.2.9 的 weight；至少为 1） */
  weight: number;
  color: string;
  /** 占全部场景总行的百分比 0-100 */
  pct: number;
}

/**
 * 计算每个场景的预计行数与占比。
 * - 不写入 project；
 * - 输入 project 没有场景时返回空数组。
 */
export function computeSceneBands(project: ScriptProject): SceneBand[] {
  const scenes = deriveScenes(project);
  if (!scenes.length) return [];
  const rows: SceneBand[] = [];
  let total = 0;
  scenes.forEach((scene, sceneIndex) => {
    let weight = 0;
    for (let i = scene.start; i < scene.end; i += 1) {
      const item: ScriptElement | undefined = project.elements[i];
      if (!item) continue;
      if (item.omit || item.type === 'note' || item.type === 'act') continue;
      const text = plain(item.text || '').replace(/\s/g, '');
      const perLine = CHARS_PER_LINE[item.type] ?? DEFAULT_CHARS_PER_LINE;
      const indent = project.settings.indent?.[item.type];
      const before = indent ? Math.max(0, Number(indent.spaceBefore) || 0) : 0;
      weight += Math.max(1, Math.ceil(text.length / perLine)) + before;
    }
    weight = Math.max(1, weight);
    total += weight;
    rows.push({
      elementId: scene.elementId,
      start: scene.start,
      end: scene.end,
      number: scene.number || String(sceneIndex + 1),
      heading: scene.heading || '',
      weight,
      color: SCENE_BAND_PALETTE[sceneIndex % SCENE_BAND_PALETTE.length],
      pct: 0,
    });
  });
  // 第二遍：算出 pct
  return rows.map((r) => ({ ...r, pct: total > 0 ? (r.weight / total) * 100 : 0 }));
}

/**
 * 根据完成百分比和目标，超出目标多少页（不会为负）。
 * 当 writtenPages <= target 时返回 0。
 */
export function overPages(writtenPages: number, target: number): number {
  if (!target || target <= 0) return 0;
  return Math.max(0, writtenPages - target);
}

/**
 * 已写页数（去除标题页占位），与 v1.2.9 一致：
 *   - 标题页独立成页且开启了 → 减 1
 *   - 但至少保留 1（避免空工程算出 0%）
 */
export function writtenPagesExcludingTitle(pageCount: number, project: ScriptProject): number {
  const titlePageCount = project.titlePage?.show && project.settings.titlePageBreak ? 1 : 0;
  return Math.max(pageCount > 0 ? 1 : 0, pageCount - titlePageCount);
}

/**
 * 边界兜底后的目标页数。0 表示「关闭目标页数」（隐藏进度条），>9999 封顶。
 *
 * 输入语义：
 *   - `undefined / null / NaN / -Infinity / 非有限数` → 0（关闭）
 *   - `<= 0`（含负数、0、-0） → 0（关闭）
 *   - `> 9999` → 9999（封顶）
 *   - `(0, 9999]` → Math.round 四舍五入到整数
 *
 * 不抛异常；不写日志；不依赖 React / Zustand；可在 Node 环境纯函数测试。
 */
export function clampTargetPages(input: unknown): number {
  if (input == null) return 0;
  if (typeof input !== 'number') return 0;
  if (!Number.isFinite(input)) return 0;
  if (input <= 0) return 0;
  if (input > 9999) return 9999;
  return Math.round(input);
}

/**
 * 加载 / 解析 `.zhsp` 时用的归一化函数。
 *
 * 与 `clampTargetPages` 的区别：加载时**保留 `undefined`** 表示「未设置」，
 * 旧工程缺省时不强行改成 0 或 100；运行时 `setTargetPages` 才必须落到 0..9999 整数。
 *
 *   - `undefined / null / 非数 / NaN / -Infinity` → `undefined`（视为未设）
 *   - `<= 0` → `undefined`（0 在历史工程中语义模糊，按未设处理）
 *   - `> 9999` → `9999`
 *   - `(0, 9999]` → `Math.round`
 */
export function normalizeTargetPages(input: unknown): number | undefined {
  if (input == null) return undefined;
  if (typeof input !== 'number') return undefined;
  if (!Number.isFinite(input)) return undefined;
  if (input <= 0) return undefined;
  if (input > 9999) return 9999;
  return Math.round(input);
}
