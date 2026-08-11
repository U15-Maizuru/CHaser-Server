import fs from 'node:fs';
import path from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { json, sanitizeFilename } from '../network/httpUtil.js';
import { SOUND_DIR, SOUND_EXTENSIONS } from './paths.js';

// SE の差し替えファイルの一覧と配信。SE 本体はフロントエンドに同梱されており、
// ここに同じ名前で置かれたものがそれより優先される。
//
// BGM (music.ts) と違いアップロード口は持たない。場面ごとに名前が決まっていて選ぶ余地が
// なく、利用者は SOUND_DIR へ直接置くため。

/** 処理したら true。false なら router が後続のルートを試す */
export function handleSoundRequest(
  req: IncomingMessage, res: ServerResponse, url: URL,
): boolean {
  // GET /api/sounds → 差し替えファイルの一覧。載っていない音は同梱分が鳴る
  if (req.method === 'GET' && url.pathname === '/api/sounds') {
    const files = fs.existsSync(SOUND_DIR)
      ? fs.readdirSync(SOUND_DIR).filter(f => SOUND_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      : [];
    json(res, 200, { files });
    return true;
  }

  // GET /api/sounds/:filename → SE の再生用ストリーム
  const soundMatch = url.pathname.match(/^\/api\/sounds\/(.+)$/);
  if (req.method === 'GET' && soundMatch) {
    const filename = sanitizeFilename(decodeURIComponent(soundMatch[1]!));
    const filepath = path.join(SOUND_DIR, filename);
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
