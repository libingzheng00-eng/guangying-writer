// 光影写手 .zhsp 文件的最小读写工具（翻译技能用）。不依赖第三方库。
// 原文指纹必须和 app 的 src/model/translation.ts sourceHash 完全一致。
import fs from 'node:fs';

export const LANGS = new Set(['ja', 'en']);

/** 与 src/utils/text.ts plain() 相同：去掉标签，<br> 与段落结尾变换行，解码常见实体。 */
export function plain(html) {
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

/** 与 app 的 sourceHash() 相同：FNV-1a 32 位，十六进制 8 位。 */
export function sourceHash(html) {
  const text = plain(html || '').replace(/\r\n?/g, '\n').trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function readZhsp(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const json = JSON.parse(raw);
  const project = json && typeof json === 'object' && json.project ? json.project : null;
  if (!project || !Array.isArray(project.elements)) throw new Error('这不是光影写手的工程文件（缺少 project.elements）。');
  return { raw, json, project, mtimeMs: fs.statSync(file).mtimeMs };
}

export const isTranslatable = (el) => el && el.type !== 'note' && !el.omit && plain(el.text).trim() !== '';

export function stateOf(el, lang) {
  const entry = el.tr && el.tr[lang];
  if (!entry || !String(entry.text || '').trim()) return 'missing';
  return entry.srcHash === sourceHash(el.text) ? 'done' : 'stale';
}
