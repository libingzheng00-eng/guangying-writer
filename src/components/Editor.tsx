import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { usePagination } from '../hooks/PaginationProvider';
import { EditableBlock } from './ScriptBlock';
import { ProgressBar } from './ProgressBar';
import { caretOffset, splitHtml, domLength, domText, makeTextRange, setCaret, offsetOf } from '../utils/dom';
import { applySmartDoubleQuotes } from '../utils/smartQuotes';
import { isBlank, plain, stripSceneNumber, escapeHtml } from '../utils/text';
import { readWritingSelection } from '../utils/writingSelection';
import { WRITING_CLIPBOARD_MIME, encodeWritingClipboard, decodeWritingClipboard, replaceClipboardRange, type ClipboardFocus } from '../utils/writingClipboard';
import { nextTypeOnEnter, nextTypeOnTab, groupDual, recognizeType, deriveWritingElements, CONTD_SUFFIX } from '../model/flow';
import { deriveScenes } from '../model/project';
import { fontStackOf } from '../model/elements';
import { createSmartTypeCatalogReader, getSmartTypeSuggestions, type SmartTypeCatalog, type SmartTypeSuggestion } from '../model/smarttype';
import { searchText } from '../model/search';
import type { ScriptElement, ElementType } from '../model/types';
import { safeEmbeddedImageSource } from '../utils/displayValues';

interface SuggestState {
  id: string;
  epoch: number;
  sourceHtml: string;
  catalog: SmartTypeCatalog;
  type: ElementType;
  sourceText: string;
  start: number;
  end: number;
  kind: string;
  items: SmartTypeSuggestion[];
  active: number;
  top: number;
  left: number;
}

/** A two-column DOM range can have a different order from the model. Never
 * normalize it into a broader deletion; reject and offer explicit block select.
 */
function writableRange(ids: readonly string[]): boolean {
  const elements = useStore.getState().project.elements;
  const start = elements.findIndex(element => element.id === ids[0]);
  return ids.length > 0 && new Set(ids).size === ids.length && start >= 0 &&
    ids.every((id, offset) => elements[start + offset]?.id === id);
}

const RANGE_RESELECT_MESSAGE = '当前选区与正文顺序不一致，请分栏选择或使用“多选段落”。';

