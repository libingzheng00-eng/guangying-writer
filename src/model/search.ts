import type { ElementType, ScriptElement } from './types';
import { plain } from '../utils/text';

export interface SearchOptions {
  caseSensitive?: boolean;
  /** 每条结果两侧最多保留的 UTF-16 字符数，默认 28。 */
  contextLength?: number;
}

export interface SearchMatch {
  elementId: string;
  type: ElementType;
  /** 在 searchText(element.text) 中的 UTF-16 偏移，end 不包含末位。 */
  start: number;
  end: number;
  snippet: string;
  /** snippet 在完整纯文本中的起点；高亮范围为 start/end 减去此值。 */
  snippetStart: number;
}

/**
 * 与 dom.ts atoms 相同的偏移契约：文本节点按 UTF-16，BR 计一个换行，
 * P/DIV 闭合不额外计字。惰性的 template 不挂载，不加载图片或执行脚本。
 * 此投影只供查找使用，不能替换分页、统计和导出的全局 plain()。
 */
export function searchText(html: string): string {
  if (!html) return '';
  if (typeof document !== 'undefined') {
    const template = document.createElement('template');
    template.innerHTML = html;
    const walker = document.createTreeWalker(template.content, 1 | 4);
    const parts: string[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) parts.push(node.nodeValue || '');
      else if (node.nodeName === 'BR') parts.push('\n');
    }
    return parts.join('');
  }
  // Node/SSR 兜底：先去标签，再一次性解码；避免 &amp;#65; 被二次解码为 A。
  const text = plain(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/(p|div|h[1-6])>/gi, '').replace(/&/g, '\u0000'));
  return text.replace(/\u0000(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (_entity, name: string) => {
    if (name[0] !== '#') return name.toLowerCase() === 'nbsp' ? '\u00a0' : plain(`&${name};`);
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code) : '\ufffd';
  }).replace(/\u0000/g, '&');
}

/**
 * 正文只读查找：包括备忘、省略段与双列各自的元素，不搜索卡片或标题页。
 * 遵循编辑器 DOM 的文本/BR 偏移语义，不拼接段落、不改正文和历史。
 * 特殊字符始终按字面匹配；非重叠命中按正文顺序返回。
 */
export function searchScript(
  elements: readonly ScriptElement[],
  query: string,
  options: SearchOptions = {},
): SearchMatch[] {
  if (!query) return [];
  const contextLength = Number.isFinite(options.contextLength)
    ? Math.max(0, Math.floor(options.contextLength!))
    : 28;
  // 不能先把原文转小写：例如 İ 小写会变长，导致编辑器定位偏移。
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, options.caseSensitive ? 'gu' : 'giu');
  const results: SearchMatch[] = [];
  for (const element of elements) {
    const text = searchText(element.text);
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      let snippetStart = Math.max(0, start - contextLength);
      let snippetEnd = Math.min(text.length, end + contextLength);
      // 不把 emoji 等代理对从中间裁开；不改变匹配的原文偏移。
      if (snippetStart > 0 && /[\uDC00-\uDFFF]/.test(text[snippetStart])) snippetStart -= 1;
      if (snippetEnd < text.length && /[\uDC00-\uDFFF]/.test(text[snippetEnd])) snippetEnd += 1;
      results.push({
        elementId: element.id,
        type: element.type,
        start,
        end,
        snippet: text.slice(snippetStart, snippetEnd),
        snippetStart,
      });
    }
  }
  return results;
}
