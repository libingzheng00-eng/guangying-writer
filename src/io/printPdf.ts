import { snapshotPrintableNode } from './creativePdf';
import { PAPER_MM } from '../model/stats';

// These are the existing app.css @media print overrides. The preview has already
// chosen every page, line window, continuation offset, margin and dual column.
// Freeze those nodes; do not run another pagination or change project settings.
const BLACK_PRINT_TEXT = '.preview__page, .sc-el, .title-page, .page__body, .sc-scene-no, .sc-contd, .sc-more';

export function buildPrintPdf(preview: HTMLElement) {
  const pages = Array.from(preview.querySelectorAll<HTMLElement>('.preview__scroll > .preview__page'));
  if (!pages.length) throw new Error('A4 排版尚未就绪，请稍后重试。');
  const sheets = pages.map(page => {
    const clone = snapshotPrintableNode(page, (source, target) => {
      if (source.matches(BLACK_PRINT_TEXT)) target.style.color = '#000';
      // Computed styles resolve inherited colors. Preserve that inheritance so
      // bold/italic text also follows print's black text, while explicit title
      // subtitle/footer shades retain the existing print appearance.
      else if (source.parentElement && getComputedStyle(source).color === getComputedStyle(source.parentElement).color) {
        target.style.color = 'inherit';
      }
      target.style.setProperty('-webkit-text-fill-color', 'currentcolor');
      target.style.setProperty('text-decoration-color', 'currentcolor');
    }) as HTMLElement;
    // The page geometry is the inline A4 size chosen by PreviewView, never a
    // computed size that a short window or flex layout may have shrunk.
    Object.assign(clone.style, {
      width: page.style.width, height: page.style.height, flex: 'none',
      zoom: '1', boxShadow: 'none', margin: '0', background: '#fff',
      breakAfter: 'auto', pageBreakAfter: 'auto', breakInside: 'avoid', pageBreakInside: 'avoid',
    });
    return `<section class="print-sheet">${clone.outerHTML}</section>`;
  });
  return {
    mode: 'print' as const,
    pageSize: { width: PAPER_MM.A4.w * 1000, height: PAPER_MM.A4.h * 1000 },
    html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><style>@page{size:A4;margin:0}html,body{margin:0;padding:0;height:auto;background:#fff}.print-sheet{break-after:page;page-break-after:always;break-inside:avoid;page-break-inside:avoid}.print-sheet:last-child{break-after:auto;page-break-after:auto}</style></head><body>${sheets.join('\n')}</body></html>`,
  };
}
