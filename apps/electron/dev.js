'use strict';
// Dev launcher: Vite を起動してポート 5173 が準備完了してから Electron を起動する。
// pnpm が ELECTRON_RUN_AS_NODE=1 を残す場合があるため削除してから electron を起動する。
const { spawn, execSync } = require('child_process');
const net      = require('net');
const path     = require('path');
const electron = require('electron');

// Windows のコンソールコードページが UTF-8 (65001) でないと、Node/Electron が
// 出力する日本語ログが文字化けするため、起動時にコンソール側を UTF-8 に切り替える。
if (process.platform === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch {
    // コンソールにアタッチしていない環境などでは失敗しても無視してよい
  }
}

// Vite/Electron の stdin は継承しない (stdout/stderr のみ継承してログは表示する)。
// Vite の CLI はインタラクティブショートカット (r/u/o/q 等) のために stdin を raw
// mode にするが、Windows のコンソールモードはプロセス終了時に自動復元されないため、
// 強制終了 (kill) すると起動元ターミナルのキー入力が壊れたまま残ってしまう。
const CHILD_STDIO = ['ignore', 'inherit', 'inherit'];

let electronProcess = null;

// 万一 stdin が raw mode のままになっていた場合に備えた防御的な復元。
function cleanupAndExit(code) {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(false);
  }
  if (electronProcess && !electronProcess.killed) electronProcess.kill();
  if (vite && !vite.killed) vite.kill();
  process.exit(code ?? 0);
}

// Vite dev サーバーを起動 (pnpm は Windows では pnpm.cmd を経由するため shell 経由で解決する)
const vite = spawn(
  'pnpm',
  ['--filter', '@u15/frontend', 'dev'],
  {
    stdio: CHILD_STDIO,
    env:   { ...process.env, NODE_ENV: 'development' },
    shell: true,
  },
);

vite.on('error', (err) => {
  console.error('[dev] Vite の起動に失敗しました:', err.message);
  cleanupAndExit(1);
});

// ポート 5173 が開くまでポーリングして待つ (Vite に起動完了イベントがないため)
const VITE_POLL_INTERVAL_MS = 500;
const VITE_MAX_ATTEMPTS     = 120; // = VITE_POLL_INTERVAL_MS * VITE_MAX_ATTEMPTS 秒でタイムアウト
let attempts = 0;
function waitForVite() {
  const client = net.connect(5173, 'localhost', () => {
    client.destroy();
    launchElectron();
  });
  client.on('error', () => {
    attempts++;
    if (attempts > VITE_MAX_ATTEMPTS) {
      const timeoutSec = (VITE_POLL_INTERVAL_MS * VITE_MAX_ATTEMPTS) / 1000;
      console.error(`[dev] Vite が ${timeoutSec} 秒以内に起動しませんでした`);
      cleanupAndExit(1);
    }
    setTimeout(waitForVite, VITE_POLL_INTERVAL_MS);
  });
}

function launchElectron() {
  const env = { ...process.env, NODE_ENV: 'development' };
  delete env.ELECTRON_RUN_AS_NODE;

  // electron パッケージが解決する実行ファイルへの絶対パスを直接起動するため shell は不要
  // (pnpm 経由の起動と異なり、コマンド名からの PATH 解決は発生しない)
  electronProcess = spawn(String(electron), [path.resolve(__dirname)], {
    stdio: CHILD_STDIO,
    env,
    shell: false,
  });

  electronProcess.on('close', (code) => {
    cleanupAndExit(code);
  });
}

process.on('SIGINT',  () => cleanupAndExit(0));
process.on('SIGTERM', () => cleanupAndExit(0));

waitForVite();
