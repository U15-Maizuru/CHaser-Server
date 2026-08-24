// preload が contextBridge で公開する API の形。
//
// preload (実装側) と apps/frontend/src/types/electron.d.ts (利用側) の両方がこの型を参照する。
// 以前は同じ interface を両側に手書きしていたため、片方だけ変えても TypeScript が
// 何も検出しなかった。メソッドを増減するときはこのファイルだけを直せばよい。
export interface ElectronAPI {
  openMapFile:     () => Promise<string | null>;
  saveMapFile:     () => Promise<string | null>;
  openProgramFile: () => Promise<string | null>;
  openDirectory:   () => Promise<string | null>;
  openPythonExe:   () => Promise<string | null>;
  toggleDisplayFullscreen: () => Promise<boolean>;
  openManualWindow:        (slot: 0 | 1) => Promise<void>;
  openTournamentWindow:    () => Promise<void>;
  /** mapId 指定でそのライブラリマップを下敷きに、null なら白紙から編集する */
  openMapEditorWindow:     (mapId: string | null) => Promise<void>;
  /** window.confirm/alert を閉じたあと、そのウィンドウのキーボード入力を復帰させる */
  refocusWindow:           () => Promise<void>;
}
