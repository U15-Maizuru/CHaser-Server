import fs from 'node:fs';
import path from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import busboy from 'busboy';
import type { RoomManager } from '../RoomManager.js';

// 本番ビルド (Electron) では frontend/dist を静的配信する
// dev では Vite が port 5173 で担当するので不要
const isDev = process.env['NODE_ENV'] === 'development';
const FRONTEND_DIST = isDev
  ? null
  : (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rp: string | undefined = (process as any).resourcesPath;
      const fromResources = rp ? path.join(rp, 'frontend', 'dist') : null;
      const fromRelative  = path.resolve(
        path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')),
        '../../..', 'apps', 'frontend', 'dist',
      );
      return fromResources && fs.existsSync(fromResources)
        ? fromResources
        : fs.existsSync(fromRelative) ? fromRelative : null;
    })();

const MAPS_DIR = path.resolve('server/maps');

function roomDirs(roomId: string) {
  return {
    'program-0': path.resolve(`server/rooms/${roomId}/programs/cool`),
    'program-1': path.resolve(`server/rooms/${roomId}/programs/hot`),
    'library-0': path.resolve(`server/rooms/${roomId}/libs/cool`),
    'library-1': path.resolve(`server/rooms/${roomId}/libs/hot`),
  } as const;
}

export function ensureDirectories(): void {
  fs.mkdirSync(MAPS_DIR, { recursive: true });
}

export function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rm?: RoomManager,
): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url  = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const slot = url.searchParams.get('slot');
  const room = url.searchParams.get('room');

  // GET /api/default-room → ローカルモードで Electron が roomId を取得するエンドポイント
  if (req.method === 'GET' && url.pathname === '/api/default-room') {
    const localRoom = rm?.getRoom('local');
    if (localRoom) {
      json(res, 200, { roomId: 'local', ports: localRoom.ports });
    } else {
      json(res, 404, { error: 'ローカルルームが見つかりません' });
    }
    return;
  }

  // POST /api/upload/program?slot=0|1&room=<id>
  if (req.method === 'POST' && url.pathname === '/api/upload/program') {
    if (slot !== '0' && slot !== '1') { badRequest(res, 'slot は 0 か 1 を指定してください'); return; }
    if (!room) { badRequest(res, 'room パラメータが必要です'); return; }
    const dirs = roomDirs(room);
    const dir  = dirs[`program-${slot}`];
    fs.mkdirSync(dir, { recursive: true });
    handleUpload(req, res, dir, ['.py', '.exe'], 512 * 1024);
    return;
  }

  // POST /api/upload/library?slot=0|1&room=<id>
  if (req.method === 'POST' && url.pathname === '/api/upload/library') {
    if (slot !== '0' && slot !== '1') { badRequest(res, 'slot は 0 か 1 を指定してください'); return; }
    if (!room) { badRequest(res, 'room パラメータが必要です'); return; }
    const dirs = roomDirs(room);
    const dir  = dirs[`library-${slot}`];
    fs.mkdirSync(dir, { recursive: true });
    handleUpload(req, res, dir, ['.py'], 512 * 1024);
    return;
  }

  // POST /api/upload/map (マップはグローバル共有)
  if (req.method === 'POST' && url.pathname === '/api/upload/map') {
    fs.mkdirSync(MAPS_DIR, { recursive: true });
    handleUpload(req, res, MAPS_DIR, ['.map'], 1024 * 1024);
    return;
  }

  // GET /api/libs?slot=0|1&room=<id>
  if (req.method === 'GET' && url.pathname === '/api/libs') {
    if (slot !== '0' && slot !== '1') { badRequest(res, 'slot は 0 か 1 を指定してください'); return; }
    if (!room) { badRequest(res, 'room パラメータが必要です'); return; }
    const dir   = roomDirs(room)[`library-${slot}`];
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.py')) : [];
    json(res, 200, { files });
    return;
  }

  // DELETE /api/libs/:filename?slot=0|1&room=<id>
  const libMatch = url.pathname.match(/^\/api\/libs\/(.+)$/);
  if (req.method === 'DELETE' && libMatch) {
    if (slot !== '0' && slot !== '1') { badRequest(res, 'slot は 0 か 1 を指定してください'); return; }
    if (!room) { badRequest(res, 'room パラメータが必要です'); return; }
    const filename = sanitizeFilename(decodeURIComponent(libMatch[1]));
    if (!filename) { badRequest(res, '無効なファイル名'); return; }
    const filepath = path.join(roomDirs(room)[`library-${slot}`], filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    res.writeHead(204);
    res.end();
    return;
  }

  // 本番: フロントエンド静的ファイル配信 (SPA フォールバック付き)
  if (FRONTEND_DIST && req.method === 'GET') {
    serveStatic(req, res, FRONTEND_DIST);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

function serveStatic(req: IncomingMessage, res: ServerResponse, distDir: string): void {
  const url      = new URL(req.url ?? '/', `http://${req.headers.host}`);
  let   filePath = path.join(distDir, url.pathname);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    filePath = path.join(distDir, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
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
  const contentType = MIME[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
}

function handleUpload(
  req:      IncomingMessage,
  res:      ServerResponse,
  dir:      string,
  allowed:  string[],
  maxBytes: number,
): void {
  let bb: ReturnType<typeof busboy>;
  try {
    bb = busboy({ headers: req.headers, limits: { fileSize: maxBytes } });
  } catch {
    badRequest(res, 'Content-Type が multipart/form-data ではありません');
    return;
  }

  let saved      = false;
  let serverPath = '';

  bb.on('file', (_field, stream, info) => {
    const ext = path.extname(info.filename).toLowerCase();
    if (!allowed.includes(ext)) {
      stream.resume();
      bb.destroy();
      badRequest(res, `許可されていない拡張子です (${allowed.join(', ')} のみ)`);
      return;
    }

    const safe    = sanitizeFilename(info.filename);
    const outPath = path.join(dir, safe);
    serverPath    = outPath;

    const out = fs.createWriteStream(outPath);
    stream.pipe(out);
    stream.on('limit', () => {
      out.destroy();
      fs.unlink(outPath, () => {});
      bb.destroy();
      json(res, 413, { error: `ファイルサイズが上限 (${maxBytes / 1024}KB) を超えています` });
    });
    out.on('close', () => { saved = true; });
  });

  bb.on('close', () => {
    if (saved) {
      json(res, 200, { serverPath });
    } else if (!res.headersSent) {
      badRequest(res, 'ファイルが含まれていません');
    }
  });

  bb.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'アップロード処理中にエラーが発生しました' }));
    }
  });

  req.pipe(bb);
}

function sanitizeFilename(name: string): string {
  return path.basename(name).replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._\-　-鿿]/g, '_');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function badRequest(res: ServerResponse, message: string): void {
  json(res, 400, { error: message });
}
