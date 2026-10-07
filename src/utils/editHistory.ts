import { useStore } from '../store/store';
import { caretOffset } from './dom';
import { searchText } from '../model/search';
import type { ScriptProject } from '../model/types';

export type HistoryDirection = 'undo' | 'redo';
// Snapshot-keyed UI bookmarks are ephemeral and garbage-collect with history.
// In particular, redo of an Enter must return to its restored new paragraph.
const writingBookmarks = new WeakMap<ScriptProject, { id: string; caret: number }>();

/** Only uncommitted UI drafts own native history. Model-backed inputs do not. */
export function ownsNativeHistory(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('[data-native-edit-history], .find-panel');
}

/** Keyboard, toolbar, menu IPC and beforeinput must share this one routing rule.
 * Never execCommand('undo') on script contentEditable: its DOM history is not the
 * project's transaction history. Restore focus only if writing owned it before.
 */
export function runEditHistory(direction: HistoryDirection): void {
  const active = document.activeElement;
  if (ownsNativeHistory(active)) {
    document.execCommand(direction);
    return;
  }
  const state = useStore.getState();
  const before = state.project;
  const writing = active instanceof HTMLElement && active.matches('.script-flow .sc-el--editable[contenteditable="true"]') ? active : null;
  const id = writing?.dataset.id;
  const oldOffset = writing ? Math.max(0, caretOffset(writing)) : 0;
  if (id) writingBookmarks.set(before, { id, caret: oldOffset });
  state[direction]();
  const after = useStore.getState();
  if (!writing || !id || after.project === before) return;
  const bookmark = writingBookmarks.get(after.project);
  if (bookmark && after.project.elements.some(el => el.id === bookmark.id)) {
    after.requestFocus(bookmark.id, bookmark.caret);
    return;
  }
  const existing = after.project.elements.find(el => el.id === id);
  if (existing) {
    const previous = before.elements.find(el => el.id === id);
    const oldText = previous ? searchText(previous.text) : '';
    const newText = searchText(existing.text);
    let offset = Math.min(oldOffset, newText.length);
    if (oldText !== newText) {
      let prefix = 0, suffix = 0;
      while (prefix < oldText.length && prefix < newText.length && oldText[prefix] === newText[prefix]) prefix++;
      while (suffix < oldText.length - prefix && suffix < newText.length - prefix &&
        oldText[oldText.length - suffix - 1] === newText[newText.length - suffix - 1]) suffix++;
      offset = newText.length - suffix;
    }
    after.requestFocus(existing.id, offset);
    return;
  }
  // Undoing an Enter/paste can remove the focused new paragraph. Find its closest
  // surviving predecessor by stable ID instead of leaving the caret on <body>.
  const index = before.elements.findIndex(el => el.id === id);
  const surviving = new Set(after.project.elements.map(el => el.id));
  const previous = before.elements.slice(0, Math.max(0, index)).reverse().find(el => surviving.has(el.id));
  const next = before.elements.slice(index + 1).find(el => surviving.has(el.id));
  const target = previous || next || after.project.elements[0];
  if (target) {
    const restored = after.project.elements.find(el => el.id === target.id)!;
    // Undoing a split rejoins the tail: stay at its former seam, not the end of
    // the restored long paragraph. An unchanged predecessor still uses its end.
    const offset = previous ? Math.min(searchText(previous.text).length, searchText(restored.text).length) : 0;
    after.requestFocus(target.id, offset);
  }
}
