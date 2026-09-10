import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { deriveScenes, newElement } from '../model/project';
import { CARD_COLORS } from '../model/elements';
import { storyboardPageCounts, type StoryboardPlacement } from '../model/storyboard';
import { usePagination } from '../hooks/PaginationProvider';

type DragState = { elementId: string; ids: string[] } | null;

export function CardsView() {
  const project = useStore((s) => s.project);
  const setView = useStore((s) => s.setView);
  const requestFocus = useStore((s) => s.requestFocus);
  const updateSceneMeta = useStore((s) => s.updateSceneMeta);
  const moveScenesToAct = useStore((s) => s.moveScenesToAct);
  const addSceneAfter = useStore((s) => s.addSceneAfter);
  const updateAct = useStore((s) => s.updateAct);
  const addAct = useStore((s) => s.addAct);
  const removeAct = useStore((s) => s.removeAct);
  const version = useStore((s) => s.version);
  const pagination = usePagination();
  const [drag, setDrag] = useState<DragState>(null);
  const dragRef = useRef<DragState>(null);
  const [over, setOver] = useState<StoryboardPlacement | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    setSelected([]); setCollapsed([]); setDeleting(null); setEditing(null);
    anchor.current = null; dragRef.current = null; setDrag(null); setOver(null); setDropTarget(null);
  }, [project.id]);

  const scenes = useMemo(() => deriveScenes(project), [project]);
  const grouped = useMemo(() => {
    const map = new Map<string, typeof scenes>();
    project.acts.forEach((a) => map.set(a.id, []));
    const other: typeof scenes = [];
    scenes.forEach((s) => {
      if (s.actId && map.has(s.actId)) map.get(s.actId)!.push(s);
      else other.push(s);
    });
    return { map, other };
  }, [scenes, project.acts]);
  const pageCounts = useMemo(() => storyboardPageCounts(project, pagination.pages), [project, pagination.pages]);
  const pagesReady = pagination.readyKey === `${version}:${project.settings.paper}`;
  const selectedIds = selected.filter(id => scenes.some(scene => scene.elementId === id));
  const visibleOrder = [...(collapsed.includes('') ? [] : grouped.other), ...project.acts.flatMap(act => collapsed.includes(act.id) ? [] : grouped.map.get(act.id) || [])]
    .map(scene => scene.elementId);
  const select = (id: string, range: boolean) => {
    if (range && anchor.current && visibleOrder.includes(anchor.current)) {
      const from = visibleOrder.indexOf(anchor.current), to = visibleOrder.indexOf(id);
      setSelected(visibleOrder.slice(Math.min(from, to), Math.max(from, to) + 1));
    } else {
      setSelected(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
      anchor.current = id;
    }
  };
  const clearDrag = () => {
    dragRef.current = null; setDrag(null); setOver(null); setDropTarget(null);
  };
  const move = (ids: string[], actId: string | null, placement?: StoryboardPlacement) => {
    moveScenesToAct(ids, actId || undefined, placement);
    setSelected([]); anchor.current = null;
    setCollapsed(prev => prev.filter(id => id !== (actId || '')));
    clearDrag();
  };
  const moveOptions = <><option value="">移至…</option><option value="__ungrouped__">未归幕（保留正文位置）</option>{project.acts.map(act => <option key={act.id} value={act.id}>{act.title}</option>)}</>;

  const jump = (elementId: string) => {
    requestFocus(elementId, 'start', 'start');
    setView('write');
  };

  const dropInSection = (actId: string | null, placement?: StoryboardPlacement) => {
    if (dragRef.current) move(dragRef.current.ids, actId, placement);
  };

  const renderSection = (actId: string | null, title: string, list: typeof scenes, color?: string) => (
    <section
      key={actId || '__ungrouped__'}
      data-act-id={actId || ''}
      style={{ '--act-color': color || 'var(--muted)' } as React.CSSProperties}
      className={`cards__act${actId ? '' : ' cards__act--ungrouped'}${dropTarget === (actId || '__ungrouped__') ? ' is-drop-target' : ''}`}
      onDragOver={(e) => {
        if (!dragRef.current) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropTarget(actId || '__ungrouped__');
        setOver(null);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setDropTarget(null); setOver(null); }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dropInSection(actId);
      }}
    >
      <header className="cards__act-head">
        <button className="cards__collapse" aria-label={`${collapsed.includes(actId || '') ? '展开' : '收起'}${title}`} aria-expanded={!collapsed.includes(actId || '')}
          onClick={() => setCollapsed(prev => prev.includes(actId || '') ? prev.filter(id => id !== (actId || '')) : [...prev, actId || ''])}>
          {collapsed.includes(actId || '') ? '▸' : '▾'}
        </button>
        {actId ? <input className="cards__act-title" aria-label="幕名称" value={title} onChange={e => updateAct(actId, { title: e.target.value })} />
          : <span className="cards__act-title">未归幕</span>}
        <span className="cards__act-count">{list.length} 场 · <span title="当前排版中含本组场景正文的页数；同页多场不重复，跨幕共页各自计入，不含标题页。">{pagesReady ? `${pageCounts.get(actId || '') || 0} 页` : '排版中…'}</span></span>
        <span className="cards__act-hint">{dropTarget === (actId || '__ungrouped__')
          ? (actId ? `松开移入${title}` : '松开解除归幕，正文位置不变')
          : (!actId ? '暂存场景 · 保留正文位置' : '')}</span>
        {actId && <button className="btn btn--ghost cards__remove-act" onClick={() => setDeleting(actId)}>删除幕</button>}
      </header>
      {deleting === actId && actId && <div className="cards__delete-confirm" role="alertdialog" aria-label={`删除${title}`}>
        <span>删除「{title}」？其中 {list.length} 场将移到未归幕，正文和素材保留原位。</span>
        <button className="btn btn--ghost" onClick={() => setDeleting(null)}>取消</button>
        <button className="btn" onClick={() => { removeAct(actId); setDeleting(null); }}>确认删除幕</button>
      </div>}
      <div
        hidden={collapsed.includes(actId || '')}
        className={`cards__grid${!list.length ? ' is-empty-drop' : ''}`}
        onDragOver={(e) => {
          if (!dragRef.current) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropTarget(actId || '__ungrouped__');
        }}
        onDrop={(e) => {
          e.preventDefault();
          // 关键：内层网格落点不能再冒泡给 section，否则会用已清空的 drag
          // 再执行一次归幕，造成场景卡看起来无法拖入目标幕。
          e.stopPropagation();
          dropInSection(actId);
        }}
      >
        {list.map((s) => (
          <Card
            key={s.elementId}
            scene={s}
            drag={drag}
            over={over}
            editing={editing === s.id}
            selected={selectedIds.includes(s.elementId)}
            onSelect={(range) => select(s.elementId, range)}
            moveOptions={moveOptions}
            onMove={(value) => move([s.elementId], value === '__ungrouped__' ? null : value)}
            onEdit={(v) => setEditing(v ? s.id : null)}
            onDragStart={() => {
              const next = { elementId: s.elementId, ids: selectedIds.includes(s.elementId) ? selectedIds : [s.elementId] };
              dragRef.current = next; setDrag(next);
            }}
            onDragEnd={clearDrag}
            onDragOver={(edge) => {
              if (!dragRef.current) return;
              setDropTarget(actId || '__ungrouped__');
              setOver(actId && !dragRef.current.ids.includes(s.elementId) ? { targetId: s.elementId, edge } : null);
            }}
            onDropAt={(edge) => dropInSection(actId, actId ? { targetId: s.elementId, edge } : undefined)}
            onJump={() => jump(s.elementId)}
            onColor={(c) => updateSceneMeta(s.elementId, { color: c })}
            onSynopsis={(v) => updateSceneMeta(s.elementId, { synopsis: v })}
            onTitle={(v) => updateSceneMeta(s.elementId, { title: v })}
          />
        ))}
        {!list.length ? <div className="cards__empty">{actId ? `拖动场景到这里，归入「${title}」` : '把场景暂放这里 · 拖回时保留正文位置'}</div> : null}
      </div>
    </section>
  );

  return (
    <div className="cards">
      <div className="cards__bar">
        <span className="cards__label">故事板 · {scenes.length} 场</span>
        <span className="hint">拖动场号归幕 · Shift 连选 · ⌘/Ctrl 多选</span>
        <label className="cards__bulk-move">已选 {selectedIds.length} 场
          <select aria-label="移动选中的场景" disabled={!selectedIds.length} value="" onChange={e => {
            if (e.target.value) move(selectedIds, e.target.value === '__ungrouped__' ? null : e.target.value);
          }}>{moveOptions}</select>
        </label>
        {!!selectedIds.length && <button className="btn btn--ghost" onClick={() => { setSelected([]); anchor.current = null; }}>取消选择</button>}
        <div className="spacer" />
        <button className="btn btn--ghost" onClick={addAct}>
          + 新增幕
        </button>
        <button
          className="btn btn--primary"
          onClick={() => {
            const last = scenes[scenes.length - 1];
            if (last) addSceneAfter(last.elementId);
            else useStore.getState().mutate(p => {
              // 无场景旧工程也可添加；复用既有元素工厂。
              p.elements.push(newElement('scene_heading', ''), newElement('action', ''));
            });
          }}
        >
          + 新增场景
        </button>
      </div>
      <div className="cards__scroll">
        {renderSection(null, '未归幕', grouped.other)}
        {[...grouped.map.entries()].map(([actId, list]) => {
          const act = project.acts.find((a) => a.id === actId);
          if (!act) return null;
          return renderSection(
            actId,
            act.title,
            list,
            act.color,
          );
        })}
      </div>
    </div>
  );
}

