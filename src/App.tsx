import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from './store/store';
import { PaginationProvider } from './hooks/PaginationProvider';
import { Editor } from './components/Editor';
import { FindPanel } from './components/FindPanel';
import { CardsView } from './components/CardsView';
import { BoardView } from './components/BoardView';
import { PreviewView } from './components/PreviewView';
import { ReportsView } from './components/ReportsView';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { SettingsDialog, TitlePageDialog } from './components/Dialogs';
import { useCommands } from './app/useCommands';
import { onMenuAction } from './io/native';
import { isElectron } from './io/native';
import { sampleProject } from './model/sample';
import { hexToRgba } from './utils/color';
import { resolveFontColor } from './model/appearance';
import { subscribeAutosave } from './app/autosaveSubscription';
import { readRecovery, createRecoveryWriter, recoveryErrorMessage } from './app/autosaveStorage';
import { useRecoveryStatus } from './app/recoveryStatus';
import { ownsNativeHistory, runEditHistory } from './utils/editHistory';
import { createModalSession, type ModalSession } from './app/modalFocus';
import { StartupPage } from './components/StartupPage';
import { bridge, type RecentProject } from './io/native';
import { readStartupPreference, writeStartupPreference, type StartupPreference } from './app/startupPreference';
import { subscribeWritingContextPersistence } from './app/writingContext';

