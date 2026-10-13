import { sanitizeProjectHtml } from './projectHtml';
import { escapeHtml, plain } from './text';

/**
 * 卡片简介与灵感文字（SceneMeta.synopsis / Beat.text）可以带粗体、斜体、下划线。
 * 旧工程里它们是纯文本，所以只有出现这几种格式标签时才按 HTML 解释；
 * 否则一律当作纯文本转义，并把换行变成 <br>。
 */
const FORMATTED = /<\/?(?:b|strong|i|em|u|br|div|p|span)\b[^>]*>/i;

export function isRichNote(value: string): boolean {
  return FORMATTED.test(value);
}

/** 显示到 contenteditable 之前的安全 HTML。 */
export function richNoteHtml(value: string | undefined): string {
  const text = value || '';
  if (!text) return '';
  if (!isRichNote(text)) return escapeHtml(text).replace(/\r?\n/g, '<br>');
  try { return sanitizeProjectHtml(text); } catch { return escapeHtml(plain(text)).replace(/\n/g, '<br>'); }
}

/** 从编辑区读回要保存的值：没有任何格式时保存为纯文本，旧版本也能正常显示。 */
export function richNoteValue(html: string): string {
  const cleaned = html
    .replace(/<(\/?)strong\b[^>]*>/gi, '<$1b>')
    .replace(/<(\/?)em\b[^>]*>/gi, '<$1i>')
    .replace(/<div[^>]*>(?:<br\s*\/?>)?<\/div>/gi, '<br>')
    .replace(/<div[^>]*>/gi, '<br>').replace(/<\/div>/gi, '')
    .replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '<br>')
    .replace(/<span[^>]*>/gi, '').replace(/<\/span>/gi, '')
    .replace(/^(?:<br\s*\/?>)+|(?:<br\s*\/?>)+$/gi, '');
  if (!/<\/?(?:b|i|u)\b/i.test(cleaned)) return plain(cleaned);
  return sanitizeProjectHtml(cleaned);
}

/** 只读场合（导航、统计、比较）用的纯文字。 */
export function richNotePlain(value: string | undefined): string {
  const text = value || '';
  return isRichNote(text) ? plain(text) : text;
}
