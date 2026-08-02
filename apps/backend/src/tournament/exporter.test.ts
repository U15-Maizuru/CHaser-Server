import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Reason, Winner } from '@u15/ws-types';
import { catalogDir, ensureCatalogDir } from '../programCatalog.js';
import { csvCell, matchesCsv, resultJson, standingsCsv, toCsv } from './exporter.js';
import {
  ensureTournamentDir, loadTournament, saveState, tournamentRootDir,
} from './TournamentStore.js';
import { captureResult, confirmResult, setWalkover } from './progress.js';

const ID = 'export-cup';

function writeCup(def: unknown): void {
  const dir = path.join(tournamentRootDir(), ID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tournament.json'), JSON.stringify(def, null, 2));
}

const DEF = {
  id: ID,
  name: 'エクスポート杯',
  format: 'single-elimination',
  rules: { doubleMode: true },
  participants: [
    { id: 'p1', name: '舞鶴A', seed: 1, program: { builtin: 'cpu' } },
    { id: 'p2', name: 'カンマ,を含む名前', seed: 2, program: { builtin: 'cpu' } },
  ],
};

function roundResult(round: 0 | 1, winner: Winner) {
  return {
    round, winner, reason: Reason.ATTACK,
    scores: [5, 3] as [number, number],
    remainingTurns: 40,
    strikeBonus: [50, 0] as [number, number],
    sweepBonus: [12, 0] as [number, number],
    playerNames: ['A', 'B'] as [string, string],
  };
}

describe('CSV の下ごしらえ', () => {
  it('カンマ・引用符・改行を含む値をエスケープする', () => {
    expect(csvCell('ふつう')).toBe('ふつう');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('1行目\n2行目')).toBe('"1行目\n2行目"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(0)).toBe('0');
  });

  it('Excel 対策の BOM を付け、CRLF で改行する', () => {
    const csv = toCsv([['a', 'b'], [1, 2]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('a,b\r\n1,2');
  });
});

describe('エクスポート', () => {
  beforeEach(() => {
    ensureTournamentDir();
    ensureCatalogDir();
    writeCup(DEF);
  });

  afterEach(() => {
    fs.rmSync(tournamentRootDir(), { recursive: true, force: true });
    fs.rmSync(catalogDir(), { recursive: true, force: true });
  });

  it('未実施でもヘッダ行と全試合が出る', () => {
    const csv = matchesCsv(loadTournament(ID)!);
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toContain('試合ID');
    expect(lines[0]).toContain('A合計ポイント');
    expect(lines).toHaveLength(2); // ヘッダ + 決勝1試合
    expect(lines[1]).toContain('FINAL');
  });

  it('チーム名のカンマがエスケープされる', () => {
    const csv = matchesCsv(loadTournament(ID)!);
    expect(csv).toContain('"カンマ,を含む名前"');
  });

  it('確定した試合はゲームごとの内訳まで出る', () => {
    const loaded = loadTournament(ID)!;
    const played = confirmResult(captureResult(loaded.state.matches, 'FINAL', {
      roundResults: [roundResult(0, Winner.COOL), roundResult(1, Winner.HOT)],
      set: { totals: [112, 30], wins: [2, 0], draws: 0, winnerSide: 0, decidedBy: 'wins' },
      decidedBy: 'wins', winnerSide: 0, capturedAt: 1,
    }), 'FINAL', {});
    saveState({ ...loaded.state, matches: played });

    const csv = matchesCsv(loadTournament(ID)!);
    expect(csv).toContain('確定');
    expect(csv).toContain('112');
    expect(csv).toContain('勝利数');
    expect(csv).toContain('アタック');
  });

  it('不戦勝や決着なしも読める形で出る', () => {
    const loaded = loadTournament(ID)!;
    saveState({ ...loaded.state, matches: setWalkover(loaded.state.matches, 'FINAL', null) });

    const csv = matchesCsv(loadTournament(ID)!);
    expect(csv).toContain('不戦勝');
    expect(csv).toContain('決着なし');
  });

  it('リーグの順位表 CSV が出る', () => {
    writeCup({ ...DEF, format: 'league' });
    const csv = standingsCsv(loadTournament(ID)!);
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('順位,チーム,試合数,勝,分,敗,勝ち点,合計ポイント,同順位');
    expect(lines).toHaveLength(3); // ヘッダ + 2人
  });

  it('JSON は定義・試合・順位を含む', () => {
    writeCup({ ...DEF, format: 'league' });
    const obj = JSON.parse(resultJson(loadTournament(ID)!)) as Record<string, unknown>;
    expect(obj['id']).toBe(ID);
    expect(obj['name']).toBe('エクスポート杯');
    expect(obj['participants']).toHaveLength(2);
    expect(Array.isArray(obj['matches'])).toBe(true);
    expect(obj['standings']).not.toBeNull();
    expect(typeof obj['exportedAt']).toBe('string');
  });

  it('トーナメントの JSON では standings が null', () => {
    const obj = JSON.parse(resultJson(loadTournament(ID)!)) as Record<string, unknown>;
    expect(obj['standings']).toBeNull();
  });
});
