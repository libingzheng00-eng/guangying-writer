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

/**
 * 写作进度条主题（v1.2.9 同款，三个主题 + 三个终点图标）。
 *
 * SVG 来源：twemoji 15.1.0（CC-BY 4.0，github.com/jdecked/twemoji）。
 * 仅作为内联 SVG 使用，不引入额外图片资源；与 v1.2.9 保持完全一致。
 */
const THEMES = [
  { key: 'cigarette' as const, label: '香烟', endLabel: '爱心' },
  { key: 'car' as const, label: '汽车', endLabel: '旗帜' },
  { key: 'key' as const, label: '钥匙', endLabel: '宝石' },
];

const SVG_CIGARETTE = '<path fill="#D99E82" d="M13 30H2s-2 0-2-2v-5c0-2 2-2 2-2h11v9z"/><path fill="#E1E8ED" d="M12 21h14v9H12z"/><path fill="#66757F" d="M31 21h-6v9h6s2 0 2-2v-5c0-2-2-2-2-2z"/><path fill="#CCD6DD" d="M27.79 20c-.488 0-.916-.358-.988-.855-.029-.2-.654-4.924 4.475-8.002 2.498-1.499 3.063-4.246 2.532-6.164C33.561 4.083 32.673 2 29.791 2c-3.142 0-3.963 1.77-4.15 2.562-.282 1.197 0 2.141.625 2.594.649.47 1.423.332 1.932.017.389-.24.594-.646.594-1.173 0-.552.447-1 1-1 .553 0 1 .448 1 1 0 1.221-.562 2.269-1.542 2.874-1.106.683-2.819.538-3.919-.077-1.351-.756-2.061-2.623-1.589-4.619C24.358 1.562 26.62 0 29.791 0c2.908 0 5.186 1.703 5.945 4.445.889 3.208-.522 6.667-3.431 8.412-4 2.4-3.53 5.962-3.525 5.998.08.547-.299 1.055-.845 1.134-.048.008-.097.011-.145.011z"/>';
const SVG_CAR = '<path fill="#DD2E44" d="M13 32h20s3 0 3-4c0-2 0-6-1-7s-8-7-11-7h-6c-3 0-10 7-10 7l-4 1s-3 1-3 3v3s-1 .338-1 1.957C0 32 2 32 2 32h11z"/><path fill="#BBDDF5" d="M20 16h-2c-2 0-8 6-8 6s4.997-.263 10-.519V16zm10 3c-1-1-5-3-7-3h-1v5.379c4.011-.209 7.629-1.825 8-2.379z"/>';
const SVG_KEY = '<path fill="#FFAC33" d="M23.174 9.174c-2.53 0-4.742 1.51-5.891 3.692C16.13 12.315 14.887 12 13.565 12 8.328 12 4 16.328 4 21.565c0 1.199.213 2.348.584 3.426l-3.018 3.018c-.75.75-.75 1.965 0 2.715s1.965.75 2.715 0l3.018-3.018c1.078.371 2.227.584 3.426.584 2.334 0 4.488-.755 6.26-2.02 1.106 2.616 3.688 4.462 6.689 4.462 4.02 0 7.283-3.263 7.283-7.283s-3.263-7.155-7.283-7.155z"/><path fill="#66757F" d="M13.565 25.13c-1.962 0-3.565-1.603-3.565-3.565s1.603-3.565 3.565-3.565 3.565 1.603 3.565 3.565-1.603 3.565-3.565 3.565z"/><path fill="#292F33" d="M13.565 23.13c-.862 0-1.565-.703-1.565-1.565s.703-1.565 1.565-1.565 1.565.703 1.565 1.565-.703 1.565-1.565 1.565z"/>';
const SVG_END_CIGARETTE = '<path fill="#DD2E44" d="M35.885 11.833c0-5.45-4.418-9.868-9.867-9.868-3.308 0-6.227 1.633-8.018 4.129-1.791-2.496-4.71-4.129-8.017-4.129-5.45 0-9.868 4.417-9.868 9.868 0 .772.098 1.52.266 2.241C1.751 22.587 11.216 31.568 18 34.034c6.783-2.466 16.249-11.447 17.617-19.96.17-.721.268-1.469.268-2.241z"/>';
const SVG_END_CAR = '<path fill="#DD2E44" d="M11 33S9 33 9 31V5c0-2 2-2 2-2s10 2 16 2 8-2 8-2v16s-2 2-8 2-14-2-16-2v12c0 2-2 2-2 2z"/>';
const SVG_END_KEY = '<path fill="#88C9F9" d="M8 12l-5 6 11 14 11-14-5-6z"/><path fill="#3B88C3" d="M18 12l-5 6 5 6 5-6z"/><path fill="#55ACEE" d="M8 12l5 6h10l5-6z"/><path fill="#BBDDF5" d="M13 18l5 14 5-14z"/>';

