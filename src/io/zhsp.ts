import type { Beat, ScriptProject, ScriptSettings } from '../model/types';
import { FILE_VERSION, defaultSettings, emptyTitlePage } from '../model/project';
import { DEFAULT_INDENT, DEFAULT_REVISIONS } from '../model/elements';
import { normalizeTargetPages } from '../model/progress';

export interface ZhspFile {
  app: 'zh-screenwriter';
  fileVersion: number;
  savedAt: number;
  project: ScriptProject;
}

/** 场号显示位置的合法值；非法值兜底为 'left'，避免垃圾数据导致 UI 选中错位。 */
const SCENE_NUMBER_VALUES: ReadonlyArray<ScriptSettings['sceneNumber']> = ['none', 'left', 'right', 'both'];

function normalizeSceneNumber(raw: unknown): ScriptSettings['sceneNumber'] {
  return SCENE_NUMBER_VALUES.includes(raw as ScriptSettings['sceneNumber'])
    ? (raw as ScriptSettings['sceneNumber'])
    : 'left';
}

/**
 * 把任意来源的 beat 对象规整为 Beat。
 * 仅对缺失的必填字段做最小兜底；可选字段（kind/title/img/w/h）保留 undefined，
 * 序列化时由 JSON.stringify 自动跳过，从而保证旧数据的 round-trip 完全无损。
 */
function normalizeBeat(raw: unknown): Beat {
  const b = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const x = typeof b.x === 'number' && Number.isFinite(b.x) ? b.x : 0;
  const y = typeof b.y === 'number' && Number.isFinite(b.y) ? b.y : 0;
  const beat: Beat = {
    id: typeof b.id === 'string' && b.id ? b.id : '',
    text: typeof b.text === 'string' ? b.text : '',
    color: typeof b.color === 'string' && b.color ? b.color : '#fff7d6',
    x,
    y,
  };
  if (typeof b.sceneId === 'string' && b.sceneId) beat.sceneId = b.sceneId;
  if (b.kind === 'beat' || b.kind === 'sound' || b.kind === 'image' || b.kind === 'wimg') beat.kind = b.kind;
  if (typeof b.title === 'string') beat.title = b.title;
  if (typeof b.img === 'string') beat.img = b.img;
  if (typeof b.w === 'number' && Number.isFinite(b.w)) beat.w = b.w;
  if (typeof b.h === 'number' && Number.isFinite(b.h)) beat.h = b.h;
  return beat;
}

export function serializeProject(p: ScriptProject): string {
  const file: ZhspFile = { app: 'zh-screenwriter', fileVersion: FILE_VERSION, savedAt: Date.now(), project: p };
  return JSON.stringify(file, null, 2);
}

/** 容错解析：兼容旧版 / 缺少字段的工程文件 */
export function parseProject(raw: string): ScriptProject {
  const json = JSON.parse(raw);
  const p: ScriptProject = json && json.project ? json.project : json;
  const base = defaultSettings();
  const incomingSceneNumber = p.settings && (p.settings as ScriptSettings).sceneNumber;
  const settings: ScriptSettings = {
    ...base,
    ...(p.settings || {}),
    sceneNumber: normalizeSceneNumber(incomingSceneNumber),
  };
  settings.indent = { ...DEFAULT_INDENT, ...(p.settings?.indent || {}) };
  const beats = Array.isArray(p.beats) ? p.beats.map(normalizeBeat).filter((b) => b.id) : [];
  return {
    id: p.id || 'p',
    name: p.name || '未命名剧本',
    createdAt: p.createdAt || Date.now(),
    updatedAt: p.updatedAt || Date.now(),
    titlePage: { ...emptyTitlePage(), ...(p.titlePage || {}) },
    elements: Array.isArray(p.elements) ? p.elements : [],
    sceneMeta: Array.isArray(p.sceneMeta) ? p.sceneMeta : [],
    beats,
    boardLinks: Array.isArray(p.boardLinks) ? p.boardLinks : [],
    // 边界兜底：0 / 负数 / NaN / 超大数 → undefined（旧工程视为未设 → 启动时按 default 100 显示）；
    // 旧工程显式保存的合法正整数原样保留；>9999 封顶。
    targetPages: normalizeTargetPages(p.targetPages),
    acts: Array.isArray(p.acts) && p.acts.length ? p.acts : [{ id: 'act-1', title: '第一幕', color: '#cfe4ff' }],
    revisions: Array.isArray(p.revisions) && p.revisions.length ? p.revisions : DEFAULT_REVISIONS,
    settings,
  };
}
