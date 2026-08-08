'use strict';
// Vite dev サーバーの起動と待ち受け。dev.js (CJS) と test-e2e.mjs (ESM) の両方から使う。
//
// 以前は E2E だけが `spawn('pnpm', …, { shell: true })` で起動しており、cmd → pnpm → cmd → vite と
// 実体が3階層下に来るため「Vite の本体は孫プロセス」という但し書きが必要になっていた。
// 起動方法が2つあると後始末の作法も2つになるので、dev.js の方式 (CLI を直接叩く) に一本化する。

const { spawn } = require('child_process');
const net       = require('net');
const path      = require('path');

const VITE_PORT = 5173;

/** ポートが既に誰かに握られているか (前回の残骸チェック / 起動完了の判定に使う) */
function isPortBusy(port) {
  return new Promise((resolve) => {
    const client = net.connect(port, '127.0.0.1', () => {
      client.destroy();
      resolve(true);
    });
    client.on('error', () => resolve(false));
  });
}

/**
 * Vite を起動する。
 *
 * pnpm 経由 (shell: true) ではなく Vite の CLI を直接起動する。pnpm を挟むと
 * cmd → pnpm → cmd → vite と実体が3階層下に来て、後始末が難しくなるため。
 * --strictPort を付けるのは、ポートが埋まっていたときに黙って 5174 へ逃げないようにするため
 * (Electron は 5173 を決め打ちで開くので、逃げられると白画面になる)。
 */
function spawnVite(stdio) {
  const frontendDir = path.resolve(__dirname, '../frontend');
  const viteBin     = path.join(frontendDir, 'node_modules/vite/bin/vite.js');

  return spawn(process.execPath, [viteBin, '--port', String(VITE_PORT), '--strictPort'], {
    cwd:   frontendDir,
    stdio,
    env:   { ...process.env, NODE_ENV: 'development' },
    shell: false,
  });
}

const POLL_INTERVAL_MS = 500;
const MAX_ATTEMPTS     = 120; // = POLL_INTERVAL_MS * MAX_ATTEMPTS ミリ秒でタイムアウト

/** ポートが開くまでポーリングして待つ (Vite に起動完了イベントが無いため) */
async function waitForPort(port) {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (await isPortBusy(port)) return;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  const timeoutSec = (POLL_INTERVAL_MS * MAX_ATTEMPTS) / 1000;
  throw new Error(`Vite が ${timeoutSec} 秒以内に起動しませんでした`);
}

module.exports = { VITE_PORT, isPortBusy, spawnVite, waitForPort };
