import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { deriveScenes } from '../model/project';
import { CARD_COLORS } from '../model/elements';
import { clampSize, sizeLimitFor, type ResizableKind } from '../model/board';
import { BOARD_GRID_SIZE, boardBeatPosition, snapBoardPosition, type BoardCardPosition } from '../model/boardWorkspace';
import { cardCenters, marqueeSel } from '../model/selection';
import type { Beat, BoardLink, Scene } from '../model/types';
import { safeDisplayColor, safeEmbeddedImageSource } from '../utils/displayValues';

type Filter = 'both' | 'scenes' | 'beats';
type Mode = 'select' | 'link';
interface Layout extends BoardCardPosition { w: number; h: number; kind: ResizableKind }
type Preview = Record<string, { x?: number; y?: number; w?: number; h?: number }>;
interface ContextMenu { x: number; y: number; ids: string[]; linkId?: string }
interface Gesture {
  mode: 'move' | 'resize' | 'pan' | 'marquee';
  sx: number; sy: number; zoom: number; pan: { x: number; y: number }; moved: boolean;
  members: Layout[]; anchor?: Layout; additive?: boolean; previous?: string[];
  final?: BoardCardPosition[]; size?: { w: number; h: number };
}

// 显示默认值不写回工程；已经保存的尺寸和坐标保持原样。
const DISPLAY = { scene: { w: 280, h: 200 }, beat: { w: 280, h: 220 }, image: { w: 280, h: 248 }, sound: { w: 260, h: 180 } };
const autoPos = (index: number) => ({ x: 48 + (index % 3) * 364, y: 48 + Math.floor(index / 3) * 300 });
const dimension = (value: number | undefined, fallback: number) => Number.isFinite(value) && value! > 0 ? value! : fallback;
const isTextTarget = (target: EventTarget | null) => target instanceof Element &&
  (!!target.closest('input,textarea,select') || (target instanceof HTMLElement && target.isContentEditable));
const stopMouse = (event: React.MouseEvent) => event.stopPropagation();
const stopWheel = (event: React.WheelEvent) => event.stopPropagation();

