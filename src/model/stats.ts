import type { ElementType, ScriptProject } from './types';
import { plain, countWords } from '../utils/text';
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
    const text = plain(el.text);
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
  p.elements.forEach((el) => {
    if (el.type === 'note') return;
    elementCounts[el.type] = (elementCounts[el.type] || 0) + 1;
    const w = countWords(el.text);
    if (el.type === 'dialogue') dialogueWords += w;
    if (el.type === 'action') actionWords += w;
    cjk += plain(el.text).match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  });
  const totalAll = p.elements.reduce((acc, el) => (el.type === 'note' ? acc : acc + countWords(el.text)), 0);
  const pages = pageCount && pageCount > 0 ? pageCount : estimatePages(p);
  const scenes = deriveScenes(p);
  const chars = deriveCharacters(p);
  return {
    words: totalAll,
    cjk,
    dialogueWords,
    actionWords,
    elementCounts,
    sceneCount: scenes.length,
    characterCount: chars.length,
    estimatedPages: pages,
    estimatedMinutes: totalAll / Math.max(1, p.settings.wordsPerMinute),
  };
}

export interface SceneStatRow {
  number: string;
  heading: string;
  words: number;
  characters: string[];
  start: number;
  end: number;
}

export function sceneStats(p: ScriptProject): SceneStatRow[] {
  const scenes = deriveScenes(p);
  return scenes.map((s) => {
    let words = 0;
    const chars: string[] = [];
    for (let i = s.start; i < s.end; i += 1) {
      const el = p.elements[i];
      if (el.type === 'note') continue;
      words += countWords(el.text);
      if (el.type === 'character') {
        const n = plain(el.text).trim();
        if (n && !chars.includes(n)) chars.push(n);
      }
    }
    return { number: s.number, heading: s.heading, words, characters: chars, start: s.start, end: s.end };
  });
}

export function characterStats(p: ScriptProject): CharacterStat[] {
  return deriveCharacters(p);
}

export type { ElementType };
