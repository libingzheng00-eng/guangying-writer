import React, { useEffect, useState } from 'react';
import { useStore } from './store/store';
import { PaginationProvider } from './hooks/PaginationProvider';
import { Editor } from './components/Editor';
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
import { parseProject } from './io/zhsp';
import { sampleProject } from './model/sample';
import { hexToRgba } from './utils/color';
import { isHexColor } from './utils/color';
import { DEFAULT_FONT_COLOR } from './store/store';

const LS_KEY = 'mojiang:autosave';

export default function App() {
  const view = useStore((s) => s.view);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toast = useStore((s) => s.toast);
  const fontColor = useStore((s) => s.fontColor);
  const project = useStore((s) => s.project);
  const version = useStore((s) => s.version);
  const [dialog, setDialog] = useState<null | 'settings' | 'title'>(null);
  const commands = useCommands();
  // 原源码包遗漏了示例背景图。使用内置渐变保证开源仓库可以直接构建；
  // 后续若添加可再分发的原创图片，可在此处作为可选的视觉资源接入。
  const writeBg = 'radial-gradient(circle at 76% 12%, rgba(63, 82, 104, .18), transparent 34%), linear-gradient(140deg, #111820 0%, #17232e 52%, #0d1218 100%)';

  /* 启动：读取自动保存或示例剧本 */
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        if (saved && saved.project) {
          useStore.getState().loadProject(parseProject(JSON.stringify(saved.project)), saved.filePath || null);
          return;
        }
      } catch {
        /* 忽略损坏的自动保存 */
      }
    }
    useStore.getState().loadProject(sampleProject(), null);
  }, []);

  /* 自动保存到本地 */
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ project: useStore.getState().project, filePath: useStore.getState().filePath }));
      } catch {
        /* 忽略容量问题 */
      }
    }, 900);
    return () => clearTimeout(t);
  }, [version]);

  useEffect(() => {
    document.title = `${project.name} · 墨场`;
  }, [project.name]);

  /* 写作字体颜色 → CSS 变量（soft / glow 由主色派生，保证视觉一致） */
  useEffect(() => {
    // 二次兜底：即便 localStorage 里残留非法值，也只用合法颜色，保证 CSS 变量永远有效
    const color = isHexColor(fontColor) ? fontColor : DEFAULT_FONT_COLOR;
    const root = document.documentElement;
    root.style.setProperty('--neon-yellow', color);
    root.style.setProperty('--neon-yellow-soft', hexToRgba(color, 0.4));
    root.style.setProperty('--neon-yellow-glow', `0 0 6px ${hexToRgba(color, 0.4)}, 0 0 14px ${hexToRgba(color, 0.18)}`);
  }, [fontColor]);

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
          st.undo();
          break;
        case 'edit:redo':
          st.redo();
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
        const meta = e.metaKey || e.ctrlKey;
        if (!meta) return;
        const map: Record<string, string> = {
          s: 'file:save',
          o: 'file:open',
          n: 'file:new',
          p: 'file:exportPdf',
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
      <div className="app-shell">
        <div className="write-bg" aria-hidden style={{ backgroundImage: writeBg }} />
        <Toolbar commands={commands} onOpenSettings={() => setDialog('settings')} onOpenTitle={() => setDialog('title')} />
        <div className="app-body">
          {sidebarOpen ? <Sidebar /> : null}
          <main className="app-main">
            {view === 'write' ? <Editor /> : null}
            {view === 'cards' ? <CardsView /> : null}
            {view === 'board' ? <BoardView /> : null}
            {view === 'preview' ? <PreviewView onExportPdf={commands.exportPdf} /> : null}
            {view === 'reports' ? <ReportsView /> : null}
          </main>
        </div>
        <StatusBar />
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
