import React, { useMemo } from 'react';
import { useStore, type SidebarMode } from '../store/store';
import { deriveScenes } from '../model/project';
import { CARD_COLORS, ELEMENT_META, ELEMENT_ORDER } from '../model/elements';
import { usePagination } from '../hooks/PaginationProvider';
import type { ElementType } from '../model/types';

const TABS: { key: SidebarMode; label: string }[] = [
  { key: 'navigator', label: '导航' },
  { key: 'outline', label: '大纲' },
  { key: 'inspector', label: '属性' },
];

export function Sidebar() {
  const sidebar = useStore((s) => s.sidebar);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebar = useStore((s) => s.setSidebar);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  if (!sidebarOpen) {
    return (
      <aside className="sidebar is-collapsed" aria-label="已收起的侧栏">
        <button className="sidebar__reveal" title="展开侧栏" aria-label="展开侧栏" onClick={toggleSidebar}>
          <span aria-hidden>›</span>
        </button>
      </aside>
    );
  }
  return (
    <aside className="sidebar" aria-label="导航侧栏">
      <div className="sidebar__tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`sidebar__tab ${sidebar === t.key ? 'is-active' : ''}`}
            onClick={() => setSidebar(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="sidebar__body">
        {sidebar === 'navigator' ? <NavigatorPanel /> : null}
        {sidebar === 'outline' ? <OutlinePanel /> : null}
        {sidebar === 'inspector' ? <InspectorPanel /> : null}
      </div>
    </aside>
  );
}

function useSceneList() {
  const project = useStore((s) => s.project);
  return useMemo(() => deriveScenes(project), [project]);
}

function NavigatorPanel() {
  const project = useStore((s) => s.project);
  const scenes = useSceneList();
  const requestFocus = useStore((s) => s.requestFocus);
  const setView = useStore((s) => s.setView);
  const moveScene = useStore((s) => s.moveScene);
  const toggleOmit = useStore((s) => s.toggleOmit);
  const { pageOf } = usePagination();
  const [filter, setFilter] = React.useState('');

  const list = scenes.filter((s) => !filter || s.heading.includes(filter) || s.title.includes(filter));

  return (
    <div className="panel">
      <input className="panel__search" placeholder="搜索场景…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="panel__list">
        {list.map((s) => (
          <div className={`nav-item ${s.omit ? 'is-omit' : ''}`} key={s.id}>
            <button
              className="nav-item__main"
              onClick={() => {
                requestFocus(s.elementId, 'start');
                setView('write');
              }}
            >
              <span className="nav-item__no" style={{ background: s.color }}>
                {s.number}
              </span>
              <span className="nav-item__text">
                <span className="nav-item__heading">{s.title || s.heading || '（未命名场景）'}</span>
                <span className="nav-item__sub">
                  {s.heading || '—'} · 第 {pageOf[s.elementId] !== undefined ? pageOf[s.elementId] + 1 : '?'} 页
                </span>
              </span>
            </button>
            <div className="nav-item__ops">
              <button title="上移" onClick={() => moveScene(s.index, -1)}>
                ↑
              </button>
              <button title="下移" onClick={() => moveScene(s.index, 1)}>
                ↓
              </button>
              <button title="省略" onClick={() => toggleOmit(s.elementId)}>
                {s.omit ? '○' : '⊘'}
              </button>
            </div>
          </div>
        ))}
        {!list.length ? <div className="panel__empty">没有匹配的场景</div> : null}
      </div>
      <div className="panel__foot">
        {project.acts.map((a) => (
          <div key={a.id} className="panel__act">
            <span className="dot" style={{ background: a.color }} />
            {a.title}
            <span className="panel__count">{scenes.filter((s) => s.actId === a.id).length} 场</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OutlinePanel() {
  const scenes = useSceneList();
  const updateSceneMeta = useStore((s) => s.updateSceneMeta);
  const requestFocus = useStore((s) => s.requestFocus);
  const setView = useStore((s) => s.setView);
  return (
    <div className="panel">
      <div className="panel__hint">写下每场的故事点，拖拽卡片视图可调整顺序</div>
      <div className="panel__list">
        {scenes.map((s) => (
          <div className="outline-item" key={s.id}>
            <div className="outline-item__head">
              <span className="outline-item__no" style={{ background: s.color }}>
                {s.number}
              </span>
              <input
                className="outline-item__title"
                value={s.title}
                placeholder={s.heading || '场景标题'}
                onChange={(e) => updateSceneMeta(s.elementId, { title: e.target.value })}
                onClick={() => {
                  requestFocus(s.elementId, 'start');
                  setView('write');
                }}
              />
            </div>
            <textarea
              className="outline-item__synopsis"
              value={s.synopsis}
              placeholder="这一场发生了什么？"
              onChange={(e) => updateSceneMeta(s.elementId, { synopsis: e.target.value })}
            />
          </div>
        ))}
        {!scenes.length ? <div className="panel__empty">还没有场次</div> : null}
      </div>
    </div>
  );
}

function InspectorPanel() {
  const project = useStore((s) => s.project);
  const activeId = useStore((s) => s.activeId);
  const setType = useStore((s) => s.setType);
  const setRevision = useStore((s) => s.setRevision);
  const toggleOmit = useStore((s) => s.toggleOmit);
  const setDual = useStore((s) => s.setDual);
  const moveElement = useStore((s) => s.moveElement);
  const removeElement = useStore((s) => s.removeElement);
  const updateSceneMeta = useStore((s) => s.updateSceneMeta);
  const scenes = useSceneList();

  const el = project.elements.find((e) => e.id === activeId) || null;
  const scene = el ? scenes.find((s) => s.elementId === el.id) : null;

  return (
    <div className="panel">
      {el ? (
        <section className="insp">
          <h4>当前元素</h4>
          <div className="field">
            <label>类型</label>
            <select value={el.type} onChange={(e) => setType(el.id, e.target.value as ElementType)}>
              {ELEMENT_ORDER.map((t) => (
                <option key={t} value={t}>
                  {ELEMENT_META[t].label}
                </option>
              ))}
            </select>
          </div>
          <div className="field field--row">
            <button className="btn btn--ghost" onClick={() => moveElement(el.id, -1)}>
              上移
            </button>
            <button className="btn btn--ghost" onClick={() => moveElement(el.id, 1)}>
              下移
            </button>
            <button className="btn btn--danger" onClick={() => removeElement(el.id)}>
              删除
            </button>
          </div>
          <div className="field">
            <label>
              <input type="checkbox" checked={!!el.omit} onChange={() => toggleOmit(el.id)} /> 省略（不参与排版）
            </label>
          </div>
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={!!el.dual}
                onChange={(e) => setDual(el.id, e.target.checked ? 'left' : null)}
              />{' '}
              双列对白（左）
            </label>
          </div>
          <div className="field">
            <label>修订</label>
            <div className="rev-picker">
              <button
                className={`rev-chip ${!el.rev ? 'is-active' : ''}`}
                onClick={() => setRevision(el.id, null)}
                style={{ background: '#fff' }}
              >
                —
              </button>
              {project.revisions.map((r) => (
                <button
                  key={r.id}
                  className={`rev-chip ${el.rev === r.id ? 'is-active' : ''}`}
                  style={{ background: r.color }}
                  title={r.label}
                  onClick={() => setRevision(el.id, r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <div className="panel__empty">在编辑器中选择一个元素</div>
      )}

      {scene ? (
        <section className="insp">
          <h4>场景卡</h4>
          <div className="field">
            <label>卡片标题</label>
            <input value={scene.title} placeholder={scene.heading} onChange={(e) => updateSceneMeta(scene.elementId, { title: e.target.value })} />
          </div>
          <div className="field">
            <label>摘要</label>
            <textarea
              value={scene.synopsis}
              rows={4}
              onChange={(e) => updateSceneMeta(scene.elementId, { synopsis: e.target.value })}
            />
          </div>
          <div className="field">
            <label>归属幕</label>
            <select
              value={scene.actId || ''}
              onChange={(e) => updateSceneMeta(scene.elementId, { actId: e.target.value || undefined })}
            >
              <option value="">未归幕</option>
              {project.acts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>卡片颜色</label>
            <div className="rev-picker">
              {CARD_COLORS.map((c) => (
                <button
                  key={c}
                  className={`rev-chip ${scene.color === c ? 'is-active' : ''}`}
                  style={{ background: c }}
                  onClick={() => updateSceneMeta(scene.elementId, { color: c })}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="insp">
        <h4>文档</h4>
        <div className="kv">
          <span>名称</span>
          <span>{project.name}</span>
        </div>
        <div className="kv">
          <span>元素数</span>
          <span>{project.elements.length}</span>
        </div>
        <div className="kv">
          <span>场次</span>
          <span>{scenes.length}</span>
        </div>
        <div className="kv">
          <span>创建</span>
          <span>{new Date(project.createdAt).toLocaleString('zh-CN')}</span>
        </div>
      </section>
    </div>
  );
}
