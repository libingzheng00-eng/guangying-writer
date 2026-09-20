import { domLength, domText, offsetOf, splitHtml } from './dom';

/** Read only the script's editable nodes, never scene numbers or UI controls. */
export function readWritingSelection(flow: HTMLElement | null) {
  const selection = window.getSelection();
  if (!flow || !selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!flow.contains(range.startContainer) || !flow.contains(range.endContainer)) return null;
  const nodes = Array.from(flow.querySelectorAll<HTMLElement>('.sc-el--editable')).filter(node => {
    if (range.collapsed) return node.contains(range.startContainer);
    if (!range.intersectsNode(node)) return false;
    const contents = document.createRange();
    contents.selectNodeContents(node);
    return range.compareBoundaryPoints(Range.END_TO_START, contents) < 0 &&
      range.compareBoundaryPoints(Range.START_TO_END, contents) > 0;
  });
  if (!nodes.length) return null;
  const first = nodes[0], last = nodes[nodes.length - 1];
  const start = first.contains(range.startContainer) ? offsetOf(first, range.startContainer, range.startOffset) : 0;
  const end = last.contains(range.endContainer) ? offsetOf(last, range.endContainer, range.endOffset) : domLength(last);
  const fragments = nodes.map((node, i) => {
    const tail = document.createElement('div');
    tail.innerHTML = splitHtml(node, i === nodes.length - 1 ? end : domLength(node)).before;
    const selected = document.createElement('div');
    selected.innerHTML = splitHtml(tail, i === 0 ? start : 0).after;
    return selected;
  });
  return {
    ids: nodes.map(n => n.dataset.id!), start, collapsed: range.collapsed,
    before: splitHtml(first, start).before,
    after: splitHtml(last, end).after,
    text: fragments.map(domText).join('\n'),
    // Keep rich copy for external editors; our existing paste policy stays plain text.
    html: fragments.map(fragment => `<div>${fragment.innerHTML}</div>`).join(''),
  };
}
