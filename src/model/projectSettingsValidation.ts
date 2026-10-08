import { defaultSettings } from './project';
import { DEFAULT_INDENT, ELEMENT_META, ELEMENT_ORDER } from './elements';
import { PAPER_MM } from './stats';

export interface SettingsValidationIssue { field: string; message: string }

/** One admission contract for imported settings and live settings controls.
 * Missing legacy fields inherit defaults for validation only. Never clamp or
 * rewrite a caller's values; unknown extension fields remain the caller's data.
 */
export function validateProjectSettings(value: unknown): SettingsValidationIssue[] {
  const issues: SettingsValidationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  const isRecord = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  if (value !== undefined && !isRecord(value)) return [{ field: 'settings', message: '设置必须是有效的字段记录。' }];
  const incoming = value === undefined ? {} : value as Record<string, unknown>;
  const defaults = defaultSettings();
  for (const [field, fallback] of Object.entries(defaults)) {
    // Invalid scene-number values have a documented legacy fallback in zhsp.
    if (field === 'indent' || field === 'sceneNumber' || incoming[field] === undefined) continue;
    if (typeof incoming[field] !== typeof fallback || (typeof fallback === 'number' && !Number.isFinite(incoming[field]))) {
      add(field, typeof fallback === 'number' ? '请输入有限的数字。' : '设置值的格式不正确。');
    }
  }
  const layout = { ...defaults, ...incoming };
  const numeric = (field: string): number | null => typeof layout[field as keyof typeof layout] === 'number' && Number.isFinite(layout[field as keyof typeof layout])
    ? layout[field as keyof typeof layout] as number : null;
  const ranges: Array<[string, string, number, number]> = [
    ['fontSize', '字号', 1, 144], ['lineHeight', '行距', 0.5, 10],
    ['marginTop', '上边距', -5, 30], ['marginBottom', '下边距', -5, 30],
    ['marginLeft', '左边距', -5, 30], ['marginRight', '右边距', -5, 30],
  ];
  for (const [field, label, min, max] of ranges) {
    const n = numeric(field);
    if (n !== null && (n < min || n > max)) add(field, `${label}须在 ${min} 到 ${max} 之间，未应用此输入。`);
  }
  if (layout.paper !== 'A4' && layout.paper !== 'letter') add('paper', '请选择 A4 或 Letter 纸张。');
  if (!issues.length) {
    const { fontSize, lineHeight, marginTop, marginBottom, marginLeft, marginRight } = layout;
    const minimumHeight = Math.max(10, fontSize * lineHeight * 25.4 / 72);
    for (const name of new Set(['A4', layout.paper])) {
      const paper = PAPER_MM[name];
      if (paper.w - (marginLeft + marginRight) * 10 < 10) {
        for (const field of ['marginLeft', 'marginRight', 'paper']) add(field, `${name} 正文宽度须至少保留 1 cm，请减小左右边距。`);
      }
      if (paper.h - (marginTop + marginBottom) * 10 < minimumHeight) {
        for (const field of ['marginTop', 'marginBottom', 'fontSize', 'lineHeight', 'paper']) add(field, `${name} 正文高度须至少保留 1 cm 且容纳一行，请减小上下边距、字号或行距。`);
      }
    }
  }
  if (incoming.indent === undefined) return issues;
  if (!isRecord(incoming.indent)) { add('indent', '元素缩进必须是有效的字段记录。'); return issues; }
  for (const type of ELEMENT_ORDER) {
    const format = incoming.indent[type];
    if (format === undefined) continue;
    const prefix = `indent.${type}`;
    if (!isRecord(format)) { add(prefix, `${ELEMENT_META[type].label}缩进格式不正确。`); continue; }
    for (const [field, label] of [['left', '左缩进'], ['right', '右缩进'], ['spaceBefore', '前空行']] as const) {
      const n = format[field] === undefined ? DEFAULT_INDENT[type][field] : format[field];
      if (typeof n !== 'number' || !Number.isFinite(n)) add(`${prefix}.${field}`, '请输入有限的数字。');
      else if (Math.abs(n) > 10_000) add(`${prefix}.${field}`, `${label}须在 -10000 到 10000 之间，未应用此输入。`);
    }
    for (const field of ['bold', 'uppercase']) if (format[field] !== undefined && typeof format[field] !== 'boolean') add(`${prefix}.${field}`, '设置值的格式不正确。');
    if (format.align !== undefined && !['left', 'right', 'center'].includes(format.align as string)) add(`${prefix}.align`, '请选择左对齐、居中或右对齐。');
  }
  return issues;
}
