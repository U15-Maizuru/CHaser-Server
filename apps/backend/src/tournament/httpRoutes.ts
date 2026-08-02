import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { badRequest, handleUpload, json, readJsonBody, sendTextDownload } from '../network/httpUtil.js';
import { DefinitionError } from './definition.js';
import { ZipError } from './zip.js';
import { matchesCsv, resultJson, standingsCsv } from './exporter.js';
import {
  assignProgram,
  buildStatePayload,
  deleteTournament,
  ensureTournamentDir,
  importFromJson,
  importFromZip,
  loadTournament,
  resetTournamentState,
  scanTournaments,
  toSummary,
} from './TournamentStore.js';

// /api/tournament/* のルーティング。HttpServer からは1行で委譲される。
//
// 固定セグメント (scan / import) を :id パターンより先に判定すること。
// HttpServer は if 連鎖の素の実装なので、順序を逆にすると id === 'scan' と解釈されてしまう。

export interface TournamentRouteDeps {
  /** その大会がどの部屋で運営中か (紐付いていなければ null) */
  boundRoomOf: (tournamentId: string) => string | null;
}

/** 処理したら true。false なら HttpServer が後続のルートを試す */
export function handleTournamentRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: TournamentRouteDeps,
): boolean {
  if (!url.pathname.startsWith('/api/tournament')) return false;
  ensureTournamentDir();

  // --- 固定セグメント (:id より先に判定する) ---

  // GET /api/tournament → 検出済み大会の一覧
  if (req.method === 'GET' && url.pathname === '/api/tournament') {
    json(res, 200, scanTournaments(deps.boundRoomOf));
    return true;
  }

  // POST /api/tournament/scan → server/tournament/ の再走査
  if (req.method === 'POST' && url.pathname === '/api/tournament/scan') {
    json(res, 200, scanTournaments(deps.boundRoomOf));
    return true;
  }

  // POST /api/tournament/import[?reset=1] → tournament.json の取り込み (body に定義そのもの)
  //
  // reset=1 は「作成 UI からの上書き保存」用。同じ id へ書き戻すとき、参加者が変わって
  // いなければ古い進行状態がそのまま残ってしまう (loadTournament の噛み合わせ判定は
  // participant id しか見ないので、形式やルールだけ変えた場合を検知できない)。
  if (req.method === 'POST' && url.pathname === '/api/tournament/import') {
    readJsonBody(req)
      .then((body) => {
        try {
          const wantId = (body as { id?: unknown }).id;
          if (typeof wantId === 'string' && deps.boundRoomOf(wantId)) {
            json(res, 409, { error: '運営中の大会は上書きできません。先に運営を終了してください' });
            return;
          }

          const result = importFromJson(body);
          if (url.searchParams.get('reset') === '1') {
            const after = resetTournamentState(result.id);
            if (after) {
              json(res, 200, { id: result.id, summary: toSummary(after, null) });
              return;
            }
          }
          json(res, 200, result);
        } catch (e) {
          badRequest(res, e instanceof DefinitionError ? e.message : (e as Error).message);
        }
      })
      .catch(() => badRequest(res, '不正なリクエストボディです'));
    return true;
  }

  // POST /api/tournament/upload → .zip / .json のファイルアップロード
  if (req.method === 'POST' && url.pathname === '/api/tournament/upload') {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'u15-tup-'));
    handleUpload(req, res, staging, ['.zip', '.json'], 20 * 1024 * 1024, (outPath, originalName) => {
      try {
        const base = path.basename(originalName).replace(/\.(zip|json)$/i, '');
        const result = path.extname(outPath).toLowerCase() === '.zip'
          ? importFromZip(fs.readFileSync(outPath), base)
          : importFromJson(JSON.parse(fs.readFileSync(outPath, 'utf-8')), base);
        return { ...result };
      } catch (e) {
        const message = e instanceof DefinitionError || e instanceof ZipError
          ? e.message
          : (e as Error).message;
        return { error: message };
      } finally {
        fs.rmSync(staging, { recursive: true, force: true });
      }
    });
    return true;
  }

  // --- :id を含むルート ---

  const resetMatch = url.pathname.match(/^\/api\/tournament\/([^/]+)\/reset$/);
  if (req.method === 'POST' && resetMatch) {
    withDefinition(res, () => {
      const loaded = resetTournamentState(decodeURIComponent(resetMatch[1]!));
      if (!loaded) { json(res, 404, { error: '大会が見つかりません' }); return; }
      json(res, 200, { summary: toSummary(loaded, deps.boundRoomOf(loaded.def.id)) });
    });
    return true;
  }

  // POST /api/tournament/:id/assign → プログラムライブラリのエントリをまとめて紐付ける
  //
  // catalogId はこの PC のライブラリだけで通用する ID なので、配布物である tournament.json
  // ではなく state.json 側に置く。作成 UI で選んだプログラムはここを通って保存される。
  const assignMatch = url.pathname.match(/^\/api\/tournament\/([^/]+)\/assign$/);
  if (req.method === 'POST' && assignMatch) {
    const id = decodeURIComponent(assignMatch[1]!);
    // 運営中はオーケストレータがメモリ上に進行状態を握っているため、裏から state.json を
    // 書き換えると食い違う。運営パネル (tournament_assign_program) 経由に誘導する
    if (deps.boundRoomOf(id)) {
      json(res, 409, { error: '運営中の大会はここから変更できません。運営パネルで割り当ててください' });
      return true;
    }

    readJsonBody(req)
      .then((body) => {
        withDefinition(res, () => {
          const raw = (body as { assignments?: unknown }).assignments;
          if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            badRequest(res, 'assignments は { 参加者id: プログラムid|null } のオブジェクトです');
            return;
          }

          let loaded = loadTournament(id);
          if (!loaded) { json(res, 404, { error: '大会が見つかりません' }); return; }

          const failed: string[] = [];
          for (const [participantId, catalogId] of Object.entries(raw as Record<string, unknown>)) {
            if (catalogId !== null && typeof catalogId !== 'string') {
              failed.push(participantId);
              continue;
            }
            const next = assignProgram(id, participantId, catalogId);
            if (next) loaded = next;
            else failed.push(participantId);
          }

          json(res, 200, { summary: toSummary(loaded, null), failed });
        });
      })
      .catch(() => badRequest(res, '不正なリクエストボディです'));
    return true;
  }

  // GET /api/tournament/:id/export?format=json|matches.csv|standings.csv
  const exportMatch = url.pathname.match(/^\/api\/tournament\/([^/]+)\/export$/);
  if (req.method === 'GET' && exportMatch) {
    withDefinition(res, () => {
      const id     = decodeURIComponent(exportMatch[1]!);
      const loaded = loadTournament(id);
      if (!loaded) { json(res, 404, { error: '大会が見つかりません' }); return; }

      const format = url.searchParams.get('format') ?? 'json';
      const safe   = loaded.def.name.replace(/[\\/:*?"<>|]/g, '_');

      let body: string;
      let filename: string;
      let mime: string;
      if (format === 'matches.csv') {
        body = matchesCsv(loaded);   filename = `${safe}_試合結果.csv`; mime = 'text/csv; charset=utf-8';
      } else if (format === 'standings.csv') {
        body = standingsCsv(loaded); filename = `${safe}_順位表.csv`;   mime = 'text/csv; charset=utf-8';
      } else if (format === 'json') {
        body = resultJson(loaded);   filename = `${safe}.json`;         mime = 'application/json; charset=utf-8';
      } else {
        badRequest(res, 'format は json / matches.csv / standings.csv のいずれかです');
        return;
      }

      sendTextDownload(res, body, filename, mime);
    });
    return true;
  }

  const idMatch = url.pathname.match(/^\/api\/tournament\/([^/]+)$/);
  if (idMatch) {
    const id = decodeURIComponent(idMatch[1]!);

    if (req.method === 'GET') {
      withDefinition(res, () => {
        const loaded = loadTournament(id);
        if (!loaded) { json(res, 404, { error: '大会が見つかりません' }); return; }
        // bind 前のプレビュー用。boundRoomId は「まだどこにも紐付いていない」ことを示す空文字。
        // definition は作成 UI の編集元 — state 側には出ない bracket.slots や
        // program.file の指定を復元するために必要
        json(res, 200, {
          state:      buildStatePayload(loaded, deps.boundRoomOf(id) ?? '', null),
          definition: loaded.def,
        });
      });
      return true;
    }

    if (req.method === 'DELETE') {
      if (deps.boundRoomOf(id)) {
        json(res, 409, { error: '運営中の大会は削除できません。先に運営を終了してください' });
        return true;
      }
      deleteTournament(id);
      res.writeHead(204);
      res.end();
      return true;
    }
  }

  return false;
}

/** tournament.json の不正 (DefinitionError) は、原因が分かるメッセージのまま 400 で返す */
function withDefinition(res: ServerResponse, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    if (e instanceof DefinitionError) badRequest(res, e.message);
    else json(res, 500, { error: (e as Error).message });
  }
}
