import React, { useMemo } from 'react';
import { useStore } from '../store/store';
import { computeStats } from '../model/stats';
import { ELEMENT_META } from '../model/elements';

export function StatusBar() {
  const project = useStore((s) => s.project);
  const pageCount = useStore((s) => s.pageCount);
  const activeId = useStore((s) => s.activeId);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const setTargetPages = useStore((s) => s.setTargetPages);
  const stats = useMemo(() => computeStats(project, pageCount), [project, pageCount]);
  const activeEl = project.elements.find((e) => e.id === activeId);
  const mins = stats.estimatedMinutes;
  const targetPages = Math.max(1, project.targetPages || 100);
  const progress = Math.min(100, Math.round((stats.estimatedPages / targetPages) * 100));

  return (
    <div className="statusbar">
      <span>{stats.words} 字</span>
      <span className="sep" />
      <span>{stats.estimatedPages} 页</span>
      <span className="sep" />
      <span>
        约 {Math.floor(mins)} 分 {String(Math.round((mins % 1) * 60)).padStart(2, '0')} 秒
      </span>
      <span className="sep" />
      <span>{stats.sceneCount} 场</span>
      <span className="sep" />
      <span>{stats.characterCount} 人</span>
      <div className="spacer" />
      {activeEl ? <span className="statusbar__type">{ELEMENT_META[activeEl.type].label}</span> : null}
      {project.settings.revisionMode ? <span className="badge">修订模式</span> : null}
      <label className="target-pages" title="目标页数">
        <span>目标</span>
        <input
          type="number"
          min={1}
          max={9999}
          value={targetPages}
          aria-label="目标页数"
          onChange={(e) => setTargetPages(Number(e.target.value))}
        />
        <span>页</span>
      </label>
      <div className="typewriter-progress" aria-label={`已完成 ${progress}%`} title={`已完成 ${stats.estimatedPages} / ${targetPages} 页`}>
        <div className="typewriter-progress__paper" style={{ width: `${progress}%` }} />
        <span className="typewriter-progress__pointer" style={{ left: `${progress}%` }} aria-hidden>⌄</span>
      </div>
      <span className="zoom">
        <button onClick={() => setZoom(zoom - 0.1)}>－</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(zoom + 0.1)}>＋</button>
      </span>
    </div>
  );
}
