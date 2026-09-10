import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { deriveScenes } from '../model/project';
import { CARD_COLORS } from '../model/elements';
import { clampSize, sizeLimitFor, sceneEndpoint, beatEndpoint, FALLBACK_CARD_W, FALLBACK_SCENE_H, FALLBACK_BEAT_H } from '../model/board';
import { cardCenters, marqueeSel } from '../model/selection';
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
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const notify = useStore((s) => s.notify);
  const requestFocus = useStore((s) => s.requestFocus);
  const setScenePos = useStore((s) => s.setScenePos);
  const addBeat = useStore((s) => s.addBeat);
  const moveBeat = useStore((s) => s.moveBeat);
  const updateBeat = useStore((s) => s.updateBeat);
  const updateSceneMeta = useStore((s) => s.updateSceneMeta);
  const resizeBeat = useStore((s) => s.resizeBeat);
  const deleteBeat = useStore((s) => s.deleteBeat);
  const linkBeat = useStore((s) => s.linkBeat);
  const addBoardLink = useStore((s) => s.addBoardLink);
  const updateBoardLink = useStore((s) => s.updateBoardLink);
  const deleteBoardLink = useStore((s) => s.deleteBoardLink);
  const resizeSceneMeta = useStore((s) => s.resizeSceneMeta);
  const addSceneAfter = useStore((s) => s.addSceneAfter);
  const selectedIds = useStore((s) => s.selectedIds);
  const setSelectedIds = useStore((s) => s.setSelectedIds);
  const toggleSelection = useStore((s) => s.toggleSelection);
  const selectRange = useStore((s) => s.selectRange);
  const clearSelection = useStore((s) => s.clearSelection);
  const deleteSelectedBoardCards = useStore((s) => s.deleteSelectedBoardCards);

  const scenes = useMemo(() => deriveScenes(project), [project]);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [filter, setFilter] = useState<Filter>('both');
  const [linkFrom, setLinkFrom] = useState<string | null>(null);

  // 提前声明 showScenes / showBeats：useEffect 内闭包依赖它们，避免 TDZ 错误
  const showScenes = filter !== 'beats';
  const showBeats = filter !== 'scenes';

  const canvasRef = useRef<HTMLDivElement>(null);
  // 拖拽状态：{ mode: 'card'|'beat'|'pan'|'resize'|'marquee', id, sx, sy, ox, oy, ow, oh, kind, moved, node?, marqueeRect?, marqueeAdditive? }
  // kind 仅 resize 用：'scene' 或 'image'/'beat'/'sound'。
  // marqueeRect 仅 marquee 模式用：相对 canvas 世界坐标（除 pan / zoom 后的）。
  // marqueeAdditive 仅 marquee 模式用：Shift 启动时为 true。
  const drag = useRef<{
    mode: 'card' | 'beat' | 'pan' | 'resize' | 'marquee';
    id?: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    ow: number;
    oh: number;
    kind?: 'scene' | 'image' | 'beat' | 'sound';
    moved: boolean;
    node?: HTMLElement | null;
    marqueeRect?: { rx: number; ry: number; rw: number; rh: number } | null;
    marqueeAdditive?: boolean;
  } | null>(null);

  // Marquee selection 状态（client 坐标，与 canvas 渲染坐标系解耦，CSS transform 不影响）
  const [marquee, setMarquee] = useState<{ sx: number; sy: number; sx2: number; sy2: number } | null>(null);
  // 记录 shift+click 的 anchor（按锚点在 selections 内的最后一个 id）
  const lastAnchorRef = useRef<string | null>(null);

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

  /* 按下背景 = 平移 / 框选；按下卡片 = 多选或拖动卡片 */
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const cardEl = target.closest('[data-card]') as HTMLElement | null;
    if (cardEl) {
      const mode = (cardEl.getAttribute('data-drag') as 'card' | 'beat') || 'card';
      const id = cardEl.getAttribute('data-id') || '';
      const selectionId = mode === 'card' ? `scene:${id}` : `beat:${id}`;
      const x = parseFloat(cardEl.style.left) || 0;
      const y = parseFloat(cardEl.style.top) || 0;

      // modifier：Cmd/Ctrl → 切换选中；Shift → 范围选择；普通 → 单选（后续 onUp 落位）
      if (e.metaKey || e.ctrlKey) {
        toggleSelection(selectionId);
        lastAnchorRef.current = selectionId;
        drag.current = null;
        return;
      }
      if (e.shiftKey) {
        // 范围选择：把 scenes / beats 拼成有顺序的列表，按锚点 + target 选连续区间
        const ordered = [
          ...scenes.map((s) => `scene:${s.elementId}`),
          ...project.beats.map((b) => `beat:${b.id}`),
        ];
        const anchor = lastAnchorRef.current;
        selectRange(ordered, anchor, selectionId);
        lastAnchorRef.current = selectionId;
        // Shift 范围选不启动 drag
        drag.current = null;
        return;
      }

      // 普通单击在 mouseup 时选中卡片；双击场景卡仍可跳回写作页。
      drag.current = { mode, id, sx: e.clientX, sy: e.clientY, ox: x, oy: y, ow: 0, oh: 0, moved: false };
    } else {
      // 空白：启动 marquee
      const additive = e.shiftKey;
      if (!additive) {
        // 普通启动先清选；frame 内部 resize / 拖动就不清
        clearSelection();
      }
      drag.current = {
        mode: 'marquee',
        sx: e.clientX,
        sy: e.clientY,
        ox: pan.x,
        oy: pan.y,
        ow: 0,
        oh: 0,
        marqueeRect: { rx: 0, ry: 0, rw: 0, rh: 0 },
        marqueeAdditive: additive,
        moved: false,
      };
      setMarquee({ sx: e.clientX, sy: e.clientY, sx2: e.clientX, sy2: e.clientY });
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
        // kind: 'scene' / 'image' / 'beat' / 'sound'
        const next = clampSize(d.kind, d.ow + dx / zoom, d.oh + dy / zoom);
        d.node.style.width = `${next.w}px`;
        d.node.style.height = `${next.h}px`;
        // 缓存最终值，等 onUp 一次性 commit
        (d as any).previewW = next.w;
        (d as any).previewH = next.h;
      } else if (d.mode === 'marquee') {
        // marquee：跟随鼠标移动，更新 client 坐标系预览
        d.marqueeRect = { rx: 0, ry: 0, rw: e.clientX - d.sx, rh: e.clientY - d.sy };
        setMarquee({ sx: d.sx, sy: d.sy, sx2: e.clientX, sy2: e.clientY });
      }
    };
    const onUp = (e: MouseEvent) => {
      const d = drag.current;
      if (d && (d.mode === 'card' || d.mode === 'beat') && d.id && !d.moved) {
        // 单击是最直观的选中方式：统一存 scene:/beat: 前缀，保证颜色栏、描边和批量操作读取同一状态。
        const selectionId = d.mode === 'card' ? `scene:${d.id}` : `beat:${d.id}`;
        setSelectedIds([selectionId]);
        lastAnchorRef.current = selectionId;
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
      } else if (d && d.mode === 'marquee') {
        // marquee 落位：用 marqueeSel 过滤矩形内卡片中心点
        // 把 client 坐标转成 canvas 内部世界坐标（已除 zoom，去 pan）
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) {
          setMarquee(null);
          drag.current = null;
          return;
        }
        const wx1 = (Math.min(d.sx, e.clientX) - rect.left - d.ox) / zoom;
        const wy1 = (Math.min(d.sy, e.clientY) - rect.top - d.oy) / zoom;
        const wx2 = (Math.max(d.sx, e.clientX) - rect.left - d.ox) / zoom;
        const wy2 = (Math.max(d.sy, e.clientY) - rect.top - d.oy) / zoom;
        if (Math.abs(e.clientX - d.sx) > 2 && Math.abs(e.clientY - d.sy) > 2) {
          // 收集所有可视卡片中心
          const visibleCards: { id: string; x: number; y: number; w?: number; h?: number }[] = [];
          if (showScenes) {
            scenes.forEach((sc, i) => {
              const fallback = autoPos(i);
              const x = sc.x ?? fallback.x;
              const y = sc.y ?? fallback.y;
              visibleCards.push({
                id: `scene:${sc.elementId}`,
                x,
                y,
                w: sc.w ?? FALLBACK_CARD_W,
                h: sc.h ?? FALLBACK_SCENE_H,
              });
            });
          }
          if (showBeats) {
            project.beats.forEach((b) => {
              visibleCards.push({
                id: `beat:${b.id}`,
                x: b.x,
                y: b.y,
                w: b.w ?? FALLBACK_CARD_W,
                h: b.h ?? FALLBACK_BEAT_H,
              });
            });
          }
          const additive = !!d.marqueeAdditive;
          setSelectedIds(marqueeSel([], cardCenters(visibleCards), wx1, wy1, wx2 - wx1, wy2 - wy1, additive, selectedIds));
        }
        setMarquee(null);
      }
      drag.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [zoom, scenes, requestFocus, setView, setScenePos, moveBeat, resizeBeat, resizeSceneMeta, project.beats, selectedIds, toggleSelection, setSelectedIds, showScenes, showBeats]);

  /* ⌫ / Delete → 批量删除选中的场景与卡片；正文场景删除可由撤销恢复。 */
  useEffect(() => {
    if (view !== 'board') return;
    const onKey = (e: KeyboardEvent) => {
      // 排除文本输入控件（contenteditable / input / textarea）
      const tgt = e.target as HTMLElement | null;
      if (tgt) {
        const tag = tgt.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tgt.isContentEditable) return;
      }
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const ids = useStore.getState().selectedIds;
      if (!ids || ids.length === 0) return;
      e.preventDefault();
      const removed = useStore.getState().deleteSelectedBoardCards();
      if (removed.scenes || removed.beats) {
        const parts = [removed.scenes ? `${removed.scenes} 场` : '', removed.beats ? `${removed.beats} 张卡片` : ''].filter(Boolean);
        notify(`已删除 ${parts.join('、')}`, 'ok');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [view, notify]);

  const deleteSelected = () => {
    const removed = deleteSelectedBoardCards();
    if (removed.scenes || removed.beats) {
      const parts = [removed.scenes ? `${removed.scenes} 场` : '', removed.beats ? `${removed.beats} 张卡片` : ''].filter(Boolean);
      notify(`已删除 ${parts.join('、')}`, 'ok');
    }
  };

  const deleteSceneCard = (elementId: string) => {
    setSelectedIds([`scene:${elementId}`]);
    const removed = useStore.getState().deleteSelectedBoardCards();
    if (removed.scenes) notify(`已删除 ${removed.scenes} 场`, 'ok');
  };

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

  // 新卡片从现有场景卡之后依次排入网格，避免首次创建就与场景或前一张卡重叠。
  const addBoardBeat = (kind: Beat['kind']) => {
    const position = autoPos(scenes.length + project.beats.length);
    return addBeat(position.x, position.y, '', kind);
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

  const endpoints = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    scenes.forEach((scene, index) => {
      // scene.x / scene.y 缺省时按 autoPos 兜底；w / h 缺省时按 FALLBACK_* 兜底
      // （详见 src/model/board.ts 的 sceneEndpoint 纯函数）。
      const fallback = autoPos(index);
      out.set(`scene:${scene.elementId}`, sceneEndpoint(scene, fallback));
    });
    project.beats.forEach((beat) => {
      out.set(`beat:${beat.id}`, beatEndpoint(beat));
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
  const applySelectedColor = (color: string) => {
    selectedIds.forEach((id) => {
      if (id.startsWith('scene:')) updateSceneMeta(id.slice(6), { color });
      if (id.startsWith('beat:')) updateBeat(id.slice(5), { color });
      // 兼容本轮修复前已存在于内存中的无前缀选中值；选中态本身不写入工程文件。
      if (!id.includes(':')) {
        if (scenes.some((scene) => scene.elementId === id)) updateSceneMeta(id, { color });
        if (project.beats.some((beat) => beat.id === id)) updateBeat(id, { color });
      }
    });
  };

  return (
    <div className="board">
      <div className="board__bar">
        <div className="segmented board__subtabs" role="tablist" aria-label="自由板子板块">
          <button role="tab" aria-selected={filter === 'both'} className={filter === 'both' ? 'is-active' : ''} onClick={() => setFilter('both')}>
            总览
          </button>
          <button role="tab" aria-selected={filter === 'scenes'} className={filter === 'scenes' ? 'is-active' : ''} onClick={() => setFilter('scenes')}>
            场景板
          </button>
          <button role="tab" aria-selected={filter === 'beats'} className={filter === 'beats' ? 'is-active' : ''} onClick={() => setFilter('beats')}>
            灵感板
          </button>
        </div>
        <div className="board__center-tools">
          <div className="board__color-bar" role="group" aria-label="所选卡片颜色">
              <span>颜色</span>
              {CARD_COLORS.map((color, index) => (
                <button
                  key={color}
                  type="button"
                  style={{ backgroundColor: color }}
                  disabled={!selectedIds.length}
                  title={selectedIds.length ? `设为颜色 ${index + 1}` : '先选中卡片'}
                  aria-label={`卡片颜色 ${index + 1}`}
                  onClick={() => applySelectedColor(color)}
                />
              ))}
          </div>
          {linkFrom ? <button className="btn btn--ghost board__link-state" onClick={() => setLinkFrom(null)}>选择另一张卡片连接 · 取消</button> : null}
          {selectedIds.length ? (
            <span className="board__selection-status" aria-live="polite">
              已选 {selectedIds.length}
            </span>
          ) : null}
        </div>
        <div className="board__actions">
          {selectedIds.length ? (
            <button className="btn btn--danger" onClick={deleteSelected} title="删除选中的场景或卡片（可用撤销恢复）">
              删除所选
            </button>
          ) : null}
          <button className="btn btn--ghost" onClick={addSceneCard}>
            ＋场景卡
          </button>
          <div className="board__add-beat">
            <button className="btn btn--primary" onClick={() => addBoardBeat('beat')}>
              ＋灵感卡
            </button>
            <button className="btn btn--ghost" onClick={() => addBoardBeat('sound')}>
              ＋声音
            </button>
            <button className="btn btn--ghost" onClick={() => {
              const id = addBoardBeat('image');
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
              return (
                <SceneCard
                  key={sc.id}
                  scene={sc}
                  index={i}
                  pos={pos}
                  linking={linkFrom === `scene:${sc.elementId}`}
                  onLink={() => onCardLink(`scene:${sc.elementId}`)}
                  onOpen={() => {
                    requestFocus(sc.elementId, 'start', 'start');
                    setView('write');
                  }}
                  onDelete={() => deleteSceneCard(sc.elementId)}
                  onChangeSynopsis={(synopsis) => updateSceneMeta(sc.elementId, { synopsis })}
                  onResizeStart={(e) => {
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
                  }}
                  selected={selectedIds.includes(`scene:${sc.elementId}`) || selectedIds.includes(sc.elementId)}
                />
              );
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
                selected={selectedIds.includes(`beat:${b.id}`) || selectedIds.includes(b.id)}
              />
            ))}
        </div>
        {marquee ? (
          <div
            className="board__marquee"
            style={{
              left: Math.min(marquee.sx, marquee.sx2),
              top: Math.min(marquee.sy, marquee.sy2),
              width: Math.abs(marquee.sx2 - marquee.sx),
              height: Math.abs(marquee.sy2 - marquee.sy),
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

interface SceneCardProps {
  scene: Scene;
  index: number;
  pos: { x: number; y: number };
}

function SceneCard({ scene, pos, linking, onLink, onOpen, onDelete, onChangeSynopsis, onResizeStart, selected }: SceneCardProps & { linking: boolean; onLink: () => void; onOpen: () => void; onDelete: () => void; onChangeSynopsis: (synopsis: string) => void; onResizeStart: (e: React.MouseEvent) => void; selected: boolean }) {
  const lim = sizeLimitFor('scene');
  return (
    <div
      data-card
      data-drag="card"
      data-id={scene.elementId}
      data-kind="scene"
      className={`bcard bcard--scene ${scene.omit ? 'is-omit' : ''} ${selected ? 'is-selected' : ''}`}
      style={{ left: pos.x, top: pos.y, '--scene-color': scene.color, width: scene.w, height: scene.h } as React.CSSProperties}
      onDoubleClick={(e) => { e.stopPropagation(); onOpen(); }}
    >
      <div className="bcard__head">
        <span className="bcard__no">{scene.number}</span>
        <span className="bcard__actions"><span className="bcard__tag">场</span><button className={`bcard__connect ${linking ? 'is-active' : ''}`} onMouseDown={(e) => e.stopPropagation()} onClick={onLink} title="连接到另一张卡片">↗</button><button className="bcard__del" onMouseDown={(e) => e.stopPropagation()} onClick={onDelete} title="删除整场（可撤销）" aria-label="删除整场">×</button></span>
      </div>
      <div className="bcard__title">{scene.title || scene.heading || '（未命名场景）'}</div>
      {/* 与大纲/故事板共用 synopsis；空白不能拿标题填充，也不能把编辑手势当卡片拖动。 */}
      <textarea
        className="bcard__scene-notes"
        aria-label={`第 ${scene.number} 场故事信息`}
        placeholder="这一场发生了什么？"
        value={scene.synopsis}
        rows={1}
        onChange={(e) => onChangeSynopsis(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      />
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
  /** 所有自由板卡片的右下角 resize handle。 */
  onResizeStart: (e: React.MouseEvent) => void;
  /** 多选视觉高亮（items 6b） */
  selected: boolean;
}

function BeatCard({ beat, scenes, onChange, onDelete, onLink, linking, onBoardLink, onResizeStart, selected }: BeatCardProps) {
  const kind = beat.kind || 'beat';
  const isMedia = kind === 'image';
  const isSound = kind === 'sound';
  const hasMedia = isMedia && !!beat.img;
  const lim = sizeLimitFor(kind);
  return (
    <div
      data-card
      data-drag="beat"
      data-id={beat.id}
      data-kind={kind}
      className={`bcard bcard--beat bcard--${kind} ${selected ? 'is-selected' : ''}`}
      style={{ left: beat.x, top: beat.y, background: beat.color, width: beat.w, height: beat.h }}
    >
      <div className="bcard__head">
        {(isSound || isMedia) ? <span className={`bcard__tag bcard__tag--${kind}`}>{isSound ? '声音' : '图片'}</span> : null}
        <span className="bcard__actions"><button className={`bcard__connect ${linking ? 'is-active' : ''}`} onMouseDown={(e) => e.stopPropagation()} onClick={onBoardLink} title="连接到另一张卡片">↗</button><button className="bcard__del" onMouseDown={(e) => e.stopPropagation()} onClick={onDelete} title="删除">×</button></span>
      </div>
      <div className="bcard__body">
        {hasMedia ? (
          <div className="bcard__media" onMouseDown={(e) => e.stopPropagation()}>
            <img className="bcard__media-img" src={beat.img} alt={beat.title || '图片'} />
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
    return <g key={link.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /><foreignObject x={x - 105} y={y - 12} width="210" height="26"><div className="board-link-note"><input value={link.note || ''} placeholder="关系备注" onMouseDown={(e) => e.stopPropagation()} onChange={(e) => onChange(link.id, { note: e.target.value })} /><button type="button" title="删除连线" onMouseDown={(e) => e.stopPropagation()} onClick={() => onDelete(link.id)}>×</button></div></foreignObject></g>;
  })}</svg>;
}
