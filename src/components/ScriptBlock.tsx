import React, { useEffect, useLayoutEffect, useRef } from 'react';
import type { ScriptElement, ScriptSettings } from '../model/types';
import { ELEMENT_META } from '../model/elements';
import { isBlank } from '../utils/text';
import { setCaret, offsetOf, makeTextRange } from '../utils/dom';
import { useStore } from '../store/store';

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
  if (revColor) style['--rev-color'] = revColor;
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

/** 只读渲染（分页预览、打印、测量） */
export function StaticBlock(props: BlockProps) {
  const { el, settings, half, spaceBefore, revColor, sceneNumber, contdSuffix, className, innerRef } = props;
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
  onInput?: (html: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  readOnly?: boolean;
  onFocus?: () => void;
  onClick?: (e: React.MouseEvent) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  onBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

/** 可编辑渲染（写作视图） */
export function EditableBlock(props: EditableBlockProps) {
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
  const focus = useStore((s) => s.focus);
  const localRef = useRef<HTMLDivElement | null>(null);
  const empty = isBlank(el.text);

  // 核心红线：聚焦不能阻止撤销/剪切/回车分段回写。正常输入的 DOM 已与
  // state 相同，不触碰它；仅外部不同值同步，并恢复当前文本选区，避免光标跳动。
  useLayoutEffect(() => {
    const node = localRef.current;
    if (!node) return;
    if (node.innerHTML === el.text) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const saved = document.activeElement === node && range && node.contains(range.startContainer) && node.contains(range.endContainer)
      ? [offsetOf(node, range.startContainer, range.startOffset), offsetOf(node, range.endContainer, range.endOffset)] : null;
    node.innerHTML = el.text;
    if (saved && selection) {
      selection.removeAllRanges();
      selection.addRange(makeTextRange(node, saved[0], saved[1]));
    }
  }, [el.text]);

  useEffect(() => {
    if (!focus || focus.id !== el.id) return;
    const node = localRef.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    setCaret(node, focus.caret);
    node.scrollIntoView({ block: focus.scroll || 'nearest', behavior: focus.scroll === 'start' ? 'smooth' : 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

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
      ref={(n) => {
        localRef.current = n;
        if (innerRef) innerRef(n);
      }}
      className={cls}
      data-id={el.id}
      data-type={el.type}
      data-contd={contdSuffix || undefined}
      style={blockStyle({ settings, half, revColor }, el)}
      contentEditable={!props.readOnly}
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={empty ? ELEMENT_META[el.type].placeholder : undefined}
      onInput={(e) => onInput && onInput((e.target as HTMLDivElement).innerHTML)}
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
