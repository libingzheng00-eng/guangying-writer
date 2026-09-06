import type { ElementType, ScriptProject } from '../model/types';
import { newElement } from '../model/project';
import { plain, toLines, countWords } from '../utils/text';

const SCENE_RE = /^(\d+[.、．]\s*|[第]\s*[0-9一二三四五六七八九十百]+\s*[场鏡镜]\s*[.、．:-]?\s*)?(内景|外景|内外景|内\/外景|外\/内景|INT|EXT|int|ext|I\/E)[\s.．、:：-]/;
const TRANSITION_RE = /^(切至|切出|切入|淡入|淡出|叠化|溶至|黑场|白场|淡入淡出|字幕|FADE|CUT TO)[\s]?[：:]?[\s]?[.。]?$/;
const SHOT_RE = /^(特写|大特写|近景|中景|全景|远景|俯拍|仰拍|跟拍|主观|插入|推镜|摇镜|广角|CLOSE UP|CU)[\s]?[-—–:：]/i;

/**
 * 智能解析中文纯文本剧本
 * 支持「1. 内景 咖啡厅 日」「内景 咖啡厅 日」等常见写法
 */
export function fromPlainText(text: string): ScriptProject['elements'] {
  const raw = toLines(text);
  const out: ScriptProject['elements'] = [];
  let pendingAction: string[] = [];

  const flushAction = () => {
    if (pendingAction.length) {
      out.push(newElement('action', pendingAction.join('<br>')));
      pendingAction = [];
    }
  };

  for (let i = 0; i < raw.length; i += 1) {
    const line = raw[i].replace(/\s+$/, '');
    const s = line.trim();
    const prev = out[out.length - 1] || null;
    const next = (raw[i + 1] || '').trim();

    if (!s) {
      flushAction();
      continue;
    }
    if (SCENE_RE.test(s) && s.length <= 40) {
      flushAction();
      out.push(newElement('scene_heading', s.replace(/<[^>]+>/g, '')));
      continue;
    }
    if (TRANSITION_RE.test(s) && s.length <= 16) {
      flushAction();
      out.push(newElement('transition', s));
      continue;
    }
    if (SHOT_RE.test(s) && s.length <= 40) {
      flushAction();
      out.push(newElement('shot', s));
      continue;
    }
    if (/^[（(].+[）)]$/.test(s)) {
      flushAction();
      out.push(newElement('parenthetical', s));
      continue;
    }

    const prevAllowsCharacter =
      !prev || ['action', 'scene_heading', 'transition', 'shot', 'dialogue', 'parenthetical'].includes(prev.type);

    if (prevAllowsCharacter && s.length <= 14 && !/[。！？，、；：”’]/.test(s) && next && !/^[（(]/.test(next)) {
      // 短行 + 下一行有内容 → 视作人物
      flushAction();
      out.push(newElement('character', s));
      continue;
    }
    if (prev && (prev.type === 'character' || prev.type === 'parenthetical' || (prev.type === 'dialogue' && out[out.length - 2]?.type === 'character'))) {
      const last = out[out.length - 1];
      if (last.type === 'dialogue') {
        last.text += `<br>${escapeLine(s)}`;
      } else {
        out.push(newElement('dialogue', escapeLine(s)));
      }
      continue;
    }
    pendingAction.push(escapeLine(s));
  }
  flushAction();
  return out.length ? out : [newElement('action', '')];
}

function escapeLine(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ------------------------------ 导出 ------------------------------ */

function spaces(n: number, full = false): string {
  return full ? '　'.repeat(Math.max(0, Math.round(n / 2))) : ' '.repeat(Math.max(0, Math.round(n * 2)));
}

/** 导出为等宽排版的纯文本剧本 */
export function toPlainText(p: ScriptProject): string {
  const st = p.settings;
  const out: string[] = [];
  if (p.titlePage.show) {
    out.push(p.titlePage.title);
    if (p.titlePage.subtitle) out.push(p.titlePage.subtitle);
    if (p.titlePage.author) out.push(`编剧：${p.titlePage.author}`);
    out.push('');
    out.push('');
  }
  let sceneNo = 0;
  p.elements.forEach((el) => {
    if (el.type === 'note' && !st.printNotes) return;
    if (el.type === 'scene_heading') sceneNo += 1;
    const fmt = st.indent[el.type];
    const left = fmt?.left ?? 0;
    const text = plain(el.text).replace(/\n/g, '\n' + spaces(left, true));
    const prefix = spaces(left, true);
    let body = prefix + text;
    if (el.type === 'scene_heading' && st.autoNumberScenes) {
      body = `${sceneNo}. ${plain(el.text)}`;
    }
    out.push(body);
    if (el.type !== 'note' && el.type !== 'parenthetical') out.push('');
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 导出为 Markdown */
export function toMarkdown(p: ScriptProject): string {
  const out: string[] = [];
  if (p.titlePage.show) {
    out.push(`# ${p.titlePage.title}`);
    if (p.titlePage.subtitle) out.push(`## ${p.titlePage.subtitle}`);
    if (p.titlePage.author) out.push(`> 编剧：${p.titlePage.author}`);
    out.push('');
  }
  let sceneNo = 0;
  let pendingChar = '';
  let pendingParen = '';
  p.elements.forEach((el) => {
    if (el.type === 'note') return;
    const text = plain(el.text).trim();
    switch (el.type) {
      case 'act':
        out.push(`## ${text}`);
        out.push('');
        break;
      case 'scene_heading':
        sceneNo += 1;
        out.push(`### ${p.settings.autoNumberScenes ? `${sceneNo}. ` : ''}${text}`);
        out.push('');
        break;
      case 'action':
      case 'general':
        out.push(text);
        out.push('');
        break;
      case 'character':
        pendingChar = text;
        break;
      case 'parenthetical':
        pendingParen = text;
        break;
      case 'dialogue':
        out.push(`**${pendingChar}**${pendingParen ? ` ${pendingParen}` : ''}`);
        out.push('');
        out.push(text.replace(/\n/g, '\n\n'));
        out.push('');
        pendingChar = '';
        pendingParen = '';
        break;
      case 'transition':
        out.push(`*${text}*`);
        out.push('');
        break;
      case 'shot':
        out.push(`*${text}*`);
        out.push('');
        break;
      default:
        break;
    }
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 导出为 HTML（带内联样式的剧本） */
export function toHtml(p: ScriptProject): string {
  const st = p.settings;
  const body = p.elements
    .filter((el) => el.type !== 'note' || st.printNotes)
    .map((el) => {
      const fmt = st.indent[el.type] || { left: 0, right: 0, align: 'left' };
      const css = [
        `margin-left:${fmt.left}em`,
        `margin-right:${fmt.right}em`,
        `text-align:${fmt.align}`,
        el.type === 'note' ? 'color:#888;font-style:italic' : '',
      ]
        .filter(Boolean)
        .join(';');
      return `<p class="el-${el.type}" style="${css}">${plain(el.text).replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${plain(p.titlePage.title || p.name)}</title>
<style>
body{font-family:${st.fontKey};font-size:${st.fontSize}pt;line-height:${st.lineHeight};margin:4em auto;max-width:48em;padding:0 1em;}
p{margin:0 0 0.8em;}
.el-character{margin-top:1em;}
</style></head><body>
${p.titlePage.show ? `<h1>${plain(p.titlePage.title)}</h1>` : ''}
${body}
</body></html>`;
}

export function wordCountOf(p: ScriptProject): number {
  return p.elements.reduce((n, el) => n + countWords(el.text), 0);
}

export type { ElementType };
