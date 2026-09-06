import type { ScriptProject } from '../model/types';
import { FILE_VERSION, defaultSettings, emptyTitlePage } from '../model/project';
import { DEFAULT_INDENT, DEFAULT_REVISIONS } from '../model/elements';

export interface ZhspFile {
  app: 'zh-screenwriter';
  fileVersion: number;
  savedAt: number;
  project: ScriptProject;
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
  const settings = { ...base, ...(p.settings || {}) };
  settings.indent = { ...DEFAULT_INDENT, ...(p.settings?.indent || {}) };
  return {
    id: p.id || 'p',
    name: p.name || '未命名剧本',
    createdAt: p.createdAt || Date.now(),
    updatedAt: p.updatedAt || Date.now(),
    titlePage: { ...emptyTitlePage(), ...(p.titlePage || {}) },
    elements: Array.isArray(p.elements) ? p.elements : [],
    sceneMeta: Array.isArray(p.sceneMeta) ? p.sceneMeta : [],
    beats: Array.isArray(p.beats) ? p.beats : [],
    acts: Array.isArray(p.acts) && p.acts.length ? p.acts : [{ id: 'act-1', title: '第一幕', color: '#cfe4ff' }],
    revisions: Array.isArray(p.revisions) && p.revisions.length ? p.revisions : DEFAULT_REVISIONS,
    settings,
  };
}
