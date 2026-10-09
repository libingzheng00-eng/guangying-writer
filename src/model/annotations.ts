import type { ScriptElement } from './types';
import { searchText } from './search';

export type AnnotationStatus = 'pending' | 'resolved' | 'declined';
export type AnnotationAnchorState = 'current' | 'changed' | 'missing';
export type AnnotationAnchor =
  | { kind: 'scene'; elementId: string }
  | { kind: 'text'; elementId: string; start: number; end: number; quote: string; sourceText: string };

export interface Annotation {
  id: string;
  createdAt: number;
  updatedAt: number;
  body: string;
  status: AnnotationStatus;
  reason?: string;
  decision?: string;
  anchor: AnnotationAnchor;
  anchorState: AnnotationAnchorState;
}

export const MAX_ANNOTATIONS = 500;
export const MAX_ANNOTATIONS_BYTES = 1024 * 1024;
// Match the existing .zhsp identifier ceiling, including valid legacy element IDs.
const MAX_ID_LENGTH = 512;
const MAX_NOTE_LENGTH = 20_000;
const MAX_SOURCE_LENGTH = 200_000;
const INVALID_ANNOTATIONS = '批注数据无效或超过容量限制。';
const projectedText = new WeakMap<ScriptElement, { html: string; text: string }>();

function elementText(element: ScriptElement): string {
  const cached = projectedText.get(element);
  if (cached?.html === element.text) return cached.text;
  const text = searchText(element.text);
  projectedText.set(element, { html: element.text, text });
  return text;
}

function invalid(): never { throw new Error(INVALID_ANNOTATIONS); }

/** Admit plain data only: never invoke accessors, toJSON or inherited fields. */
function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) return invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function string(value: unknown, limit: number, nonempty = false): string {
  if (typeof value !== 'string' || value.length > limit || (nonempty && !value.trim())) return invalid();
  return value;
}

function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}

function isTextBoundary(text: string, offset: number): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) return false;
  // DOM offsets use UTF-16, but a saved range must not bisect an emoji pair.
  return !(offset > 0 && offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]));
}

function readAnchor(value: unknown): AnnotationAnchor {
  const data = record(value, ['kind', 'elementId', 'start', 'end', 'quote', 'sourceText']);
  const elementId = string(data.elementId, MAX_ID_LENGTH, true);
  if (data.kind === 'scene') {
    if (Object.keys(data).some(key => key !== 'kind' && key !== 'elementId')) return invalid();
    return { kind: 'scene', elementId };
  }
  if (data.kind !== 'text') return invalid();
  const sourceText = string(data.sourceText, MAX_SOURCE_LENGTH);
  const quote = string(data.quote, MAX_SOURCE_LENGTH);
  const { start, end } = data;
  if (typeof start !== 'number' || typeof end !== 'number' ||
      !isTextBoundary(sourceText, start) || !isTextBoundary(sourceText, end) || start >= end ||
      sourceText.slice(start, end) !== quote) return invalid();
  return { kind: 'text', elementId, start, end, quote, sourceText };
}

export function validateAnnotationAnchor(value: unknown): AnnotationAnchor {
  try { return readAnchor(value); } catch { return invalid(); }
}

