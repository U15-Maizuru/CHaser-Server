import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';
import busboy from 'busboy';
import type { InlineMapData, MapParams } from '@u15/ws-types';
import { MapObject } from '@u15/ws-types';
import type { RoomManager } from '../RoomManager.js';
import { ensureLibDir } from '../libTemplates.js';
import { createRandomMap, exportMap } from '../game/GameSystem.js';
import type { GameMap } from '../game/types.js';
import {
  addCatalogEntry,
  catalogDir,
  deleteCatalogEntry,
  ensureCatalogDir,
  listCatalogEntries,
  setDemoEnabled,
} from '../programCatalog.js';
import {
  addMapCatalogEntry,
  addMapCatalogEntryFromInline,
  deleteMapCatalogEntry,
  ensureMapCatalogDir,
  getMapCatalogEntry,
  listMapCatalogEntries,
  mapCatalogDir,
} from '../mapCatalog.js';

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

const MUSIC_DIR = path.resolve('server/music'); // BGM再生用 (原本の ./Music フォルダに相当)
const MUSIC_EXTENSIONS = ['.mp3', '.wav'];

function roomDirs(roomId: string) {
  return {
    'program-0': path.resolve(`server/rooms/${roomId}/programs/cool`),
    'program-1': path.resolve(`server/rooms/${roomId}/programs/hot`),
    // Python 側で `from lib.pyCHaser import *` のようにパッケージとして import できるよう、
    // PYTHONPATH (ProcessClient.buildEnv の libPath = このひとつ上の階層) の直下に
    // 実体を "lib" という名前のディレクトリとして配置する。
    'library-0': path.resolve(`server/rooms/${roomId}/libs/cool/lib`),
    'library-1': path.resolve(`server/rooms/${roomId}/libs/hot/lib`),
  } as const;
}

