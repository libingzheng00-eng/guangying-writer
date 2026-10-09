/** 与 Electron 主进程通信的桥接层（浏览器环境下自动降级） */

export interface PdfOptions {
  pageSize: { width: number; height: number }; // 微米
  landscape?: boolean;
  mode?: 'creative' | 'print';
  html?: string;
  name?: string;
}

export interface NativeApi {
  isElectron: boolean;
  openProject: () => Promise<NativeOpenResult | null>;
  saveProject: (payload: { content: string; path?: string | null; name?: string }) => Promise<string | null>;
  saveProjectAs: (payload: { content: string; name: string; ext?: string }) => Promise<string | null>;
  exportPdf: (opts: PdfOptions) => Promise<string | null>;
  showInFolder: (path: string) => void;
  getRecent: () => Promise<RecentProject[]>;
  // Optional on an older host/mock. The bridge below always supplies a safe
  // fallback; absence never turns a renderer-provided path into file authority.
  openRecent?: (id: string, options?: { allowPrompt?: boolean }) => Promise<NativeOpenResult | null>;
  relocateRecent?: (id: string) => Promise<NativeOpenResult | null>;
  commitOpen?: (token: string, name?: string) => Promise<boolean>;
  pinRecent?: (id: string, pinned: boolean) => Promise<RecentProject[]>;
  removeRecent?: (id: string) => Promise<RecentProject[]>;
  onMenu: (cb: (action: string) => void) => () => void;
  getInfo: () => Promise<{ version: string; platform: string }>;
}

export interface NativeOpenResult {
  path: string;
  content: string;
  openToken?: string;
  /** Main-owned recent record's former location, only after native relocation. */
  previousPath?: string;
}

export interface RecentProject {
  id: string;
  name: string;
  path: string;
  updatedAt: number;
  pinned: boolean;
  missing?: boolean;
  needsAuthorization?: boolean;
}

declare global {
  interface Window {
    api?: NativeApi;
  }
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.api?.isElectron;
}

export function api(): NativeApi | null {
  return typeof window !== 'undefined' && window.api ? window.api : null;
}

/** 浏览器降级：用下载的方式保存文件 */
function download(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const bridge = {
  isElectron: isElectron(),
  openProject: async () => api()?.openProject() ?? null,
  saveProject: async ({ content, path, name }) => {
    const a = api();
    if (a) return a.saveProject({ content, path, name });
    download(name || '剧本.zhsp', content);
    return null;
  },
  saveProjectAs: async ({ content, name, ext }) => {
    const a = api();
    if (a) return a.saveProjectAs({ content, name, ext });
    download(`${name}.${ext || 'zhsp'}`, content);
    return null;
  },
  exportPdf: async (opts) => api()?.exportPdf(opts) ?? null,
  showInFolder: (path) => api()?.showInFolder(path),
  getRecent: async () => api()?.getRecent() ?? [],
  openRecent: async (id: string, options?: { allowPrompt?: boolean }) => api()?.openRecent?.(id, options) ?? null,
  relocateRecent: async (id: string) => api()?.relocateRecent?.(id) ?? null,
  commitOpen: async (token: string, name?: string) => api()?.commitOpen?.(token, name) ?? false,
  pinRecent: async (id: string, pinned: boolean) => {
    const method = api()?.pinRecent;
    if (!method) throw new Error('当前版本不支持管理最近项目。');
    return method(id, pinned);
  },
  removeRecent: async (id: string) => {
    const method = api()?.removeRecent;
    if (!method) throw new Error('当前版本不支持管理最近项目。');
    return method(id);
  },
  onMenu: (cb) => api()?.onMenu(cb) ?? (() => {}),
  getInfo: async () => api()?.getInfo() ?? { version: 'web', platform: 'web' },
} satisfies NativeApi;

export function onMenuAction(cb: (action: string) => void): () => void {
  return bridge.onMenu(cb);
}
