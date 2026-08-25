import fs from 'node:fs';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { json } from '../network/httpUtil.js';
import { handleTournamentRequest, type TournamentRouteDeps } from '../tournament/httpRoutes.js';
import type { RoomManager } from '../RoomManager.js';
import { ensureCatalogDir } from '../programCatalog.js';
import { ensureMapCatalogDir, seedDefaultMapLibrary } from '../mapCatalog.js';
import { MUSIC_DIR, SOUND_DIR } from './paths.js';
import { handleProgramRequest } from './programs.js';
import { handleMapRequest } from './maps.js';
import { handleLibRequest } from './libs.js';
import { handleMusicRequest } from './music.js';
import { handleSoundRequest } from './sounds.js';
import { FRONTEND_DIST, serveStatic } from './static.js';

// HTTP のルーティング。実体の処理はリソースごとのモジュールにあり、ここは
// 「どのモジュールに渡すか」だけを決める。
//
// 各ハンドラは処理したら true を返す (大会運営の httpRoutes と同じ約束)。
// 素の if 連鎖だった頃はルートを足すたびにこのファイルが伸び、ゲームドメインの処理
// (ランダムマップ生成) まで紛れ込んでいた。

export function ensureDirectories(): void {
  // 音源の置き場は空でも作る。利用者がここへ入れると分かるようにするため
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  fs.mkdirSync(SOUND_DIR, { recursive: true });
  ensureCatalogDir();
  ensureMapCatalogDir();
  seedDefaultMapLibrary();
}

export function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rm?: RoomManager,
  tournamentDeps?: TournamentRouteDeps,
): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  // /api/tournament/* は大会運営モジュールへ委譲する
  if (handleTournamentRequest(req, res, url, tournamentDeps ?? { boundRoomOf: () => null })) return;

  if (handleDefaultRoomRequest(req, res, url, rm))  return;
  if (handleDisplayPrefsRequest(req, res, url, rm)) return;
  if (handleProgramRequest(req, res, url))          return;
  if (handleMapRequest(req, res, url, rm))          return;
  if (handleLibRequest(req, res, url))              return;
  if (handleMusicRequest(req, res, url))            return;
  if (handleSoundRequest(req, res, url))            return;

  // 本番: フロントエンド静的ファイル配信 (SPA フォールバック付き)
  if (FRONTEND_DIST && req.method === 'GET') {
    serveStatic(req, res, FRONTEND_DIST);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

/** GET /api/default-room → ローカルモードで Electron が roomId を取得するエンドポイント */
function handleDefaultRoomRequest(
  req: IncomingMessage, res: ServerResponse, url: URL, rm?: RoomManager,
): boolean {
  if (req.method !== 'GET' || url.pathname !== '/api/default-room') return false;

  const localRoom = rm?.getRoom('local');
  if (localRoom) {
    json(res, 200, { roomId: 'local', ports: localRoom.ports });
  } else {
    json(res, 404, { error: 'ローカルルームが見つかりません' });
  }
  return true;
}

/**
 * GET /api/display-prefs?room=<id> → 指定ルームの表示設定。
 *
 * 今はテーマ (盤面テクスチャ) だけを返す。マップ管理から開く独立ウィンドウのマップエディタは
 * room の WS 接続を持たない (対戦設定と無関係にするため) ので、対戦設定で選んだテーマを
 * HTTP で一度だけ取りに行く。
 */
function handleDisplayPrefsRequest(
  req: IncomingMessage, res: ServerResponse, url: URL, rm?: RoomManager,
): boolean {
  if (req.method !== 'GET' || url.pathname !== '/api/display-prefs') return false;

  const room = url.searchParams.get('room');
  const r    = room ? rm?.getRoom(room) : undefined;
  if (!r) { json(res, 404, { error: 'ルームが見つかりません' }); return true; }
  json(res, 200, { theme: r.manager.getStatus().displayPrefs.theme });
  return true;
}
