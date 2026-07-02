// 配布用アプリに同梱する Python embeddable package (Windows x64) を取得するスクリプト。
// 対戦プログラムは単体 .py ファイルのみ対応（pip/numpy 等は不要）なので、素の embeddable
// zip を展開するだけでよい。取得物は apps/electron/vendor/ 配下（.gitignore 済み）に置く。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PYTHON_VERSION = '3.11.9';
const ZIP_NAME       = `python-${PYTHON_VERSION}-embed-amd64.zip`;
const DOWNLOAD_URL    = `https://www.python.org/ftp/python/${PYTHON_VERSION}/${ZIP_NAME}`;

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.join(__dirname, '..');
const VENDOR_DIR    = path.join(ELECTRON_DIR, 'vendor');
const PYTHON_DIR    = path.join(VENDOR_DIR, 'python');
const ZIP_PATH       = path.join(VENDOR_DIR, ZIP_NAME);

async function main() {
  if (fs.existsSync(path.join(PYTHON_DIR, 'python.exe'))) {
    console.log(`[fetch-python] already present: ${PYTHON_DIR}`);
    return;
  }

  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  console.log(`[fetch-python] downloading ${DOWNLOAD_URL}`);
  const res = await fetch(DOWNLOAD_URL);
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  fs.writeFileSync(ZIP_PATH, Buffer.from(await res.arrayBuffer()));

  console.log(`[fetch-python] extracting to ${PYTHON_DIR}`);
  fs.mkdirSync(PYTHON_DIR, { recursive: true });
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${ZIP_PATH}' -DestinationPath '${PYTHON_DIR}' -Force`,
  ]);

  fs.rmSync(ZIP_PATH);
  console.log('[fetch-python] done');
}

main().catch((err) => {
  console.error('[fetch-python] failed:', err);
  process.exit(1);
});
