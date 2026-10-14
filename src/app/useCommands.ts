import { useCallback, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { bridge } from '../io/native';
import { parseProject, projectFileNotice, serializeProject } from '../io/zhsp';
import { fromFdx, toFdx } from '../io/fdx';
import { fromPlainText, toHtml, toMarkdown, toPlainText } from '../io/textscript';
import { createProject, newElement, sceneHeadings } from '../model/project';
import type { ElementType } from '../model/types';
import { buildCreativePdf } from '../io/creativePdf';
import { buildPrintPdf } from '../io/printPdf';
import { loadStoredWritingContext } from './writingContext';
import { askChoice } from './choiceDialog';

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

export function useCommands(options: { onActivate?: () => void; beforeReplace?: () => void } = {}) {
  const store = useStore;
  const activate = useRef(options.onActivate);
  activate.current = options.onActivate;
  const beforeReplace = useRef(options.beforeReplace);
  beforeReplace.current = options.beforeReplace;
  const saving = useRef(false);
  const isSaving = useCallback(() => saving.current, []);
  const openingRequest = useRef(0);
  const opening = useRef(false);
  const pdfRequest = useRef(0);
  const [isOpening, setIsOpening] = useState(false);

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

  const openFile = useCallback(async (source: 'dialog' | 'recent' | 'relocate', id?: string, options?: { allowPrompt?: boolean }) => {
    const { loadProject, notify } = store.getState();
    if (opening.current) return false;
    opening.current = true;
    setIsOpening(true);
    const epochAtOpen = store.getState().documentEpoch;
    const request = ++openingRequest.current;
    try {
      const res = await (source === 'dialog' ? bridge.openProject()
        : source === 'recent' ? bridge.openRecent(id!, options) : bridge.relocateRecent(id!));
      if (!res) return false;
      if (request !== openingRequest.current) return false;
      if (store.getState().documentEpoch !== epochAtOpen) {
        notify('打开期间已切换剧本，请重新选择要打开的文件。', 'error');
        return false;
      }
      // Parse before asking to discard anything. Invalid files cannot replace a
      // document, recovery draft or the last successfully opened recent entry.
      let project;
      let filePath: string | null = null;
      if (res.path.toLowerCase().endsWith('.fdx')) {
        const { elements, title, sceneMeta } = fromFdx(res.content);
        const p = createProject(res.path.split(/[\\/]/).pop()?.replace(/\.fdx$/i, '') || '导入的剧本');
        p.elements = elements.length ? elements : [newElement('action', '')];
        p.sceneMeta = sceneMeta;
        if (title && Object.values(title).some(Boolean)) Object.assign(p.titlePage, title, { show: true });
        project = p;
      } else if (/\.(txt|md)$/i.test(res.path)) {
        const elements = fromPlainText(res.content);
        const p = createProject(res.path.split(/[\\/]/).pop()?.replace(/\.(txt|md)$/i, '') || '导入的剧本');
        p.elements = elements;
        project = p;
      } else {
        project = parseProject(res.content);
        filePath = res.path;
        const notice = projectFileNotice(res.content, project);
        if (notice.newerFormat || notice.preservedFields.length) {
          const choice = await askChoice({
            title: '这个工程来自更新的版本',
            message: '它由较新版本的光影写手保存，含有本版不认识的内容。\n可以照常打开和编辑；这些内容会原样保留，保存时一并写回，但在本版中看不到、也不会导出。',
            warning: '建议先保留一份原文件副本，或改用新版编辑。',
            options: [{ value: 'open', label: '打开并保留新版内容', tone: 'primary' }, { value: 'cancel', label: '不打开' }],
            cancelValue: 'cancel',
          });
          if (choice !== 'open' || store.getState().documentEpoch !== epochAtOpen) return false;
        }
      }
      const hasDraft = !!document.querySelector('[data-project-draft-pending="true"]');
      if ((store.getState().dirty || hasDraft) && !window.confirm('当前剧本有未保存的修改或未确认的文字，打开其他剧本将放弃这些内容。确定继续吗？')) return false;
      beforeReplace.current?.();
      const relocatedContext = filePath && res.previousPath
        ? loadStoredWritingContext(project.id, filePath) || loadStoredWritingContext(project.id, res.previousPath) : undefined;
      loadProject(project, filePath, relocatedContext || undefined);
      if (!filePath) store.setState({ dirty: true });
      activate.current?.();
      notify('已打开剧本', 'ok');
      if (res.openToken) {
        try {
          if (!await bridge.commitOpen(res.openToken, project.name)) notify('剧本已打开，但最近项目记录未能更新。', 'error');
        } catch { notify('剧本已打开，但最近项目记录未能更新。', 'error'); }
      }
      return true;
    } catch (err) {
      notify(`打开失败：${(err as Error).message}`, 'error');
      return false;
    } finally {
      opening.current = false;
      setIsOpening(false);
    }
  }, [store]);
  const open = useCallback(() => openFile('dialog'), [openFile]);
  const openRecent = useCallback((id: string, options?: { allowPrompt?: boolean }) => openFile('recent', id, options), [openFile]);
  const relocateRecent = useCallback((id: string) => openFile('relocate', id), [openFile]);

  const importAny = useCallback(async () => {
    const { loadProject, notify, mutate, documentEpoch } = store.getState();
    if (opening.current) return false;
    opening.current = true;
    setIsOpening(true);
    try {
      const res = await bridge.openProject();
      if (!res) return false;
      if (store.getState().documentEpoch !== documentEpoch) {
        notify('导入期间已切换剧本，请重新选择要导入的文件。', 'error');
        return false;
      }
      const isFdx = res.path.toLowerCase().endsWith('.fdx');
      const fdx = isFdx ? fromFdx(res.content) : null;
      const elements = fdx ? fdx.elements : fromPlainText(res.content);
      const importedMeta = fdx?.sceneMeta || [];
      if (!elements.length) {
        notify('没有识别到内容', 'error');
        return false;
      }
      const current = store.getState();
      const hasDraft = !!document.querySelector('[data-project-draft-pending="true"]');
      const choice = await askChoice({
        title: '导入文本 / FDX',
        message: `识别到 ${elements.length} 个元素。要怎样放进当前剧本？`,
        warning: current.dirty || hasDraft ? '当前剧本有未保存的修改。选择「替换整个剧本」会放弃这些修改。' : undefined,
        options: [
          { value: 'append', label: '追加到剧本末尾', tone: 'primary' },
          { value: 'replace', label: '替换整个剧本', tone: 'danger' },
          { value: 'cancel', label: '不导入' },
        ],
        cancelValue: 'cancel',
      });
      // The document may have changed while the dialog was open.
      if (choice === 'cancel' || store.getState().documentEpoch !== documentEpoch) return false;
      if (choice === 'append') {
        mutate((p) => {
          p.elements.push(...elements);
          p.sceneMeta.push(...importedMeta);
        });
      } else {
        const p = createProject(store.getState().project.name);
        p.elements = elements;
        p.sceneMeta = importedMeta;
        if (fdx?.title && Object.values(fdx.title).some(Boolean)) Object.assign(p.titlePage, fdx.title, { show: true });
        beforeReplace.current?.();
        loadProject(p, null);
        store.setState({ dirty: true });
      }
      activate.current?.();
      notify('导入完成', 'ok');
      return true;
    } catch (err) {
      notify(`导入失败：${(err as Error).message}`, 'error');
      return false;
    } finally {
      opening.current = false;
      setIsOpening(false);
    }
  }, [store]);

  const exportPdf = useCallback(async (mode: 'creative' | 'print' = 'creative') => {
    const { project, documentEpoch, version, setView, notify, view, pdfExportMode, setPdfExportMode } = store.getState();
    if (pdfExportMode) return;
    const request = ++pdfRequest.current;
    const exportView = mode === 'creative' ? 'write' : 'preview';
    const scrollTop = document.querySelector('.editor')?.scrollTop || 0;
    setPdfExportMode(mode);
    setView(exportView);
    let invalidated = false;
    let interruptWait!: () => void;
    const interrupted = new Promise<void>(resolve => { interruptWait = resolve; });
    const isCurrent = () => {
      const state = store.getState();
      return request === pdfRequest.current && state.documentEpoch === documentEpoch &&
        state.project === project && state.version === version && state.view === exportView && state.pdfExportMode === mode;
    };
    const unsubscribe = store.subscribe(() => {
      if (!isCurrent()) { invalidated = true; interruptWait(); }
    });
    const assertCurrent = () => {
      if (invalidated || !isCurrent()) throw new Error('剧本、内容或视图已改变，请重新导出。');
    };
    // A document/view change also releases a font/image wait that belongs to a
    // detached old view. The losing promise cannot later continue this export.
    const waitFor = async (promise: PromiseLike<unknown> | undefined) => {
      await Promise.race([Promise.resolve(promise), interrupted]);
      assertCurrent();
    };
    try {
      const selector = mode === 'creative' ? '.editor__scroll[data-ready="true"]' : '.preview[data-ready="true"]';
      const paginationKey = `${version}:${mode === 'creative' ? project.settings.paper : 'A4'}`;
      let ready: HTMLElement | null = null;
      for (let i = 0; i < 160; i++) {
        assertCurrent();
        ready = document.querySelector<HTMLElement>(selector);
        if (ready?.dataset.paginationKey === paginationKey) break;
        ready = null;
        await waitFor(new Promise(r => setTimeout(r, 50)));
      }
      if (!ready) throw new Error('排版尚未就绪，请稍后重试。');
      await waitFor(document.fonts?.ready);
      await waitFor(waitForPrintableAssets());
      if (document.querySelector(selector) !== ready || ready.dataset.paginationKey !== paginationKey) {
        throw new Error('排版已经改变，请重新导出。');
      }
      // Both modes hand native code a frozen display snapshot before any Save
      // dialog opens. A4 must never print the later live main-window document.
      const opts = mode === 'creative' ? buildCreativePdf(ready) : buildPrintPdf(ready);
      const file = await bridge.exportPdf({ ...opts, name: `${project.name}-${mode === 'creative' ? '创作版' : 'A4纯文本'}.pdf` });
      if (file) {
        notify(`已导出${isCurrent() ? '' : '先前版本'} PDF：${file}`, 'ok');
        bridge.showInFolder(file);
      }
    } catch (err) {
      notify(`导出失败：${(err as Error).message}`, 'error');
    } finally {
      unsubscribe();
      if (request === pdfRequest.current) {
        const restoreView = !invalidated && isCurrent();
        // Keep context persistence suppressed while undoing our temporary view.
        // A later document or an explicit user view choice owns its own position.
        if (restoreView) setView(view);
        if (store.getState().pdfExportMode === mode) setPdfExportMode(null);
        if (!restoreView && store.getState().documentEpoch === documentEpoch) {
          setView(store.getState().view);
        }
        if (restoreView && view === 'write' && exportView !== 'write') {
          const focus = store.getState().focus;
          requestAnimationFrame(() => {
            const current = store.getState();
            if (request !== pdfRequest.current || current.documentEpoch !== documentEpoch ||
                current.view !== 'write' || current.pdfExportMode || current.focus !== focus) return;
            const editor = document.querySelector('.editor');
            if (editor) editor.scrollTop = scrollTop;
          });
        }
      }
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
      try {
        const content = map[kind](project);
        const file = await bridge.saveProjectAs({ content, name: project.name, ext: kind });
        if (file) notify(`已导出：${file}`, 'ok');
      } catch (err) {
        notify(`导出失败：${(err as Error).message}`, 'error');
      }
    },
    [store],
  );

  const newFile = useCallback(() => {
    const { dirty, notify } = store.getState();
    if (opening.current) return false;
    const hasDraft = !!document.querySelector('[data-project-draft-pending="true"]');
    if ((dirty || hasDraft) && !window.confirm('当前剧本有未保存的修改或未确认的文字，确定新建吗？')) return false;
    openingRequest.current++;
    beforeReplace.current?.();
    store.getState().newProject();
    activate.current?.();
    notify('已新建剧本');
    return true;
  }, [store]);

  const setElementType = useCallback(
    (type: ElementType) => {
      if (store.getState().view === 'character-lines') { store.getState().notify('请先定位到正文，再编辑段落。'); return; }
      const { activeId, setType, requestFocus, project } = store.getState();
      if (!activeId) return;
      setType(activeId, type);
      const el = project.elements.find((e) => e.id === activeId);
      if (el) requestFocus(activeId, 'end');
    },
    [store],
  );

  const insertScene = useCallback(() => {
    if (store.getState().view === 'character-lines') { store.getState().notify('请先定位到正文，再编辑段落。'); return; }
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
    if (store.getState().view === 'character-lines') { store.getState().notify('请先定位到正文，再编辑段落。'); return; }
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
    if (store.getState().view === 'character-lines') {
      window.dispatchEvent(new Event('guangying:character-lines-find'));
      return;
    }
    store.getState().setView('write');
    window.dispatchEvent(new Event('guangying:find'));
  }, [store]);

  return { save, isSaving, isOpening, open, openRecent, relocateRecent, importAny, exportPdf, exportAs, newFile, setElementType, insertScene, makeDual, openFind, sceneHeadings };
}
