import { makeTextRange, offsetOf } from '../utils/dom';
import { useStore } from '../store/store';
import { ownsNativeHistory, runEditHistory, type HistoryDirection } from '../utils/editHistory';

export function createModalSession() {
  const initial = useStore.getState();
  let blocked: Set<typeof initial.project> | null = null;
  const restore = captureModalReturnFocus();
  initial.breakHistoryGroup();
  return {
    activate() {
      if (blocked) return;
      // Moving focus can commit an existing board-title/link draft on blur.
      // That is background history, so establish this boundary only after the
      // first handoff. StrictMode must not reset it on its effect replay.
      const state = useStore.getState();
      blocked = new Set([...state.past, ...state.future]);
      state.breakHistoryGroup();
    },
    restore() {
      if (useStore.getState().documentEpoch === initial.documentEpoch) restore();
      useStore.getState().breakHistoryGroup();
    },
    history(direction: HistoryDirection) {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !active.closest('[aria-modal="true"]')) return;
      if (ownsNativeHistory(active)) { runEditHistory(direction); return; }
      const state = useStore.getState();
      const target = direction === 'undo' ? state.past[state.past.length - 1] : state.future[0];
      // Settings retain their existing immediate project updates. Only snapshots
      // created during this modal session may be undone/redone here; the opening
      // project itself is a valid undo destination, older writing is not.
      if (state.documentEpoch === initial.documentEpoch && target && blocked && !blocked.has(target)) runEditHistory(direction);
    },
  };
}

export type ModalSession = ReturnType<typeof createModalSession>;

/** Ephemeral UI state only. No bookmark is written to the project/history. */
export function captureModalReturnFocus() {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const activeWritingId = active?.matches('.script-flow .sc-el--editable') ? active.dataset.id : undefined;
  const cardTitleId = active?.matches('input.bcard__media-title') ? active.closest<HTMLElement>('.bcard[data-id]')?.dataset.id : undefined;
  const linkId = active?.matches('.board-link__input') ? active.closest<SVGElement>('.board-link[data-link-id]')?.dataset.linkId : undefined;
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const blockAt = (node: Node) => (node instanceof Element ? node : node.parentElement)
    ?.closest<HTMLElement>('.script-flow .sc-el--editable');
  const start = range && blockAt(range.startContainer);
  const end = range && blockAt(range.endContainer);
  const bookmark = range && start?.dataset.id && end?.dataset.id ? {
    startId: start.dataset.id, endId: end.dataset.id,
    start: offsetOf(start, range.startContainer, range.startOffset),
    end: offsetOf(end, range.endContainer, range.endOffset),
    backward: selection?.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset && !range.collapsed,
  } : null;
  const inputSelection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection } : null;
  return () => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.script-flow .sc-el--editable'));
    const cardTitle = cardTitleId && Array.from(document.querySelectorAll<HTMLElement>('.bcard[data-id]'))
      .find(node => node.dataset.id === cardTitleId)?.querySelector<HTMLElement>('.bcard__media-title[role="button"]');
    const linkLabel = linkId && Array.from(document.querySelectorAll<SVGElement>('.board-link[data-link-id]'))
      .find(node => node.dataset.linkId === linkId)?.querySelector<HTMLElement>('.board-link__label');
    const target = active?.isConnected ? active : nodes.find(node => node.dataset.id === activeWritingId) || cardTitle || linkLabel;
    // Focusing an editable can reset the browser selection. Focus the restored
    // writing host first, then reapply its saved (possibly backward) range.
    if (target && activeWritingId && !target.closest('[inert]')) target.focus({ preventScroll: true });
    const from = bookmark && nodes.find(node => node.dataset.id === bookmark.startId);
    const to = bookmark && nodes.find(node => node.dataset.id === bookmark.endId);
    if (bookmark && from && to && selection) {
      const first = makeTextRange(from, bookmark.start, bookmark.start);
      const last = makeTextRange(to, bookmark.end, bookmark.end);
      if (bookmark.backward) selection.setBaseAndExtent(last.startContainer, last.startOffset, first.startContainer, first.startOffset);
      else selection.setBaseAndExtent(first.startContainer, first.startOffset, last.startContainer, last.startOffset);
    }
    if (target && !activeWritingId && !target.closest('[inert]')) {
      target.focus({ preventScroll: true });
      if (target === active && inputSelection?.start != null && inputSelection.end != null &&
          (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
        active.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction || undefined);
      }
    }
  };
}

