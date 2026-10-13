import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** 正文两侧空白处的右键菜单：新建声音卡 / 图片卡，显示或隐藏全部素材卡。 */
export function WritingContextMenu({ x, y, cardsHidden, cardCount, onAddSound, onAddImage, onToggleCards, onClose }: {
  x: number; y: number; cardsHidden: boolean; cardCount: number;
  onAddSound: () => void; onAddImage: () => void; onToggleCards: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  // 贴近窗口右 / 下边缘时往回收，菜单不出屏。
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({ left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) });
  }, [x, y]);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('scroll', onClose, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('scroll', onClose, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  const run = (action: () => void) => () => { onClose(); action(); };
  return <div ref={ref} className="writing-context-menu" role="menu" aria-label="写作素材" style={position} onContextMenu={(event) => event.preventDefault()}>
    <button type="button" role="menuitem" onClick={run(onAddSound)}>新建声音卡</button>
    <button type="button" role="menuitem" onClick={run(onAddImage)}>新建图片卡…</button>
    <hr />
    <button type="button" role="menuitem" disabled={!cardCount} onClick={run(onToggleCards)}>
      {cardsHidden ? '显示所有卡片' : '隐藏所有卡片'}{cardCount ? `（${cardCount}）` : ''}
    </button>
  </div>;
}
