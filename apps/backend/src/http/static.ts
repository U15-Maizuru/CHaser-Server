import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type IncomingMessage, type ServerResponse } from 'node:http';

// 本番ビルド (Electron) では frontend/dist を静的配信する。
// dev では Vite が port 5173 で担当するので不要。
const isDev = process.env['NODE_ENV'] === 'development';

export const FRONTEND_DIST = isDev
  ? null
  : (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rp: string | undefined = (process as any).resourcesPath;
      const fromResources = rp ? path.join(rp, 'frontend', 'dist') : null;
      const fromRelative  = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../..', 'apps', 'frontend', 'dist',
      );
      return fromResources && fs.existsSync(fromResources)
        ? fromResources
        : fs.existsSync(fromRelative) ? fromRelative : null;
    })();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.json': 'application/json',
  '.woff2':'font/woff2',
};

/** SPA フォールバック付きの静的配信 (見つからないパスは index.html を返す) */
export function serveStatic(req: IncomingMessage, res: ServerResponse, distDir: string): void {
  const url      = new URL(req.url ?? '/', `http://${req.headers.host}`);
  let   filePath = path.join(distDir, url.pathname);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    filePath = path.join(distDir, 'index.html');
  }

  const contentType = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
}
