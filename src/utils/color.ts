/**
 * #rgb / #rrggbb → rgba(r, g, b, alpha)
 * 用于把用户选的字体颜色派生出 soft / glow 等半透明变体。
 * 非法输入回退到默认荧光黄，保证 CSS 变量永远有效。
 */
export function hexToRgba(hex: string, alpha: number): string {
  const raw = (hex || '').trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const m = /^([0-9a-f]{6})$/i.exec(full);
  if (!m) return `rgba(233, 255, 58, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 判断是否为合法颜色值，避免非法输入污染 CSS 变量 */
export function isHexColor(v: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test((v || '').trim());
}