/** 返回主图标 SVG（主题内的小烟/车/钥匙），终点图标 SVG 由 `*-end` 提供。 */
export function fogPSvg(name: string): string {
  let inner = '';
  if (name === 'cigarette') inner = SVG_CIGARETTE;
  else if (name === 'car') inner = SVG_CAR;
  else if (name === 'key') inner = SVG_KEY;
  else if (name === 'cigarette-end') inner = SVG_END_CIGARETTE;
  else if (name === 'car-end') inner = SVG_END_CAR;
  else if (name === 'key-end') inner = SVG_END_KEY;
  else if (name === 'heart') inner = SVG_END_CIGARETTE;
  else if (name === 'flag') inner = SVG_END_CAR;
  else if (name === 'gem') inner = SVG_END_KEY;
  const sz = name.indexOf('-end') >= 0 || name === 'heart' || name === 'flag' || name === 'gem' ? 18 : 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="${sz}" height="${sz}">${inner}</svg>`;
}

/** 列表三套主题（含 label + 终点 label），供偏好设置渲染 segmented control */
export function fogPList(): { key: 'cigarette' | 'car' | 'key'; label: string; end: string }[] {
  return THEMES.map((t) => ({ key: t.key, label: t.label, end: t.endLabel }));
}

export function ProgressBar({ children }: { children?: React.ReactNode }) {
  const project = useStore((s) => s.project);
  const activeId = useStore((s) => s.activeId);
  const pageCount = useStore((s) => s.pageCount);
  const requestFocus = useStore((s) => s.requestFocus);
  const { pageOf } = usePagination();

  const target = Math.max(0, project.targetPages || 0);
  const current = activeId && pageOf[activeId] !== undefined ? pageOf[activeId] + 1 : 0;
  const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((current / target) * 100))) : 0;

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
  const titlePageCount = project.titlePage?.show && project.settings.titlePageBreak ? 1 : 0;
  const writtenPages = writtenPagesExcludingTitle(pageCount, project);
  const completionPct = target > 0 ? Math.max(0, Math.min(100, Math.round((writtenPages / target) * 100))) : 0;
  const overP = computeOverPages(writtenPages, target);

  // 里程碑：25% / 75%（v2.6 已按用户要求移除 50%）
  const milestones = [25, 75];

  // 跳页提示浮层
  const tipRef = useRef<HTMLDivElement | null>(null);
  const roadRef = useRef<HTMLDivElement | null>(null);
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
    const target1 = page - 1; // 0-based page index (excluding title)
    const els = project.elements;
    const pages = pageOf;
    // 找当前已写出页里在 target 页的所有候选
    const inPage = els.filter((e) => pages[e.id] === page - 1 || pages[e.id] === page);
    // 简单实现：跳到页首第一个元素
    const cand = inPage[0] || els[0];
    if (cand) requestFocus(cand.id, 'start');
    void target1;
  };

  return (
    <div className="write-progress write-progress--typewriter">
      <div className="write-progress__label">
        <span className="write-progress__eyebrow">当前页</span>
        <div className="write-progress__value">
          <strong>{current || 0}</strong>
          <span className="write-progress__divider">/</span>
          <span className="write-progress__target">{target > 0 ? target : '—'}</span>
          <span className="write-progress__unit">页</span>
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
        {target > 0 ? (
          <span className="write-progress__hint">{`已写 ${writtenPages} / ${target} 页 · ${completionPct}%`}</span>
        ) : (
          <span className="write-progress__hint">设定目标页数后显示进度</span>
        )}
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
                  onClick={() => requestFocus(scene.elementId, 'start')}
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
        {children}
      </label>
    </div>
  );
}
