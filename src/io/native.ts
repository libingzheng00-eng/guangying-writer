/** 与 Electron 主进程通信的桥接层（浏览器环境下自动降级） */

export interface PdfOptions {
  pageSize: { width: number; height: number }; // 微米
  landscape?: boolean;
}

export interface NativeApi {
  isElectron: boolean;
  openProject: () => Promise<{ path: string; content: string } | null>;
  saveProject: (payload: { content: string; path?: string | null; name?: string }) => Promise<string | null>;
  saveProjectAs: (payload: { content: string; name: string; ext?: string }) => Promise<string | null>;
  exportPdf: (opts: PdfOptions) => Promise<string | null>;
  showInFolder: (path: string) => void;
  getRecent: () => Promise<{ path: string; name: string; updatedAt: number }[]>;
  onMenu: (cb: (action: string) => void) => () => void;
  getInfo: () => Promise<{ version: string; platform: string }>;
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

export const bridge: NativeApi = {
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
  onMenu: (cb) => api()?.onMenu(cb) ?? (() => {}),
  getInfo: async () => api()?.getInfo() ?? { version: 'web', platform: 'web' },
};

export function onMenuAction(cb: (action: string) => void): () => void {
  return bridge.onMenu(cb);
}
