import { isTranslationLanguage, sourceHash, type TranslationLanguage } from '../../model/translation';
import type { StoreState, SetState, GetState } from '../types';

/* 双语对照：写译文、标记已复查，以及「写作页 / 预览里显示哪种译文」这个本机偏好。 */
const LS_SHOWN_TRANSLATION = 'guangying:shownTranslation';

export function loadShownTranslation(): TranslationLanguage | null {
  try {
    const value = localStorage.getItem(LS_SHOWN_TRANSLATION);
    return isTranslationLanguage(value) ? value : null;
  } catch { return null; }
}

export const createTranslationSlice = (set: SetState, get: GetState): Partial<StoreState> => ({
  /** 连续输入同一段同一语言的译文合并为一步撤销；清空即删除这条译文。 */
  setTranslation: (id, lang, text) => get().mutate((p) => {
    const el = p.elements.find((e) => e.id === id);
    if (!el) return;
    if (!text.trim()) {
      if (el.tr) { delete el.tr[lang]; if (!Object.keys(el.tr).length) delete el.tr; }
      return;
    }
    el.tr = { ...(el.tr || {}), [lang]: { text, srcHash: sourceHash(el.text) } };
  }, { coalesce: `tr:${id}:${lang}` }),
  /** 原文改过、但译文看过不用改：只更新指纹，去掉「待复查」。 */
  markTranslationReviewed: (id, lang) => get().mutate((p) => {
    const el = p.elements.find((e) => e.id === id);
    const entry = el?.tr?.[lang];
    if (el && entry) entry.srcHash = sourceHash(el.text);
  }),
  /** 译名表整表替换；同一种语言的连续编辑合并为一步撤销。 */
  setGlossary: (lang, rows) => get().mutate((p) => {
    const clean = rows.map((row) => ({ source: row.source.slice(0, 200), target: row.target.slice(0, 200), ...(row.note ? { note: row.note.slice(0, 1000) } : {}) }));
    p.translation = { ...(p.translation || {}), glossary: { ...(p.translation?.glossary || {}), [lang]: clean } };
  }, { coalesce: `glossary:${lang}` }),
  setShownTranslation: (lang) => {
    try { if (lang) localStorage.setItem(LS_SHOWN_TRANSLATION, lang); else localStorage.removeItem(LS_SHOWN_TRANSLATION); } catch { /* 只影响本机显示 */ }
    set({ shownTranslation: lang });
  },
});
