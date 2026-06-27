interface ElectronAPI {
  platform: string;
  openMapFile:     () => Promise<string | null>;
  saveMapFile:     () => Promise<string | null>;
  openProgramFile: () => Promise<string | null>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
