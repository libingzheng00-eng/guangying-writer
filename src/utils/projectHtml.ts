import { defaultTreeAdapter, parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { escapeHtml } from './text';

// Project text is a screenplay fragment, never a document, image card or link.
// Keep historical browser formatting wrappers without accepting active HTML.
const tags = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'span', 'div', 'p', 's', 'strike', 'del', 'sub', 'sup']);
const htmlNamespace = 'http://www.w3.org/1999/xhtml';
export const MAX_PROJECT_HTML_LENGTH = 2_000_000;
export const MAX_PROJECT_HTML_DEPTH = 256;
export const MAX_PROJECT_HTML_NODES = 20_000;
const MAX_TAG_LENGTH = 16_384;
const MAX_TAG_ATTRIBUTES = 128;
const tooComplex = () => new Error('工程正文格式过大或嵌套过深，请拆分段落后重试');

function isPlainFormatting(html: string): boolean {
  const token = /<\/?[a-z]+>|<br[\t\n\f\r ]*\/?>/iy;
  const stack: string[] = [];
  let position = 0, count = 0, previous = 0;
  const countNode = () => { if (++count > MAX_PROJECT_HTML_NODES) throw tooComplex(); };
  while ((position = html.indexOf('<', position)) >= 0) {
    if (position > previous) countNode();
    token.lastIndex = position;
    const match = token.exec(html);
    if (!match) return false;
    position = token.lastIndex;
    previous = position;
    const value = match[0].toLowerCase();
    if (/^<br[\t\n\f\r ]*\/?>$/.test(value)) { countNode(); continue; }
    const closing = value[1] === '/';
    const tag = value.slice(closing ? 2 : 1, -1);
    if (!tags.has(tag) || tag === 'br') return false;
    if (closing) {
      if (stack.pop() !== tag) return false;
    } else {
      countNode();
      // A block start implicitly closes P in HTML; let the parser normalize it.
      if ((tag === 'div' || tag === 'p') && stack.includes('p')) return false;
      stack.push(tag);
      if (stack.length > MAX_PROJECT_HTML_DEPTH) throw tooComplex();
    }
  }
  if (previous < html.length) countNode();
  return stack.length === 0;
}

function guardTokenization(html: string) {
  // parse5 checks each attribute against earlier names before treeAdapter sees
  // it. Bound that work first. This linear-budget scan only rejects excessive
  // input; parse5 and the allowlist still make every HTML safety decision.
  // Inspect EVERY apparent tag, even inside comments/quoted strings, so a false
  // earlier tag cannot hide a real expensive one. Ambiguous overlapping scans
  // share a budget and may be rejected rather than becoming quadratic here.
  let budget = html.length * 4 + MAX_TAG_LENGTH;
  for (let start = html.indexOf('<'); start >= 0; start = html.indexOf('<', start + 1)) {
    let position = start + (html[start + 1] === '/' ? 2 : 1);
    if (!/[a-z]/i.test(html[position] || '')) continue;
    let state: 'tag' | 'before' | 'name' | 'after' | 'value' | 'single' | 'double' | 'unquoted' = 'tag';
    let attributes = 0;
    for (; position < html.length; position++) {
      if (--budget < 0 || position - start > MAX_TAG_LENGTH) throw tooComplex();
      const char = html[position];
      if (state === 'single' || state === 'double') {
        if (char === (state === 'single' ? "'" : '"')) state = 'before';
        continue;
      }
      if (char === '>') break;
      const whitespace = /[\t\n\f\r ]/.test(char);
      if (state === 'tag') {
        if (whitespace || char === '/') state = 'before';
      } else if (state === 'value') {
        if (!whitespace) state = char === "'" ? 'single' : char === '"' ? 'double' : 'unquoted';
      } else if (state === 'unquoted') {
        if (whitespace) state = 'before';
      } else if (state === 'name') {
        if (whitespace) state = 'after';
        else if (char === '/') state = 'before';
        else if (char === '=') state = 'value';
      } else if (char === '=' && state === 'after') {
        state = 'value';
      } else if (char === '/') {
        state = 'before';
      } else if (!whitespace) {
        if (++attributes > MAX_TAG_ATTRIBUTES) throw tooComplex();
        state = 'name';
      }
    }
  }
}

