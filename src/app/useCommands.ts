import { useCallback, useRef } from 'react';
import { useStore } from '../store/store';
import { bridge } from '../io/native';
import { parseProject, serializeProject } from '../io/zhsp';
import { fromFdx, toFdx } from '../io/fdx';
import { fromPlainText, toHtml, toMarkdown, toPlainText } from '../io/textscript';
import { createProject, newElement, sceneHeadings } from '../model/project';
import { PAPER_MM } from '../model/stats';
import type { ElementType } from '../model/types';
import { buildCreativePdf } from '../io/creativePdf';

/** 等待图片解码完成，避免 printToPDF 在图片卡尚未绘制时抢先输出。 */
async function waitForPrintableAssets() {
  const images = Array.from(document.images);
  await Promise.all(images.map(async (image) => {
    if (!image.complete) {
      await new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => resolve(), { once: true });
      });
    }
    try { await image.decode(); } catch { /* 损坏图片仍保留原位卡片的标题和备注 */ }
  }));
}

export function useCommands() {
  const store = useStore;
  const saving = useRef(false);
  const isSaving = useCallback(() => saving.current, []);
  const openingRequest = useRef(0);

  const save = useCallback(
    async (asNew = false) => {
      const { project, documentEpoch, filePath, markSaved, notify } = store.getState();
      if (saving.current) {
        notify('保存正在进行，请等待完成');
        return false;
      }
      saving.current = true;
      try {
        const content = serializeProject(project);
        const name = `${project.name}.zhsp`;
        const target = asNew
          ? await bridge.saveProjectAs({ content, name: project.name, ext: 'zhsp' })
          : await bridge.saveProject({ content, path: filePath, name });
        if (target) {
          const belongsToCurrent = markSaved(target, { project, documentEpoch });
          const message = !belongsToCurrent ? `已保存先前剧本：${target}`
            : store.getState().dirty ? `已保存先前版本：${target}；当前修改尚未保存`
            : `已保存：${target}`;
          notify(message, 'ok');
        }
        return target;
      } catch (err) {
        notify(`保存失败：${(err as Error).message}`, 'error');
        return null;
      } finally {
        saving.current = false;
      }
    },
    [store],
  );

  const open = useCallback(async () => {
    const { loadProject, notify } = store.getState();
    const epochAtOpen = store.getState().documentEpoch;
    const request = ++openingRequest.current;
    try {
      const res = await bridge.openProject();
      if (!res) return;
      if (request !== openingRequest.current) return;
      if (store.getState().documentEpoch !== epochAtOpen) {
        notify('打开期间已切换剧本，请重新选择要打开的文件。', 'error');
        return;
      }
      // Ask at replacement time, including edits made while the dialog waited.
      // Loading starts a fresh history: cancelled discard must retain both stacks.
      if (store.getState().dirty && !window.confirm('当前剧本尚未保存，打开其他剧本将丢弃这些修改。确定继续吗？')) return;
      if (res.path.toLowerCase().endsWith('.fdx')) {
        const { elements, title } = fromFdx(res.content);
        const p = createProject(res.path.split(/[\\/]/).pop()?.replace(/\.fdx$/i, '') || '导入的剧本');
        p.elements = elements.length ? elements : [newElement('action', '')];
        if (title) Object.assign(p.titlePage, title);
        loadProject(p, null);
      } else if (/\.(txt|md)$/i.test(res.path)) {
        const elements = fromPlainText(res.content);
        const p = createProject(res.path.split(/[\\/]/).pop()?.replace(/\.(txt|md)$/i, '') || '导入的剧本');
        p.elements = elements;
        loadProject(p, null);
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

  const exportPdf = useCallback(async (mode: 'creative' | 'print' = 'creative') => {
    const { project, setView, notify, view, pdfExportMode, setPdfExportMode } = store.getState();
    if (pdfExportMode) return;
    const scrollTop = document.querySelector('.editor')?.scrollTop || 0;
    setPdfExportMode(mode);
    setView(mode === 'creative' ? 'write' : 'preview');
    try {
      const selector = mode === 'creative' ? '.editor__scroll[data-ready="true"]' : '.preview[data-ready="true"]';
      let ready: HTMLElement | null = null;
      for (let i = 0; i < 160; i++) {
        ready = document.querySelector<HTMLElement>(selector);
        if (ready) break;
        await new Promise(r => setTimeout(r, 50));
      }
      if (!ready) throw new Error('排版尚未就绪，请稍后重试。');
      await document.fonts?.ready;
      await waitForPrintableAssets();
      if (store.getState().project.id !== project.id) throw new Error('工程已切换，请重新导出。');
      const opts = mode === 'creative' ? buildCreativePdf(ready) : {
        mode: 'print' as const,
        pageSize: { width: PAPER_MM.A4.w * 1000, height: PAPER_MM.A4.h * 1000 },
      };
      const file = await bridge.exportPdf({ ...opts, name: `${project.name}-${mode === 'creative' ? '创作版' : 'A4纯文本'}.pdf` });
      if (file) {
        notify(`已导出 PDF：${file}`, 'ok');
        bridge.showInFolder(file);
      }
    } catch (err) {
      notify(`导出失败：${(err as Error).message}`, 'error');
    } finally {
      setPdfExportMode(null);
      // 取消/完成均回到原视图与滚动位置，导出不会改工程或撤销栈。
      setView(view);
      if (view === 'write') requestAnimationFrame(() => {
        const editor = document.querySelector('.editor');
        if (editor) editor.scrollTop = scrollTop;
      });
    }
  }, [store]);

  const exportAs = useCallback(
    async (kind: 'fdx' | 'txt' | 'md' | 'html') => {
      const { project, notify } = store.getState();
      const map = {
        fdx: toFdx,
        txt: toPlainText,
        md: toMarkdown,
        html: toHtml,
      } as const;
      const content = map[kind](project);
      const file = await bridge.saveProjectAs({ content, name: project.name, ext: kind });
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
    if (store.getState().pdfExportMode) return;
    store.getState().setView('write');
    window.dispatchEvent(new Event('guangying:find'));
  }, [store]);

  return { save, isSaving, open, importAny, exportPdf, exportAs, newFile, setElementType, insertScene, makeDual, openFind, sceneHeadings };
}