export function BoardView() {
  const project = useStore((s) => s.project);
  const view = useStore((s) => s.view);
  const selectedIds = useStore((s) => s.selectedIds);
  const scenes = useMemo(() => deriveScenes(project), [project]);
  const documentEpoch = useStore((s) => s.documentEpoch);
  const board = useStore((s) => s.writingContext?.board);
  const zoom = board?.zoom ?? 1;
  const pan = { x: board?.panX ?? 0, y: board?.panY ?? 0 };
  const setZoom = (value: number | ((current: number) => number)) => {
    const state = useStore.getState();
    if (state.view !== 'board') return;
    const current = state.writingContext?.board || { panX: 0, panY: 0, zoom: 1 };
    state.updateWritingContext({ board: { ...current, zoom: typeof value === 'function' ? value(current.zoom) : value } }, documentEpoch);
  };
  const setPan = (value: { x: number; y: number }) => {
    const state = useStore.getState();
    if (state.view !== 'board') return;
    state.updateWritingContext({ board: { zoom: state.writingContext?.board?.zoom ?? 1, panX: value.x, panY: value.y } }, documentEpoch);
  };
  const [filter, setFilter] = useState<Filter>('both');
  const [mode, setMode] = useState<Mode>('select');
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [snap, setSnap] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [preview, setPreview] = useState<Preview>({});
  const [snapping, setSnapping] = useState(false);
  const [marquee, setMarquee] = useState<{ sx: number; sy: number; ex: number; ey: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1100, height: 700 });
  const addMenuRef = useRef<HTMLDetailsElement>(null);
  const viewMenuRef = useRef<HTMLDetailsElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const spaceRef = useRef(false);
  const lastAnchor = useRef<string | null>(null);
  useEffect(() => {
    gesture.current = null; lastAnchor.current = null; spaceRef.current = false;
    setPreview({}); setMarquee(null); setSnapping(false); setSpaceHeld(false);
    setMode('select'); setLinkFrom(null); setSelectedLink(null); setContextMenu(null);
  }, [documentEpoch]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => setCanvasSize((previous) => {
      const width = canvas.clientWidth, height = canvas.clientHeight;
      return width > 0 && height > 0 && (width !== previous.width || height !== previous.height) ? { width, height } : previous;
    });
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(canvas);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  const layouts = useMemo<Layout[]>(() => [
    ...(filter !== 'beats' ? scenes.map((scene, index) => {
      const meta = project.sceneMeta.find((item) => item.elementId === scene.elementId);
      const id = `scene:${scene.elementId}`;
      return { id, kind: 'scene' as const, ...autoPos(index),
        ...(Number.isFinite(meta?.x) ? { x: meta!.x! } : {}), ...(Number.isFinite(meta?.y) ? { y: meta!.y! } : {}),
        w: dimension(meta?.w, DISPLAY.scene.w), h: dimension(meta?.h, DISPLAY.scene.h), ...preview[id] };
    }) : []),
    ...(filter !== 'scenes' ? project.beats.map((beat) => {
      const kind = beat.kind === 'sound' ? 'sound' : beat.kind === 'image' ? 'image' : 'beat';
      const id = `beat:${beat.id}`;
      return { id, kind, ...boardBeatPosition(beat), w: dimension(beat.w, DISPLAY[kind].w), h: dimension(beat.h, DISPLAY[kind].h), ...preview[id] } as Layout;
    }) : []),
  ], [filter, scenes, project.sceneMeta, project.beats, preview]);
  const layoutMap = useMemo(() => new Map(layouts.map((card) => [card.id, card])), [layouts]);
  const layoutRef = useRef(layouts);
  layoutRef.current = layouts;
  const visibleIds = useMemo(() => layouts.map((card) => card.id), [layouts]);
  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const visibleSelected = visibleIds.filter((id) => selectedIds.includes(id) || selectedIds.includes(id.slice(id.indexOf(':') + 1)));
  const links = (project.boardLinks || []).filter((link) => visibleSet.has(link.from) && visibleSet.has(link.to));

  const focusCanvas = useCallback(() => canvasRef.current?.focus({ preventScroll: true }), []);
  const cancelGesture = useCallback(() => {
    gesture.current = null;
    setPreview({}); setMarquee(null); setSnapping(false);
  }, []);
  const switchMode = useCallback((next: Mode) => {
    cancelGesture(); setMode(next); setLinkFrom(null); setSelectedLink(null); setContextMenu(null);
    if (next === 'link') useStore.getState().setSelectedIds([]);
    focusCanvas();
  }, [cancelGesture, focusCanvas]);
  const selectCard = useCallback((id: string) => {
    setSelectedLink(null); useStore.getState().setSelectedIds([id]); lastAnchor.current = id;
    if (id.startsWith('scene:')) useStore.getState().updateWritingContext({ sceneId: id.slice(6) });
  }, []);
  const selectLink = useCallback((id: string) => {
    cancelGesture(); useStore.getState().setSelectedIds([]); setSelectedLink(id);
    setMode('select'); setLinkFrom(null); setContextMenu(null); focusCanvas();
  }, [cancelGesture, focusCanvas]);
  const changeFilter = (next: Filter) => {
    cancelGesture(); setFilter(next); setMode('select'); setLinkFrom(null); setSelectedLink(null); setContextMenu(null);
    useStore.getState().setSelectedIds(visibleSelected.filter((id) => next === 'both' || id.startsWith(next === 'scenes' ? 'scene:' : 'beat:')));
    lastAnchor.current = null;
  };
  useEffect(() => {
    if (selectedLink && !links.some((link) => link.id === selectedLink)) setSelectedLink(null);
    if (linkFrom && !visibleSet.has(linkFrom)) setLinkFrom(null);
  }, [links, selectedLink, linkFrom, visibleSet]);

  const connectCard = (id: string) => {
    if (!visibleSet.has(id)) return;
    if (!linkFrom) { setLinkFrom(id); return; }
    if (linkFrom !== id) {
      useStore.getState().addBoardLink(linkFrom, id);
      const link = useStore.getState().project.boardLinks?.find((item) =>
        (item.from === linkFrom && item.to === id) || (item.from === id && item.to === linkFrom));
      setSelectedLink(link?.id || null);
    }
    setLinkFrom(null); setMode('select'); focusCanvas();
  };

  // 红线：场景卡删除是整场正文删除，必须确认；Delete 在任何文字编辑区域都不能触发此路径。
  const deleteCards = useCallback((ids: string[]) => {
    const targets = ids.filter((id) => visibleSet.has(id));
    if (!targets.length) return;
    const sceneCount = targets.filter((id) => id.startsWith('scene:')).length;
    if (sceneCount && !window.confirm(`删除 ${sceneCount} 场完整戏？这会删除这些场景的正文和故事信息，并清理相关连线；关联素材会保留并解除关联。${targets.length > sceneCount ? '\n选中的其他素材卡片也会删除。' : ''}\n可用撤销恢复。`)) return;
    const store = useStore.getState();
    store.setSelectedIds(targets); store.deleteSelectedBoardCards();
    setSelectedLink(null); lastAnchor.current = null;
    store.notify(`已删除 ${targets.length} 张卡片，可撤销`, 'ok');
  }, [visibleSet]);
  const deleteSelection = useCallback(() => {
    if (selectedLink && links.some((link) => link.id === selectedLink)) {
      useStore.getState().deleteBoardLink(selectedLink); setSelectedLink(null);
    } else deleteCards(visibleSelected);
    setContextMenu(null);
  }, [selectedLink, links, deleteCards, visibleSelected]);

  useEffect(() => {
    if (view !== 'board') return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || isTextTarget(event.target)) return;
      if (event.key === 'Escape') {
        event.preventDefault(); cancelGesture(); setMode('select'); setLinkFrom(null); setContextMenu(null);
        if (addMenuRef.current) addMenuRef.current.open = false;
        if (viewMenuRef.current) viewMenuRef.current.open = false;
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault(); spaceRef.current = true; setSpaceHeld(true); return;
      }
      if (event.key.toLowerCase() === 'l' && !event.shiftKey && !event.repeat) {
        event.preventDefault(); switchMode(mode === 'link' ? 'select' : 'link');
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !event.repeat && !gesture.current && (selectedLink || visibleSelected.length)) {
        event.preventDefault(); deleteSelection();
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') { spaceRef.current = false; setSpaceHeld(false); }
    };
    const blur = () => { spaceRef.current = false; setSpaceHeld(false); cancelGesture(); };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); };
  }, [view, mode, selectedLink, visibleSelected, deleteSelection, switchMode, cancelGesture]);

  const beginGesture = (event: React.MouseEvent, data: Pick<Gesture, 'mode' | 'members' | 'anchor' | 'additive' | 'previous'>) => {
    gesture.current = { ...data, sx: event.clientX, sy: event.clientY, zoom, pan, moved: false };
  };
  const onMouseDownCapture = (event: React.MouseEvent) => {
    if (isTextTarget(event.target)) return;
    if (event.button === 1 || (event.button === 0 && spaceRef.current)) {
      event.preventDefault(); event.stopPropagation(); setContextMenu(null); focusCanvas();
      beginGesture(event, { mode: 'pan', members: [] }); return;
    }
    if (mode === 'link' && event.button === 0) {
      const node = (event.target as HTMLElement).closest<HTMLElement>('[data-card]');
      if (node) { event.preventDefault(); event.stopPropagation(); connectCard(`${node.dataset.drag ? 'scene' : 'beat'}:${node.dataset.id}`); }
    }
  };
  const onMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    setContextMenu(null);
    if (mode === 'link') { switchMode('select'); return; }
    const node = (event.target as HTMLElement).closest<HTMLElement>('[data-card]');
    setSelectedLink(null); focusCanvas(); event.preventDefault();
    if (node) {
      const id = `${node.dataset.drag ? 'scene' : 'beat'}:${node.dataset.id}`;
      const anchor = layoutMap.get(id);
      if (!anchor) return;
      const store = useStore.getState();
      if (id.startsWith('scene:')) store.updateWritingContext({ sceneId: id.slice(6) }, documentEpoch);
      if (event.metaKey || event.ctrlKey) { store.toggleSelection(id); lastAnchor.current = id; return; }
      if (event.shiftKey) { store.selectRange(visibleIds, lastAnchor.current, id); lastAnchor.current = id; return; }
      const ids = visibleSelected.includes(id) ? visibleSelected : [id];
      store.setSelectedIds(ids); lastAnchor.current = id;
      beginGesture(event, { mode: 'move', members: ids.map((key) => layoutMap.get(key)!).filter(Boolean), anchor });
    } else {
      const previous = visibleSelected;
      if (!event.shiftKey) useStore.getState().setSelectedIds([]);
      beginGesture(event, { mode: 'marquee', members: [], additive: event.shiftKey, previous });
    }
  };
  useEffect(() => {
    const move = (event: MouseEvent) => {
      const data = gesture.current;
      if (!data) return;
      const dx = event.clientX - data.sx, dy = event.clientY - data.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) data.moved = true;
      if (!data.moved) return;
      if (data.mode === 'pan') setPan({ x: data.pan.x + dx, y: data.pan.y + dy });
      if (data.mode === 'move' && data.anchor) {
        const raw = { x: data.anchor.x + dx / data.zoom, y: data.anchor.y + dy / data.zoom };
        const next = snapBoardPosition(raw, data.zoom, snap, event.altKey);
        const mx = next.x - data.anchor.x, my = next.y - data.anchor.y;
        data.final = data.members.map((card) => ({ id: card.id, x: Math.round((card.x + mx) * 100) / 100, y: Math.round((card.y + my) * 100) / 100 }));
        setPreview(Object.fromEntries(data.final.map((card) => [card.id, { x: card.x, y: card.y }])));
        setSnapping(next.x !== raw.x || next.y !== raw.y);
      }
      if (data.mode === 'resize' && data.anchor) {
        data.size = clampSize(data.anchor.kind, data.anchor.w + dx / data.zoom, data.anchor.h + dy / data.zoom);
        setPreview({ [data.anchor.id]: data.size });
      }
      if (data.mode === 'marquee') setMarquee({ sx: data.sx, sy: data.sy, ex: event.clientX, ey: event.clientY });
    };
    const up = (event: MouseEvent) => {
      const data = gesture.current;
      if (!data) return;
      if (data.mode === 'move' && data.moved && data.final) useStore.getState().moveBoardCards(data.final);
      if (data.mode === 'resize' && data.anchor && data.size && (data.size.w !== data.anchor.w || data.size.h !== data.anchor.h))
        useStore.getState().resizeBoardCard(data.anchor.id, data.size.w, data.size.h);
      if (data.mode === 'marquee' && data.moved && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const x = (Math.min(data.sx, event.clientX) - rect.left - data.pan.x) / data.zoom;
        const y = (Math.min(data.sy, event.clientY) - rect.top - data.pan.y) / data.zoom;
        useStore.getState().setSelectedIds(marqueeSel(layoutRef.current.map((card) => card.id), cardCenters(layoutRef.current), x, y, Math.abs(event.clientX - data.sx) / data.zoom,
          Math.abs(event.clientY - data.sy) / data.zoom, !!data.additive, data.previous || []));
      }
      cancelGesture();
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [snap, cancelGesture, documentEpoch]);

  const startResize = (event: React.MouseEvent, id: string) => {
    event.preventDefault(); event.stopPropagation();
    const anchor = layoutMap.get(id);
    if (!anchor) return;
    selectCard(id); focusCanvas(); beginGesture(event, { mode: 'resize', members: [], anchor });
  };
  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    if (gesture.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const next = Math.max(.4, Math.min(2, zoom * (event.deltaY > 0 ? .9 : 1.1)));
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    setPan({ x: x - (x - pan.x) * next / zoom, y: y - (y - pan.y) * next / zoom }); setZoom(next);
  };
  const closeAddMenu = () => { if (addMenuRef.current) addMenuRef.current.open = false; };
  const addCard = (kind: 'beat' | 'sound') => {
    const store = useStore.getState(); const pos = autoPos(deriveScenes(store.project).length + store.project.beats.length);
    const id = store.addBeat(pos.x, pos.y, '', kind); selectCard(`beat:${id}`); closeAddMenu();
  };
  const addScene = () => {
    const store = useStore.getState(); const pos = autoPos(deriveScenes(store.project).length + store.project.beats.length);
    const id = store.addBoardScene(pos.x, pos.y); if (id) selectCard(`scene:${id}`); closeAddMenu();
  };
  const addImage = () => {
    closeAddMenu();
    const documentEpoch = useStore.getState().documentEpoch;
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0]; if (!file) return;
      const reader = new FileReader();
      reader.onerror = () => { if (useStore.getState().documentEpoch === documentEpoch) useStore.getState().notify('图片读取失败，未创建卡片', 'error'); };
      reader.onload = () => {
        if (typeof reader.result !== 'string' || useStore.getState().documentEpoch !== documentEpoch) return;
        const store = useStore.getState(); const pos = autoPos(deriveScenes(store.project).length + store.project.beats.length);
        const id = store.addBeat(pos.x, pos.y, '', 'image', { img: reader.result, title: file.name }); selectCard(`beat:${id}`);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };
  const onDoubleClick = (event: React.MouseEvent) => {
    if (mode !== 'select' || (event.target as Element).closest('[data-card],.board-links,.board__context,.board__dock,.board__context-menu')) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const id = useStore.getState().addBeat((event.clientX - rect.left - pan.x) / zoom, (event.clientY - rect.top - pan.y) / zoom);
    selectCard(`beat:${id}`);
  };
  const onContextMenu = (event: React.MouseEvent) => {
    if (isTextTarget(event.target)) return;
    const card = (event.target as Element).closest<HTMLElement>('[data-card]');
    const line = (event.target as Element).closest<SVGElement>('[data-link-id]');
    if (!card && !line) return;
    event.preventDefault(); const rect = canvasRef.current!.getBoundingClientRect();
    const position = { x: Math.max(8, Math.min(event.clientX - rect.left, rect.width - 230)), y: Math.max(8, Math.min(event.clientY - rect.top, rect.height - 130)) };
    if (line?.dataset.linkId) {
      selectLink(line.dataset.linkId); setContextMenu({ ...position, ids: [], linkId: line.dataset.linkId });
    } else if (card) {
      const id = `${card.dataset.drag ? 'scene' : 'beat'}:${card.dataset.id}`;
      const ids = visibleSelected.includes(id) ? visibleSelected : [id];
      useStore.getState().setSelectedIds(ids); setSelectedLink(null); setContextMenu({ ...position, ids }); focusCanvas();
    }
  };

  const contextAnchor = layoutMap.get(lastAnchor.current && visibleSelected.includes(lastAnchor.current) ? lastAnchor.current : visibleSelected[0]);
  const selectedBeat = visibleSelected.length === 1 && visibleSelected[0].startsWith('beat:') ? project.beats.find((beat) => `beat:${beat.id}` === visibleSelected[0]) : null;
  const contextWidth = Math.min(selectedBeat ? 370 : 208, Math.max(180, canvasSize.width - 24));
  const contextPosition = contextAnchor ? {
    width: contextWidth,
    left: Math.max(12, Math.min(contextAnchor.x * zoom + pan.x, canvasSize.width - contextWidth - 12)),
    top: Math.max(10, Math.min(contextAnchor.y * zoom + pan.y - 48, canvasSize.height - 100)),
  } : null;
  const menuDeleteLabel = contextMenu?.linkId ? '删除连线' : contextMenu?.ids.some((id) => id.startsWith('scene:'))
    ? contextMenu.ids.length === 1 ? '删除整场' : '删除所选（含整场）' : contextMenu?.ids.length === 1 ? '删除卡片' : '删除所选';
  const canvasRect = canvasRef.current?.getBoundingClientRect();

  return <div className="board board--polished board--workspace" data-mode={mode} data-snap={snap ? 'on' : 'off'} data-selected-link={selectedLink || ''}>
    <div className="board__bar">
      <div className="board__subtabs" role="tablist" aria-label="自由板显示范围">
        {([['both', '总览'], ['scenes', '场景板'], ['beats', '灵感板']] as const).map(([value, label]) =>
          <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => changeFilter(value)}>{label}</button>)}
      </div>
      <span className="board__selection-status" aria-live="polite">{mode === 'link' ? linkFrom ? '再点一张卡片 · Esc 取消' : '点两张卡片建立关系' : selectedLink ? '已选关系线 · Delete 删除' : visibleSelected.length ? `已选 ${visibleSelected.length}` : ''}</span>
      <div className="board__actions">
        <details ref={addMenuRef} className="board__dropdown"><summary className="btn--primary" aria-label="新增卡片">+ 新增</summary>
          <div className="board__menu"><button onClick={addScene}>场景卡</button><button onClick={() => addCard('beat')}>灵感卡</button><button onClick={() => addCard('sound')}>声音卡</button><button onClick={addImage}>图片卡</button></div>
        </details>
        <details ref={viewMenuRef} className="board__dropdown"><summary aria-label="视图设置">视图</summary>
          <div className="board__menu">
            <label><input type="checkbox" aria-label="显示网格" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />显示网格</label>
            <label><input type="checkbox" aria-label="磁吸网格" checked={snap} onChange={(e) => setSnap(e.target.checked)} />磁吸网格 · Alt 暂停</label>
            <hr /><button onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); if (viewMenuRef.current) viewMenuRef.current.open = false; }}>重置视图</button>
          </div>
        </details>
      </div>
    </div>
    <div ref={canvasRef} className="board__canvas" tabIndex={-1} aria-label="自由板画布" data-grid={showGrid ? 'on' : 'off'} data-panning={spaceHeld ? 'on' : 'off'}
      style={{ backgroundSize: `${BOARD_GRID_SIZE * zoom}px ${BOARD_GRID_SIZE * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }}
      onWheel={onWheel} onMouseDownCapture={onMouseDownCapture} onMouseDown={onMouseDown} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}>
      <div className="board__world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <BoardLinks links={links} layouts={layoutMap} selectedLink={selectedLink} zoom={zoom} onSelect={selectLink} onFinish={focusCanvas} />
        {filter !== 'beats' && scenes.map((scene) => <SceneCard key={scene.elementId} scene={scene} layout={layoutMap.get(`scene:${scene.elementId}`)!}
          selected={visibleSelected.includes(`scene:${scene.elementId}`)} linking={linkFrom === `scene:${scene.elementId}`} snapping={snapping && visibleSelected.includes(`scene:${scene.elementId}`)}
          onSelect={() => selectCard(`scene:${scene.elementId}`)} onResizeStart={startResize} onOpen={() => {
            if (mode !== 'select') return;
            useStore.getState().setView('write'); useStore.getState().requestFocus(scene.elementId, 'start');
          }} />)}
        {filter !== 'scenes' && project.beats.map((beat) => <BeatCard key={beat.id} beat={beat} layout={layoutMap.get(`beat:${beat.id}`)!}
          selected={visibleSelected.includes(`beat:${beat.id}`)} linking={linkFrom === `beat:${beat.id}`} snapping={snapping && visibleSelected.includes(`beat:${beat.id}`)}
          onSelect={() => selectCard(`beat:${beat.id}`)} onResizeStart={startResize} />)}
      </div>
      {marquee && <div className="board__marquee" style={{ left: Math.min(marquee.sx, marquee.ex) - (canvasRect?.left || 0), top: Math.min(marquee.sy, marquee.ey) - (canvasRect?.top || 0), width: Math.abs(marquee.ex - marquee.sx), height: Math.abs(marquee.ey - marquee.sy) }} />}
      {!!visibleSelected.length && contextPosition && !gesture.current && mode === 'select' && !contextMenu && <div className="board__context" style={contextPosition} onMouseDown={stopMouse} onDoubleClick={stopMouse} onWheel={stopWheel}>
        <div className="board__color-bar" aria-label="所选卡片颜色">{CARD_COLORS.map((color, index) => <button key={color} aria-label={`卡片颜色 ${index + 1}`} style={{ background: color }}
          onClick={() => useStore.getState().setBoardCardColors(visibleSelected, color)} />)}</div>
        {selectedBeat && <label className="board__association"><select aria-label="关联到场景" value={selectedBeat.sceneId || ''} onChange={(e) => useStore.getState().linkBeat(selectedBeat.id, e.target.value || undefined)}>
          <option value="">未关联</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>第 {scene.number} 场 · {scene.title || scene.heading || '场景标题'}</option>)}
        </select></label>}
      </div>}
      {contextMenu && <div className="board__context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={stopMouse} onDoubleClick={stopMouse}>
        {!contextMenu.linkId && <button role="menuitem" onClick={() => { setMode('link'); setLinkFrom(contextMenu.ids[0]); setSelectedLink(null); useStore.getState().setSelectedIds([]); setContextMenu(null); focusCanvas(); }}>连接另一张卡片</button>}
        <button role="menuitem" className="is-danger" onClick={() => { if (contextMenu.linkId) { useStore.getState().deleteBoardLink(contextMenu.linkId); setSelectedLink(null); } else deleteCards(contextMenu.ids); setContextMenu(null); }}>{menuDeleteLabel}</button>
      </div>}
      <div className="board__hint">{mode === 'link' ? linkFrom ? '请选择另一张卡片 · Esc 取消' : '点击起点，再点击终点 · Esc 取消' : 'Shift 多选 · L 连线 · Delete 删除 · 空格拖动画布'}</div>
      <div className="board__dock" role="toolbar" aria-label="自由板工具" onMouseDown={stopMouse} onDoubleClick={stopMouse}>
        <button className={`btn ${mode === 'select' ? 'is-active' : ''}`} aria-label="选择卡片" aria-pressed={mode === 'select'} onClick={() => switchMode('select')}>选择</button>
        <button className={`btn ${mode === 'link' ? 'is-active' : ''}`} aria-label="连接两张卡片" aria-pressed={mode === 'link'} title="连接两张卡片（L）；Esc 取消" onClick={() => switchMode('link')}>连线 <small>L</small></button>
        <div className="zoom-ctl"><button className="icon-btn" aria-label="缩小自由板" onClick={() => setZoom((value) => Math.max(.4, Math.round((value - .1) * 10) / 10))}>−</button>
          <span className="zoom-val">{Math.round(zoom * 100)}%</span><button className="icon-btn" aria-label="放大自由板" onClick={() => setZoom((value) => Math.min(2, Math.round((value + .1) * 10) / 10))}>+</button></div>
      </div>
    </div>
  </div>;
}

interface CardProps {
  layout: Layout; selected: boolean; linking: boolean; snapping: boolean;
  onSelect: () => void; onResizeStart: (event: React.MouseEvent, id: string) => void;
}
const cardClass = (props: CardProps) => `bcard${props.selected ? ' is-selected' : ''}${props.linking ? ' is-linking' : ''}${props.snapping ? ' is-snapping' : ''}`;
function ResizeHandle({ layout, onStart }: { layout: Layout; onStart: CardProps['onResizeStart'] }) {
  const limits = sizeLimitFor(layout.kind);
  return <button className="bcard__resize" aria-label={layout.kind === 'scene' ? '调整场景卡大小' : '调整卡片大小'} title={`拖动缩放（${limits.minW}–${limits.maxW}px）`}
    onMouseDown={(event) => onStart(event, layout.id)} onClick={(event) => { event.preventDefault(); event.stopPropagation(); }} onDoubleClick={stopMouse}><span /></button>;
}
function SceneCard(props: CardProps & { scene: Scene; onOpen: () => void }) {
  const { scene, layout, onSelect } = props;
  return <div className={`${cardClass(props)} bcard--scene`} data-card="scene" data-drag="scene" data-id={scene.elementId} data-kind="scene"
    style={{ left: layout.x, top: layout.y, width: layout.w, height: layout.h, '--scene-color': safeDisplayColor(scene.color) } as React.CSSProperties} onDoubleClick={(event) => { event.stopPropagation(); props.onOpen(); }}>
    <div className="bcard__head"><span className="bcard__no">{scene.number}</span><span className="bcard__title" title={scene.title || scene.heading}>{scene.title || scene.heading || '场景标题'}</span></div>
    <textarea className="bcard__scene-notes" aria-label={`第 ${scene.number} 场故事信息`} placeholder="这一场发生了什么？" value={scene.synopsis || ''} onFocus={onSelect}
      onChange={(event) => useStore.getState().updateSceneMeta(scene.elementId, { synopsis: event.target.value })} onMouseDown={stopMouse} onDoubleClick={stopMouse} onWheel={stopWheel} />
    <ResizeHandle layout={layout} onStart={props.onResizeStart} />
  </div>;
}
function BeatCard(props: CardProps & { beat: Beat }) {
  const { beat, layout, onSelect } = props;
  const image = beat.kind === 'image';
  const sound = beat.kind === 'sound';
  const imageSource = safeEmbeddedImageSource(beat.img);
  const update = (patch: Partial<Beat>) => useStore.getState().updateBeat(beat.id, patch);
  return <div className={`${cardClass(props)} bcard--beat${image ? ' bcard--image' : sound ? ' bcard--sound' : ''}`} data-card="beat" data-id={beat.id} data-kind={beat.kind || 'beat'}
    style={{ left: layout.x, top: layout.y, width: layout.w, height: layout.h, '--card-color': safeDisplayColor(beat.color) } as React.CSSProperties}>
    {!image && <div className="bcard__head"><CardTitle value={beat.title || ''} label={sound ? '声音标题' : '灵感标题'} placeholder={sound ? '声音标题' : '添加标题'} onSelect={onSelect} onCommit={(title) => useStore.getState().commitBoardCardTitle(beat.id, title)} /></div>}
    {image && <><div className="bcard__media">{imageSource ? <img className="bcard__media-img" src={imageSource} alt={beat.title || '参考图片'} draggable={false} /> : <div className="bcard__empty-media">{beat.img ? '图片来源已阻止，请重新导入本地图片' : '暂无图片'}</div>}</div>
      <input className="bcard__caption" aria-label="图片标题" placeholder="图片标题（可选）" value={beat.title || ''} onFocus={onSelect} onChange={(event) => update({ title: event.target.value })} onMouseDown={stopMouse} onDoubleClick={stopMouse} onWheel={stopWheel} /></>}
    <textarea className={`bcard__edit${image ? ' bcard__image-notes' : ''}`} aria-label={image ? '图片备注' : sound ? '声音说明' : '灵感内容'}
      placeholder={image ? '图片备注、画面灵感…' : sound ? '声音、音乐或氛围说明…' : '写下灵感、人物动机或事件关系…'} value={beat.text || ''} onFocus={onSelect}
      onChange={(event) => update({ text: event.target.value })} onMouseDown={stopMouse} onDoubleClick={stopMouse} onWheel={stopWheel} />
    <ResizeHandle layout={layout} onStart={props.onResizeStart} />
  </div>;
}

// 单击标题仍可选中/拖动卡片；双击才编辑，防止标题输入框吞掉 Shift 多选和 L 连线。
function CardTitle({ value, label, placeholder, onSelect, onCommit }: { value: string; label: string; placeholder: string; onSelect: () => void; onCommit: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const finishing = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  const begin = () => { finishing.current = false; setDraft(value); setEditing(true); onSelect(); };
  const finish = (commit: boolean) => {
    if (finishing.current) return; finishing.current = true;
    if (commit && draftRef.current !== value) onCommit(draftRef.current);
    setEditing(false);
  };
  return editing ? <input ref={input} data-native-edit-history data-project-draft-pending={draft !== value ? 'true' : undefined} className="bcard__media-title" aria-label={label} value={draft} placeholder={placeholder}
    onChange={(event) => setDraft(event.target.value)} onBlur={() => finish(true)} onMouseDown={stopMouse} onDoubleClick={stopMouse} onWheel={stopWheel}
    onKeyDown={(event) => { event.stopPropagation(); if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); finish(event.key === 'Enter'); } }} />
    : <span className="bcard__media-title" tabIndex={0} role="button" aria-label={`编辑${label}`} title="双击编辑标题" onDoubleClick={(event) => { event.stopPropagation(); begin(); }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); event.stopPropagation(); begin(); } }}>{value || placeholder}</span>;
}

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
function BoardLinks({ links, layouts, selectedLink, zoom, onSelect, onFinish }: { links: BoardLink[]; layouts: Map<string, Layout>; selectedLink: string | null; zoom: number; onSelect: (id: string) => void; onFinish: () => void }) {
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
      }} /> : (link.note || selected) ? <button className="board-link__label" aria-label={link.note ? `关系说明：${link.note}` : '添加关系说明'} title="双击编辑关系说明"
      onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); onSelect(link.id); }} onDoubleClick={begin}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); event.stopPropagation(); begin(); } }}>{link.note || '双击添加关系说明'}</button> : null}
  </div>;
}
