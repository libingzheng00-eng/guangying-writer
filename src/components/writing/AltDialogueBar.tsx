import React, { useLayoutEffect, useState } from 'react';
import { useStore } from '../../store/store';
import { altTotal, currentAltNo } from '../../model/altDialogue';
import type { ScriptElement } from '../../model/types';

/**
 * 备选台词小工具条：光标停在一段对白上时，出现在页面右侧。
 * ＋ 把当前这句复制成一个新版本并切过去；‹ › 在版本之间切换；✕ 删掉当前版本。
 * 按钮都在 mousedown 时阻止失焦，光标留在正文里；每次操作都是一步可撤销的修改。
 */
export function AltDialogueBar({ el, scrollRef }: { el: ScriptElement; scrollRef: React.RefObject<HTMLDivElement> }) {
  const version = useStore((s) => s.version);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const scroller = scrollRef.current;
      const layer = scroller?.querySelector<HTMLElement>('.editor__scroll');
      const node = Array.from(scroller?.querySelectorAll<HTMLElement>('.script-flow [data-id]') || []).find((n) => n.dataset.id === el.id);
      const page = scroller?.querySelector<HTMLElement>('.script-flow');
      if (!layer || !node || !page) { setPos(null); return; }
      const origin = layer.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      const right = page.getBoundingClientRect().right - origin.left;
      setPos({ top: Math.round(box.top - origin.top), left: Math.round(Math.min(right + 12, layer.clientWidth - 196)) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [el.id, version, scrollRef]);

  const total = altTotal(el);
  const current = currentAltNo(el);
  const keep = (event: React.MouseEvent) => event.preventDefault();
  const store = useStore.getState;
  return (
    <div className="alt-dialogue-bar" role="toolbar" aria-label="备选台词" style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}>
      <span className="alt-dialogue-bar__label">备选</span>
      {total > 1 ? <>
        <button type="button" aria-label="上一个版本" title="上一个版本" onMouseDown={keep} onClick={() => store().selectAltVersion(el.id, current - 1)}>‹</button>
        <span className="alt-dialogue-bar__count" aria-live="polite">{current}/{total}</span>
        <button type="button" aria-label="下一个版本" title="下一个版本" onMouseDown={keep} onClick={() => store().selectAltVersion(el.id, current + 1)}>›</button>
      </> : null}
      <button type="button" aria-label="新建备选版本" title="把这句复制成新版本再改，原来的版本会保留" onMouseDown={keep} onClick={() => store().addAltVersion(el.id)}>＋</button>
      {total > 1 ? <button type="button" className="alt-dialogue-bar__delete" aria-label="删除当前版本" title="删除当前这个版本" onMouseDown={keep}
        onClick={() => store().deleteAltVersion(el.id)}>✕</button> : null}
    </div>
  );
}
