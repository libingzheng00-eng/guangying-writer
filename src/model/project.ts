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
import { sceneNumbersFor } from './locks';
import { plainOf, compactLengthOf } from './textCache';

export const FILE_VERSION = 1;
/**
 * 工程格式修订号。每当新版加入旧版不认识的工程字段时加一。
 * 打开修订号更高的文件时提示作者，并原样保留本版不认识的字段，避免回存丢数据。
 * 2 = alpha.18.17：首个会保留未知字段的版本（含人物线 characterWorkspace）。
 * 3 = alpha.18.22：场号 / 页码锁定（sceneLock、pageLock）与备选台词（元素的 alts、altNo）。
 * 4 = alpha.18.23：双语对照（元素的 tr、工程的 translation）。
 */
export const FORMAT_REVISION = 4;

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


export function deriveScenes(project: ScriptProject): Scene[] {
  const out: Scene[] = [];
  const els = project.elements;
  const indices: number[] = [];
  els.forEach((el, i) => {
    if (el.type === 'scene_heading') indices.push(i);
  });
  if (!indices.length) return out;
  // Preserve Array.find's first-match behavior for old files with duplicate metadata.
  const metaByElement = new Map<string, SceneMeta>();
  for (const meta of project.sceneMeta) {
    if (!metaByElement.has(meta.elementId)) metaByElement.set(meta.elementId, meta);
  }
  // 拍摄稿锁定场号后，原场号不变，新插入的场编成 5A、5B（见 model/locks.ts）。
  const numbers = sceneNumbersFor(indices.map((i) => els[i].id), project.sceneLock);
  indices.forEach((startIdx, k) => {
    const el = els[startIdx];
    const end = k + 1 < indices.length ? indices[k + 1] : els.length;
    const m = metaByElement.get(el.id);
    const number = project.settings.autoNumberScenes ? numbers[k] : m?.title || '';
    out.push({
      id: m?.id || el.id,
      elementId: el.id,
      index: k,
      number,
      heading: stripSceneNumber(plain(el.text).trim()),
      title: m?.title || '',
      synopsis: m?.synopsis || '',
      location: m?.location,
      storyTime: m?.storyTime,
      revisionStatus: m?.revisionStatus,
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
  return normalizePlainName(plain(raw));
}

function normalizePlainName(text: string): string {
  let s = text.trim();
  // 去掉常见的扩展名
  s = s.replace(/[（(].*?[)）]/g, '').trim();
  s = s.replace(/[:：]\s*$/, '').trim();
  return s;
}

/** 人物行的规范名，按段落对象缓存（打字时其余人物行不用重算）。 */
const characterNames = new WeakMap<ScriptElement, { html: string; name: string }>();
function characterNameOf(el: ScriptElement): string {
  const cached = characterNames.get(el);
  if (cached && cached.html === el.text) return cached.name;
  const name = normalizePlainName(plainOf(el));
  characterNames.set(el, { html: el.text, name });
  return name;
}


export function deriveCharacters(project: ScriptProject): CharacterStat[] {
  const map = new Map<string, CharacterStat>();
  let sceneIdx = -1;
  project.elements.forEach((el) => {
    if (el.type === 'scene_heading') sceneIdx += 1;
    if (el.type !== 'character') return;
    const name = characterNameOf(el);
    if (!name) return;
    let stat = map.get(name);
    if (!stat) {
      stat = { name, scenes: [], lines: 0, words: 0 };
      map.set(name, stat);
    }
    if (sceneIdx >= 0 && !stat.scenes.includes(sceneIdx)) stat.scenes.push(sceneIdx);
  });
  // 精确统计：人物与其后连续的对白块
  let current: CharacterStat | null = null;
  project.elements.forEach((el) => {
    if (el.type === 'character') {
      current = map.get(characterNameOf(el)) || null;
      if (current) current.lines += 1;
    } else if (el.type === 'dialogue' && current) {
      current.words += compactLengthOf(el);
    } else if (el.type !== 'parenthetical') {
      current = null;
    }
  });
  return Array.from(map.values()).sort((a, b) => b.words - a.words);
}

/** 全部人物名（用于自动续打） */
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
