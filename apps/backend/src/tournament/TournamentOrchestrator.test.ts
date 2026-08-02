import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TournamentStatePayload, WsMessage } from '@u15/ws-types';
import { RoomManager } from '../RoomManager.js';
import { catalogDir, ensureCatalogDir } from '../programCatalog.js';
import { TournamentError, TournamentOrchestrator } from './TournamentOrchestrator.js';
import { ensureTournamentDir, loadTournament, tournamentRootDir } from './TournamentStore.js';

const ROOM  = 'test-orch';
const CUP   = 'orch-cup';
const PORTS: [number, number] = [39501, 39502];

/** 全員 内蔵CPU の大会 (Python 不要で最後まで回せる) */
function cupDef(overrides: Record<string, unknown> = {}) {
  return {
    id: CUP,
    name: 'オーケストレータ杯',
    format: 'single-elimination',
    rules: { doubleMode: false },
    participants: [
      { id: 'p1', name: 'A', seed: 1, program: { builtin: 'cpu' } },
      { id: 'p2', name: 'B', seed: 2, program: { builtin: 'cpu' } },
      { id: 'p3', name: 'C', seed: 3, program: { builtin: 'cpu' } },
      { id: 'p4', name: 'D', seed: 4, program: { builtin: 'cpu' } },
    ],
    ...overrides,
  };
}

