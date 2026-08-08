import fs from 'node:fs';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { handleUpload, json, requireRoomSlot, withJsonBody } from '../network/httpUtil.js';
import {
  addCatalogEntry,
  catalogDir,
  deleteCatalogEntry,
  ensureCatalogDir,
  listCatalogEntries,
  setDemoEnabled,
} from '../programCatalog.js';
import { roomDirs } from './paths.js';

const PROGRAM_EXTENSIONS = ['.py', '.exe'];
const MAX_PROGRAM_BYTES  = 512 * 1024;

/** 処理したら true。false なら router が後続のルートを試す */
export function handleProgramRequest(
  req: IncomingMessage, res: ServerResponse, url: URL,
): boolean {
  // POST /api/upload/program?slot=0|1&room=<id> → 指定ルーム・スロットへ直接配置する
  if (req.method === 'POST' && url.pathname === '/api/upload/program') {
    const target = requireRoomSlot(url, res);
    if (!target) return true;
    const dir = roomDirs(target.room)[`program-${target.slot}`];
    fs.mkdirSync(dir, { recursive: true });
    handleUpload(req, res, dir, PROGRAM_EXTENSIONS, MAX_PROGRAM_BYTES);
    return true;
  }

  // POST /api/programs → プログラムライブラリへの新規アップロード (room/slot に非依存)
  if (req.method === 'POST' && url.pathname === '/api/programs') {
    ensureCatalogDir();
    handleUpload(req, res, catalogDir(), PROGRAM_EXTENSIONS, MAX_PROGRAM_BYTES, (outPath, originalFilename) => {
      const entry = addCatalogEntry(originalFilename, outPath);
      return { serverPath: entry.programPath, entry };
    });
    return true;
  }

  // GET /api/programs → プログラムライブラリの一覧
  if (req.method === 'GET' && url.pathname === '/api/programs') {
    json(res, 200, { entries: listCatalogEntries() });
    return true;
  }

  const idMatch = url.pathname.match(/^\/api\/programs\/([^/]+)$/);
  if (!idMatch) return false;
  const id = idMatch[1]!;

  // PATCH /api/programs/:id → デモ対象フラグの更新 body: { demoEnabled: boolean }
  if (req.method === 'PATCH') {
    withJsonBody(req, res, (body) => {
      const entry = setDemoEnabled(id, Boolean((body as { demoEnabled?: boolean }).demoEnabled));
      if (!entry) { json(res, 404, { error: 'プログラムが見つかりません' }); return; }
      json(res, 200, { entry });
    });
    return true;
  }

  // DELETE /api/programs/:id → プログラムライブラリからの削除
  if (req.method === 'DELETE') {
    deleteCatalogEntry(id);
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
