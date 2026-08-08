import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  badRequest,
  handleUpload,
  json,
  readJsonBody,
  sanitizeFilename,
  sendFileDownload,
} from './httpUtil.js';
import { handleTournamentRequest, type TournamentRouteDeps } from '../tournament/httpRoutes.js';
import type { InlineMapData, MapParams } from '@u15/ws-types';
import { DEFAULT_MAP_PARAMS } from '@u15/ws-types';
import type { RoomManager } from '../RoomManager.js';
import { ensureLibDir } from '../libTemplates.js';
import { createRandomMap, exportMap } from '../game/GameSystem.js';
import { toGameMap, toInlineData } from '../game/inlineMap.js';
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
  tournamentDeps?: TournamentRouteDeps,
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

  // /api/tournament/* は大会運営モジュールへ委譲する
  if (handleTournamentRequest(req, res, url, tournamentDeps ?? { boundRoomOf: () => null })) return;

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
        const map = createRandomMap(
          p.size,
          p.blockNum ?? DEFAULT_MAP_PARAMS.blockNum,
          p.itemNum  ?? DEFAULT_MAP_PARAMS.itemNum,
          p.turnNum  ?? DEFAULT_MAP_PARAMS.turnNum,
          p.mirror   ?? DEFAULT_MAP_PARAMS.mirror,
        );
        json(res, 200, { data: toInlineData(map) });
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
        exportMap(toGameMap(data, displayName), tmpPath);

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
