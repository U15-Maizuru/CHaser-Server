interface ElectronAPI {
  platform: string;
  openMapFile:     () => Promise<string | null>;
  saveMapFile:     () => Promise<string | null>;
  openProgramFile: () => Promise<string | null>;
  openDirectory:   () => Promise<string | null>;
  openPythonExe:   () => Promise<string | null>;
  toggleDisplayFullscreen: () => Promise<boolean>;
  openManualWindow:        (slot: 0 | 1) => Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