function writeCup(def: unknown, id = CUP): void {
  const dir = path.join(tournamentRootDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tournament.json'), JSON.stringify(def, null, 2));
}

describe('TournamentOrchestrator', () => {
  let rm: RoomManager;
  let orch: TournamentOrchestrator;
  let sent: { roomId: string; msg: WsMessage }[];

  const lastState = (): TournamentStatePayload | null => {
    for (let i = sent.length - 1; i >= 0; i--) {
      const m = sent[i]!.msg;
      if (m.type === 'tournament_state') return m.payload;
    }
    return null;
  };
  const matchOf = (id: string) => lastState()!.matches.find(m => m.id === id)!;

  beforeEach(() => {
    ensureTournamentDir();
    ensureCatalogDir();
    sent = [];
    rm   = new RoomManager();
    rm.createRoom(ROOM, PORTS);
    // CPU 同士の対戦を現実的な時間で終わらせる (既定の 500ms/ターン では1ゲーム50秒超)
    rm.getRoom(ROOM)!.manager.setTurnDelay(0);
    orch = new TournamentOrchestrator({
      rm,
      broadcast: (roomId, msg) => sent.push({ roomId, msg }),
    });
  });

  afterEach(() => {
    orch.shutdown();
    rm.shutdown();
    fs.rmSync(tournamentRootDir(), { recursive: true, force: true });
    fs.rmSync(catalogDir(), { recursive: true, force: true });
  });

  describe('bind / unbind', () => {
    it('bind すると状態が配信される', () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);

      const st = lastState()!;
      expect(st.tournamentId).toBe(CUP);
      expect(st.boundRoomId).toBe(ROOM);
      expect(st.matches).toHaveLength(3);
      expect(orch.boundRoomOf(CUP)).toBe(ROOM);
    });

    it('bind するとデモ・リピートが強制的に切られる', () => {
      writeCup(cupDef());
      const manager = rm.getRoom(ROOM)!.manager;
      manager.setDemoMode(true);
      manager.setRepeatMode(true);

      orch.bind(ROOM, CUP);
      expect(manager.getStatus().demoMode).toBe(false);
      expect(manager.getStatus().repeatMode).toBe(false);
    });

    it('デモが後から有効化されても打ち消す (自己修復)', () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      const manager = rm.getRoom(ROOM)!.manager;

      manager.setDemoMode(true);
      expect(manager.getStatus().demoMode).toBe(false);
    });

    it('同じ部屋に別の大会は bind できない', () => {
      writeCup(cupDef());
      writeCup(cupDef({ id: 'other' }), 'other');
      orch.bind(ROOM, CUP);
      expect(() => orch.bind(ROOM, 'other')).toThrow(TournamentError);
    });

    it('同じ大会を別の部屋に bind できない', () => {
      writeCup(cupDef());
      rm.createRoom('room-2', [39503, 39504]);
      orch.bind(ROOM, CUP);
      expect(() => orch.bind('room-2', CUP)).toThrow(/別の部屋/);
    });

    it('同じ組み合わせの bind は冪等', () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      expect(() => orch.bind(ROOM, CUP)).not.toThrow();
    });

    it('unbind で紐付けが外れ、null が配信される', () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      orch.unbind(ROOM);
      expect(lastState()).toBeNull();
      expect(orch.boundRoomOf(CUP)).toBeNull();
    });

    it('存在しない大会の bind はエラー', () => {
      expect(() => orch.bind(ROOM, 'nope')).toThrow(/大会が見つかりません/);
    });

    it('join したウィンドウへリプレイする状態を返す', () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      const msgs = orch.joinMessagesFor(ROOM);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]!.type).toBe('tournament_state');
      expect((msgs[0]!.payload as TournamentStatePayload).tournamentId).toBe(CUP);
    });
  });

  describe('armMatch', () => {
    it('スロットへ自動割り当てし、開始できる状態にする', async () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      await orch.armMatch(ROOM, 'SF1');

      const status = rm.getRoom(ROOM)!.manager.getStatus();
      expect(status.clients[0]!.type).toBe('cpu');
      expect(status.clients[1]!.type).toBe('cpu');
      expect(status.clients[0]!.state).toBe('ready');
      expect(status.clients[1]!.state).toBe('ready');
      expect(matchOf('SF1').status).toBe('armed');
      expect(lastState()!.armedMatchId).toBe('SF1');
    });

    it('2ゲーム制の大会では doubleMode が ON になる', async () => {
      writeCup(cupDef({ rules: { doubleMode: true } }));
      orch.bind(ROOM, CUP);
      await orch.armMatch(ROOM, 'SF1');
      expect(rm.getRoom(ROOM)!.manager.getStatus().doubleMode).toBe(true);
    });

    it('reset → setDoubleMode → setClientType の順で呼ぶ', async () => {
      writeCup(cupDef({ rules: { doubleMode: true } }));
      orch.bind(ROOM, CUP);

      const manager = rm.getRoom(ROOM)!.manager;
      const calls: string[] = [];
      vi.spyOn(manager, 'requestReset').mockImplementation(async () => { calls.push('reset'); });
      vi.spyOn(manager, 'setDoubleMode').mockImplementation(() => { calls.push('double'); });
      vi.spyOn(manager, 'setClientType').mockImplementation(async () => { calls.push('client'); });

      await orch.armMatch(ROOM, 'SF1');
      expect(calls).toEqual(['reset', 'double', 'client', 'client']);
      vi.restoreAllMocks();
    });

    it('side0 = slotA の不変条件 (第1シードが COOL 側)', async () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);

      const manager = rm.getRoom(ROOM)!.manager;
      const assigned: [number, string][] = [];
      vi.spyOn(manager, 'setClientType').mockImplementation(async (slot, type) => {
        assigned.push([slot, type]);
      });

      await orch.armMatch(ROOM, 'SF1');
      // SF1 は p1 (slotA) vs p4 (slotB)。slotA が slot 0 に入る
      expect(matchOf('SF1').resolvedA).toBe('p1');
      expect(matchOf('SF1').resolvedB).toBe('p4');
      expect(assigned.map(a => a[0])).toEqual([0, 1]);
      vi.restoreAllMocks();
    });

    it('相手が未確定の試合は arm できない', async () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      await expect(orch.armMatch(ROOM, 'FINAL')).rejects.toThrow(/まだ開始できません/);
    });

    it('別の試合が準備中なら arm できない', async () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      await orch.armMatch(ROOM, 'SF1');
      await expect(orch.armMatch(ROOM, 'SF2')).rejects.toThrow(/別の試合が準備中/);
    });

    it('プログラム未提出の参加者がいると arm できない', async () => {
      writeCup(cupDef({
        participants: [
          { id: 'p1', name: 'A', seed: 1, program: null },
          { id: 'p2', name: 'B', seed: 2, program: { builtin: 'cpu' } },
        ],
      }));
      orch.bind(ROOM, CUP);
      await expect(orch.armMatch(ROOM, 'FINAL')).rejects.toThrow(/A のプログラムが登録されていません/);
    });

    it('片方のプログラムが無いとき、スロットを一切変更しない', async () => {
      // COOL だけ割り当ててから HOT で失敗すると、中途半端な準備状態が残ってしまう
      writeCup(cupDef({
        participants: [
          { id: 'p1', name: 'A', seed: 1, program: { builtin: 'cpu' } },
          { id: 'p2', name: 'B', seed: 2, program: null },
        ],
      }));
      orch.bind(ROOM, CUP);

      const manager = rm.getRoom(ROOM)!.manager;
      const spy = vi.spyOn(manager, 'setClientType');

      await expect(orch.armMatch(ROOM, 'FINAL')).rejects.toThrow(/B のプログラムが登録されていません/);
      expect(spy).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('中断した armed 状態は bind し直すと ready に戻る', async () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      await orch.armMatch(ROOM, 'SF1');
      expect(matchOf('SF1').status).toBe('armed');

      // 運営が終了 → 再開 (アプリ再起動に相当)
      orch.unbind(ROOM);
      orch.bind(ROOM, CUP);

      expect(matchOf('SF1').status).toBe('ready');
      expect(lastState()!.armedMatchId).toBeNull();
    });

    it('cancelArm で準備を取り消せる', async () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      await orch.armMatch(ROOM, 'SF1');
      orch.cancelArm(ROOM);
      expect(matchOf('SF1').status).toBe('ready');
      expect(lastState()!.armedMatchId).toBeNull();
    });

    it('bind していない部屋では操作できない', async () => {
      await expect(orch.armMatch(ROOM, 'SF1')).rejects.toThrow(/大会を運営していません/);
    });
  });

  describe('結果の取り込みと確定', () => {
    /** 対戦を最後まで走らせて awaiting_confirm にする */
    async function playMatch(matchId: string): Promise<void> {
      await orch.armMatch(ROOM, matchId);
      await rm.getRoom(ROOM)!.manager.requestStart();
    }

    it('CPU 同士の対戦が終わると結果を取り込み確定待ちになる', async () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      await playMatch('SF1');

      const m = matchOf('SF1');
      expect(m.status).toBe('awaiting_confirm');
      expect(m.result!.roundResults).toHaveLength(1);
      expect(m.result!.set).not.toBeNull();
    }, 20_000);

    it('確定すると勝者が次の試合へ進む', async () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      await playMatch('SF1');

      const winner = matchOf('SF1').result!.winnerSide;
      // CPU 同士なので勝敗は決まる (同点なら手動決着が必要 = 別テスト)
      if (winner === null) return;

      orch.confirmResult(ROOM, 'SF1', winner);
      expect(matchOf('SF1').status).toBe('done');
      const expected = winner === 0 ? 'p1' : 'p4';
      expect(matchOf('FINAL').resolvedA).toBe(expected);
    }, 20_000);

    it('確定待ち中にリセットされても結果は失われない', async () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      await playMatch('SF1');
      expect(matchOf('SF1').status).toBe('awaiting_confirm');

      await rm.getRoom(ROOM)!.manager.requestReset();
      expect(matchOf('SF1').status).toBe('awaiting_confirm');
      expect(matchOf('SF1').result).toBeDefined();
    }, 20_000);

    it('4人トーナメントを最後まで自動進行できる', async () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);

      for (const id of ['SF1', 'SF2', 'FINAL']) {
        await playMatch(id);
        const w = matchOf(id).result!.winnerSide;
        orch.confirmResult(ROOM, id, w ?? 0);
        expect(matchOf(id).status).toBe('done');
      }

      const st = lastState()!;
      expect(st.matches.every(m => m.status === 'done')).toBe(true);
    }, 60_000);
  });

  describe('同点・やり直し', () => {
    it('トーナメントでは勝者不在のまま確定できない', () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      // 両者棄権で winnerSide=null の結果を作る
      orch.setWalkover(ROOM, 'SF1', null);

      expect(() => orch.confirmResult(ROOM, 'SF1'))
        .toThrow(/同点です。再試合するか、勝者を指定してください/);
    });

    it('手動で勝者を指定すれば確定でき、decidedBy が manual になる', () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      orch.setWalkover(ROOM, 'SF1', null);

      orch.confirmResult(ROOM, 'SF1', 1, '抽選');
      const m = matchOf('SF1');
      expect(m.status).toBe('done');
      expect(m.result!.winnerSide).toBe(1);
      expect(m.result!.decidedBy).toBe('manual');
      expect(m.result!.note).toBe('抽選');
      expect(matchOf('FINAL').resolvedA).toBe('p4');
    });

    it('リーグでは引き分けをそのまま確定できる', () => {
      writeCup(cupDef({ format: 'league', rules: { doubleMode: false } }));
      orch.bind(ROOM, CUP);
      orch.setWalkover(ROOM, 'L-D1M1', null);

      expect(() => orch.confirmResult(ROOM, 'L-D1M1')).not.toThrow();
      expect(lastState()!.standings).not.toBeNull();
    });

    it('ランダムマップなら同点の再試合にマップ指定は不要', () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      orch.setWalkover(ROOM, 'SF1', null);

      expect(() => orch.discardResult(ROOM, 'SF1')).not.toThrow();
      expect(matchOf('SF1').status).toBe('ready');
    });

    it('固定マップの大会では、同点の再試合にマップ変更が要る', () => {
      writeCup(cupDef({ rules: { doubleMode: false, mapCatalogId: 'fixed-map' } }));
      orch.bind(ROOM, CUP);
      orch.setWalkover(ROOM, 'SF1', null);

      expect(() => orch.discardResult(ROOM, 'SF1'))
        .toThrow(/マップを変更してください/);

      expect(() => orch.discardResult(ROOM, 'SF1', 'another-map')).not.toThrow();
      expect(matchOf('SF1').rematchMapCatalogId).toBe('another-map');
    });

    it('勝敗がついた試合のやり直しにはマップ変更は要らない', () => {
      writeCup(cupDef({ rules: { doubleMode: false, mapCatalogId: 'fixed-map' } }));
      orch.bind(ROOM, CUP);
      orch.setWalkover(ROOM, 'SF1', 0);

      expect(() => orch.discardResult(ROOM, 'SF1')).not.toThrow();
    });

    it('確定の取り消しは下流に確定があると cascade を要求する', () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      orch.setWalkover(ROOM, 'SF1', 0);
      orch.setWalkover(ROOM, 'SF2', 0);
      orch.setWalkover(ROOM, 'FINAL', 0);

      expect(() => orch.reopenMatch(ROOM, 'SF1')).toThrow(/後の結果も取り消されます/);
      expect(() => orch.reopenMatch(ROOM, 'SF1', true)).not.toThrow();
      expect(matchOf('FINAL').status).toBe('pending');
      expect(matchOf('SF2').status).toBe('done'); // 無関係な枝は無傷
    });
  });

  describe('永続化', () => {
    it('確定した結果は state.json に残る', () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      orch.setWalkover(ROOM, 'SF1', 0);

      const reloaded = loadTournament(CUP)!;
      expect(reloaded.state.matches.find(m => m.id === 'SF1')!.status).toBe('done');
    });
  });
});
