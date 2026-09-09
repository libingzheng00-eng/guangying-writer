import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { usePagination } from '../hooks/PaginationProvider';
import { EditableBlock } from './ScriptBlock';
import { ProgressBar } from './ProgressBar';
import { caretOffset, splitHtml, domLength, setCaret } from '../utils/dom';
import { isBlank, plain, stripSceneNumber } from '../utils/text';
import { nextTypeOnEnter, nextTypeOnTab, groupDual, recognizeType, shouldShowContdSuffix, CONTD_SUFFIX } from '../model/flow';
import { characterNames, sceneHeadings, deriveScenes } from '../model/project';
import { COMMON_SHOTS, COMMON_TRANSITIONS, fontStackOf } from '../model/elements';
import type { ScriptElement, ElementType } from '../model/types';

interface SuggestState {
  id: string;
  items: string[];
  active: number;
  top: number;
  left: number;
}

export function Editor() {
  const project = useStore((s) => s.project);
  const activeId = useStore((s) => s.activeId);
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
  const moveBeat = useStore((s) => s.moveBeat);
  const deleteBeat = useStore((s) => s.deleteBeat);
  const { breaks, lineHeightPx, contentWidthPx } = usePagination();

  const refs = useRef(new Map<string, HTMLDivElement>());
  const composingRef = useRef(false);
  /** ⌘⇧N 备忘切换：记住每个元素上一次的非备忘类型，便于从 note 切回 */
  const noteMemoryRef = useRef(new Map<string, ElementType>());
  const [suggest, setSuggest] = useState<SuggestState | null>(null);
  const [showSoundCards, setShowSoundCards] = useState(true);
  const [showImageCards, setShowImageCards] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const selectMode = useStore((s) => s.writingSelectionMode);
  const writingIds = useStore((s) => s.writingSelectedIds);
  const setWritingSelectionMode = useStore((s) => s.setWritingSelectionMode);
  const setWritingSelectedIds = useStore((s) => s.setWritingSelectedIds);
  const toggleWritingSelection = useStore((s) => s.toggleWritingSelection);
  const clearWritingSelection = useStore((s) => s.clearWritingSelection);
  const deleteWritingElements = useStore((s) => s.deleteWritingElements);
  const selectionAnchor = useRef<string | null>(null);
  const deleteWritingSelection = () => {
    deleteWritingElements(writingIds);
  };
  useEffect(() => {
    setWritingSelectionMode(false);
    clearWritingSelection();
  }, [project.id, setWritingSelectionMode, clearWritingSelection]);
  // 退出多选后必须丢弃范围锚点；否则下次 Shift 点击会意外跨到上一次的段落。
  useEffect(() => {
    if (!selectMode) selectionAnchor.current = null;
  }, [selectMode]);

  // 仅发送轻量 UI 信号；不改变 React state，避免每次按键让整个编辑器重绘。
  const markTyping = useCallback(() => {
    window.dispatchEvent(new Event('mochang:typing'));
  }, []);

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
  // 多选模式下每个段落都会读取序号；预先建索引，避免长剧本渲染退化为 O(n²)。
  const elementIndex = useMemo(
    () => new Map(project.elements.map((element, index) => [element.id, index])),
    [project.elements],
  );

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
      if (!node) {
        setSuggest(null);
        return;
      }
      const nb = node.getBoundingClientRect();
      // 建议框固定在正在编辑的输入行旁，而非以稿纸左上角为原点。
      // 旧实现混用了两个坐标系，因此会漂到左侧很远的位置。
      const menuWidth = 250;
      setSuggest({
        id: el.id,
        items: list,
        active: 0,
        top: Math.max(8, Math.min(window.innerHeight - 38, nb.top - 2)),
        left: Math.max(8, Math.min(window.innerWidth - menuWidth - 8, nb.right + 10)),
      });
    },
    [project],
  );

  const acceptSuggest = useCallback((advance = false, index?: number) => {
    const state = suggest;
    if (!state) return;
    const value = state.items[index ?? state.active];
    if (!value) return;
    const node = refs.current.get(state.id);
    // contentEditable 在焦点内不会自动由外部 state 回写；先同步 DOM，鼠标点击也能立即看到结果。
    if (node) node.innerHTML = value;
    setSuggest(null);
    if (advance) {
      const current = useStore.getState().project.elements.find((item) => item.id === state.id);
      if (current) {
        splitBlock(state.id, value, '', nextTypeOnEnter({ ...current, text: value }, false));
        return;
      }
    }
    setText(state.id, value);
    if (node) setCaret(node, 'end');
    requestFocus(state.id, 'end');
  }, [suggest, setText, splitBlock, requestFocus]);

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

      if (suggest && e.key === 'Enter' && suggest.items.length) {
        e.preventDefault();
        // 场次 / 人物等自动补全用 Enter 确认后直接进入符合剧本节奏的下一元素。
        acceptSuggest(true);
        return;
      }
      if (suggest && e.key === ' ' && suggest.items.length) {
        e.preventDefault();
        // 空格只确认候选，不生成新行。Tab 固定留给元素类型循环，避免写作时快捷键失效。
        acceptSuggest(false);
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
        const caret = caretOffset(node);
        const next = nextTypeOnTab(el.type, e.shiftKey);
        const keepDual = el.dual && ['character', 'parenthetical', 'dialogue'].includes(next);
        setType(el.id, next);
        if (keepDual) {
          useStore.getState().setDual(el.id, el.dual!);
        }
        /*
         * 写作红线：Tab 只能在当前段落循环元素类型，焦点绝不能进入界面按钮链。
         * scene_heading 会切换场号包装结构并重建 contentEditable 根节点，因此必须在
         * state 更新后明确恢复同一元素和原光标位置。删除此处会导致第 9 次 Tab 跑到缩放按钮。
         */
        requestFocus(el.id, caret < 0 ? 'end' : caret);
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
      markTyping();
      let value = html;
      if (project.settings.smartQuotes && el.type === 'dialogue') {
        value = value.replace(/"/g, (_match, i) => (i % 2 === 0 ? '“' : '”'));
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
    [project.settings.smartQuotes, markTyping, setText, setType, updateSuggest],
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

  const writingSounds = project.beats.filter((b) => (b.kind || 'beat') === 'sound');
  const writingImages = project.beats.filter((b) => (b.kind || 'beat') === 'wimg');
  const addWritingMaterial = (kind: 'sound' | 'wimg') => {
    const count = kind === 'sound' ? writingSounds.length : writingImages.length;
    const x = Math.max(24, (scrollRef.current?.clientWidth || 980) - 274);
    const y = 84 + count * 24 + (kind === 'wimg' ? 120 : 0);
    const id = addBeat(x, y, '', kind);
    if (kind === 'wimg') {
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
  };

  return (
    <div className="editor" ref={scrollRef} onKeyDownCapture={(e) => {
      if (!selectMode || (e.target as HTMLElement).closest('input:not([type="checkbox"]), textarea')) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault(); e.stopPropagation(); deleteWritingSelection();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault(); e.stopPropagation(); setWritingSelectedIds(project.elements.map((el) => el.id));
      } else if (e.key === 'Escape') { setWritingSelectionMode(false); }
    }}>
      <ProgressBar>
        <MaterialControls
          soundCount={writingSounds.length}
          imageCount={writingImages.length}
          showSound={showSoundCards}
          showImages={showImageCards}
          onToggleSound={() => setShowSoundCards((v) => !v)}
          onToggleImages={() => setShowImageCards((v) => !v)}
          onAddSound={() => addWritingMaterial('sound')}
          onAddImage={() => addWritingMaterial('wimg')}
        />
      </ProgressBar>
      <div className="editor__scroll">
        <WritingMaterialCards cards={writingSounds} kind="sound" visible={showSoundCards} onUpdate={updateBeat} onMove={moveBeat} onDelete={deleteBeat} />
        <WritingMaterialCards cards={writingImages} kind="wimg" visible={showImageCards} onUpdate={updateBeat} onMove={moveBeat} onDelete={deleteBeat} />
        {settings.indent && project.titlePage.show ? <TitlePageCard /> : null}
        <div className="script-flow" ref={contentRef} style={columnStyle}>
          {items.map((item, i) => {
            const list = Array.isArray(item) ? item : [item];
            const firstEl = list[0];
            const isBreak = list.some((e) => breakSet.has(project.elements.indexOf(e)));
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
        <div className="smarttype" style={{ top: suggest.top, left: suggest.left }} role="listbox" aria-label="快捷输入候选">
          {suggest.items.map((s, i) => (
            <button
              type="button"
              key={s}
              className={`smarttype__item ${i === suggest.active ? 'is-active' : ''}`}
              role="option"
              aria-selected={i === suggest.active}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptSuggest(false, i);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  function renderBlock(el: ScriptElement, half: boolean) {
    const isScene = el.type === 'scene_heading';
    const contdSuffix = el.type === 'character' && shouldShowContdSuffix(project, el) ? CONTD_SUFFIX : undefined;
    return (
      <div key={el.id} className={selectMode ? 'writing-select-row' : undefined}>
      {selectMode && <input type="checkbox" aria-label={`选择第 ${(elementIndex.get(el.id) ?? 0) + 1} 段`} checked={writingIds.includes(el.id)} onChange={() => {}} onClick={(e) => {
        const anchor = elementIndex.get(selectionAnchor.current || '') ?? -1;
        const index = elementIndex.get(el.id) ?? -1;
        if (e.shiftKey && anchor >= 0) {
          const range = project.elements.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((item) => item.id);
          setWritingSelectedIds([...writingIds, ...range]);
        } else {
          toggleWritingSelection(el.id);
          selectionAnchor.current = el.id;
        }
      }} />}
      <EditableBlock
        key={el.id}
        readOnly={selectMode}
        el={el}
        settings={settings}
        half={half}
        selected={selectMode ? writingIds.includes(el.id) : activeId === el.id}
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
      </div>
    );
  }
}

function MaterialControls({
  soundCount, imageCount, showSound, showImages, onToggleSound, onToggleImages, onAddSound, onAddImage,
}: {
  soundCount: number; imageCount: number; showSound: boolean; showImages: boolean;
  onToggleSound: () => void; onToggleImages: () => void; onAddSound: () => void; onAddImage: () => void;
}) {
  return (
    <span className="writing-material-controls" aria-label="写作素材">
      <span className="writing-material-controls__group">
        <button type="button" aria-label="显示或隐藏声音卡" aria-pressed={showSound} title={showSound ? '暂时隐藏声音卡' : '显示声音卡'} onClick={onToggleSound}>◌ <b>{soundCount}</b></button>
        <button type="button" aria-label="新建声音卡" title="新建声音卡" onClick={onAddSound}>＋</button>
      </span>
      <span className="writing-material-controls__group">
        <button type="button" aria-label="显示或隐藏图片卡" aria-pressed={showImages} title={showImages ? '暂时隐藏图片卡' : '显示图片卡'} onClick={onToggleImages}>▣ <b>{imageCount}</b></button>
        <button type="button" aria-label="新建图片卡" title="新建图片卡" onClick={onAddImage}>＋</button>
      </span>
    </span>
  );
}

function WritingMaterialCards({ cards, kind, visible, onUpdate, onMove, onDelete }: {
  cards: Array<{ id: string; x: number; y: number; text: string; title?: string; img?: string }>;
  kind: 'sound' | 'wimg'; visible: boolean;
  onUpdate: (id: string, patch: { title?: string; text?: string }) => void;
  onMove: (id: string, x: number, y: number) => void;
  onDelete: (id: string) => void;
}) {
  const dragRef = useRef<{ id: string; x: number; y: number; startX: number; startY: number } | null>(null);
  const image = kind === 'wimg';
  const onPointerDown = (event: React.PointerEvent<HTMLElement>, card: { id: string; x: number; y: number }) => {
    if ((event.target as HTMLElement).closest('input, textarea, button')) return;
    dragRef.current = { id: card.id, x: card.x, y: card.y, startX: event.clientX, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    onMove(drag.id, Math.max(16, Math.round(drag.x + event.clientX - drag.startX)), Math.max(76, Math.round(drag.y + event.clientY - drag.startY)));
  };
  const stopDrag = () => { dragRef.current = null; };
  return (
    <div className={'writing-material-layer' + (image ? ' writing-material-layer--image' : '') + (visible ? '' : ' is-hidden')} aria-hidden={!visible}>
      {cards.map((card) => (
        <article key={card.id} className={'writing-material-card' + (image ? ' writing-material-card--image' : '')} style={{ left: card.x, top: card.y }} onPointerDown={(e) => onPointerDown(e, card)} onPointerMove={onPointerMove} onPointerUp={stopDrag}>
          <header className="writing-material-card__head">
            <span className="writing-material-card__kind" aria-hidden>{image ? '▣' : '◌'}</span>
            <input value={card.title || ''} placeholder={image ? '图片批注' : '声音设计'} aria-label={image ? '图片卡标题' : '声音卡标题'} onChange={(e) => onUpdate(card.id, image ? { title: e.target.value } : { title: e.target.value, text: e.target.value })} />
            <span className="writing-material-card__drag" title="拖动卡片" aria-hidden>⠿</span>
            <button type="button" title={image ? '删除这张图片卡' : '删除这张声音卡'} aria-label={image ? '删除这张图片卡' : '删除这张声音卡'} onClick={() => onDelete(card.id)}>×</button>
          </header>
          {image ? (card.img ? <img src={card.img} alt={card.title || '图片卡'} draggable={false} /> : <div className="writing-material-card__empty">等待导入图片</div>) : <textarea value={card.text} placeholder="声音、环境、节奏或情绪提示…" aria-label="声音卡内容" onChange={(e) => onUpdate(card.id, { text: e.target.value })} />}
        </article>
      ))}
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
