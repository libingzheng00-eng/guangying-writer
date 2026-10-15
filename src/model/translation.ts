import type { ScriptElement } from './types';
import { plain } from '../utils/text';

/*
 * 双语对照：译文按语言挂在每段上（element.tr[lang]），纯文本，不进分页正文、不改原文。
 * srcHash 记录翻译时原文的指纹；原文改过之后指纹对不上，就显示「原文已改，待复查」。
 * 指纹算法也被翻译技能（skills/guangying-translate）使用，两边必须一致。
 */

export const TRANSLATION_LANGUAGES = [
  { code: 'ja', label: '日文' },
  { code: 'en', label: '英文' },
] as const;
export type TranslationLanguage = typeof TRANSLATION_LANGUAGES[number]['code'];
export const isTranslationLanguage = (value: unknown): value is TranslationLanguage =>
  TRANSLATION_LANGUAGES.some((lang) => lang.code === value);

/** 原文指纹：去掉格式标签后的纯文字，FNV-1a 32 位，十六进制。 */
export function sourceHash(html: string): string {
  const text = plain(html || '').replace(/\r\n?/g, '\n').trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 需要翻译的段落：备忘和省略的不算。 */
export const isTranslatable = (el: ScriptElement) => el.type !== 'note' && !el.omit && plain(el.text).trim() !== '';

export type TranslationState = 'missing' | 'stale' | 'done';
export function translationState(el: ScriptElement, lang: string): TranslationState {
  const entry = el.tr?.[lang];
  if (!entry || !entry.text.trim()) return 'missing';
  return entry.srcHash === sourceHash(el.text) ? 'done' : 'stale';
}

export function translationProgress(elements: readonly ScriptElement[], lang: string) {
  const counts = { total: 0, done: 0, stale: 0, missing: 0 };
  for (const el of elements) {
    if (!isTranslatable(el)) continue;
    counts.total += 1;
    counts[translationState(el, lang)] += 1;
  }
  return counts;
}
