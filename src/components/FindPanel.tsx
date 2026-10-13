import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { searchScript } from '../model/search';
import { makeTextRange } from '../utils/dom';
import { ELEMENT_META } from '../model/elements';

/** Search highlights are browser paint only. Replace is an explicit, single-undo store transaction. */
export function FindPanel({ request, onClose }: { request: number; onClose: () => void }) {
  const elements = useStore(s => s.project.elements);
  const projectId = useStore(s => s.project.id);
  const exporting = useStore(s => s.pdfExportMode);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [index, setIndex] = useState(0);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacement, setReplacement] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const matches = useMemo(() => searchScript(elements, query, { caseSensitive }), [elements, query, caseSensitive]);
  const currentIndex = matches.length ? Math.min(index, matches.length - 1) : 0;
  const current = matches[currentIndex];
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [request]);
  useEffect(() => { setIndex(0); }, [query, caseSensitive, projectId]);

  useEffect(() => {
    const css = window.CSS as typeof CSS & { highlights?: Map<string, unknown> };
    const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const cleanup = () => { css?.highlights?.delete('script-find'); css?.highlights?.delete('script-find-current'); };
    if (exporting) { cleanup(); return; }
    const nodes = new Map(Array.from(document.querySelectorAll<HTMLElement>('.script-flow .sc-el--editable')).map(node => [node.dataset.id, node]));
    const ranges = matches.slice(0, 2000).flatMap(match => {
      const node = nodes.get(match.elementId);
      return node ? [makeTextRange(node, match.start, match.end)] : [];
    });
    if (HighlightClass && css?.highlights) {
      css.highlights.set('script-find', new HighlightClass(...ranges));
      const node = current && nodes.get(current.elementId);
      css.highlights.set('script-find-current', new HighlightClass(...(node ? [makeTextRange(node, current.start, current.end)] : [])));
    }
    return cleanup;
  }, [matches, current, exporting]);

  // Scroll the match itself, including a hit in the middle of a long paragraph.
  // While the author is typing in the script, do not steal their focus or scrolling.
  useEffect(() => {
    if (!current || exporting || !panel.current?.contains(document.activeElement)) return;
    const node = Array.from(document.querySelectorAll<HTMLElement>('.script-flow .sc-el--editable')).find(node => node.dataset.id === current.elementId);
    const editor = document.querySelector<HTMLElement>('.editor');
    if (!node || !editor) return;
    const rect = makeTextRange(node, current.start, current.end).getBoundingClientRect();
    const viewport = editor.getBoundingClientRect();
    editor.scrollTop += rect.top - viewport.top - editor.clientHeight / 2;
  }, [current, exporting]);
  const move = (direction: number) => setIndex(matches.length ? (currentIndex + direction + matches.length) % matches.length : 0);
  const close = () => {
    if (current) useStore.getState().requestFocus(current.elementId, current.start);
    onClose();
  };
  const replace = (all: boolean) => {
    const state = useStore.getState();
    const targets = all ? matches : current ? [current] : [];
    if (!targets.length) return;
    const count = state.replaceMatches(targets.map(match => ({ elementId: match.elementId, start: match.start, end: match.end,
      text: match.snippet.slice(match.start - match.snippetStart, match.end - match.snippetStart) })), replacement, state.documentEpoch);
    if (!count) { state.notify('正文已经改变，请重新查找后再替换。', 'error'); return; }
    if (all) state.notify(`已替换 ${count} 处。可用撤销（⌘/Ctrl+Z）一次恢复。`, 'ok');
  };
  const listStart = Math.max(0, currentIndex - 20);
  return <aside ref={panel} className="find-panel" aria-label="查找正文" onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <div className="find-panel__heading"><strong>{replaceOpen ? '查找与替换' : '查找正文'}</strong><button className="find-panel__toggle" aria-pressed={replaceOpen} onClick={() => setReplaceOpen(open => !open)} title="显示或隐藏替换">替换</button><button onClick={close} title="关闭查找 Esc" aria-label="关闭查找">×</button></div>
    <div className="find-panel__query">
      <input ref={input} aria-label="查找内容" placeholder="输入要查找的字词" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
      }} />
      <button disabled={!matches.length} onClick={() => move(-1)} aria-label="上一处" title="上一处 Shift+Enter">↑</button>
      <button disabled={!matches.length} onClick={() => move(1)} aria-label="下一处" title="下一处 Enter">↓</button>
    </div>
    {replaceOpen && <div className="find-panel__query find-panel__replace">
      <input aria-label="替换为" placeholder="替换为（可留空以删除）" value={replacement} onChange={event => setReplacement(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); replace(false); }
      }} />
      <button disabled={!current} onClick={() => replace(false)} title="替换当前这一处 Enter">替换</button>
      <button disabled={!matches.length} onClick={() => replace(true)} title="替换全部匹配，可一次撤销">全部替换</button>
    </div>}
    <div className="find-panel__options"><span role="status">{query ? matches.length ? `${currentIndex + 1} / ${matches.length} 处` : '没有找到匹配内容' : '搜索全文（含备忘）'}</span><label><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} />区分大小写</label></div>
    <div className="find-panel__results">
      {matches.slice(listStart, listStart + 60).map((match, offset) => <button key={`${match.elementId}:${match.start}`} className={currentIndex === listStart + offset ? 'is-current' : ''} aria-current={currentIndex === listStart + offset ? 'true' : undefined} onClick={() => setIndex(listStart + offset)}>
        <small>{listStart + offset + 1} · {ELEMENT_META[match.type].label}</small>
        <span>{match.snippetStart > 0 ? '…' : ''}{match.snippet.slice(0, match.start - match.snippetStart)}<mark>{match.snippet.slice(match.start - match.snippetStart, match.end - match.snippetStart)}</mark>{match.snippet.slice(match.end - match.snippetStart)}</span>
      </button>)}
    </div>
  </aside>;
}
