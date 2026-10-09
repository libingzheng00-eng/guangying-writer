import type { ScriptProject, ScriptElement } from './types';
import { deriveScenes } from './project';
import { plain } from '../utils/text';

export type DeliveryIssueKind = 'empty-scene' | 'character-name' | 'pending-annotation';
export interface DeliveryIssue {
  kind: DeliveryIssueKind;
  /** Content-sensitive, order-independent identity. Never a scene number or array index. */
  signature: string;
  title: string;
  detail: string;
  elementIds: string[];
  sceneElementId?: string;
  annotationId?: string;
}

export const MAX_DELIVERY_IGNORED = 1000;
export function normalizeDeliveryIgnored(value: unknown): string[] {
  if (value === undefined) return [];
  const invalid = () => new Error('交稿检查忽略记录格式不正确');
  if (!Array.isArray(value)) throw invalid();
  if (value.length > MAX_DELIVERY_IGNORED) throw new Error('交稿检查忽略记录最多保留1000项，请先恢复部分提醒。');
  const signatures: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string' ||
        !/^delivery:1:(empty-scene|character-name|pending-annotation):[0-9a-f]{16}$/.test(descriptor.value)) throw invalid();
    signatures.push(descriptor.value);
  }
  return [...new Set(signatures)];
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Compact non-security hash: no user prose is stored in the ignore list. */
function signature(kind: DeliveryIssueKind, evidence: unknown): string {
  const text = stable(evidence);
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
  }
  return `delivery:1:${kind}:${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

const textOf = (element: ScriptElement) => plain(element.text).trim();
const namedExtension = /\s*[（(]\s*(?:V\.?\s*O\.?|O\.?\s*S\.?|O\.?\s*C\.?|CONT['’]?D|续|画外音|旁白|电话)\s*[）)]\s*$/i;
function characterBase(text: string): string {
  let name = text.replace(/[:：]\s*$/, '').trim();
  while (namedExtension.test(name)) name = name.replace(namedExtension, '').trim();
  return name;
}
function equivalentName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('en-US');
}
function possibleTypo(a: string, b: string, countA: number, countB: number): boolean {
  // Short Chinese names, role numbering and family/prefix variants are too ambiguous.
  if (!/^[\u3400-\u9fff]{3,8}$/.test(a) || !/^[\u3400-\u9fff]{3,8}$/.test(b) ||
      a.length !== b.length || a[0] !== b[0] || /[甲乙丙丁戊己庚辛壬癸一二三四五六七八九十]/.test(a + b) ||
      /妈妈|爸爸|母亲|父亲|哥哥|姐姐|弟弟|妹妹|警察|服务员|路人|保安|医生/.test(a + b)) return false;
  if (Math.max(countA, countB) < 3 || Math.min(countA, countB) !== 1) return false;
  return [...a].filter((letter, index) => letter !== b[index]).length === 1;
}

/** Read-only checks, computed only when requested. This never corrects or renames prose. */
export function buildDeliveryChecks(project: ScriptProject): DeliveryIssue[] {
  const issues: DeliveryIssue[] = [];
  const excluded = new Set<string>();
  const scenes = deriveScenes(project);
  for (const scene of scenes) if (scene.omit) {
    for (const element of project.elements.slice(scene.start, scene.end)) excluded.add(element.id);
  }
  const eligible = (element: ScriptElement) => !element.omit && element.type !== 'note' && !excluded.has(element.id);
  for (const scene of scenes) {
    if (scene.omit) continue;
    const body = project.elements.slice(scene.start, scene.end).filter(eligible);
    if (body.some(element => element.type !== 'scene_heading' && element.type !== 'act' && textOf(element))) continue;
    issues.push({
      kind: 'empty-scene',
      signature: signature('empty-scene', [scene.elementId, body.map(element => [element.id, element.type, textOf(element)])]),
      title: `第 ${scene.number || scene.index + 1} 场没有正文`,
      detail: scene.heading || '该场只有标题、空段或备忘；请核对是否有意留空。',
      elementIds: [scene.elementId], sceneElementId: scene.elementId,
    });
  }

  const names = new Map<string, ScriptElement[]>();
  for (const element of project.elements) {
    if (!eligible(element) || element.type !== 'character') continue;
    const name = characterBase(textOf(element));
    if (!name) continue;
    const found = names.get(name) || [];
    found.push(element); names.set(name, found);
  }
  const entries = [...names].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  // Candidate buckets avoid comparing every character name with every other
  // name in a long screenplay. Only equivalent forms or one-slot CJK variants
  // can reach the conservative rule below.
  const buckets = new Map<string, number[]>();
  const pairs = new Set<string>();
  entries.forEach(([name], index) => {
    const keys = [`form:${equivalentName(name)}`];
    if (/^[\u3400-\u9fff]{3,8}$/.test(name)) {
      for (let slot = 1; slot < name.length; slot++) keys.push(`typo:${name.slice(0, slot)}*${name.slice(slot + 1)}`);
    }
    for (const key of keys) {
      const previous = buckets.get(key) || [];
      for (const earlier of previous) pairs.add(`${earlier}:${index}`);
      previous.push(index); buckets.set(key, previous);
    }
  });
  for (const pair of pairs) {
    const [i, j] = pair.split(':').map(Number);
    const [a, elementsA] = entries[i], [b, elementsB] = entries[j];
    const sameWriting = equivalentName(a) === equivalentName(b);
    if (!sameWriting && !possibleTypo(a, b, elementsA.length, elementsB.length)) continue;
    const evidence = [...elementsA, ...elementsB].map(element => [element.id, textOf(element)]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    issues.push({
      kind: 'character-name', signature: signature('character-name', [a, b, evidence]),
      title: `人物名疑似不一致：${a} / ${b}`,
      detail: sameWriting ? '两种写法仅有空格、全半角或大小写差异，请确认是否为同一人物。' : '一个低频名字与高频名字仅差一字；也可能是不同人物，请自行核对。',
      elementIds: [...elementsA, ...elementsB].map(element => element.id),
    });
  }

  const activeIds = new Set(project.elements.map(element => element.id));
  for (const annotation of project.annotations || []) {
    if (annotation.status !== 'pending') continue;
    const elementIds = annotation.anchorState !== 'missing' && activeIds.has(annotation.anchor.elementId) ? [annotation.anchor.elementId] : [];
    issues.push({
      kind: 'pending-annotation',
      signature: signature('pending-annotation', [annotation.id, annotation.body, annotation.reason, annotation.decision, annotation.status, annotation.updatedAt, annotation.anchor, annotation.anchorState]),
      title: '有未处理批注', detail: annotation.body || '请处理或明确暂不采用该批注。',
      elementIds, annotationId: annotation.id,
    });
  }
  return issues;
}

export function activeDeliveryChecks(project: ScriptProject): DeliveryIssue[] {
  const ignored = new Set(normalizeDeliveryIgnored(project.deliveryIgnored));
  return buildDeliveryChecks(project).filter(issue => !ignored.has(issue.signature));
}
