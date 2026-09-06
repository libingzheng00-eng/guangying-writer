import React, { useEffect, useRef } from 'react';
import type { ScriptElement, ScriptSettings } from '../model/types';
import { ELEMENT_META } from '../model/elements';
import { isBlank } from '../utils/text';
import { setCaret } from '../utils/dom';
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
  className?: string;
  innerRef?: (node: HTMLDivElement | null) => void;
}

/** 只读渲染（分页预览、打印、测量） */
export function StaticBlock(props: BlockProps) {
  const { el, settings, half, spaceBefore, revColor, sceneNumber, className, innerRef } = props;
  const el0 = sceneNumber && sceneNumber.text !== undefined ? { ...el, text: sceneNumber.text } : el;
  const empty = isBlank(el0.text);
  const cls = [
    'sc-el',
    `sc-el--${el.type}`,
    el.omit ? 'is-omit' : '',
    revColor ? 'has-rev' : '',
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

  // 仅在非聚焦状态同步外部的文本变更，避免打字时光标被重置
  useEffect(() => {
    const node = localRef.current;
    if (!node) return;
    if (node.innerHTML !== el.text && document.activeElement !== node) node.innerHTML = el.text;
  }, [el.text]);

  useEffect(() => {
    if (!focus || focus.id !== el.id) return;
    const node = localRef.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    setCaret(node, focus.caret);
    node.scrollIntoView({ block: 'nearest' });
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
      style={blockStyle({ settings, half, revColor }, el)}
      contentEditable
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
