/** Smart double quotes are an input transformation, not a document formatter.
 * Only an identified insertion may change. Existing quotes, attributes and
 * formatting remain untouched; all offsets use DOM UTF-16 with BR = one.
 */
export interface QuoteInsertion {
  data: string | null;
  /** Caret after a normal insertText; not an HTML character offset. */
  caret: number;
  /** Original selection captured before an IME composition started. */
  selection?: { start: number; end: number };
}

interface TextPart { node: Text; start: number }

function projection(html: string) {
  // Unlike a mounted div, template contents are inert (including image URLs).
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const parts: TextPart[] = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push({ node: node as Text, start: text.length });
      text += node.nodeValue || '';
    } else if (node.nodeName === 'BR') text += '\n';
  }
  return { template, parts, text };
}

const openingContext = /[([{（［｛【〈《「『:：—–]/u;
const word = /[\p{L}\p{N}]/u;

function escaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

/** Read neighboring code points without splitting emoji/surrogate pairs. */
function before(text: string, index: number): string {
  if (!index) return '';
  const last = text.charCodeAt(index - 1);
  return last >= 0xdc00 && last <= 0xdfff && index >= 2 ? text.slice(index - 2, index) : text[index - 1];
}

function after(text: string, index: number): string {
  const point = text.codePointAt(index + 1);
  return point === undefined ? '' : String.fromCodePoint(point);
}

function direction(text: string, index: number, open: number): '“' | '”' | null {
  if (escaped(text, index)) return null;
  // A known unmatched opener wins over the previous punctuation: “ABC:”
  // must close after its colon, not start another automatic quote level.
  if (open > 0) return '”';
  const left = before(text, index), right = after(text, index);
  // Do not guess embedded word/measurement/literal quotes. An explicit opener
  // still lets a quoted number close: “123” is not a 123-inch measurement.
  if (word.test(left) && word.test(right)) return null;
  if (!left || openingContext.test(left)) return '“';
  if (/\s/u.test(left)) return '“';
  return null; // A lone trailing quote has no trustworthy matching opener.
}

export function applySmartDoubleQuotes(previousHtml: string, nextHtml: string, insertion: QuoteInsertion): string {
  const { data, caret, selection } = insertion;
  if (!data?.includes('"')) return nextHtml;
  const current = projection(nextHtml), previous = projection(previousHtml);
  const start = selection ? selection.start : caret - data.length;
  const end = start + data.length;
  const removedEnd = selection ? selection.end : previous.text.length - (current.text.length - end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(removedEnd) ||
      start < 0 || removedEnd < start || removedEnd > previous.text.length || end > current.text.length ||
      current.text.slice(start, end) !== data ||
      previous.text.slice(0, start) + data + previous.text.slice(removedEnd) !== current.text) return nextHtml;

  let open = 0;
  const replacements = new Map<number, string>();
  // Read earlier quotes for context only. Never "fix" old or manually supplied
  // punctuation; a pasted straight opener can guide a newly typed closer.
  for (let i = 0; i < end; i++) {
    const char = current.text[i];
    if (char !== '“' && char !== '”' && char !== '"') continue;
    if (escaped(current.text, i)) continue;
    if (char === '“') { open++; continue; }
    if (char === '”') { open = Math.max(0, open - 1); continue; }
    if (char !== '"') continue;
    const replacement = direction(current.text, i, open);
    if (replacement === '“') open++;
    else if (replacement === '”') open = Math.max(0, open - 1);
    if (i >= start && replacement) replacements.set(i, replacement);
  }
  if (!replacements.size) return nextHtml;
  for (const part of current.parts) {
    const value = part.node.data;
    let changed = false;
    const transformed = value.replace(/"/g, (char, offset: number) => {
      const replacement = replacements.get(part.start + offset);
      if (replacement) changed = true;
      return replacement || char;
    });
    if (changed) part.node.data = transformed;
  }
  return current.template.innerHTML;
}
