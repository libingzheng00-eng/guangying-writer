import type { Beat, ScriptElement, ScriptProject, ScriptSettings } from '../model/types';
import { FILE_VERSION, defaultSettings, emptyTitlePage } from '../model/project';
import { DEFAULT_INDENT, DEFAULT_REVISIONS, ELEMENT_ORDER } from '../model/elements';
import { normalizeTargetPages } from '../model/progress';
import { PAPER_MM } from '../model/stats';
import { sanitizeProjectHtml } from '../utils/projectHtml';

export interface ZhspFile {
  app: 'guangying-writer';
  fileVersion: number;
  savedAt: number;
  project: ScriptProject;
}

type RecordValue = Record<string, unknown>;
const elementTypes = new Set<string>(ELEMENT_ORDER);
const reservedIdentifiers = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const invalidStructure = () => new Error('工程结构格式不正确，原文件未修改');

function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidStructure();
  return value as RecordValue;
}

function optionalRecord(value: unknown): RecordValue {
  return value === undefined ? {} : record(value);
}

function list(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100_000) throw invalidStructure();
  return value;
}

function fields(value: RecordValue, names: readonly string[], type: 'string' | 'number' | 'boolean') {
  for (const name of names) {
    const field = value[name];
    if (field !== undefined && (typeof field !== type || (type === 'number' && !Number.isFinite(field)))) throw invalidStructure();
  }
}

