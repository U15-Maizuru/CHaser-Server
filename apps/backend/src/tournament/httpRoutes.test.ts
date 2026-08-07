import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TournamentDefinition } from '@u15/ws-types';
import { handleHttpRequest } from '../network/HttpServer.js';
import { addCatalogEntry, catalogDir, ensureCatalogDir } from '../programCatalog.js';
import { ensureTournamentDir, loadTournament, tournamentRootDir } from './TournamentStore.js';

const DEF = {
  name: 'HTTPテスト杯',
  format: 'single-elimination',
  participants: [
    { id: 'p1', name: 'A', seed: 1, program: { builtin: 'cpu' } },
    { id: 'p2', name: 'B', seed: 2, program: { builtin: 'cpu' } },
  ],
};

function writeTournament(id: string, def: unknown): void {
  const dir = path.join(tournamentRootDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tournament.json'), JSON.stringify(def, null, 2));
}

describe('/api/tournament', () => {
  let server: Server;
  let baseUrl: string;
  let bound: string | null = null;

  beforeAll(async () => {
    ensureTournamentDir();
    ensureCatalogDir();
    server = createServer((req, res) =>
      handleHttpRequest(req, res, undefined, { boundRoomOf: id => (bound === id ? 'local' : null) }));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())));
    fs.rmSync(tournamentRootDir(), { recursive: true, force: true });
    fs.rmSync(catalogDir(), { recursive: true, force: true });
  });

  afterEach(() => {
    bound = null;
    fs.rmSync(tournamentRootDir(), { recursive: true, force: true });
    ensureTournamentDir();
  });

  it('GET /api/tournament は空の一覧を返す', async () => {
    const res = await fetch(`${baseUrl}/api/tournament`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: [], errors: [] });
  });

  it('POST /api/tournament/scan がフォルダを検出する', async () => {
    writeTournament('cup-a', DEF);
    const res  = await fetch(`${baseUrl}/api/tournament/scan`, { method: 'POST' });
    const body = await res.json() as { imported: { id: string; name: string }[] };

    expect(res.status).toBe(200);
    expect(body.imported).toHaveLength(1);
    expect(body.imported[0]!.id).toBe('cup-a');
    expect(body.imported[0]!.name).toBe('HTTPテスト杯');
  });

  it('固定セグメント scan が :id より先に判定される', async () => {
    // 'scan' という名前の大会があっても scan が優先される (ルーティング順序の回帰テスト)
    writeTournament('scan', DEF);
    const res = await fetch(`${baseUrl}/api/tournament/scan`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('imported');
  });

  it('POST /api/tournament/import が定義を取り込む', async () => {
    const res = await fetch(`${baseUrl}/api/tournament/import`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...DEF, id: 'imported' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'imported' });
    expect(fs.existsSync(path.join(tournamentRootDir(), 'imported', 'tournament.json'))).toBe(true);
  });

  it('import?reset=1 は上書き時に進行状態を作り直す', async () => {
    // 参加者を変えずに形式だけ変えるケース。loadTournament の噛み合わせ判定は
    // participant id しか見ないので、reset が無いと古い試合グラフが残ってしまう
    writeTournament('cup-a', DEF);
    expect(loadTournament('cup-a')!.state.matches).toHaveLength(1); // 決勝のみ

    const res = await fetch(`${baseUrl}/api/tournament/import?reset=1`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...DEF, id: 'cup-a', format: 'league' }),
    });

    expect(res.status).toBe(200);
    const after = loadTournament('cup-a')!;
    expect(after.def.format).toBe('league');
    expect(after.state.matches[0]!.id).toMatch(/^L-/); // リーグの試合グラフに作り直された
  });

  it('運営中の大会は import で上書きできない (409)', async () => {
    writeTournament('cup-a', DEF);
    bound = 'cup-a';
    const res = await fetch(`${baseUrl}/api/tournament/import`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...DEF, id: 'cup-a', name: '書き換え後' }),
    });

    expect(res.status).toBe(409);
    expect(loadTournament('cup-a')!.def.name).toBe('HTTPテスト杯');
  });

  it('import?from=旧id はフォルダごと改名する (同梱プログラムを連れて行く)', async () => {
    writeTournament('cup-a', {
      ...DEF,
      participants: [
        { id: 'p1', name: 'A', seed: 1, program: { file: 'programs/a.py' } },
        { id: 'p2', name: 'B', seed: 2, program: { builtin: 'cpu' } },
      ],
    });
    const dir = path.join(tournamentRootDir(), 'cup-a', 'programs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.py'), 'print(1)');

    const res = await fetch(`${baseUrl}/api/tournament/import?reset=1&from=cup-a`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        ...DEF, id: 'cup-2027',
        participants: [
          { id: 'p1', name: 'A', seed: 1, program: { file: 'programs/a.py' } },
          { id: 'p2', name: 'B', seed: 2, program: { builtin: 'cpu' } },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(tournamentRootDir(), 'cup-a'))).toBe(false);
    // 同梱プログラムが新しいフォルダに付いてきていること (取り込み直しでは消える)
    expect(fs.existsSync(path.join(tournamentRootDir(), 'cup-2027', 'programs', 'a.py'))).toBe(true);
    expect(loadTournament('cup-2027')!.state.programs.p1).toBeDefined();
  });

  it('import?from= の改名先が既にあれば 409 (どちらも消さない)', async () => {
    writeTournament('cup-a', DEF);
    writeTournament('cup-b', { ...DEF, name: 'ぶつかる方' });

    const res = await fetch(`${baseUrl}/api/tournament/import?reset=1&from=cup-a`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...DEF, id: 'cup-b' }),
    });

    expect(res.status).toBe(409);
    expect(loadTournament('cup-a')).not.toBeNull();
    expect(loadTournament('cup-b')!.def.name).toBe('ぶつかる方');
  });

  it('運営中の大会は import?from= で改名できない (409)', async () => {
    writeTournament('cup-a', DEF);
    bound = 'cup-a';
    const res = await fetch(`${baseUrl}/api/tournament/import?reset=1&from=cup-a`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...DEF, id: 'cup-2027' }),
    });

    expect(res.status).toBe(409);
    expect(loadTournament('cup-a')).not.toBeNull();
    expect(loadTournament('cup-2027')).toBeNull();
  });

  it('不正な定義の import は 400 と理由を返す', async () => {
    const res = await fetch(`${baseUrl}/api/tournament/import`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: 'x', participants: [] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/participants が空/);
  });

  it('GET /api/tournament/:id は状態ペイロードを返す', async () => {
    writeTournament('cup-a', DEF);
    const res  = await fetch(`${baseUrl}/api/tournament/cup-a`);
    const body = await res.json() as { state: { matches: unknown[]; participants: unknown[] } };

    expect(res.status).toBe(200);
    expect(body.state.matches).toHaveLength(1); // 2人 → 決勝のみ
    expect(body.state.participants).toHaveLength(2);
  });

  it('GET /api/tournament/:id は編集元になる定義も返す', async () => {
    // state 側には出ない bracket.slots まで含めて返らないと、作成 UI が編集を復元できない
    writeTournament('cup-a', { ...DEF, bracket: { size: 2, slots: ['p2', 'p1'] } });
    const res  = await fetch(`${baseUrl}/api/tournament/cup-a`);
    const body = await res.json() as { definition: TournamentDefinition };

    expect(res.status).toBe(200);
    expect(body.definition.name).toBe('HTTPテスト杯');
    expect(body.definition.participants).toHaveLength(2);
    expect(body.definition.bracket?.slots).toEqual(['p2', 'p1']);
  });

  it('存在しない大会は 404', async () => {
    const res = await fetch(`${baseUrl}/api/tournament/nope`);
    expect(res.status).toBe(404);
  });

  it('壊れた定義の取得は 400 と理由を返す', async () => {
    writeTournament('broken', { name: 'x', participants: [] });
    const res = await fetch(`${baseUrl}/api/tournament/broken`);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/participants が空/);
  });

  it('POST /api/tournament/:id/reset は進行を初期化する', async () => {
    writeTournament('cup-a', DEF);
    const res = await fetch(`${baseUrl}/api/tournament/cup-a/reset`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('summary');
  });

  it('DELETE /api/tournament/:id は大会を削除する', async () => {
    writeTournament('cup-a', DEF);
    const res = await fetch(`${baseUrl}/api/tournament/cup-a`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(fs.existsSync(path.join(tournamentRootDir(), 'cup-a'))).toBe(false);
  });

  it('運営中の大会は削除できない (409)', async () => {
    writeTournament('cup-a', DEF);
    bound = 'cup-a';
    const res = await fetch(`${baseUrl}/api/tournament/cup-a`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(fs.existsSync(path.join(tournamentRootDir(), 'cup-a'))).toBe(true);
  });

  describe('POST /api/tournament/:id/assign', () => {
    function makeCatalogEntry(displayName: string): string {
      const tmp = path.join(os.tmpdir(), `u15-assign-${Date.now()}-${Math.random()}.py`);
      fs.writeFileSync(tmp, '# test');
      return addCatalogEntry(displayName, tmp).id; // tempPath は rename されて消える
    }

    async function assign(id: string, assignments: Record<string, string | null>) {
      return fetch(`${baseUrl}/api/tournament/${id}/assign`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ assignments }),
      });
    }

    it('ライブラリのプログラムをまとめて紐付ける', async () => {
      writeTournament('cup-a', DEF);
      const catalogId = makeCatalogEntry('提出プログラム');

      const res  = await assign('cup-a', { p1: catalogId });
      const body = await res.json() as { failed: string[] };

      expect(res.status).toBe(200);
      expect(body.failed).toEqual([]);
      expect(loadTournament('cup-a')!.state.programs['p1']?.catalogId).toBe(catalogId);
    });

    it('null を渡すと割り当てを外す', async () => {
      writeTournament('cup-a', DEF);
      await assign('cup-a', { p1: makeCatalogEntry('提出プログラム') });

      const res = await assign('cup-a', { p1: null });
      expect(res.status).toBe(200);
      expect(loadTournament('cup-a')!.state.programs['p1']).toBeUndefined();
    });

    it('存在しない参加者やプログラムは failed で返る', async () => {
      writeTournament('cup-a', DEF);
      const body = await (await assign('cup-a', { nobody: null, p1: 'no-such-program' }))
        .json() as { failed: string[] };
      expect(body.failed.sort()).toEqual(['nobody', 'p1']);
    });

    it('運営中の大会は 409', async () => {
      writeTournament('cup-a', DEF);
      bound = 'cup-a';
      expect((await assign('cup-a', { p1: null })).status).toBe(409);
    });

    it('存在しない大会は 404', async () => {
      expect((await assign('nope', { p1: null })).status).toBe(404);
    });

    it('assignments が無ければ 400', async () => {
      writeTournament('cup-a', DEF);
      const res = await fetch(`${baseUrl}/api/tournament/cup-a/assign`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/tournament/:id/export', () => {
    it('matches.csv がヘッダ行付きで返る', async () => {
      writeTournament('cup-a', DEF);
      const res  = await fetch(`${baseUrl}/api/tournament/cup-a/export?format=matches.csv`);
      const buf  = Buffer.from(await res.arrayBuffer());

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''");
      // Excel 対策の BOM。fetch の text() は仕様上 BOM を落とすので生バイトで確認する
      expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(buf.toString('utf-8')).toContain('試合ID');
    });

    it('format 省略時は JSON', async () => {
      writeTournament('cup-a', DEF);
      const res  = await fetch(`${baseUrl}/api/tournament/cup-a/export`);
      const body = await res.json() as { name: string };
      expect(res.status).toBe(200);
      expect(body.name).toBe('HTTPテスト杯');
    });

    it('standings.csv も返る', async () => {
      writeTournament('cup-a', { ...DEF, format: 'league' });
      const res = await fetch(`${baseUrl}/api/tournament/cup-a/export?format=standings.csv`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('勝ち点');
    });

    it('bundle.zip は取り込み直せる大会データを返す', async () => {
      writeTournament('cup-a', DEF);
      const res = await fetch(`${baseUrl}/api/tournament/cup-a/export?format=bundle.zip`);
      const buf = Buffer.from(await res.arrayBuffer());

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
      expect(decodeURIComponent(res.headers.get('content-disposition') ?? ''))
        .toContain('HTTPテスト杯_大会データ.zip');
      expect(res.headers.get('x-bundle-skipped')).toBe(encodeURIComponent('[]'));
      // ZIP のシグネチャ。中身の検証は bundle.test.ts の往復テストが持つ
      expect(buf.subarray(0, 2).toString()).toBe('PK');
    });

    it('未知の format は 400', async () => {
      writeTournament('cup-a', DEF);
      const res = await fetch(`${baseUrl}/api/tournament/cup-a/export?format=xlsx`);
      expect(res.status).toBe(400);
    });

    it('存在しない大会は 404', async () => {
      const res = await fetch(`${baseUrl}/api/tournament/nope/export`);
      expect(res.status).toBe(404);
    });

    // 「書き出した .zip をアップロードするだけでセットできる」の通し確認。
    // 単体テスト (bundle.test.ts) は importFromZip を直接呼ぶので、multipart の
    // アップロード口を通る経路はここでしか押さえられない
    it('書き出した .zip をアップロードし直すと、プログラムごと復元される', async () => {
      // p2 は「まだ提出されていない」参加者。ライブラリから割り当てたプログラムが
      // .zip に焼き込まれることを見たいので、builtin の DEF は使わない
      writeTournament('cup-a', {
        ...DEF,
        participants: [
          DEF.participants[0],
          { id: 'p2', name: 'B', seed: 2, program: null },
        ],
      });
      const tmp = path.join(os.tmpdir(), `u15-bundle-${Date.now()}.py`);
      fs.writeFileSync(tmp, 'print("B")');
      const catalogId = addCatalogEntry('Bのプログラム', tmp).id;
      await fetch(`${baseUrl}/api/tournament/cup-a/assign`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ assignments: { p2: catalogId } }),
      });

      const zip = await (await fetch(
        `${baseUrl}/api/tournament/cup-a/export?format=bundle.zip`,
      )).arrayBuffer();

      // 会場の PC を模して、大会もライブラリも消してからアップロードする
      fs.rmSync(tournamentRootDir(), { recursive: true, force: true });
      fs.rmSync(catalogDir(), { recursive: true, force: true });
      ensureTournamentDir();
      ensureCatalogDir();

      const fd = new FormData();
      fd.append('file', new Blob([zip]), 'HTTPテスト杯_大会データ.zip');
      const up = await fetch(`${baseUrl}/api/tournament/upload`, { method: 'POST', body: fd });
      const body = await up.json() as { id?: string; error?: string };

      expect(body.error).toBeUndefined();
      expect(body.id).toBe('cup-a');
      expect(loadTournament('cup-a')!.state.programs['p2']).toBeDefined();
    });
  });

  it('一覧には運営中の部屋が反映される', async () => {
    writeTournament('cup-a', DEF);
    bound = 'cup-a';
    const body = await (await fetch(`${baseUrl}/api/tournament`)).json() as
      { imported: { boundRoomId: string | null }[] };
    expect(body.imported[0]!.boundRoomId).toBe('local');
  });
});
