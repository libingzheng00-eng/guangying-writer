import type { ElementType, ScriptElement, ScriptProject } from '../model/types';
import { filterBoardLinksToKeep } from '../model/selection';
import { uid } from './id';
import { escapeHtml } from './text';

export const WRITING_CLIPBOARD_MIME = 'application/x-guangying-script+json';
export const MAX_CLIPBOARD_PAYLOAD_LENGTH = 2_000_000;
export const MAX_CLIPBOARD_FRAGMENT_LENGTH = 200_000;
export const MAX_CLIPBOARD_FRAGMENTS = 5_000;

export interface ClipboardFragment {
  type: ElementType;
  html: string;
}

export interface ClipboardFocus {
  focusId: string;
  /** UTF-16 text offset; BR counts as one, just like the writing DOM helpers. */
  caret: number;
}

const elementTypes = new Set<ElementType>([
  'act', 'scene_heading', 'action', 'character', 'parenthetical',
  'dialogue', 'transition', 'shot', 'general', 'note',
]);
const inlineTags = new Set(['b', 'i', 'u', 'strong', 'em']);
const discardedTags = new Set(['script', 'style', 'img']);

/** An inert template never mounts clipboard nodes or their attributes into the UI.
 * Emit only freshly escaped text and a tiny formatting whitelist. Iterative
 * traversal also avoids stack overflow on deeply nested, untrusted markup.
 */
function cleanHtml(html: string): { html: string; length: number } {
  const template = document.createElement('template');
  template.innerHTML = html;
  const output: string[] = [];
  let length = 0;
  const stack: Array<Node | string> = [];
  const pushChildren = (node: Node) => {
    for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
  };
  pushChildren(template.content);
  while (stack.length) {
    const item = stack.pop()!;
    if (typeof item === 'string') {
      output.push(item);
      continue;
    }
    if (item.nodeType === 3) {
      const text = item.nodeValue || '';
      output.push(escapeHtml(text));
      length += text.length;
      continue;
    }
    if (item.nodeType !== 1) continue; // Comments and other non-text nodes vanish.
    const tag = item.nodeName.toLowerCase();
    if (discardedTags.has(tag)) continue;
    if (tag === 'br') {
      output.push('<br>');
      length += 1;
    } else if (inlineTags.has(tag)) {
      output.push(`<${tag}>`);
      stack.push(`</${tag}>`);
      pushChildren(item);
    } else {
      pushChildren(item); // Unknown wrappers cannot carry attributes or UI markup.
    }
  }
  return { html: output.join(''), length };
}

export function sanitizeClipboardHtml(html: string): string {
  return cleanHtml(html).html;
}

function validFragments(value: unknown): value is ClipboardFragment[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_CLIPBOARD_FRAGMENTS && value.every(fragment =>
    fragment !== null && typeof fragment === 'object' && !Array.isArray(fragment) &&
    typeof fragment.type === 'string' && elementTypes.has(fragment.type as ElementType) &&
    typeof fragment.html === 'string' && fragment.html.length <= MAX_CLIPBOARD_FRAGMENT_LENGTH,
  );
}

/** Copy only type + safe HTML. IDs, revision/dual flags and board data never leave. */
export function encodeWritingClipboard(fragments: readonly ClipboardFragment[]): string | null {
  try {
    if (!validFragments(fragments)) return null;
    if (fragments.reduce((sum, fragment) => sum + fragment.html.length, 0) > MAX_CLIPBOARD_PAYLOAD_LENGTH) return null;
    const safe = fragments.map(fragment => ({ type: fragment.type, html: sanitizeClipboardHtml(fragment.html) }));
    if (!validFragments(safe)) return null;
    const payload = JSON.stringify({
      version: 1,
      fragments: safe,
    });
    return payload.length <= MAX_CLIPBOARD_PAYLOAD_LENGTH ? payload : null;
  } catch {
    return null;
  }
}

/** Invalid/unbounded data returns null so the caller can keep its literal plain fallback. */
export function decodeWritingClipboard(payload: string): ClipboardFragment[] | null {
  try {
    if (typeof payload !== 'string' || !payload || payload.length > MAX_CLIPBOARD_PAYLOAD_LENGTH) return null;
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const data = value as { version?: unknown; fragments?: unknown };
    if (data.version !== 1 || !validFragments(data.fragments)) return null;
    const safe = data.fragments.map(fragment => ({ type: fragment.type, html: sanitizeClipboardHtml(fragment.html) }));
    return validFragments(safe) ? safe : null;
  } catch {
    return null;
  }
}

/** Mutate only an already-cloned project draft, inside ONE store transaction.
 * The first target ID survives; subsequent pasted paragraphs get fresh IDs.
 * A single fragment keeps the target type; a multi-fragment internal paste can
 * preserve source types. No source metadata is accepted or synthesized.
 */
export function replaceClipboardRange(
  project: ScriptProject,
  ids: readonly string[],
  before: string,
  after: string,
  fragments: readonly ClipboardFragment[],
): ClipboardFocus | null {
  if (!ids.length || new Set(ids).size !== ids.length || typeof before !== 'string' || typeof after !== 'string' || !validFragments(fragments)) return null;
  const start = project.elements.findIndex(element => element.id === ids[0]);
  if (start < 0 || ids.some((id, offset) => project.elements[start + offset]?.id !== id)) return null;
  // Complete all validation/HTML parsing before touching a draft or generating IDs.
  let cleaned: Array<{ type: ElementType; html: string; length: number }>;
  let prefixLength: number;
  try {
    if (fragments.reduce((sum, fragment) => sum + fragment.html.length, 0) > MAX_CLIPBOARD_PAYLOAD_LENGTH) return null;
    cleaned = fragments.map(fragment => ({ type: fragment.type, ...cleanHtml(fragment.html) }));
    if (!validFragments(cleaned)) return null;
    prefixLength = cleaned.length === 1 ? cleanHtml(before).length : 0;
  } catch {
    return null;
  }
  const current = project.elements[start];
  const type = cleaned.length === 1 ? current.type : cleaned[0].type;
  const first: ScriptElement = { ...current, type, text: before + cleaned[0].html + (cleaned.length === 1 ? after : '') };
  if (type !== current.type) {
    delete first.dual;
    delete first.dualGroup;
  }
  const inserted: ScriptElement[] = [first];
  for (let i = 1; i < cleaned.length; i++) {
    const fragment = cleaned[i];
    inserted.push({ id: uid('el'), type: fragment.type, text: fragment.html + (i === cleaned.length - 1 ? after : '') });
  }
  const removed = new Set(ids.slice(1));
  if (current.type === 'scene_heading' && type !== 'scene_heading') removed.add(current.id);
  const removedSceneIds = new Set(removed);
  for (const meta of project.sceneMeta) {
    if (removed.has(meta.elementId)) removedSceneIds.add(meta.id);
  }
  project.elements.splice(start, ids.length, ...inserted);
  if (removedSceneIds.size) {
    project.sceneMeta = project.sceneMeta.filter(meta => !removed.has(meta.elementId));
    for (const beat of project.beats) {
      if (beat.sceneId && removedSceneIds.has(beat.sceneId)) delete beat.sceneId;
    }
    if (project.boardLinks) project.boardLinks = filterBoardLinksToKeep(project.boardLinks, removedSceneIds);
  }
  const last = inserted[inserted.length - 1];
  return { focusId: last.id, caret: prefixLength + cleaned[cleaned.length - 1].length };
}
