import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalogDir, ensureCatalogDir, getCatalogEntry, listCatalogEntries } from '../programCatalog.js';
import { buildZip } from '../test/buildZip.js';
import {
  assignProgram,
  buildStatePayload,
  deleteTournament,
  ensureTournamentDir,
  importFromJson,
  importFromZip,
  loadTournament,
  resetTournamentState,
  resolveParticipants,
  saveState,
  scanTournaments,
  tournamentRootDir,
} from './TournamentStore.js';
import { captureResult, confirmResult } from './progress.js';

const ID = 'test-cup';

function dirOf(id = ID): string {
  return path.join(tournamentRootDir(), id);
}

/** 大会フォルダを作り、tournament.json と programs/*.py を書く */
function writeTournament(def: unknown, programs: Record<string, string> = {}, id = ID): void {
  fs.mkdirSync(path.join(dirOf(id), 'programs'), { recursive: true });
  fs.writeFileSync(path.join(dirOf(id), 'tournament.json'), JSON.stringify(def, null, 2));
  for (const [name, body] of Object.entries(programs)) {
    fs.writeFileSync(path.join(dirOf(id), 'programs', name), body);
  }
}

const DEF_4 = {
  name: '4人トーナメント',
  format: 'single-elimination',
  rules: { doubleMode: true },
  participants: [
    { id: 'p1', name: 'A', seed: 1, program: { file: 'programs/a.py' } },
    { id: 'p2', name: 'B', seed: 2, program: { builtin: 'cpu' } },
    { id: 'p3', name: 'C', seed: 3, program: null },
    { id: 'p4', name: 'D', seed: 4, program: { builtin: 'cpu' } },
  ],
};

