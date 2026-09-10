import React, { useMemo } from 'react';
import { useStore, type SidebarMode } from '../store/store';
import { deriveScenes } from '../model/project';
import { reorderOutlineScene } from '../model/outline';
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
      <button className="sidebar__collapse" title="收起侧栏" aria-label="收起侧栏" onClick={toggleSidebar}>
        <span aria-hidden>‹</span>
      </button>
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
                requestFocus(s.elementId, 'start', 'start');
                setView('write');
              }}
            >
              <span className="nav-item__no" style={{ background: s.color }}>
                {s.number}
              </span>
              <span className="nav-item__text">
                <span className="nav-item__heading">{s.title || s.heading || '（未命名场景）'}</span>
                <span className="nav-item__sub">
                  第 {pageOf[s.elementId] !== undefined ? pageOf[s.elementId] + 1 : '?'} 页 · {project.acts.find((act) => act.id === s.actId)?.title || '未归幕'}
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
  const drag = React.useRef<{ elementId: string; projectId: string } | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<{ elementId: string; edge: 'before' | 'after' } | null>(null);
  const dragType = 'application/x-guangying-outline-scene';
  const clearDrag = () => { drag.current = null; setDraggingId(null); setOver(null); };
  const validDrag = (event: React.DragEvent) => drag.current?.projectId === useStore.getState().project.id
    && Array.from(event.dataTransfer.types).includes(dragType);
  const edgeAt = (event: React.DragEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' as const : 'after' as const;
  };
  const move = (sourceId: string, targetId: string, edge: 'before' | 'after') => {
    const state = useStore.getState();
    // 整场排序只提交一次；原位/相邻原位落下不调用 mutate，也不清空重做记录。
    if (!reorderOutlineScene(state.project.elements, sourceId, targetId, edge)) return;
    state.mutate((project) => {
      const elements = reorderOutlineScene(project.elements, sourceId, targetId, edge);
      if (elements) project.elements = elements;
    });
  };
  return (
    <div className="panel">
      <div className="panel__hint">拖动场号到卡片上/下半部排序；双击场号定位正文</div>
      <div className="panel__list">
        {scenes.map((s) => (
          <div
            className={`outline-item${draggingId === s.elementId ? ' is-dragging' : ''}${over?.elementId === s.elementId ? ` is-drop-${over.edge}` : ''}`}
            key={s.id}
            data-outline-scene={s.elementId}
            onDragOverCapture={(event) => {
              if (!validDrag(event)) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'move';
              const edge = edgeAt(event);
              setOver((previous) => previous?.elementId === s.elementId && previous.edge === edge ? previous : { elementId: s.elementId, edge });
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setOver((previous) => previous?.elementId === s.elementId ? null : previous);
              }
            }}
            onDropCapture={(event) => {
              if (!validDrag(event)) return;
              event.preventDefault();
              event.stopPropagation();
              const sourceId = drag.current!.elementId;
              const edge = edgeAt(event);
              clearDrag();
              move(sourceId, s.elementId, edge);
            }}
          >
            <div className="outline-item__head">
              <button
                type="button"
                className="outline-item__no outline-item__drag"
                style={{ background: s.color }}
                draggable
                aria-label={`拖动第 ${s.number} 场排序`}
                title="拖动排序；双击定位正文；Alt+↑/↓ 上下移动"
                onDragStart={(event) => {
                  drag.current = { elementId: s.elementId, projectId: useStore.getState().project.id };
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData(dragType, s.elementId);
                  const card = event.currentTarget.closest('.outline-item');
                  if (card && event.dataTransfer.setDragImage) event.dataTransfer.setDragImage(card, 16, 14);
                  setDraggingId(s.elementId);
                }}
                onDragEnd={clearDrag}
                onDoubleClick={() => {
                  requestFocus(s.elementId, 'start', 'start');
                  setView('write');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') clearDrag();
                  if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                  event.preventDefault();
                  const before = event.key === 'ArrowUp';
                  const neighbor = scenes[s.index + (before ? -1 : 1)];
                  if (neighbor) move(s.elementId, neighbor.elementId, before ? 'before' : 'after');
                }}
              >
                {s.number}
              </button>
              <input
                className="outline-item__title"
                value={s.title}
                placeholder={s.heading || '场景标题'}
                onChange={(e) => updateSceneMeta(s.elementId, { title: e.target.value })}
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
  const deleteScene = useStore((s) => s.deleteScene);
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
            {scene ? (
              <button className="btn btn--danger" title="删除这场戏的标题及全部正文（可用撤销恢复）" onClick={() => deleteScene(scene.elementId)}>
                删除整场
              </button>
            ) : (
              <button className="btn btn--danger" onClick={() => removeElement(el.id)}>
                删除
              </button>
            )}
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
