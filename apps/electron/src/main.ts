import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { app, BrowserWindow, ipcMain, dialog } from 'electron';

const isDev = process.env['NODE_ENV'] === 'development';

let backendProcess: ChildProcess | null = null;

function startBackend(appPath: string): void {
  const backendEntry = isDev
    ? path.join(appPath, '../../../apps/backend/src/index.ts')
    : path.join(process.resourcesPath, 'backend/dist/index.js');

  const [exe, args] = isDev
    ? ['node', [
        path.join(appPath, '../../../apps/backend/node_modules/tsx/dist/cli.cjs'),
        backendEntry,
      ]]
    : [process.execPath, [backendEntry]];

  const backendEnv = isDev
    ? { ...process.env }
    : { ...process.env, ELECTRON_RUN_AS_NODE: '1' };

  console.log('[main] backend entry:', backendEntry);

  backendProcess = spawn(exe, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: backendEnv,
  });
  backendProcess.stdout?.on('data', (d: Buffer) =>
    console.log('[backend]', d.toString().trimEnd()),
  );
  backendProcess.stderr?.on('data', (d: Buffer) =>
    console.error('[backend]', d.toString().trimEnd()),
  );
  backendProcess.on('exit', (code) => console.log('[backend] exit:', code));
}

function stopBackend(): void {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
    backendProcess = null;
  }
}

const WEB_PREFS = {
  contextIsolation: true,
  nodeIntegration: false,
};

function loadUrl(win: BrowserWindow, mode: 'display' | 'control'): void {
  const search = `?mode=${mode}`;
  if (isDev) {
    void win.loadURL(`http://localhost:5173/${search}`);
  } else {
    void win.loadFile(
      path.join(process.resourcesPath, 'frontend/dist/index.html'),
      { search },
    );
  }
}

// ── 対戦表示ウィンドウ ─────────────────────────────────────────────────────
// ゲームボードを常時表示。セットアップ中は「待機中」画面を表示。
let displayWindow: BrowserWindow | null = null;

function createDisplayWindow(): void {
  displayWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'U15 Server Maizuru — 対戦画面',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), ...WEB_PREFS },
  });
  loadUrl(displayWindow, 'display');
  displayWindow.on('closed', () => { displayWindow = null; });
}

// ── コントロールウィンドウ ────────────────────────────────────────────────
// セットアップ操作・チーム設定・ゲーム開始/リセットを行う。
let controlWindow: BrowserWindow | null = null;

function createControlWindow(): void {
  controlWindow = new BrowserWindow({
    width: 820,
    height: 920,
    title: 'U15 Server Maizuru — コントロール',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), ...WEB_PREFS },
  });
  loadUrl(controlWindow, 'control');

  // コントロールウィンドウを閉じたらアプリ全体を終了
  controlWindow.on('closed', () => {
    controlWindow = null;
    app.quit();
  });
}

app.whenReady().then(() => {
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Map files', extensions: ['map'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:saveFile', async () => {
    const result = await dialog.showSaveDialog({
      filters: [{ name: 'Map files', extensions: ['map'] }],
    });
    return result.canceled ? null : result.filePath ?? null;
  });

  ipcMain.handle('dialog:openProgramFile', async () => {
    const result = await dialog.showOpenDialog({
      filters: [
        { name: 'Python scripts', extensions: ['py'] },
        { name: 'Executables', extensions: ['exe'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  startBackend(__dirname);
  createDisplayWindow();
  createControlWindow();

  app.on('activate', () => {
    if (!displayWindow) createDisplayWindow();
    if (!controlWindow) createControlWindow();
  });
}).catch(console.error);

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', stopBackend);
