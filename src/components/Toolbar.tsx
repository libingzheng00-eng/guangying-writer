import { useEffect, useRef, useState } from 'react';
import { useStore, type ViewMode } from '../store/store';
import { ELEMENT_META, ELEMENT_ORDER } from '../model/elements';
import type { ElementType } from '../model/types';
import type { useCommands } from '../app/useCommands';

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: 'write', label: '写作' },
  { key: 'cards', label: '故事板' },
  { key: 'board', label: '自由板' },
  { key: 'preview', label: '预览' },
  { key: 'reports', label: '统计' },
];

export function Toolbar({ commands, onOpenSettings, onOpenTitle }: { commands: ReturnType<typeof useCommands>; onOpenSettings: () => void; onOpenTitle: () => void }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const project = useStore((s) => s.project);
  const activeId = useStore((s) => s.activeId);
  const activeRev = useStore((s) => s.activeRev);
  const setRevision = useStore((s) => s.setRevision);
  const toggleOmit = useStore((s) => s.toggleOmit);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const dirty = useStore((s) => s.dirty);
  const filePath = useStore((s) => s.filePath);
  const writingSelectionMode = useStore((s) => s.writingSelectionMode);
  const writingSelectedIds = useStore((s) => s.writingSelectedIds);
  const setWritingSelectionMode = useStore((s) => s.setWritingSelectionMode);
  const setWritingSelectedIds = useStore((s) => s.setWritingSelectedIds);
  const deleteWritingElements = useStore((s) => s.deleteWritingElements);
  const [menu, setMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeEl = project.elements.find((e) => e.id === activeId) || null;
  const selecting = view === 'write' && writingSelectionMode;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const fmt = (cmd: string) => {
    try {
      document.execCommand('styleWithCSS', false, 'false');
      document.execCommand(cmd);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="toolbar" ref={menuRef}>
      <div className="toolbar__group toolbar__document">
        <button className="doc-title" onClick={onOpenTitle} title={`${filePath || '尚未保存为文件'} · 点击编辑剧本信息`}>
          {filePath?.split(/[\\/]/).pop() || project.name}
          {dirty ? <i className="dot-dirty" title="有未保存的修改">●</i> : null}
        </button>
      </div>

      <div className="toolbar__group segmented toolbar__views">
        {VIEWS.map((v) => (
          <button key={v.key} className={view === v.key ? 'is-active' : ''} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>
      <select className="type-select toolbar__view-select" aria-label="工作视图" value={view} onChange={(e) => setView(e.target.value as ViewMode)}>
        {VIEWS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
      </select>

      {/* 写作红线：多选只替换同宽工具区，不增加顶栏高度、不动正文或 Tab 逻辑。
          完成多选后恢复全部原格式入口，避免展开操作挤压文件菜单及视图按钮。 */}
      <div className="toolbar__group toolbar__context">
      {selecting ? (
        <div className="toolbar__group writing-select-toolbar writing-select-toolbar--actions" role="group" aria-label="段落多选操作">
          <span className="writing-select-toolbar__count" title={`已选 ${writingSelectedIds.length} 段`} aria-live="polite">已选 {writingSelectedIds.length} 段</span>
          <button title="选择全部正文段落" onClick={() => setWritingSelectedIds(project.elements.map((el) => el.id))}>全选</button>
          <button disabled={!writingSelectedIds.length} title="删除选中的正文段落" onClick={() => deleteWritingElements(writingSelectedIds)}>删除所选</button>
          <button title="撤销最近一次修改" onClick={undo}>撤销</button>
        </div>
      ) : <>
        <select
          className="type-select"
          value={activeEl?.type || 'action'}
          onChange={(e) => commands.setElementType(e.target.value as ElementType)}
          title="当前元素类型（Tab 键循环切换）"
        >
          {ELEMENT_ORDER.map((t) => (
            <option key={t} value={t}>
              {ELEMENT_META[t].label}
            </option>
          ))}
        </select>
        <button className="icon-btn" title="加粗 ⌘B" onClick={() => fmt('bold')}>
          <b>B</b>
        </button>
        <button className="icon-btn" title="斜体 ⌘I" onClick={() => fmt('italic')}>
          <i>I</i>
        </button>
        <button className="icon-btn" title="下划线 ⌘U" onClick={() => fmt('underline')}>
          <u>U</u>
        </button>
        <button className="icon-btn" title="插入新场景 ⌘↩" onClick={commands.insertScene}>
          ＋场
        </button>
        <button className="icon-btn" title="双列对白 ⌘D" onClick={commands.makeDual}>
          ⇄
        </button>
        <button
          className="icon-btn"
          title="省略该元素"
          onClick={() => activeEl && toggleOmit(activeEl.id)}
        >
          ⊘
        </button>
      </>}
      </div>

      {project.settings.revisionMode ? (
        <div className="toolbar__group toolbar__revisions" title="修订稿颜色（可横向滚动）">
          <span className="rev-label">修订</span>
          {project.revisions.slice(1).map((r) => (
            <button
              key={r.id}
              className={`rev-chip ${activeRev === r.id ? 'is-active' : ''}`}
              style={{ background: r.color }}
              title={`把新输入的内容标记为 ${r.label} 稿`}
              onClick={() => {
                useStore.setState({ activeRev: activeRev === r.id ? null : r.id });
                setRevision(activeEl?.id || '', activeRev === r.id ? null : r.id);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}

      {view === 'write' ? (
        <div className="toolbar__group writing-select-toolbar writing-select-toolbar--toggle">
          <button
            className={writingSelectionMode ? 'is-active' : ''}
            aria-pressed={writingSelectionMode}
            title="选择多个正文段落后统一删除"
            onClick={() => setWritingSelectionMode(!writingSelectionMode)}
          >
            {writingSelectionMode ? '完成多选' : '多选段落'}
          </button>
        </div>
      ) : null}

      <div className="spacer" />

      <div className="toolbar__group toolbar__file-actions">
        <button className="icon-btn" title="撤销 ⌘Z" onClick={undo}>
          ↶
        </button>
        <button className="icon-btn" title="重做 ⇧⌘Z" onClick={redo}>
          ↷
        </button>
        <button className="btn btn--ghost" onClick={() => commands.save(false)}>
          保存
        </button>
        <div className="menu-wrap">
          <button className="btn btn--ghost" onClick={() => setMenu(menu === 'file' ? null : 'file')}>
            文件 ▾
          </button>
          {menu === 'file' ? (
            <div className="menu">
              <Item label="新建剧本" onClick={() => { commands.newFile(); setMenu(null); }} />
              <Item label="打开…" onClick={() => { commands.open(); setMenu(null); }} />
              <Item label="另存为…" onClick={() => { commands.save(true); setMenu(null); }} />
              <div className="menu__sep" />
              <Item label="导入文本 / FDX…" onClick={() => { commands.importAny(); setMenu(null); }} />
              <div className="menu__sep" />
              <Item label="导出创作版 PDF（原位卡片）…" onClick={() => { commands.exportPdf('creative'); setMenu(null); }} />
              <Item label="导出 A4 纯文本 PDF…" onClick={() => { commands.exportPdf('print'); setMenu(null); }} />
              <Item label="导出 Final Draft (FDX)…" onClick={() => { commands.exportAs('fdx'); setMenu(null); }} />
              <Item label="导出纯文本…" onClick={() => { commands.exportAs('txt'); setMenu(null); }} />
              <Item label="导出 Markdown…" onClick={() => { commands.exportAs('md'); setMenu(null); }} />
              <Item label="导出网页 HTML…" onClick={() => { commands.exportAs('html'); setMenu(null); }} />
              <div className="menu__sep" />
              <Item label="标题页…" onClick={() => { onOpenTitle(); setMenu(null); }} />
            </div>
          ) : null}
        </div>
        <button className="btn btn--ghost" onClick={onOpenSettings}>
          设置
        </button>
      </div>
    </div>
  );
}

function Item({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="menu__item" onClick={onClick}>
      {label}
    </button>
  );
}
