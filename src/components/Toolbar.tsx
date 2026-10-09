import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useStore, type ViewMode } from '../store/store';
import { ELEMENT_META, ELEMENT_ORDER } from '../model/elements';
import type { ElementType } from '../model/types';
import type { useCommands } from '../app/useCommands';
import { runEditHistory } from '../utils/editHistory';
import { safeDisplayColor } from '../utils/displayValues';

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: 'write', label: '写作' },
  { key: 'cards', label: '故事板' },
  { key: 'board', label: '自由板' },
  { key: 'preview', label: '预览' },
  { key: 'reports', label: '统计' },
];

export function Toolbar({ commands, onOpenSettings, onOpenTitle, onOpenHome, onOpenReview, modalOpen = false }: { commands: ReturnType<typeof useCommands>; onOpenSettings: () => void; onOpenTitle: () => void; onOpenHome?: () => void; onOpenReview?: () => void; modalOpen?: boolean }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const project = useStore((s) => s.project);
  const documentEpoch = useStore((s) => s.documentEpoch);
  const activeId = useStore((s) => s.activeId);
  const activeRev = useStore((s) => s.activeRev);
  const setRevision = useStore((s) => s.setRevision);
  const toggleOmit = useStore((s) => s.toggleOmit);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const undo = () => runEditHistory('undo');
  const redo = () => runEditHistory('redo');
  const dirty = useStore((s) => s.dirty);
  const filePath = useStore((s) => s.filePath);
  const writingSelectionMode = useStore((s) => s.writingSelectionMode);
  const writingSelectedIds = useStore((s) => s.writingSelectedIds);
  const setWritingSelectionMode = useStore((s) => s.setWritingSelectionMode);
  const setWritingSelectedIds = useStore((s) => s.setWritingSelectedIds);
  const deleteWritingElements = useStore((s) => s.deleteWritingElements);
  const [menu, setMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuPopupRef = useRef<HTMLDivElement>(null);
  const menuFocusEdge = useRef<'first' | 'last'>('first');
  const menuId = useId();
  const menuOpen = menu === 'file' && !modalOpen;

  const activeEl = project.elements.find((e) => e.id === activeId) || null;
  const selecting = view === 'write' && writingSelectionMode;

  const closeMenu = (restoreFocus = false) => {
    setMenu(null);
    if (restoreFocus && !modalOpen) menuTriggerRef.current?.focus({ preventScroll: true });
  };
  const focusMenuEdge = (edge: 'first' | 'last') => {
    const items = menuPopupRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    if (items?.length) items[edge === 'first' ? 0 : items.length - 1].focus({ preventScroll: true });
  };
  const openMenu = (edge: 'first' | 'last' = 'first') => {
    if (modalOpen) return;
    menuFocusEdge.current = edge;
    if (menuOpen) focusMenuEdge(edge);
    else setMenu('file');
  };
  const runMenuAction = (action: () => unknown) => {
    // Establish a stable return target before a native dialog or modal takes focus.
    closeMenu(true);
    action();
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (menuOpen && composing) { event.stopPropagation(); return; }
    if (composing || event.altKey || event.ctrlKey || event.metaKey) return;
    // The closed trigger is a button too: Space must activate it rather than
    // start board panning, and Delete/L must never mutate a background card.
    // Keep native button activation and Tab defaults; app shortcuts may bubble.
    event.stopPropagation();
    if (!menuOpen) {
      if (event.target === menuTriggerRef.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault(); event.stopPropagation();
        openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeMenu(true);
    } else if (event.key === 'Tab') {
      // Keep native Tab navigation, starting from the stable trigger rather than
      // the menu item that will be unmounted. This does not trap toolbar focus.
      closeMenu(true);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const items = [...(menuPopupRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || [])];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : current < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[index]?.focus({ preventScroll: true });
    }
  };

  useLayoutEffect(() => {
    if (menuOpen) focusMenuEdge(menuFocusEdge.current);
  }, [menuOpen]);
  useEffect(() => {
    if (modalOpen) setMenu(null);
  }, [modalOpen]);
  useEffect(() => {
    // Native commands can switch pages or documents without a pointer/focus event.
    if (!modalOpen && menuPopupRef.current?.contains(document.activeElement)) menuTriggerRef.current?.focus({ preventScroll: true });
    setMenu(null);
  }, [view, documentEpoch]);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onBlur = () => setMenu(null);
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('focusin', onDoc, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('focusin', onDoc, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [menuOpen]);

  const fmt = (cmd: string) => {
    useStore.getState().breakHistoryGroup();
    try {
      document.execCommand('styleWithCSS', false, 'false');
      document.execCommand(cmd);
      const node = document.activeElement;
      if (node instanceof HTMLElement && node.matches('.sc-el--editable') && node.dataset.id) useStore.getState().setText(node.dataset.id, node.innerHTML);
    } catch {
      /* ignore */
    }
    useStore.getState().breakHistoryGroup();
  };

  return (
    <div className="toolbar" onClickCapture={(event) => {
      if (menuOpen && !menuRef.current?.contains(event.target as Node)) closeMenu();
    }}>
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
          <button disabled={!canUndo} title="撤销最近一次修改" onMouseDown={e => e.preventDefault()} onClick={undo}>撤销</button>
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
        <button className="icon-btn" title="加粗 ⌘/Ctrl+B" onMouseDown={e => e.preventDefault()} onClick={() => fmt('bold')}>
          <b>B</b>
        </button>
        <button className="icon-btn" title="斜体 ⌘/Ctrl+I" onMouseDown={e => e.preventDefault()} onClick={() => fmt('italic')}>
          <i>I</i>
        </button>
        <button className="icon-btn" title="下划线 ⌘/Ctrl+U" onMouseDown={e => e.preventDefault()} onClick={() => fmt('underline')}>
          <u>U</u>
        </button>
        <button className="icon-btn" title="插入新场景 ⌘/Ctrl+Enter" onClick={commands.insertScene}>
          ＋场
        </button>
        <button className="icon-btn" title="双列对白 ⌘/Ctrl+D" onClick={commands.makeDual}>
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
              style={{ backgroundColor: safeDisplayColor(r.color) }}
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
        {onOpenReview ? <button className="icon-btn toolbar__review" disabled={modalOpen} title="改稿工作台：版本、批注、暂存与交稿检查" onMouseDown={event => event.preventDefault()} onClick={onOpenReview}>改稿</button> : null}
        <button className="icon-btn" title="查找正文 ⌘/Ctrl+F" onClick={commands.openFind}>查找</button>
        <button className="icon-btn" disabled={!canUndo} title="撤销 ⌘/Ctrl+Z" onMouseDown={e => e.preventDefault()} onClick={undo}>
          ↶
        </button>
        <button className="icon-btn" disabled={!canRedo} title="重做 ⌘/Ctrl+Shift+Z" onMouseDown={e => e.preventDefault()} onClick={redo}>
          ↷
        </button>
        <button className="btn btn--ghost" onClick={() => commands.save(false)}>
          保存
        </button>
        <div className="menu-wrap" ref={menuRef} onKeyDown={onMenuKeyDown}>
          <button ref={menuTriggerRef} className="btn btn--ghost" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId}
            disabled={modalOpen} onClick={() => menuOpen ? closeMenu(true) : openMenu()}>
            文件 ▾
          </button>
          {menuOpen ? (
            <div className="menu" id={menuId} ref={menuPopupRef} role="menu" aria-label="文件">
              <Item label="新建剧本" onClick={() => runMenuAction(commands.newFile)} />
              <Item label="打开…" onClick={() => runMenuAction(commands.open)} />
              {onOpenHome ? <Item label="启动页 / 最近项目" onClick={() => runMenuAction(onOpenHome)} /> : null}
              <Item label="另存为…" onClick={() => runMenuAction(() => commands.save(true))} />
              <div className="menu__sep" role="separator" />
              <Item label="导入文本 / FDX…" onClick={() => runMenuAction(commands.importAny)} />
              <div className="menu__sep" role="separator" />
              <Item label="导出创作版 PDF（原位卡片）…" onClick={() => runMenuAction(() => commands.exportPdf('creative'))} />
              <Item label="导出 A4 纯文本 PDF…" onClick={() => runMenuAction(() => commands.exportPdf('print'))} />
              <Item label="导出 Final Draft (FDX)…" onClick={() => runMenuAction(() => commands.exportAs('fdx'))} />
              <Item label="导出纯文本…" onClick={() => runMenuAction(() => commands.exportAs('txt'))} />
              <Item label="导出 Markdown…" onClick={() => runMenuAction(() => commands.exportAs('md'))} />
              <Item label="导出网页 HTML…" onClick={() => runMenuAction(() => commands.exportAs('html'))} />
              <div className="menu__sep" role="separator" />
              <Item label="标题页…" onClick={() => runMenuAction(onOpenTitle)} />
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
    <button className="menu__item" role="menuitem" tabIndex={-1} onClick={onClick}>
      {label}
    </button>
  );
}
