import { memo } from 'react';
import { useStore } from '../../store/store';

/** 写作画布顶部的标题页摘要卡，双击进入预览。只读自己订阅的标题页，写作页刷新时不跟着重画。 */
export const TitlePageCard = memo(TitlePageCardView);

function TitlePageCardView() {
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
