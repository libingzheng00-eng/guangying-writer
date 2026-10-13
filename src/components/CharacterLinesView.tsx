import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import type { ScriptElement } from '../model/types';
import { buildCharacterLineIndex, captureCharacterSceneAnchor, type CharacterLineCharacter, type CharacterOccurrence } from '../model/characterLines';
import { captureSceneAnchor, captureTextAnchor, type Annotation, type AnnotationAnchor } from '../model/annotations';
import { groupDual, deriveWritingElements, CONTD_SUFFIX } from '../model/flow';
import { searchText } from '../model/search';
import { makeTextRange } from '../utils/dom';
import { ELEMENT_META, fontStackOf } from '../model/elements';
import { StaticBlock } from './ScriptBlock';
import { CharacterProfileDialog, CharacterEvidenceDialog, CharacterNoteDialog } from './CharacterLinesDialog';
import { captureCharacterSourceTarget, loadCharacterReadingBookmark, saveCharacterReadingBookmark, type CharacterReadingBookmark, type CharacterSourceTarget } from '../app/characterNavigation';
import '../styles/character-lines.css';

type Filter = NonNullable<CharacterReadingBookmark['filter']>;
type Topic = 'note' | 'relationship' | 'knowledge';
type ReadingItem = ScriptElement | ScriptElement[];
type SearchHit = { elementId: string; sceneId: string; start: number; end: number; sourceText: string };
type Modal = { kind: 'profile'; character?: CharacterLineCharacter }
  | { kind: 'evidence'; occurrence: CharacterOccurrence; character: CharacterLineCharacter }
  | { kind: 'note'; character: CharacterLineCharacter; anchor: AnnotationAnchor; annotation?: Annotation; topic?: Topic; relatedCharacterId?: string };
