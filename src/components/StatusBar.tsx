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
  const stats = useMemo(() => computeStats(project, pageCount), [project, pageCount]);
  const activeEl = project.elements.find((e) => e.id === activeId);
  const mins = stats.estimatedMinutes;

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
      <span className="zoom">
        <button onClick={() => setZoom(zoom - 0.1)}>－</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(zoom + 0.1)}>＋</button>
      </span>
    </div>
  );
}