describe('TournamentStore', () => {
  beforeEach(() => {
    ensureTournamentDir();
    ensureCatalogDir();
  });

  afterEach(() => {
    fs.rmSync(tournamentRootDir(), { recursive: true, force: true });
    fs.rmSync(catalogDir(), { recursive: true, force: true });
  });

  it('フォルダに置いた大会を読み込み、state.json を作る', () => {
    writeTournament(DEF_4, { 'a.py': 'print(1)' });
    const loaded = loadTournament(ID)!;

    expect(loaded.def.name).toBe('4人トーナメント');
    expect(loaded.state.matches).toHaveLength(3); // SF1 / SF2 / FINAL
    expect(fs.existsSync(path.join(dirOf(), 'state.json'))).toBe(true);
  });

  it('program.file はプログラムライブラリへ登録され、原本は消えない', () => {
    writeTournament(DEF_4, { 'a.py': 'print(1)' });
    const loaded = loadTournament(ID)!;

    // 原本が残っていること (addCatalogEntry の rename 副作用への回帰テスト)
    const original = path.join(dirOf(), 'programs', 'a.py');
    expect(fs.existsSync(original)).toBe(true);
    expect(fs.readFileSync(original, 'utf-8')).toBe('print(1)');

    const link = loaded.state.programs['p1']!;
    expect(link).toBeDefined();
    const entry = getCatalogEntry(link.catalogId)!;
    expect(fs.readFileSync(entry.programPath, 'utf-8')).toBe('print(1)');
  });

  it('大会プログラムはデモモードの抽選対象から外れる', () => {
    writeTournament(DEF_4, { 'a.py': 'print(1)' });
    loadTournament(ID);
    expect(listCatalogEntries().every(e => e.demoEnabled === false)).toBe(true);
  });

  it('再スキャンは冪等 (同じプログラムが二重登録されない)', () => {
    writeTournament(DEF_4, { 'a.py': 'print(1)' });
    loadTournament(ID);
    const first = listCatalogEntries();
    expect(first).toHaveLength(1);

    loadTournament(ID);
    loadTournament(ID);
    expect(listCatalogEntries()).toHaveLength(1);
    expect(listCatalogEntries()[0]!.id).toBe(first[0]!.id);
  });

  it('プログラムの中身が変われば登録し直す', () => {
    writeTournament(DEF_4, { 'a.py': 'print(1)' });
    const before = loadTournament(ID)!.state.programs['p1']!.catalogId;

    fs.writeFileSync(path.join(dirOf(), 'programs', 'a.py'), 'print(2)');
    const after = loadTournament(ID)!.state.programs['p1']!.catalogId;

    expect(after).not.toBe(before);
    expect(fs.readFileSync(getCatalogEntry(after)!.programPath, 'utf-8')).toBe('print(2)');
  });

  it('進行状態は再読み込みしても保たれる', () => {
    writeTournament(DEF_4, { 'a.py': 'print(1)' });
    const loaded = loadTournament(ID)!;

    const played = confirmResult(captureResult(loaded.state.matches, 'SF1', {
      roundResults: [], set: null, decidedBy: 'wins', winnerSide: 0, capturedAt: 1,
    }), 'SF1', {});
    saveState({ ...loaded.state, matches: played });

    const again = loadTournament(ID)!;
    expect(again.state.matches.find(m => m.id === 'SF1')!.status).toBe('done');
    expect(again.state.matches.find(m => m.id === 'FINAL')!.resolvedA).toBe('p1');
  });

  it('state.json が壊れていれば定義から作り直す', () => {
    writeTournament(DEF_4, { 'a.py': 'print(1)' });
    loadTournament(ID);
    fs.writeFileSync(path.join(dirOf(), 'state.json'), '{ これはJSONではない');

    const loaded = loadTournament(ID)!;
    expect(loaded.state.matches).toHaveLength(3);
    expect(loaded.state.matches.every(m => m.status !== 'done')).toBe(true);
  });

  it('定義の参加者が入れ替わったら試合グラフを作り直す', () => {
    writeTournament(DEF_4, { 'a.py': 'print(1)' });
    loadTournament(ID);

    // p1 を別 id に差し替える → 古い state の slot 参照が無効になる
    const changed = {
      ...DEF_4,
      participants: [{ id: 'zz', name: 'Z', seed: 1, program: null }, ...DEF_4.participants.slice(1)],
    };
    writeTournament(changed);

    const loaded = loadTournament(ID)!;
    const ids = new Set(loaded.state.matches.flatMap(m =>
      [m.slotA, m.slotB].filter(r => r.kind === 'participant').map(r => (r as { participantId: string }).participantId)));
    expect(ids.has('p1')).toBe(false);
    expect(ids.has('zz')).toBe(true);
  });

  it('プログラムが見つからなくても読み込みは成功する', () => {
    writeTournament(DEF_4); // a.py を置かない
    const loaded = loadTournament(ID)!;
    expect(loaded.state.programs['p1']).toBeUndefined();
    expect(loaded.state.matches).toHaveLength(3);
  });

  describe('scanTournaments', () => {
    it('複数の大会を検出する', () => {
      writeTournament(DEF_4, {}, 'cup-a');
      writeTournament({ ...DEF_4, name: 'B杯' }, {}, 'cup-b');

      const { imported, errors } = scanTournaments();
      expect(errors).toEqual([]);
      expect(imported.map(s => s.id)).toEqual(['cup-a', 'cup-b']);
      expect(imported[1]!.name).toBe('B杯');
      expect(imported[0]!.participants).toBe(4);
      expect(imported[0]!.progress).toEqual([0, 3]);
    });

    it('壊れた定義はエラーとして返し、他の大会の検出は止めない', () => {
      writeTournament(DEF_4, {}, 'good');
      writeTournament({ name: 'ダメ', participants: [] }, {}, 'bad');

      const { imported, errors } = scanTournaments();
      expect(imported.map(s => s.id)).toEqual(['good']);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.id).toBe('bad');
      expect(errors[0]!.message).toMatch(/participants が空/);
    });

    it('tournament.json の無いフォルダは無視する', () => {
      fs.mkdirSync(path.join(tournamentRootDir(), 'not-a-cup'), { recursive: true });
      expect(scanTournaments().imported).toEqual([]);
    });

    it('boundRoomOf で運営中の部屋を反映する', () => {
      writeTournament(DEF_4, {}, 'cup-a');
      const { imported } = scanTournaments(id => (id === 'cup-a' ? 'local' : null));
      expect(imported[0]!.boundRoomId).toBe('local');
    });
  });

  describe('importFromJson', () => {
    it('定義を取り込んでフォルダを作る', () => {
      const { id, summary } = importFromJson({ ...DEF_4, id: 'imported-cup' });
      expect(id).toBe('imported-cup');
      expect(summary.participants).toBe(4);
      expect(fs.existsSync(path.join(dirOf('imported-cup'), 'tournament.json'))).toBe(true);
    });

    it('不正な定義は例外になる', () => {
      expect(() => importFromJson({ name: 'x', participants: [] })).toThrow(/participants が空/);
    });

    it('フォルダ名に使えない id は弾く', () => {
      expect(() => importFromJson({ ...DEF_4, id: '../evil' })).toThrow(/フォルダ名に使えない/);
    });
  });

  describe('importFromZip', () => {
    it('ルート直下に tournament.json がある zip を取り込む', () => {
      const zip = buildZip([
        { name: 'tournament.json', body: JSON.stringify({ ...DEF_4, id: 'zip-cup' }) },
        { name: 'programs/a.py', body: 'print("zip")' },
      ]);
      const { id } = importFromZip(zip);

      expect(id).toBe('zip-cup');
      expect(fs.readFileSync(path.join(dirOf('zip-cup'), 'programs', 'a.py'), 'utf-8'))
        .toBe('print("zip")');

      const loaded = loadTournament('zip-cup')!;
      expect(loaded.state.programs['p1']).toBeDefined();
    });

    it('フォルダを1階層かぶせた zip も取り込める', () => {
      const zip = buildZip([
        { name: 'my-cup/tournament.json', body: JSON.stringify({ ...DEF_4, id: 'nested-cup' }) },
        { name: 'my-cup/programs/a.py', body: 'print("nested")' },
      ]);
      const { id } = importFromZip(zip);

      expect(id).toBe('nested-cup');
      expect(fs.readFileSync(path.join(dirOf('nested-cup'), 'programs', 'a.py'), 'utf-8'))
        .toBe('print("nested")');
    });

    it('id 省略時はフォルダ名を大会 id にする', () => {
      const def = { ...DEF_4 } as Record<string, unknown>;
      delete def['id'];
      const zip = buildZip([{ name: 'maizuru-cup/tournament.json', body: JSON.stringify(def) }]);
      expect(importFromZip(zip).id).toBe('maizuru-cup');
    });

    it('tournament.json が無ければエラー', () => {
      const zip = buildZip([{ name: 'programs/a.py', body: 'x' }]);
      expect(() => importFromZip(zip)).toThrow(/tournament.json が見つかりません/);
    });

    it('定義が不正なら本番フォルダを作らない', () => {
      const zip = buildZip([
        { name: 'tournament.json', body: JSON.stringify({ name: 'x', participants: [], id: 'broken-cup' }) },
      ]);
      expect(() => importFromZip(zip)).toThrow(/participants が空/);
      expect(fs.existsSync(dirOf('broken-cup'))).toBe(false);
    });

    it('許可外の拡張子は展開されない', () => {
      const zip = buildZip([
        { name: 'tournament.json', body: JSON.stringify({ ...DEF_4, id: 'safe-cup' }) },
        { name: 'evil.exe', body: 'MZ' },
      ]);
      importFromZip(zip);
      expect(fs.existsSync(path.join(dirOf('safe-cup'), 'evil.exe'))).toBe(false);
    });
  });

  it('resetTournamentState は進行だけ消してプログラム登録は残す', () => {
    writeTournament(DEF_4, { 'a.py': 'print(1)' });
    const loaded = loadTournament(ID)!;
    const catalogId = loaded.state.programs['p1']!.catalogId;

    saveState({
      ...loaded.state,
      matches: confirmResult(captureResult(loaded.state.matches, 'SF1', {
        roundResults: [], set: null, decidedBy: 'wins', winnerSide: 0, capturedAt: 1,
      }), 'SF1', {}),
    });

    const reset = resetTournamentState(ID)!;
    expect(reset.state.matches.every(m => m.status !== 'done')).toBe(true);
    expect(reset.state.programs['p1']!.catalogId).toBe(catalogId);
  });

  it('deleteTournament はフォルダごと消す', () => {
    writeTournament(DEF_4);
    deleteTournament(ID);
    expect(fs.existsSync(dirOf())).toBe(false);
  });

  it('パストラバーサルする id は読み書きできない', () => {
    expect(loadTournament('../../etc')).toBeNull();
    expect(loadTournament('a/b')).toBeNull();
  });

  describe('assignProgram', () => {
    it('未提出の参加者にライブラリのエントリを紐付ける', () => {
      writeTournament(DEF_4, { 'a.py': 'print(1)' });
      loadTournament(ID);
      const entry = listCatalogEntries()[0]!;

      const after = assignProgram(ID, 'p3', entry.id)!;
      expect(after.state.programs['p3']!.catalogId).toBe(entry.id);
    });

    it('null を渡すと紐付けを外す', () => {
      writeTournament(DEF_4, { 'a.py': 'print(1)' });
      loadTournament(ID);
      const entry = listCatalogEntries()[0]!;
      assignProgram(ID, 'p3', entry.id);

      const after = assignProgram(ID, 'p3', null)!;
      expect(after.state.programs['p3']).toBeUndefined();
    });

    it('存在しない participant / catalogId は null を返す', () => {
      writeTournament(DEF_4);
      loadTournament(ID);
      expect(assignProgram(ID, 'nope', null)).toBeNull();
      expect(assignProgram(ID, 'p3', 'no-such-entry')).toBeNull();
    });
  });

  describe('resolveParticipants / buildStatePayload', () => {
    it('seed 順に並び、プログラムの紐付け状況が分かる', () => {
      writeTournament(DEF_4, { 'a.py': 'print(1)' });
      const loaded = loadTournament(ID)!;
      const ps = resolveParticipants(loaded);

      expect(ps.map(p => p.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
      expect(ps.map(p => p.seed)).toEqual([1, 2, 3, 4]);
      expect(ps[0]!.programCatalogId).not.toBeNull();
      expect(ps[1]!.builtinCpu).toBe(true);
      expect(ps[1]!.programName).toBe('内蔵CPU');
      expect(ps[2]!.programCatalogId).toBeNull(); // 未提出
      expect(ps[2]!.programName).toBeNull();
    });

    it('トーナメントでは standings は null', () => {
      writeTournament(DEF_4);
      const payload = buildStatePayload(loadTournament(ID)!, 'local', null);
      expect(payload.standings).toBeNull();
      expect(payload.boundRoomId).toBe('local');
      expect(payload.matches).toHaveLength(3);
    });

    it('リーグでは standings が付く', () => {
      writeTournament({ ...DEF_4, format: 'league' });
      const payload = buildStatePayload(loadTournament(ID)!, 'local', null);
      expect(payload.standings).toHaveLength(4);
      expect(payload.matches).toHaveLength(6); // 4人総当たり
    });
  });
});

// ── 予選リーグ + 決勝トーナメント ──────────────────────────────────────────

describe('TournamentStore (予選リーグ + 決勝トーナメント)', () => {
  const GID = 'group-cup';

  /** 8人2リーグ×上位2。決勝トーナメントは準決勝2試合 + 決勝 */
  const DEF_GROUP = {
    name: '予選リーグ大会',
    format: 'group-then-bracket',
    rules: { doubleMode: true, groupCount: 2, advancePerGroup: 2 },
    participants: Array.from({ length: 8 }, (_, i) => ({
      id: `p${i + 1}`, name: `T${i + 1}`, seed: i + 1, program: { builtin: 'cpu' },
    })),
  };

  beforeEach(() => {
    ensureCatalogDir();
    ensureTournamentDir();
    deleteTournament(GID);
  });

  afterEach(() => {
    deleteTournament(GID);
  });

  it('予選と決勝が1本の試合グラフになる', () => {
    writeTournament(DEF_GROUP, {}, GID);
    const loaded = loadTournament(GID)!;

    const groupMatches = loaded.state.matches.filter(m => m.group !== undefined);
    const bracket      = loaded.state.matches.filter(m => m.group === undefined);

    expect(groupMatches).toHaveLength(12);   // 各リーグ4人 = 6試合 × 2
    expect(bracket.map(m => m.id).sort()).toEqual(['FINAL', 'SF1', 'SF2']);
  });

  it('準決勝は予選が終わるまで pending', () => {
    writeTournament(DEF_GROUP, {}, GID);
    const loaded = loadTournament(GID)!;
    expect(loaded.state.matches.find(m => m.id === 'SF1')!.status).toBe('pending');
  });

  it('回戦ごとのマップは決勝トーナメント相対で書き、予選の節には効かない', () => {
    writeTournament({
      ...DEF_GROUP,
      rules: { ...DEF_GROUP.rules, stageMaps: ['sf-map', 'final-map'] },
    }, {}, GID);
    const loaded = loadTournament(GID)!;
    const payload = buildStatePayload(loaded, 'room', null);

    // 予選3節 + 決勝T2回戦。予選ぶんは常に null になる
    expect(payload.stageMaps).toEqual([null, null, null, 'sf-map', 'final-map']);
  });

  it('stage ごとの表示名を配信する (UI が節数を数え直さなくてよい)', () => {
    writeTournament(DEF_GROUP, {}, GID);
    const payload = buildStatePayload(loadTournament(GID)!, 'room', null);
    expect(payload.stageLabels).toEqual([
      '予選 第1節', '予選 第2節', '予選 第3節', '準決勝', '決勝',
    ]);
  });

  it('リーグごとの順位表と決勝進出枠を配信する', () => {
    writeTournament(DEF_GROUP, {}, GID);
    const payload = buildStatePayload(loadTournament(GID)!, 'room', null);

    expect(payload.groups!.map(g => g.label)).toEqual(['A', 'B']);
    expect(payload.groups!.map(g => g.participantIds.length)).toEqual([4, 4]);
    expect(payload.qualifiers!).toHaveLength(4);
    expect(payload.qualifiers!.every(q => q.pending)).toBe(true);
    // 予選を持たない形式の口 (standings) は使わない
    expect(payload.standings).toBeNull();
  });

  it('リーグ分けを変えると進行状態を作り直す', () => {
    writeTournament(DEF_GROUP, {}, GID);
    const before = loadTournament(GID)!;
    const target = before.state.matches.find(m => m.group === 0)!;
    saveState({
      ...before.state,
      matches: captureResult(before.state.matches, target.id, {
        roundResults: [], set: null, decidedBy: 'walkover', winnerSide: 0, capturedAt: 1,
      }),
    });

    // p2 を A リーグへ移す
    writeTournament({
      ...DEF_GROUP,
      participants: DEF_GROUP.participants.map(p => (p.id === 'p2' ? { ...p, group: 0 } : p)),
    }, {}, GID);

    const after = loadTournament(GID)!;
    expect(after.state.matches.every(m => !m.result)).toBe(true);
  });

  it('存在しない人を指した手動指定は読み込み時に捨てる', () => {
    writeTournament(DEF_GROUP, {}, GID);
    const loaded = loadTournament(GID)!;
    saveState({
      ...loaded.state,
      qualifierOverrides: { '0:1': 'nobody', '0:2': 'p1' },
    });

    const after = loadTournament(GID)!;
    expect(after.state.qualifierOverrides).toEqual({ '0:2': 'p1' });
  });
});

// ── 既存2形式の退行チェック ────────────────────────────────────────────────

describe('TournamentStore (既存形式に影響していないこと)', () => {
  beforeEach(() => {
    ensureCatalogDir();
    ensureTournamentDir();
    deleteTournament(ID);
  });
  afterEach(() => deleteTournament(ID));

  it('format 未指定はトーナメントのままで、予選の設定は試合グラフに現れない', () => {
    writeTournament({ ...DEF_4, format: undefined });
    const loaded = loadTournament(ID)!;

    expect(loaded.def.format).toBe('single-elimination');
    expect(loaded.state.matches.every(m => m.group === undefined)).toBe(true);
    expect(loaded.state.matches.some(m => m.slotA.kind === 'group-rank')).toBe(false);
  });

  it('トーナメントの回戦ごとのマップはゲタ無しで解決される', () => {
    writeTournament({ ...DEF_4, rules: { stageMaps: ['sf', 'final'] } });
    const payload = buildStatePayload(loadTournament(ID)!, 'room', null);

    expect(payload.stageMaps).toEqual(['sf', 'final']);
    expect(payload.stageLabels).toEqual(['準決勝', '決勝']);
    expect(payload.groups).toBeNull();
    expect(payload.qualifiers).toBeNull();
  });

  it('リーグは従来どおり standings を配信し、groups は使わない', () => {
    writeTournament({ ...DEF_4, format: 'league' });
    const payload = buildStatePayload(loadTournament(ID)!, 'room', null);

    expect(payload.standings).not.toBeNull();
    expect(payload.groups).toBeNull();
    expect(payload.stageLabels.every(l => !l.startsWith('予選'))).toBe(true);
  });
});
