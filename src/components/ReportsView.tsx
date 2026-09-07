import { useMemo } from 'react';
import { useStore } from '../store/store';
import { characterStats, computeStats, sceneStats } from '../model/stats';
import { ELEMENT_META } from '../model/elements';

export function ReportsView() {
  const project = useStore((s) => s.project);
  const pageCount = useStore((s) => s.pageCount);
  const renameCharacter = useStore((s) => s.renameCharacter);
  const stats = useMemo(() => computeStats(project, pageCount), [project, pageCount]);
  const scenes = useMemo(() => sceneStats(project), [project]);
  const chars = useMemo(() => characterStats(project), [project]);

  const exportCsv = () => {
    const rows: string[] = ['场号,场景,字数,出场人物'];
    scenes.forEach((s) => {
      rows.push([s.number, s.heading, s.words, s.characters.join(' / ')].map(csvCell).join(','));
    });
    rows.push('');
    rows.push('人物,出场场次,台词段数,台词字数');
    chars.forEach((c) => {
      rows.push([c.name, c.scenes.length, c.lines, c.words].map(csvCell).join(','));
    });
    download('剧本统计.csv', '\ufeff' + rows.join('\n'));
  };

  return (
    <div className="reports">
      <div className="reports__bar">
        <span className="reports__label">统计报表</span>
        <div className="spacer" />
        <button className="btn btn--ghost" onClick={exportCsv}>
          导出 CSV
        </button>
      </div>
      <div className="reports__scroll">
        <div className="stat-grid">
          <Stat label="总字数" value={String(stats.words)} />
          <Stat label="中文字符" value={String(stats.cjk)} />
          <Stat label="页数" value={String(stats.estimatedPages)} />
          <Stat label="预计时长" value={`${Math.floor(stats.estimatedMinutes)} 分 ${Math.round((stats.estimatedMinutes % 1) * 60)} 秒`} />
          <Stat label="场次" value={String(stats.sceneCount)} />
          <Stat label="人物" value={String(stats.characterCount)} />
          <Stat label="对白字数" value={String(stats.dialogueWords)} />
          <Stat label="动作字数" value={String(stats.actionWords)} />
        </div>

        <section className="report-block">
          <div className="report-block__title"><h3>场景统计</h3><span>按正文场次汇总</span></div>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>场号</th>
                <th>场景</th>
                <th style={{ width: 90 }}>字数</th>
                <th style={{ width: 220 }}>出场人物</th>
              </tr>
            </thead>
            <tbody>
              {scenes.map((s) => (
                <tr key={s.number}>
                  <td className="mono">{s.number}</td>
                  <td>{s.heading}</td>
                  <td className="mono">{s.words}</td>
                  <td>{s.characters.join('、')}</td>
                </tr>
              ))}
              {!scenes.length ? (
                <tr>
                  <td colSpan={4} className="empty">
                    还没有场次
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <section className="report-block">
          <div className="report-block__title"><h3>人物统计</h3><span>改名会同步正文中的人物元素</span></div>
          <table className="table">
            <thead>
              <tr>
                <th>人物</th>
                <th style={{ width: 110 }}>出场场次</th>
                <th style={{ width: 100 }}>台词段数</th>
                <th style={{ width: 100 }}>台词字数</th>
              </tr>
            </thead>
            <tbody>
              {chars.map((c) => (
                <tr key={c.name}>
                  <td>
                    <input
                      className="character-name-edit"
                      defaultValue={c.name}
                      aria-label={`修改人物 ${c.name}`}
                      onBlur={(e) => renameCharacter(c.name, e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') {
                          e.currentTarget.value = c.name;
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  </td>
                  <td className="mono">{c.scenes.length}</td>
                  <td className="mono">{c.lines}</td>
                  <td className="mono">{c.words}</td>
                </tr>
              ))}
              {!chars.length ? (
                <tr>
                  <td colSpan={4} className="empty">
                    还没有人物
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <section className="report-block">
          <div className="report-block__title"><h3>元素分布</h3><span>不含备忘</span></div>
          <div className="element-dist">
            {Object.entries(stats.elementCounts).map(([type, n]) => (
              <div className="element-dist__row" key={type}>
                <span className="element-dist__name">{ELEMENT_META[type as keyof typeof ELEMENT_META]?.label || type}</span>
                <div className="element-dist__bar">
                  <div
                    style={{
                      width: `${Math.round((n / Math.max(1, project.elements.length)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="element-dist__num mono">{n}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
