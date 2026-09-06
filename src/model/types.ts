/**
 * 中文剧本数据模型
 * 参考 Final Draft 的元素化结构，并针对中文影视剧本习惯做了调整
 * （场号 + 内/外景 + 地点 + 时间的场次标题、全角排版、按字统计等）
 */

export type ElementType =
  | 'act' // 幕 / 分集
  | 'scene_heading' // 场次标题  例：1. 内景 咖啡厅 日
  | 'action' // 动作描述
  | 'character' // 人物
  | 'parenthetical' // 括号提示
  | 'dialogue' // 对白
  | 'transition' // 转场  例：切至：
  | 'shot' // 镜头  例：特写 -
  | 'general' // 一般性文本
  | 'note'; // 备忘（不参与排版、统计与打印）

export type TextAlign = 'left' | 'right' | 'center';

/** 一个剧本元素（块） */
export interface ScriptElement {
  id: string;
  type: ElementType;
  /** 正文，允许包含 <b> <i> <u> 行内标记 */
  text: string;
  /** 双列对白：左列 / 右列 */
  dual?: 'left' | 'right';
  /** 双列对白分组 id，同一组的元素并排显示 */
  dualGroup?: string;
  /** 所属修订集 id */
  rev?: string;
  /** 省略（Omitted） */
  omit?: boolean;
  /** 所属场景卡 id */
  sceneId?: string;
}

/**
 * 场景卡 / 索引卡的附加信息。
 * 场景本身由场景标题元素派生（保证场号与正文永不脱节），
 * 这里只保存卡片上额外的元数据。
 */
export interface SceneMeta {
  id: string;
  /** 对应的 scene_heading 元素 id */
  elementId: string;
  title: string;
  synopsis: string;
  color: string;
  actId?: string;
  omit?: boolean;
  /** 卡片在故事板中的自定义顺序（仅在用户手动排序后使用） */
  order?: number;
  /** 自由画布中的坐标（未设置时自动网格排列） */
  x?: number;
  y?: number;
}

/**
 * 节拍卡 / 灵感卡（对标 Final Draft 的 Beat Board）。
 * 与场景解耦：可独立存在，也可选择性地链接到某个场景。
 *
 * 卡片种类：
 * - 'beat'：默认文字灵感卡
 * - 'sound'：声音卡（仅出现在目标页数区域）
 * - 'image'：自由板图片卡
 * - 'wimg'：写作页内图片卡
 *
 * 历史兼容：所有新增字段都是可选的；旧 `.zhsp` 不含这些字段也能正常打开、保存和再次打开。
 */
export interface Beat {
  id: string;
  text: string;
  color: string;
  /** 自由画布坐标 */
  x: number;
  y: number;
  /** 关联的场景卡 id（SceneMeta.id），可选 */
  sceneId?: string;
  /** 卡片种类；旧数据缺省时按 'beat' 处理 */
  kind?: 'beat' | 'sound' | 'image' | 'wimg';
  /** 卡片标题（声音/图片卡的语义化名称） */
  title?: string;
  /** 图片 dataURL（仅 sound/image/wimg 用得到；声音卡可空） */
  img?: string;
  /** 自定义宽度（像素），缺省时按卡片默认宽度渲染 */
  w?: number;
  /** 自定义高度（像素），缺省时按卡片默认高度渲染 */
  h?: number;
}

/** 自由板卡片之间的关系线；endpoint 用 scene:元素id 或 beat:卡片id 标识。 */
export interface BoardLink {
  id: string;
  from: string;
  to: string;
  note?: string;
}

/** 派生出来的完整场景视图（导航、卡片、报表共用） */
export interface Scene {
  id: string;
  elementId: string;
  index: number;
  number: string;
  heading: string;
  title: string;
  synopsis: string;
  color: string;
  actId?: string;
  omit?: boolean;
  /** 该场景在 elements 中的起止下标 */
  start: number;
  end: number;
  /** 自由画布坐标 */
  x?: number;
  y?: number;
}

/** 幕 / 分集 */
export interface Act {
  id: string;
  title: string;
  color: string;
}

/** 修订集 */
export interface Revision {
  id: string;
  /** A / B / C ... */
  label: string;
  color: string;
}

export interface TitlePage {
  title: string;
  subtitle: string;
  author: string;
  basedOn: string;
  version: string;
  date: string;
  contact: string;
  notes: string;
  show: boolean;
}

/** 单个元素类型的版式：缩进以「全角字符数」为单位（1 = 一个汉字宽度） */
export interface ElementFormat {
  left: number;
  right: number;
  align: TextAlign;
  /** 是否全大写（英文场景） */
  uppercase?: boolean;
  bold?: boolean;
  /** 元素前空行数 */
  spaceBefore: number;
}

export type PaperSize = 'A4' | 'letter';

export interface ScriptSettings {
  fontKey: string; // 见 FONT_PRESETS
  fontSize: number; // pt
  lineHeight: number; // 倍数
  paper: PaperSize;
  marginTop: number; // cm
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  indent: Record<ElementType, ElementFormat>;
  /** 场号显示位置 */
  sceneNumber: 'none' | 'left' | 'right' | 'both';
  autoNumberScenes: boolean;
  sceneNumberPrefix: string; // 例：「第」...「场」
  showPageNumbers: boolean;
  pageNumberTop: number; // 页码距页顶（行）
  startPageAt: number;
  /** 「（更多）」提示文案 */
  moreText: string;
  contdText: string;
  /** 每页顶部是否显示「（续）」 */
  showContd: boolean;
  wordsPerMinute: number;
  revisionMode: boolean;
  printNotes: boolean;
  /** 双列对白开关 */
  dualDialogue: boolean;
  /** 自动将英文引号转换为中文引号 */
  smartQuotes: boolean;
  /** 标题页独立成页 */
  titlePageBreak: boolean;
}

export interface ScriptProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  titlePage: TitlePage;
  elements: ScriptElement[];
  sceneMeta: SceneMeta[];
  /** 自由画布上的节拍卡 / 灵感卡（不绑定场次） */
  beats: Beat[];
  /** 自由板卡片关系线；缺失时按空数组处理，兼容旧项目。 */
  boardLinks?: BoardLink[];
  /** 剧本目标页数；缺失时按 100 页处理，兼容旧项目。 */
  targetPages?: number;
  acts: Act[];
  revisions: Revision[];
  settings: ScriptSettings;
  /** 已删除元素的历史（保留以便恢复） */
  trash?: ScriptElement[];
}

export interface RecentFile {
  path: string;
  name: string;
  updatedAt: number;
}
