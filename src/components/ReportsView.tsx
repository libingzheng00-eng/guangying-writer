import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { usePagination } from '../hooks/PaginationProvider';
import { buildReport, reportCsvCell } from '../model/reports';
import { normalizeName } from '../model/project';
import { plain } from '../utils/text';
import { ELEMENT_META } from '../model/elements';
import '../styles/reports.css';

const percent = (part: number, total: number) => total ? `${(part / total * 100).toFixed(1)}%` : '0%';
const PAGE_SIZE = 20;

export function ReportsView() {
  const project = useStore(s => s.project);
  const version = useStore(s => s.version);
  const renameCharacter = useStore(s => s.renameCharacter);
  const pagination = usePagination();
  const ready = pagination.readyKey === `${version}:${project.settings.paper}`;
  const report = useMemo(() => buildReport(project, ready ? pagination.pages : undefined), [project, ready, pagination.pages]);
  const [scenePage, setScenePage] = useState(0);
  const [search, setSearch] = useState('');
  const [personPage, setPersonPage] = useState(0);
  const [pending, setPending] = useState('unassigned');
  const page = Math.min(scenePage, Math.max(0, Math.ceil(report.scenes.length / PAGE_SIZE) - 1));
  const visibleScenes = report.scenes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const filteredPeople = report.characters.filter(c => c.name.toLowerCase().includes(search.toLowerCase().trim()));
  const peoplePage = Math.min(personPage, Math.max(0, Math.ceil(filteredPeople.length / PAGE_SIZE) - 1));
  const visiblePeople = filteredPeople.slice(peoplePage * PAGE_SIZE, (peoplePage + 1) * PAGE_SIZE);
  const variants = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const el of project.elements) if (el.type === 'character') {
      const key = normalizeName(el.text), raw = plain(el.text).trim();
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(raw);
    }
    return map;
  }, [project]);
  const jump = (id: string) => {
    // 使用现有定位契约；统计不修改正文、选择或撤销历史。
    useStore.getState().setView('write');
    useStore.getState().requestFocus(id, 'start', 'start');
  };
  const tasks = [
    { id: 'unassigned', label: '未归幕', scenes: report.scenes.filter(s => !s.actId) },
    { id: 'empty', label: '空场景', scenes: report.scenes.filter(s => s.empty) },
    { id: 'synopsis', label: '未写梗概', scenes: report.scenes.filter(s => s.missingSynopsis) },
    { id: 'notes', label: '含备忘', scenes: report.scenes.filter(s => s.notes) },
  ];
  const exportCsv = () => {
    const rows: (string | number)[][] = [['统计口径', '不含省略场景、省略段落和备忘；词字数按中文单字、英文单词计；篇幅按词字数，不是时长。'],
      ['总词字数', report.words], ['正文涉及页数', report.pages ?? '排版中'], ['场前词字数', report.unscopedWords], [],
      ['场号', '场景', '归幕', '词字数', '占全文', '涉及页数', '对白字数', '动作字数', '发言人物', '地点', '内外景', '时间']];
    for (const s of report.scenes) rows.push([s.number, s.heading, report.acts.find(a => a.id === s.actId)?.title || '未归幕', s.words, percent(s.words, report.words), s.pages ?? '排版中', s.dialogueWords, s.actionWords, s.characters.join(' / '), s.location, s.setting, s.time]);
    rows.push([], ['人物', '发言场数', '发言次数', '对白词字数']);
    for (const c of report.characters) rows.push([c.name, c.scenes.length, c.lines, c.words]);
    rows.push([], ['幕', '场数', '词字数', '占全文']);
    for (const a of report.acts) rows.push([a.title, a.scenes, a.words, percent(a.words, report.words)]);
    download('剧本统计.csv', '\ufeff' + rows.map(row => row.map(reportCsvCell).join(',')).join('\r\n'));
  };

  return <div className="reports reports--analysis">
    <div className="reports__bar"><span className="reports__label">剧本分析</span><div className="spacer" /><button className="btn btn--ghost" onClick={exportCsv}>导出 CSV</button></div>
    <div className="reports__scroll">
      <p className="report-caption">看结构与分布，不评判创作好坏。以下不计省略场景、省略段落和备忘。</p>
      <div className="stat-grid">
        <Stat label="正文涉及页数" value={report.pages === null ? '排版中' : String(report.pages)} />
        <Stat label="场数" value={String(report.scenes.length)} />
        <Stat label="发言人物" value={String(report.characters.length)} />
        <Stat label="总词字数" value={report.words.toLocaleString()} />
      </div>
      <section className="report-block">
        <div className="report-block__title"><h3>幕与场景篇幅</h3><span>按词字数占全文比例 · 不是影片时长</span></div>
        <div className="report-acts">{report.acts.map(a => <div className="report-act" key={a.id}>
          <div><strong>{a.title}</strong><span>{a.scenes} 场 · {a.words} 字 · {percent(a.words, report.words)}</span></div><Meter part={a.words} total={report.words} />
        </div>)}</div>
        {report.unscopedWords > 0 && <p className="report-caption">场前文字 {report.unscopedWords} 字计入全文，但不归入任何幕。</p>}
        <p className="report-caption">涉及页数按当前排版去重，不含标题页。同一页可包含多场，各场涉及页数不能相加。</p>
        <Pager label="场景" page={page} total={report.scenes.length} onChange={setScenePage} />
        <div className="report-table-scroll"><table className="table"><thead><tr><th>场景 · 点击定位</th><th>词字数 / 占全文</th><th>涉及页数</th><th>对白 / 动作</th><th>发言人物</th></tr></thead><tbody>
          {visibleScenes.map(s => <tr key={s.id}><td><button className="report-link" onClick={() => jump(s.id)}>{s.number || '—'} · {s.heading || '未命名场景'}</button></td>
            <td>{s.words} / {percent(s.words, report.words)}<Meter part={s.words} total={report.words} /></td><td>{s.pages ?? '—'}</td>
            <td>{s.dialogueWords} / {s.actionWords}<small>对白占两者 {percent(s.dialogueWords, s.dialogueWords + s.actionWords)}</small></td><td>{s.characters.join('、') || '—'}</td></tr>)}
          {!report.scenes.length && <tr><td colSpan={5} className="empty">添加场次标题后，这里会显示场景分析。</td></tr>}
        </tbody></table></div>
      </section>
      <section className="report-block">
        <div className="report-block__title"><h3>人物发言分布</h3><span>只识别人物元素，不代表所有在场人物</span></div>
        <p className="report-caption">数字为人物元素出现次数；括号版本合并统计。下方名称可分别修改，沿用原有同步正文及撤销功能。</p>
        <div className="report-controls"><input aria-label="筛选人物" placeholder="查找人物…" value={search} onChange={e => { setSearch(e.target.value); setPersonPage(0); }} /><Pager label="人物" page={peoplePage} total={filteredPeople.length} onChange={setPersonPage} /></div>
        <div className="report-table-scroll"><table className="table report-matrix"><thead><tr><th>人物 · 可改名</th><th>发言场数</th><th>发言次数</th><th>对白字数</th>{visibleScenes.map(s => <th key={s.id}><button className="report-link" title={s.heading} onClick={() => jump(s.id)}>{s.number || '—'}</button></th>)}</tr></thead><tbody>
          {visiblePeople.map(c => <tr key={c.name}><td>{[...(variants.get(c.name) || [c.name])].map(raw => <input key={raw} className="character-name-edit" defaultValue={raw} aria-label={`修改人物 ${raw}`} onBlur={e => { if (!renameCharacter(raw, e.currentTarget.value)) e.currentTarget.value = raw; }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = raw; e.currentTarget.blur(); } }} />)}</td>
            <td>{c.scenes.length}</td><td>{c.lines}</td><td>{c.words}</td>{visibleScenes.map(s => <td key={s.id}>{c.byScene[s.id] ? <button className="report-presence" aria-label={`${c.name}，第${s.number}场，${c.byScene[s.id]}次发言`} title={s.heading} onClick={() => jump(s.id)}>{c.byScene[s.id]}</button> : <span className="report-caption">—</span>}</td>)}</tr>)}
          {!visiblePeople.length && <tr><td colSpan={4 + visibleScenes.length} className="empty">没有匹配的发言人物。</td></tr>}
        </tbody></table></div><p className="report-caption">横向场次与上方场景翻页一致。对白字数使用相同词字数口径，不计标点。</p>
      </section>
      <div className="report-columns">
        <section className="report-block"><div className="report-block__title"><h3>地点与时段</h3><span>按明确场次标题识别</span></div>
          <div className="report-tags">{report.settings.map(x => <span key={x.name}>{x.name} {x.count} 场</span>)}{report.times.map(x => <span key={'time-' + x.name}>{x.name === '未识别' ? '时间未识别' : x.name} {x.count} 场</span>)}</div>
          <details open><summary>地点清单 · {report.locations.filter(l => l.name !== '未识别').length} 个已识别地点</summary><div className="report-bounded">{report.locations.map(l => <div className="report-location" key={l.name}><span>{l.name}</span><span>{l.count} 场</span></div>)}</div></details>
          <p className="report-caption">需明确内景/外景前缀和日/夜等结尾；相似地点不自动合并。未识别不等于不存在。</p>
        </section>
        <section className="report-block"><div className="report-block__title"><h3>待处理事项</h3><span>提醒，不是错误</span></div>
          <div className="report-tags">{tasks.map(t => <button key={t.id} className="btn btn--ghost" aria-pressed={pending === t.id} onClick={() => setPending(t.id)}>{t.label} {t.scenes.length}</button>)}</div>
          <div className="report-bounded">{tasks.find(t => t.id === pending)!.scenes.map(s => <button key={s.id} className="report-task report-link" onClick={() => jump(s.id)}>{s.number} · {s.heading || '未命名场景'}</button>)}{!tasks.find(t => t.id === pending)!.scenes.length && <p className="report-caption">当前没有此类事项。</p>}</div>
        </section>
      </div>
      <details className="report-block"><summary>更多统计与计算口径</summary>
        <p className="report-caption">中文字符 {report.cjk} · 对白 {report.dialogueWords} 字 · 动作 {report.actionWords} 字 · 估算阅读时长 {Math.floor(report.readingSeconds / 60)} 分 {report.readingSeconds % 60} 秒（按设置中的阅读速度，不是影片时长）。词字数按中文单字、英文单词计，含标题与人物名，不计素材卡。</p>
        <h3>元素分布</h3><div className="element-dist">{Object.entries(report.elementCounts).map(([type, n]) => <div className="element-dist__row" key={type}><span className="element-dist__name">{ELEMENT_META[type as keyof typeof ELEMENT_META]?.label || type}</span><Meter part={n} total={report.elementTotal} /><span>{n} · {percent(n, report.elementTotal)}</span></div>)}</div>
      </details>
    </div>
  </div>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="stat"><div className="stat__value">{value}</div><div className="stat__label">{label}</div></div>; }
function Meter({ part, total }: { part: number; total: number }) { return <div className="report-meter" aria-hidden="true"><div style={{ width: percent(part, total) }} /></div>; }
function Pager({ label, page, total, onChange }: { label: string; page: number; total: number; onChange: (page: number) => void }) {
  return <div className="report-pager"><span>{label} {total ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total}</span>{total > PAGE_SIZE && <><button className="btn btn--ghost" aria-label={`${label}上一页`} disabled={!page} onClick={() => onChange(page - 1)}>上一页</button><button className="btn btn--ghost" aria-label={`${label}下一页`} disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => onChange(page + 1)}>下一页</button></>}</div>;
}
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