function boundedFragment(html: string) {
  guardTokenization(html);
  type Parent = DefaultTreeAdapterMap['parentNode'];
  const templates = new WeakMap<Parent, Parent>();
  let nodes = 0;
  const countNode = () => { if (++nodes > MAX_PROJECT_HTML_NODES) throw tooComplex(); };
  const guardDepth = (parent: Parent) => {
    let depth = 0;
    for (let current: Parent | null = parent; current;
      current = 'parentNode' in current ? current.parentNode : templates.get(current) || null) {
      if (++depth > MAX_PROJECT_HTML_DEPTH) throw tooComplex();
    }
  };
  // Stop tree construction itself before deeply nested hostile input can build
  // an unbounded tree. Template contents need their detached ancestry tracked.
  return parseFragment(html, { treeAdapter: {
    ...defaultTreeAdapter,
    createElement(...args) {
      countNode();
      return defaultTreeAdapter.createElement(...args);
    },
    createCommentNode(...args) { countNode(); return defaultTreeAdapter.createCommentNode(...args); },
    insertText(parent, text) {
      const before = parent.childNodes.length;
      defaultTreeAdapter.insertText(parent, text);
      if (parent.childNodes.length > before) countNode();
    },
    insertTextBefore(parent, text, reference) {
      const before = parent.childNodes.length;
      defaultTreeAdapter.insertTextBefore(parent, text, reference);
      if (parent.childNodes.length > before) countNode();
    },
    appendChild(parent, child) { guardDepth(parent); defaultTreeAdapter.appendChild(parent, child); },
    insertBefore(parent, child, reference) { guardDepth(parent); defaultTreeAdapter.insertBefore(parent, child, reference); },
    setTemplateContent(template, content) {
      templates.set(content, template);
      guardDepth(template);
      defaultTreeAdapter.setTemplateContent(template, content);
    },
  } });
}
// These containers are not screenplay text. Do not turn script/style source or
// foreign-namespace descendants into visible writing while removing the shell.
const discardContents = new Set([
  'script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed',
  'textarea', 'title', 'xmp', 'noembed', 'noframes', 'plaintext',
]);

/** Preserve only the basic inline formatting the editor can author. Fixed value
 * grammars exclude URLs, variables, escapes, comments and arbitrary CSS. The
 * returned declarations are newly assembled, not copied from the input.
 */
function formattingStyle(source: string): string {
  const properties = new Map<string, string>();
  for (const declaration of source.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim().toLowerCase().replace(/\s+/g, ' ');
    const valid = name === 'font-weight' ? /^(?:normal|bold|[1-9]00)$/.test(value)
      : name === 'font-style' ? /^(?:normal|italic|oblique)$/.test(value)
      : name === 'text-decoration' || name === 'text-decoration-line'
        ? /^(?:none|(?:underline|overline|line-through)(?: (?:underline|overline|line-through))*)$/.test(value)
        : false;
    if (valid) properties.set(name, value);
  }
  return [...properties].map(([name, value]) => `${name}: ${value}`).join('; ');
}

/** Load-boundary sanitizer shared by .zhsp opening and automatic recovery.
 * parse5 parses without a live DOM or network access. Only fresh allowlisted
 * tags/formatting and escaped text reach the renderer's innerHTML sinks.
 * Do not call this on each input event: loading is outside the writing/IME and
 * undo transactions, and authored safe text needs no repeated normalization.
 */
export function sanitizeProjectHtml(html: string): string {
  if (html.length > MAX_PROJECT_HTML_LENGTH) throw tooComplex();
  // No attributes, comments or unknown start tags: preserve the existing bytes,
  // including entities, NBSP, quote spelling, case and soft-line-break spelling.
  // Character references in HTML text cannot introduce a new markup token.
  if (isPlainFormatting(html)) return html;

  const fragment = boundedFragment(html);
  type HtmlNode = DefaultTreeAdapterMap['childNode'];
  const stack: Array<HtmlNode | string> = [];
  const output: string[] = [];
  const pushChildren = (node: { childNodes: HtmlNode[] }) => {
    for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
  };
  pushChildren(fragment);
  while (stack.length) {
    const item = stack.pop()!;
    if (typeof item === 'string') { output.push(item); continue; }
    if ('value' in item) { output.push(escapeHtml(item.value).replace(/\u00a0/g, '&nbsp;')); continue; }
    if (!('tagName' in item) || item.namespaceURI !== htmlNamespace || discardContents.has(item.tagName)) continue;
    if (tags.has(item.tagName)) {
      const style = formattingStyle(item.attrs.find(attr => attr.name === 'style' && !attr.namespace)?.value || '');
      output.push(`<${item.tagName}${style ? ` style="${escapeHtml(style)}"` : ''}>`);
      if (item.tagName === 'br') continue;
      stack.push(`</${item.tagName}>`);
    }
    // Unknown inert wrappers (including A) retain their words but no tag, event,
    // URL, identity, class or data attributes. Media cannot become inline images.
    pushChildren(item);
  }
  return output.join('');
}
