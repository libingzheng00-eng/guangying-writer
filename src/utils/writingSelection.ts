import { domLength, domText, offsetOf, splitHtml } from './dom';

/** Read only the script's editable nodes, never scene numbers or UI controls. */
export function readWritingSelection(flow: HTMLElement | null) {
  const selection = window.getSelection();
  if (!flow || !selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!flow.contains(range.startContainer) || !flow.contains(range.endContainer)) return null;
  // 光标（没有选中文字）只可能在一段之内：直接找包住它的段落，
  // 不必在长剧本里逐段检查（回车、退格每次都会走到这里）。
  const caretNode = () => {
    const start = range.startContainer;
    const host = (start instanceof Element ? start : start.parentElement)?.closest<HTMLElement>('.sc-el--editable');
    return host && flow.contains(host) ? [host] : [];
  };
  const nodes = range.collapsed ? caretNode() : Array.from(flow.querySelectorAll<HTMLElement>('.sc-el--editable')).filter(node => {
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
    fragments: fragments.map((fragment, index) => ({ type: nodes[index].dataset.type!, html: fragment.innerHTML })),
    // External editors receive HTML/plain projections, never UI or element IDs.
    html: fragments.map(fragment => `<div>${fragment.innerHTML}</div>`).join(''),
  };
}
