import type { ScriptProject } from './types';
import { isCharacterAnchorCurrent, parseCharacterWorkspace,
  type CharacterWorkspace, type CharacterProfile, type CharacterOverride, type CharacterAssignment } from './characterLines';

export const emptyCharacterWorkspace = (): CharacterWorkspace => ({ schema: 1, profiles: [], overrides: [], assignments: [], noteLinks: [] });

/** Only explicit author actions use whole-library validation. Typing uses the
 * conservative reference reconciler and never serializes this branch. */
export function withCharacterWorkspace(project: ScriptProject, workspace: CharacterWorkspace): ScriptProject {
  const next = parseCharacterWorkspace(workspace)!;
  if (project.characterWorkspace && JSON.stringify(project.characterWorkspace) === JSON.stringify(next)) return project;
  // Notes must not invalidate the read-only name/evidence index. Validation is
  // an explicit action cost; unchanged immutable branches stay shared.
  if (project.characterWorkspace) {
    for (const key of ['profiles', 'overrides', 'assignments', 'noteLinks'] as const) {
      if (JSON.stringify(next[key]) === JSON.stringify(project.characterWorkspace[key])) {
        (next[key] as unknown) = project.characterWorkspace[key];
      }
    }
  }
  return { ...project, characterWorkspace: next };
}

export function saveCharacterProfile(project: ScriptProject, input: CharacterProfile): ScriptProject {
  // Validate the input as plain data before reading any of its properties.
  const profile = parseCharacterWorkspace({ ...emptyCharacterWorkspace(), profiles: [input] })!.profiles[0];
  const workspace = project.characterWorkspace || emptyCharacterWorkspace();
  const previous = workspace.profiles.find(item => item.id === profile.id);
  if (previous && previous.canonicalName !== profile.canonicalName && !profile.aliases.includes(previous.canonicalName)) {
    profile.aliases = [...profile.aliases, previous.canonicalName];
  }
  return withCharacterWorkspace(project, { ...workspace, profiles: previous
    ? workspace.profiles.map(item => item.id === profile.id ? profile : item)
    : [...workspace.profiles, profile] });
}

export function removeCharacterProfile(project: ScriptProject, id: string): ScriptProject {
  const workspace = project.characterWorkspace;
  if (!workspace?.profiles.some(item => item.id === id)) return project;
  // The annotation body belongs to the project, not to this registration.
  // Removing a character must never delete its ordinary creative notes.
  return withCharacterWorkspace(project, { ...workspace,
    profiles: workspace.profiles.filter(item => item.id !== id),
    overrides: workspace.overrides.filter(item => item.characterId !== id),
    assignments: workspace.assignments.filter(item => item.characterId !== id),
    noteLinks: workspace.noteLinks.filter(item => item.characterId !== id).map(item => {
      if (item.relatedCharacterId !== id) return item;
      const { relatedCharacterId: _removed, ...link } = item;
      return link;
    }),
  });
}

export function saveCharacterOverride(project: ScriptProject, input: CharacterOverride): ScriptProject {
  const workspace = project.characterWorkspace || emptyCharacterWorkspace();
  const record = parseCharacterWorkspace({ ...workspace, overrides: [input] })!.overrides[0];
  if (record.anchorState !== 'current' || !isCharacterAnchorCurrent(project, record.anchor)) {
    throw new Error('人物证据已变化，请重新选择当前原文。');
  }
  const previous = workspace.overrides.find(item => item.id === record.id);
  if (previous && JSON.stringify(previous) === JSON.stringify(record)) return project;
  const anchorKey = JSON.stringify(record.anchor);
  return withCharacterWorkspace(project, { ...workspace, overrides: [
    ...workspace.overrides.filter(item => item.id !== record.id &&
      !(item.characterId === record.characterId && item.anchorState === 'current' && JSON.stringify(item.anchor) === anchorKey)), record,
  ] });
}

export function saveCharacterAssignment(project: ScriptProject, input: CharacterAssignment): ScriptProject {
  const workspace = project.characterWorkspace || emptyCharacterWorkspace();
  const record = parseCharacterWorkspace({ ...workspace, assignments: [input] })!.assignments[0];
  if (record.anchorState !== 'current' || !isCharacterAnchorCurrent(project, record.anchor) ||
      !['character', 'dialogue'].includes(record.anchor.sourceType)) {
    throw new Error('发言归属原文已变化，请重新选择人物段落或对白。');
  }
  const previous = workspace.assignments.find(item => item.id === record.id);
  if (previous && JSON.stringify(previous) === JSON.stringify(record)) return project;
  return withCharacterWorkspace(project, { ...workspace, assignments: [
    ...workspace.assignments.filter(item => item.id !== record.id &&
      !(item.anchorState === 'current' && item.anchor.elementId === record.anchor.elementId)), record,
  ] });
}

export function removeCharacterRecord(project: ScriptProject, kind: 'overrides' | 'assignments', id: string): ScriptProject {
  const workspace = project.characterWorkspace;
  if (!workspace?.[kind].some(item => item.id === id)) return project;
  return withCharacterWorkspace(project, { ...workspace, [kind]: workspace[kind].filter(item => item.id !== id) });
}