interface CardProps {
  scene: ReturnType<typeof deriveScenes>[number];
  drag: DragState;
  over: StoryboardPlacement | null;
  editing: boolean;
  selected: boolean;
  onSelect: (range: boolean) => void;
  moveOptions: React.ReactNode;
  onMove: (actId: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (edge: 'before' | 'after') => void;
  onDropAt: (edge: 'before' | 'after') => void;
  onJump: () => void;
  onColor: (c: string) => void;
  onSynopsis: (v: string) => void;
  onTitle: (v: string) => void;
  onEdit: (v: boolean) => void;
}

function Card(p: CardProps) {
  const { scene } = p;
  const dragging = useRef(false);
  const isDragging = p.drag?.elementId === scene.elementId;
  const edgeAt = (e: React.DragEvent<HTMLDivElement>) =>
    e.clientX < e.currentTarget.getBoundingClientRect().left + e.currentTarget.getBoundingClientRect().width / 2 ? 'before' : 'after';
  return (
    <div
      className={`card ${p.over?.targetId === scene.elementId && !isDragging ? `is-insert-${p.over.edge}` : ''} ${isDragging ? 'is-dragging' : ''} ${p.selected ? 'is-selected' : ''} ${
        scene.omit ? 'is-omit' : ''
      }`}
      data-scene-id={scene.elementId}
      style={{ background: scene.color }}
      draggable
      onDragStart={(e) => {
        if ((e.target as HTMLElement).closest('button, select')) { e.preventDefault(); return; }
        dragging.current = true;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', scene.elementId);
        p.onDragStart();
      }}
      onDragEnd={() => {
        dragging.current = false;
        p.onDragEnd();
      }}
      onDragOver={(e) => {
        if (!p.drag) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        p.onDragOver(edgeAt(e));
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        p.onDropAt(edgeAt(e));
      }}
      onDoubleClick={() => p.onEdit(true)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('textarea, input, button, select')) return;
        if (e.shiftKey || e.metaKey || e.ctrlKey) { p.onSelect(e.shiftKey); return; }
        p.onJump();
      }}
      // 核心拖放契约：原生拖动结束前保持源节点，尤其不能卸载空梗概输入框。
      // 用同步 ref 避免 dragstart 后 React 尚未重绘时 mouseleave 读取旧状态。
      onMouseLeave={() => { if (!dragging.current) p.onEdit(false); }}
    >
      <div className="card__head">
        <input type="checkbox" className="card__select" aria-label={`选择第 ${scene.number} 场`} checked={p.selected}
          onClick={e => { e.stopPropagation(); p.onSelect(e.shiftKey); }} onChange={() => {}} />
        <span className="card__no" draggable title="拖动整场：可移入任意幕或未归幕">{scene.number}</span>
        <div className="card__colors">
          {CARD_COLORS.map((c) => (
            <button
              key={c}
              className="card__dot"
              style={{ background: c }}
              onClick={(e) => {
                e.stopPropagation();
                p.onColor(c);
              }}
            />
          ))}
        </div>
      </div>
      <input
        className="card__title"
        value={scene.title}
        placeholder={scene.heading || '场景标题'}
        onChange={(e) => p.onTitle(e.target.value)}
      />
      {p.editing || scene.synopsis ? (
        <textarea
          className="card__synopsis"
          value={scene.synopsis}
          placeholder="这一场发生了什么？"
          onChange={(e) => p.onSynopsis(e.target.value)}
        />
      ) : (
        <div className="card__heading">{scene.heading}</div>
      )}
      <div className="card__footer" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
        <select aria-label={`移动第 ${scene.number} 场`} value="" onChange={e => { if (e.target.value) p.onMove(e.target.value); }}>{p.moveOptions}</select>
        <button className="btn btn--ghost" title="跳转到该场正文" onClick={p.onJump}>正文 ↗</button>
      </div>
    </div>
  );
}
