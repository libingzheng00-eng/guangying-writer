import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { deriveScenes } from '../model/project';
import { CARD_COLORS } from '../model/elements';
import type { Scene } from '../model/types';

type Filter = 'both' | 'scenes' | 'beats';

const CARD_W = 220;
const CARD_GAP_X = 260;
const CARD_GAP_Y = 224;

function autoPos(index: number): { x: number; y: number } {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 40 + col * CARD_GAP_X, y: 40 + row * CARD_GAP_Y };
}

export function BoardView() {
  const project = useStore((s) => s.project);
  const setView = useStore((s) => s.setView);
  const requestFocus = useStore((s) => s.requestFocus);
  const setScenePos = useStore((s) => s.setScenePos);
  const addBeat = useStore((s) => s.addBeat);
  const moveBeat = useStore((s) => s.moveBeat);
  const updateBeat = useStore((s) => s.updateBeat);
  const deleteBeat = useStore((s) => s.deleteBeat);
  const linkBeat = useStore((s) => s.linkBeat);
  const addSceneAfter = useStore((s) => s.addSceneAfter);

  const scenes = useMemo(() => deriveScenes(project), [project]);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [filter, setFilter] = useState<Filter>('both');

  const canvasRef = useRef<HTMLDivElement>(null);
  // 拖拽状态：{ mode: 'card'|'beat'|'pan', id, sx, sy, ox, oy, moved }
  const drag = useRef<{
    mode: 'card' | 'beat' | 'pan';
    id?: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);

  /* 缩放：以光标为中心 */
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const next = Math.max(0.4, Math.min(2, zoom * (1 - e.deltaY * 0.0015)));
      const wx = (mx - pan.x) / zoom;
      const wy = (my - pan.y) / zoom;
      setZoom(next);
      setPan({ x: mx - wx * next, y: my - wy * next });
    },
    [zoom, pan],
  );

  /* 按下背景 = 平移；按下卡片 = 移动卡片（卡片通过 data-drag/data-id 识别） */
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const cardEl = target.closest('[data-card]') as HTMLElement | null;
    if (cardEl) {
      const mode = (cardEl.getAttribute('data-drag') as 'card' | 'beat') || 'card';
      const id = cardEl.getAttribute('data-id') || '';
      const x = parseFloat(cardEl.style.left) || 0;
      const y = parseFloat(cardEl.style.top) || 0;
      drag.current = { mode, id, sx: e.clientX, sy: e.clientY, ox: x, oy: y, moved: false };
    } else {
      drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y, moved: false };
    }
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
      if (d.mode === 'pan') {
        setPan({ x: d.ox + dx, y: d.oy + dy });
      } else if (d.mode === 'card' && d.id) {
        const nx = d.ox + dx / zoom;
        const ny = d.oy + dy / zoom;
        setScenePos(d.id, Math.round(nx), Math.round(ny));
      } else if (d.mode === 'beat' && d.id) {
        const nx = d.ox + dx / zoom;
        const ny = d.oy + dy / zoom;
        moveBeat(d.id, Math.round(nx), Math.round(ny));
      }
    };
    const onUp = () => {
      const d = drag.current;
      if (d && d.mode === 'card' && d.id && !d.moved) {
        // 视为点击：跳转到对应场次
        const sc = scenes.find((s) => s.elementId === d.id || s.id === d.id);
        if (sc) {
          requestFocus(sc.elementId, 'start');
          setView('write');
        }
      }
      drag.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [zoom, scenes, requestFocus, setView, setScenePos, moveBeat]);

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-card]')) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const wx = (e.clientX - rect.left - pan.x) / zoom;
    const wy = (e.clientY - rect.top - pan.y) / zoom;
    addBeat(Math.round(wx - CARD_W / 2), Math.round(wy - 20));
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const addSceneCard = () => {
    // 在画布中心新增一场，并给卡片一个位置
    const last = scenes[scenes.length - 1];
    if (last) {
      addSceneAfter(last.elementId);
      const idx = scenes.length;
      const p = autoPos(idx);
      // 延迟一拍让元素入列
      setTimeout(() => {
        const cur = useStore.getState().project;
        const heads = cur.elements.filter((el) => el.type === 'scene_heading');
        const el = heads[heads.length - 1];
        if (el) setScenePos(el.id, p.x, p.y);
      }, 60);
    }
  };

  const showScenes = filter !== 'beats';
  const showBeats = filter !== 'scenes';

  return (
    <div className="board">
      <div className="board__bar">
        <div className="segmented">
          <button className={filter === 'both' ? 'is-active' : ''} onClick={() => setFilter('both')}>
            全部
          </button>
          <button className={filter === 'scenes' ? 'is-active' : ''} onClick={() => setFilter('scenes')}>
            场景卡
          </button>
          <button className={filter === 'beats' ? 'is-active' : ''} onClick={() => setFilter('beats')}>
            灵感卡
          </button>
        </div>
        <span className="hint">拖拽卡片摆放 · 拖空白平移 · 滚轮缩放 · 双击空白加灵感卡</span>
        <div className="spacer" />
        <button className="btn btn--ghost" onClick={addSceneCard}>
          ＋场景卡
        </button>
        <button className="btn btn--primary" onClick={() => addBeat(pan.x > 0 ? 60 : 60, 60)}>
          ＋灵感卡
        </button>
        <div className="zoom-ctl">
          <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}>
            －
          </button>
          <span className="zoom-val">{Math.round(zoom * 100)}%</span>
          <button className="icon-btn" onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>
            ＋
          </button>
          <button className="icon-btn" title="重置视图" onClick={resetView}>
            ⤢
          </button>
        </div>
      </div>

      <div
        className="board__canvas"
        ref={canvasRef}
        onWheel={onWheel}
        onMouseDown={onCanvasMouseDown}
        onDoubleClick={onDoubleClick}
      >
        <div
          className="board__world"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          {showScenes &&
            scenes.map((sc, i) => {
              const pos = sc.x != null && sc.y != null ? { x: sc.x, y: sc.y } : autoPos(i);
              return <SceneCard key={sc.id} scene={sc} index={i} pos={pos} />;
            })}
          {showBeats &&
            project.beats.map((b) => (
              <BeatCard
                key={b.id}
                beat={b}
                scenes={scenes}
                onChange={(patch) => updateBeat(b.id, patch)}
                onDelete={() => deleteBeat(b.id)}
                onLink={(sid) => linkBeat(b.id, sid)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

interface SceneCardProps {
  scene: Scene;
  index: number;
  pos: { x: number; y: number };
}

function SceneCard({ scene, pos }: SceneCardProps) {
  return (
    <div
      data-card
      data-drag="card"
      data-id={scene.elementId}
      className={`bcard bcard--scene ${scene.omit ? 'is-omit' : ''}`}
      style={{ left: pos.x, top: pos.y, borderTopColor: scene.color }}
    >
      <div className="bcard__head">
        <span className="bcard__no">{scene.number}</span>
        <span className="bcard__tag">场</span>
      </div>
      <div className="bcard__title">{scene.title || scene.heading || '（未命名场景）'}</div>
      <div className="bcard__synopsis">{scene.synopsis || scene.heading}</div>
    </div>
  );
}

interface BeatCardProps {
  beat: { id: string; text: string; color: string; x: number; y: number; sceneId?: string };
  scenes: Scene[];
  onChange: (patch: { text?: string; color?: string }) => void;
  onDelete: () => void;
  onLink: (sceneId?: string) => void;
}

function BeatCard({ beat, scenes, onChange, onDelete, onLink }: BeatCardProps) {
  return (
    <div
      data-card
      data-drag="beat"
      data-id={beat.id}
      className="bcard bcard--beat"
      style={{ left: beat.x, top: beat.y, background: beat.color }}
    >
      <div className="bcard__head">
        <span className="bcard__tag bcard__tag--beat">灵感</span>
        <button className="bcard__del" onMouseDown={(e) => e.stopPropagation()} onClick={onDelete} title="删除">
          ×
        </button>
      </div>
      <textarea
        className="bcard__edit"
        value={beat.text}
        placeholder="写点灵感、悬念或主题…"
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange({ text: e.target.value })}
      />
      <div className="bcard__foot" onMouseDown={(e) => e.stopPropagation()}>
        <div className="bcard__dots">
          {CARD_COLORS.map((c) => (
            <button
              key={c}
              className="bcard__dot"
              style={{ background: c }}
              onClick={() => onChange({ color: c })}
            />
          ))}
        </div>
        <select
          className="bcard__link"
          value={beat.sceneId || ''}
          onChange={(e) => onLink(e.target.value || undefined)}
          title="关联到场景"
        >
          <option value="">未关联</option>
          {scenes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.number} {s.heading.slice(0, 10)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
