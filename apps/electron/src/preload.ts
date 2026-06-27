// Preload runs in a sandboxed renderer context (contextIsolation: true).
// Only 'electron' (not 'electron/renderer') is available here.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  openMapFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openFile'),

  saveMapFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile'),

  openProgramFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openProgramFile'),
});
