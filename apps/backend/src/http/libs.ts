import fs from 'node:fs';
import path from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { badRequest, handleUpload, json, requireRoomSlot, sanitizeFilename } from '../network/httpUtil.js';
import { ensureLibDir } from '../libTemplates.js';
import { roomDirs } from './paths.js';

const MAX_LIB_BYTES = 512 * 1024;

/** 処理したら true。false なら router が後続のルートを試す */
export function handleLibRequest(
  req: IncomingMessage, res: ServerResponse, url: URL,
): boolean {
  // POST /api/upload/library?slot=0|1&room=<id>
  if (req.method === 'POST' && url.pathname === '/api/upload/library') {
    const target = requireRoomSlot(url, res);
    if (!target) return true;
    const dir = roomDirs(target.room)[`library-${target.slot}`];
    ensureLibDir(dir);
    handleUpload(req, res, dir, ['.py'], MAX_LIB_BYTES);
    return true;
  }

  // GET /api/libs?slot=0|1&room=<id>
  if (req.method === 'GET' && url.pathname === '/api/libs') {
    const target = requireRoomSlot(url, res);
    if (!target) return true;
    const dir = roomDirs(target.room)[`library-${target.slot}`];
    ensureLibDir(dir);
    json(res, 200, { files: fs.readdirSync(dir).filter(f => f.endsWith('.py')) });
    return true;
  }

  // DELETE /api/libs/:filename?slot=0|1&room=<id>
  const libMatch = url.pathname.match(/^\/api\/libs\/(.+)$/);
  if (req.method === 'DELETE' && libMatch) {
    const target = requireRoomSlot(url, res);
    if (!target) return true;
    const filename = sanitizeFilename(decodeURIComponent(libMatch[1]!));
    if (!filename) { badRequest(res, '無効なファイル名'); return true; }
    const filepath = path.join(roomDirs(target.room)[`library-${target.slot}`], filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
