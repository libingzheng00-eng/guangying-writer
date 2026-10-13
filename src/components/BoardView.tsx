import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { deriveScenes } from '../model/project';
import { CARD_COLORS } from '../model/elements';
import { clampSize, sizeLimitFor, type ResizableKind } from '../model/board';
import { BOARD_GRID_SIZE, boardBeatPosition, snapBoardPosition, type BoardCardPosition } from '../model/boardWorkspace';
import { cardCenters, marqueeSel } from '../model/selection';
import type { Beat, BoardLink, Scene } from '../model/types';
import { safeDisplayColor, safeEmbeddedImageSource } from '../utils/displayValues';
import { SceneCard, BeatCard } from './board/BoardCards';
import { BoardLinks } from './board/BoardLinks';
import { stopMouse, stopWheel, type Layout } from './board/boardShared';

type Filter = 'both' | 'scenes' | 'beats';
type Preview = Record<string, { x?: number; y?: number; w?: number; h?: number }>;
interface ContextMenu { x: number; y: number; ids: string[]; linkId?: string }
interface Gesture {
  mode: 'move' | 'resize' | 'pan' | 'marquee' | 'link';
  /** 连线：从卡片的连线圆点拖出，松开在另一张卡片上即建立关系。 */
  linkFrom?: string;
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
const WHEEL_SCROLL_RATE = .0012;
const WHEEL_PINCH_RATE = .01;
const clampZoom = (value: number) => Math.max(.4, Math.min(2, Number.isFinite(value) ? value : 1));
const keepsNativeWheel = (target: EventTarget | null) => isTextTarget(target) ||
  (target instanceof Element && !!target.closest('.board__dock, .board__context-menu'));

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
  const [linkDraft, setLinkDraft] = useState<{ from: string; x: number; y: number; target: string | null } | null>(null);
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
    setLinkDraft(null); setSelectedLink(null); setContextMenu(null);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // React's delegated wheel listener is passive. Cancel the browser's canvas
    // scroll here, before React performs zoom; text/control areas retain their
    // native wheel behavior and their existing propagation boundaries.
    const preventCanvasScroll = (event: WheelEvent) => {
      if (!keepsNativeWheel(event.target)) event.preventDefault();
    };
    canvas.addEventListener('wheel', preventCanvasScroll, { passive: false });
    return () => canvas.removeEventListener('wheel', preventCanvasScroll);
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
    setPreview({}); setMarquee(null); setSnapping(false); setLinkDraft(null);
  }, []);
  const selectCard = useCallback((id: string) => {
    setSelectedLink(null); useStore.getState().setSelectedIds([id]); lastAnchor.current = id;
    if (id.startsWith('scene:')) useStore.getState().updateWritingContext({ sceneId: id.slice(6) });
  }, []);
  const selectLink = useCallback((id: string) => {
    cancelGesture(); useStore.getState().setSelectedIds([]); setSelectedLink(id);
    setContextMenu(null); focusCanvas();
  }, [cancelGesture, focusCanvas]);
  const changeFilter = (next: Filter) => {
    cancelGesture(); setFilter(next); setSelectedLink(null); setContextMenu(null);
    useStore.getState().setSelectedIds(visibleSelected.filter((id) => next === 'both' || id.startsWith(next === 'scenes' ? 'scene:' : 'beat:')));
    lastAnchor.current = null;
  };
  useEffect(() => {
    if (selectedLink && !links.some((link) => link.id === selectedLink)) setSelectedLink(null);
  }, [links, selectedLink]);

  // 建立一条关系线（不自连、不重复）；建好后选中它，方便直接写关系说明。
  const connectCards = useCallback((from: string, to: string) => {
    if (from === to || !visibleSet.has(from) || !visibleSet.has(to)) return false;
    useStore.getState().addBoardLink(from, to);
    const link = useStore.getState().project.boardLinks?.find((item) =>
      (item.from === from && item.to === to) || (item.from === to && item.to === from));
    if (link) { useStore.getState().setSelectedIds([]); setSelectedLink(link.id); }
    focusCanvas();
    return !!link;
  }, [visibleSet, focusCanvas]);
  const cardAt = (clientX: number, clientY: number) => {
    const node = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-card]');
    return node ? `${node.dataset.drag ? 'scene' : 'beat'}:${node.dataset.id}` : null;
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
        event.preventDefault(); cancelGesture(); setContextMenu(null);
        if (addMenuRef.current) addMenuRef.current.open = false;
        if (viewMenuRef.current) viewMenuRef.current.open = false;
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault(); spaceRef.current = true; setSpaceHeld(true); return;
      }
      // L：恰好选中两张卡片时直接连线（键盘也能完成连线）。
      if (event.key.toLowerCase() === 'l' && !event.shiftKey && !event.repeat && visibleSelected.length === 2) {
        event.preventDefault(); connectCards(visibleSelected[0], visibleSelected[1]);
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
  }, [view, selectedLink, visibleSelected, deleteSelection, connectCards, cancelGesture]);

  const beginGesture = (event: React.MouseEvent, data: Pick<Gesture, 'mode' | 'members' | 'anchor' | 'additive' | 'previous'>) => {
    gesture.current = { ...data, sx: event.clientX, sy: event.clientY, zoom, pan, moved: false };
  };
  const onMouseDownCapture = (event: React.MouseEvent) => {
    if (isTextTarget(event.target)) return;
    if (event.button === 1 || (event.button === 0 && spaceRef.current)) {
      event.preventDefault(); event.stopPropagation(); setContextMenu(null); focusCanvas();
      beginGesture(event, { mode: 'pan', members: [] }); return;
    }
  };
  const onMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    setContextMenu(null);
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
      if (data.mode === 'link' && data.linkFrom && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const target = cardAt(event.clientX, event.clientY);
        setLinkDraft({ from: data.linkFrom, x: (event.clientX - rect.left - data.pan.x) / data.zoom, y: (event.clientY - rect.top - data.pan.y) / data.zoom,
          target: target && target !== data.linkFrom ? target : null });
      }
    };
    const up = (event: MouseEvent) => {
      const data = gesture.current;
      if (!data) return;
      if (data.mode === 'move' && data.moved && data.final) useStore.getState().moveBoardCards(data.final);
      if (data.mode === 'resize' && data.anchor && data.size && (data.size.w !== data.anchor.w || data.size.h !== data.anchor.h))
        useStore.getState().resizeBoardCard(data.anchor.id, data.size.w, data.size.h);
      if (data.mode === 'link' && data.linkFrom && data.moved) {
        const target = cardAt(event.clientX, event.clientY);
        if (target && target !== data.linkFrom) connectCards(data.linkFrom, target);
      }
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
  }, [snap, cancelGesture, documentEpoch, connectCards]);

  const startLink = (event: React.MouseEvent, id: string) => {
    event.preventDefault(); event.stopPropagation();
    if (!layoutMap.get(id)) return;
    setContextMenu(null); setSelectedLink(null); focusCanvas();
    beginGesture(event, { mode: 'link', members: [] });
    gesture.current!.linkFrom = id;
  };
  const startResize = (event: React.MouseEvent, id: string) => {
    event.preventDefault(); event.stopPropagation();
    const anchor = layoutMap.get(id);
    if (!anchor) return;
    selectCard(id); focusCanvas(); beginGesture(event, { mode: 'resize', members: [], anchor });
  };
  const onWheel = (event: React.WheelEvent) => {
    if (keepsNativeWheel(event.target) || gesture.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    // 按滚动量连续缩放：触控板一次只给很小的 delta，不再每个事件跳 10%。
    // 触控板捏合（ctrlKey）比普通滚轮灵敏一些；鼠标滚轮一格约为 ±11%。
    const next = clampZoom(zoom * Math.exp(-event.deltaY * (event.ctrlKey ? WHEEL_PINCH_RATE : WHEEL_SCROLL_RATE)));
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    setPan({ x: x - (x - pan.x) * next / zoom, y: y - (y - pan.y) * next / zoom }); setZoom(next);
  };
  // 输入的比例以画布中心为锚点，画面不跳走。
  const zoomTo = (next: number) => {
    const target = clampZoom(next);
    const x = canvasSize.width / 2, y = canvasSize.height / 2;
    setPan({ x: x - (x - pan.x) * target / zoom, y: y - (y - pan.y) * target / zoom }); setZoom(target);
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
    if ((event.target as Element).closest('[data-card],.board-links,.board__dock,.board__context-menu')) return;
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

  const selectedBeat = visibleSelected.length === 1 && visibleSelected[0].startsWith('beat:') ? project.beats.find((beat) => `beat:${beat.id}` === visibleSelected[0]) : null;
  const selectedScene = visibleSelected.length === 1 && visibleSelected[0].startsWith('scene:') ? scenes.find((scene) => `scene:${scene.elementId}` === visibleSelected[0]) : null;
  const menuDeleteLabel = contextMenu?.linkId ? '删除连线' : contextMenu?.ids.some((id) => id.startsWith('scene:'))
    ? contextMenu.ids.length === 1 ? '删除整场' : '删除所选（含整场）' : contextMenu?.ids.length === 1 ? '删除卡片' : '删除所选';
  const canvasRect = canvasRef.current?.getBoundingClientRect();

  const draftFrom = linkDraft ? layoutMap.get(linkDraft.from) : undefined;
  return <div className="board board--polished board--workspace" data-linking={linkDraft ? 'on' : 'off'} data-snap={snap ? 'on' : 'off'} data-selected-link={selectedLink || ''}>
    <div className="board__bar">
      <div className="board__subtabs" role="tablist" aria-label="自由板显示范围">
        {([['both', '总览'], ['scenes', '场景板'], ['beats', '灵感板']] as const).map(([value, label]) =>
          <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => changeFilter(value)}>{label}</button>)}
      </div>
      <span className="board__selection-status" aria-live="polite">{linkDraft ? linkDraft.target ? '松开即连线' : '拖到另一张卡片上' : selectedLink ? '已选关系线 · 双击写说明 · Delete 删除' : visibleSelected.length ? `已选 ${visibleSelected.length}` : ''}</span>
      {!!visibleSelected.length && !linkDraft && <div className="board__selection-tools" role="group" aria-label="所选卡片设置">
        <div className="board__color-bar" aria-label="所选卡片颜色">{CARD_COLORS.map((color, index) => <button key={color} aria-label={`卡片颜色 ${index + 1}`} style={{ background: color }}
          onClick={() => useStore.getState().setBoardCardColors(visibleSelected, color)} />)}</div>
        {selectedScene && <select className="board__status" aria-label={`第 ${selectedScene.number} 场修改状态`} value={selectedScene.revisionStatus || ''}
          onChange={(event) => useStore.getState().commitReviewSceneMeta(selectedScene.elementId, { revisionStatus: event.target.value ? event.target.value as NonNullable<Scene['revisionStatus']> : undefined }, documentEpoch)}>
          <option value="">未标记</option><option value="todo">待修改</option><option value="revising">修改中</option><option value="done">已确认</option>
        </select>}
        {selectedBeat && <select className="board__association" aria-label="关联到场景" value={selectedBeat.sceneId || ''} onChange={(e) => useStore.getState().linkBeat(selectedBeat.id, e.target.value || undefined)}>
          <option value="">未关联场景</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>第 {scene.number} 场 · {scene.title || scene.heading || '场景标题'}</option>)}
        </select>}
        {visibleSelected.length === 2 && <button className="btn board__connect" title="连接这两张卡片（L）" onClick={() => connectCards(visibleSelected[0], visibleSelected[1])}>连线</button>}
      </div>}
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
        {linkDraft && draftFrom && <svg className="board-links board-links--draft" aria-hidden="true"><path className="board-link__draft"
          d={`M ${draftFrom.x + draftFrom.w} ${draftFrom.y + draftFrom.h / 2} L ${linkDraft.x} ${linkDraft.y}`} vectorEffect="non-scaling-stroke" /></svg>}
        {filter !== 'beats' && scenes.map((scene) => <SceneCard key={scene.elementId} scene={scene} layout={layoutMap.get(`scene:${scene.elementId}`)!}
          selected={visibleSelected.includes(`scene:${scene.elementId}`)} linking={linkDraft?.target === `scene:${scene.elementId}`} snapping={snapping && visibleSelected.includes(`scene:${scene.elementId}`)}
          onSelect={() => selectCard(`scene:${scene.elementId}`)} onResizeStart={startResize} onLinkStart={startLink} onOpen={() => {
            useStore.getState().setView('write'); useStore.getState().requestFocus(scene.elementId, 'start');
          }} />)}
        {filter !== 'scenes' && project.beats.map((beat) => <BeatCard key={beat.id} beat={beat} layout={layoutMap.get(`beat:${beat.id}`)!}
          selected={visibleSelected.includes(`beat:${beat.id}`)} linking={linkDraft?.target === `beat:${beat.id}`} snapping={snapping && visibleSelected.includes(`beat:${beat.id}`)}
          onSelect={() => selectCard(`beat:${beat.id}`)} onResizeStart={startResize} onLinkStart={startLink} />)}
      </div>
      {marquee && <div className="board__marquee" style={{ left: Math.min(marquee.sx, marquee.ex) - (canvasRect?.left || 0), top: Math.min(marquee.sy, marquee.ey) - (canvasRect?.top || 0), width: Math.abs(marquee.ex - marquee.sx), height: Math.abs(marquee.ey - marquee.sy) }} />}
      {contextMenu && <div className="board__context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={stopMouse} onDoubleClick={stopMouse}>
        {!contextMenu.linkId && contextMenu.ids.length === 2 && <button role="menuitem" onClick={() => { connectCards(contextMenu.ids[0], contextMenu.ids[1]); setContextMenu(null); }}>连接这两张卡片</button>}
        <button role="menuitem" className="is-danger" onClick={() => { if (contextMenu.linkId) { useStore.getState().deleteBoardLink(contextMenu.linkId); setSelectedLink(null); } else deleteCards(contextMenu.ids); setContextMenu(null); }}>{menuDeleteLabel}</button>
      </div>}
      <div className="board__hint">拖动卡片右上角的连线钮到另一张卡片即可连线 · Shift 多选 · Delete 删除 · 空格拖动画布</div>
      <div className="board__dock" role="toolbar" aria-label="自由板工具" onMouseDown={stopMouse} onDoubleClick={stopMouse}>
        <div className="zoom-ctl"><button className="icon-btn" aria-label="缩小自由板" onClick={() => setZoom((value) => Math.max(.4, Math.round((value - .1) * 10) / 10))}>−</button>
          <ZoomInput zoom={zoom} onCommit={zoomTo} /><button className="icon-btn" aria-label="放大自由板" onClick={() => setZoom((value) => Math.min(2, Math.round((value + .1) * 10) / 10))}>+</button></div>
      </div>
    </div>
  </div>;
}

/** 可直接输入的缩放比例（40%–200%）；Enter 或失焦生效，Esc 还原。 */
function ZoomInput({ zoom, onCommit }: { zoom: number; onCommit: (zoom: number) => void }) {
  const shown = String(Math.round(zoom * 100));
  const [draft, setDraft] = useState(shown);
  const editing = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(shown); }, [shown]);
  const commit = () => {
    editing.current = false;
    if (cancelled.current) { cancelled.current = false; setDraft(shown); return; }
    const value = parseFloat(draft.replace(/[^\d.]/g, ''));
    if (Number.isFinite(value) && value > 0) onCommit(value / 100);
    setDraft(String(Math.round(clampZoom(Number.isFinite(value) && value > 0 ? value / 100 : zoom) * 100)));
  };
  return <label className="zoom-val zoom-input" title="输入缩放比例，Enter 确认">
    <input aria-label="自由板缩放比例" inputMode="numeric" value={draft} onFocus={(event) => { editing.current = true; event.currentTarget.select(); }}
      onChange={(event) => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; event.currentTarget.blur(); }
      }} />%
  </label>;
}
