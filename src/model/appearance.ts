import { isHexColor } from '../utils/color';

/** 本机外观偏好，不写入剧本。auto 随主题切换：日间黑色，夜间暖白；旧版保存的其他自定义 HEX 原意不变。 */
export const DEFAULT_FONT_COLOR = 'auto';
export const NIGHT_FONT_COLOR = '#ffe9c4';

export function normalizeFontColor(value: string | null): string {
  const color = value && isHexColor(value) ? value.trim().toLowerCase() : DEFAULT_FONT_COLOR;
  // 以前在设置里点过「暖白」的人，本意就是夜间暖白；现在它就是夜间默认，日间自动换回黑色。
  return color === NIGHT_FONT_COLOR ? DEFAULT_FONT_COLOR : color;
}

export function resolveFontColor(value: string, theme: 'day' | 'night'): string {
  const color = normalizeFontColor(value);
  if (color === DEFAULT_FONT_COLOR) return theme === 'day' ? '#000000' : NIGHT_FONT_COLOR;
  // 原生 color input 只接受六位 HEX；旧三位颜色仍按相同颜色显示。
  return color.length === 4 ? `#${color.slice(1).split('').map((c) => c + c).join('')}` : color;
}
