import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import type { InlineMapData, MapParams } from '@u15/ws-types';
import { DEFAULT_MAP_PARAMS } from '@u15/ws-types';
import {
  badRequest, handleUpload, json, sanitizeFilename, sendFileDownload, withJsonBody,
} from '../network/httpUtil.js';
import { createRandomMap, exportMap } from '../game/GameSystem.js';
import { toGameMap, toInlineData } from '../game/inlineMap.js';
import {
  addMapCatalogEntry,
  addMapCatalogEntryFromInline,
  deleteMapCatalogEntry,
  ensureMapCatalogDir,
  getMapCatalogEntry,
  listMapCatalogEntries,
  mapCatalogDir,
} from '../mapCatalog.js';
import type { RoomManager } from '../RoomManager.js';

const MAX_MAP_BYTES = 1024 * 1024;

/**
 * 処理したら true。false なら router が後続のルートを試す。
 *
 * `/api/maps/current` のような固定パスを `/api/maps/:id` より先に判定すること
 * (順序を逆にすると id === 'current' と解釈されてしまう)。
 */
export function handleMapRequest(
  req: IncomingMessage, res: ServerResponse, url: URL, rm?: RoomManager,
): boolean {
  // POST /api/maps → マップライブラリへの新規アップロード (room/slot に非依存、グローバル共有)
  if (req.method === 'POST' && url.pathname === '/api/maps') {
    ensureMapCatalogDir();
    handleUpload(req, res, mapCatalogDir(), ['.map'], MAX_MAP_BYTES, (outPath, originalFilename) => {
      const displayName = originalFilename.replace(/\.map$/i, '');
      const entry = addMapCatalogEntry(displayName, outPath);
      if (!entry) return { error: '.map ファイルとして解析できませんでした' };
      return { serverPath: entry.mapPath, entry };
    });
    return true;
  }

  // GET /api/maps → マップライブラリの一覧
  if (req.method === 'GET' && url.pathname === '/api/maps') {
    json(res, 200, { entries: listMapCatalogEntries() });
    return true;
  }

  // GET /api/maps/current?room=<id> → 指定ルームの現在のマップ (エディタ起点・現在マップ表示用)
  if (req.method === 'GET' && url.pathname === '/api/maps/current') {
    const room = url.searchParams.get('room');
    const r    = room ? rm?.getRoom(room) : undefined;
    if (!r) { json(res, 404, { error: 'ルームが見つかりません' }); return true; }
    json(res, 200, { data: r.manager.getCurrentMapData() });
    return true;
  }

  // POST /api/maps/random → ステートレスなランダムマップ生成 (どのルームにも影響しない)
  if (req.method === 'POST' && url.pathname === '/api/maps/random') {
    withJsonBody(req, res, (body) => {
      const p = body as Partial<MapParams>;
      const map = createRandomMap(
        p.size,
        p.blockNum ?? DEFAULT_MAP_PARAMS.blockNum,
        p.itemNum  ?? DEFAULT_MAP_PARAMS.itemNum,
        p.turnNum  ?? DEFAULT_MAP_PARAMS.turnNum,
        p.mirror   ?? DEFAULT_MAP_PARAMS.mirror,
      );
      json(res, 200, { data: toInlineData(map) });
    });
    return true;
  }

  // POST /api/maps/save-inline → マップエディタで組んだマップをライブラリへ保存
  // body: { displayName, data: InlineMapData }
  if (req.method === 'POST' && url.pathname === '/api/maps/save-inline') {
    ensureMapCatalogDir();
    withJsonBody(req, res, (body) => {
      const { displayName, data } = body as { displayName?: string; data?: InlineMapData };
      if (!displayName || !data) { badRequest(res, 'displayName と data が必要です'); return; }
      json(res, 200, { entry: addMapCatalogEntryFromInline(displayName, data) });
    });
    return true;
  }

  // POST /api/maps/export → マップエディタの内容をライブラリに残さずそのままダウンロード
  // body: { displayName, data: InlineMapData }
  if (req.method === 'POST' && url.pathname === '/api/maps/export') {
    withJsonBody(req, res, (body) => {
      const { displayName, data } = body as { displayName?: string; data?: InlineMapData };
      if (!displayName || !data) { badRequest(res, 'displayName と data が必要です'); return; }

      const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'u15-map-export-'));
      const tmpPath = path.join(tmpDir, `${sanitizeFilename(displayName)}.map`);
      exportMap(toGameMap(data, displayName), tmpPath);

      sendFileDownload(res, tmpPath, `${displayName}.map`, () => {
        fs.rm(tmpDir, { recursive: true, force: true }, () => {});
      });
    });
    return true;
  }

  // GET /api/maps/:id/download → ライブラリ内のマップをそのままダウンロード
  const downloadMatch = url.pathname.match(/^\/api\/maps\/([^/]+)\/download$/);
  if (req.method === 'GET' && downloadMatch) {
    const entry = getMapCatalogEntry(downloadMatch[1]!);
    if (!entry || !fs.existsSync(entry.mapPath)) { json(res, 404, { error: 'マップが見つかりません' }); return true; }
    sendFileDownload(res, entry.mapPath, `${entry.displayName}.map`);
    return true;
  }

  // DELETE /api/maps/:id → マップライブラリからの削除
  const idMatch = url.pathname.match(/^\/api\/maps\/([^/]+)$/);
  if (req.method === 'DELETE' && idMatch) {
    deleteMapCatalogEntry(idMatch[1]!);
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
