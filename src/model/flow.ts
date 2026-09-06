import type { ElementType, ScriptElement, ScriptProject } from './types';
import { isDialogueType } from './elements';
import { plain } from '../utils/text';

/**
 * Tab / Shift+Tab 的元素类型循环（参考 Final Draft 主线）
 * 仅循环 7 个常用类型；act / general / note 通过工具栏或专用快捷键切换。
 */
const TAB_CYCLE: ElementType[] = [
  'action',
  'character',
  'parenthetical',
  'dialogue',
  'transition',
  'shot',
  'scene_heading',
];

export function nextTypeOnTab(current: ElementType, shift = false): ElementType {
  const i = TAB_CYCLE.indexOf(current);
  // 不在循环里的类型（act / general / note 等）落到 action，避免静默吞掉按键
  if (i < 0) return shift ? 'scene_heading' : 'action';
  const n = TAB_CYCLE.length;
  return TAB_CYCLE[(i + (shift ? -1 : 1) + n) % n];
}

/**
 * 回车后新元素的默认类型
 * @param current 当前元素
 * @param isEmpty 当前元素内容是否为空
 */
export function nextTypeOnEnter(current: ScriptElement, isEmpty: boolean): ElementType {
  // 空块回车：统一落到「动作」，与 Final Draft 习惯一致
  if (isEmpty) {
    if (current.dual) return 'dialogue';
    return 'action';
  }
  const t = current.type;
  switch (t) {
    case 'act':
      return 'scene_heading';
    case 'scene_heading':
      return 'action';
    case 'action':
      return 'action';
    case 'character':
      return 'dialogue';
    case 'parenthetical':
      return 'dialogue';
    case 'dialogue':
      return 'character';
    case 'transition':
      return 'scene_heading';
    case 'shot':
      return 'action';
    case 'general':
      return 'general';
    case 'note':
      return 'note';
    default:
      return 'action';
  }
}

/**
 * 回车后新元素是否延续双列对白，以及延续哪一侧
 */
export function dualAfterEnter(current: ScriptElement, nextType: ElementType): { dual?: 'left' | 'right'; newGroup?: boolean } {
  if (!current.dual) return {};
  if (nextType === 'action' || nextType === 'scene_heading') return {};
  // 左侧人物下面的对白仍在左侧
  if (current.type === 'character') return { dual: current.dual };
  if (current.type === 'parenthetical') return { dual: current.dual };
  if (current.type === 'dialogue') {
    // 左侧对白之后 → 新建右侧人物
    if (current.dual === 'left') return { dual: 'right', newGroup: true };
    // 右侧对白之后 → 结束双列
    return {};
  }
  return { dual: current.dual };
}

/**
 * 判断一个元素是否需要与下一个元素保持同页（不分页）
 */
export function keepWithNext(el: ScriptElement): number {
  switch (el.type) {
    case 'scene_heading':
      return 2; // 场次标题至少带 2 行内容
    case 'act':
      return 2;
    case 'character':
      return 2; // 人物与对白不分离
    case 'parenthetical':
      return 2;
    case 'shot':
      return 1;
    default:
      return 0;
  }
}

/** 是否允许跨页拆分（长动作段落可以拆，对白块尽量不拆） */
export function canSplit(el: ScriptElement): boolean {
  return el.type === 'action' || el.type === 'general' || el.type === 'dialogue';
}

export function isDualGroup(elements: ScriptElement[], i: number): boolean {
  const el = elements[i];
  if (!el || !el.dual) return false;
  return true;
}

/** 收集连续的同一双列对白分组 */
export function groupDual(elements: ScriptElement[]): (ScriptElement | ScriptElement[])[] {
  const out: (ScriptElement | ScriptElement[])[] = [];
  let i = 0;
  while (i < elements.length) {
    const el = elements[i];
    if (el.dual && el.dualGroup) {
      const group: ScriptElement[] = [];
      let j = i;
      while (j < elements.length && elements[j].dualGroup === el.dualGroup) {
        group.push(elements[j]);
        j += 1;
      }
      out.push(group);
      i = j;
    } else {
      out.push(el);
      i += 1;
    }
  }
  return out;
}

/**
 * 自动识别一段文本可能的元素类型（用于纯文本导入与粘贴）
 */
