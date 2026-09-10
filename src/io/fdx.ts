import type { ElementType, ScriptProject } from '../model/types';
import { newElement } from '../model/project';
import { escapeHtml } from '../utils/text';
import { uid } from '../utils/id';

/* ------------------------------ 导出 ------------------------------ */

const FDX_TYPE: Record<ElementType, string> = {
  act: 'Act Heading',
  scene_heading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  shot: 'Shot',
  general: 'General',
  note: 'General',
};

function toFdxText(html: string, indent = ''): string {
  let out = html;
  // 转义裸字符（保留 <b>/<i>/<u> 标签并转成 FDX 的 Style 属性）
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `[B]${inner}[/B]`);
  out = out.replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `[I]${inner}[/I]`);
  out = out.replace(/<u>([\s\S]*?)<\/u>/gi, (_m, inner) => `[U]${inner}[/U]`);
  out = out.replace(/<[^>]+>/g, '');
  const raw = out
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  // 按标记切片，生成 <Text Style="...">
  const parts: string[] = [];
  const re = /\[([BIU])\]([\s\S]*?)\[\/\1\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let style = '';
  while ((m = re.exec(raw))) {
    if (m.index > last) parts.push(textNode(raw.slice(last, m.index), style));
    style = m[1] === 'B' ? 'Bold' : m[1] === 'I' ? 'Italic' : 'Underline';
    parts.push(textNode(m[2], style));
    style = '';
    last = re.lastIndex;
  }
  if (last < raw.length) parts.push(textNode(raw.slice(last), ''));
  const body = parts.length ? parts.join('') : textNode(' ', '');
  return `${indent}${body}`;
}

function textNode(s: string, style: string): string {
  const styleAttr = style ? ` Style="${style}"` : '';
  return `<Text${styleAttr}>${escapeHtml(s)}</Text>`;
}

export function toFdx(p: ScriptProject): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>');
  lines.push('<FinalDraft DocumentType="Script" Template="No" Version="1">');
  lines.push('<Content>');
  const title = p.titlePage;
  if (title.show) {
    lines.push('<TitlePage>');
    const add = (type: string, value: string) => {
      if (value && value.trim()) lines.push(`<Paragraph Type="${type}"><Text>${escapeHtml(value)}</Text></Paragraph>`);
    };
    add('Title', title.title);
    add('Subtitle', title.subtitle);
    add('Author', title.author);
    add('Source', title.basedOn);
    add('Draft date', title.date);
    add('Contact', title.contact);
    lines.push('</TitlePage>');
  }
  const els = p.elements;
  let i = 0;
  while (i < els.length) {
    const el = els[i];
    if (el.type === 'note') {
      i += 1;
      continue;
    }
    if (el.dual && el.dualGroup) {
      const group: typeof els = [];
      const g = el.dualGroup;
      while (i < els.length && els[i].dualGroup === g) {
        group.push(els[i]);
        i += 1;
      }
      lines.push('<Paragraph Type="Dual Dialogue">');
      lines.push('<DualDialogue>');
      (['left', 'right'] as const).forEach((side) => {
        group
          .filter((x) => (x.dual || 'left') === side)
          .forEach((x) => {
            lines.push(`<Paragraph Type="${FDX_TYPE[x.type]}">`);
            lines.push(toFdxText(x.text, '  '));
            lines.push('</Paragraph>');
          });
      });
      lines.push('</DualDialogue>');
      lines.push('</Paragraph>');
      continue;
    }
    const attrs = [`Type="${FDX_TYPE[el.type]}"`];
    lines.push(`<Paragraph ${attrs.join(' ')}>`);
    lines.push(toFdxText(el.text, '  '));
    lines.push('</Paragraph>');
    i += 1;
  }
  lines.push('</Content>');
  lines.push('</FinalDraft>');
  return lines.join('\n');
}

/* ------------------------------ 导入 ------------------------------ */

const FROM_FDX: Record<string, ElementType> = {
  'scene heading': 'scene_heading',
  action: 'action',
  character: 'character',
  parenthetical: 'parenthetical',
  dialogue: 'dialogue',
  transition: 'transition',
  shot: 'shot',
  'act heading': 'act',
  'new act': 'act',
  general: 'general',
  'general text': 'general',
  lyric: 'general',
};

function textOf(el: Element): string {
  const nodes = el.querySelectorAll('Text');
  const src = nodes.length ? Array.from(nodes) : [el];
  let out = '';
  src.forEach((n) => {
    const style = (n.getAttribute('Style') || '').toLowerCase();
    let t = (n.textContent || '').replace(/\r/g, '');
    t = escapeHtml(t);
    if (style.includes('bold')) t = `<b>${t}</b>`;
    if (style.includes('italic')) t = `<i>${t}</i>`;
    if (style.includes('underline')) t = `<u>${t}</u>`;
    out += t;
  });
  return out;
}

export function fromFdx(xml: string): { elements: ScriptProject['elements']; title?: Partial<ScriptProject['titlePage']> } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('FDX 解析失败：文件格式不正确');
  const elements: ScriptProject['elements'] = [];
  const title: Partial<ScriptProject['titlePage']> = {};

  const content = doc.querySelector('Content') || doc.documentElement;
  Array.from(content.children).forEach((node) => {
    const tag = node.tagName.toLowerCase();
    if (tag === 'titlepage') {
      Array.from(node.children).forEach((tp) => {
        const t = (tp.getAttribute('Type') || '').toLowerCase();
        const v = (tp.textContent || '').trim();
        if (t === 'title') title.title = v;
        if (t === 'subtitle') title.subtitle = v;
        if (t === 'author') title.author = v;
        if (t === 'source') title.basedOn = v;
        if (t === 'draft date') title.date = v;
        if (t === 'contact') title.contact = v;
      });
      return;
    }
    if (tag !== 'paragraph') return;
    const type = (node.getAttribute('Type') || '').trim();
    const dual = node.querySelector('DualDialogue');
    if (type.toLowerCase() === 'dual dialogue' && dual) {
      const group = uid('dg');
      let side: 'left' | 'right' = 'left';
      Array.from(dual.children).forEach((child) => {
        if (child.tagName.toLowerCase() !== 'paragraph') return;
        const ct = (child.getAttribute('Type') || '').trim();
        if (ct.toLowerCase() === 'character' && side === 'left') {
          const next = child.nextElementSibling;
          if (next && (next.getAttribute('Type') || '').toLowerCase() === 'character') {
            // 判断切换点：同一侧的人物后面紧跟对白，出现第二个人物时切换到右侧
          }
        }
        const el = newElement(FROM_FDX[ct.toLowerCase()] || 'action', textOf(child));
        el.dual = side;
        el.dualGroup = group;
        elements.push(el);
      });
      // 重新划分左右：以第二个 Character 为界
      const charIdx: number[] = [];
      elements.forEach((e, idx) => {
        if (e.dualGroup === group && e.type === 'character') charIdx.push(idx);
      });
      if (charIdx.length >= 2) {
        elements.forEach((e, idx) => {
          if (e.dualGroup === group) e.dual = idx >= charIdx[1] ? 'right' : 'left';
        });
      }
      return;
    }
    const t = FROM_FDX[type.toLowerCase()] || 'action';
    elements.push(newElement(t, textOf(node)));
  });

  return { elements, title };
}
