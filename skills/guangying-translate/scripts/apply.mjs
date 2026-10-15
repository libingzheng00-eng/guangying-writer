#!/usr/bin/env node
// 用法：node apply.mjs <剧本.zhsp> <译文.json> --lang ja|en [--dry-run]
// 译文.json：{ "items": [{ "id": "...", "text": "..." }], "glossary": [{ "source": "林舟", "target": "リン・ジョウ" }], "notes": "风格说明" }
// 只写每段的译文（element.tr[lang]）和工程的译名表 / 说明；原文一个字都不改。
// 写之前在原文件旁边留一份备份；写的过程中如果原文件被别处改过（例如在光影写手里保存），就放弃，不覆盖。
import fs from 'node:fs';
import path from 'node:path';
import { LANGS, readZhsp, sourceHash } from './zhsp-lib.mjs';

const args = process.argv.slice(2);
const [file, input] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--lang');
const lang = args[args.indexOf('--lang') + 1];
const dryRun = args.includes('--dry-run');
if (!file || !input || !LANGS.has(lang)) { console.error('用法：node apply.mjs <剧本.zhsp> <译文.json> --lang ja|en [--dry-run]'); process.exit(2); }

const before = readZhsp(file);
const payload = JSON.parse(fs.readFileSync(input, 'utf8'));
const items = Array.isArray(payload.items) ? payload.items : [];
const byId = new Map(before.project.elements.map((el) => [el.id, el]));
const unknown = [], empty = [];
let written = 0;
for (const item of items) {
  const el = byId.get(item?.id);
  if (!el) { unknown.push(item?.id); continue; }
  const text = typeof item.text === 'string' ? item.text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : '';
  if (!text) { empty.push(item.id); continue; }
  if (text.length > 20000) throw new Error(`段落 ${item.id} 的译文太长（超过 20000 字）。`);
  el.tr = { ...(el.tr || {}), [lang]: { text, srcHash: sourceHash(el.text) } };
  written += 1;
}
const clip = (v, n) => String(v ?? '').slice(0, n);
if (Array.isArray(payload.glossary) || typeof payload.notes === 'string') {
  const t = before.project.translation || {};
  if (Array.isArray(payload.glossary)) t.glossary = { ...(t.glossary || {}), [lang]: payload.glossary.filter((r) => r && (r.source || r.target)).map((r) => ({ source: clip(r.source, 200), target: clip(r.target, 200), ...(r.note ? { note: clip(r.note, 1000) } : {}) })) };
  if (typeof payload.notes === 'string') t.notes = { ...(t.notes || {}), [lang]: clip(payload.notes, 20000) };
  before.project.translation = t;
}
before.json.formatRevision = Math.max(Number(before.json.formatRevision) || 0, 4);
before.json.savedAt = Date.now();

console.log(`写入 ${written} 段${lang === 'ja' ? '日文' : '英文'}译文${unknown.length ? `；${unknown.length} 个段落在剧本里找不到，已跳过` : ''}${empty.length ? `；${empty.length} 段译文为空，已跳过` : ''}。`);
if (dryRun) { console.log('（试运行，没有写文件）'); process.exit(0); }

// 别处在这期间保存过，就不覆盖。
if (fs.statSync(file).mtimeMs !== before.mtimeMs) throw new Error('剧本文件在翻译期间被改动过（可能在光影写手里保存了）。为免覆盖，这次没有写入，请重新取段落再写。');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
let backup = path.join(path.dirname(file), `${path.basename(file, '.zhsp')}.翻译前备份-${stamp}.zhsp`);
for (let n = 2; fs.existsSync(backup); n += 1) backup = path.join(path.dirname(file), `${path.basename(file, '.zhsp')}.翻译前备份-${stamp}-${n}.zhsp`);
fs.writeFileSync(backup, before.raw);
const tmp = `${file}.writing-${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(before.json));
fs.renameSync(tmp, file);

// 写完再读一遍：原文、段落顺序都必须和写之前一模一样。
const after = readZhsp(file);
const original = JSON.parse(before.raw).project.elements;
const same = after.project.elements.length === original.length && after.project.elements.every((el, i) => el.id === original[i].id && el.text === original[i].text && el.type === original[i].type);
if (!same) { fs.writeFileSync(file, before.raw); throw new Error('写入后核对原文不一致，已恢复原文件。'); }
console.log(`已写入 ${file}\n备份：${backup}`);