export function ensureDirectories(): void {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  ensureCatalogDir();
  ensureMapCatalogDir();
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

  // POST /api/programs → プログラムライブラリへの新規アップロード (room/slot に非依存)
  if (req.method === 'POST' && url.pathname === '/api/programs') {
    ensureCatalogDir();
    handleUpload(req, res, catalogDir(), ['.py', '.exe'], 512 * 1024, (outPath, originalFilename) => {
      const entry = addCatalogEntry(originalFilename, outPath);
      return { serverPath: entry.programPath, entry };
    });
    return;
  }

  // GET /api/programs → プログラムライブラリの一覧
  if (req.method === 'GET' && url.pathname === '/api/programs') {
    json(res, 200, { entries: listCatalogEntries() });
    return;
  }

  // PATCH /api/programs/:id → デモ対象フラグの更新 body: { demoEnabled: boolean }
  const programPatchMatch = url.pathname.match(/^\/api\/programs\/([^/]+)$/);
  if (req.method === 'PATCH' && programPatchMatch) {
    readJsonBody(req)
      .then((body) => {
        const entry = setDemoEnabled(programPatchMatch[1]!, Boolean((body as { demoEnabled?: boolean }).demoEnabled));
        if (!entry) { json(res, 404, { error: 'プログラムが見つかりません' }); return; }
        json(res, 200, { entry });
      })
      .catch(() => badRequest(res, '不正なリクエストボディです'));
    return;
  }

  // DELETE /api/programs/:id → プログラムライブラリからの削除
  if (req.method === 'DELETE' && programPatchMatch) {
    deleteCatalogEntry(programPatchMatch[1]!);
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /api/upload/library?slot=0|1&room=<id>
  if (req.method === 'POST' && url.pathname === '/api/upload/library') {
    if (slot !== '0' && slot !== '1') { badRequest(res, 'slot は 0 か 1 を指定してください'); return; }
    if (!room) { badRequest(res, 'room パラメータが必要です'); return; }
    const dirs = roomDirs(room);
    const dir  = dirs[`library-${slot}`];
    ensureLibDir(dir);
    handleUpload(req, res, dir, ['.py'], 512 * 1024);
    return;
  }

  // POST /api/maps → マップライブラリへの新規アップロード (room/slot に非依存、グローバル共有)
  if (req.method === 'POST' && url.pathname === '/api/maps') {
    ensureMapCatalogDir();
    handleUpload(req, res, mapCatalogDir(), ['.map'], 1024 * 1024, (outPath, originalFilename) => {
      const displayName = originalFilename.replace(/\.map$/i, '');
      const entry = addMapCatalogEntry(displayName, outPath);
      if (!entry) return { error: '.map ファイルとして解析できませんでした' };
      return { serverPath: entry.mapPath, entry };
    });
    return;
  }

  // GET /api/maps → マップライブラリの一覧
  if (req.method === 'GET' && url.pathname === '/api/maps') {
    json(res, 200, { entries: listMapCatalogEntries() });
    return;
  }

  // GET /api/maps/current?room=<id> → 指定ルームの現在のマップ (エディタ起点・現在マップ表示用)
  if (req.method === 'GET' && url.pathname === '/api/maps/current') {
    const r = room ? rm?.getRoom(room) : undefined;
    if (!r) { json(res, 404, { error: 'ルームが見つかりません' }); return; }
    json(res, 200, { data: r.manager.getCurrentMapData() });
    return;
  }

  // POST /api/maps/random → ステートレスなランダムマップ生成 (どのルームにも影響しない)
  if (req.method === 'POST' && url.pathname === '/api/maps/random') {
    readJsonBody(req)
      .then((body) => {
        const p = body as Partial<MapParams>;
        const map = createRandomMap(p.size, p.blockNum ?? 20, p.itemNum ?? 51, p.turnNum ?? 100, p.mirror ?? true);
        const data: InlineMapData = { field: map.field, size: map.size, turn: map.turn, teamFirstPoint: map.teamFirstPoint };
        json(res, 200, { data });
      })
      .catch(() => badRequest(res, '不正なリクエストボディです'));
    return;
  }

  // POST /api/maps/save-inline → マップエディタで組んだマップをライブラリへ保存 body: { displayName, data: InlineMapData }
  if (req.method === 'POST' && url.pathname === '/api/maps/save-inline') {
    ensureMapCatalogDir();
    readJsonBody(req)
      .then((body) => {
        const { displayName, data } = body as { displayName?: string; data?: InlineMapData };
        if (!displayName || !data) { badRequest(res, 'displayName と data が必要です'); return; }
        const entry = addMapCatalogEntryFromInline(displayName, data);
        json(res, 200, { entry });
      })
      .catch(() => badRequest(res, '不正なリクエストボディです'));
    return;
  }

  // POST /api/maps/export → マップエディタの内容をライブラリに残さずそのままダウンロード body: { displayName, data: InlineMapData }
  if (req.method === 'POST' && url.pathname === '/api/maps/export') {
    readJsonBody(req)
      .then((body) => {
        const { displayName, data } = body as { displayName?: string; data?: InlineMapData };
        if (!displayName || !data) { badRequest(res, 'displayName と data が必要です'); return; }

        const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'u15-map-export-'));
        const tmpPath = path.join(tmpDir, `${sanitizeFilename(displayName)}.map`);
        const gameMap: GameMap = {
          field: data.field as MapObject[][], turn: data.turn, name: displayName,
          size: data.size, teamFirstPoint: data.teamFirstPoint, textureDirPath: 'Jewel',
        };
        exportMap(gameMap, tmpPath);

        sendFileDownload(res, tmpPath, `${displayName}.map`, () => {
          fs.rm(tmpDir, { recursive: true, force: true }, () => {});
        });
      })
      .catch(() => badRequest(res, '不正なリクエストボディです'));
    return;
  }

  // GET /api/maps/:id/download → ライブラリ内のマップをそのままダウンロード
  const mapDownloadMatch = url.pathname.match(/^\/api\/maps\/([^/]+)\/download$/);
  if (req.method === 'GET' && mapDownloadMatch) {
    const entry = getMapCatalogEntry(mapDownloadMatch[1]!);
    if (!entry || !fs.existsSync(entry.mapPath)) { json(res, 404, { error: 'マップが見つかりません' }); return; }
    sendFileDownload(res, entry.mapPath, `${entry.displayName}.map`);
    return;
  }

  // DELETE /api/maps/:id → マップライブラリからの削除
  const mapIdMatch = url.pathname.match(/^\/api\/maps\/([^/]+)$/);
  if (req.method === 'DELETE' && mapIdMatch) {
    deleteMapCatalogEntry(mapIdMatch[1]!);
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/libs?slot=0|1&room=<id>
  if (req.method === 'GET' && url.pathname === '/api/libs') {
    if (slot !== '0' && slot !== '1') { badRequest(res, 'slot は 0 か 1 を指定してください'); return; }
    if (!room) { badRequest(res, 'room パラメータが必要です'); return; }
    const dir = roomDirs(room)[`library-${slot}`];
    ensureLibDir(dir);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.py'));
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

  // POST /api/upload/music (BGM はグローバル共有)
  if (req.method === 'POST' && url.pathname === '/api/upload/music') {
    fs.mkdirSync(MUSIC_DIR, { recursive: true });
    handleUpload(req, res, MUSIC_DIR, MUSIC_EXTENSIONS, 10 * 1024 * 1024);
    return;
  }

  // GET /api/music → 利用可能な BGM ファイル一覧
  if (req.method === 'GET' && url.pathname === '/api/music') {
    const files = fs.existsSync(MUSIC_DIR)
      ? fs.readdirSync(MUSIC_DIR).filter(f => MUSIC_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      : [];
    json(res, 200, { files });
    return;
  }

  // GET /api/music/:filename → BGM ファイルの再生用ストリーム
  const musicMatch = url.pathname.match(/^\/api\/music\/(.+)$/);
  if (req.method === 'GET' && musicMatch) {
    const filename = sanitizeFilename(decodeURIComponent(musicMatch[1]));
    const filepath = path.join(MUSIC_DIR, filename);
    if (!filename || !fs.existsSync(filepath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filepath).toLowerCase();
    res.writeHead(200, { 'Content-Type': ext === '.wav' ? 'audio/wav' : 'audio/mpeg' });
    fs.createReadStream(filepath).pipe(res);
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

/** アップロードを中断し、残りのリクエストボディを読み捨てる (busboy への書き込みを止めて未捕捉例外を防ぐ) */
function abortUpload(req: IncomingMessage, bb: ReturnType<typeof busboy>, stream: Readable): void {
  stream.resume();
  req.unpipe(bb);
  req.resume();
}

function handleUpload(
  req:      IncomingMessage,
  res:      ServerResponse,
  dir:      string,
  allowed:  string[],
  maxBytes: number,
  onSaved?: (outPath: string, originalFilename: string) => Record<string, unknown> | void,
): void {
  let bb: ReturnType<typeof busboy>;
  try {
    bb = busboy({ headers: req.headers, limits: { fileSize: maxBytes } });
  } catch {
    badRequest(res, 'Content-Type が multipart/form-data ではありません');
    return;
  }

  let fileSeen   = false; // multipart に file パートが存在したか (同期的に確定)
  let serverPath = '';

  bb.on('file', (_field, stream, info) => {
    fileSeen = true;
    const ext = path.extname(info.filename).toLowerCase();
    if (!allowed.includes(ext)) {
      abortUpload(req, bb, stream);
      badRequest(res, `許可されていない拡張子です (${allowed.join(', ')} のみ)`);
      return;
    }

    const safe    = sanitizeFilename(info.filename);
    const outPath = path.join(dir, safe);
    serverPath    = outPath;

    const out = fs.createWriteStream(outPath);
    out.on('error', () => {}); // limit到達によるdestroy()後の書き込み完了コールバックが
                                // 'error' を発火した際に未捕捉例外化するのを防ぐ
    stream.pipe(out);
    stream.on('limit', () => {
      stream.unpipe(out);
      out.destroy();
      fs.unlink(outPath, () => {});
      abortUpload(req, bb, stream);
      json(res, 413, { error: `ファイルサイズが上限 (${maxBytes / 1024}KB) を超えています` });
    });
    out.on('close', () => {
      // ディスク書き込み完了を待ってから成功レスポンスを返す
      // (bb の close は out の close より先に発火しうるため、bb 側では返さない)
      if (!res.headersSent) {
        const extra = onSaved?.(outPath, info.filename);
        json(res, 200, { serverPath, ...(extra ?? {}) });
      }
    });
  });

  bb.on('close', () => {
    if (!fileSeen && !res.headersSent) {
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

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'));
      } catch (e) {
        reject(e as Error);
      }
    });
    req.on('error', reject);
  });
}

function sanitizeFilename(name: string): string {
  return path.basename(name).replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._\-　-鿿]/g, '_');
}

/** ファイルをダウンロード用に配信する (日本語ファイル名対応の Content-Disposition 付き)。onSent は送信完了後に呼ぶ (一時ファイル削除用)。 */
function sendFileDownload(res: ServerResponse, filePath: string, downloadName: string, onSent?: () => void): void {
  const encoded = encodeURIComponent(downloadName);
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="map.map"; filename*=UTF-8''${encoded}`,
  });
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  if (onSent) stream.on('close', onSent);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function badRequest(res: ServerResponse, message: string): void {
  json(res, 400, { error: message });
}
