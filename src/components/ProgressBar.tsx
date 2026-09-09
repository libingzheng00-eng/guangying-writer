import React, { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store/store';
import { usePagination } from '../hooks/PaginationProvider';
import {
  computeSceneBands,
  overPages as computeOverPages,
  writtenPagesExcludingTitle,
  type SceneBand,
} from '../model/progress';
import typewriterPointer from '../assets/typewriter-pointer.png';

export function ProgressBar({ children }: { children?: React.ReactNode }) {
  const project = useStore((s) => s.project);
  const activeId = useStore((s) => s.activeId);
  const pageCount = useStore((s) => s.pageCount);
  const requestFocus = useStore((s) => s.requestFocus);
  const { pageOf } = usePagination();

  const target = Math.max(0, project.targetPages || 0);
  const current = activeId && pageOf[activeId] !== undefined ? pageOf[activeId] + 1 : 0;

  // v3.3-scene-strips：按预计排版行数计算各场篇幅，占比条不写入项目数据。
  const sceneBands: SceneBand[] = useMemo(() => computeSceneBands(project), [
    project.elements,
    project.sceneMeta,
    project.settings.indent,
    project.settings.autoNumberScenes,
  ]);

  const activeElementIndex = activeId ? project.elements.findIndex((e) => e.id === activeId) : -1;
  const activeSceneIndex = sceneBands.findIndex(
    (s) => activeElementIndex >= s.start && activeElementIndex < s.end,
  );

  // v3.4-target-scene-strips：目标存在时使用目标页数作分母，未写区域保留为空白。
  const writtenPages = writtenPagesExcludingTitle(pageCount, project);
  const completionPct = target > 0 ? Math.max(0, Math.min(100, Math.round((writtenPages / target) * 100))) : 0;
  const overP = computeOverPages(writtenPages, target);

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
    window.addEventListener('mochang:typing', onTyping);
    return () => {
      window.removeEventListener('mochang:typing', onTyping);
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

  return (
    <div className="write-progress write-progress--typewriter">
      <div className="write-progress__label">
        <div className="write-progress__value">
          <strong>{current || 0}</strong>
          <span className="write-progress__divider">/</span>
          <span className="write-progress__target">{target > 0 ? target : '—'}</span>
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
            style={{ left: `calc(${completionPct}% - 28px)` }}
            title={`已写 ${writtenPages} / ${target} 页`}
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
        {sceneBands.length
          ? sceneBands.map((scene, index) => {
              const targetPct = target > 0 ? (scene.pct * writtenPages) / target : scene.pct;
              const renderPct = target > 0 && overP <= 0 ? targetPct : scene.pct;
              const percentText = `${targetPct.toFixed(targetPct < 1 ? 1 : 0)}%`;
              const scaleLabel = target > 0 ? '占目标 ' : '占当前剧本 ';
              return (
                <button
                  type="button"
                  role="listitem"
                  key={scene.elementId}
                  className={'write-progress__scene' + (index === activeSceneIndex ? ' is-active' : '')}
                  style={{ flexBasis: `${renderPct}%`, background: scene.color }}
                  title={`第 ${scene.number} 场 · ${scaleLabel}${percentText}${scene.heading ? ' · ' + scene.heading : ''} · 点击跳转`}
                  aria-label={`第 ${scene.number} 场，${scaleLabel}${percentText}`}
                  onClick={() => requestFocus(scene.elementId, 'start', 'start')}
                >
                  <span className="write-progress__scene-no">{scene.number}</span>
                </button>
              );
            })
          : <span className="write-progress__scenes-empty">暂无场景</span>}
        {overP > 0 ? (
          <span className="write-progress__over">{`超出目标 ${overP} 页`}</span>
        ) : null}
      </div>

      <div className="write-progress__tools">
        <label className="write-progress__goal" title="目标页数（0 = 关闭目标，隐藏进度条）">
          目标
          <input
            type="number"
            min={0}
            max={9999}
            value={target}
            placeholder="100"
            aria-label="目标页数"
            onChange={(e) => useStore.getState().setTargetPages(Number(e.target.value))}
          />
          页
        </label>
        {children}
      </div>
    </div>
  );
}
