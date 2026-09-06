/** 去除行内标记，得到纯文本 */
export function plain(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

/** 统计中文字数：中文字符 + 英文单词 + 数字串 */
export function countWords(text: string): number {
  const t = plain(text);
  if (!t) return 0;
  const cjk = t.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff]/g)?.length ?? 0;
  const words = t.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff]/g, ' ')
    .match(/[A-Za-z0-9_'’\-]+/g)?.length ?? 0;
  return cjk + words;
}

/** 只统计中文字符数 */
export function countCJK(text: string): number {
  return plain(text).match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0;
}

export function isBlank(html: string): boolean {
  return plain(html).trim() === '';
}

/** 英文引号 → 中文引号 */
export function smartQuotes(s: string): string {
  let out = s;
  let open = true;
  out = out.replace(/"/g, () => (open ? '“' : '”'));
  open = true;
  return out.replace(/"/g, () => {
    open = !open;
    return open ? '‘' : '’';
  });
}

/** 中文数字转阿拉伯数字（自动编号用不到，仅保留工具） */
export function cnNum(n: number): string {
  const chars = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return chars[n];
  if (n < 20) return '十' + (n % 10 ? chars[n % 10] : '');
  if (n < 100) return chars[Math.floor(n / 10)] + '十' + (n % 10 ? chars[n % 10] : '');
  return String(n);
}

/** 把秒数格式化为 mm:ss */
export function fmtDuration(minutes: number): string {
  const total = Math.round(minutes * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 自动编号时，去掉场次标题里手写的序号前缀
 * 「1. 内景 咖啡厅 日」→「内景 咖啡厅 日」
 */
export function stripSceneNumber(text: string): string {
  return text.replace(/^\s*\d+\s*[.、．:：-]\s*/, '').replace(/^\s*第\s*[0-9一二三四五六七八九十百]+\s*[场鏡镜]\s*[.、．:：-]?\s*/, '');
}

/** 换行保护：把文本按行拆分（用于纯文本导入） */
export function toLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}
