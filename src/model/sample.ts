import type { ScriptProject } from './types';
import { createProject, emptyTitlePage, newElement } from './project';

/**
 * First-run starter project.
 * Keep this intentionally blank: public builds must never contain a user's screenplay.
 */
export function sampleProject(): ScriptProject {
  const project = createProject('未命名剧本');
  project.titlePage = { ...emptyTitlePage(), title: '' };
  project.elements = [newElement('scene_heading', ''), newElement('action', '')];
  project.sceneMeta = [];
  project.beats = [];
  project.boardLinks = [];
  return project;
}
