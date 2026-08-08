import fs from 'node:fs';
import path from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { handleUpload, json, sanitizeFilename } from '../network/httpUtil.js';
import { MUSIC_DIR, MUSIC_EXTENSIONS } from './paths.js';

const MAX_MUSIC_BYTES = 10 * 1024 * 1024;

/** 処理したら true。false なら router が後続のルートを試す */
export function handleMusicRequest(
  req: IncomingMessage, res: ServerResponse, url: URL,
): boolean {
  // POST /api/upload/music (BGM はグローバル共有)
  if (req.method === 'POST' && url.pathname === '/api/upload/music') {
    fs.mkdirSync(MUSIC_DIR, { recursive: true });
    handleUpload(req, res, MUSIC_DIR, MUSIC_EXTENSIONS, MAX_MUSIC_BYTES);
    return true;
  }

  // GET /api/music → 利用可能な BGM ファイル一覧
  if (req.method === 'GET' && url.pathname === '/api/music') {
    const files = fs.existsSync(MUSIC_DIR)
      ? fs.readdirSync(MUSIC_DIR).filter(f => MUSIC_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      : [];
    json(res, 200, { files });
    return true;
  }

  // GET /api/music/:filename → BGM ファイルの再生用ストリーム
  const musicMatch = url.pathname.match(/^\/api\/music\/(.+)$/);
  if (req.method === 'GET' && musicMatch) {
    const filename = sanitizeFilename(decodeURIComponent(musicMatch[1]!));
    const filepath = path.join(MUSIC_DIR, filename);
    if (!filename || !fs.existsSync(filepath)) {
      res.writeHead(404);
      res.end('Not found');
      return true;
    }
    const ext = path.extname(filepath).toLowerCase();
    res.writeHead(200, { 'Content-Type': ext === '.wav' ? 'audio/wav' : 'audio/mpeg' });
    fs.createReadStream(filepath).pipe(res);
    return true;
  }

  return false;
}