export function modalTabStops(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex], [contenteditable="true"]'))
    .filter(node => node.tabIndex >= 0 && !node.matches(':disabled, [type="hidden"]') && !node.closest('[hidden], [inert]'))
    .filter(node => {
      for (let current: HTMLElement | null = node; current && current !== dialog; current = current.parentElement) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    });
}

function revealModalControl(dialog: HTMLElement, target: HTMLElement) {
  const body = target.closest<HTMLElement>('.modal__body');
  if (!body || !dialog.contains(body)) return;
  const viewport = body.getBoundingClientRect(), control = target.getBoundingClientRect();
  if (!body.clientHeight || !control.height) return;
  // Native textarea focus can reveal only its caret, leaving most of the
  // control clipped. Reveal its whole border box, with room for the focus ring,
  // by scrolling only the modal body (never the writing surface behind it).
  const top = viewport.top + body.clientTop + 4;
  const bottom = viewport.top + body.clientTop + body.clientHeight - 4;
  if (control.top < top || control.height > bottom - top) body.scrollTop += control.top - top;
  else if (control.bottom > bottom) body.scrollTop += control.bottom - bottom;
}

/** Inert is the browser boundary; capture listeners also reject stale queued
 * background events and keep focus contained in environments without inert. */
export function containModal(dialog: HTMLElement, backdrop: HTMLElement, close: () => void) {
  const isolated = new Map<HTMLElement, { inert: string | null; hidden: string | null }>();
  const isolate = () => {
    for (let branch: HTMLElement | null = backdrop; branch?.parentElement; branch = branch.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (!(sibling instanceof HTMLElement) || sibling === branch || isolated.has(sibling)) continue;
        isolated.set(sibling, { inert: sibling.getAttribute('inert'), hidden: sibling.getAttribute('aria-hidden') });
        sibling.setAttribute('inert', '');
        sibling.setAttribute('aria-hidden', 'true');
      }
      if (branch.parentElement === document.body) break;
    }
  };
  let lastFocus: HTMLElement | null = null;
  let composing = false;
  const focusControl = (target: HTMLElement) => {
    target.focus({ preventScroll: true });
    revealModalControl(dialog, target);
  };
  const focusInside = () => {
    const preferred = dialog.querySelector<HTMLElement>('[data-modal-autofocus]');
    const stops = modalTabStops(dialog);
    const target = lastFocus?.isConnected && dialog.contains(lastFocus) && stops.includes(lastFocus)
      ? lastFocus : preferred && stops.includes(preferred) ? preferred : stops[0] || dialog;
    focusControl(target);
  };
  const focus = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement && dialog.contains(event.target)) {
      lastFocus = event.target;
      revealModalControl(dialog, event.target);
    }
    else { event.stopImmediatePropagation(); focusInside(); }
  };
  const blockOutside = (event: Event) => {
    if (event.target instanceof Node && backdrop.contains(event.target)) return;
    if (event.type === 'keydown') focusInside();
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const key = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || composing) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); close();
    } else if (event.key === 'Tab') {
      const stops = modalTabStops(dialog);
      const index = stops.indexOf(document.activeElement as HTMLElement);
      event.preventDefault(); event.stopImmediatePropagation();
      const next = index < 0 ? (event.shiftKey ? stops.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
      focusControl(stops[next] || dialog);
    }
  };
  const compositionStart = () => { composing = true; };
  const compositionEnd = () => { composing = false; };
  const blockedEvents = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'keydown', 'beforeinput', 'input', 'change', 'cut', 'copy', 'paste', 'drop', 'dragover'];
  // Move focus before hiding its previous ancestor from accessibility APIs.
  document.addEventListener('focusin', focus, true);
  document.addEventListener('keydown', key, true);
  blockedEvents.forEach(type => document.addEventListener(type, blockOutside, true));
  dialog.addEventListener('compositionstart', compositionStart);
  dialog.addEventListener('compositionend', compositionEnd);
  focusInside();
  isolate();
  const observer = new window.MutationObserver(() => {
    isolate();
    // Removing a focused revision row/tab body need not emit focusin. Do not
    // leave focus on body where the isolation guard would consume every key.
    if (!dialog.contains(document.activeElement)) focusInside();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    document.removeEventListener('focusin', focus, true);
    blockedEvents.forEach(type => document.removeEventListener(type, blockOutside, true));
    document.removeEventListener('keydown', key, true);
    dialog.removeEventListener('compositionstart', compositionStart);
    dialog.removeEventListener('compositionend', compositionEnd);
    for (const [node, before] of isolated) {
      if (before.inert === null) node.removeAttribute('inert'); else node.setAttribute('inert', before.inert);
      if (before.hidden === null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', before.hidden);
    }
  };
}
