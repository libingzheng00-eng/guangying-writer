import type { ScriptProject } from './types';
import { deriveScenes, normalizeName } from './project';
import { countWords, plain } from '../utils/text';

type ReportPage = { items: { elements: { id: string }[] }[] };
export interface ReportCharacter {
  name: string; scenes: string[]; lines: number; words: number; byScene: Record<string, number>;
}

/** 只解析明确的场次标题格式，不从正文猜地点、人物在场或拍摄时长。 */
export function parseSceneHeading(heading: string) {
  const text = plain(heading).trim();
  const prefix = /^(内外景|外内景|内景|外景|INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|INT\.?|EXT\.?)(?=\s|[：:.-]|$)[\s：:.-]*/i.exec(text);
  if (!prefix) return { setting: '未识别', location: '未识别', time: '未识别' };
  const token = prefix[1].toUpperCase();
  const setting = /内外|外内|\//.test(token) ? '内外景' : /内|INT/.test(token) ? '内景' : '外景';
  const rest = text.slice(prefix[0].length).trim();
  const end = /(?:\s+|\s*[-—–]\s*)(清晨|早晨|上午|中午|下午|傍晚|黄昏|深夜|凌晨|白天|夜晚|日|夜|晨|晚|DAY|NIGHT|DAWN|DUSK)\s*$/i.exec(rest);
  const time = end ? ({ DAY: '日', NIGHT: '夜', DAWN: '晨', DUSK: '黄昏' }[end[1].toUpperCase()] || end[1]) : '未识别';
  return { setting, location: (end ? rest.slice(0, end.index) : rest).trim() || '未识别', time };
}

/** 统计专用只读投影。不得复用它替换编辑器、分页或导出逻辑。
 * 总量/分布/人物/CSV 共用范围：排除省略场景、单段省略与备忘；幕元素仍计正文。
 * 发言次数=有效人物元素次数，不推断无台词人物；词字数沿用 countWords。
 */
export function buildReport(project: ScriptProject, pages?: ReportPage[]) {
  const sourceScenes = deriveScenes(project);
  const excluded = new Set<string>();
  for (const scene of sourceScenes) if (scene.omit) {
    for (let i = scene.start; i < scene.end; i++) excluded.add(project.elements[i].id);
  }
  const elements = project.elements.filter(e => !e.omit && e.type !== 'note' && !excluded.has(e.id));
  const eligible = new Set(elements.map(e => e.id));
  const actIds = new Set(project.acts.map(a => a.id));
  const sceneFor = new Map<string, string>();
  const scenes = sourceScenes.filter(s => !s.omit).map(s => {
    const all = project.elements.slice(s.start, s.end);
    const active = all.filter(e => eligible.has(e.id));
    for (const el of active) sceneFor.set(el.id, s.elementId);
    return {
      id: s.elementId, number: s.number, heading: s.heading, words: active.reduce((n, e) => n + countWords(e.text), 0),
      dialogueWords: active.filter(e => e.type === 'dialogue').reduce((n, e) => n + countWords(e.text), 0),
      actionWords: active.filter(e => e.type === 'action').reduce((n, e) => n + countWords(e.text), 0),
      characters: [] as string[], actId: s.actId && actIds.has(s.actId) ? s.actId : '',
      notes: all.filter(e => e.type === 'note' && !e.omit && plain(e.text).trim()).length,
      empty: !active.some(e => e.type !== 'scene_heading' && e.type !== 'act' && plain(e.text).trim()),
      missingSynopsis: !plain(s.synopsis).trim(), ...parseSceneHeading(s.heading), pages: pages ? 0 : null as number | null,
    };
  });
  const sceneMap = new Map(scenes.map(s => [s.id, s]));
  const people = new Map<string, ReportCharacter>();
  let current: ReportCharacter | undefined;
  for (const el of project.elements) {
    if (el.type === 'scene_heading' || el.type === 'act' || el.type === 'character') current = undefined;
    if (!eligible.has(el.id)) continue;
    const sceneId = sceneFor.get(el.id);
    if (el.type === 'character') {
      const name = normalizeName(el.text);
      if (!name) continue;
      current = people.get(name);
      if (!current) { current = { name, scenes: [], lines: 0, words: 0, byScene: Object.create(null) }; people.set(name, current); }
      current.lines++;
      if (sceneId) {
        if (!current.scenes.includes(sceneId)) current.scenes.push(sceneId);
        current.byScene[sceneId] = (current.byScene[sceneId] || 0) + 1;
        const scene = sceneMap.get(sceneId)!;
        if (!scene.characters.includes(name)) scene.characters.push(name);
      }
    } else if (el.type === 'dialogue') { if (current) current.words += countWords(el.text); }
    else if (el.type !== 'parenthetical') current = undefined;
  }
  let bodyPages: number | null = pages ? 0 : null;
  for (const page of pages || []) {
    const ids = page.items.flatMap(item => item.elements.map(e => e.id)).filter(id => eligible.has(id));
    if (ids.length) bodyPages!++;
    for (const id of new Set(ids.map(id => sceneFor.get(id)).filter((id): id is string => !!id))) sceneMap.get(id)!.pages!++;
  }
  const words = elements.reduce((n, e) => n + countWords(e.text), 0);
  const elementCounts: Record<string, number> = {};
  for (const el of elements) elementCounts[el.type] = (elementCounts[el.type] || 0) + 1;
  const groups = [{ id: '', title: '未归幕' }, ...project.acts];
  const acts = groups.map(a => {
    const members = scenes.filter(s => s.actId === a.id);
    return { id: a.id, title: a.title, words: members.reduce((n, s) => n + s.words, 0), scenes: members.length };
  });
  const counts = (key: 'location' | 'setting' | 'time') => {
    const map = new Map<string, number>();
    for (const scene of scenes) map.set(scene[key], (map.get(scene[key]) || 0) + 1);
    return [...map].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  };
  const speed = project.settings.wordsPerMinute;
  return {
    words, cjk: elements.reduce((n, e) => n + (plain(e.text).match(/[\u4e00-\u9fff]/g)?.length || 0), 0),
    dialogueWords: elements.filter(e => e.type === 'dialogue').reduce((n, e) => n + countWords(e.text), 0),
    actionWords: elements.filter(e => e.type === 'action').reduce((n, e) => n + countWords(e.text), 0),
    elementCounts, elementTotal: elements.length, pages: bodyPages,
    readingSeconds: Math.round(words / (Number.isFinite(speed) && speed > 0 ? speed : 300) * 60),
    unscopedWords: elements.filter(e => !sceneFor.has(e.id)).reduce((n, e) => n + countWords(e.text), 0),
    scenes, acts, characters: [...people.values()].sort((a, b) => b.words - a.words || b.lines - a.lines),
    locations: counts('location'), settings: counts('setting'), times: counts('time'),
  };
}

export function reportCsvCell(value: string | number) {
  let text = String(value);
  if (/^\s*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}
