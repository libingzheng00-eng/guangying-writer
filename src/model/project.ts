import type {
  Act,
  ElementType,
  Scene,
  SceneMeta,
  ScriptElement,
  ScriptProject,
  ScriptSettings,
  TitlePage,
} from './types';
import { DEFAULT_INDENT, DEFAULT_REVISIONS, CARD_COLORS } from './elements';
import { uid } from '../utils/id';
import { plain, stripSceneNumber } from '../utils/text';

export const FILE_VERSION = 1;
export const FILE_EXT = 'zhsp';

export function defaultSettings(): ScriptSettings {
  return {
    fontKey: 'fangsong',
    fontSize: 12,
    lineHeight: 1.6,
    paper: 'A4',
    marginTop: 2.5,
    marginBottom: 2.5,
    marginLeft: 3.5,
    marginRight: 2.5,
    indent: JSON.parse(JSON.stringify(DEFAULT_INDENT)),
    sceneNumber: 'left',
    autoNumberScenes: true,
    sceneNumberPrefix: '',
    showPageNumbers: true,
    pageNumberTop: 0.6,
    startPageAt: 1,
    moreText: '（更多）',
    contdText: '（续）',
    showContd: true,
    contdCharacter: true,
    wordsPerMinute: 220,
    revisionMode: false,
    printNotes: false,
    dualDialogue: true,
    smartQuotes: true,
    titlePageBreak: true,
  };
}

export function emptyTitlePage(): TitlePage {
  return {
    title: '未命名剧本',
    subtitle: '',
    author: '',
    basedOn: '',
    version: '',
    date: new Date().toLocaleDateString('zh-CN'),
    contact: '',
    notes: '',
    show: false,
  };
}

export function newElement(type: ElementType, text = ''): ScriptElement {
  return { id: uid('el'), type, text };
}

export function createProject(name = '未命名剧本'): ScriptProject {
  return {
    id: uid('p'),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    titlePage: emptyTitlePage(),
    elements: [newElement('scene_heading', '内景 咖啡厅 日'), newElement('action', ''), newElement('character', ''), newElement('dialogue', '')],
    sceneMeta: [],
    beats: [],
    boardLinks: [],
    targetPages: 100,
    acts: [defaultActs()[0]],
    revisions: DEFAULT_REVISIONS.map((r) => ({ ...r })),
    settings: defaultSettings(),
  };
}

export function defaultActs(): Act[] {
  return [
    { id: 'act-1', title: '第一幕', color: CARD_COLORS[0] },
    { id: 'act-2', title: '第二幕', color: CARD_COLORS[1] },
    { id: 'act-3', title: '第三幕', color: CARD_COLORS[2] },
  ];
}

/* --------------------------------------------------------------- */
/* 场景派生：场景由 scene_heading 元素派生，保证场号与正文一致          */
/* --------------------------------------------------------------- */

export function metaFor(project: ScriptProject, elementId: string): SceneMeta {
  let m = project.sceneMeta.find((s) => s.elementId === elementId);
  if (!m) {
    m = {
      id: uid('sc'),
      elementId,
      title: '',
      synopsis: '',
      color: CARD_COLORS[0],
    };
    project.sceneMeta.push(m);
  }
  return m;
}

export function deriveScenes(project: ScriptProject): Scene[] {
  const out: Scene[] = [];
  const els = project.elements;
  const indices: number[] = [];
  els.forEach((el, i) => {
    if (el.type === 'scene_heading') indices.push(i);
  });
  indices.forEach((startIdx, k) => {
    const el = els[startIdx];
    const end = k + 1 < indices.length ? indices[k + 1] : els.length;
    const m = project.sceneMeta.find((s) => s.elementId === el.id);
    const number = project.settings.autoNumberScenes ? String(k + 1) : m?.title || '';
    out.push({
      id: m?.id || el.id,
      elementId: el.id,
      index: k,
      number,
      heading: stripSceneNumber(plain(el.text).trim()),
      title: m?.title || '',
      synopsis: m?.synopsis || '',
      color: m?.color || CARD_COLORS[0],
      actId: m?.actId,
      omit: el.omit || m?.omit,
      start: startIdx,
      end,
      x: m?.x,
      y: m?.y,
      w: m?.w,
      h: m?.h,
    });
  });
  return out;
}

export function sceneNumberText(project: ScriptProject, index: number): string {
  const n = String(index + 1);
  const p = project.settings.sceneNumberPrefix || '';
  return p ? `${p}${n}` : n;
}

/** 场景标题文本（不含自动编号） */
export function headingText(project: ScriptProject, elementId: string): string {
  const el = project.elements.find((e) => e.id === elementId);
  return el ? plain(el.text).trim() : '';
}

/* --------------------------------------------------------------- */
/* 角色派生                                                          */
/* --------------------------------------------------------------- */

export interface CharacterStat {
  name: string;
  scenes: number[];
  lines: number;
  words: number;
}

export function normalizeName(raw: string): string {
  let s = plain(raw).trim();
  // 去掉常见的扩展名
  s = s.replace(/[（(].*?[)）]/g, '').trim();
  s = s.replace(/[:：]\s*$/, '').trim();
  return s;
}

export function isCharacterName(raw: string): boolean {
  const s = normalizeName(raw);
  if (!s || s.length > 20) return false;
  return true;
}

export function deriveCharacters(project: ScriptProject): CharacterStat[] {
  const map = new Map<string, CharacterStat>();
  const scenes = deriveScenes(project);
  let sceneIdx = -1;
  let pending: CharacterStat | null = null;
  project.elements.forEach((el) => {
    if (el.type === 'scene_heading') sceneIdx += 1;
    if (el.type !== 'character') return;
    const name = normalizeName(el.text);
    if (!name) return;
    let stat = map.get(name);
    if (!stat) {
      stat = { name, scenes: [], lines: 0, words: 0 };
      map.set(name, stat);
    }
    if (sceneIdx >= 0 && !stat.scenes.includes(sceneIdx)) stat.scenes.push(sceneIdx);
    pending = stat;
  });
  // 统计对白字数
  project.elements.forEach((el) => {
    if (el.type === 'dialogue' && pending) {
      // 逐条对应：简化为归属于最近一次出现的人物
    }
  });
  // 精确统计：人物与其后连续的对白块
  let current: CharacterStat | null = null;
  project.elements.forEach((el) => {
    if (el.type === 'character') {
      current = map.get(normalizeName(el.text)) || null;
      if (current) current.lines += 1;
    } else if (el.type === 'dialogue' && current) {
      current.words += plain(el.text).replace(/\s/g, '').length;
    } else if (el.type !== 'parenthetical') {
      current = null;
    }
  });
  void scenes;
  return Array.from(map.values()).sort((a, b) => b.words - a.words);
}

/** 全部人物名（用于自动续打） */
export function characterNames(project: ScriptProject): string[] {
  return deriveCharacters(project).map((c) => c.name).filter(Boolean);
}

/** 全部场次标题（用于自动续打） */
export function sceneHeadings(project: ScriptProject): string[] {
  const set: string[] = [];
  project.elements.forEach((el) => {
    if (el.type === 'scene_heading') {
      const t = plain(el.text).trim();
      if (t && !set.includes(t)) set.push(t);
    }
  });
  return set;
}

export function cloneProject(p: ScriptProject): ScriptProject {
  return JSON.parse(JSON.stringify(p)) as ScriptProject;
}
