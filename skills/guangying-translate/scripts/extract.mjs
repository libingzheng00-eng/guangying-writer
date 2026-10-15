#!/usr/bin/env node
// 用法：node extract.mjs <剧本.zhsp> --lang ja|en [--only-needed] [--out worklist.json]
// 把剧本按段落取出来，供通读和翻译；不修改原文件。
import fs from 'node:fs';
import { LANGS, readZhsp, plain, isTranslatable, stateOf } from './zhsp-lib.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--lang' && args[args.indexOf(a) - 1] !== '--out');
const lang = args[args.indexOf('--lang') + 1];
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const onlyNeeded = args.includes('--only-needed');
if (!file || !LANGS.has(lang)) { console.error('用法：node extract.mjs <剧本.zhsp> --lang ja|en [--only-needed] [--out worklist.json]'); process.exit(2); }

const { project } = readZhsp(file);
const meta = new Map((project.sceneMeta || []).map((m) => [m.elementId, m]));
const items = [];
const scenes = [];
let scene = 0;
let lastCharacter = '';
for (const el of project.elements) {
  if (el.type === 'scene_heading') {
    scene += 1;
    const m = meta.get(el.id);
    scenes.push({ scene, id: el.id, heading: plain(el.text).trim(), title: m?.title || '', synopsis: plain(m?.synopsis || '').trim() });
  }
  if (el.type === 'character') lastCharacter = plain(el.text).trim();
  if (!isTranslatable(el)) continue;
  const state = stateOf(el, lang);
  if (onlyNeeded && state === 'done') continue;
  items.push({
    id: el.id, type: el.type, scene,
    ...(el.type === 'dialogue' || el.type === 'parenthetical' ? { speaker: lastCharacter } : {}),
    ...(el.dual ? { dual: el.dual } : {}),
    text: plain(el.text).trim(),
    state,
    ...(el.tr?.[lang]?.text ? { current: el.tr[lang].text } : {}),
  });
}
const characters = [...new Set(project.elements.filter((e) => e.type === 'character').map((e) => plain(e.text).replace(/[（(].*?[）)]/g, '').trim()).filter(Boolean))];
const result = {
  file, lang, name: project.name, title: project.titlePage?.title || '', logline: project.titlePage?.notes || '',
  characters, scenes,
  glossary: project.translation?.glossary?.[lang] || [],
  notes: project.translation?.notes?.[lang] || '',
  counts: { total: project.elements.filter(isTranslatable).length, listed: items.length },
  items,
};
const text = JSON.stringify(result, null, 1);
if (out) { fs.writeFileSync(out, text); console.log(`已取出 ${items.length} 段（全剧 ${result.counts.total} 段可译），写到 ${out}`); }
else process.stdout.write(text + '\n');
