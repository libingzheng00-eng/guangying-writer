import React, { memo, useRef } from 'react';
import { safeEmbeddedImageSource } from '../../utils/displayValues';
import { RichNoteField } from '../RichNoteField';

/** 与 CSS 中的 clamp() 相同：卡片不超出写作区右缘，免得出现横向滚动条。保存的坐标不变。 */
function shownX(x: number, layerWidth: number, cardWidth: number): number {
  if (!layerWidth || !cardWidth) return x;
  return Math.max(16, Math.min(x, layerWidth - cardWidth - 16));
}

/** 写作画布上的声音 / 图片素材卡（与自由板共用同一套 Beat，坐标用 x/y）。
 * 卡片和处理函数都没变时不重画（打字时整页会刷新，素材卡不用跟着重画）。 */
export const WritingMaterialCards = memo(WritingMaterialCardsView);

function WritingMaterialCardsView({ cards, onUpdate, onMove, onDelete }: {
  cards: Array<{ id: string; x: number; y: number; text: string; title?: string; img?: string; kind?: 'beat' | 'sound' | 'image' }>;
  onUpdate: (id: string, patch: { title?: string; text?: string }) => void;
  onMove: (id: string, x: number, y: number) => void;
  onDelete: (id: string) => void;
}) {
  const dragRef = useRef<{ id: string; x: number; y: number; startX: number; startY: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent<HTMLElement>, card: { id: string; x: number; y: number }) => {
    if ((event.target as HTMLElement).closest('input, textarea, button, [data-rich-note]')) return;
    // 从卡片当前显示的位置开始拖（窗口变窄时显示位置会被收进可见范围，见 shownX）。
    const layerWidth = event.currentTarget.parentElement?.clientWidth || 0;
    dragRef.current = { id: card.id, x: shownX(card.x, layerWidth, event.currentTarget.offsetWidth), y: card.y, startX: event.clientX, startY: event.clientY };
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
        <article key={card.id} className={`writing-material-card${card.kind === 'image' ? ' writing-material-card--image' : ''}`} style={{ '--material-x': `${card.x}px`, top: card.y } as React.CSSProperties} onPointerDown={(e) => onPointerDown(e, card)} onPointerMove={onPointerMove} onPointerUp={stopDrag}>
          <header className="writing-material-card__head">
            <span className="writing-material-card__kind" aria-hidden>{card.kind === 'image' ? '▣' : '◌'}</span>
            <input value={card.title || ''} placeholder={card.kind === 'image' ? '图片素材' : '声音设计'} aria-label={card.kind === 'image' ? '图片卡标题' : '声音卡标题'} onChange={(e) => onUpdate(card.id, { title: e.target.value })} />
            <span className="writing-material-card__drag" title="拖动卡片" aria-hidden>⠿</span>
            <button type="button" title={`删除这张${card.kind === 'image' ? '图片' : '声音'}卡`} aria-label={`删除这张${card.kind === 'image' ? '图片' : '声音'}卡`} onClick={() => onDelete(card.id)}>×</button>
          </header>
          {card.kind === 'image' && card.img ? (safeEmbeddedImageSource(card.img)
            ? <img className="writing-material-card__image" src={safeEmbeddedImageSource(card.img)} alt={card.title || '图片素材'} draggable={false} />
            : <div className="bcard__empty-media">图片来源已阻止，请重新导入本地图片</div>) : null}
          <RichNoteField className="writing-material-card__note" value={card.text} placeholder={card.kind === 'image' ? '图片备注、画面灵感或场景提示…' : '声音、环境、节奏或情绪提示…'} label={card.kind === 'image' ? '图片卡备注' : '声音卡内容'} onChange={(text) => onUpdate(card.id, { text })} />
        </article>
      ))}
    </div>
  );
}
