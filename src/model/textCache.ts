import { plain, countPlainWords } from '../utils/text';

/**
 * 每段正文的纯文本与字数缓存。
 *
 * 打字时只有正在写的那一段换成新对象，其余段落保持同一个对象，所以按段落对象缓存，
 * 状态栏字数、人物统计、场景占比在每次按键后只需重算这一段，而不是整部剧本。
 * 同时核对 text 字段：万一有人原地改了段落，也不会读到旧值。段落对象被丢弃后缓存随之回收。
 */
interface Derived {
  html: string;
  plain: string;
  words?: number;
  han?: number;
  compact?: number;
}

const cache = new WeakMap<object, Derived>();

function derived(element: { text: string }): Derived {
  const html = element.text || '';
  let entry = cache.get(element);
  if (!entry || entry.html !== html) {
    entry = { html, plain: plain(html) };
    cache.set(element, entry);
  }
  return entry;
}

/** 去掉行内标记后的纯文本，与 plain(element.text) 相同。 */
export function plainOf(element: { text: string }): string {
  return derived(element).plain;
}

/** 与 countWords(element.text) 相同。 */
export function wordsOf(element: { text: string }): number {
  const entry = derived(element);
  return entry.words ??= countPlainWords(entry.plain);
}

/** 汉字个数（基本区），与原状态栏统计一致。 */
export function hanCountOf(element: { text: string }): number {
  const entry = derived(element);
  return entry.han ??= entry.plain.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
}

/** 去掉所有空白后的字符数（场景占比、人物台词量）。 */
export function compactLengthOf(element: { text: string }): number {
  const entry = derived(element);
  return entry.compact ??= entry.plain.replace(/\s/g, '').length;
}
