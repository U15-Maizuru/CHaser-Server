import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasThirdPlaceMatch } from '@u15/ws-types';
import { addCatalogEntry, catalogDir, ensureCatalogDir, getCatalogEntry } from '../programCatalog.js';
import { readZip } from './zip.js';
import { buildTournamentBundle } from './bundle.js';
import {
  assignProgram,
  deleteTournament,
  ensureTournamentDir,
  importFromZip,
  loadTournament,
  scanTournaments,
  tournamentRootDir,
} from './TournamentStore.js';

const ID = 'bundle-cup';

function dirOf(id = ID): string {
  return path.join(tournamentRootDir(), id);
}

function writeTournament(def: unknown, programs: Record<string, string> = {}): void {
  fs.mkdirSync(path.join(dirOf(), 'programs'), { recursive: true });
  fs.writeFileSync(path.join(dirOf(), 'tournament.json'), JSON.stringify(def, null, 2));
  for (const [name, body] of Object.entries(programs)) {
    fs.writeFileSync(path.join(dirOf(), 'programs', name), body);
  }
}

/** ライブラリにプログラムを登録する (addCatalogEntry は渡した一時ファイルを rename する) */
function addProgram(displayName: string, filename: string, body: string): string {
  const tmp = path.join(os.tmpdir(), `u15-bundle-test-${Date.now()}-${filename}`);
  fs.writeFileSync(tmp, body);
  return addCatalogEntry(displayName, tmp).id;
}

const DEF = {
  id: ID,
  name: '書き出し杯',
  format: 'single-elimination',
  match: { doubleMode: true },
  stage: { thirdPlaceMatch: true },
  participants: [
    { id: 'p1', name: 'ファイル指定', seed: 1, program: { file: 'programs/a.py' } },
    { id: 'p2', name: '組み込みCPU',  seed: 2, program: { builtin: 'cpu' } },
    { id: 'p3', name: '割り当て済み', seed: 3, program: null },
    { id: 'p4', name: '未登録',       seed: 4, program: null },
  ],
};

function entryNames(zip: Buffer): string[] {
  return readZip(zip).map(e => e.name).sort();
}

describe('buildTournamentBundle', () => {
  beforeEach(() => {
    ensureTournamentDir();
    ensureCatalogDir();
  });

  afterEach(() => {
    fs.rmSync(tournamentRootDir(), { recursive: true, force: true });
    fs.rmSync(catalogDir(), { recursive: true, force: true });
  });

  it('定義とプログラムを1つの .zip にまとめる (state.json は入れない)', () => {
    writeTournament(DEF, { 'a.py': 'print("A")' });
    assignProgram(ID, 'p3', addProgram('Cのプログラム', 'c.py', 'print("C")'));

    const { zip, skipped } = buildTournamentBundle(loadTournament(ID)!);

    expect(entryNames(zip)).toEqual(['programs/p1.py', 'programs/p3.py', 'tournament.json']);
    expect(skipped).toEqual([]);
  });

  it('ライブラリから割り当てただけのプログラムも program.file にして同梱する', () => {
    writeTournament(DEF, { 'a.py': 'print("A")' });
    assignProgram(ID, 'p3', addProgram('Cのプログラム', 'c.py', 'print("C")'));

    const { zip } = buildTournamentBundle(loadTournament(ID)!);
    const entries = readZip(zip);
    const def = JSON.parse(
      entries.find(e => e.name === 'tournament.json')!.data.toString('utf-8'),
    ) as typeof DEF;

    expect(def.participants.map(p => p.program)).toEqual([
      { kind: 'file', file: 'programs/p1.py' },
      { kind: 'builtin', builtin: 'cpu' },
      { kind: 'file', file: 'programs/p3.py', displayName: 'Cのプログラム' },
      null,
    ]);
    expect(entries.find(e => e.name === 'programs/p3.py')!.data.toString('utf-8')).toBe('print("C")');
  });

  it('.exe のプログラムは同梱せず、理由を返す', () => {
    writeTournament(DEF, { 'a.py': 'print("A")' });
    assignProgram(ID, 'p3', addProgram('EXEの人', 'c.exe', 'MZ'));

    const { zip, skipped } = buildTournamentBundle(loadTournament(ID)!);

    expect(entryNames(zip)).toEqual(['programs/p1.py', 'tournament.json']);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain('割り当て済み');
    expect(skipped[0]).toContain('.exe');
  });

  it('大きすぎるプログラムは同梱しない (自分の取り込みが弾く .zip を作らない)', () => {
    writeTournament(DEF, { 'a.py': 'x'.repeat(600 * 1024) });

    const { zip, skipped } = buildTournamentBundle(loadTournament(ID)!);

    expect(entryNames(zip)).toEqual(['tournament.json']);
    expect(skipped[0]).toContain('大きすぎます');
  });

  it('参加者 id にファイル名へ使えない文字があっても展開できる名前にする', () => {
    writeTournament({
      ...DEF,
      participants: [
        { id: '舞鶴', name: 'A', seed: 1, program: { file: 'programs/a.py' } },
        { id: 'A/1',  name: 'B', seed: 2, program: { file: 'programs/b.py' } },
        { id: 'A#1',  name: 'C', seed: 3, program: { file: 'programs/c.py' } },
      ],
    }, { 'a.py': 'print("A")', 'b.py': 'print("B")', 'c.py': 'print("C")' });

    const { zip } = buildTournamentBundle(loadTournament(ID)!);
    // 全消えなら参加者番号、衝突したら連番を足す
    expect(entryNames(zip)).toEqual(
      ['programs/p1.py', 'programs/A1.py', 'programs/A1-2.py', 'tournament.json'].sort(),
    );
  });

  it('書き出した .zip をそのまま取り込めば、同じ大会がプログラムごと復元される', () => {
    writeTournament(DEF, { 'a.py': 'print("A")' });
    assignProgram(ID, 'p3', addProgram('Cのプログラム', 'c.py', 'print("C")'));

    const { zip } = buildTournamentBundle(loadTournament(ID)!);

    // 別の PC を模して、大会もライブラリも消してから取り込む
    deleteTournament(ID);
    fs.rmSync(catalogDir(), { recursive: true, force: true });
    ensureCatalogDir();

    const result = importFromZip(zip);
    expect(result.id).toBe(ID);
    expect(scanTournaments().errors).toEqual([]);

    const loaded = loadTournament(ID)!;
    expect(loaded.def.name).toBe('書き出し杯');
    expect(hasThirdPlaceMatch(loaded.def.stage)).toBe(true);

    // プログラムが実体ごと復元され、そのまま運営できる状態になっていること
    expect(Object.keys(loaded.state.programs).sort()).toEqual(['p1', 'p3']);
    const p3 = getCatalogEntry(loaded.state.programs['p3']!.catalogId)!;
    expect(p3.displayName).toBe('Cのプログラム');
    expect(fs.readFileSync(p3.programPath, 'utf-8')).toBe('print("C")');
  });
});
