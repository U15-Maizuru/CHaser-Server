'use strict';
// Dev launcher: Vite を起動してポート 5173 が準備完了してから Electron を起動する。
// pnpm が ELECTRON_RUN_AS_NODE=1 を残す場合があるため削除してから electron を起動する。
const { spawn } = require('child_process');
const net      = require('net');
const path     = require('path');
const electron = require('electron');

// Vite dev サーバーを起動 (shell: true で Windows の pnpm.cmd を自動解決)
const vite = spawn(
  'pnpm',
  ['--filter', '@u15/frontend', 'dev'],
  {
    stdio: 'inherit',
    env:   { ...process.env, NODE_ENV: 'development' },
    shell: true,
  },
);

vite.on('error', (err) => {
  console.error('[dev] Vite の起動に失敗しました:', err.message);
  process.exit(1);
});

// ポート 5173 が開くまでポーリング（最大 60 秒）
let attempts = 0;
function waitForVite() {
  const client = net.connect(5173, 'localhost', () => {
    client.destroy();
    launchElectron();
  });
  client.on('error', () => {
    attempts++;
    if (attempts > 120) {
      console.error('[dev] Vite が 60 秒以内に起動しませんでした');
      vite.kill();
      process.exit(1);
    }
    setTimeout(waitForVite, 500);
  });
}

function launchElectron() {
  const env = { ...process.env, NODE_ENV: 'development' };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(String(electron), [path.resolve(__dirname)], {
    stdio: 'inherit',
    env,
    shell: false,
  });

  child.on('close', (code) => {
    vite.kill();
    process.exit(code ?? 0);
  });
}

process.on('SIGINT',  () => { vite.kill(); process.exit(0); });
process.on('SIGTERM', () => { vite.kill(); process.exit(0); });

waitForVite();
