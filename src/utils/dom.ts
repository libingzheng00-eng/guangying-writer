/** contenteditable 的光标与内容切分工具（兼容中文输入法） */

interface Atom {
  node: Node;
  len: number;
  isBr: boolean;
}

function atoms(root: HTMLElement): Atom[] {
  const list: Atom[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n: Node | null = walker.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) {
      list.push({ node: n, len: n.nodeValue ? n.nodeValue.length : 0, isBr: false });
    } else if (n.nodeName === 'BR') {
      list.push({ node: n, len: 1, isBr: true });
    }
    n = walker.nextNode();
  }
  return list;
}

/** 元素的文本长度（<br> 计 1） */
export function domLength(root: HTMLElement): number {
  return atoms(root).reduce((n, a) => n + a.len, 0);
}

export function offsetOf(root: HTMLElement, container: Node, offset: number): number {
  if (container.nodeType === Node.TEXT_NODE) {
    let acc = 0;
    for (const a of atoms(root)) {
      if (a.node === container) return acc + Math.min(offset, a.len);
      acc += a.len;
    }
    return acc;
  }
  let acc = 0;
  for (const a of atoms(root)) {
    const parent = a.node.parentNode;
    if (!parent) continue;
    const idx = Array.prototype.indexOf.call(parent.childNodes, a.node);
    if (container === parent && idx >= offset) return acc;
    acc += a.len;
  }
  return acc;
}

/** 当前光标在 root 中的文本偏移，不在 root 内返回 -1 */
export function caretOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return -1;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.endContainer)) return -1;
  return offsetOf(root, range.endContainer, range.endOffset);
}



function locate(root: HTMLElement, target: number): { node: Node; offset: number } {
  let acc = 0;
  const list = atoms(root);
  for (const a of list) {
    if (acc + a.len >= target) {
      if (a.isBr) {
        const parent = a.node.parentNode as Node;
        const idx = Array.prototype.indexOf.call(parent.childNodes, a.node);
        return target === acc ? { node: parent, offset: idx } : { node: parent, offset: idx + 1 };
      }
      return { node: a.node, offset: Math.min(target - acc, a.len) };
    }
    acc += a.len;
  }
  const last = list[list.length - 1];
  if (last && !last.isBr) return { node: last.node, offset: last.len };
  return { node: root, offset: root.childNodes.length };
}

export function setCaret(root: HTMLElement, offset: number | 'start' | 'end') {
  const target = offset === 'start' ? 0 : offset === 'end' ? domLength(root) : offset;
  const pos = locate(root, Math.max(0, target));
  const range = document.createRange();
  try {
    range.setStart(pos.node, pos.offset);
  } catch {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

/** 在光标位置把 innerHTML 切成两半 */
export function splitHtml(root: HTMLElement, offset: number): { before: string; after: string } {
  const pos = locate(root, offset);
  const r1 = document.createRange();
  r1.setStart(root, 0);
  r1.setEnd(pos.node, pos.offset);
  const r2 = document.createRange();
  r2.setStart(pos.node, pos.offset);
  r2.setEnd(root, root.childNodes.length);
  const d1 = document.createElement('div');
  d1.appendChild(r1.cloneContents());
  const d2 = document.createElement('div');
  d2.appendChild(r2.cloneContents());
  return { before: d1.innerHTML, after: d2.innerHTML };
}
