import type { ElementType, ScriptProject } from './types';
import { plainOf, wordsOf, hanCountOf } from './textCache';
import { deriveCharacters, deriveScenes } from './project';
import type { CharacterStat } from './project';

export interface ScriptStats {
  words: number;
  cjk: number;
  dialogueWords: number;
  actionWords: number;
  elementCounts: Record<string, number>;
  sceneCount: number;
  characterCount: number;
  estimatedPages: number;
  estimatedMinutes: number;
}

/** 纸张尺寸（mm） */
export const PAPER_MM: Record<string, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  letter: { w: 215.9, h: 279.4 },
};

/** 正文区宽度（cm） */
export function contentWidthCm(p: ScriptProject): number {
  const paper = PAPER_MM[p.settings.paper] || PAPER_MM.A4;
  return paper.w / 10 - p.settings.marginLeft - p.settings.marginRight;
}

export function contentHeightCm(p: ScriptProject): number {
  const paper = PAPER_MM[p.settings.paper] || PAPER_MM.A4;
  return paper.h / 10 - p.settings.marginTop - p.settings.marginBottom;
}

/** 每行可容纳的全角字符数 */
export function charsPerLine(p: ScriptProject): number {
  const fsCm = (p.settings.fontSize * 2.54) / 72; // 1pt = 1/72 inch
  return Math.max(10, Math.floor(contentWidthCm(p) / fsCm));
}

/** 每页可容纳的行数 */
export function linesPerPage(p: ScriptProject): number {
  const lhCm = ((p.settings.fontSize * p.settings.lineHeight) * 2.54) / 72;
  return Math.max(5, Math.floor(contentHeightCm(p) / lhCm));
}

/** 粗略估算页数：按元素折行 + 元素前后空行 */
export function estimatePages(p: ScriptProject): number {
  const cpl = charsPerLine(p);
  const lpp = linesPerPage(p);
  let lines = 0;
  p.elements.forEach((el) => {
    if (el.type === 'note') return;
    const fmt = p.settings.indent[el.type];
    const left = fmt ? fmt.left : 0;
    const right = fmt ? fmt.right : 0;
    const width = Math.max(8, cpl - left - right);
    const text = plainOf(el);
    const raw = text.length ? text : ' ';
    let l = 0;
    raw.split('\n').forEach((seg) => {
      l += Math.max(1, Math.ceil(seg.length / width));
    });
    lines += l + (fmt?.spaceBefore ?? 0);
  });
  if (p.titlePage.show && p.settings.titlePageBreak) lines += lpp;
  return Math.max(1, Math.ceil(lines / lpp));
}

export function computeStats(p: ScriptProject, pageCount?: number): ScriptStats {
  const elementCounts: Record<string, number> = {};
  let dialogueWords = 0;
  let actionWords = 0;
  let cjk = 0;
  let words = 0;
  p.elements.forEach((el) => {
    if (el.type === 'note') return;
    elementCounts[el.type] = (elementCounts[el.type] || 0) + 1;
    // 按段落缓存：打字时只有正在写的那一段需要重新数字。
    const w = wordsOf(el);
    words += w;
    if (el.type === 'dialogue') dialogueWords += w;
    if (el.type === 'action') actionWords += w;
    cjk += hanCountOf(el);
  });
  const pages = pageCount && pageCount > 0 ? pageCount : estimatePages(p);
  const scenes = deriveScenes(p);
  const chars = deriveCharacters(p);
  return {
    words,
    cjk,
    dialogueWords,
    actionWords,
    elementCounts,
    sceneCount: scenes.length,
    characterCount: chars.length,
    estimatedPages: pages,
    estimatedMinutes: words / Math.max(1, p.settings.wordsPerMinute),
  };
}


export type { ElementType };
