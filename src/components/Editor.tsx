import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { usePagination } from '../hooks/PaginationProvider';
import { EditableBlock } from './ScriptBlock';
import { ProgressBar } from './ProgressBar';
import { caretOffset, splitHtml, domLength } from '../utils/dom';
import { isBlank, plain, stripSceneNumber } from '../utils/text';
import { nextTypeOnEnter, nextTypeOnTab, groupDual, recognizeType, shouldShowContdSuffix, CONTD_SUFFIX } from '../model/flow';
import { characterNames, sceneHeadings, deriveScenes } from '../model/project';
import { COMMON_SHOTS, COMMON_TRANSITIONS, fontStackOf } from '../model/elements';
import type { ScriptElement, ElementType } from '../model/types';

interface SuggestState {
  id: string;
  items: string[];
  active: number;
  prefix: string;
  top: number;
  left: number;
}

export function Editor() {
  const project = useStore((s) => s.project);
  const version = useStore((s) => s.version);
  const activeId = useStore((s) => s.activeId);
  const focus = useStore((s) => s.focus);
  const zoom = useStore((s) => s.zoom);
  const setActive = useStore((s) => s.setActive);
  const setText = useStore((s) => s.setText);
  const setType = useStore((s) => s.setType);
  const splitBlock = useStore((s) => s.splitBlock);
  const insertAfter = useStore((s) => s.insertAfter);
  const removeElement = useStore((s) => s.removeElement);
  const mergeIntoPrevious = useStore((s) => s.mergeIntoPrevious);
  const requestFocus = useStore((s) => s.requestFocus);
  const addBeat = useStore((s) => s.addBeat);
  const updateBeat = useStore((s) => s.updateBeat);
  const deleteBeat = useStore((s) => s.deleteBeat);
  const { breaks, lineHeightPx, contentWidthPx } = usePagination();

  const refs = useRef(new Map<string, HTMLDivElement>());
  const composingRef = useRef(false);
  /** ⌘⇧N 备忘切换：记住每个元素上一次的非备忘类型，便于从 note 切回 */
  const noteMemoryRef = useRef(new Map<string, ElementType>());
  const [suggest, setSuggest] = useState<SuggestState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const revMap = useMemo(() => {
    const m: Record<string, string> = {};
    project.revisions.forEach((r) => {
      m[r.id] = r.color;
    });
    return m;
  }, [project.revisions]);

  const sceneNo = useMemo(() => {
    const m: Record<string, string> = {};
    deriveScenes(project).forEach((s) => {
      m[s.elementId] = s.number;
    });
    return m;
  }, [project]);

  const breakSet = useMemo(() => new Set(breaks), [breaks]);

  const items = useMemo(() => groupDual(project.elements), [project.elements]);

  const showSceneNumber = (side: 'left' | 'right') =>
    project.settings.sceneNumber === side || project.settings.sceneNumber === 'both';

  /* ------------------------- 自动续打 ------------------------- */
  const updateSuggest = useCallback(
    (el: ScriptElement) => {
      const text = plain(el.text);
      if (composingRef.current || !text.trim()) {
        setSuggest(null);
        return;
      }
      let pool: string[] = [];
      if (el.type === 'character') pool = characterNames(project);
      else if (el.type === 'scene_heading') pool = sceneHeadings(project);
      else if (el.type === 'transition') pool = COMMON_TRANSITIONS;
      else if (el.type === 'shot') pool = COMMON_SHOTS;
      else {
        setSuggest(null);
        return;
      }
      const lower = text.trim();
      const list = pool.filter((n) => n !== lower && n.startsWith(lower)).slice(0, 8);
      if (!list.length) {
        setSuggest(null);
        return;
      }
      const node = refs.current.get(el.id);
      const container = contentRef.current;
      if (!node || !container) {
        setSuggest(null);
        return;
      }
      const nb = node.getBoundingClientRect();
      const cb = container.getBoundingClientRect();
      setSuggest({
        id: el.id,
        items: list,
        active: 0,
        prefix: lower,
        top: nb.bottom - cb.top + 2,
        left: nb.left - cb.left,
      });
    },
    [project],
  );

  const acceptSuggest = useCallback(() => {
    if (!suggest) return;
    const value = suggest.items[suggest.active];
    if (!value) return;
    setText(suggest.id, value);
    setSuggest(null);
    const node = refs.current.get(suggest.id);
    if (node) requestFocus(suggest.id, 'end');
  }, [suggest, setText, requestFocus]);

  const moveFocus = useCallback(
    (dir: -1 | 1, caret: 'start' | 'end') => {
      const id = useStore.getState().activeId;
      const els = useStore.getState().project.elements;
      const idx = els.findIndex((e) => e.id === id);
      const target = els[idx + dir];
      if (target) requestFocus(target.id, caret);
    },
    [requestFocus],
  );

  /* ------------------------- 键盘处理 ------------------------- */
  const handleKeyDown = useCallback(
    (el: ScriptElement, e: React.KeyboardEvent<HTMLDivElement>) => {
      const node = e.currentTarget as HTMLDivElement;
      // 输入法组合中不做任何拦截
      if (e.nativeEvent.isComposing || composingRef.current) return;

      if (suggest && (e.key === 'Enter' || e.key === 'Tab') && suggest.items.length) {
        e.preventDefault();
        acceptSuggest();
        return;
      }
      if (suggest && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        setSuggest((s) =>
          s ? { ...s, active: (s.active + (e.key === 'ArrowDown' ? 1 : -1) + s.items.length) % s.items.length } : s,
        );
        return;
      }
      if (e.key === 'Escape') {
        setSuggest(null);
        node.blur();
        return;
      }

      const meta = e.metaKey || e.ctrlKey;

      if (meta && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        try {
          document.execCommand('styleWithCSS', false, 'false');
          document.execCommand(e.key.toLowerCase() === 'b' ? 'bold' : e.key.toLowerCase() === 'i' ? 'italic' : 'underline');
        } catch {
          /* ignore */
        }
        setText(el.id, node.innerHTML);
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey && !meta) {
        e.preventDefault();
        const html = node.innerHTML;
        const off = caretOffset(node);
        const at = off < 0 ? domLength(node) : off;
        const { before, after } = splitHtml(node, at);
        const isEmpty = isBlank(before) && isBlank(after);
        let nextType = nextTypeOnEnter(el, isEmpty);
        // 人物行为空按回车 → 转为动作，避免产生空对白
        if (isEmpty && (el.type === 'character' || el.type === 'dialogue' || el.type === 'parenthetical')) {
          nextType = 'action';
        }
        setSuggest(null);
        splitBlock(el.id, before, after, nextType);
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        const next = nextTypeOnTab(el.type, e.shiftKey);
        const keepDual = el.dual && ['character', 'parenthetical', 'dialogue'].includes(next);
        setType(el.id, next);
        if (keepDual) {
          useStore.getState().setDual(el.id, el.dual!);
        }
        return;
      }

      // ⌘/Ctrl+Shift+N：备忘切换。在「备忘」与上一次非备忘类型之间来回切换。
      if (meta && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
        e.preventDefault();
        if (el.type === 'note') {
          const fallback = noteMemoryRef.current.get(el.id) || 'action';
          setType(el.id, fallback);
          noteMemoryRef.current.set(el.id, fallback);
        } else {
          noteMemoryRef.current.set(el.id, el.type);
          setType(el.id, 'note');
        }
        return;
      }

      // ⌘/Ctrl+A：选中脚本流内的全部内容。
      if (meta && (e.key === 'a' || e.key === 'A') && !e.shiftKey) {
        e.preventDefault();
        const flow = contentRef.current;
        if (flow) {
          const range = document.createRange();
          range.selectNodeContents(flow);
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
        return;
      }

      if (e.key === 'Backspace') {
        const off = caretOffset(node);
        const sel = window.getSelection();
        if (off === 0 && sel && sel.isCollapsed) {
          e.preventDefault();
          if (el.type !== 'action' && el.type !== 'general') {
            setType(el.id, 'action');
            return;
          }
          const idx = project.elements.findIndex((x) => x.id === el.id);
          if (idx <= 0) return;
          mergeIntoPrevious(el.id);
        }
        return;
      }

      if (e.key === 'Delete') {
        const off = caretOffset(node);
        const sel = window.getSelection();
        if (off >= domLength(node) && sel && sel.isCollapsed) {
          const idx = project.elements.findIndex((x) => x.id === el.id);
          const next = project.elements[idx + 1];
          if (next) {
            e.preventDefault();
            const text = plain(el.text) + plain(next.text);
            setText(el.id, text);
            removeElement(next.id);
          }
        }
        return;
      }

      const lineIndex = () => {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return 0;
        const range = sel.getRangeAt(0).cloneRange();
        range.collapse(true);
        let rect = range.getClientRects()[0];
        if (!rect) {
          const span = document.createElement('span');
          span.appendChild(document.createTextNode('\u200b'));
          range.insertNode(span);
          rect = span.getClientRects()[0];
          span.remove();
        }
        const nodeRect = node.getBoundingClientRect();
        if (!rect) return 0;
        return Math.round((rect.top - nodeRect.top) / Math.max(1, lineHeightPx));
      };
      const lastLine = () => Math.max(0, Math.round(node.offsetHeight / Math.max(1, lineHeightPx)) - 1);

      if (meta && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        moveFocus(e.key === 'ArrowUp' ? -1 : 1, 'end');
        return;
      }

      if (e.key === 'ArrowUp' && !meta) {
        if (lineIndex() <= 0) {
          e.preventDefault();
          moveFocus(-1, 'end');
        }
        return;
      }
      if (e.key === 'ArrowDown' && !meta) {
        if (lineIndex() >= lastLine()) {
          e.preventDefault();
          moveFocus(1, 'start');
        }
        return;
      }
      if (e.key === 'ArrowLeft') {
        const off = caretOffset(node);
        if (off === 0) {
          e.preventDefault();
          moveFocus(-1, 'end');
        }
        return;
      }
      if (e.key === 'ArrowRight') {
        const off = caretOffset(node);
        if (off >= domLength(node)) {
          e.preventDefault();
          moveFocus(1, 'start');
        }
      }
    },
    [project, suggest, acceptSuggest, setText, setType, splitBlock, mergeIntoPrevious, removeElement, lineHeightPx, moveFocus],
  );

  const handleInput = useCallback(
    (el: ScriptElement, html: string) => {
      let value = html;
      if (project.settings.smartQuotes && el.type === 'dialogue') {
        value = value.replace(/"/g, (m, i) => (i % 2 === 0 ? '“' : '”'));
      }
      // Final Draft 风格的智能识别：仅在「之前为空 + 新文本非空 + 识别命中」时改类型，避免误判后续编辑。
      const previous = useStore.getState().project.elements.find((e) => e.id === el.id);
      const wasEmpty = previous ? isBlank(previous.text) : isBlank(el.text);
      const trimmedNew = plain(value).trim();
      if (wasEmpty && trimmedNew && previous && previous.type !== 'note') {
        const recognized = recognizeType(trimmedNew);
        if (recognized && recognized !== previous.type) {
          setType(previous.id, recognized);
        }
      }
      setText(el.id, value);
      updateSuggest({ ...el, text: value });
    },
    [project.settings.smartQuotes, setText, setType, updateSuggest],
  );

  const handlePaste = useCallback(
    (el: ScriptElement, e: React.ClipboardEvent<HTMLDivElement>) => {
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      const html = plain(text)
        .split('\n')
        .map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .join('<br>');
      document.execCommand('insertHTML', false, html);
      setText(el.id, (e.currentTarget as HTMLDivElement).innerHTML);
    },
    [setText],
  );

  /* 首次进入自动聚焦 */
  useEffect(() => {
    if (!activeId && project.elements.length) setActive(project.elements[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settings = project.settings;
  const columnStyle: React.CSSProperties = {
    width: `${Math.round(contentWidthPx * zoom)}px`,
    fontFamily: fontStackOf(settings.fontKey),
    fontSize: `${settings.fontSize * zoom}pt`,
    lineHeight: settings.lineHeight,
  };

  return (
    <div className="editor" ref={scrollRef}>
      <div className="editor__scroll">
        <div className="writing-tools">
          <ProgressBar />
          <MaterialPanel
            beats={project.beats}
            onAdd={(kind) => {
              const id = addBeat(0, 0, '', kind);
              if (kind === 'image' || kind === 'wimg') {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = () => {
                  const f = input.files && input.files[0];
                  if (!f) return;
                  const rd = new FileReader();
                  rd.onload = () => updateBeat(id, { img: String(rd.result || '') });
                  rd.readAsDataURL(f);
                };
                input.click();
              }
              return id;
            }}
            onUpdate={updateBeat}
            onDelete={deleteBeat}
          />
        </div>
        {settings.indent && project.titlePage.show ? <TitlePageCard /> : null}
        <div className="script-flow" ref={contentRef} style={columnStyle}>
          {items.map((item, i) => {
            const list = Array.isArray(item) ? item : [item];
            const firstEl = list[0];
            const isBreak = list.some((e) => breakSet.has(project.elements.indexOf(e)));
            const revColor = settings.revisionMode
              ? list.map((e) => (e.rev ? revMap[e.rev] : null)).filter(Boolean)[0] || null
              : null;
            return (
              <React.Fragment key={firstEl.id}>
                {isBreak && i > 0 ? <div className="page-break-line" /> : null}
                {Array.isArray(item) ? (
                  <div className="sc-dual-row">
                    <div className="sc-dual-col">
                      {item
                        .filter((e) => (e.dual || 'left') === 'left')
                        .map((e) => renderBlock(e, true))}
                    </div>
                    <div className="sc-dual-col">
                      {item
                        .filter((e) => (e.dual || 'left') === 'right')
                        .map((e) => renderBlock(e, true))}
                    </div>
                  </div>
                ) : (
                  renderBlock(firstEl, false)
                )}
              </React.Fragment>
            );
          })}
          <div className="script-flow__tail" onClick={() => insertAfter(null, 'action')} />
        </div>
      </div>
      {suggest ? (
        <div className="smarttype" style={{ top: suggest.top, left: suggest.left }}>
          {suggest.items.map((s, i) => (
            <div
              key={s}
              className={`smarttype__item ${i === suggest.active ? 'is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                setSuggest({ ...suggest, active: i });
                setText(suggest.id, s);
                setSuggest(null);
                requestFocus(suggest.id, 'end');
              }}
            >
              {s}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  function renderBlock(el: ScriptElement, half: boolean) {
    const isScene = el.type === 'scene_heading';
    const contdSuffix = el.type === 'character' && shouldShowContdSuffix(project, el) ? CONTD_SUFFIX : undefined;
    return (
      <EditableBlock
        key={el.id}
        el={el}
        settings={settings}
        half={half}
        selected={activeId === el.id}
        revColor={settings.revisionMode && el.rev ? revMap[el.rev] : undefined}
        sceneNumber={
          isScene && project.settings.autoNumberScenes
            ? {
                left: showSceneNumber('left') ? sceneNo[el.id] : undefined,
                right: showSceneNumber('right') ? sceneNo[el.id] : undefined,
              }
            : undefined
        }
        contdSuffix={contdSuffix}
        innerRef={(n) => {
          if (n) refs.current.set(el.id, n);
          else refs.current.delete(el.id);
        }}
        onInput={(html) => handleInput(el, html)}
        onKeyDown={(e) => handleKeyDown(el, e)}
        onFocus={() => {
          setActive(el.id);
          if (suggest && suggest.id !== el.id) setSuggest(null);
        }}
        onPaste={(e) => handlePaste(el, e)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          const node = refs.current.get(el.id);
          if (node) {
            setText(el.id, node.innerHTML);
            updateSuggest({ ...el, text: node.innerHTML });
          }
        }}
        onBlur={() => {
          setTimeout(() => setSuggest(null), 120);
          if (el.type === 'scene_heading' && project.settings.autoNumberScenes) {
            const stripped = stripSceneNumber(plain(el.text));
            if (stripped !== plain(el.text)) setText(el.id, stripped);
          }
        }}
      />
    );
  }
}

interface MaterialPanelProps {
  beats: typeof useStore extends never ? never : any;
  onAdd: (kind: 'sound' | 'image' | 'wimg') => string;
  onUpdate: (id: string, patch: any) => void;
  onDelete: (id: string) => void;
}

function MaterialPanel(props: MaterialPanelProps) {
  const { beats, onAdd, onUpdate, onDelete } = props;
  const sounds = beats.filter((b: any) => (b.kind || 'beat') === 'sound');
  const wimgs = beats.filter((b: any) => (b.kind || 'beat') === 'wimg');
  const total = sounds.length + wimgs.length;
  if (total === 0) {
    return (
      <div className="material-panel" data-empty="true">
        <div className="material-panel__head">
          <span className="material-panel__title">素材</span>
          <span className="material-panel__hint">声音与写作图片归入此处，不计入正文页数。</span>
        </div>
        <div className="material-panel__actions">
          <button className="btn btn--ghost" onClick={() => onAdd('sound')}>＋ 声音</button>
          <button className="btn btn--ghost" onClick={() => onAdd('wimg')}>＋ 写作图片</button>
        </div>
      </div>
    );
  }
  return (
    <div className="material-panel">
      <div className="material-panel__head">
        <span className="material-panel__title">素材</span>
        <span className="material-panel__count">{sounds.length} 声音 · {wimgs.length} 写作图片</span>
        <div className="material-panel__actions">
          <button className="btn btn--ghost" onClick={() => onAdd('sound')}>＋ 声音</button>
          <button className="btn btn--ghost" onClick={() => onAdd('wimg')}>＋ 写作图片</button>
        </div>
      </div>
      {sounds.length ? (
        <div className="material-panel__section">
          <h4>声音卡</h4>
          <ul className="material-panel__list">
            {sounds.map((b: any) => (
              <li key={b.id} className="material-panel__item material-panel__item--sound">
                <span className="material-panel__icon" aria-hidden>♪</span>
                <input
                  className="material-panel__title-input"
                  value={b.title || b.text}
                  placeholder="声音标题"
                  onChange={(e) => onUpdate(b.id, { title: e.target.value, text: e.target.value })}
                />
                <button className="material-panel__del" title="删除" onClick={() => onDelete(b.id)}>×</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {wimgs.length ? (
        <div className="material-panel__section">
          <h4>写作图片</h4>
          <ul className="material-panel__list">
            {wimgs.map((b: any) => (
              <li key={b.id} className="material-panel__item material-panel__item--wimg">
                {b.img ? <img className="material-panel__thumb" src={b.img} alt={b.title || '写作图片'} /> : <span className="material-panel__thumb material-panel__thumb--empty" aria-hidden>图</span>}
                <input
                  className="material-panel__title-input"
                  value={b.title || ''}
                  placeholder="图片名称"
                  onChange={(e) => onUpdate(b.id, { title: e.target.value })}
                />
                <button className="material-panel__del" title="删除" onClick={() => onDelete(b.id)}>×</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function TitlePageCard() {
  const tp = useStore((s) => s.project.titlePage);
  const setView = useStore((s) => s.setView);
  return (
    <div className="titlepage-card" onDoubleClick={() => setView('preview')}>
      <div className="titlepage-card__title">{tp.title || '（未命名）'}</div>
      {tp.subtitle ? <div className="titlepage-card__sub">{tp.subtitle}</div> : null}
      <div className="titlepage-card__meta">
        {tp.author ? <span>编剧：{tp.author}</span> : null}
        {tp.version ? <span>{tp.version}</span> : null}
        {tp.date ? <span>{tp.date}</span> : null}
      </div>
      <div className="titlepage-card__hint">双击预览</div>
    </div>
  );
}
