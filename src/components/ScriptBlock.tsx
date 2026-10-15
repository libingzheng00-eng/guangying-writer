import React, { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ScriptElement, ScriptSettings } from '../model/types';
import { ELEMENT_META } from '../model/elements';
import { isBlank } from '../utils/text';
import { setCaret, offsetOf, makeTextRange, domText } from '../utils/dom';
import { validateCharacterSourceTarget } from '../app/characterNavigation';
import { useStore } from '../store/store';
import { runEditHistory } from '../utils/editHistory';
import { safeDisplayColor } from '../utils/displayValues';

export interface BlockStyleOptions {
  settings: ScriptSettings;
  /** 双列对白中占据半栏时压缩缩进 */
  half?: boolean;
  /** 覆盖前空行 */
  spaceBefore?: number;
  /** 修订色 */
  revColor?: string;
}

export function blockStyle(opts: BlockStyleOptions, el: ScriptElement): React.CSSProperties {
  const { settings, half, spaceBefore, revColor } = opts;
  const fmt = settings.indent[el.type] || { left: 0, right: 0, align: 'left', spaceBefore: 1 };
  const left = half ? Math.min(fmt.left, 4) : fmt.left;
  const right = half ? 1 : fmt.right;
  const mt = spaceBefore !== undefined ? spaceBefore : fmt.spaceBefore;
  const style: Record<string, unknown> = {
    marginLeft: `${left}em`,
    marginRight: `${right}em`,
    textAlign: fmt.align,
    marginTop: `${mt * settings.lineHeight}em`,
  };
  if (fmt.bold) style.fontWeight = 600;
  if (fmt.uppercase) style.textTransform = 'uppercase';
  if (revColor) style['--rev-color'] = safeDisplayColor(revColor);
  return style as React.CSSProperties;
}

export interface BlockProps {
  el: ScriptElement;
  settings: ScriptSettings;
  half?: boolean;
  spaceBefore?: number;
  revColor?: string;
  sceneNumber?: { left?: string; right?: string; text?: string };
  /** 「同人物续说」标记 (CONT'D)；纯视觉，由渲染层通过 `data-contd` + CSS ::after 实现，不写入正文。 */
  contdSuffix?: string;
  className?: string;
  innerRef?: (node: HTMLDivElement | null) => void;
}

/** 「显示译文」打开时，这一段要在下面显示的译文（纯文本）。只读显示，不进正文。 */
function useShownTranslation(el: ScriptElement): string | undefined {
  const lang = useStore((s) => s.shownTranslation);
  const text = lang ? el.tr?.[lang]?.text : undefined;
  return text && text.trim() ? text : undefined;
}

function sameSceneNumber(a: BlockProps['sceneNumber'], b: BlockProps['sceneNumber']): boolean {
  return a === b || (!!a && !!b && a.left === b.left && a.right === b.right && a.text === b.text);
}

/**
 * 段落只在自己的内容、排版设置或显示参数变化时重画。
 * 打字时整部剧本只有正在写的那一段换成新对象，其余几千段都跳过渲染。
 * 函数类参数（innerRef、事件处理）不参与比较：调用方必须让它们按段落保持同样的行为
 * （写作页按段落缓存处理器，并在调用时读取最新状态）。
 */
function sameBlockProps(a: BlockProps, b: BlockProps): boolean {
  return a.el === b.el && a.settings === b.settings && a.half === b.half && a.spaceBefore === b.spaceBefore &&
    a.revColor === b.revColor && a.contdSuffix === b.contdSuffix && a.className === b.className &&
    sameSceneNumber(a.sceneNumber, b.sceneNumber);
}

/** 只读渲染（分页预览、打印、测量） */
export const StaticBlock = memo(StaticBlockView, sameBlockProps);