export function guessType(line: string, prev?: ScriptElement): ElementType {
  const s = line.trim();
  if (!s) return 'action';
  // 场次标题：1. 内景 咖啡厅 日 / 场景 3 - 外景 街道 夜 / INT. ...
  if (/^\d+[.、．]\s*\S+/.test(s)) return 'scene_heading';
  if (/^第\s*[0-9一二三四五六七八九十百]+\s*[场鏡镜幕]/.test(s)) return 'scene_heading';
  if (/^(内景|外景|内外景|内\/外景|外\/内景|INT|EXT|int|ext)[\s.．、:]/.test(s)) return 'scene_heading';
  if (/^(INT|EXT)[\s.．]/.test(s.toUpperCase())) return 'scene_heading';
  // 转场
  if (/(切至|切出|淡入|淡出|叠化|溶至|黑场|淡入淡出|FADE|切|叠)[：:]?\s*(\.|。)?$/.test(s) && s.length <= 12) {
    return 'transition';
  }
  // 括号提示
  if (/^[（(].+[）)]$/.test(s)) return 'parenthetical';
  // 镜头
  if (/(特写|近景|中景|全景|远景|大特写|插入|主观|俯拍|仰拍|跟拍|摇摄|推镜)/.test(s) && s.length <= 30) {
    return 'shot';
  }
  // 人物：全角/半角括号包裹的提示行不算
  if (prev && (prev.type === 'action' || prev.type === 'scene_heading' || prev.type === 'transition' || prev.type === 'dialogue' || prev.type === 'shot')) {
    // 短行、无句末标点 → 视作人物
    if (s.length <= 12 && !/[。！？，、；：]/.test(s)) return 'character';
  }
  if (prev && prev.type === 'character') return 'dialogue';
  return 'action';
}

/**
 * Final Draft 风格的「正在输入」识别：根据一行文本的形态给出可能的元素类型。
 * 仅当空块第一次输入时才调用，避免误判用户后续编辑。
 * 返回 null 表示没有命中，保持当前类型。
 */
export function recognizeType(line: string): ElementType | null {
  const s = line.trim();
  if (!s) return null;
  // 场次标题
  if (/^\d+[.、．]\s*\S+/.test(s)) return 'scene_heading';
  if (/^第\s*[0-9一二三四五六七八九十百千]+\s*[场鏡镜幕]/.test(s)) return 'scene_heading';
  if (/^(内景|外景|内\/外景|外\/内景|内外景)[\s.．、:]/.test(s)) return 'scene_heading';
  if (/^(INT|EXT|I\/E|E\/I)[\s.．、:]/.test(s)) return 'scene_heading';
  // 转场：短行，结尾「：」「:」或常见转场词
  if (s.length <= 12 && /[：:]\s*$/.test(s)) return 'transition';
  if (s.length <= 12 && /(切至|切出|淡入|淡出|叠化|溶至|黑场|字幕)[：:]?\s*(\.|。)?$/.test(s)) return 'transition';
  if (/^FADE\s+(IN|OUT)[:.]?\s*$/i.test(s)) return 'transition';
  // 全大写英文 → character
  if (/^[A-Z][A-Z0-9 .'’\-]{0,20}$/.test(s) && /[A-Z]/.test(s) && !/[a-z]/.test(s)) return 'character';
  // 括号提示
  if (/^[（(].+[）)]$/.test(s)) return 'parenthetical';
  // 镜头
  if (/^(特写|大特写|近景|中景|全景|远景|俯拍|仰拍|主观镜头|插入镜头|跟拍|摇摄|推镜|拉镜)\s*-?\s*$/.test(s)) return 'shot';
  return null;
}

/**
 * 给定一个对白元素 id，反向查最近的人物名（在遇到场次标题前截止）。
 * 找不到返回 null（不会抛）。
 */
export function characterForDialogue(project: { elements: ScriptElement[] }, dialogueId: string): string | null {
  const idx = project.elements.findIndex((e) => e.id === dialogueId);
  if (idx < 0) return null;
  for (let i = idx; i >= 0; i -= 1) {
    const el = project.elements[i];
    if (el.type === 'character') {
      const name = plain(el.text).trim();
      return name || null;
    }
    if (el.type === 'scene_heading') break;
  }
  return null;
}

/**
 * 「（续）」标签：仅当「当前对白所属人物 === 上一页最末对白所属人物」时返回带姓名的版本，
 * 否则回退为不带姓名的「（续）」，避免跨人物 / 跨场次时仍沿用旧角色名误导读者。
 */
export function contdLabelFor(
  item: { elements: ScriptElement[] },
  project: ScriptProject,
  prevChar: string | null,
): string {
  const name = characterForDialogue(project, item.elements[0].id);
  if (name && prevChar && name === prevChar) {
    return `${name}${project.settings.contdText}`;
  }
  return '（续）';
}

export { isDialogueType };