function identifier(value: unknown) {
  // IDs are not user prose. Quotes/controls can break selector-based focus and
  // dangerous object keys must not reach the historical ID-indexed maps.
  if (typeof value !== 'string' || !value.trim() || value.length > 512 ||
      /[\u0000-\u001f\u007f"'\\<>]/.test(value) || reservedIdentifiers.has(value)) throw invalidStructure();
}

function uniqueIds(items: ReadonlyArray<{ id: string }>) {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw invalidStructure();
    seen.add(item.id);
  }
}

function optionalIdentifiers(value: RecordValue, names: readonly string[]) {
  for (const name of names) if (value[name] !== undefined) identifier(value[name]);
}

function metadataList(value: unknown, kind: 'sceneMeta' | 'boardLinks' | 'acts' | 'revisions') {
  return list(value).map(raw => {
    const item = record(raw);
    identifier(item.id);
    if (kind === 'sceneMeta') {
      identifier(item.elementId);
      fields(item, ['title', 'synopsis', 'color'], 'string');
      fields(item, ['omit'], 'boolean');
      fields(item, ['order', 'x', 'y', 'w', 'h'], 'number');
      optionalIdentifiers(item, ['actId']);
    } else if (kind === 'boardLinks') {
      identifier(item.from); identifier(item.to);
      fields(item, ['note'], 'string');
    } else {
      fields(item, kind === 'acts' ? ['title', 'color'] : ['label', 'color'], 'string');
    }
    return item;
  });
}

function validatedSettings(value: unknown): RecordValue {
  const incoming = optionalRecord(value);
  const defaults = defaultSettings();
  for (const [name, defaultValue] of Object.entries(defaults)) {
    // sceneNumber retains its documented legacy fallback below.
    if (name !== 'indent' && name !== 'sceneNumber') fields(incoming, [name], typeof defaultValue as 'string' | 'number' | 'boolean');
  }
  if (incoming.paper !== undefined && incoming.paper !== 'A4' && incoming.paper !== 'letter') throw invalidStructure();
  // Tiny positive line heights defeat the paginator's positive-number fallback
  // and turn one measured line into trillions of pages. Keep a generous range
  // for historical custom layouts and require usable geometry in both writing
  // and the always-A4 preview, without clamping or rewriting saved values.
  const layout = { ...defaults, ...incoming } as ScriptSettings;
  if (layout.fontSize < 1 || layout.fontSize > 144 || layout.lineHeight < 0.5 || layout.lineHeight > 10) throw invalidStructure();
  for (const margin of [layout.marginTop, layout.marginBottom, layout.marginLeft, layout.marginRight]) {
    if (margin < -5 || margin > 30) throw invalidStructure();
  }
  const lineHeightMm = layout.fontSize * layout.lineHeight * 25.4 / 72;
  for (const name of new Set(['A4', layout.paper])) {
    const paper = PAPER_MM[name];
    if (paper.w - (layout.marginLeft + layout.marginRight) * 10 < 10 ||
        paper.h - (layout.marginTop + layout.marginBottom) * 10 < Math.max(10, lineHeightMm)) throw invalidStructure();
  }
  const indent = optionalRecord(incoming.indent);
  const merged = { ...DEFAULT_INDENT };
  for (const name of ELEMENT_ORDER) {
    if (indent[name] === undefined) continue;
    const format = record(indent[name]);
    fields(format, ['left', 'right', 'spaceBefore'], 'number');
    // Text export repeats indentation spaces; finite-but-enormous values must
    // not allocate an unbounded string. Ordinary custom/negative values survive.
    for (const key of ['left', 'right', 'spaceBefore']) {
      if (typeof format[key] === 'number' && Math.abs(format[key] as number) > 10_000) throw invalidStructure();
    }
    fields(format, ['bold', 'uppercase'], 'boolean');
    if (format.align !== undefined && !['left', 'right', 'center'].includes(format.align as string)) throw invalidStructure();
    // Old partial formatting records inherit the missing defaults per type.
    merged[name] = { ...DEFAULT_INDENT[name], ...format };
  }
  return { ...incoming, indent: merged };
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
 * 仅对缺失的必填字段做最小兜底；可选字段（boardX/boardY/kind/title/img/w/h）保持缺省，
 * 序列化时由 JSON.stringify 自动跳过，从而保证旧数据的 round-trip 完全无损。
 */
function normalizeBeat(raw: unknown): Beat {
  const b = record(raw);
  // Preserve the established missing-ID/coordinate migration, but do not let
  // objects masquerade as text, image URLs or React-visible strings.
  fields(b, ['id', 'text', 'color', 'sceneId', 'title', 'img', 'kind'], 'string');
  if (b.id) identifier(b.id);
  const x = typeof b.x === 'number' && Number.isFinite(b.x) ? b.x : 0;
  const y = typeof b.y === 'number' && Number.isFinite(b.y) ? b.y : 0;
  const beat: Beat = {
    id: typeof b.id === 'string' && b.id ? b.id : '',
    text: typeof b.text === 'string' ? b.text : '',
    color: typeof b.color === 'string' && b.color ? b.color : '#fff7d6',
    x,
    y,
  };
  if (typeof b.boardX === 'number' && Number.isFinite(b.boardX)) beat.boardX = b.boardX;
  if (typeof b.boardY === 'number' && Number.isFinite(b.boardY)) beat.boardY = b.boardY;
  if (typeof b.sceneId === 'string' && b.sceneId) beat.sceneId = b.sceneId;
  // `wimg` 是旧版「写作图」的重复类型。读取时归并为 image，保留图片、标题、坐标与尺寸；
  // 新版不会再生成 wimg，从而只维护一套图片卡和一条 PDF 导出链路。
  if (b.kind === 'beat' || b.kind === 'sound' || b.kind === 'image') beat.kind = b.kind;
  else if (b.kind === 'wimg') beat.kind = 'image';
  if (typeof b.title === 'string') beat.title = b.title;
  if (typeof b.img === 'string') beat.img = b.img;
  if (typeof b.w === 'number' && Number.isFinite(b.w)) beat.w = b.w;
  if (typeof b.h === 'number' && Number.isFinite(b.h)) beat.h = b.h;
  return beat;
}

function normalizeElement(raw: unknown): ScriptElement {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('工程正文格式不正确');
  const element = raw as ScriptElement;
  identifier(element.id);
  if (!elementTypes.has(element.type)) throw invalidStructure();
  const value = raw as RecordValue;
  fields(value, ['omit'], 'boolean');
  optionalIdentifiers(value, ['dualGroup', 'rev', 'sceneId']);
  if (element.dual !== undefined && element.dual !== 'left' && element.dual !== 'right') throw invalidStructure();
  // Missing old text fields are empty; reject other malformed values instead
  // of coercing an object or silently deleting a paragraph during migration.
  if (element.text != null && typeof element.text !== 'string') throw new Error('工程正文格式不正确');
  return { ...element, text: sanitizeProjectHtml(element.text ?? '') };
}

export function serializeProject(p: ScriptProject): string {
  const file: ZhspFile = { app: 'guangying-writer', fileVersion: FILE_VERSION, savedAt: Date.now(), project: p };
  return JSON.stringify(file, null, 2);
}

/** 容错解析：兼容旧版 / 缺少字段的工程文件 */
export function parseProject(raw: string): ScriptProject {
  const json = record(JSON.parse(raw));
  const source = Object.prototype.hasOwnProperty.call(json, 'project') ? record(json.project) : json;
  optionalIdentifiers(source, ['id']);
  fields(source, ['name'], 'string');
  fields(source, ['createdAt', 'updatedAt'], 'number');
  const titlePage = optionalRecord(source.titlePage);
  fields(titlePage, ['title', 'subtitle', 'author', 'basedOn', 'version', 'date', 'contact', 'notes'], 'string');
  fields(titlePage, ['show'], 'boolean');
  const p = source as unknown as ScriptProject;
  const base = defaultSettings();
  const settingsRecord = validatedSettings(source.settings);
  const incomingSceneNumber = settingsRecord.sceneNumber;
  // 旧版曾保存 progressTheme；读取时主动丢弃，统一使用单一打字机样式，
  // 避免旧字段继续写回新工程。
  const { progressTheme: _legacyProgressTheme, ...incomingSettings } = settingsRecord;
  void _legacyProgressTheme;
  const settings: ScriptSettings = {
    ...base,
    ...incomingSettings,
    sceneNumber: normalizeSceneNumber(incomingSceneNumber),
  };
  settings.indent = settingsRecord.indent as ScriptSettings['indent'];
  const beats = list(source.beats).map(normalizeBeat).filter((b) => b.id);
  const elements = list(source.elements).map(normalizeElement);
  // Legacy board selection accepts bare IDs alongside scene:/beat: addresses.
  // A collision across tables can turn selecting a beat into deleting a scene.
  // Reject both shared IDs and IDs that alias another card's prefixed address.
  // SceneMeta.id belongs to association data, not selection; repeated elementId
  // metadata retains the historical first-match behavior.
  uniqueIds([...elements, ...beats]);
  const cardIds = new Set([...elements, ...beats].map(item => item.id));
  if (elements.some(item => cardIds.has(`scene:${item.id}`)) ||
      beats.some(item => cardIds.has(`beat:${item.id}`))) throw invalidStructure();
  const sceneMeta = metadataList(source.sceneMeta, 'sceneMeta') as unknown as ScriptProject['sceneMeta'];
  const boardLinks = metadataList(source.boardLinks, 'boardLinks') as unknown as NonNullable<ScriptProject['boardLinks']>;
  const acts = metadataList(source.acts, 'acts') as unknown as ScriptProject['acts'];
  const revisions = metadataList(source.revisions, 'revisions') as unknown as ScriptProject['revisions'];
  return {
    id: p.id || 'p',
    name: p.name || '未命名剧本',
    createdAt: p.createdAt || Date.now(),
    updatedAt: p.updatedAt || Date.now(),
    titlePage: { ...emptyTitlePage(), ...titlePage },
    elements,
    sceneMeta,
    beats,
    boardLinks,
    // 边界兜底：0 / 负数 / NaN / 超大数 → undefined（旧工程视为未设 → 启动时按 default 100 显示）；
    // 旧工程显式保存的合法正整数原样保留；>9999 封顶。
    targetPages: normalizeTargetPages(p.targetPages),
    // 显式空数组表示用户已删除所有幕；只有旧工程缺失该字段才补默认幕。
    acts: source.acts !== undefined ? acts : [{ id: 'act-1', title: '第一幕', color: '#cfe4ff' }],
    revisions: revisions.length ? revisions : DEFAULT_REVISIONS,
    settings,
  };
}
