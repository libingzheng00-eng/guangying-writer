import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { usePagination } from '../hooks/PaginationProvider';
import {
  computeSceneBands,
  sceneBandPercent,
  overPages as computeOverPages,
  writtenPagesExcludingTitle,
  type SceneBand,
} from '../model/progress';
import typewriterPointer from '../assets/typewriter-pointer.png';
import { safeDisplayColor } from '../utils/displayValues';

export function ProgressBar({ onCollapse }: { onCollapse?: () => void }) {
  const project = useStore((s) => s.project);
  const activeId = useStore((s) => s.activeId);
  const pageCount = useStore((s) => s.pageCount);
  const requestFocus = useStore((s) => s.requestFocus);
  const { pageOf } = usePagination();

  const target = Math.max(0, project.targetPages || 0);
  const caretPage = activeId && pageOf[activeId] !== undefined ? pageOf[activeId] + 1 : 0;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewedPage = useViewedPage(rootRef, pageOf, activeId);
  // 当前页：光标所在段落还在画面里就用光标页，否则用画面中间正在看的那一页。
  const current = viewedPage || caretPage;
  const [editingTarget, setEditingTarget] = useState(false);

  // v3.3-scene-strips：按预计排版行数计算各场篇幅，占比条不写入项目数据。
  // 占比条跟随（延后的）正文：打字时先沿用上一版，空闲时再重算，不占用输入的那一帧。
  const bandProject = useDeferredValue(project);
  const sceneBands: SceneBand[] = useMemo(() => computeSceneBands(bandProject), [
    bandProject.elements,
    bandProject.sceneMeta,
    bandProject.settings.indent,
    bandProject.settings.autoNumberScenes,
  ]);

  const activeElementIndex = useMemo(
    () => (activeId ? bandProject.elements.findIndex((e) => e.id === activeId) : -1),
    [activeId, bandProject.elements],
  );
  const activeSceneIndex = sceneBands.findIndex(
    (s) => activeElementIndex >= s.start && activeElementIndex < s.end,
  );

  // v3.4-target-scene-strips：目标存在时使用目标页数作分母，未写区域保留为空白。
  const writtenPages = writtenPagesExcludingTitle(pageCount, project);
  const completionPct = target > 0 ? Math.max(0, Math.min(100, Math.round((writtenPages / target) * 100))) : 0;
  const overP = computeOverPages(writtenPages, target);

  // 打字机指针停在当前页（与点击进度条跳页的换算一致：第 n 页在 n / 目标 处）；填充条仍表示已写页数。
  const pointerPct = target > 0 ? Math.max(0, Math.min(100, ((current || 1) / target) * 100)) : 0;

  // 里程碑：25% / 75%（v2.6 已按用户要求移除 50%）
  const milestones = [25, 75];

  // 跳页提示浮层
  const tipRef = useRef<HTMLDivElement | null>(null);
  const roadRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onTyping = () => {
      const marker = markerRef.current;
      if (!marker) return;
      marker.classList.add('is-typing');
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        marker.classList.remove('is-typing');
        typingTimerRef.current = null;
      }, 260);
    };
    window.addEventListener('guangying:typing', onTyping);
    return () => {
      window.removeEventListener('guangying:typing', onTyping);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);
  useEffect(() => {
    if (!tipRef.current || !roadRef.current || target <= 0) return;
    const tip = tipRef.current;
    const road = roadRef.current;
    const onMove = (e: MouseEvent) => {
      const rect = road.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const leftPct = (x / rect.width) * 100;
      const page = Math.max(1, Math.round((leftPct / 100) * target));
      const ok = page <= writtenPages;
      tip.style.left = `${leftPct}%`;
      tip.className = 'write-progress__tip' + (ok ? '' : ' is-invalid');
      tip.style.transform = leftPct > 72 ? 'translate(calc(-100% - 8px), -50%)' : 'translate(8px, -50%)';
      tip.textContent = ok ? `跳到第 ${page} 页` : `第 ${page} 页尚未写出`;
    };
    const onLeave = () => {
      tip.className = 'write-progress__tip';
    };
    road.addEventListener('mousemove', onMove);
    road.addEventListener('mouseleave', onLeave);
    return () => {
      road.removeEventListener('mousemove', onMove);
      road.removeEventListener('mouseleave', onLeave);
    };
  }, [target, writtenPages]);

  const onRoadClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!roadRef.current || target <= 0) return;
    const rect = roadRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const page = Math.max(1, Math.round((x / rect.width) * target));
    if (page > writtenPages) return; // 不可跳到未写出的页
    // 找到第 page 页第一个有实际元素的 elementId
    const els = project.elements;
    const pages = pageOf;
    // 找当前已写出页里在 target 页的所有候选
    const inPage = els.filter((e) => pages[e.id] === page - 1 || pages[e.id] === page);
    // 简单实现：跳到页首第一个元素
    const cand = inPage[0] || els[0];
    if (cand) requestFocus(cand.id, 'start');
  };

  // 场景按钮只随占比、页数、目标和当前场变化；打字时的即时渲染直接复用。
  const bandButtons = useMemo(() => (
    sceneBands.length
      ? sceneBands.map((scene, index) => {
        const { targetPct, renderPct } = sceneBandPercent(scene.pct, writtenPages, target);
        const percentText = `${targetPct.toFixed(targetPct < 1 ? 1 : 0)}%`;
        const scaleLabel = target > 0 ? '占目标 ' : '占当前剧本 ';
        return (
          <button
            type="button"
            role="listitem"
            key={scene.elementId}
            className={'write-progress__scene' + (index === activeSceneIndex ? ' is-active' : '')}
            style={{ flex: `0 0 ${renderPct}%`, backgroundColor: safeDisplayColor(scene.color) }}
            title={`第 ${scene.number} 场 · ${scaleLabel}${percentText}${scene.heading ? ' · ' + scene.heading : ''} · 点击跳转`}
            aria-label={`第 ${scene.number} 场，${scaleLabel}${percentText}`}
            onClick={() => requestFocus(scene.elementId, 'start', 'start')}
          >
            <span className="write-progress__scene-no">{scene.number}</span>
          </button>
        );
      })
      : <span className="write-progress__scenes-empty">暂无场景</span>
    // requestFocus 是商店里的固定函数。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [sceneBands, writtenPages, target, activeSceneIndex]);

  return (
    <div className="write-progress write-progress--typewriter" ref={rootRef}>
      <div className="write-progress__label" role="button" tabIndex={editingTarget ? -1 : 0} aria-label={`当前第 ${current || 0} 页，目标 ${target || '未设'} 页，点击修改目标页数`}
        title="点击修改目标页数（0 = 关闭目标）" onClick={() => setEditingTarget(true)}
        onKeyDown={(event) => { if (!editingTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setEditingTarget(true); } }}>
        <div className="write-progress__value">
          <strong>{current || 0}</strong>
          <span className="write-progress__divider">/</span>
          {editingTarget
            ? <TargetInput value={target} onDone={(next) => { setEditingTarget(false); if (next !== null) useStore.getState().setTargetPages(next); }} />
            : <span className="write-progress__target">{target > 0 ? target : '—'}</span>}
        </div>
      </div>

      <div
        className="write-progress__road"
        ref={roadRef}
        onClick={onRoadClick}
        title={target > 0 ? `${current} / ${target} 页 · ${completionPct}%` : '设定目标页数后显示进度'}
      >
        {target > 0 ? (
          <div
            className="write-progress__fill"
            style={{ width: `${completionPct}%` }}
            aria-hidden
          />
        ) : null}
        {target > 0
          ? milestones.map((m) => (
              <span
                key={m}
                className={'write-progress__milestone' + (completionPct >= m ? ' is-done' : '')}
                style={{ left: `${m}%` }}
              />
            ))
          : null}
        {target > 0 ? <div className="write-progress__tip" ref={tipRef} /> : null}
        {target > 0 ? (
          <span
            ref={markerRef}
            className="write-progress__marker"
            style={{ left: `calc(${pointerPct}% - 28px)` }}
            title={`第 ${current || 1} 页 · 已写 ${writtenPages} / ${target} 页`}
          >
            <img src={typewriterPointer} alt="打字机进度指针" draggable={false} />
          </span>
        ) : null}
        {target > 0 ? (
          <span
            className={'write-progress__end' + (completionPct >= 100 ? ' is-reached' : '')}
            style={{ left: 'calc(100% - 4px)' }}
            title="写作目标终点"
            aria-hidden
          />
        ) : null}
      </div>

      <div
        className={'write-progress__scenes' + (overP > 0 ? ' is-over-target' : '')}
        role="list"
        aria-label={target > 0 ? '场景占目标页数比例' : '场景占当前剧本比例'}
        data-mode={target > 0 ? 'target' : 'current'}
        data-written-pages={writtenPages}
        data-target-pages={target}
        data-over-pages={overP}
      >
        {bandButtons}
        {overP > 0 ? (
          <span className="write-progress__over">{`超出目标 ${overP} 页`}</span>
        ) : null}
      </div>

      {onCollapse ? <button type="button" className="write-progress__collapse" title="收起进度栏" aria-label="收起进度栏" onClick={onCollapse}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
      </button> : null}
    </div>
  );
}

/** 进度栏左侧页数框里的目标页数输入：Enter / 失焦生效，Esc 放弃。 */
function TargetInput({ value, onDone }: { value: number; onDone: (next: number | null) => void }) {
  const [draft, setDraft] = useState(String(value || ''));
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return; done.current = true;
    const next = Math.max(0, Math.min(9999, Math.round(Number(draft) || 0)));
    onDone(commit && next !== value ? next : null);
  };
  return <input className="write-progress__target-input" type="number" min={0} max={9999} aria-label="目标页数" autoFocus value={draft}
    onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.stopPropagation()}
    onChange={(event) => setDraft(event.target.value)} onBlur={() => finish(true)}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    }} />;
}

