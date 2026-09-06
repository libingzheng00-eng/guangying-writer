import { useCallback } from 'react';
import { useStore } from '../store/store';
import { bridge } from '../io/native';
import { parseProject, serializeProject } from '../io/zhsp';
import { fromFdx, toFdx } from '../io/fdx';
import { fromPlainText, toHtml, toMarkdown, toPlainText } from '../io/textscript';
import { createProject, newElement, sceneHeadings } from '../model/project';
import { PAPER_MM } from '../model/stats';
import type { ElementType } from '../model/types';

export function useCommands() {
  const store = useStore;

  const save = useCallback(
    async (asNew = false) => {
      const { project, filePath, markSaved, notify } = store.getState();
      const content = serializeProject(project);
      const name = `${project.name}.zhsp`;
      try {
        const target = asNew
          ? await bridge.saveProjectAs({ content, name: project.name, ext: 'zhsp' })
          : await bridge.saveProject({ content, path: filePath, name });
        if (target) {
          markSaved(target);
          notify(`已保存：${target}`, 'ok');
        }
        return target;
      } catch (err) {
        notify(`保存失败：${(err as Error).message}`, 'error');
        return null;
      }
    },
    [store],
  );

  const open = useCallback(async () => {
    const { loadProject, notify } = store.getState();
    const res = await bridge.openProject();
    if (!res) return;
    try {
      if (res.path.toLowerCase().endsWith('.fdx')) {
        const { elements, title } = fromFdx(res.content);
        const p = createProject(res.path.split(/[\\/]/).pop()?.replace('.fdx', '') || '导入的剧本');
        p.elements = elements.length ? elements : [newElement('action', '')];
        if (title) Object.assign(p.titlePage, title);
        loadProject(p, res.path);
      } else if (/\.(txt|md)$/i.test(res.path)) {
        const elements = fromPlainText(res.content);
        const p = createProject(res.path.split(/[\\/]/).pop()?.replace(/\.(txt|md)$/, '') || '导入的剧本');
        p.elements = elements;
        loadProject(p, res.path);
      } else {
        loadProject(parseProject(res.content), res.path);
      }
      notify('已打开剧本', 'ok');
    } catch (err) {
      notify(`打开失败：${(err as Error).message}`, 'error');
    }
  }, [store]);

  const importAny = useCallback(async () => {
    const { project, loadProject, notify, mutate } = store.getState();
    const res = await bridge.openProject();
    if (!res) return;
    const isFdx = res.path.toLowerCase().endsWith('.fdx');
    try {
      const elements = isFdx ? fromFdx(res.content).elements : fromPlainText(res.content);
      if (!elements.length) {
        notify('没有识别到内容', 'error');
        return;
      }
      const append = window.confirm(`识别到 ${elements.length} 个元素。\n\n「确定」= 追加到当前剧本末尾\n「取消」= 替换整个剧本`);
      if (append) {
        mutate((p) => {
          p.elements.push(...elements);
        });
      } else {
        const p = createProject(project.name);
        p.elements = elements;
        loadProject(p, null);
      }
      notify('导入完成', 'ok');
    } catch (err) {
      notify(`导入失败：${(err as Error).message}`, 'error');
    }
  }, [store]);

  const exportPdf = useCallback(async () => {
    const { project, setView, notify } = store.getState();
    setView('preview');
    await new Promise((r) => setTimeout(r, 900));
    const paper = PAPER_MM[project.settings.paper] || PAPER_MM.A4;
    try {
      const file = await bridge.exportPdf({
        pageSize: { width: Math.round(paper.w * 1000), height: Math.round(paper.h * 1000) },
      });
      if (file) {
        notify(`已导出 PDF：${file}`, 'ok');
        bridge.showInFolder(file);
      }
    } catch (err) {
      notify(`导出失败：${(err as Error).message}`, 'error');
    }
  }, [store]);

  const exportAs = useCallback(
    async (kind: 'fdx' | 'txt' | 'md' | 'html') => {
      const { project, notify } = store.getState();
      const map = {
        fdx: { content: toFdx(project), ext: 'fdx' },
        txt: { content: toPlainText(project), ext: 'txt' },
        md: { content: toMarkdown(project), ext: 'md' },
        html: { content: toHtml(project), ext: 'html' },
      } as const;
      const { content, ext } = map[kind];
      const file = await bridge.saveProjectAs({ content, name: project.name, ext });
      if (file) notify(`已导出：${file}`, 'ok');
    },
    [store],
  );

  const newFile = useCallback(() => {
    const { dirty, notify } = store.getState();
    if (dirty && !window.confirm('当前剧本尚未保存，确定新建吗？')) return;
    store.getState().newProject();
    notify('已新建剧本');
  }, [store]);

  const setElementType = useCallback(
    (type: ElementType) => {
      const { activeId, setType, requestFocus, project } = store.getState();
      if (!activeId) return;
      setType(activeId, type);
      const el = project.elements.find((e) => e.id === activeId);
      if (el) requestFocus(activeId, 'end');
    },
    [store],
  );

  const insertScene = useCallback(() => {
    const { activeId, project, insertAfter, requestFocus } = store.getState();
    if (!activeId) return;
    const idx = project.elements.findIndex((e) => e.id === activeId);
    if (idx < 0) return;
    let end = idx + 1;
    while (end < project.elements.length && project.elements[end].type !== 'scene_heading') end += 1;
    const before = project.elements[end - 1];
    const id = insertAfter(before.id, 'scene_heading');
    insertAfter(id, 'action');
    requestFocus(id, 'end');
  }, [store]);

  const makeDual = useCallback(() => {
    const { activeId, project, mutate, requestFocus } = store.getState();
    if (!activeId) return;
    const idx = project.elements.findIndex((e) => e.id === activeId);
    if (idx < 0) return;
    // 找到当前所在的对白组（人物 → 提示 → 对白）
    let start = idx;
    while (start > 0 && ['character', 'parenthetical', 'dialogue'].includes(project.elements[start - 1].type)) start -= 1;
    let end = idx;
    while (end + 1 < project.elements.length && ['parenthetical', 'dialogue'].includes(project.elements[end + 1].type)) end += 1;
    const group = `dg-${Date.now().toString(36)}`;
    const rightIds: string[] = [];
    mutate((p) => {
      for (let i = start; i <= end; i += 1) {
        p.elements[i].dual = 'left';
        p.elements[i].dualGroup = group;
      }
      const insertAt = end + 1;
      const c = newElement('character', '');
      const d = newElement('dialogue', '');
      c.dual = 'right';
      c.dualGroup = group;
      d.dual = 'right';
      d.dualGroup = group;
      p.elements.splice(insertAt, 0, c, d);
      rightIds.push(c.id);
    });
    if (rightIds[0]) requestFocus(rightIds[0], 'end');
  }, [store]);

  const openFind = useCallback(() => {
    const term = window.prompt('查找内容');
    if (!term) return;
    const { project, requestFocus, notify } = store.getState();
    const idx = project.elements.findIndex((e) => e.text.replace(/<[^>]+>/g, '').includes(term));
    if (idx < 0) {
      notify('没有找到', 'info');
      return;
    }
    requestFocus(project.elements[idx].id, 'end');
    store.getState().setView('write');
  }, [store]);

  return { save, open, importAny, exportPdf, exportAs, newFile, setElementType, insertScene, makeDual, openFind, sceneHeadings };
}
