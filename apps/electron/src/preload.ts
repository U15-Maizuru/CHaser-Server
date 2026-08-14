// Preload runs in a sandboxed renderer context (contextIsolation: true).
// Only 'electron' (not 'electron/renderer') is available here.
import type { ElectronAPI } from './electronApi.js';

const { contextBridge, ipcRenderer } = require('electron');

// satisfies で ElectronAPI との食い違いをコンパイル時に検出する
// (フロントエンド側も同じ型を参照しているので、片側だけの変更は型エラーになる)
contextBridge.exposeInMainWorld('electronAPI', {
  openMapFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openFile'),

  saveMapFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile'),

  openProgramFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openProgramFile'),

  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),

  openPythonExe: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openPythonExe'),

  toggleDisplayFullscreen: (): Promise<boolean> =>
    ipcRenderer.invoke('display:toggleFullscreen'),

  openManualWindow: (slot: 0 | 1): Promise<void> =>
    ipcRenderer.invoke('manual:openWindow', slot),

  openTournamentWindow: (): Promise<void> =>
    ipcRenderer.invoke('tournament:openWindow'),

  refocusWindow: (): Promise<void> =>
    ipcRenderer.invoke('window:refocus'),
} satisfies ElectronAPI);