export function Editor() {
  const project = useStore((s) => s.project);
  const activeId = useStore((s) => s.activeId);
  const zoom = useStore((s) => s.zoom);
  const setActive = useStore((s) => s.setActive);
  const setText = useStore((s) => s.setText);
  const setType = useStore((s) => s.setType);
  const splitBlock = useStore((s) => s.splitBlock);
  const insertAfter = useStore((s) => s.insertAfter);
  const mergeIntoPrevious = useStore((s) => s.mergeIntoPrevious);
  const requestFocus = useStore((s) => s.requestFocus);
  const addBeat = useStore((s) => s.addBeat);
  const updateBeat = useStore((s) => s.updateBeat);
  const moveBeat = useStore((s) => s.moveBeat);
  const deleteBeat = useStore((s) => s.deleteBeat);
  const notify = useStore((s) => s.notify);
  const pdfExportMode = useStore((s) => s.pdfExportMode);
  const version = useStore((s) => s.version);
  const documentEpoch = useStore((s) => s.documentEpoch);
  const { breaks, lineHeightPx, contentWidthPx, readyKey } = usePagination();

  const refs = useRef(new Map<string, HTMLDivElement>());
  const composingRef = useRef(false);
  const quoteCompositionRef = useRef<{ id: string; epoch: number; html: string; start: number; end: number } | null>(null);
  // 只追踪“从空动作段开始”的内外景前缀，不重新猜测已有正文或用户手选的类型。
  const sceneIntroInputRef = useRef(new Map<string, string>());
  const compositionEmptyActionRef = useRef(new Set<string>());
  // Cross-type suggestions belong to a live input session that began empty,
  // never an old paragraph, paste, split tail, or a document/undo snapshot.
  const intentInputRef = useRef<{ id: string; epoch: number; html: string; type: ElementType } | null>(null);
  const dismissedSuggestRef = useRef<{ id: string; epoch: number; html: string; type: ElementType } | null>(null);
  /** ⌘⇧N 备忘切换：记住每个元素上一次的非备忘类型，便于从 note 切回 */
  const noteMemoryRef = useRef(new Map<string, ElementType>());
  const [suggest, setSuggest] = useState<SuggestState | null>(null);
  useEffect(() => {
    // Element IDs may legitimately recur in another loaded/restored project.
    // Neither the old recognizer prefix nor a live completion session belongs
    // to that document. Keep all ephemeral input state inside its epoch.
    sceneIntroInputRef.current.clear();
    compositionEmptyActionRef.current.clear();
    intentInputRef.current = null;
    dismissedSuggestRef.current = null;
    setSuggest(null);
  }, [documentEpoch]);
  const readSmartTypeCatalog = useMemo(() => createSmartTypeCatalogReader(), []);
  const smartTypeCatalog = useMemo(
    () => readSmartTypeCatalog(project, activeId || undefined, documentEpoch),
    [readSmartTypeCatalog, project.elements, activeId, documentEpoch],
  );
  const [showSoundCards, setShowSoundCards] = useState(true);
  const [isImageDropTarget, setIsImageDropTarget] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // One restoration per mount/document. Paging updates from later typing must
  // never reapply an old bookmark or move focus away from the user's controls.
  const restoreRef = useRef({ epoch: documentEpoch, context: useStore.getState().writingContext, done: false, cancelled: false });
  if (restoreRef.current.epoch !== documentEpoch) {
    restoreRef.current = { epoch: documentEpoch, context: useStore.getState().writingContext, done: false, cancelled: false };
  }
  const capturedSceneRef = useRef<{ id: string; sceneId?: string; epoch: number } | null>(null);
  useEffect(() => {
    const capture = () => {
      const state = useStore.getState();
      const host = scrollRef.current;
      if (!host || state.documentEpoch !== documentEpoch || state.pdfExportMode || state.view !== 'write' || host.closest('[inert], [hidden]')) return;
      const node = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const selection = window.getSelection();
      if (node?.dataset.id && refs.current.get(node.dataset.id) === node && selection?.rangeCount && node.contains(selection.focusNode)) {
        const caret = caretOffset(node);
        if (caret >= 0) {
          // Reuse the editor's existing ID index, and find the parent scene only
          // when the active paragraph changes, never on each input/selection.
          let captured = capturedSceneRef.current;
          if (!captured || captured.id !== node.dataset.id || captured.epoch !== documentEpoch) {
            let sceneId: string | undefined;
            for (let index = elementIndexRef.current.get(node.dataset.id) ?? -1; index >= 0; index--) {
              const element = state.project.elements[index];
              if (element?.type === 'scene_heading') { sceneId = element.id; break; }
            }
            captured = { id: node.dataset.id, sceneId, epoch: documentEpoch };
            capturedSceneRef.current = captured;
          }
          state.updateWritingContext({ activeId: node.dataset.id, sceneId: captured.sceneId, caret, writeScrollTop: host.scrollTop }, documentEpoch);
        }
      }
    };
    const cancelRestore = () => { restoreRef.current.cancelled = true; };
    // Input, pointer and find commands cancel even while fonts/layout are pending.
    for (const type of ['pointerdown', 'mousedown', 'keydown', 'beforeinput', 'wheel']) document.addEventListener(type, cancelRestore, true);
    for (const type of ['selectionchange', 'keyup', 'input', 'pointerup', 'mouseup']) document.addEventListener(type, capture);
    window.addEventListener('guangying:find', cancelRestore);
    return () => {
      for (const type of ['pointerdown', 'mousedown', 'keydown', 'beforeinput', 'wheel']) document.removeEventListener(type, cancelRestore, true);
      for (const type of ['selectionchange', 'keyup', 'input', 'pointerup', 'mouseup']) document.removeEventListener(type, capture);
      window.removeEventListener('guangying:find', cancelRestore);
    };
  }, [documentEpoch]);
  useEffect(() => {
    const pending = restoreRef.current;
    if (pending.done || pending.cancelled || pdfExportMode || readyKey !== `${version}:${project.settings.paper}`) return;
    const frame = requestAnimationFrame(() => {
      const state = useStore.getState();
      const host = scrollRef.current;
      if (pending !== restoreRef.current || pending.cancelled || state.documentEpoch !== pending.epoch || state.pdfExportMode || state.view !== 'write' || !host) return;
      pending.done = true;
      if (state.focus || host.closest('[inert], [hidden]') || document.querySelector('[aria-modal="true"], .find-panel')) return;
      const context = pending.context;
      if (!context) return;
      const node = context.activeId ? refs.current.get(context.activeId) : undefined;
      if (context.writeScrollTop !== undefined) host.scrollTop = context.writeScrollTop;
      if (node && typeof context.caret === 'number') {
        // Keep toolbar/modal/find focus. A home card that opened this document
        // has already unmounted, so a normal reopen has body focus here.
        if (document.activeElement === document.body || document.activeElement === node) {
          node.focus({ preventScroll: true });
          setCaret(node, Math.min(context.caret, domLength(node)));
        }
        node.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      } else if (node && context.writeScrollTop === undefined) {
        node.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [documentEpoch, readyKey, version, project.settings.paper, pdfExportMode]);

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
    window.dispatchEvent(new Event('guangying:typing'));
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
  const writingDerivation = useMemo(() => deriveWritingElements(project.elements), [project.elements]);
  // 多选模式下每个段落都会读取序号；预先建索引，避免长剧本渲染退化为 O(n²)。
  const elementIndex = useMemo(
    () => new Map(project.elements.map((element, index) => [element.id, index])),
    [project.elements],
  );
  const elementIndexRef = useRef(elementIndex);
  elementIndexRef.current = elementIndex;

  /**
   * 写作多选：Shift 必须按正文顺序选取连续段落，而不是只对小复选框生效。
   * 这套选择只在多选模式启用，绝不拦截正常写作、光标或 TAB 类型循环。
   */
  const selectWritingElement = useCallback((id: string, range: boolean) => {
    const index = elementIndex.get(id);
    const anchor = elementIndex.get(selectionAnchor.current || '');
    if (index === undefined) return;
    if (range && anchor !== undefined) {
      const ids = project.elements.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((item) => item.id);
      setWritingSelectedIds([...writingIds, ...ids]);
    } else {
      toggleWritingSelection(id);
      selectionAnchor.current = id;
    }
  }, [elementIndex, project.elements, setWritingSelectedIds, toggleWritingSelection, writingIds]);

  const showSceneNumber = (side: 'left' | 'right') =>
    project.settings.sceneNumber === side || project.settings.sceneNumber === 'both';

  /* ------------------------- 自动续打 ------------------------- */
  const updateSuggest = useCallback(
    (el: ScriptElement) => {
      const node = refs.current.get(el.id);
      const selection = window.getSelection();
      const text = node ? domText(node) : '';
      const caret = node ? caretOffset(node) : -1;
      const epoch = useStore.getState().documentEpoch;
      const dismissed = dismissedSuggestRef.current;
      if (dismissed?.id === el.id && dismissed.epoch === epoch &&
          dismissed.html === node?.innerHTML && dismissed.type === el.type) {
        setSuggest(null);
        return;
      }
      if (composingRef.current || selectMode || !node || document.activeElement !== node || !text.trim() || !selection?.isCollapsed || caret !== text.length) {
        setSuggest(null);
        return;
      }
      const session = intentInputRef.current;
      const allowCrossType = session?.id === el.id && session.epoch === epoch &&
        session.html === node.innerHTML && session.type === el.type && !el.dual && !el.dualGroup;
      const matches = getSmartTypeSuggestions({ ...el, text: node.innerHTML }, caret, smartTypeCatalog, { allowCrossType });
      if (!matches?.items.length) {
        setSuggest(null);
        return;
      }
      const nb = node.getBoundingClientRect();
      const range = selection.rangeCount ? selection.getRangeAt(0) : null;
      const caretRect = range && typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : nb;
      const menuWidth = 250;
      const menuHeight = Math.min(300, matches.items.length * 32 + 32);
      const beside = nb.right + menuWidth + 18 <= window.innerWidth;
      setSuggest({
        id: el.id,
        epoch,
        sourceHtml: node.innerHTML,
        catalog: smartTypeCatalog,
        type: el.type,
        sourceText: text,
        start: matches.start,
        end: matches.end,
        kind: matches.kind,
        items: matches.items,
        active: 0,
        top: Math.max(8, Math.min(window.innerHeight - menuHeight - 8, beside ? caretRect.top : caretRect.bottom + 6)),
        left: Math.max(8, Math.min(window.innerWidth - menuWidth - 8, beside ? nb.right + 10 : caretRect.left)),
      });
    },
    [smartTypeCatalog, selectMode],
  );

  // 候选是瞬时 UI，不进入工程或历史。撤销、改类型、切工程和选区移动都必须使旧候选失效。
  useEffect(() => {
    setSuggest((s) => {
      if (!s || selectMode) return null;
      const current = project.elements.find((item) => item.id === s.id);
      return s.epoch === documentEpoch && s.catalog === smartTypeCatalog && current && current.type === s.type &&
        current.text === s.sourceHtml && searchText(current.text) === s.sourceText &&
        !(s.kind === 'intent' && (current.dual || current.dualGroup)) ? s : null;
    });
    const session = intentInputRef.current;
    const current = session && project.elements.find(item => item.id === session.id);
    if (session && (!current || current.dual || current.dualGroup || selectMode || session.epoch !== documentEpoch ||
        current.text !== session.html || current.type !== session.type)) intentInputRef.current = null;
  }, [project.elements, project.id, documentEpoch, smartTypeCatalog, selectMode]);
  useEffect(() => {
    if (!suggest) return;
    const onSelection = () => {
      const node = refs.current.get(suggest.id);
      if (!node || document.activeElement !== node || !window.getSelection()?.isCollapsed || caretOffset(node) !== domLength(node)) {
        setSuggest(null);
        intentInputRef.current = null;
      }
    };
    const dismiss = () => setSuggest(null);
    document.addEventListener('selectionchange', onSelection);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [suggest]);

  const acceptSuggest = useCallback((withSeparator = true, index?: number) => {
    const state = suggest;
    if (!state || composingRef.current || selectMode) return false;
    const item = state.items[index ?? state.active];
    const node = refs.current.get(state.id);
    const current = useStore.getState().project.elements.find((el) => el.id === state.id);
    if (!item || !node || !current || state.catalog !== smartTypeCatalog || useStore.getState().documentEpoch !== state.epoch ||
        current.text !== state.sourceHtml || current.type !== state.type ||
        ((state.kind === 'intent' || (item.targetType && item.targetType !== current.type)) && (current.dual || current.dualGroup)) ||
        document.activeElement !== node ||
        !window.getSelection()?.isCollapsed || caretOffset(node) !== state.end || domText(node) !== state.sourceText) {
      setSuggest(null);
      return false;
    }
    // 只替换当前字段，保留其他文本与格式；候选永远作为文本节点插入，不能解释为 HTML。
    const nextNode = node.cloneNode(true) as HTMLDivElement;
    const range = makeTextRange(nextNode, state.start, state.end);
    const separator = withSeparator ? item.separator || '' : '';
    const value = item.value + separator;
    range.deleteContents();
    range.insertNode(document.createTextNode(value));
    const html = nextNode.innerHTML;
    setSuggest(null);
    const targetType = item.targetType || current.type;
    intentInputRef.current = null;
    dismissedSuggestRef.current = { id: state.id, epoch: state.epoch, html, type: targetType };
    // 完成候选是一笔独立撤销；不能与之前或之后的普通打字合并。
    if (!useStore.getState().commitSmartType(state.id, state.sourceHtml, state.type, html, targetType, state.epoch)) return false;
    // Model sync can rebuild a scene-number wrapper; request the same element's
    // focus after React commits, rather than touching a possibly detached node.
    const nextCaret = state.start + (item.caret ?? item.value.length) + separator.length;
    requestFocus(state.id, nextCaret);
    return true;
  }, [suggest, smartTypeCatalog, selectMode, requestFocus]);

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
      if (e.nativeEvent.isComposing || composingRef.current || e.nativeEvent.keyCode === 229) return;

      const meta = e.metaKey || e.ctrlKey;
      // Cursor navigation/selection changes create a typing-history boundary;
      // repeated input events themselves must not split the current group.
      if (/^(Arrow|Home|End|Page)/.test(e.key) || (meta && e.key.toLowerCase() === 'a')) useStore.getState().breakHistoryGroup();
      const candidateKey = !meta && !e.altKey && !e.shiftKey;
      const hasSuggest = suggest?.id === el.id && suggest.type === el.type && suggest.sourceText === domText(node) && window.getSelection()?.isCollapsed && caretOffset(node) === suggest.end;
      if (suggest && !hasSuggest) setSuggest(null);
      if (hasSuggest && candidateKey && e.key === 'Enter' && acceptSuggest(false)) {
        e.preventDefault();
        return;
      }
      if (hasSuggest && candidateKey && (e.key === 'ArrowRight' || (e.key === ' ' && suggest?.kind !== 'intent')) && acceptSuggest(true)) {
        e.preventDefault();
        return;
      }
      if (hasSuggest && candidateKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        setSuggest((s) =>
          s ? { ...s, active: (s.active + (e.key === 'ArrowDown' ? 1 : -1) + s.items.length) % s.items.length } : s,
        );
        return;
      }
      if (e.key === 'Escape') {
        if (suggest) e.preventDefault();
        dismissedSuggestRef.current = { id: el.id, epoch: useStore.getState().documentEpoch, html: node.innerHTML, type: el.type };
        intentInputRef.current = null;
        sceneIntroInputRef.current.delete(el.id);
        compositionEmptyActionRef.current.delete(el.id);
        setSuggest(null);
        return;
      }
      // Shift/Alt + 方向键属于文本选择/按词移动，不允许候选或段落导航抢占。
      if ((e.shiftKey || e.altKey) && e.key.startsWith('Arrow')) return;

      if (meta && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        useStore.getState().breakHistoryGroup();
        try {
          document.execCommand('styleWithCSS', false, 'false');
          document.execCommand(e.key.toLowerCase() === 'b' ? 'bold' : e.key.toLowerCase() === 'i' ? 'italic' : 'underline');
        } catch {
          /* ignore */
        }
        setText(el.id, node.innerHTML);
        useStore.getState().breakHistoryGroup();
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey && !meta && !e.altKey) {
        intentInputRef.current = null;
        dismissedSuggestRef.current = null;
        e.preventDefault();
        const selected = readWritingSelection(contentRef.current);
        if (selected && !selected.collapsed) {
          if (!writableRange(selected.ids)) { notify(RANGE_RESELECT_MESSAGE, 'error'); return; }
          const current = useStore.getState().project.elements.find(item => item.id === selected.ids[0]);
          if (!current) return;
          const id = useStore.getState().replaceWritingRange(selected.ids, selected.before, selected.after, '', nextTypeOnEnter(current, false));
          setSuggest(null);
          if (id) requestFocus(id, 'start');
          return;
        }
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
        // 红线：无论候选是否可见，Tab 都只循环类型，并立即废弃旧类型的候选。
        setSuggest(null);
        sceneIntroInputRef.current.delete(el.id);
        intentInputRef.current = null;
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
        setSuggest(null);
        sceneIntroInputRef.current.delete(el.id);
        intentInputRef.current = null;
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

      if (e.key === 'Backspace' || e.key === 'Delete') {
        const selected = readWritingSelection(contentRef.current);
        if (selected && !selected.collapsed) {
          e.preventDefault();
          if (!writableRange(selected.ids)) { notify(RANGE_RESELECT_MESSAGE, 'error'); return; }
          const id = useStore.getState().replaceWritingRange(selected.ids, selected.before, selected.after, '');
          setSuggest(null);
          if (id) requestFocus(id, selected.start);
          return;
        }
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
            // One transaction, preserve inline markup/entities; no plain-text
            // concatenation followed by a second independent delete history.
            mergeIntoPrevious(next.id);
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
    [project, suggest, acceptSuggest, setText, setType, splitBlock, mergeIntoPrevious, lineHeightPx, moveFocus, notify],
  );

  const handleInput = useCallback(
    (el: ScriptElement, html: string, input?: InputEvent, composition?: { html: string; start: number; end: number; data: string }) => {
      markTyping();
      let value = html;
      const state = useStore.getState();
      const previous = state.project.elements.find((e) => e.id === el.id);
      const node = refs.current.get(el.id);
      const session = intentInputRef.current;
      const continuingIntent = !!previous && session?.id === el.id && session.epoch === state.documentEpoch &&
        session.html === previous.text && session.type === previous.type;
      const ordinaryInput = !input?.inputType || ['insertText', 'insertCompositionText', 'deleteContentBackward', 'deleteContentForward'].includes(input.inputType);
      // Refocus/keyup and unchanged composition replays must stay dismissed,
      // but genuine editing starts a new request even if the text later returns
      // to the previously accepted value (小明 → 小 → 小明).
      if (previous && ordinaryInput && value !== previous.text) dismissedSuggestRef.current = null;
      const atEnd = !!node && window.getSelection()?.isCollapsed && caretOffset(node) === domLength(node);
      if (previous && ordinaryInput && !previous.dual && !previous.dualGroup &&
          (continuingIntent || (isBlank(previous.text) && (atEnd || composingRef.current)))) {
        intentInputRef.current = { id: el.id, epoch: state.documentEpoch, html: value, type: previous.type };
      } else intentInputRef.current = null;
      if (composingRef.current || input?.isComposing) {
        // 组合期只同步输入，不猜类型、不开候选、不重建场号包装；提交后再识别一次。
        setText(el.id, value);
        setSuggest(null);
        return;
      }
      // 从空动作段逐字输入 INT./EXT./内景也应识别；I/IN 不能提前抢成“人物”。
      // 会话只延续未被编辑/手动改类型的短前缀，绝不每次输入都猜已有正文。
      // Red line: transform only known newly inserted text, in this typing
      // transaction. Never walk/replace HTML quotes, pasted text, history or an
      // active IME composition. Direction depends on text, never markup length.
      if (previous?.type === 'dialogue' && useStore.getState().project.settings.smartQuotes && node &&
          (composition || input?.inputType === 'insertText')) {
        value = applySmartDoubleQuotes(composition?.html ?? previous.text, html, {
          data: composition?.data ?? input?.data ?? null,
          caret: caretOffset(node),
          selection: composition ? { start: composition.start, end: composition.end } : undefined,
        });
      }
      const wasEmpty = previous ? isBlank(previous.text) : isBlank(el.text);
      const trimmedNew = plain(value).trim();
      const introPrefixes = ['内景', '外景', '内/外景', '外/内景', '内外景', 'INT.', 'EXT.', 'INT./EXT.', 'I/E.'];
      const possibleIntro = introPrefixes.some(prefix => prefix.toLowerCase().startsWith(trimmedNew.toLowerCase()));
      const lastPrefix = sceneIntroInputRef.current.get(el.id);
      const continuingIntro = previous?.type === 'action' && lastPrefix !== undefined &&
        plain(previous.text).trim() === lastPrefix && trimmedNew.startsWith(lastPrefix);
      // A known cross-type candidate is only a suggestion: even 内景/INT. must
      // wait for explicit acceptance. Keep the old conservative recognizer for
      // inputs which are not covered by the project/built-in intent vocabulary.
      const intentMatches = intentInputRef.current && previous && atEnd
        ? getSmartTypeSuggestions({ ...previous, text: value }, caretOffset(node!), smartTypeCatalog, { allowCrossType: true }) : null;
      let changedType = false;
      if (!intentMatches && (wasEmpty || continuingIntro || compositionEmptyActionRef.current.has(el.id)) && trimmedNew && previous?.type === 'action') {
        const sceneIntro = previous.type === 'action' && atEnd &&
          /^(?:内景|外景|内\/外景|外\/内景|内外景)(?:$|[\s·.．、:：\-—])|^(?:INT|EXT|INT\.\/EXT|I\/E)\.(?:$|[\s\-—])/i.test(trimmedNew);
        const recognized = sceneIntro ? 'scene_heading' : recognizeType(trimmedNew);
        const deferCharacter = previous.type === 'action' && atEnd && possibleIntro && recognized === 'character';
        if (recognized && !deferCharacter && recognized !== previous.type) {
          setType(previous.id, recognized);
          changedType = true;
        }
      }
      if (previous?.type === 'action' && !changedType && atEnd && possibleIntro && (wasEmpty || continuingIntro)) {
        sceneIntroInputRef.current.set(el.id, trimmedNew);
      } else sceneIntroInputRef.current.delete(el.id);
      setText(el.id, value);
      const caret = node ? caretOffset(node) : -1;
      if (changedType) requestFocus(el.id, caret < 0 ? 'end' : caret);
      const latest = useStore.getState().project.elements.find((item) => item.id === el.id);
      if (latest && intentInputRef.current) intentInputRef.current = {
        id: latest.id, epoch: state.documentEpoch, html: latest.text, type: latest.type,
      };
      if (latest) updateSuggest({ ...latest, text: value });
    },
    [project.settings.smartQuotes, smartTypeCatalog, markTyping, setText, setType, updateSuggest, requestFocus],
  );

  const handlePaste = useCallback(
    (_el: ScriptElement, e: React.ClipboardEvent<HTMLDivElement>) => {
      intentInputRef.current = null;
      // Paste ends direct-typing recognition even when it replaces a prefix
      // with identical text; later typing must not revive that old session.
      sceneIntroInputRef.current.clear();
      compositionEmptyActionRef.current.clear();
      // No native paste while IME or block selection owns the editor: it could
      // bypass our literal/typed paste path and create a second DOM-only edit.
      if (selectMode || composingRef.current) { e.preventDefault(); return; }
      const text = e.clipboardData.getData('text/plain');
      const selected = readWritingSelection(contentRef.current);
      if (!selected) return;
      e.preventDefault();
      if (!writableRange(selected.ids)) { notify(RANGE_RESELECT_MESSAGE, 'error'); return; }
      const internal = decodeWritingClipboard(e.clipboardData.getData(WRITING_CLIPBOARD_MIME));
      if (internal) {
        let result: ClipboardFocus | null = null;
        useStore.getState().mutate(draft => { result = replaceClipboardRange(draft, selected.ids, selected.before, selected.after, internal); });
        const focus = result as ClipboardFocus | null;
        setSuggest(null);
        if (focus) requestFocus(focus.focusId, focus.caret);
        return;
      }
      // Empty/non-text clipboard must never inject arbitrary HTML into the
      // contentEditable or silently remove a selected range.
      if (!text) return;
      // Clipboard text is literal: `<...>` must not be stripped as HTML.
      // One store transaction, not native DOM undo plus a second input transaction.
      const value = text.replace(/\r\n?/g, '\n');
      const id = useStore.getState().replaceWritingRange(selected.ids, selected.before, selected.after, escapeHtml(value).replace(/\n/g, '<br>'));
      setSuggest(null);
      if (id) requestFocus(id, selected.start + value.length);
    },
    [selectMode, requestFocus, notify],
  );

  const handleClipboard = (event: React.ClipboardEvent, cut: boolean) => {
    if (!(event.target as HTMLElement).closest('.sc-el--editable')) return;
    if (selectMode || composingRef.current) { event.preventDefault(); return; }
    const selected = readWritingSelection(contentRef.current);
    if (!selected || selected.collapsed) return;
    event.preventDefault();
    if (cut && !writableRange(selected.ids)) { notify(RANGE_RESELECT_MESSAGE, 'error'); return; }
    event.clipboardData.setData('text/plain', selected.text);
    event.clipboardData.setData('text/html', selected.html);
    const payload = encodeWritingClipboard(selected.fragments as Array<{ type: ElementType; html: string }>);
    if (payload) event.clipboardData.setData(WRITING_CLIPBOARD_MIME, payload);
    if (cut) {
      intentInputRef.current = null;
      sceneIntroInputRef.current.clear();
      compositionEmptyActionRef.current.clear();
      const id = useStore.getState().replaceWritingRange(selected.ids, selected.before, selected.after, '');
      setSuggest(null);
      if (id) requestFocus(id, selected.start);
    }
  };

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
  // 图片只使用统一的 image 卡：自由板可新建，写作页保留“直接拖入照片”的入口。
  // 这里不能恢复第二套 wimg/“写作图”数据类型，否则旧工程兼容和 PDF 素材页会再次分叉。
  const writingImages = project.beats.filter((b) => b.kind === 'image');
  // 声音开关只控制声音，不能把已拖入的图片一起隐藏。
  const writingMaterials = [...(showSoundCards || pdfExportMode === 'creative' ? writingSounds : []), ...writingImages];
  const addWritingSound = () => {
    const count = writingSounds.length;
    const x = Math.max(24, (scrollRef.current?.clientWidth || 980) - 274);
    const y = 84 + count * 24;
    addBeat(x, y, '', 'sound');
  };

  // 核心红线：本地图片拖入由写作面板接管，不得落入 contentEditable 正文。
  // .editor 才是滚动容器，内层 bounds.top 已包含滚动偏移，不能再加 scrollTop。
  const handleImageDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    setIsImageDropTarget(false);
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    const images = Array.from(event.dataTransfer.files).filter((file) =>
      file.type.startsWith('image/') || (!file.type && /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name)),
    );
    if (!images.length) {
      notify('请拖入本地图片文件（如 PNG、JPEG 或 WebP）。', 'error');
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const maxX = Math.max(16, bounds.width - 290 - 16);
    const x = Math.max(16, Math.min(maxX, Math.round(event.clientX - bounds.left - 145)));
    const viewport = scrollRef.current!.getBoundingClientRect();
    const y = Math.max(16, Math.min(viewport.bottom - bounds.top - 100, Math.round(event.clientY - bounds.top - 22)));
    const documentAtDrop = useStore.getState().documentEpoch;
    for (const [index, image] of images.entries()) {
      try {
        const img = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('读取失败'));
          reader.onabort = () => reject(new Error('读取中断'));
          reader.onload = () => {
            const data = String(reader.result || '');
            const decoded = new Image();
            decoded.onload = () => resolve(data);
            decoded.onerror = () => reject(new Error('图片无法解码'));
            decoded.src = data;
          };
          reader.readAsDataURL(image);
        });
        // 读取期间切换工程时，不能把上一份工程的图片写进新工程。
        if (useStore.getState().documentEpoch !== documentAtDrop) return;
        addBeat(Math.min(maxX, x + index * 20), y, '', 'image', {
          title: image.name.replace(/\.[^.]+$/, '') || '图片素材', img,
        });
      } catch {
        if (useStore.getState().documentEpoch !== documentAtDrop) return;
        notify(`无法读取图片“${image.name}”，请尝试有效的 PNG、JPEG 或 WebP 文件。`, 'error');
      }
    }
  };

  return (
    <div className="editor" ref={scrollRef} onScroll={(event) => {
      const state = useStore.getState();
      const pending = restoreRef.current;
      if (state.view === 'write' && (pending.done || pending.cancelled)) state.updateWritingContext({ writeScrollTop: event.currentTarget.scrollTop }, documentEpoch);
    }} onCopy={(e) => handleClipboard(e, false)} onCut={(e) => handleClipboard(e, true)} onKeyDownCapture={(e) => {
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
          showSound={showSoundCards}
          onToggleSound={() => setShowSoundCards((v) => !v)}
          onAddSound={addWritingSound}
        />
      </ProgressBar>
      <div
        className={`editor__scroll${isImageDropTarget ? ' is-image-drop-target' : ''}`}
        data-ready={readyKey === `${version}:${project.settings.paper}` ? 'true' : 'false'}
        onDragOverCapture={(event) => {
          if (Array.from(event.dataTransfer.types).includes('Files')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setIsImageDropTarget(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsImageDropTarget(false);
        }}
        onDropCapture={handleImageDrop}
      >
        <WritingMaterialCards cards={writingMaterials} onUpdate={updateBeat} onMove={moveBeat} onDelete={deleteBeat} />
        {settings.indent && project.titlePage.show ? <TitlePageCard /> : null}
        <div className="script-flow" ref={contentRef} style={columnStyle}>
          {items.map((item, i) => {
            const list = Array.isArray(item) ? item : [item];
            const firstEl = list[0];
            const isBreak = list.some((e) => breakSet.has(writingDerivation.indexByElement.get(e) ?? -1));
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
              key={`${s.targetType || suggest.type}:${s.label}`}
              className={`smarttype__item ${i === suggest.active ? 'is-active' : ''}`}
              role="option"
              aria-selected={i === suggest.active}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptSuggest(true, i);
              }}
            >
              <span className="smarttype__label">{s.label}</span>
              {s.typeLabel ? <small className="smarttype__type"> · {s.typeLabel}</small> : null}
            </button>
          ))}
          <div className="smarttype__hint">↑↓ 选择 · → / Enter 确认 · 再按 Enter 换段</div>
        </div>
      ) : null}
    </div>
  );

  function renderBlock(el: ScriptElement, half: boolean) {
    const isScene = el.type === 'scene_heading';
    const contdSuffix = settings.contdCharacter !== false && writingDerivation.contdCharacters.has(el) ? CONTD_SUFFIX : undefined;
    return (
      <div key={el.id} className={selectMode ? 'writing-select-row' : undefined}>
      {selectMode && <input type="checkbox" aria-label={`选择第 ${(elementIndex.get(el.id) ?? 0) + 1} 段`} checked={writingIds.includes(el.id)} onChange={() => {}} onClick={(e) => {
        e.stopPropagation();
        selectWritingElement(el.id, e.shiftKey);
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
        onInput={(html, input) => handleInput(el, html, input)}
        onKeyDown={(e) => handleKeyDown(el, e)}
        onFocus={() => {
          useStore.getState().breakHistoryGroup();
          setActive(el.id);
          if (suggest && suggest.id !== el.id) setSuggest(null);
        }}
        onClick={selectMode ? (e) => {
          e.preventDefault();
          selectWritingElement(el.id, e.shiftKey);
        } : () => {
          useStore.getState().breakHistoryGroup();
          const latest = useStore.getState().project.elements.find((item) => item.id === el.id);
          if (latest) updateSuggest(latest);
        }}
        onPaste={(e) => handlePaste(el, e)}
        onCompositionStart={() => {
          useStore.getState().breakHistoryGroup();
          composingRef.current = true;
          const current = useStore.getState().project.elements.find((item) => item.id === el.id);
          if (current && isBlank(current.text) && !current.dual && !current.dualGroup) {
            intentInputRef.current = { id: el.id, epoch: useStore.getState().documentEpoch, html: current.text, type: current.type };
          }
          quoteCompositionRef.current = null;
          const node = refs.current.get(el.id);
          const selection = window.getSelection();
          const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
          if (current?.type === 'dialogue' && node && range &&
              node.contains(range.startContainer) && node.contains(range.endContainer)) {
            quoteCompositionRef.current = {
              id: el.id, epoch: useStore.getState().documentEpoch, html: node.innerHTML,
              start: offsetOf(node, range.startContainer, range.startOffset),
              end: offsetOf(node, range.endContainer, range.endOffset),
            };
          }
          if (current?.type === 'action' && isBlank(current.text)) compositionEmptyActionRef.current.add(el.id);
          else compositionEmptyActionRef.current.delete(el.id);
          setSuggest(null);
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          const node = refs.current.get(el.id);
          const quote = quoteCompositionRef.current;
          quoteCompositionRef.current = null;
          if (node) {
            handleInput(el, node.innerHTML, undefined,
              quote?.id === el.id && quote.epoch === useStore.getState().documentEpoch
                ? { html: quote.html, start: quote.start, end: quote.end, data: event.data } : undefined);
          }
          compositionEmptyActionRef.current.delete(el.id);
          useStore.getState().breakHistoryGroup();
        }}
        onBlur={() => {
          useStore.getState().breakHistoryGroup();
          sceneIntroInputRef.current.delete(el.id);
          compositionEmptyActionRef.current.delete(el.id);
          intentInputRef.current = null;
          setSuggest((s) => s?.id === el.id ? null : s);
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
  soundCount, showSound, onToggleSound, onAddSound,
}: {
  soundCount: number; showSound: boolean;
  onToggleSound: () => void; onAddSound: () => void;
}) {
  return (
    <span className="writing-material-controls" aria-label="写作素材">
      <span className="writing-material-controls__group">
        <button type="button" aria-label="显示或隐藏声音卡" aria-pressed={showSound} title={showSound ? '暂时隐藏声音卡' : '显示声音卡'} onClick={onToggleSound}>◌ <b>{soundCount}</b></button>
        <button type="button" aria-label="新建声音卡" title="新建声音卡" onClick={onAddSound}>＋</button>
      </span>
    </span>
  );
}

function WritingMaterialCards({ cards, onUpdate, onMove, onDelete }: {
  cards: Array<{ id: string; x: number; y: number; text: string; title?: string; img?: string; kind?: 'beat' | 'sound' | 'image' }>;
  onUpdate: (id: string, patch: { title?: string; text?: string }) => void;
  onMove: (id: string, x: number, y: number) => void;
  onDelete: (id: string) => void;
}) {
  const dragRef = useRef<{ id: string; x: number; y: number; startX: number; startY: number } | null>(null);
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
    <div className="writing-material-layer">
      {cards.map((card) => (
        <article key={card.id} className={`writing-material-card${card.kind === 'image' ? ' writing-material-card--image' : ''}`} style={{ left: card.x, top: card.y }} onPointerDown={(e) => onPointerDown(e, card)} onPointerMove={onPointerMove} onPointerUp={stopDrag}>
          <header className="writing-material-card__head">
            <span className="writing-material-card__kind" aria-hidden>{card.kind === 'image' ? '▣' : '◌'}</span>
            <input value={card.title || ''} placeholder={card.kind === 'image' ? '图片素材' : '声音设计'} aria-label={card.kind === 'image' ? '图片卡标题' : '声音卡标题'} onChange={(e) => onUpdate(card.id, { title: e.target.value })} />
            <span className="writing-material-card__drag" title="拖动卡片" aria-hidden>⠿</span>
            <button type="button" title={`删除这张${card.kind === 'image' ? '图片' : '声音'}卡`} aria-label={`删除这张${card.kind === 'image' ? '图片' : '声音'}卡`} onClick={() => onDelete(card.id)}>×</button>
          </header>
          {card.kind === 'image' && card.img ? (safeEmbeddedImageSource(card.img)
            ? <img className="writing-material-card__image" src={safeEmbeddedImageSource(card.img)} alt={card.title || '图片素材'} draggable={false} />
            : <div className="bcard__empty-media">图片来源已阻止，请重新导入本地图片</div>) : null}
          <textarea value={card.text} placeholder={card.kind === 'image' ? '图片备注、画面灵感或场景提示…' : '声音、环境、节奏或情绪提示…'} aria-label={card.kind === 'image' ? '图片卡备注' : '声音卡内容'} onChange={(e) => onUpdate(card.id, { text: e.target.value })} />
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
