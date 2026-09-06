import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { deriveScenes } from '../model/project';
import { CARD_COLORS } from '../model/elements';
import { clampSize, sizeLimitFor, FALLBACK_CARD_W, FALLBACK_SCENE_H, FALLBACK_BEAT_H } from '../model/board';
import type { Beat, BoardLink, Scene } from '../model/types';

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
  const resizeBeat = useStore((s) => s.resizeBeat);
  const deleteBeat = useStore((s) => s.deleteBeat);
  const linkBeat = useStore((s) => s.linkBeat);
  const addBoardLink = useStore((s) => s.addBoardLink);
  const updateBoardLink = useStore((s) => s.updateBoardLink);
  const deleteBoardLink = useStore((s) => s.deleteBoardLink);
  const resizeSceneMeta = useStore((s) => s.resizeSceneMeta);
  const addSceneAfter = useStore((s) => s.addSceneAfter);

  const scenes = useMemo(() => deriveScenes(project), [project]);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [filter, setFilter] = useState<Filter>('both');
  const [linkFrom, setLinkFrom] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  // 拖拽状态：{ mode: 'card'|'beat'|'pan'|'resize', id, sx, sy, ox, oy, ow, oh, kind, moved }
  // kind 仅 resize 用：'scene' 或 'image'/'wimg'/'beat'/'sound'。
  const drag = useRef<{
    mode: 'card' | 'beat' | 'pan' | 'resize';
    id?: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    ow: number;
    oh: number;
    kind?: 'scene' | 'image' | 'wimg' | 'beat' | 'sound';
    moved: boolean;
    node?: HTMLElement | null;
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
      drag.current = { mode, id, sx: e.clientX, sy: e.clientY, ox: x, oy: y, ow: 0, oh: 0, moved: false };
    } else {
      drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y, ow: 0, oh: 0, moved: false };
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
      } else if (d.mode === 'resize' && d.id && d.node && d.kind) {
        // resize 节拍卡 / 场景卡：实时更新 DOM，松手时落位到 store。
        // kind: 'scene' / 'image' / 'wimg' / 'beat' / 'sound'
        const next = clampSize(d.kind, d.ow + dx / zoom, d.oh + dy / zoom);
        d.node.style.width = `${next.w}px`;
        d.node.style.height = `${next.h}px`;
        // 缓存最终值，等 onUp 一次性 commit
        (d as any).previewW = next.w;
        (d as any).previewH = next.h;
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
      } else if (d && d.mode === 'resize' && d.id && d.kind) {
        // resize 落位：按 kind 分别用 resizeSceneMeta / resizeBeat
        const w = (d as any).previewW ?? d.ow;
        const h = (d as any).previewH ?? d.oh;
        if (w !== d.ow || h !== d.oh) {
          if (d.kind === 'scene') {
            useStore.getState().resizeSceneMeta(d.id, w, h);
          } else {
            useStore.getState().resizeBeat(d.id, w, h);
          }
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
  }, [zoom, scenes, requestFocus, setView, setScenePos, moveBeat, resizeBeat, resizeSceneMeta, project.beats]);

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

  const endpoints = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    scenes.forEach((scene, index) => {
      const pos = scene.x != null && scene.y != null ? { x: scene.x, y: scene.y } : autoPos(index);
      // 关系线连接点 = 卡片中心。旧工程（无 w/h）按 FALLBACK_CARD_W / FALLBACK_SCENE_H
      // 兜底，与 alpha.6 之前的"y+68 / y+78"位置差异很小，但 resize 后会跟随卡片中心走。
      const w = scene.w ?? FALLBACK_CARD_W;
      const h = scene.h ?? FALLBACK_SCENE_H;
      out.set(`scene:${scene.elementId}`, { x: pos.x + w / 2, y: pos.y + h / 2 });
    });
    project.beats.forEach((beat) => {
      const w = beat.w ?? FALLBACK_CARD_W;
      const h = beat.h ?? FALLBACK_BEAT_H;
      out.set(`beat:${beat.id}`, { x: beat.x + w / 2, y: beat.y + h / 2 });
    });
    return out;
  }, [scenes, project.beats]);
  const boardLinks = (project.boardLinks || []).filter((link) => endpoints.has(link.from) && endpoints.has(link.to));
  const onCardLink = (endpoint: string) => {
    if (!linkFrom) {
      setLinkFrom(endpoint);
      return;
    }
    if (linkFrom !== endpoint) addBoardLink(linkFrom, endpoint);
    setLinkFrom(null);
  };

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
        {linkFrom ? <button className="btn btn--ghost board__link-state" onClick={() => setLinkFrom(null)}>选择另一张卡片连接 · 取消</button> : null}
        <div className="spacer" />
        <button className="btn btn--ghost" onClick={addSceneCard}>
          ＋场景卡
        </button>
        <div className="board__add-beat">
          <button className="btn btn--primary" onClick={() => addBeat(pan.x > 0 ? 60 : 60, 60, '', 'beat')}>
            ＋灵感卡
          </button>
          <button className="btn btn--ghost" onClick={() => addBeat(pan.x > 0 ? 60 : 60, 60, '', 'sound')}>
            ＋声音
          </button>
          <button className="btn btn--ghost" onClick={() => {
            const id = addBeat(pan.x > 0 ? 60 : 60, 60, '', 'image');
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = () => {
              const f = input.files && input.files[0];
              if (!f) return;
              const rd = new FileReader();
              rd.onload = () => { useStore.getState().updateBeat(id, { img: String(rd.result || '') }); };
              rd.readAsDataURL(f);
            };
            input.click();
          }}>
            ＋图片
          </button>
          <button className="btn btn--ghost" onClick={() => {
            const id = addBeat(pan.x > 0 ? 60 : 60, 60, '', 'wimg');
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = () => {
              const f = input.files && input.files[0];
              if (!f) return;
              const rd = new FileReader();
              rd.onload = () => { useStore.getState().updateBeat(id, { img: String(rd.result || '') }); };
              rd.readAsDataURL(f);
            };
            input.click();
          }}>
            ＋写作图
          </button>
        </div>
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
          <BoardLinks links={boardLinks} endpoints={endpoints} onChange={updateBoardLink} onDelete={deleteBoardLink} />
          {showScenes &&
            scenes.map((sc, i) => {
              const pos = sc.x != null && sc.y != null ? { x: sc.x, y: sc.y } : autoPos(i);
              return <SceneCard key={sc.id} scene={sc} index={i} pos={pos} linking={linkFrom === `scene:${sc.elementId}`} onLink={() => onCardLink(`scene:${sc.elementId}`)} onResizeStart={(e) => {
                // 场景卡 resize：与节拍卡共用 drag.current 'resize' 模式
                const node = e.currentTarget.closest('[data-card]') as HTMLElement | null;
                if (!node) return;
                drag.current = {
                  mode: 'resize',
                  id: sc.elementId,
                  sx: e.clientX,
                  sy: e.clientY,
                  ox: 0,
                  oy: 0,
                  ow: node.offsetWidth,
                  oh: node.offsetHeight,
                  kind: 'scene',
                  moved: true,
                  node,
                };
              }} />;
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
                linking={linkFrom === `beat:${b.id}`}
                onBoardLink={() => onCardLink(`beat:${b.id}`)}
                onResizeStart={(e) => {
                  // 自由板所有节拍卡都可缩放：把 beat.kind 透传到 drag.current，
                  // 让 mousemove / mouseup 按 kind 选 clamp 区间与落位 action。
                  const node = e.currentTarget.closest('[data-card]') as HTMLElement | null;
                  if (!node) return;
                  drag.current = {
                    mode: 'resize',
                    id: b.id,
                    sx: e.clientX,
                    sy: e.clientY,
                    ox: 0,
                    oy: 0,
                    ow: node.offsetWidth,
                    oh: node.offsetHeight,
                    kind: b.kind || 'beat',
                    moved: true, // resize 不走点击分支
                    node,
                  };
                }}
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

function SceneCard({ scene, pos, linking, onLink, onResizeStart }: SceneCardProps & { linking: boolean; onLink: () => void; onResizeStart: (e: React.MouseEvent) => void }) {
  const lim = sizeLimitFor('scene');
  return (
    <div
      data-card
      data-drag="card"
      data-id={scene.elementId}
      data-kind="scene"
      className={`bcard bcard--scene ${scene.omit ? 'is-omit' : ''}`}
      style={{ left: pos.x, top: pos.y, borderTopColor: scene.color, width: scene.w, height: scene.h }}
    >
      <div className="bcard__head">
        <span className="bcard__no">{scene.number}</span>
        <span className="bcard__actions"><span className="bcard__tag">场</span><button className={`bcard__connect ${linking ? 'is-active' : ''}`} onMouseDown={(e) => e.stopPropagation()} onClick={onLink} title="连接到另一张卡片">↗</button></span>
      </div>
      <div className="bcard__title">{scene.title || scene.heading || '（未命名场景）'}</div>
      <div className="bcard__synopsis">{scene.synopsis || scene.heading}</div>
      <button
        type="button"
        className="bcard__resize"
        title={`拖动调整场景卡大小（${lim.minW}×${lim.minH} ～ ${lim.maxW}×${lim.maxH}）`}
        aria-label="调整场景卡大小"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(e);
        }}
      >
        缩放
      </button>
    </div>
  );
}

interface BeatCardProps {
  beat: Beat;
  scenes: Scene[];
  onChange: (patch: Partial<Pick<Beat, 'text' | 'color' | 'title' | 'img' | 'w' | 'h'>>) => void;
  onDelete: () => void;
  onLink: (sceneId?: string) => void;
  linking: boolean;
  onBoardLink: () => void;
  /** v1.2.9 同款：右下角 resize handle 接管 mousedown。仅 image / wimg 显示 */
  onResizeStart: (e: React.MouseEvent) => void;
}

function BeatCard({ beat, scenes, onChange, onDelete, onLink, linking, onBoardLink, onResizeStart }: BeatCardProps) {
  const kind = beat.kind || 'beat';
  const isMedia = kind === 'image' || kind === 'wimg';
  const isSound = kind === 'sound';
  const hasMedia = isMedia && !!beat.img;
  const lim = sizeLimitFor(kind);
  return (
    <div
      data-card
      data-drag="beat"
      data-id={beat.id}
      data-kind={kind}
      className={`bcard bcard--beat bcard--${kind}`}
      style={{ left: beat.x, top: beat.y, background: beat.color, width: beat.w, height: beat.h }}
    >
      <div className="bcard__head">
        <span className={`bcard__tag bcard__tag--${kind}`}>{isSound ? '声音' : isMedia ? (kind === 'wimg' ? '写作图' : '图片') : '灵感'}</span>
        <span className="bcard__actions"><button className={`bcard__connect ${linking ? 'is-active' : ''}`} onMouseDown={(e) => e.stopPropagation()} onClick={onBoardLink} title="连接到另一张卡片">↗</button><button className="bcard__del" onMouseDown={(e) => e.stopPropagation()} onClick={onDelete} title="删除">×</button></span>
      </div>
      <div className="bcard__body">
        {hasMedia ? (
          <div className="bcard__media" onMouseDown={(e) => e.stopPropagation()}>
            <img className="bcard__media-img" src={beat.img} alt={beat.title || (kind === 'wimg' ? '写作图' : '图片')} />
            {beat.title ? <input className="bcard__media-title" value={beat.title} placeholder="名称" onMouseDown={(e) => e.stopPropagation()} onChange={(e) => onChange({ title: e.target.value })} /> : null}
          </div>
        ) : isSound ? (
          <div className="bcard__media bcard__media--sound" onMouseDown={(e) => e.stopPropagation()}>
            <span className="bcard__sound-icon" aria-hidden>♪</span>
            <input className="bcard__media-title" value={beat.title || beat.text} placeholder="声音标题" onMouseDown={(e) => e.stopPropagation()} onChange={(e) => onChange({ title: e.target.value, text: e.target.value })} />
          </div>
        ) : (
          <textarea
            className="bcard__edit"
            value={beat.text}
            placeholder="写点灵感、悬念或主题…"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => onChange({ text: e.target.value })}
          />
        )}
      </div>
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
      {/*
       * 自由板所有节拍卡都可缩放（与 v1.2.9 不同，本版本补全 beat / sound 类型）。
       * 未来新增 kind 时无需改 BoardView，只要在 RESIZE_LIMITS 里加项即可复用同一套缩放。
       */}
      <button
        type="button"
        className="bcard__resize"
        title={`拖动调整卡片大小（${lim.minW}×${lim.minH} ～ ${lim.maxW}×${lim.maxH}）`}
        aria-label="调整卡片大小"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(e);
        }}
      >
        缩放
      </button>
    </div>
  );
}

function BoardLinks({ links, endpoints, onChange, onDelete }: { links: BoardLink[]; endpoints: Map<string, { x: number; y: number }>; onChange: (id: string, patch: Partial<BoardLink>) => void; onDelete: (id: string) => void }) {
  return <svg className="board-links" aria-label="卡片关系线">{links.map((link) => {
    const a = endpoints.get(link.from)!; const b = endpoints.get(link.to)!;
    const x = (a.x + b.x) / 2; const y = (a.y + b.y) / 2;
    return <g key={link.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /><foreignObject x={x - 78} y={y - 13} width="176" height="28"><div className="board-link-note"><input value={link.note || ''} placeholder="关系备注" onMouseDown={(e) => e.stopPropagation()} onChange={(e) => onChange(link.id, { note: e.target.value })} /><button type="button" title="删除连线" onMouseDown={(e) => e.stopPropagation()} onClick={() => onDelete(link.id)}>×</button></div></foreignObject></g>;
  })}</svg>;
}
