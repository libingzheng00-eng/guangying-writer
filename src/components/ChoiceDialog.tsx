import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { setChoiceHost, type ChoiceRequest } from '../app/choiceDialog';
import { containModal, createModalSession } from '../app/modalFocus';

type Pending = { request: ChoiceRequest; resolve: (value: string) => void };

/** Mounted once by App; shows one choice at a time with the shared modal focus rules. */
export function ChoiceDialogHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  useEffect(() => setChoiceHost((request, resolve) => setQueue(list => [...list, { request, resolve }])), []);
  const current = queue[0];
  if (!current) return null;
  const finish = (value: string) => { current.resolve(value); setQueue(list => list.slice(1)); };
  return <ChoiceDialog key={queue.length + current.request.title} request={current.request} onChoose={finish} />;
}

function ChoiceDialog({ request, onChoose }: { request: ChoiceRequest; onChoose: (value: string) => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const choose = useRef(onChoose);
  choose.current = onChoose;
  useLayoutEffect(() => {
    const node = dialog.current!;
    const session = createModalSession();
    const cleanup = containModal(node, node.parentElement!, () => choose.current(request.cancelValue));
    session.activate();
    return () => { cleanup(); queueMicrotask(() => { if (!document.querySelector('[aria-modal="true"]')) session.restore(); }); };
  }, [request]);
  const autofocus = request.options.find(option => option.tone === 'primary')?.value ?? request.cancelValue;
  return <div className="modal-backdrop" data-export-exclude
    onMouseDown={event => { if (event.target === event.currentTarget) event.preventDefault(); }}
    onClick={event => { if (event.target === event.currentTarget) onChoose(request.cancelValue); }}>
    <div ref={dialog} className="modal choice-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="modal__head"><h3 id={titleId}>{request.title}</h3>
        <button className="icon-btn" aria-label="关闭" onClick={() => onChoose(request.cancelValue)}>×</button></header>
      <div className="modal__body">
        <p className="choice-dialog__message">{request.message}</p>
        {request.warning && <p className="choice-dialog__warning" role="alert">{request.warning}</p>}
        <div className="choice-dialog__actions">
          {request.options.map(option => <button key={option.value}
            className={`btn${option.tone === 'primary' ? ' btn--primary' : option.tone === 'danger' ? ' btn--danger' : ''}`}
            data-choice={option.value} {...(option.value === autofocus ? { 'data-modal-autofocus': '' } : {})}
            onClick={() => onChoose(option.value)}>{option.label}</button>)}
        </div>
      </div>
    </div>
  </div>;
}
