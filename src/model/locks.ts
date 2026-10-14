import type { PageLock, SceneNumberLock } from './types';

/*
 * 拍摄稿的场号 / 页码锁定（与 Final Draft 的 Lock Scene Numbers / Lock Pages 同一规则）：
 * 锁定后原有编号不再变；新插入的场接在前一场后面编成 5A、5B，最前面插入的编成 A1、B1；
 * 加长后多出来的页编成 12A、12B；整页内容删掉后，前一页显示成 12-13。
 */

/** 前一个编号之后的下一个插入编号：5 → 5A，5A → 5B，5Z → 5ZA；跳过已被占用的编号。 */
export function nextInsertedNumber(previous: string, taken: ReadonlySet<string>): string {
  const match = previous.match(/^(.*?)([A-Z]*)$/);
  const base = match ? match[1] : previous;
  let letters = match ? match[2] : '';
  const bump = (value: string) => !value ? 'A' : value.endsWith('Z') ? `${value}A` : `${value.slice(0, -1)}${String.fromCharCode(value.charCodeAt(value.length - 1) + 1)}`;
  let next: string;
  do { letters = bump(letters); next = `${base}${letters}`; } while (taken.has(next));
  return next;
}

/** 按锁定表给场次编号；未锁定时就是 1、2、3…… */
export function sceneNumbersFor(headingIds: readonly string[], lock?: SceneNumberLock): string[] {
  if (!lock) return headingIds.map((_, index) => String(index + 1));
  const taken = new Set(Object.values(lock.numbers));
  const out: string[] = [];
  let previous = '';
  let seenLocked = false;
  let prefix = 0;
  headingIds.forEach((id, index) => {
    const locked = lock.numbers[id];
    let number: string;
    if (locked) { number = locked; seenLocked = true; }
    else if (seenLocked) number = nextInsertedNumber(previous, taken);
    else {
      // 第一张锁定场次之前插入的场：A1、B1……
      const firstLocked = headingIds.slice(index).map((later) => lock.numbers[later]).find(Boolean) || '1';
      do { number = `${String.fromCharCode(65 + (prefix % 26)).repeat(Math.floor(prefix / 26) + 1)}${firstLocked}`; prefix += 1; } while (taken.has(number));
    }
    taken.add(number);
    out.push(number);
    previous = number;
  });
  return out;
}

/**
 * 锁页后的页码：pageAnchors[i] 是第 i 页由哪个锁定页起头（锁定表里的下标，-1 表示新加出来的页）。
 * 返回每页显示的页码。
 */
export function lockedPageLabels(lock: PageLock, pageAnchors: readonly number[], present: ReadonlySet<number>): string[] {
  const labels: string[] = [];
  let group = -1; // 当前所在的锁定页
  let continued = 0; // 当前锁定页之后已经用掉的续页页码
  let extra = 0; // 新加出来的 A、B 页
  const rangeEnd = (from: number) => {
    // 后面紧跟的锁定页如果起头段落已删除，就并进这一页显示为区间。
    let end = from;
    for (let next = from + 1; next < lock.pages.length; next += 1) {
      const entry = lock.pages[next];
      // 续页跟着它所属的那页走：所属页并进来了，它的续页也并进来。
      if (entry.id === null) { if (end > from) end = next; continue; }
      if (present.has(next)) break;
      end = next;
    }
    return end;
  };
  pageAnchors.forEach((anchor) => {
    if (anchor >= 0) {
      group = anchor; continued = 0; extra = 0;
      const end = rangeEnd(anchor);
      labels.push(end > anchor ? `${lock.pages[anchor].label}-${lock.pages[end].label}` : lock.pages[anchor].label);
      return;
    }
    // 先用锁定时本来就有的续页页码（锁定那一刻这页从段落中间开始），用完再编 A、B。
    const nextEntry = lock.pages[group + 1 + continued];
    if (group >= 0 && nextEntry && nextEntry.id === null) { continued += 1; labels.push(nextEntry.label); return; }
    const base = group >= 0 ? lock.pages[group + continued].label : '';
    extra += 1;
    labels.push(base ? `${base}${String.fromCharCode(64 + ((extra - 1) % 26) + 1)}` : `A${lock.pages[0]?.label || '1'}`);
  });
  return labels;
}

/** 由当前分页生成锁页表：每页记下起头的段落（从段落中间续下来的页只记页码）。 */
export function pageLockFromPages(pages: ReadonlyArray<{ index: number; label?: string; items: ReadonlyArray<{ elements: ReadonlyArray<{ id: string }>; skipLines?: number }> }>,
  numberOf: (arrayIndex: number) => string): PageLock['pages'] {
  return pages.flatMap((page, arrayIndex) => {
    if (page.index < 0) return []; // 独立标题页不编号
    const first = page.items[0];
    const id = first && !first.skipLines ? first.elements[0]?.id ?? null : null;
    return [{ id, label: page.label ?? numberOf(arrayIndex) }];
  });
}

/** 未锁页时的页码（与预览 / A4 PDF 的页眉一致）：独立标题页不编号，正文从 1 起；否则从「页码起始」起。 */
export function plainPageNumber(arrayIndex: number, separateTitlePage: boolean, startPageAt: number): string {
  return String(separateTitlePage ? arrayIndex + 1 : arrayIndex + startPageAt);
}
