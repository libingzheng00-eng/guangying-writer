const { contextBridge, ipcRenderer } = require('electron');

const api = {
  isElectron: true,
  openProject: () => ipcRenderer.invoke('dialog:open'),
  saveProject: (payload) => ipcRenderer.invoke('dialog:save', payload),
  saveProjectAs: (payload) => ipcRenderer.invoke('dialog:saveAs', payload),
  exportPdf: (opts) => ipcRenderer.invoke('pdf:export', opts),
  showInFolder: (path) => ipcRenderer.invoke('file:show', path),
  getRecent: () => ipcRenderer.invoke('app:recent'),
  getInfo: () => ipcRenderer.invoke('app:info'),
  onMenu: (cb) => {
    if (typeof cb !== 'function') throw new TypeError('菜单监听器必须是函数');
    const listener = (_e, action) => cb(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
};

// Child frames never receive native capabilities. Main-process sender validation
// remains mandatory even if a compromised renderer bypasses this surface.
if (process.isMainFrame) contextBridge.exposeInMainWorld('api', Object.freeze(api));
