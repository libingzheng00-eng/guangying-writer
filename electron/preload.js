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
    const listener = (_e, action) => cb(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
};

contextBridge.exposeInMainWorld('api', api);
