import type { ElementFormat, ElementType, SceneMeta, ScriptProject, TitlePage } from '../model/types';
import { DEFAULT_INDENT } from '../model/elements';
import { deriveScenes, newElement } from '../model/project';
import { escapeHtml, plain, stripSceneNumber } from '../utils/text';
import { richNotePlain } from '../utils/richNote';
import { uid } from '../utils/id';

/*
 * Final Draft（.fdx）导出 / 导入。
 * 结构对照 Final Draft 13 自带的「US Screenplay (Chinese - Simplified)」模板：
 * 正文在 <Content>，标题页是与 <Content> 并列的 <TitlePage>，
 * 字体与缩进写在 <ElementSettings>，纸张写在 <PageLayout>。
 * 中文用 Final Draft 自带的「Sans Mono CJK Final Draft」字体，缩进按本软件的「元素缩进」换算成英寸。
 */

/* ------------------------------ 导出 ------------------------------ */

const FDX_TYPE: Record<Exclude<ElementType, 'note'>, string> = {
  act: 'New Act',
  scene_heading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  shot: 'Shot',
  general: 'General',
};
const RETURN_KEY: Record<string, string> = {
  'New Act': 'Scene Heading', 'Scene Heading': 'Action', Action: 'Action', Character: 'Dialogue', Parenthetical: 'Dialogue',
  Dialogue: 'Action', Transition: 'Scene Heading', Shot: 'Action', General: 'General',
};
const CJK_FONT = 'Sans Mono CJK Final Draft';
const PAGE_INCHES = { A4: { width: 8.27, height: 11.69 }, letter: { width: 8.5, height: 11 } } as const;

