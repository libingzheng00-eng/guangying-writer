import React, { useLayoutEffect, useRef } from 'react';
import { richNoteHtml, richNoteValue } from '../utils/richNote';

/**
 * 卡片简介 / 灵感文字的编辑区：支持粗体、斜体、下划线（工具栏 B I U 或 ⌘/Ctrl+B/I/U）。
 * live：每次输入即写回（沿用原 textarea 的即时保存）；commit：失焦或 Enter 时一次写回，Esc 放弃。
 */
export function RichNoteField({ value, label, placeholder, className = '', mode = 'live', onChange, onFocus, stopPointer = false }: {
  value: string | undefined;
  label: string;
  placeholder?: string;
  className?: string;
  mode?: 'live' | 'commit';
  onChange: (value: string) => void;
  onFocus?: () => void;
  /** 自由板 / 故事板：在文字里按下鼠标不能拖动卡片或画布。 */
  stopPointer?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const base = useRef(value || '');
  const composing = useRef(false);
  const cancelled = useRef(false);
  const read = () => richNoteValue(ref.current?.innerHTML || '');

  // 外部改动（撤销、切换工程、别处编辑）才重写内容；正在输入的内容相同就不动，以免光标跳走。
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || composing.current) return;
    if (read() === (value || '')) return;
    if (mode === 'commit' && document.activeElement === node) return;
    node.innerHTML = richNoteHtml(value);
  }, [value, mode]);

  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    const next = read();
    if (next !== base.current) onChange(next);
  };
  const stop = (event: React.SyntheticEvent) => { if (stopPointer) event.stopPropagation(); };
  return <div
    ref={ref}
    className={`rich-note ${className}`.trim()}
    role="textbox"
    aria-multiline="true"
    aria-label={label}
    data-placeholder={placeholder}
    data-rich-note=""
    contentEditable
    suppressContentEditableWarning
    spellCheck={false}
    onFocus={() => { base.current = value || ''; cancelled.current = false; onFocus?.(); }}
    onInput={() => { if (!composing.current && mode === 'live') onChange(read()); }}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; if (mode === 'live') onChange(read()); }}
    onBlur={() => { if (mode === 'commit') commit(); }}
    onPaste={(event) => {
      // 只粘贴文字，避免把网页格式、图片或脚本带进卡片。
      event.preventDefault();
      document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
    }}
    onDrop={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' && mode === 'commit' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur(); return; }
      if (event.key === 'Enter') { event.preventDefault(); document.execCommand('insertLineBreak'); return; }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (mode === 'commit') { cancelled.current = true; event.currentTarget.innerHTML = richNoteHtml(base.current); }
        event.currentTarget.blur();
      }
    }}
    onMouseDown={stop}
    onDoubleClick={stop}
    onWheel={stop}
    onClick={stop}
    onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
  />;
}
