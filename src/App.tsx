import { useEffect, useState } from 'react';
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

export default function App() {
  const view = useStore((s) => s.view);
  const toast = useStore((s) => s.toast);
  const fontColor = useStore((s) => s.fontColor);
  const appTheme = useStore((s) => s.appTheme);
  // 只订阅窗口标题真正需要的字段；避免每次打字都让整个 App 树重新渲染。
  const projectName = useStore((s) => s.project.name);
  const [dialog, setDialog] = useState<null | 'settings' | 'title'>(null);
  const [findRequest, setFindRequest] = useState(0);
  useEffect(() => {
    const open = () => setFindRequest(value => value + 1);
    window.addEventListener('guangying:find', open);
    return () => window.removeEventListener('guangying:find', open);
  }, []);
  const commands = useCommands();
  const isSaving = commands.isSaving;
  // 与工作台共用纯色背景；仅改变显示，不改变稿纸或素材的坐标。
  const writeBg = appTheme === 'day'
    ? 'linear-gradient(#eeede8, #eeede8)'
    : 'linear-gradient(#181d1b, #181d1b)';

  /* 启动：读取自动保存或示例剧本 */
  useEffect(() => {
    // Obtaining window.localStorage itself can throw in a restricted context.
    let recovered;
    try { recovered = readRecovery(window.localStorage); }
    catch { recovered = { snapshot: null, source: null, warning: '无法读取自动恢复存储。请手动保存工程文件。' }; }
    const saved = recovered.snapshot;
    useStore.getState().loadProject(saved?.project ?? sampleProject(), saved?.filePath ?? null);
    // Recovery is not proof of a completed disk save. Loading is independent of
    // migration: quota/permissions must never replace recovered writing by blank.
    if (saved) useStore.setState({ dirty: true });
    if (recovered.warning) {
      useRecoveryStatus.setState({ phase: 'error', error: recovered.warning, lastSuccess: null });
      useStore.getState().notify(recovered.warning, 'error');
    }
  }, []);

  /* 自动保存到本地 */
  useEffect(() => {
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
    const flush = () => subscription.flush();
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
  }, [isSaving]);

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
      const st = useStore.getState();
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
          setDialog('title');
          break;
        case 'file:settings':
          setDialog('settings');
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
  }, [commands]);

  return (
    <PaginationProvider>
      <div className="app-shell" data-theme={appTheme}>
        <div className="write-bg" aria-hidden style={{ backgroundImage: writeBg }} />
        <Toolbar commands={commands} onOpenSettings={() => setDialog('settings')} onOpenTitle={() => setDialog('title')} />
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
        {findRequest > 0 && view === 'write' ? <FindPanel request={findRequest} onClose={() => setFindRequest(0)} /> : null}
        {dialog === 'settings' ? <SettingsDialog onClose={() => setDialog(null)} /> : null}
        {dialog === 'title' ? <TitlePageDialog onClose={() => setDialog(null)} /> : null}
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
