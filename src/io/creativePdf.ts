/**
 * 创作版 PDF 红线：冻结写作画布的实际排版，不按 A4 重排，不把卡片挪成文末附页。
 * 用内联的已计算样式保留正文、图片、声音卡的相对坐标，文字仍可搜索/选择。
 * 超长画布只在场景/段落和卡片之外切页；切页只平移整张画布，绝不重排图文。
 */
const MAX_PAGE_PX = 18000;
const PX_TO_MICRONS = 25400 / 96;
const HIDE_CONTROLS = 'button, .writing-material-card__drag, .writing-select-box, .script-flow__tail, .titlepage-card__hint';

function copyStyle(source: Element, target: HTMLElement, pseudo?: string) {
  const style = getComputedStyle(source, pseudo);
  for (const name of Array.from(style)) target.style.setProperty(name, style.getPropertyValue(name));
  target.style.animation = 'none';
  target.style.transition = 'none';
  target.style.caretColor = 'transparent';
  target.style.setProperty('-webkit-print-color-adjust', 'exact');
  target.style.setProperty('print-color-adjust', 'exact');
}

function snapshot(source: Node): Node | null {
  if (source.nodeType === Node.TEXT_NODE) return source.cloneNode();
  if (!(source instanceof HTMLElement)) return null;
  if (source.matches('script, style, iframe, object, embed, link, meta')) return null;
  const formText = source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement;
  const target = document.createElement(formText ? 'div' : source.tagName.toLowerCase());
  // 不复制事件、链接、contenteditable 等活动属性，也不复制工程外的网络地址。
  if (source.dataset.id) target.dataset.id = source.dataset.id;
  if (source.dataset.type) target.dataset.type = source.dataset.type;
  if (source.className) target.className = source.className;
  copyStyle(source, target);
  if (source.matches(HIDE_CONTROLS) || (source instanceof HTMLInputElement && source.type === 'checkbox')) {
    target.style.visibility = 'hidden';
  }
  if (formText) {
    const rect = source.getBoundingClientRect();
    target.style.width = `${rect.width}px`;
    target.style.height = `${rect.height}px`;
    target.style.boxSizing = 'border-box';
    target.style.flex = 'none';
    target.style.overflow = 'hidden';
    const text = document.createElement('div');
    text.textContent = source.value;
    text.style.whiteSpace = source instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre';
    text.style.transform = `translate(${-source.scrollLeft}px, ${-source.scrollTop}px)`;
    target.appendChild(text);
  } else if (source instanceof HTMLImageElement) {
    const image = target as HTMLImageElement;
    image.alt = source.alt;
    // 工程图片是内嵌 data URL。写作图卡不存在外网抓图行为。
    // 无 MIME 的有效 PNG 经 FileReader 得到 data:application/octet-stream；
    // 以实际解码成功为准，不能把软件里看得见的这类图片从 PDF 静默删掉。
    if (source.src.startsWith('data:') && source.naturalWidth > 0) image.src = source.src;
  } else {
    for (const child of Array.from(source.childNodes)) {
      const copied = snapshot(child);
      if (copied) target.appendChild(copied);
    }
    // CONT'D 是伪元素，只冻结其显示文字，不能写回工程正文。
    if (source.dataset.contd) {
      const suffix = document.createElement('span');
      copyStyle(source, suffix, '::after');
      suffix.textContent = source.dataset.contd;
      target.appendChild(suffix);
    }
  }
  return target;
}

export function buildCreativePdf(canvas: HTMLElement) {
  const origin = canvas.getBoundingClientRect();
  const content = Array.from(canvas.querySelectorAll<HTMLElement>('.script-flow, .titlepage-card, .writing-material-card'));
  const width = Math.ceil(Math.max(origin.width, ...content.map(e => e.getBoundingClientRect().right - origin.left + 16)));
  const height = Math.ceil(Math.max(200, ...content.map(e => e.getBoundingClientRect().bottom - origin.top + 24)));
  if (width > MAX_PAGE_PX) throw new Error('画布过宽，请将远离正文的素材卡移近后再导出。');
  const forbidden = Array.from(canvas.querySelectorAll<HTMLElement>('.sc-el, .writing-material-card, .titlepage-card')).map(e => {
    const b = e.getBoundingClientRect();
    return { top: b.top - origin.top, bottom: b.bottom - origin.top };
  });
  const headings = Array.from(canvas.querySelectorAll<HTMLElement>('.sc-el[data-type="scene_heading"]')).map(e => e.getBoundingClientRect().top - origin.top);
  // 优先把完整场景和旁边的卡片放在同一张数字长页上。
  for (let i = 0; i < headings.length; i++) {
    const bottom = headings[i + 1] ?? height - 24;
    if (bottom - headings[i] < MAX_PAGE_PX) forbidden.push({ top: headings[i], bottom });
  }
  const cuts = [0];
  while (cuts[cuts.length - 1] + MAX_PAGE_PX < height) {
    const start = cuts[cuts.length - 1];
    let end = start + MAX_PAGE_PX;
    for (;;) {
      const overlaps = forbidden.filter(b => b.top < end && b.bottom > end);
      if (!overlaps.length) break;
      end = Math.floor(Math.min(...overlaps.map(b => b.top)));
    }
    if (end <= start) throw new Error('存在超长且无法完整放入一页的图文组合，请缩短该段或调整卡片后导出。');
    cuts.push(end);
  }
  cuts.push(height);
  const clone = snapshot(canvas) as HTMLElement;
  Object.assign(clone.style, { position: 'absolute', left: '0px', top: '0px', width: `${width}px`, height: `${height}px`, minHeight: '0', margin: '0', boxSizing: 'border-box', overflow: 'hidden' });
  // 写作画布背景来自外层，需一并冻结，避免深色文字/图片卡在导出中失去原背景。
  const background = document.querySelector('.write-bg');
  if (background) {
    clone.style.backgroundImage = getComputedStyle(background).backgroundImage;
    clone.style.backgroundColor = getComputedStyle(document.querySelector('.app-shell')!).backgroundColor;
  }
  const rules: string[] = [];
  const sheets: string[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const h = cuts[i + 1] - cuts[i];
    rules.push(`@page sheet${i} { size: ${width}px ${h}px; margin: 0; }`);
    clone.style.top = `${-cuts[i]}px`;
    sheets.push(`<section class="export-sheet" style="page:sheet${i};position:relative;width:${width}px;height:${h}px;overflow:hidden;break-after:${i === cuts.length - 2 ? 'auto' : 'page'}">${clone.outerHTML}</section>`);
  }
  return {
    mode: 'creative' as const,
    pageSize: { width: Math.ceil(width * PX_TO_MICRONS), height: Math.ceil((cuts[1] - cuts[0]) * PX_TO_MICRONS) },
    html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><style>html,body{margin:0;padding:0;}*{ -webkit-print-color-adjust:exact;print-color-adjust:exact;} ${rules.join('\n')}</style></head><body>${sheets.join('\n')}</body></html>`,
  };
}