function StaticBlockView(props: BlockProps) {
  const { el, settings, half, spaceBefore, revColor, sceneNumber, contdSuffix, className, innerRef } = props;
  const translation = useShownTranslation(el);
  const el0 = sceneNumber && sceneNumber.text !== undefined ? { ...el, text: sceneNumber.text } : el;
  const empty = isBlank(el0.text);
  const cls = [
    'sc-el',
    `sc-el--${el.type}`,
    el.omit ? 'is-omit' : '',
    revColor ? 'has-rev' : '',
    contdSuffix ? 'has-contd' : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');

  const node = (
    <div
      ref={innerRef}
      className={cls}
      data-id={el0.id}
      data-type={el0.type}
      data-contd={contdSuffix || undefined}
      data-tr={translation}
      style={blockStyle({ settings, half, spaceBefore, revColor }, el0)}
      dangerouslySetInnerHTML={{ __html: el0.text || '<br>' }}
    />
  );
  void empty;

  if (el.type === 'scene_heading' && sceneNumber && (sceneNumber.left || sceneNumber.right)) {
    return (
      <div className="sc-scene-row">
        {sceneNumber.left ? <span className="sc-scene-no sc-scene-no--left">{sceneNumber.left}</span> : null}
        <div className="sc-scene-row__main">{node}</div>
        {sceneNumber.right ? <span className="sc-scene-no sc-scene-no--right">{sceneNumber.right}</span> : null}
      </div>
    );
  }
  return node;
}

export interface EditableBlockProps extends BlockProps {
  selected?: boolean;
  onInput?: (html: string, event: InputEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  readOnly?: boolean;
  onFocus?: () => void;
  onClick?: (e: React.MouseEvent) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  onBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: (event: React.CompositionEvent<HTMLDivElement>) => void;
}

/** 可编辑渲染（写作视图） */
export const EditableBlock = memo(EditableBlockView, (a: EditableBlockProps, b: EditableBlockProps) =>
  sameBlockProps(a, b) && a.selected === b.selected && a.readOnly === b.readOnly);

function EditableBlockView(props: EditableBlockProps) {
  const translation = useShownTranslation(props.el);
  const {
    el,
    settings,
    half,
    revColor,
    sceneNumber,
    contdSuffix,
    className,
    innerRef,
    selected,
    onInput,
    onKeyDown,
    onFocus,
    onClick,
    onPaste,
    onBlur,
    onCompositionStart,
    onCompositionEnd,
  } = props;
  // 只订阅发给本段的聚焦请求；其他段落不因别处聚焦而重画。
  const focus = useStore((s) => (s.focus && s.focus.id === el.id ? s.focus : null));
  const localRef = useRef<HTMLDivElement | null>(null);
  const detachedSelectionRef = useRef<{ node: HTMLDivElement; start: number; end: number } | null>(null);
  const empty = isBlank(el.text);

  // Core contract: context-menu / browser beforeinput history cannot silently
  // mutate DOM and then be recorded as a fresh typing transaction.
  useEffect(() => {
    const node = localRef.current;
    if (!node || props.readOnly) return;
    const history = (event: InputEvent) => {
      if (event.isComposing || !['historyUndo', 'historyRedo'].includes(event.inputType)) return;
      event.preventDefault();
      runEditHistory(event.inputType === 'historyUndo' ? 'undo' : 'redo');
    };
    node.addEventListener('beforeinput', history);
    return () => node.removeEventListener('beforeinput', history);
  }, [el.type, sceneNumber?.left, sceneNumber?.right, props.readOnly]);

  // 核心红线：聚焦不能阻止撤销/剪切/回车分段回写。正常输入的 DOM 已与
  // state 相同，不触碰它；仅外部不同值同步，并恢复当前文本选区，避免光标跳动。
  useLayoutEffect(() => {
    const node = localRef.current;
    if (!node) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const saved = document.activeElement === node && range && node.contains(range.startContainer) && node.contains(range.endContainer)
      ? [offsetOf(node, range.startContainer, range.startOffset), offsetOf(node, range.endContainer, range.endOffset)] : null;
    if (node.innerHTML !== el.text) {
      node.innerHTML = el.text;
      if (saved && selection) {
        selection.removeAllRanges();
        selection.addRange(makeTextRange(node, saved[0], saved[1]));
      }
    }
    const detached = detachedSelectionRef.current;
    detachedSelectionRef.current = null;
    // 场号包装也可能由设置切换重建：只恢复真正丢到 body 的编辑焦点，
    // 不抢设置对话框、查找、工具栏或多选模式的焦点。
    if (detached && detached.node !== node && !props.readOnly && selection &&
        (document.activeElement === document.body || document.activeElement === detached.node)) {
      node.focus({ preventScroll: true });
      selection.removeAllRanges();
      selection.addRange(makeTextRange(node, detached.start, detached.end));
    }
  // Tab 切到场次标题/场号包装开关会重建内部 contentEditable，文字没变也需
  // 在恢复光标之前填回新 DOM；否则 setCaret(旧偏移) 会被空节点夹到 0。
  }, [el.text, el.type, sceneNumber?.left, sceneNumber?.right]);

  useEffect(() => {
    if (!focus || focus.id !== el.id) return;
    const node = localRef.current;
    if (!node || useStore.getState().pdfExportMode || useStore.getState().view !== 'write' ||
        node.closest('[inert], [hidden]') || document.querySelector('[aria-modal="true"]')) return;
    if (focus.source && (!validateCharacterSourceTarget(focus.source, useStore.getState()).ok || domText(node) !== focus.source.sourceText)) {
      useStore.getState().notify('原文已变化，已停止人物证据定位。', 'error');
      return;
    }
    node.focus({ preventScroll: true });
    if (focus.source) {
      const range = makeTextRange(node, focus.source.start, focus.source.end);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      node.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      // A paragraph can be several screens long. Reveal the actual matched
      // text range, not just the paragraph's outer rectangle.
      const reveal = () => {
        const editor = node.closest<HTMLElement>('.editor');
        const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
        if (editor && rect && rect.height) {
          const viewport = editor.getBoundingClientRect();
          if (rect.top < viewport.top + 24 || rect.bottom > viewport.bottom - 24) {
            editor.scrollTop += rect.top - viewport.top - Math.max(24, (viewport.height - Math.min(rect.height, viewport.height)) / 2);
          }
        }
      };
      reveal();
      // Fonts can settle after mounting the writing view. A single deferred
      // reveal follows that layout, but any new user gesture cancels it.
      let cancelled = false;
      let frame: number | undefined;
      const cancel = () => { cancelled = true; };
      const events = ['pointerdown', 'mousedown', 'keydown', 'wheel', 'beforeinput'];
      events.forEach(event => document.addEventListener(event, cancel, true));
      Promise.resolve(document.fonts?.ready).then(() => {
        if (cancelled) return;
        frame = requestAnimationFrame(() => {
          const state = useStore.getState();
          if (!cancelled && node.isConnected && state.focus === focus && state.view === 'write' && !state.pdfExportMode &&
              !document.querySelector('[aria-modal="true"]') && validateCharacterSourceTarget(focus.source!, state).ok &&
              document.activeElement === node) reveal();
        });
      });
      return () => {
        cancelled = true;
        if (frame !== undefined) cancelAnimationFrame(frame);
        events.forEach(event => document.removeEventListener(event, cancel, true));
      };
    }
    setCaret(node, focus.caret);
    node.scrollIntoView({ block: focus.scroll || 'nearest', behavior: focus.scroll === 'start' ? 'smooth' : 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // 固定的 ref 回调：只在正文节点真正换掉（例如场号包装切换）时被调用，
  // 普通重画不会反复解绑、重绑。
  const innerRefRef = useRef(innerRef);
  innerRefRef.current = innerRef;
  const setNode = useCallback((n: HTMLDivElement | null) => {
    const previous = localRef.current;
    if (!n && previous && document.activeElement === previous) {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range && previous.contains(range.startContainer) && previous.contains(range.endContainer)) {
        detachedSelectionRef.current = {
          node: previous,
          start: offsetOf(previous, range.startContainer, range.startOffset),
          end: offsetOf(previous, range.endContainer, range.endOffset),
        };
      }
    }
    localRef.current = n;
    innerRefRef.current?.(n);
  }, []);

  const cls = [
    'sc-el',
    `sc-el--${el.type}`,
    'sc-el--editable',
    selected ? 'is-selected' : '',
    el.omit ? 'is-omit' : '',
    revColor ? 'has-rev' : '',
    empty ? 'is-empty' : '',
    contdSuffix ? 'has-contd' : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');

  const node = (
    <div
      ref={setNode}
      className={cls}
      data-id={el.id}
      data-type={el.type}
      data-contd={contdSuffix || undefined}
      data-alts={el.alts?.length ? el.alts.length + 1 : undefined}
      data-tr={translation}
      style={blockStyle({ settings, half, revColor }, el)}
      contentEditable={!props.readOnly}
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={empty ? ELEMENT_META[el.type].placeholder : undefined}
      onInput={(e) => onInput && onInput((e.target as HTMLDivElement).innerHTML, e.nativeEvent as InputEvent)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onClick={onClick}
      onPaste={onPaste}
      onBlur={onBlur}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
    />
  );

  if (el.type === 'scene_heading' && sceneNumber && (sceneNumber.left || sceneNumber.right)) {
    return (
      <div className="sc-scene-row">
        {sceneNumber.left ? <span className="sc-scene-no sc-scene-no--left">{sceneNumber.left}</span> : null}
        <div className="sc-scene-row__main">{node}</div>
        {sceneNumber.right ? <span className="sc-scene-no sc-scene-no--right">{sceneNumber.right}</span> : null}
      </div>
    );
  }
  return node;
}
