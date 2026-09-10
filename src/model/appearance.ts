import { isHexColor } from '../utils/color';

/** 本机外观偏好，不写入剧本。auto 随主题切换；旧版保存的自定义 HEX 原意不变。 */
export const DEFAULT_FONT_COLOR = 'auto';

export function normalizeFontColor(value: string | null): string {
  return value && isHexColor(value) ? value.trim().toLowerCase() : DEFAULT_FONT_COLOR;
}

export function resolveFontColor(value: string, theme: 'day' | 'night'): string {
  const color = normalizeFontColor(value);
  if (color === DEFAULT_FONT_COLOR) return theme === 'day' ? '#000000' : '#ffffff';
  // 原生 color input 只接受六位 HEX；旧三位颜色仍按相同颜色显示。
  return color.length === 4 ? `#${color.slice(1).split('').map((c) => c + c).join('')}` : color;
}
