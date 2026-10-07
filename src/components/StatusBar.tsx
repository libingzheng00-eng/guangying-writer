import { useMemo } from 'react';
import { useStore } from '../store/store';
import { computeStats } from '../model/stats';
import { ELEMENT_META } from '../model/elements';
import { useRecoveryStatus } from '../app/recoveryStatus';

function RecoveryIndicator() {
  const { phase, lastSuccess, error } = useRecoveryStatus();
  const time = lastSuccess ? new Date(lastSuccess).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;
  const label = phase === 'error' ? '恢复点失败' : phase === 'saved' ? `恢复点 ${time}` : phase === 'pending' ? '恢复点待更新' : '恢复点尚未建立';
  return <span className={`statusbar__recovery${phase === 'error' ? ' is-error' : ''}`}
    role={phase === 'error' ? 'alert' : undefined}
    title={error ?? `${time ? `最近自动恢复点：${time}。` : ''}自动恢复点不等于工程文件已保存；请用保存/另存为写入 .zhsp。`}>
    {label}
  </span>;
}

/**
 * 底部状态栏：仅保留「写作统计 + 当前元素类型 + 修订模式 + 缩放」，
 * 不再放目标页数 / 进度条 —— 这些已迁到 Editor 顶部的 ProgressBar（v1.2.9 同款）。
 */
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
      <RecoveryIndicator />
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
