import fs from 'node:fs';
import path from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import busboy from 'busboy';

// Directories relative to the backend process CWD
const DIRS = {
  'program-0': path.resolve('server/programs/cool'),
  'program-1': path.resolve('server/programs/hot'),
  'library-0': path.resolve('server/libs/cool'),
  'library-1': path.resolve('server/libs/hot'),
  'map':       path.resolve('server/maps'),
} as const;

export function ensureDirectories(): void {
  for (const dir of Object.values(DIRS)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
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

  // POST /api/upload/program?slot=0|1
  if (req.method === 'POST' && url.pathname === '/api/upload/program') {
    if (slot !== '0' && slot !== '1') { badRequest(res, 'slot は 0 か 1 を指定してください'); return; }
    handleUpload(req, res, DIRS[`program-${slot}`], ['.py', '.exe'], 512 * 1024);
    return;
  }

  // POST /api/upload/library?slot=0|1
  if (req.method === 'POST' && url.pathname === '/api/upload/library') {
    if (slot !== '0' && slot !== '1') { badRequest(res, 'slot は 0 か 1 を指定してください'); return; }
    handleUpload(req, res, DIRS[`library-${slot}`], ['.py'], 512 * 1024);
    return;
  }

  // POST /api/upload/map
  if (req.method === 'POST' && url.pathname === '/api/upload/map') {
    handleUpload(req, res, DIRS['map'], ['.map'], 1024 * 1024);
    return;
  }

  // GET /api/libs?slot=0|1
  if (req.method === 'GET' && url.pathname === '/api/libs') {
    if (slot !== '0' && slot !== '1') { badRequest(res, 'slot は 0 か 1 を指定してください'); return; }
    const dir = DIRS[`library-${slot}`];
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.py')) : [];
    json(res, 200, { files });
    return;
  }

  // DELETE /api/libs/:filename?slot=0|1
  const libMatch = url.pathname.match(/^\/api\/libs\/(.+)$/);
  if (req.method === 'DELETE' && libMatch) {
    if (slot !== '0' && slot !== '1') { badRequest(res, 'slot は 0 か 1 を指定してください'); return; }
    const filename = sanitizeFilename(decodeURIComponent(libMatch[1]));
    if (!filename) { badRequest(res, '無効なファイル名'); return; }
    const filepath = path.join(DIRS[`library-${slot}`], filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

function handleUpload(
  req:        IncomingMessage,
  res:        ServerResponse,
  dir:        string,
  allowed:    string[],
  maxBytes:   number,
): void {
  let bb: ReturnType<typeof busboy>;
  try {
    bb = busboy({ headers: req.headers, limits: { fileSize: maxBytes } });
  } catch {
    badRequest(res, 'Content-Type が multipart/form-data ではありません');
    return;
  }

  let saved        = false;
  let serverPath   = '';

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
  // Strip path separators and whitespace, replace spaces
  return path.basename(name).replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._\-　-鿿]/g, '_');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function badRequest(res: ServerResponse, message: string): void {
  json(res, 400, { error: message });
}
