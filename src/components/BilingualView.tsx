import React, { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { deriveScenes } from '../model/project';
import { ELEMENT_META } from '../model/elements';
import { plain } from '../utils/text';
import { TRANSLATION_LANGUAGES, isTranslatable, translationProgress, translationState, type TranslationLanguage } from '../model/translation';

type Filter = 'all' | 'missing' | 'stale';

/**
 * 双语对照：左边原文只读，右边写译文，一段一行对齐。
 * 原文在写作页里改；这里只改译文，所以 Tab 只在译文框之间跳，智能输入不参与。
 * 原文改过之后，那一段标「原文已改，待复查」，看过不用改可以点「已复查」。
 */
export function BilingualView() {
  const project = useStore((s) => s.project);
  const shown = useStore((s) => s.shownTranslation);
  const [lang, setLang] = useState<TranslationLanguage>(shown || 'ja');
  const [filter, setFilter] = useState<Filter>('all');
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const sceneNo = useMemo(() => new Map(deriveScenes(project).map((scene) => [scene.elementId, scene.number])), [project]);
  const rows = project.elements.filter(isTranslatable);
  const progress = translationProgress(project.elements, lang);
  const visible = filter === 'all' ? rows : rows.filter((el) => translationState(el, lang) === filter);
  const store = useStore.getState;

  return (
    <div className="bilingual">
      <div className="bilingual__bar">
        <span className="bilingual__title">双语对照</span>
        <div className="segmented" role="tablist" aria-label="译文语言">
          {TRANSLATION_LANGUAGES.map((item) => (
            <button key={item.code} role="tab" aria-selected={lang === item.code} className={lang === item.code ? 'is-active' : ''} onClick={() => setLang(item.code)}>{item.label}</button>
          ))}
        </div>
        <span className="bilingual__progress" aria-live="polite">
          已译 {progress.done}/{progress.total}{progress.stale ? ` · 待复查 ${progress.stale}` : ''}{progress.missing ? ` · 未译 ${progress.missing}` : ''}
        </span>
        <select aria-label="只看" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
          <option value="all">全部段落</option>
          <option value="missing">只看未译</option>
          <option value="stale">只看待复查</option>
        </select>
        <div className="bilingual__spacer" />
        <label className="bilingual__shown">写作页 / 预览显示译文
          <select aria-label="写作页和预览显示的译文" value={shown || ''} onChange={(event) => store().setShownTranslation((event.target.value || null) as TranslationLanguage | null)}>
            <option value="">不显示</option>
            {TRANSLATION_LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
        </label>
        <button className={`btn btn--ghost${glossaryOpen ? ' is-active' : ''}`} aria-pressed={glossaryOpen} onClick={() => setGlossaryOpen((open) => !open)}>译名表</button>
      </div>
      <div className="bilingual__body">
        <div className="bilingual__list" role="list" aria-label="原文与译文">
          <div className="bilingual__head" aria-hidden="true"><span>原文</span><span>{TRANSLATION_LANGUAGES.find((item) => item.code === lang)?.label}译文</span></div>
          {visible.length ? visible.map((el) => {
            const state = translationState(el, lang);
            const number = el.type === 'scene_heading' ? sceneNo.get(el.id) : undefined;
            return (
              <div key={el.id} className={`bilingual__row bilingual__row--${el.type} is-${state}`} role="listitem" data-id={el.id}>
                <div className="bilingual__source">
                  <span className="bilingual__type">{number ? `${number} · ` : ''}{ELEMENT_META[el.type].short}</span>
                  <div className="bilingual__source-text">{plain(el.text)}</div>
                </div>
                <div className="bilingual__target">
                  <textarea
                    aria-label={`${ELEMENT_META[el.type].short}译文`}
                    data-native-edit-history
                    value={el.tr?.[lang]?.text || ''}
                    placeholder="（未翻译）"
                    spellCheck={false}
                    onChange={(event) => store().setTranslation(el.id, lang, event.target.value)}
                    onKeyDown={(event) => event.stopPropagation()}
                  />
                  {state === 'stale' ? (
                    <div className="bilingual__stale">
                      原文已改，待复查
                      <button tabIndex={-1} onClick={() => store().markTranslationReviewed(el.id, lang)}>已复查</button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          }) : <div className="bilingual__empty">{rows.length ? '没有符合条件的段落。' : '剧本里还没有可以翻译的段落。'}</div>}
        </div>
        {glossaryOpen ? <GlossaryPanel lang={lang} /> : null}
      </div>
    </div>
  );
}

/** 人名、地名等固定译名：翻译技能会先填一份，作者可以在这里改。 */
function GlossaryPanel({ lang }: { lang: TranslationLanguage }) {
  const saved = useStore((s) => s.project.translation?.glossary?.[lang]);
  const notes = useStore((s) => s.project.translation?.notes?.[lang]);
  const rows = saved || [];
  const update = (next: typeof rows) => useStore.getState().setGlossary(lang, next);
  return (
    <aside className="bilingual__glossary" aria-label="译名表">
      <h3>译名表</h3>
      <p className="bilingual__hint">人名、地名、专有名词的固定译法。翻译时会照这张表统一。</p>
      {rows.map((row, index) => (
        <div className="bilingual__glossary-row" key={index}>
          <input aria-label="原文名称" value={row.source} onChange={(event) => update(rows.map((r, i) => i === index ? { ...r, source: event.target.value } : r))} onKeyDown={(event) => event.stopPropagation()} />
          <span aria-hidden="true">→</span>
          <input aria-label="译名" value={row.target} onChange={(event) => update(rows.map((r, i) => i === index ? { ...r, target: event.target.value } : r))} onKeyDown={(event) => event.stopPropagation()} />
          <button aria-label="删除这一行" onClick={() => update(rows.filter((_, i) => i !== index))}>✕</button>
        </div>
      ))}
      <button className="btn btn--ghost" onClick={() => update([...rows, { source: '', target: '' }])}>＋ 添加一行</button>
      {notes ? <><h3>翻译说明</h3><p className="bilingual__notes">{notes}</p></> : null}
    </aside>
  );
}
