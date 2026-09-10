import React, { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { deriveScenes } from '../model/project';
import { CARD_COLORS } from '../model/elements';

type DragState = { elementId: string; index: number } | null;

export function CardsView() {
  const project = useStore((s) => s.project);
  const setView = useStore((s) => s.setView);
  const requestFocus = useStore((s) => s.requestFocus);
  const updateSceneMeta = useStore((s) => s.updateSceneMeta);
  const dropSceneInAct = useStore((s) => s.dropSceneInAct);
  const addSceneAfter = useStore((s) => s.addSceneAfter);
  const updateAct = useStore((s) => s.updateAct);
  const addAct = useStore((s) => s.addAct);
  const [drag, setDrag] = useState<DragState>(null);
  const [over, setOver] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

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

  const jump = (elementId: string) => {
    requestFocus(elementId, 'start', 'start');
    setView('write');
  };

  // 落在该幕末尾时应插入的全局场景序号
  const actInsertIndex = (actId: string | null): number => {
    const list = actId ? grouped.map.get(actId) : grouped.other;
    if (list && list.length) return list[list.length - 1].index + 1;
    if (actId) {
      const idx = project.acts.findIndex((a) => a.id === actId);
      for (let i = idx + 1; i < project.acts.length; i += 1) {
        const nxt = grouped.map.get(project.acts[i].id);
        if (nxt && nxt.length) return nxt[0].index;
      }
    }
    return scenes.length;
  };

  // 拖到某张卡片之前：重排 + 归入该幕（合并为一次操作，只产生一条撤销记录）
  const dropBefore = (actId: string | null, beforeIndex: number) => {
    if (!drag) return;
    dropSceneInAct(drag.index, beforeIndex, drag.elementId, actId ?? undefined);
    setDrag(null);
    setOver(null);
    setDropTarget(null);
  };

  // 拖到某幕空白区：放到该幕末尾 + 归入该幕
  const dropInSection = (actId: string | null) => {
    if (!drag) return;
    dropSceneInAct(drag.index, actInsertIndex(actId), drag.elementId, actId ?? undefined);
    setDrag(null);
    setOver(null);
    setDropTarget(null);
  };

  const renderSection = (actId: string | null, titleNode: React.ReactNode, list: typeof scenes) => (
    <section
      key={actId || '__ungrouped__'}
      className={`cards__act${actId ? '' : ' cards__act--ungrouped'}${dropTarget === (actId || '__ungrouped__') ? ' is-drop-target' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropTarget(actId || '__ungrouped__');
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropTarget(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dropInSection(actId);
      }}
    >
      <header className="cards__act-head">{titleNode}</header>
      <div
        className={`cards__grid${!list.length ? ' is-empty-drop' : ''}`}
        onDragOver={(e) => {
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
            key={s.id}
            scene={s}
            drag={drag}
            over={over}
            editing={editing === s.id}
            onEdit={(v) => setEditing(v ? s.id : null)}
            onDragStart={() => setDrag({ elementId: s.elementId, index: s.index })}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
              setDropTarget(null);
            }}
            onDragOver={() => setOver(s.index)}
            onDropBefore={() => dropBefore(actId, s.index)}
            onJump={() => jump(s.elementId)}
            onColor={(c) => updateSceneMeta(s.elementId, { color: c })}
            onSynopsis={(v) => updateSceneMeta(s.elementId, { synopsis: v })}
            onTitle={(v) => updateSceneMeta(s.elementId, { title: v })}
          />
        ))}
        {!list.length ? <div className="cards__empty">把卡片拖到此处即可归入「{actId ? '该幕' : '未归幕'}」</div> : null}
      </div>
    </section>
  );

  return (
    <div className="cards">
      <div className="cards__bar">
        <span className="cards__label">故事板 · {scenes.length} 场</span>
        <span className="hint">拖拽卡片可调整顺序；拖入某一幕即归入该幕</span>
        <div className="spacer" />
        <button className="btn btn--ghost" onClick={addAct}>
          + 新增幕
        </button>
        <button
          className="btn btn--primary"
          onClick={() => {
            const last = scenes[scenes.length - 1];
            if (last) addSceneAfter(last.elementId);
          }}
        >
          + 新增场景
        </button>
      </div>
      <div className="cards__scroll">
        {[...grouped.map.entries()].map(([actId, list]) => {
          const act = project.acts.find((a) => a.id === actId);
          if (!act) return null;
          return renderSection(
            actId,
            <>
              <input
                className="cards__act-title"
                value={act.title}
                onChange={(e) => updateAct(actId, { title: e.target.value })}
              />
              <span className="cards__act-count">{list.length} 场</span>
            </>,
            list,
          );
        })}
        {renderSection(
          null,
          <>
            <span className="cards__act-title">未归幕</span>
            <span className="cards__act-count">{grouped.other.length} 场</span>
          </>,
          grouped.other,
        )}
      </div>
    </div>
  );
}

interface CardProps {
  scene: ReturnType<typeof deriveScenes>[number];
  drag: DragState;
  over: number | null;
  editing: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDropBefore: () => void;
  onJump: () => void;
  onColor: (c: string) => void;
  onSynopsis: (v: string) => void;
  onTitle: (v: string) => void;
  onEdit: (v: boolean) => void;
}

function Card(p: CardProps) {
  const { scene } = p;
  const isDragging = p.drag?.elementId === scene.elementId;
  return (
    <div
      className={`card ${p.over === scene.index && !isDragging ? 'is-over' : ''} ${isDragging ? 'is-dragging' : ''} ${
        scene.omit ? 'is-omit' : ''
      }`}
      style={{ background: scene.color }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', scene.elementId);
        p.onDragStart();
      }}
      onDragEnd={p.onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        p.onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        p.onDropBefore();
      }}
      onDoubleClick={() => p.onEdit(true)}
      onClick={(e) => {
        if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT') return;
        p.onJump();
      }}
      onMouseLeave={() => p.onEdit(false)}
    >
      <div className="card__head">
        <span className="card__no">{scene.number}</span>
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
    </div>
  );
}