export default function App() {
  const view = useStore((s) => s.view);
  const toast = useStore((s) => s.toast);
  const fontColor = useStore((s) => s.fontColor);
  const appTheme = useStore((s) => s.appTheme);
  // 只订阅窗口标题真正需要的字段；避免每次打字都让整个 App 树重新渲染。
  const projectName = useStore((s) => s.project.name);
  const [homeOpen, setHomeOpen] = useState(true);
  const [activated, setActivated] = useState(false);
  const [startupReady, setStartupReady] = useState(false);
  const [hasRecovery, setHasRecovery] = useState(false);
  const [startupWarning, setStartupWarning] = useState<string | null>(null);
  const [preference, setPreference] = useState<StartupPreference>(readStartupPreference);
  const [recentItems, setRecentItems] = useState<RecentProject[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentBusy, setRecentBusy] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const recentRequest = useRef(0);
  const recentMutation = useRef(false);
  const initialized = useRef(false);
  const resumePending = useRef(false);
  const contextSubscription = useRef<ReturnType<typeof subscribeWritingContextPersistence> | null>(null);
  const activateProject = useCallback(() => { setActivated(true); setHomeOpen(false); resumePending.current = false; }, []);
  const [dialog, setDialog] = useState<null | 'settings' | 'title'>(null);
  const modalSession = useRef<ModalSession | null>(null);
  const openDialog = useCallback((kind: 'settings' | 'title') => {
    if (modalSession.current || document.querySelector('[aria-modal="true"]')) return;
    modalSession.current = createModalSession();
    setDialog(kind);
  }, []);
  const closeDialog = useCallback(() => { setDialog(null); modalSession.current = null; }, []);
  const [findRequest, setFindRequest] = useState(0);
  useEffect(() => {
    const open = () => {
      if (!modalSession.current && !document.querySelector('[aria-modal="true"]')) setFindRequest(value => value + 1);
    };
    window.addEventListener('guangying:find', open);
    return () => window.removeEventListener('guangying:find', open);
  }, []);
  const commands = useCommands({ onActivate: activateProject, beforeReplace: () => { contextSubscription.current?.flush(); } });
  const isSaving = commands.isSaving;
  // 与工作台共用纯色背景；仅改变显示，不改变稿纸或素材的坐标。
  const writeBg = appTheme === 'day'
    ? 'linear-gradient(#eeede8, #eeede8)'
    : 'linear-gradient(#181d1b, #181d1b)';

  /* 启动：读取自动保存或示例剧本 */
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    // Obtaining window.localStorage itself can throw in a restricted context.
    let recovered;
    try { recovered = readRecovery(window.localStorage); }
    catch { recovered = { snapshot: null, source: null, warning: '无法读取自动恢复存储。请手动保存工程文件。' }; }
    const saved = recovered.snapshot;
    useStore.getState().loadProject(saved?.project ?? sampleProject(), saved?.filePath ?? null, saved?.context);
    // Recovery is not proof of a completed disk save. Loading is independent of
    // migration: quota/permissions must never replace recovered writing by blank.
    if (saved) useStore.setState({ dirty: true });
    setHasRecovery(!!saved);
    setStartupWarning(recovered.warning);
    if (preference === 'resume' && saved) activateProject();
    else resumePending.current = preference === 'resume' && !recovered.warning;
    setStartupReady(true);
    if (recovered.warning) {
      useRecoveryStatus.setState({ phase: 'error', error: recovered.warning, lastSuccess: null });
      useStore.getState().notify(recovered.warning, 'error');
    }
  }, []);

  useEffect(() => {
    if (!activated || homeOpen) return;
    const subscription = subscribeWritingContextPersistence(useStore, undefined, undefined, () => {
      useStore.getState().notify('写作位置暂时无法保存，下次打开可能回到较早位置。', 'error');
    });
    contextSubscription.current = subscription;
    return () => { subscription.flush(); subscription(); contextSubscription.current = null; };
  }, [activated, homeOpen]);

  const refreshRecent = useCallback(async () => {
    const request = ++recentRequest.current;
    setRecentLoading(true);
    try {
      const list = await bridge.getRecent();
      if (request !== recentRequest.current) return null;
      setRecentItems(list);
      return list;
    } catch {
      if (request === recentRequest.current) setRecentError('最近项目暂时无法读取。你仍可通过“打开项目”选择文件。');
      return null;
    } finally {
      if (request === recentRequest.current) setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!homeOpen || !startupReady) return;
    let cancelled = false;
    const epoch = useStore.getState().documentEpoch;
    void refreshRecent().then(async list => {
      if (cancelled || !resumePending.current || useStore.getState().documentEpoch !== epoch) return;
      resumePending.current = false;
      const last = list?.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
      // Automatic resume never displays a surprise file chooser. A stale or
      // unapproved location remains on the landing page for an explicit choice.
      if (!last) return;
      if (last.missing || last.needsAuthorization) {
        setRecentError('上次项目的位置需要重新确认，请在最近项目中重新定位或打开。');
        return;
      }
      if (!await commands.openRecent(last.id, { allowPrompt: false })) setRecentError('上次项目未能打开，请重新选择。原恢复数据已保留。');
    });
    return () => { cancelled = true; };
  }, [homeOpen, startupReady, refreshRecent, commands.openRecent]);

  const showHome = useCallback(() => {
    if (modalSession.current || useStore.getState().pdfExportMode) return;
    const pending = document.querySelector<HTMLElement>('[data-project-draft-pending="true"]');
    if (pending) {
      useStore.getState().notify('请先确认或取消正在编辑的文字，再返回启动页。');
      pending.focus();
      return;
    }
    contextSubscription.current?.flush();
    useStore.setState({ focus: null });
    setFindRequest(0);
    setHomeOpen(true);
    setRecentError(null);
  }, []);

  const runHomeOpen = useCallback(async (action: () => Promise<boolean>) => {
    resumePending.current = false;
    setRecentError(null);
    const before = useStore.getState().toast;
    const success = await action();
    if (!success) {
      const toast = useStore.getState().toast;
      if (toast && toast !== before && toast.kind === 'error') setRecentError(toast.text);
      void refreshRecent();
    }
  }, [refreshRecent]);

  const updateRecent = useCallback(async (action: () => Promise<RecentProject[]>) => {
    if (recentMutation.current) return;
    recentMutation.current = true;
    recentRequest.current++;
    setRecentLoading(false);
    setRecentBusy(true);
    setRecentError(null);
    try { setRecentItems(await action()); }
    catch { setRecentError('最近项目记录未能更新，请重试。工程文件没有被删除或修改。'); }
    finally { recentMutation.current = false; setRecentBusy(false); }
  }, []);

  /* 自动保存到本地 */
  useEffect(() => {
    // Landing-page decisions must not replace an existing recovery point with
    // the initial blank project, including StrictMode mount/cleanup and close.
    if (!activated) return;
    let failureReported = false;
    let epoch = useStore.getState().documentEpoch;
    const writeRecovery = createRecoveryWriter(() => window.localStorage);
    const subscription = subscribeAutosave(useStore, (saved) => {
      try {
        writeRecovery(saved);
        failureReported = false;
        useRecoveryStatus.setState({ phase: 'saved', error: null, lastSuccess: Date.now() });
        return true;
      } catch (error) {
        const message = recoveryErrorMessage(error);
        useRecoveryStatus.setState({ phase: 'error', error: message });
        // One toast per failure episode, not a modal on every keystroke.
        if (!failureReported) useStore.getState().notify(message, 'error');
        failureReported = true;
        return false;
      }
    }, undefined, () => {
      const currentEpoch = useStore.getState().documentEpoch;
      if (currentEpoch !== epoch) {
        epoch = currentEpoch;
        useRecoveryStatus.setState({ lastSuccess: null });
      }
      if (useRecoveryStatus.getState().phase !== 'error') useRecoveryStatus.setState({ phase: 'pending' });
    });
    const flush = () => { contextSubscription.current?.flush(); return subscription.flush(); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const recovered = flush();
      const state = useStore.getState();
      const uncommittedDraft = !!document.querySelector('[data-project-draft-pending="true"]');
      if (state.dirty || uncommittedDraft || !recovered || isSaving()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', beforeUnload);
      subscription();
    };
  }, [isSaving, activated]);

  useEffect(() => {
    document.title = `${projectName} · 光影写手`;
  }, [projectName]);

  /* 写作字体颜色 → CSS 变量（soft / glow 由主色派生，保证视觉一致） */
  useEffect(() => {
    // 二次兜底：即便 localStorage 里残留非法值，也只用合法颜色，保证 CSS 变量永远有效
    const color = resolveFontColor(fontColor, appTheme);
    const root = document.documentElement;
    root.style.setProperty('--writing-font-color', color);
    root.style.setProperty('--neon-yellow', color);
    root.style.setProperty('--neon-yellow-soft', hexToRgba(color, 0.4));
    root.style.setProperty('--neon-yellow-glow', `0 0 6px ${hexToRgba(color, 0.4)}, 0 0 14px ${hexToRgba(color, 0.18)}`);
  }, [fontColor, appTheme]);

  /* 菜单 / 快捷键 */
  useEffect(() => {
    const run = (action: string) => {
      if (modalSession.current || document.querySelector('[aria-modal="true"]')) {
        if (action === 'edit:undo' || action === 'edit:redo') modalSession.current?.history(action === 'edit:undo' ? 'undo' : 'redo');
        return;
      }
      const st = useStore.getState();
      if (action === 'file:home') { showHome(); return; }
      if (homeOpen && action !== 'file:new' && action !== 'file:open') return;
      switch (action) {
        case 'file:new':
          commands.newFile();
          break;
        case 'file:open':
          commands.open();
          break;
        case 'file:save':
          commands.save(false);
          break;
        case 'file:saveAs':
          commands.save(true);
          break;
        case 'file:importText':
        case 'file:importFdx':
          commands.importAny();
          break;
        case 'file:exportPdf':
          commands.exportPdf();
          break;
        case 'file:exportPrintPdf':
          commands.exportPdf('print');
          break;
        case 'file:exportFdx':
          commands.exportAs('fdx');
          break;
        case 'file:exportText':
          commands.exportAs('txt');
          break;
        case 'file:exportMd':
          commands.exportAs('md');
          break;
        case 'file:titlePage':
          openDialog('title');
          break;
        case 'file:settings':
          openDialog('settings');
          break;
        case 'edit:undo':
          runEditHistory('undo');
          break;
        case 'edit:redo':
          runEditHistory('redo');
          break;
        case 'edit:find':
          commands.openFind();
          break;
        case 'element:insertScene':
          commands.insertScene();
          break;
        case 'element:dual':
          commands.makeDual();
          break;
        case 'element:omit':
          if (st.activeId) st.toggleOmit(st.activeId);
          break;
        case 'view:write':
        case 'view:cards':
        case 'view:board':
        case 'view:preview':
        case 'view:reports':
          st.setView(action.split(':')[1] as 'write');
          break;
        case 'view:sidebar':
          st.toggleSidebar();
          break;
        default:
          if (action.startsWith('element:')) commands.setElementType(action.split(':')[1] as 'action');
      }
    };
    const off = onMenuAction(run);
    if (!isElectron()) {
      const onKey = (e: KeyboardEvent) => {
        if (e.defaultPrevented || e.isComposing) return;
        const meta = e.metaKey || e.ctrlKey;
        if (!meta) return;
        const map: Record<string, string> = {
          s: 'file:save',
          o: 'file:open',
          n: 'file:new',
          p: 'file:exportPrintPdf',
          f: 'edit:find',
          d: 'element:dual',
          z: e.shiftKey ? 'edit:redo' : 'edit:undo',
          '1': 'element:scene_heading',
          '2': 'element:action',
          '3': 'element:character',
          '4': 'element:parenthetical',
          '5': 'element:dialogue',
          '6': 'element:transition',
          '7': 'element:shot',
          '8': 'element:act',
        };
        const key = e.key.toLowerCase();
        if (key === 'z' && ownsNativeHistory(e.target)) return;
        if (map[key]) {
          e.preventDefault();
          run(map[key]);
        }
      };
      window.addEventListener('keydown', onKey);
      return () => {
        off();
        window.removeEventListener('keydown', onKey);
      };
    }
    return off;
  }, [commands, openDialog, homeOpen, showHome]);

  return (
    <PaginationProvider>
      <div className="app-shell" data-theme={appTheme}>
        <div className="write-bg" aria-hidden style={{ backgroundImage: writeBg }} />
        {homeOpen ? <StartupPage recentItems={recentItems} loading={!startupReady || recentLoading}
          busy={commands.isOpening || recentBusy} error={recentError} warning={startupWarning} preference={preference}
          onPreferenceChange={value => {
            if (writeStartupPreference(value)) setPreference(value);
            else setRecentError('启动偏好未能保存，请检查本地存储后重试。');
          }}
          onNew={() => { resumePending.current = false; commands.newFile(); }}
          onOpen={() => { void runHomeOpen(commands.open); }}
          onOpenRecent={id => { void runHomeOpen(() => commands.openRecent(id)); }}
          onRelocate={id => { void runHomeOpen(() => commands.relocateRecent(id)); }}
          onPin={(id, pinned) => { void updateRecent(() => bridge.pinRecent(id, pinned)); }}
          onRemove={id => { void updateRecent(() => bridge.removeRecent(id)); }}
          continueLabel={activated ? `继续当前写作 · ${projectName}` : hasRecovery ? `继续上次写作 · ${projectName}` : undefined}
          onContinue={activated || hasRecovery ? activateProject : undefined} /> : <>
        <Toolbar commands={commands} modalOpen={dialog !== null} onOpenHome={showHome} onOpenSettings={() => openDialog('settings')} onOpenTitle={() => openDialog('title')} />
        <div className="app-body">
          <Sidebar />
          <main className="app-main">
            {view === 'write' ? <Editor /> : null}
            {view === 'cards' ? <CardsView /> : null}
            {view === 'board' ? <BoardView /> : null}
            {view === 'preview' ? <PreviewView onExportPdf={commands.exportPdf} /> : null}
            {view === 'reports' ? <ReportsView /> : null}
          </main>
        </div>
        <StatusBar />
        </>}
        {findRequest > 0 && view === 'write' ? <FindPanel request={findRequest} onClose={() => setFindRequest(0)} /> : null}
        {dialog === 'settings' ? <SettingsDialog onClose={closeDialog} session={modalSession.current!} /> : null}
        {dialog === 'title' ? <TitlePageDialog onClose={closeDialog} session={modalSession.current!} /> : null}
        {toast ? <Toast text={toast.text} kind={toast.kind} ts={toast.ts} /> : null}
      </div>
    </PaginationProvider>
  );
}

function Toast({ text, kind, ts }: { text: string; kind: string; ts: number }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    setShow(true);
    const t = setTimeout(() => setShow(false), 3200);
    return () => clearTimeout(t);
  }, [ts]);
  if (!show) return null;
  return <div className={`toast toast--${kind}`}>{text}</div>;
}