/**
 * 画面里正在看的那一页（从 1 开始）。光标段落仍在画面里时返回 0，交给光标页决定；
 * 滚动到别处时取画面中线处的段落所在页。只读 DOM，不写工程。
 */
function useViewedPage(rootRef: React.RefObject<HTMLDivElement>, pageOf: Record<string, number>, activeId: string | null): number {
  const [page, setPage] = useState(0);
  const latest = useRef({ pageOf, activeId });
  latest.current = { pageOf, activeId };
  const remeasure = useRef<() => void>(() => {});
  useEffect(() => {
    const scroller = rootRef.current?.closest('.editor') as HTMLElement | null;
    if (!scroller) return;
    let frame = 0;
    // 段落节点列表只在正文变化后重新收集；滚动时不再每帧把几千个节点复制成数组。
    let collected: { version: number; nodes: HTMLElement[] } | null = null;
    const blockNodes = () => {
      const version = useStore.getState().version;
      if (!collected || collected.version !== version || (collected.nodes.length && !collected.nodes[0].isConnected)) {
        collected = { version, nodes: Array.from(scroller.querySelectorAll<HTMLElement>('.script-flow [data-id]')) };
      }
      return collected.nodes;
    };
    const measure = () => {
      frame = 0;
      const { pageOf: pages, activeId: caret } = latest.current;
      const view = scroller.getBoundingClientRect();
      const top = view.top + (rootRef.current?.offsetHeight || 0), bottom = view.bottom;
      if (bottom <= top) return;
      const nodes = blockNodes();
      const caretNode = caret ? nodes.find((node) => node.dataset.id === caret) : undefined;
      if (caretNode) {
        const box = caretNode.getBoundingClientRect();
        if (box.bottom > top && box.top < bottom) { setPage(0); return; }
      }
      const middle = (top + bottom) / 2;
      let lo = 0, hi = nodes.length - 1, hit = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (nodes[mid].getBoundingClientRect().bottom >= middle) { hit = mid; hi = mid - 1; } else lo = mid + 1;
      }
      const id = hit >= 0 ? nodes[hit].dataset.id : nodes[nodes.length - 1]?.dataset.id;
      setPage(id && pages[id] !== undefined ? pages[id] + 1 : 0);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    remeasure.current = schedule;
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => { scroller.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); if (frame) cancelAnimationFrame(frame); };
  }, [rootRef]);
  // 光标移动（打字、点进度条跳页）后重新判断一次。不能派发假的 scroll 事件，
  // 否则会把 SmartType 等跟随滚动关闭的浮层误关掉。
  useEffect(() => { remeasure.current(); }, [activeId, pageOf]);
  return page;
}