/** Missing legacy data is empty. Invalid data is rejected, never partly saved. */
export function validateAnnotations(value: unknown): Annotation[] {
  if (value === undefined) return [];
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_ANNOTATIONS) return invalid();
    if (Reflect.ownKeys(value).length !== value.length + 1) return invalid();
    const result: Annotation[] = [];
    const ids = new Set<string>();
    const encoder = new TextEncoder();
    let bytes = 2; // JSON array brackets; measure escaped strings in UTF-8.
    for (let index = 0; index < value.length; index++) {
      const slot = Object.getOwnPropertyDescriptor(value, String(index));
      if (!slot || !('value' in slot)) return invalid();
      const data = record(slot.value, ['id', 'createdAt', 'updatedAt', 'body', 'status', 'reason', 'decision', 'anchor', 'anchorState']);
      const id = string(data.id, MAX_ID_LENGTH, true);
      if (ids.has(id)) return invalid();
      ids.add(id);
      const createdAt = timestamp(data.createdAt), updatedAt = timestamp(data.updatedAt);
      if (updatedAt < createdAt) return invalid();
      const body = string(data.body, MAX_NOTE_LENGTH, true);
      const status = data.status;
      const anchorState = data.anchorState;
      if (status !== 'pending' && status !== 'resolved' && status !== 'declined') return invalid();
      if (anchorState !== 'current' && anchorState !== 'changed' && anchorState !== 'missing') return invalid();
      const reason = data.reason === undefined ? undefined : string(data.reason, MAX_NOTE_LENGTH);
      const decision = data.decision === undefined ? undefined : string(data.decision, MAX_NOTE_LENGTH);
      if (status === 'declined' && !reason?.trim()) return invalid();
      const annotation: Annotation = { id, createdAt, updatedAt, body, status, anchor: readAnchor(data.anchor), anchorState };
      if (reason !== undefined) annotation.reason = reason;
      if (decision !== undefined) annotation.decision = decision;
      bytes += encoder.encode(JSON.stringify(annotation)).byteLength + (index ? 1 : 0);
      if (bytes > MAX_ANNOTATIONS_BYTES) return invalid();
      result.push(annotation);
    }
    return result;
  } catch { return invalid(); }
}

/** Conservative anchors never search for equal text or infer edit positions.
 * The caller commits the returned array together with the element transaction;
 * undo restores that whole snapshot rather than trying to revive old anchors.
 */
export function reconcileAnnotations(
  beforeElements: readonly ScriptElement[],
  afterElements: readonly ScriptElement[],
  annotations: Annotation[],
): Annotation[] {
  if (!annotations.length) return annotations;
  const before = new Map(beforeElements.map(element => [element.id, element]));
  const after = new Map(afterElements.map(element => [element.id, element]));
  let changed = false;
  const result = annotations.map(annotation => {
    if (annotation.anchorState === 'missing') return annotation;
    const anchor = annotation.anchor;
    const target = after.get(anchor.elementId);
    let anchorState: AnnotationAnchorState = annotation.anchorState;
    if (!target || (anchor.kind === 'scene' && target.type !== 'scene_heading')) anchorState = 'missing';
    else if (anchor.kind === 'text' && anchorState === 'current') {
      const previous = before.get(anchor.elementId);
      const nextText = elementText(target);
      if (nextText !== anchor.sourceText || (previous && elementText(previous) !== nextText)) anchorState = 'changed';
    }
    if (anchorState === annotation.anchorState) return annotation;
    changed = true;
    return { ...annotation, anchorState };
  });
  return changed ? result : annotations;
}

/** Capture only an explicit nonempty selection in one existing paragraph. */
export function captureTextAnchor(element: ScriptElement, start: number, end: number): AnnotationAnchor | null {
  try {
    const sourceText = elementText(element);
    return readAnchor({ kind: 'text', elementId: element.id, start, end, quote: sourceText.slice(start, end), sourceText });
  } catch { return null; }
}

export function captureSceneAnchor(element: ScriptElement): AnnotationAnchor | null {
  if (element.type !== 'scene_heading') return null;
  try { return readAnchor({ kind: 'scene', elementId: element.id }); } catch { return null; }
}

/** An explicit user reattachment is the only way to make a stale anchor current. */
export function reanchorAnnotation(annotation: Annotation, anchor: AnnotationAnchor, now: number): Annotation {
  const updatedAt = timestamp(now);
  if (updatedAt < annotation.createdAt) return invalid();
  return { ...annotation, anchor: validateAnnotationAnchor(anchor), anchorState: 'current', updatedAt };
}
