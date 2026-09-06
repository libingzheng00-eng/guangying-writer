import type { ElementFormat, ElementType, Revision } from './types';

/** 字体预设（跨平台中文剧本常用字体） */
export const FONT_PRESETS: { key: string; label: string; stack: string }[] = [
  {
    key: 'fangsong',
    label: '仿宋（推荐）',
    stack: '"FangSong", "STFangsong", "FangSong_GB2312", "仿宋", "Songti SC", serif',
  },
  { key: 'songti', label: '宋体', stack: '"Songti SC", "STSong", "SimSun", "宋体", serif' },
  { key: 'kaiti', label: '楷体', stack: '"Kaiti SC", "STKaiti", "KaiTi", "楷体", serif' },
  { key: 'heiti', label: '黑体', stack: '"Heiti SC", "SimHei", "黑体", "PingFang SC", sans-serif' },
  { key: 'pingfang', label: '苹方 / 微软雅黑', stack: '"PingFang SC", "Microsoft YaHei", sans-serif' },
  { key: 'courier', label: 'Courier（英文稿）', stack: '"Courier Prime", "Courier New", Courier, monospace' },
];

export function fontStackOf(key: string): string {
  return (FONT_PRESETS.find((f) => f.key === key) || FONT_PRESETS[0]).stack;
}

export interface ElementMeta {
  type: ElementType;
  label: string;
  /** 元素面板中的说明 */
  hint: string;
  /** 空块占位提示 */
  placeholder: string;
  /** 状态栏缩写 */
  short: string;
  shortcut?: string;
}

export const ELEMENT_META: Record<ElementType, ElementMeta> = {
  act: { type: 'act', label: '幕 / 分集', hint: '第一幕、第二幕、分集标题', placeholder: '第一幕', short: '幕' },
  scene_heading: {
    type: 'scene_heading',
    label: '场次标题',
    hint: '1. 内景 咖啡厅 日',
    placeholder: '内景 咖啡厅 日',
    short: '场次',
    shortcut: '1',
  },
  action: {
    type: 'action',
    label: '动作',
    hint: '场景中的动作与环境描写',
    placeholder: '描述画面中发生的动作…',
    short: '动作',
    shortcut: '2',
  },
  character: {
    type: 'character',
    label: '人物',
    hint: '说话的角色名',
    placeholder: '人物名',
    short: '人物',
    shortcut: '3',
  },
  parenthetical: {
    type: 'parenthetical',
    label: '括号提示',
    hint: '（低声地）等情绪或动作提示',
    placeholder: '（低声地）',
    short: '提示',
    shortcut: '4',
  },
  dialogue: {
    type: 'dialogue',
    label: '对白',
    hint: '角色说的内容',
    placeholder: '对白内容…',
    short: '对白',
    shortcut: '5',
  },
  transition: {
    type: 'transition',
    label: '转场',
    hint: '切至：、淡出。',
    placeholder: '切至：',
    short: '转场',
    shortcut: '6',
  },
  shot: {
    type: 'shot',
    label: '镜头',
    hint: '特写、全景等镜头指示',
    placeholder: '特写 -',
    short: '镜头',
    shortcut: '7',
  },
  general: { type: 'general', label: '一般性文本', hint: '自由排版的文本', placeholder: '文本…', short: '文本' },
  note: { type: 'note', label: '备忘', hint: '不参与排版、统计与打印', placeholder: '备忘…', short: '备忘' },
};

export const ELEMENT_ORDER: ElementType[] = [
  'act',
  'scene_heading',
  'action',
  'character',
  'parenthetical',
  'dialogue',
  'transition',
  'shot',
  'general',
  'note',
];

/** 默认版式：缩进单位为「全角字符数」（1 = 一个汉字宽度） */
export const DEFAULT_INDENT: Record<ElementType, ElementFormat> = {
  act: { left: 0, right: 0, align: 'center', spaceBefore: 1, bold: true },
  scene_heading: { left: 0, right: 0, align: 'left', spaceBefore: 1, bold: true },
  action: { left: 0, right: 0, align: 'left', spaceBefore: 1 },
  character: { left: 13, right: 0, align: 'left', spaceBefore: 1 },
  parenthetical: { left: 9, right: 6, align: 'left', spaceBefore: 0 },
  dialogue: { left: 6, right: 8, align: 'left', spaceBefore: 0 },
  transition: { left: 0, right: 0, align: 'right', spaceBefore: 1 },
  shot: { left: 0, right: 0, align: 'left', spaceBefore: 1 },
  general: { left: 0, right: 0, align: 'left', spaceBefore: 0 },
  note: { left: 0, right: 0, align: 'left', spaceBefore: 1 },
};

/** 参与排版的元素（备忘不参与） */
export const PRINTABLE: ElementType[] = [
  'act',
  'scene_heading',
  'action',
  'character',
  'parenthetical',
  'dialogue',
  'transition',
  'shot',
  'general',
];

export const DIALOGUE_TYPES: ElementType[] = ['character', 'parenthetical', 'dialogue'];

export function isDialogueType(t: ElementType): boolean {
  return DIALOGUE_TYPES.includes(t);
}

/** Final Draft 风格修订色 */
export const REVISION_COLORS: { label: string; color: string; name: string }[] = [
  { label: '初稿', color: '#ffffff', name: '白' },
  { label: 'A', color: '#a8d5ff', name: '蓝' },
  { label: 'B', color: '#ffb3c7', name: '粉' },
  { label: 'C', color: '#ffe08a', name: '黄' },
  { label: 'D', color: '#b5e6b0', name: '绿' },
  { label: 'E', color: '#f7d08a', name: '金' },
  { label: 'F', color: '#d9f0d3', name: '浅绿' },
  { label: 'G', color: '#e8dcc4', name: '米色' },
  { label: 'H', color: '#d8c4e8', name: '淡紫' },
  { label: 'I', color: '#ffc9a8', name: '橙' },
  { label: 'J', color: '#b8e0e8', name: '青' },
];

export const CARD_COLORS = [
  '#cfe4ff',
  '#ffd9e0',
  '#fff0b8',
  '#d5f0cf',
  '#e6dcff',
  '#ffe0c2',
  '#d7f2f5',
  '#e8e8e8',
];

export const DEFAULT_REVISIONS: Revision[] = [
  { id: 'rev-0', label: '初稿', color: '#ffffff' },
  { id: 'rev-a', label: 'A', color: '#a8d5ff' },
  { id: 'rev-b', label: 'B', color: '#ffb3c7' },
  { id: 'rev-c', label: 'C', color: '#ffe08a' },
  { id: 'rev-d', label: 'D', color: '#b5e6b0' },
];

/** 常用转场 */
export const COMMON_TRANSITIONS = ['切至：', '切出', '淡入：', '淡出。', '叠化：', '溶至：', '黑场。', '字幕：'];

/** 常用镜头 */
export const COMMON_SHOTS = ['特写 -', '大特写 -', '近景 -', '中景 -', '全景 -', '远景 -', '俯拍 -', '主观镜头 -', '插入镜头 -'];

/** 内外景前缀 */
export const SCENE_PREFIXES = ['内景', '外景', '内/外景', '外/内景'];
