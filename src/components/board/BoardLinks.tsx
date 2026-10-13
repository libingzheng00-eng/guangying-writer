import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/store';
import type { BoardLink } from '../../model/types';
import { stopMouse, stopWheel, type Layout } from './boardShared';

// 关系线从矩形边缘出发；保存的端点仍是卡片 ID，不保存像素、也不改变关系语义。
function connectionPath(a: Layout, b: Layout) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x, dy = bc.y - ac.y;
  const edge = (card: Layout) => Math.min(dx ? card.w / 2 / Math.abs(dx) : Infinity, dy ? card.h / 2 / Math.abs(dy) : Infinity);
  const af = edge(a), bf = edge(b);
  if (!Number.isFinite(af) || !Number.isFinite(bf)) return { d: '', x: ac.x, y: ac.y };
  const start = { x: ac.x + dx * af, y: ac.y + dy * af }, end = { x: bc.x - dx * bf, y: bc.y - dy * bf };
  const x = (start.x + end.x) / 2, y = (start.y + end.y) / 2;
  const controls = Math.abs(dx) >= Math.abs(dy) ? `${x} ${start.y}, ${x} ${end.y}` : `${start.x} ${y}, ${end.x} ${y}`;
  return { d: `M ${start.x} ${start.y} C ${controls}, ${end.x} ${end.y}`, x, y };
}
export function BoardLinks({ links, layouts, selectedLink, zoom, onSelect, onFinish }: { links: BoardLink[]; layouts: Map<string, Layout>; selectedLink: string | null; zoom: number; onSelect: (id: string) => void; onFinish: () => void }) {
  return <svg className="board-links" aria-label="卡片关系线">
    {links.map((link) => {
      const a = layouts.get(link.from), b = layouts.get(link.to); if (!a || !b) return null;
      const line = connectionPath(a, b);
      return <g key={link.id} data-link-id={link.id} className={`board-link${selectedLink === link.id ? ' is-selected' : ''}`}>
        <path className="board-link__stroke" d={line.d} vectorEffect="non-scaling-stroke" />
        <path className="board-link__hit" data-link-id={link.id} d={line.d} style={{ strokeWidth: 14 / zoom }} onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); onSelect(link.id); }} onDoubleClick={stopMouse} />
        <foreignObject x={line.x - 130} y={line.y - 18} width="260" height="38"><LinkLabel link={link} selected={selectedLink === link.id} onSelect={onSelect} onFinish={onFinish} /></foreignObject>
      </g>;
    })}
  </svg>;
}
function LinkLabel({ link, selected, onSelect, onFinish }: { link: BoardLink; selected: boolean; onSelect: (id: string) => void; onFinish: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(link.note || '');
  const draftRef = useRef(draft); draftRef.current = draft;
  const finishing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!editing) setDraft(link.note || ''); }, [link.note, editing]);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);
  const finish = (commit: boolean) => {
    if (finishing.current) return; finishing.current = true;
    if (commit && draftRef.current !== (link.note || '')) useStore.getState().commitBoardLinkNote(link.id, draftRef.current);
    setEditing(false); onFinish();
  };
  const begin = () => { onSelect(link.id); finishing.current = false; setDraft(link.note || ''); setEditing(true); };
  return <div className="board-link__note" onMouseDown={stopMouse} onDoubleClick={stopMouse} onWheel={stopWheel}>
    {editing ? <input ref={inputRef} data-native-edit-history data-project-draft-pending={draft !== (link.note || '') ? 'true' : undefined} className="board-link__input" aria-label="关系说明" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation(); if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); finish(event.key === 'Enter'); }
      }} /> : (link.note || selected) ? <button className={`board-link__label${link.note ? '' : ' is-empty'}`} aria-label={link.note ? `关系说明：${link.note}` : '添加关系说明'} title="双击编辑关系说明"
      onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); onSelect(link.id); }} onDoubleClick={begin}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); event.stopPropagation(); begin(); } }}>{link.note || '双击添加关系说明'}</button> : null}
  </div>;
}