const inch = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
const attr = (value: string) => escapeHtml(value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''));
const xmlText = (value: string) => attr(value).replace(/&#39;/g, "'");

/** #rgb / #rrggbb → Final Draft 的 16 位色 #RRRRGGGGBBBB；无法识别时返回空。 */
export function fdxColor(color: string | undefined): string {
  const hex = (color || '').trim().replace(/^#/, '');
  const full = /^[0-9a-f]{3}$/i.test(hex) ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return '';
  return `#${full.match(/../g)!.map((pair) => (pair + pair).toUpperCase()).join('')}`;
}

/** 行内 <b>/<i>/<u> → 带 Style 的 <Text> 片段；<br> 拆成多段（Final Draft 的一段不含硬换行）。 */
export function fdxRuns(html: string): string[][] {
  const lines: string[][] = [[]];
  const depth = { b: 0, i: 0, u: 0 };
  const decode = (s: string) => s
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
  const push = (text: string) => {
    if (!text) return;
    const style = [depth.b && 'Bold', depth.i && 'Italic', depth.u && 'Underline'].filter(Boolean).join('+');
    lines[lines.length - 1].push(`<Text${style ? ` Style="${style}"` : ''}>${xmlText(decode(text))}</Text>`);
  };
  const tokens = (html || '').split(/(<[^>]+>)/);
  for (const token of tokens) {
    const tag = token.match(/^<\s*(\/?)\s*([a-z]+)/i);
    if (!tag) { push(token); continue; }
    const name = tag[2].toLowerCase(), closing = tag[1] === '/';
    const key = name === 'strong' ? 'b' : name === 'em' ? 'i' : name;
    if (key === 'br') lines.push([]);
    else if (key === 'b' || key === 'i' || key === 'u') depth[key] = Math.max(0, depth[key] + (closing ? -1 : 1));
    else if ((key === 'div' || key === 'p') && closing) lines.push([]);
  }
  return lines;
}

function paragraph(type: string, html: string, extra = '', inner = ''): string[] {
  const lines = fdxRuns(html);
  // 只有第一段带场号 / 场景属性；其余换行拆成同类型的后续段落。
  return lines.map((runs, index) => [
    `    <Paragraph${index === 0 ? extra : ''} Type="${type}">`,
    ...(index === 0 && inner ? [inner] : []),
    `      ${runs.length ? runs.join('') : '<Text></Text>'}`,
    '    </Paragraph>',
  ].join('\n'));
}

function sceneProperties(scene: { title?: string; synopsis?: string; color?: string }): string {
  const title = (scene.title || '').trim();
  const synopsis = richNotePlain(scene.synopsis).trim();
  const color = fdxColor(scene.color);
  if (!title && !synopsis && !color) return '';
  const attrs = [color && `Color="${color}"`, title && `Title="${attr(title)}"`].filter(Boolean).join(' ');
  const summary = synopsis
    ? ['        <Summary>', ...synopsis.split(/\r?\n/).map((line) => `          <Paragraph><Text>${xmlText(line)}</Text></Paragraph>`), '        </Summary>'].join('\n')
    : '';
  return summary ? `      <SceneProperties${attrs ? ` ${attrs}` : ''}>\n${summary}\n      </SceneProperties>` : `      <SceneProperties ${attrs} />`;
}

function elementSettings(project: ScriptProject): string[] {
  const { settings } = project;
  const page = PAGE_INCHES[settings.paper] || PAGE_INCHES.A4;
  const em = (settings.fontSize || 12) / 72; // 一个全角字宽（英寸）
  const left = settings.marginLeft / 2.54, right = page.width - settings.marginRight / 2.54;
  const spacing = settings.lineHeight >= 1.75 ? '2' : settings.lineHeight >= 1.25 ? '1.5' : '1';
  return (Object.entries(FDX_TYPE) as [Exclude<ElementType, 'note'>, string][]).map(([type, fdxType]) => {
    const format: ElementFormat = settings.indent?.[type] || DEFAULT_INDENT[type];
    const style = format.bold ? 'Bold' : '';
    const align = format.align === 'center' ? 'Center' : format.align === 'right' ? 'Right' : 'Left';
    return [
      `  <ElementSettings Type="${fdxType}">`,
      `    <FontSpec AdornmentStyle="0" Background="#FFFFFFFFFFFF" Color="#000000000000" Font="${CJK_FONT}" RevisionID="0" Size="${settings.fontSize || 12}" Style="${style}" />`,
      `    <ParagraphSpec Alignment="${align}" FirstIndent="0.00" Leading="Regular" LeftIndent="${inch(left + format.left * em)}" RightIndent="${inch(right - format.right * em)}" SpaceBefore="${Math.max(0, format.spaceBefore) * 12}" Spacing="${spacing}" StartsNewPage="No" />`,
      `    <Behavior PaginateAs="${fdxType}" ReturnKey="${RETURN_KEY[fdxType]}" />`,
      '  </ElementSettings>',
    ].join('\n');
  });
}

function titlePage(title: TitlePage, project: ScriptProject): string[] {
  const page = PAGE_INCHES[project.settings.paper] || PAGE_INCHES.A4;
  const line = (text: string, align: 'Center' | 'Left') =>
    `      <Paragraph Alignment="${align}" FirstIndent="0.00" Leading="Regular" LeftIndent="1.00" RightIndent="${inch(page.width - 1)}" SpaceBefore="0" Spacing="1" StartsNewPage="No"><Text>${xmlText(text)}</Text></Paragraph>`;
  const blank = (n: number) => Array.from({ length: n }, () => line('', 'Left'));
  // 旧工程的标题页可能缺字段。
  const lines = (value: string | undefined) => (value || '').split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
  const centre = [title.title, title.subtitle].flatMap(lines);
  const credit = [...lines(title.author), ...lines(title.basedOn)];
  const bottom = [title.version, title.date, title.contact].flatMap(lines);
  return [
    '  <TitlePage>',
    '    <Content>',
    ...blank(14), ...centre.map((v) => line(v, 'Center')),
    ...(credit.length ? [...blank(2), ...credit.map((v) => line(v, 'Center'))] : []),
    ...(bottom.length ? [...blank(Math.max(2, 22 - centre.length - credit.length - bottom.length)), ...bottom.map((v) => line(v, 'Left'))] : []),
    '    </Content>',
    '  </TitlePage>',
  ];
}

export function toFdx(p: ScriptProject): string {
  const { settings } = p;
  const scenes = deriveScenes(p);
  const sceneByStart = new Map(scenes.map((scene) => [scene.start, scene]));
  const omitted = new Set<number>();
  for (const scene of scenes) if (scene.omit) for (let i = scene.start; i < scene.end; i++) omitted.add(i);
  const numbered = settings.autoNumberScenes && settings.sceneNumber !== 'none';

  const body: string[] = [];
  const els = p.elements;
  for (let i = 0; i < els.length;) {
    const el = els[i];
    // 备忘不进交稿文件；省略的元素 / 整场不导出（场号保持原编号，与正式稿一致）。
    if (el.type === 'note' || el.omit || omitted.has(i)) { i += 1; continue; }
    if (el.dual && el.dualGroup) {
      const group: typeof els = [];
      for (const g = el.dualGroup; i < els.length && els[i].dualGroup === g; i += 1) if (!els[i].omit && els[i].type !== 'note') group.push(els[i]);
      const side = (s: 'left' | 'right') => group.filter((x) => (x.dual || 'left') === s).flatMap((x) => paragraph(FDX_TYPE[x.type as Exclude<ElementType, 'note'>], x.text).map((line) => line.replace(/^ {4}/gm, '        ')));
      body.push('    <Paragraph Type="General">', '      <DualDialogue>', ...side('left'), ...side('right'), '      </DualDialogue>', '      <Text></Text>', '    </Paragraph>');
      continue;
    }
    if (el.type === 'scene_heading') {
      const scene = sceneByStart.get(i);
      const text = numbered ? escapeHtml(stripSceneNumber(plain(el.text).trim())) : el.text;
      // 只有作者真的填过场景卡（有元数据）才带场景属性，避免给每场都塞一个默认颜色。
      const meta = p.sceneMeta.find((m) => m.elementId === el.id);
      body.push(...paragraph('Scene Heading', text, numbered && scene ? ` Number="${attr(scene.number)}"` : '', meta ? sceneProperties(meta) : ''));
    } else {
      body.push(...paragraph(FDX_TYPE[el.type], el.text));
    }
    i += 1;
  }

  const page = PAGE_INCHES[settings.paper] || PAGE_INCHES.A4;
  const pt = (cm: number) => Math.round((cm / 2.54) * 72);
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="4">',
    '  <Content>',
    ...body,
    '  </Content>',
    `  <PageLayout BottomMargin="${pt(settings.marginBottom)}" FooterMargin="36" HeaderMargin="36" TopMargin="${pt(settings.marginTop)}" UsesSmartQuotes="No">`,
    `    <PageSize Height="${inch(page.height)}" Width="${inch(page.width)}" />`,
    '  </PageLayout>',
    ...elementSettings(p),
    ...(p.titlePage.show ? titlePage(p.titlePage, p) : []),
    '  <MoresAndContinueds>',
    `    <DialogueBreaks AutomaticCharacterContinueds="${settings.contdCharacter === false ? 'No' : 'Yes'}" BottomOfPage="Yes" DialogueBottom="${attr(settings.moreText || '(MORE)')}" DialogueTop="${attr(settings.contdText || "(CONT'D)")}" TopOfNext="Yes" />`,
    '  </MoresAndContinueds>',
    `  <SceneNumberOptions LeftLocation="0.75" NumberScheme="1A" RightLocation="${inch(page.width - 0.9)}" ShowNumbersOnLeft="${['left', 'both'].includes(settings.sceneNumber) ? 'Yes' : 'No'}" ShowNumbersOnRight="${['right', 'both'].includes(settings.sceneNumber) ? 'Yes' : 'No'}" />`,
    '</FinalDraft>',
    '',
  ].join('\n');
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
  'end of act': 'act',
  general: 'general',
  'general text': 'general',
  lyric: 'general',
};

const childElements = (node: Element, name: string) => Array.from(node.children).filter((child) => child.tagName.toLowerCase() === name.toLowerCase());

/** 只读段落自己的 <Text>，不把场景梗概（SceneProperties/Summary）等嵌套内容混进正文。 */
function textOf(el: Element): string {
  let out = '';
  for (const n of childElements(el, 'Text')) {
    const style = (n.getAttribute('Style') || '').toLowerCase();
    let t = escapeHtml((n.textContent || '').replace(/\r/g, '')).replace(/\n/g, '<br>');
    if (!t) continue;
    if (style.includes('underline')) t = `<u>${t}</u>`;
    if (style.includes('italic')) t = `<i>${t}</i>`;
    if (style.includes('bold')) t = `<b>${t}</b>`;
    out += t;
  }
  return out;
}

const plainText = (el: Element) => childElements(el, 'Text').map((n) => n.textContent || '').join('').trim();

/** 读回 Final Draft 标题页：居中的第一行是片名；「Written by / 编剧」之后是作者；左下角是联系方式。 */
function readTitlePage(node: Element): Partial<TitlePage> {
  const content = childElements(node, 'Content')[0] || node;
  const paragraphs = childElements(content, 'Paragraph');
  // 旧版本光影写手导出的标题页：段落带 Type="Title" 等。
  const typed = paragraphs.filter((p) => p.getAttribute('Type'));
  if (typed.length) {
    const title: Partial<TitlePage> = {};
    const map: Record<string, keyof TitlePage> = { title: 'title', subtitle: 'subtitle', author: 'author', source: 'basedOn', 'draft date': 'date', contact: 'contact' };
    for (const p of typed) { const key = map[(p.getAttribute('Type') || '').toLowerCase()]; if (key) (title as Record<string, string>)[key] = (p.textContent || '').trim(); }
    return title;
  }
  const centred: string[] = [], other: string[] = [];
  for (const p of paragraphs) {
    const text = plainText(p);
    if (text) ((p.getAttribute('Alignment') || '').toLowerCase() === 'center' ? centred : other).push(text);
  }
  if (!centred.length && !other.length) return {};
  const title: Partial<TitlePage> = { title: centred[0] || '' };
  const rest = centred.slice(1);
  const by = rest.findIndex((line) => /^(written by|screenplay by|story by|teleplay by|by|编剧|作者|编剧：?)$/i.test(line));
  if (by >= 0) {
    if (by > 0) title.subtitle = rest.slice(0, by).join('\n');
    title.author = [rest[by], ...rest.slice(by + 1).filter((line) => !/based on|改编自|原著/i.test(line))].join('\n');
    const based = rest.slice(by + 1).filter((line) => /based on|改编自|原著/i.test(line));
    if (based.length) title.basedOn = based.join('\n');
  } else if (rest.length) {
    title.subtitle = rest.join('\n');
  }
  if (other.length) title.contact = other.join('\n');
  return title;
}

export interface FdxImport {
  elements: ScriptProject['elements'];
  title?: Partial<TitlePage>;
  /** 场景卡附加信息（Final Draft 的场景标题 / 梗概 / 颜色），按导入后的场次标题 id 对应。 */
  sceneMeta: SceneMeta[];
}

/** #RRRRGGGGBBBB / #RRGGBB → #rrggbb */
function fromFdxColor(value: string | null): string {
  const hex = (value || '').replace(/^#/, '');
  if (/^[0-9a-f]{12}$/i.test(hex)) return `#${hex.match(/..../g)!.map((part) => part.slice(0, 2)).join('').toLowerCase()}`;
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  return '';
}

export function fromFdx(xml: string): FdxImport {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('FDX 解析失败：文件格式不正确');
  const root = doc.documentElement;
  const elements: ScriptProject['elements'] = [];
  const sceneMeta: SceneMeta[] = [];
  let title: Partial<TitlePage> | undefined;

  const topTitle = childElements(root, 'TitlePage')[0];
  if (topTitle) title = readTitlePage(topTitle);
  const content = childElements(root, 'Content')[0] || root;

  for (const node of Array.from(content.children)) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'titlepage') { title = { ...readTitlePage(node), ...title }; continue; }
    if (tag !== 'paragraph') continue;
    const dual = childElements(node, 'DualDialogue')[0];
    if (dual) {
      const group = uid('dg');
      const parts = childElements(dual, 'Paragraph');
      const secondCharacter = parts.findIndex((child, index) => index > 0 && (child.getAttribute('Type') || '').toLowerCase() === 'character');
      parts.forEach((child, index) => {
        const el = newElement(FROM_FDX[(child.getAttribute('Type') || '').toLowerCase()] || 'dialogue', textOf(child));
        el.dual = secondCharacter > 0 && index >= secondCharacter ? 'right' : 'left';
        el.dualGroup = group;
        elements.push(el);
      });
      continue;
    }
    const type = FROM_FDX[(node.getAttribute('Type') || '').trim().toLowerCase()] || 'action';
    const el = newElement(type, textOf(node));
    elements.push(el);
    const props = type === 'scene_heading' ? childElements(node, 'SceneProperties')[0] : undefined;
    if (props) {
      const summary = childElements(props, 'Summary')[0];
      const synopsis = summary ? childElements(summary, 'Paragraph').map(plainText).filter(Boolean).join('\n') : '';
      const color = fromFdxColor(props.getAttribute('Color'));
      const sceneTitle = (props.getAttribute('Title') || '').trim();
      if (synopsis || color || sceneTitle) sceneMeta.push({ id: uid('sc'), elementId: el.id, title: sceneTitle, synopsis, color: color || '#cfe4ff' });
    }
  }

  return { elements, title, sceneMeta };
}
