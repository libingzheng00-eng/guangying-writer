import type { SmartTypeSuggestion } from '../../model/smarttype';

/** 快捷输入候选列表。按下即确认（mousedown 阻止失焦，保持正文光标）。 */
export function SmartTypeMenu({ suggest, onAccept }: {
  suggest: { top: number; left: number; active: number; type: string; items: SmartTypeSuggestion[] };
  onAccept: (index: number) => void;
}) {
  return (
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
            onAccept(i);
          }}
        >
          <span className="smarttype__label">{s.label}</span>
          {s.typeLabel ? <small className="smarttype__type"> · {s.typeLabel}</small> : null}
        </button>
      ))}
      <div className="smarttype__hint">↑↓ 选择 · → / Enter 确认 · 再按 Enter 换段</div>
    </div>
  );
}