export interface CharacterLinesViewProps {
  onLocate: (target: CharacterSourceTarget) => void;
  onReturnToWriting?: () => void;
}
const FILTERS: [Filter, string][] = [['all', '全部证据'], ['speaking', '发言'], ['present', '实际出场'], ['mentioned', '仅提及'], ['uncertain', '待确认']];
const TOPICS: Record<Topic, string> = { note: '人物笔记', relationship: '关系变化', knowledge: '知道的信息' };
const projected = new WeakMap<ScriptElement, string>();
function textOf(element: ScriptElement) {
  let text = projected.get(element);
  if (text === undefined) { text = searchText(element.text); projected.set(element, text); }
  return text;
}
function itemElements(item: ReadingItem) { return Array.isArray(item) ? item : [item]; }
function chunksOf(items: ReadingItem[]) {
  const chunks: ReadingItem[][] = [];
  let chunk: ReadingItem[] = [], length = 0, count = 0;
  for (const item of items) {
    const elements = itemElements(item), size = elements.reduce((sum, el) => sum + textOf(el).length, 0);
    if (chunk.length && (count + elements.length > 70 || length + size > 22000)) { chunks.push(chunk); chunk = []; length = 0; count = 0; }
    chunk.push(item); length += size; count += elements.length;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
function accepts(occurrence: CharacterOccurrence, filter: Filter) {
  if (filter === 'all') return occurrence.classification !== 'irrelevant';
  if (filter === 'speaking') return occurrence.kind === 'speech' && occurrence.classification !== 'irrelevant';
  if (filter === 'uncertain') return occurrence.ambiguous || occurrence.classification === 'uncertain';
  return occurrence.classification === filter;
}
function labelOf(occurrence: CharacterOccurrence) {
  if (occurrence.ambiguous) return '同名待确认';
  if (occurrence.classification === 'irrelevant') return '已排除';
  if (occurrence.kind === 'speech') return occurrence.classification === 'present' ? '发言 · 已确认出场' : '发言';
  return ({ present: '实际出场', mentioned: '仅提及', uncertain: '待确认', irrelevant: '已排除' })[occurrence.classification];
}

/** A new document session remounts all local forms and navigation. */
export function CharacterLinesView(props: CharacterLinesViewProps) {
  const epoch = useStore(state => state.documentEpoch);
  return <CharacterLinesSession key={epoch} {...props} epoch={epoch} />;
}

function CharacterLinesSession({ onLocate, onReturnToWriting, epoch }: CharacterLinesViewProps & { epoch: number }) {
  const project = useStore(state => state.project);
  const filePath = useStore(state => state.filePath);
  const [initialValue] = useState(() => loadCharacterReadingBookmark(project.id, filePath));
  const initial = useRef(initialValue);
  const [characterId, setCharacterId] = useState(initial.current?.characterKey || '');
  const [sceneId, setSceneId] = useState(initial.current?.sceneId || '');
  const [mode, setMode] = useState<'scene' | 'dialogue'>(initial.current?.mode || 'scene');
  const [filter, setFilter] = useState<Filter>(initial.current?.filter || 'all');
  const [includeOmitted, setIncludeOmitted] = useState(initial.current?.includeOmitted || false);
  const [query, setQuery] = useState(initial.current?.query || '');
  const [personQuery, setPersonQuery] = useState('');
  const [chunkIndex, setChunkIndex] = useState(0);
  const [activeHit, setActiveHit] = useState(-1);
  const [modal, setModal] = useState<Modal | null>(null);
  const [navigationError, setNavigationError] = useState(false);
  const [evidenceLimit, setEvidenceLimit] = useState(40);
  const [showAllScenes, setShowAllScenes] = useState(false);
  const readRoot = useRef<HTMLDivElement>(null);
  const readerScroll = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const pendingHit = useRef<SearchHit | null>(null);
  const restore = useRef(initial.current);
  const index = useMemo(() => buildCharacterLineIndex(project, { includeOmitted }), [project.elements, project.sceneMeta, project.characterWorkspace?.profiles, project.characterWorkspace?.overrides, project.characterWorkspace?.assignments, project.settings.autoNumberScenes, includeOmitted]);
  const elementsById = useMemo(() => new Map(project.elements.map(element => [element.id, element])), [project.elements]);
  const writing = useMemo(() => deriveWritingElements(project.elements), [project.elements]);
  const selected = index.characters.find(character => character.id === characterId) || index.characters[0];
  const personOccurrences = useMemo(() => selected ? index.occurrences.filter(item => item.characterId === selected.id || item.characterIds.includes(selected.id)) : [], [index, selected]);
  const accepted = useMemo(() => personOccurrences.filter(item => accepts(item, filter)), [personOccurrences, filter]);
  const matchedScenes = useMemo(() => new Set(accepted.map(item => item.sceneHeadingId || '')), [accepted]);
  const preambleIds = useMemo(() => {
    const first = project.elements.findIndex(element => element.type === 'scene_heading');
    return project.elements.slice(0, first < 0 ? undefined : first).filter(element => element.type !== 'note' && (includeOmitted || !element.omit)).map(element => element.id);
  }, [project.elements, includeOmitted]);
  const allScenes = useMemo(() => [
    ...(preambleIds.length ? [{ headingId: '', number: '—', heading: '场前文字', omitted: false, elementIds: preambleIds, storyTime: undefined }] : []), ...index.scenes,
  ], [index.scenes, preambleIds]);
  const visibleScenes = useMemo(() => allScenes.filter(scene => showAllScenes || matchedScenes.has(scene.headingId)), [allScenes, showAllScenes, matchedScenes]);
  const currentScene = visibleScenes.find(scene => scene.headingId === sceneId) || visibleScenes[0];
  const currentSceneIndex = currentScene ? visibleScenes.indexOf(currentScene) : -1;
  const currentEvidence = useMemo(() => personOccurrences.filter(item => (item.sceneHeadingId || '') === currentScene?.headingId), [personOccurrences, currentScene]);
  const dialogueIds = useMemo(() => {
    const ids = new Set<string>();
    currentEvidence.filter(item => item.kind === 'speech' && item.classification !== 'irrelevant').forEach(item => { ids.add(item.elementId); item.dialogueElementIds.forEach(id => ids.add(id)); });
    // Only model-owned dialogue participates; an explicit assignment can remove
    // a nearby dialogue from the original cue. Parentheticals attach backwards
    // from owned dialogue within the same dual side, never across another cue.
    for (const item of currentEvidence) {
      if (item.kind !== 'speech' || item.classification === 'irrelevant') continue;
      for (const dialogueId of item.dialogueElementIds) {
        const dialogue = elementsById.get(dialogueId);
        if (!dialogue) continue;
        const at = writing.indexByElement.get(dialogue);
        if (at === undefined) continue;
        for (let i = at - 1; i >= 0; i--) {
          const element = project.elements[i];
          if (element.dualGroup !== dialogue.dualGroup) break;
          if (element.dual !== dialogue.dual) continue;
          if (element.type !== 'parenthetical') break;
          ids.add(element.id);
        }
      }
    }
    return ids;
  }, [currentEvidence, project.elements, writing, elementsById]);
  const sceneElements = useMemo(() => currentScene ? currentScene.elementIds.map(id => elementsById.get(id)).filter((el): el is ScriptElement => !!el && el.type !== 'note') : [], [currentScene, elementsById]);
  const readingItems = useMemo(() => groupDual(sceneElements).filter(item => mode === 'scene' || itemElements(item).some(element => element.type === 'scene_heading' || dialogueIds.has(element.id))), [sceneElements, mode, dialogueIds]);
  const chunks = useMemo(() => chunksOf(readingItems), [readingItems]);
  const page = Math.min(chunkIndex, Math.max(0, chunks.length - 1));
  const renderedItems = chunks[page] || [];
  const markedIds = useMemo(() => new Set(currentEvidence.flatMap(item => item.classification === 'irrelevant' ? [] : [item.elementId, ...item.dialogueElementIds])), [currentEvidence]);
  const [sceneListLimit, setSceneListLimit] = useState(100);
  const search = useMemo(() => {
    if (!query) return { hits: [] as SearchHit[], capped: false };
    const hits: SearchHit[] = [];
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'giu');
    for (const scene of allScenes) {
      if (!matchedScenes.has(scene.headingId)) continue;
      for (const id of scene.elementIds) {
        const element = elementsById.get(id);
        if (!element || element.type === 'note' || (!includeOmitted && element.omit)) continue;
        const sourceText = textOf(element); pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(sourceText))) {
          if (hits.length >= 2000) return { hits, capped: true };
          hits.push({ elementId: id, sceneId: scene.headingId, start: match.index, end: match.index + match[0].length, sourceText });
        }
      }
    }
    return { hits, capped: false };
  }, [query, allScenes, matchedScenes, elementsById, includeOmitted]);
  const hitIndex = Math.max(0, Math.min(activeHit, Math.max(0, search.hits.length - 1)));

  const bookmark = useRef<CharacterReadingBookmark>({ version: 1, projectId: project.id });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const persist = useRef(() => {});
  persist.current = () => {
    if (!saveCharacterReadingBookmark(bookmark.current, filePath)) setNavigationError(true);
    else setNavigationError(false);
  };
  const schedule = () => { if (timer.current === undefined) timer.current = setTimeout(() => { timer.current = undefined; persist.current(); }, 350); };
  useEffect(() => {
    bookmark.current = { ...bookmark.current, version: 1, projectId: project.id, characterKey: selected?.id, sceneId: currentScene?.headingId || undefined,
      elementId: renderedItems[0] ? itemElements(renderedItems[0])[0]?.id : undefined, mode, filter, includeOmitted, query, updatedAt: Date.now() };
    schedule();
  }, [project.id, selected?.id, currentScene?.headingId, page, renderedItems, mode, filter, includeOmitted, query, filePath]);
  useEffect(() => () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    // Flush the departing session to its original path; never store document text.
    saveCharacterReadingBookmark(bookmark.current, filePath);
  }, [filePath]);
  useEffect(() => {
    const find = () => {
      if (document.querySelector('[aria-modal="true"]')) return;
      searchInput.current?.focus({ preventScroll: true }); searchInput.current?.select();
    };
    window.addEventListener('guangying:character-lines-find', find);
    return () => window.removeEventListener('guangying:character-lines-find', find);
  }, []);
  useLayoutEffect(() => {
    const saved = restore.current;
    if (!saved) return;
    const matchingChunk = saved.elementId ? chunks.findIndex(chunk => chunk.some(item => itemElements(item).some(el => el.id === saved.elementId))) : -1;
    if (matchingChunk >= 0 && matchingChunk !== page) { setChunkIndex(matchingChunk); return; }
    restore.current = null;
    if (readerScroll.current && saved.scrollTop !== undefined && currentScene?.headingId === (saved.sceneId || '')) readerScroll.current.scrollTop = saved.scrollTop;
  }, [chunks, page, currentScene]);
  useLayoutEffect(() => {
    (window.CSS as typeof CSS & { highlights?: Map<string, unknown> })?.highlights?.delete('character-lines-search');
    const hit = pendingHit.current;
    if (!hit || hit.sceneId !== currentScene?.headingId) return;
    const block = nodes.current.get(hit.elementId);
    if (!block) {
      const chunk = chunks.findIndex(list => list.some(item => itemElements(item).some(element => element.id === hit.elementId)));
      if (chunk >= 0 && chunk !== page) setChunkIndex(chunk);
      return;
    }
    const source = elementsById.get(hit.elementId);
    if (!source || textOf(source) !== hit.sourceText) { pendingHit.current = null; return; }
    const range = makeTextRange(block, hit.start, hit.end);
    const css = window.CSS as typeof CSS & { highlights?: Map<string, unknown> };
    const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (css?.highlights && HighlightClass) css.highlights.set('character-lines-search', new HighlightClass(range));
    const viewport = readerScroll.current;
    if (viewport && typeof range.getBoundingClientRect === 'function') {
      const target = range.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
      viewport.scrollTop += target.top - bounds.top - viewport.clientHeight / 3;
    } else block.scrollIntoView({ block: 'center' });
    pendingHit.current = null;
  }, [page, chunks, currentScene, elementsById, activeHit, query]);
  useEffect(() => () => { (window.CSS as typeof CSS & { highlights?: Map<string, unknown> })?.highlights?.delete('character-lines-search'); }, []);

  const chooseScene = (id: string) => { restore.current = null; setSceneId(id); setChunkIndex(0); setEvidenceLimit(40); if (readerScroll.current) readerScroll.current.scrollTop = 0; };
  const chooseCharacter = (id: string) => { restore.current = null; setCharacterId(id); setSceneId(''); setChunkIndex(0); setActiveHit(0); setEvidenceLimit(40); setShowAllScenes(false); if (readerScroll.current) readerScroll.current.scrollTop = 0; };
  const jump = (elementId: string, start = 0, end = start) => {
    const state = useStore.getState();
    if (state.documentEpoch !== epoch) return;
    const element = state.project.elements.find(item => item.id === elementId);
    const target = element && captureCharacterSourceTarget(element, epoch, start, end);
    if (!target) { state.notify('原文位置已失效，请重新选择。', 'error'); return; }
    persist.current(); onLocate(target);
  };
  const findHit = (requested: number) => {
    if (!search.hits.length) return;
    const next = (requested + search.hits.length) % search.hits.length;
    const hit = search.hits[next];
    pendingHit.current = hit; setActiveHit(next); setMode('scene'); setSceneId(hit.sceneId); setChunkIndex(0); restore.current = null;
  };
  const addNote = () => {
    if (!selected || !currentScene) return;
    if (!selected.registered) { setModal({ kind: 'profile', character: selected }); return; }
    const element = elementsById.get(currentScene.headingId || currentScene.elementIds[0]);
    const anchor = element && (element.type === 'scene_heading' ? captureSceneAnchor(element) : captureTextAnchor(element, 0, textOf(element).length));
    if (anchor) setModal({ kind: 'note', character: selected, anchor });
    else useStore.getState().notify('此处没有可用的笔记锚点。', 'error');
  };
  const markScene = () => {
    if (!selected || !currentScene?.headingId) return;
    if (!selected.registered) { setModal({ kind: 'profile', character: selected }); return; }
    const anchor = captureCharacterSceneAnchor(project, currentScene.headingId);
    const heading = elementsById.get(currentScene.headingId);
    if (!anchor || !heading) return;
    const occurrence: CharacterOccurrence = { id: '', kind: 'manual', characterId: selected.id, characterIds: [selected.id], ambiguous: false,
      sceneHeadingId: currentScene.headingId, elementId: currentScene.headingId, elementIndex: project.elements.indexOf(heading), start: 0, end: 0,
      quote: textOf(heading), sourceText: textOf(heading), sourceType: 'scene_heading', dialogueElementIds: [], classification: 'uncertain',
      source: 'manual-override', confidence: 'manual', explanation: '明确标记这位人物与当前场景的关系。由作者决定，不从动作自动判断。', anchor };
    setModal({ kind: 'evidence', occurrence, character: selected });
  };
  const noteLinks = project.characterWorkspace?.noteLinks || [];
  const sceneSet = new Set(currentScene?.elementIds || []);
  const notes = noteLinks.filter(link => link.characterId === selected?.id).flatMap(link => {
    const annotation = project.annotations?.find(item => item.id === link.annotationId);
    return annotation && (sceneSet.has(annotation.anchor.elementId) || annotation.anchorState === 'missing') ? [{ link, annotation }] : [];
  });
  const filteredCharacters = index.characters.filter(item => !personQuery || [item.canonicalName, item.disambiguation, ...item.aliases].some(value => value?.toLocaleLowerCase().includes(personQuery.toLocaleLowerCase())));
  const stale = [...index.staleOverrides, ...index.staleAssignments].filter(item => item.characterId === selected?.id);

  const renderBlock = (element: ScriptElement, half = false) => <div key={element.id} className={`character-lines__block${markedIds.has(element.id) ? ' is-character-evidence' : ''}`}>
    <StaticBlock el={element} settings={project.settings} half={half} revColor={project.revisions.find(revision => revision.id === element.rev)?.color}
      contdSuffix={project.settings.contdCharacter !== false && writing.contdCharacters.has(element) ? CONTD_SUFFIX : undefined}
      innerRef={node => { if (node) nodes.current.set(element.id, node); else nodes.current.delete(element.id); }} />
    <button className="character-lines__block-jump" aria-label={`定位${ELEMENT_META[element.type].label}原文`} title="定位这段原文" onClick={() => jump(element.id)}>↗</button>
  </div>;
  return <section className="character-lines" aria-label="人物线" data-export-exclude onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); searchInput.current?.focus(); searchInput.current?.select(); }
  }}>
    <header className="character-lines__bar"><div><strong>人物线</strong><span className="character-lines__muted">沿正文读人物，依据可核对</span></div><div className="character-lines__actions"><button className="btn" onClick={() => setModal({ kind: 'profile' })}>登记人物</button><button className="btn" onClick={() => { persist.current(); onReturnToWriting?.(); }}>返回写作</button></div></header>
    {navigationError && <p className="character-lines__warning" role="status">阅读位置暂时无法保存，正文和已保存的记录不受影响。</p>}
    <div className="character-lines__layout">
      <aside className="character-lines__nav" aria-label="人物与场景导航">
        <label className="character-lines__field"><span>人物</span><input aria-label="筛选人物登记" data-native-edit-history placeholder="查找姓名或别名" value={personQuery} onChange={event => setPersonQuery(event.target.value)} /></label>
        <select aria-label="阅读人物" value={selected?.id || ''} onChange={event => chooseCharacter(event.target.value)}>
          {!selected && <option value="">尚无人物</option>}
          {filteredCharacters.map(character => <option key={character.id} value={character.id}>{character.canonicalName}{character.disambiguation ? ` · ${character.disambiguation}` : ''}{character.registered ? '' : ' · 未登记'}</option>)}
        </select>
        {selected && <div className="character-lines__person"><h3>{selected.canonicalName}</h3>{selected.disambiguation && <p>{selected.disambiguation}</p>}<p className="character-lines__muted">{selected.registered ? `${selected.aliases.length} 个别名` : '来自正文人物栏，尚未登记'} · {selected.speakingCount} 次发言证据</p><button className="btn" onClick={() => setModal({ kind: 'profile', character: selected })}>{selected.registered ? '管理人物与别名' : '登记此人物'}</button></div>}
        {!index.characters.length && <p className="character-lines__empty">添加人物元素后可直接阅读，也可以先登记没有台词的人物。</p>}
        {index.characters.length > 0 && !filteredCharacters.length && <p className="character-lines__empty">没有匹配的人物。清除姓名筛选可查看全部。</p>}
        <label className="character-lines__field">证据范围<select aria-label="筛选人物证据" value={filter} onChange={event => { setFilter(event.target.value as Filter); setChunkIndex(0); }}>{FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="character-lines__check"><input type="checkbox" checked={includeOmitted} onChange={event => { setIncludeOmitted(event.target.checked); setChunkIndex(0); }} />包含省略内容</label>
        <label className="character-lines__check"><input type="checkbox" checked={showAllScenes} onChange={event => { setShowAllScenes(event.target.checked); setChunkIndex(0); }} />显示所有场景（可手动标记）</label>
        <div className="character-lines__scene-heading"><strong>正文顺序</strong><span>{visibleScenes.length} 场</span></div>
        <nav className="character-lines__scenes" aria-label="人物相关场景">{visibleScenes.slice(0, sceneListLimit).map(scene => <button key={scene.headingId || 'preamble'} aria-current={scene === currentScene ? 'true' : undefined} onClick={() => chooseScene(scene.headingId)}>
          <span className="character-lines__scene-number">{scene.number}</span><span><strong>{scene.heading || '未命名场景'}</strong>{(scene.storyTime || scene.omitted) && <small>{scene.storyTime || ''}{scene.storyTime && scene.omitted ? ' · ' : ''}{scene.omitted ? '已省略' : ''}</small>}</span>
        </button>)}{visibleScenes.length > sceneListLimit && <button className="btn" onClick={() => setSceneListLimit(value => value + 100)}>显示更多场景</button>}</nav>
        {selected && !visibleScenes.length && <p className="character-lines__empty">当前范围没有相关证据。可换一个筛选，或显示所有场景后手动标记。</p>}
      </aside>
      <div className="character-lines__main">
        <div className="character-lines__search"><input ref={searchInput} data-native-edit-history aria-label="搜索人物线原文" maxLength={500} placeholder="搜索此人物相关场景的原文" value={query} onChange={event => { setQuery(event.target.value); setActiveHit(0); }} onKeyDown={event => {
          event.stopPropagation(); if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') { event.preventDefault(); findHit(activeHit < 0 ? event.shiftKey ? search.hits.length - 1 : 0 : hitIndex + (event.shiftKey ? -1 : 1)); }
          if (event.key === 'Escape') { event.preventDefault(); setQuery(''); }
        }} /><button className="btn" disabled={!search.hits.length} aria-label="上一处" onClick={() => findHit(hitIndex - 1)}>↑</button><button className="btn" disabled={!search.hits.length} aria-label="下一处" onClick={() => findHit(hitIndex + 1)}>↓</button><span className="character-lines__muted" role="status">{query ? search.hits.length ? `${hitIndex + 1} / ${search.hits.length}${search.capped ? '+' : ''}` : '无匹配原文' : '⌘ / Ctrl F'}</span></div>
        {search.capped && <p className="character-lines__muted">显示前 2000 处，请增加搜索文字以缩小范围。</p>}
        {query && search.hits.length > 0 && <div className="character-lines__search-result"><span>{search.hits[hitIndex].sourceText.slice(Math.max(0, search.hits[hitIndex].start - 24), search.hits[hitIndex].end + 32)}</span><button className="btn" onClick={() => { const hit = search.hits[hitIndex]; findHit(hitIndex); jump(hit.elementId, hit.start, hit.end); }}>定位命中原文</button></div>}
        {currentScene && selected ? <>
          <header className="character-lines__scene-bar"><div><h2>{currentScene.number} · {currentScene.heading || '未命名场景'}</h2><p>{currentScene.storyTime && <span>故事时间：{currentScene.storyTime} · </span>}按正文顺序 · {currentSceneIndex + 1} / {visibleScenes.length}{currentScene.omitted ? ' · 已省略' : ''}</p></div>
            <div className="character-lines__actions"><button className="btn" disabled={currentSceneIndex <= 0} onClick={() => chooseScene(visibleScenes[currentSceneIndex - 1].headingId)}>上一场</button><button className="btn" disabled={currentSceneIndex < 0 || currentSceneIndex >= visibleScenes.length - 1} onClick={() => chooseScene(visibleScenes[currentSceneIndex + 1].headingId)}>下一场</button><button className="btn" onClick={() => jump(currentScene.headingId || currentScene.elementIds[0])}>定位正文</button></div>
          </header>
          <div className="character-lines__reader-tools"><div className="character-lines__modes" role="group" aria-label="阅读方式"><button aria-pressed={mode === 'scene'} onClick={() => { setMode('scene'); setChunkIndex(0); }}>完整场景</button><button aria-pressed={mode === 'dialogue'} onClick={() => { setMode('dialogue'); setChunkIndex(0); }}>台词聚焦</button></div><span className="character-lines__muted">{mode === 'scene' ? '保留其他人物与动作上下文' : '保留提示与完整双列伙伴；其他上下文收起'}</span><div className="character-lines__actions"><button className="btn" disabled={!currentScene.headingId} onClick={markScene}>标记此场人物</button><button className="btn" onClick={addNote}>添加人物笔记</button></div></div>
          {chunks.length > 1 && <div className="character-lines__chunk-nav"><span>长场阅读 {page + 1} / {chunks.length} 段组</span><button className="btn" disabled={!page} onClick={() => { setChunkIndex(page - 1); if (readerScroll.current) readerScroll.current.scrollTop = 0; }}>上一段组</button><button className="btn" disabled={page + 1 === chunks.length} onClick={() => { setChunkIndex(page + 1); if (readerScroll.current) readerScroll.current.scrollTop = 0; }}>下一段组</button></div>}
          <div ref={readerScroll} className="character-lines__scroll" tabIndex={0} aria-label="人物场景阅读区" onScroll={event => { bookmark.current.scrollTop = event.currentTarget.scrollTop; schedule(); }}>
            <div ref={readRoot} className="character-lines__script" style={{ fontFamily: fontStackOf(project.settings.fontKey), fontSize: `${project.settings.fontSize}px`, lineHeight: project.settings.lineHeight }}>
              {renderedItems.map(item => Array.isArray(item) ? <div className="sc-dual-row" key={item[0].id}><div className="sc-dual-col">{item.filter(element => element.dual !== 'right').map(element => renderBlock(element, true))}</div><div className="sc-dual-col">{item.filter(element => element.dual === 'right').map(element => renderBlock(element, true))}</div></div> : renderBlock(item))}
              {!renderedItems.length && <p className="character-lines__empty">这场没有可显示的发言。切换“完整场景”查看动作和其他人物。</p>}
            </div>
            <details className="character-lines__evidence" open><summary>本场证据 · {currentEvidence.length}</summary><p className="character-lines__muted">发言、实际在场与被提及分别记录。名字命中只提供证据，不自动判断人物心理或剧情。</p>
              {currentEvidence.slice(0, evidenceLimit).map(occurrence => <article key={occurrence.id} className="character-lines__evidence-card"><div className="character-lines__actions"><span className={`character-lines__tag${occurrence.ambiguous ? ' is-uncertain' : ''}`}>{labelOf(occurrence)}</span><small>{occurrence.confidence === 'manual' ? '作者确认' : occurrence.source === 'cue' ? '人物栏' : '原文名字命中'}</small></div><blockquote>{occurrence.quote || '作者标记整场'}</blockquote><p>{occurrence.explanation}</p><div className="character-lines__actions"><button className="btn" onClick={() => jump(occurrence.elementId, occurrence.start, occurrence.end)}>定位这处原文</button><button className="btn" onClick={() => setModal({ kind: 'evidence', occurrence, character: selected })}>确认 / 纠正</button></div></article>)}
              {currentEvidence.length > evidenceLimit && <button className="btn" onClick={() => setEvidenceLimit(value => value + 40)}>显示更多证据</button>}{!currentEvidence.length && <p className="character-lines__empty">此场尚无该人物的证据。可由作者手动标记。</p>}
            </details>
            {!!stale.length && <details className="character-lines__evidence"><summary>需要重新核对的作者记录 · {stale.length}</summary>{stale.slice(0, 40).map(item => <div className="character-lines__evidence-card" key={item.id}><p>{item.anchorState === 'missing' ? '原位置已缺失' : '原文已改变'} · 旧记录保留，未自动挂到其他同文。</p>{item.anchor.kind === 'text' && <blockquote>{item.anchor.quote}</blockquote>}{item.reason && <p>{item.reason}</p>}</div>)}</details>}
            <section className="character-lines__notes" aria-label="本场人物笔记"><h3>作者记录 <span>{notes.length}</span></h3><p className="character-lines__muted">选填。人物笔记、关系变化和知道的信息都保存在同一批注库。</p>{notes.map(({ link, annotation }) => <article className="character-lines__evidence-card" key={annotation.id}><div className="character-lines__actions"><strong>{TOPICS[link.topic || 'note']}</strong><span className="character-lines__tag">{annotation.status === 'pending' ? '需处理' : annotation.status === 'declined' ? '不采用' : '已记录'}</span>{annotation.anchorState !== 'current' && <span className="character-lines__tag">{annotation.anchorState === 'missing' ? '原位置缺失' : '原文已改变'}</span>}</div><p className="character-lines__note-body">{annotation.body}</p>{annotation.decision && <p>创作决定：{annotation.decision}</p>}{annotation.reason && <p>不采用原因：{annotation.reason}</p>}<div className="character-lines__actions"><button className="btn" onClick={() => setModal({ kind: 'note', character: selected, anchor: annotation.anchor, annotation, topic: link.topic, relatedCharacterId: link.relatedCharacterId })}>编辑人物笔记</button><button className="btn" disabled={!elementsById.has(annotation.anchor.elementId)} onClick={() => jump(annotation.anchor.elementId, annotation.anchor.kind === 'text' && annotation.anchorState === 'current' ? annotation.anchor.start : 0)}>定位笔记原文</button></div></article>)}{!notes.length && <p className="character-lines__empty">还没有人物笔记。需要时再记。</p>}</section>
          </div>
        </> : <div className="character-lines__welcome"><h2>{selected ? '这个范围还没有相关场景' : '从一个人物开始阅读'}</h2><p>{selected ? '可调整证据范围，或显示所有场景后标记没有台词的出场。' : '人物栏会提供初始线索。登记规范名与别名后，还可以核对提及、同名归属和作者记录。'}</p>{!project.elements.some(element => element.type === 'scene_heading') && <p>添加场次标题后，即可按场阅读；场前文字仍可定位。</p>}</div>}
      </div>
    </div>
    {modal?.kind === 'profile' && <CharacterProfileDialog epoch={epoch} profile={modal.character} onClose={() => setModal(null)} onSaved={chooseCharacter} />}
    {modal?.kind === 'evidence' && <CharacterEvidenceDialog epoch={epoch} occurrence={modal.occurrence} character={modal.character} characters={index.characters} onClose={() => setModal(null)} />}
    {modal?.kind === 'note' && <CharacterNoteDialog epoch={epoch} character={modal.character} characters={index.characters} anchor={modal.anchor} annotation={modal.annotation} topic={modal.topic} relatedCharacterId={modal.relatedCharacterId} onClose={() => setModal(null)} />}
  </section>;
}
