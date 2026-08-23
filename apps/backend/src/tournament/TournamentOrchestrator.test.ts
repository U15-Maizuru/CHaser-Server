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
    match: { doubleMode: false },
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
      // 自動進行の「観客に見せる間」はテストでは要らない。ただし arm だけは
      // 少し置く — 確定や予選確定を見届ける前に次の対戦が始まってしまうため
      autoPlayDelaysMs: {
        arm: 300, start: 10, nextRound: 10, confirm: 10, qualifiers: 10, restart: 10,
      },
    });
  });

  afterEach(() => {
    orch.shutdown();
    rm.shutdown();
    fs.rmSync(tournamentRootDir(), { recursive: true, force: true });
    fs.rmSync(catalogDir(), { recursive: true, force: true });
  });

  describe('観戦画面の表示 (予選なしの大会)', () => {
    it('切り替える表が無い形式では拒否する', () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      expect(() => orch.setDisplayView(ROOM, 'groups')).toThrow(TournamentError);
    });
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

    it('unbind するとコントロール窓が手動操作できるようリセットする', async () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      const manager = rm.getRoom(ROOM)!.manager;
      const spy = vi.spyOn(manager, 'requestReset');

      await orch.armMatch(ROOM, 'SF1');
      // 準備済み (armed) のまま運営を終了しても、対戦のコントロールが
      // 大会側に握られたまま戻ってこなくなってはいけない
      orch.unbind(ROOM);

      expect(spy).toHaveBeenCalled();
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
      writeCup(cupDef({ match: { doubleMode: true } }));
      orch.bind(ROOM, CUP);
      await orch.armMatch(ROOM, 'SF1');
      expect(rm.getRoom(ROOM)!.manager.getStatus().doubleMode).toBe(true);
    });

    it('reset → setDoubleMode → setClientType の順で呼ぶ', async () => {
      writeCup(cupDef({ match: { doubleMode: true } }));
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
      // 2ゲーム制なら先攻/後攻はランダム化されないので、決定論的な既定の並びを確認できる
      // (1ゲーム制はこの並びをコイントスでランダム化する — 別テストで確認する)
      writeCup(cupDef({ match: { doubleMode: true } }));
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

    it('swapSides で先攻・後攻を入れ替えられる (ready の間だけ)', async () => {
      writeCup(cupDef({ match: { doubleMode: true } }));
      orch.bind(ROOM, CUP);

      const before = matchOf('SF1');
      orch.swapSides(ROOM, 'SF1');
      const after = matchOf('SF1');
      expect(after.resolvedA).toBe(before.resolvedB);
      expect(after.resolvedB).toBe(before.resolvedA);
      expect(after.slotA).toEqual(before.slotB);
      expect(after.slotB).toEqual(before.slotA);

      await orch.armMatch(ROOM, 'SF1');
      expect(() => orch.swapSides(ROOM, 'SF1')).toThrow(TournamentError);
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

    it('回戦ごとのマップがあればそれを読む (4人なら準決勝=stage0 / 決勝=stage1)', async () => {
      writeCup(cupDef({
        stage: { map: { catalogId: 'cup-map', bracketStages: ['sf-map', 'final-map'] } },
      }));
      orch.bind(ROOM, CUP);

      const manager = rm.getRoom(ROOM)!.manager;
      const spy = vi.spyOn(manager, 'loadMap');

      await orch.armMatch(ROOM, 'SF1');
      expect(spy).toHaveBeenLastCalledWith('sf-map');

      orch.setWalkover(ROOM, 'SF1', 0);
      orch.setWalkover(ROOM, 'SF2', 0);
      await orch.armMatch(ROOM, 'FINAL');
      expect(spy).toHaveBeenLastCalledWith('final-map');
      vi.restoreAllMocks();
    });

    it('回戦の指定が null の回戦は大会全体の固定マップに従う', async () => {
      writeCup(cupDef({
        stage: { map: { catalogId: 'cup-map', bracketStages: [null, 'final-map'] } },
      }));
      orch.bind(ROOM, CUP);

      const spy = vi.spyOn(rm.getRoom(ROOM)!.manager, 'loadMap');
      await orch.armMatch(ROOM, 'SF1');
      expect(spy).toHaveBeenLastCalledWith('cup-map');
      vi.restoreAllMocks();
    });

    it('再試合のマップ指定は回戦ごとのマップより優先される', async () => {
      writeCup(cupDef({ stage: { map: { bracketStages: ['sf-map', null] } } }));
      orch.bind(ROOM, CUP);
      orch.setWalkover(ROOM, 'SF1', null);
      orch.discardResult(ROOM, 'SF1', 'rematch-map');

      const spy = vi.spyOn(rm.getRoom(ROOM)!.manager, 'loadMap');
      await orch.armMatch(ROOM, 'SF1');
      expect(spy).toHaveBeenLastCalledWith('rematch-map');
      vi.restoreAllMocks();
    });

    // 再試合のマップ指定 (rematchMapCatalogId) は discardResult した試合だけに付く。
    // 別の試合を arm するときに引きずってしまうと、同点になった試合以降ずっと
    // 別マップで進行することになってしまう
    it('固定マップの大会で別マップ再試合したあと、次の試合の準備では大会指定のマップに戻る', async () => {
      writeCup(cupDef({ stage: { map: { catalogId: 'cup-map' } } }));
      orch.bind(ROOM, CUP);

      orch.setWalkover(ROOM, 'SF1', null);            // 同点
      orch.discardResult(ROOM, 'SF1', 'rematch-map');  // 別マップで再試合
      orch.setWalkover(ROOM, 'SF1', 0);                // 再試合の結果を確定
      orch.setWalkover(ROOM, 'SF2', 0);

      const spy = vi.spyOn(rm.getRoom(ROOM)!.manager, 'loadMap');
      await orch.armMatch(ROOM, 'FINAL');
      expect(spy).toHaveBeenLastCalledWith('cup-map'); // rematch-map ではなく大会指定のマップ
      vi.restoreAllMocks();
    });

    // ランダムマップ運用では requestReset() の refreshForNewGame が引き直すのでこれ自体は
    // 元から動いていたが、固定マップ→ランダムのように運用が混在する大会もあるため、
    // 「引き直す」経路そのもの (generateRandomMap) が毎回明示的に呼ばれることも確かめる
    it('ランダムマップの大会で再試合したあと、次の試合の準備でも改めて引き直される', async () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);

      orch.setWalkover(ROOM, 'SF1', null);      // 同点
      orch.discardResult(ROOM, 'SF1');          // ランダムマップなのでマップ指定は不要
      orch.setWalkover(ROOM, 'SF1', 0);
      orch.setWalkover(ROOM, 'SF2', 0);

      const manager = rm.getRoom(ROOM)!.manager;
      const spy = vi.spyOn(manager, 'generateRandomMap');
      await orch.armMatch(ROOM, 'FINAL');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(manager.getStatus().mapSource.kind).toBe('random');
      vi.restoreAllMocks();
    });

    // 一番踏み外しやすいのは回戦ごとに運用 (固定/ランダム) が違うとき。準決勝は固定マップの
    // 再試合で source が 'catalog' のまま止まるので、決勝がランダム運用でも
    // 「ライブラリ由来は引き直さない」設計 (MapManager.refreshForNewGame) のせいで
    // 準決勝の再試合マップが決勝まで残ってしまいうる (armMatch 側で明示的に切り替える必要がある)
    it('準決勝を別マップで再試合したあと、決勝がランダム運用ならそちらもランダムに戻る', async () => {
      writeCup(cupDef({ stage: { map: { bracketStages: ['sf-map', null] } } }));
      orch.bind(ROOM, CUP);

      orch.setWalkover(ROOM, 'SF1', null);            // 同点
      orch.discardResult(ROOM, 'SF1', 'rematch-map');  // 準決勝だけ別マップで再試合
      orch.setWalkover(ROOM, 'SF1', 0);
      orch.setWalkover(ROOM, 'SF2', 0);

      const manager = rm.getRoom(ROOM)!.manager;
      const spy = vi.spyOn(manager, 'generateRandomMap');
      await orch.armMatch(ROOM, 'FINAL'); // 決勝 (stage1) は指定なし = ランダム運用
      expect(spy).toHaveBeenCalledTimes(1);
      expect(manager.getStatus().mapSource.kind).toBe('random');
      vi.restoreAllMocks();
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
      // 先攻/後攻は1ゲーム制ではランダムなので、どちらの枠に入るかは問わず勝者が
      // 決勝に進んだことだけを見る
      expect([matchOf('FINAL').resolvedA, matchOf('FINAL').resolvedB]).toContain(expected);
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
      expect([matchOf('FINAL').resolvedA, matchOf('FINAL').resolvedB]).toContain('p4');
    });

    it('リーグでは引き分けをそのまま確定できる', () => {
      writeCup(cupDef({ format: 'league' }));
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
      writeCup(cupDef({ stage: { map: { catalogId: 'fixed-map' } } }));
      orch.bind(ROOM, CUP);
      orch.setWalkover(ROOM, 'SF1', null);

      expect(() => orch.discardResult(ROOM, 'SF1'))
        .toThrow(/マップを変更してください/);

      expect(() => orch.discardResult(ROOM, 'SF1', 'another-map')).not.toThrow();
      expect(matchOf('SF1').rematchMapCatalogId).toBe('another-map');
    });

    it('その回戦だけマップ固定でも、同点の再試合にはマップ変更が要る', () => {
      // 大会全体はランダムでも、回戦を指定していれば引き直されないので同じ扱いにする
      writeCup(cupDef({ stage: { map: { bracketStages: ['sf-map', null] } } }));
      orch.bind(ROOM, CUP);
      orch.setWalkover(ROOM, 'SF1', null);

      expect(() => orch.discardResult(ROOM, 'SF1')).toThrow(/マップを変更してください/);
      // 決勝 (stage1) は指定が無いのでランダムのまま → 変更不要
      orch.setWalkover(ROOM, 'SF1', 0);
      orch.setWalkover(ROOM, 'SF2', 0);
      orch.setWalkover(ROOM, 'FINAL', null);
      expect(() => orch.discardResult(ROOM, 'FINAL')).not.toThrow();
    });

    it('勝敗がついた試合のやり直しにはマップ変更は要らない', () => {
      writeCup(cupDef({ stage: { map: { catalogId: 'fixed-map' } } }));
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

  describe('setStageMap (運営中の回戦マップ差し替え)', () => {
    it('差し替えると実効値が変わり、配信される', () => {
      writeCup(cupDef({ stage: { map: { bracketStages: ['sf-map', null] } } }));
      orch.bind(ROOM, CUP);
      expect(lastState()!.stageMaps).toEqual(['sf-map', null]);

      orch.setStageMap(ROOM, 1, 'final-map');
      expect(lastState()!.stageMaps).toEqual(['sf-map', 'final-map']);
    });

    it('null に戻すと大会の設定に従う', () => {
      writeCup(cupDef({ stage: { map: { bracketStages: ['sf-map', null] } } }));
      orch.bind(ROOM, CUP);
      orch.setStageMap(ROOM, 0, null);
      expect(lastState()!.stageMaps).toEqual([null, null]);
    });

    it('差し替えは state.json に残り、次の arm で使われる', async () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      orch.setStageMap(ROOM, 0, 'sf-map');

      expect(loadTournament(CUP)!.state.decisions.stageMaps).toEqual({ '0': 'sf-map' });

      const spy = vi.spyOn(rm.getRoom(ROOM)!.manager, 'loadMap');
      await orch.armMatch(ROOM, 'SF1');
      expect(spy).toHaveBeenLastCalledWith('sf-map');
      vi.restoreAllMocks();
    });

    it('準備済みの試合と同じ回戦なら、その場で読み直す', async () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      await orch.armMatch(ROOM, 'SF1');

      const spy = vi.spyOn(rm.getRoom(ROOM)!.manager, 'loadMap');
      orch.setStageMap(ROOM, 0, 'sf-map');
      expect(spy).toHaveBeenCalledWith('sf-map');

      // 別の回戦なら準備中の試合には触らない
      spy.mockClear();
      orch.setStageMap(ROOM, 1, 'final-map');
      expect(spy).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('存在しない回戦とリーグは断る', () => {
      writeCup(cupDef());
      orch.bind(ROOM, CUP);
      expect(() => orch.setStageMap(ROOM, 2, 'x')).toThrow(/回戦は存在しません/);
      expect(() => orch.setStageMap(ROOM, -1, 'x')).toThrow(/回戦は存在しません/);

      orch.unbind(ROOM);
      writeCup(cupDef({ id: 'lg', format: 'league' }), 'lg');
      orch.bind(ROOM, 'lg');
      expect(() => orch.setStageMap(ROOM, 0, 'x')).toThrow(/トーナメント/);
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

  // ── オートプレイ ────────────────────────────────────────────────────────
  describe('オートプレイ (自動進行)', () => {
    /** 2人 = 1試合だけの大会。自動進行を最後まで通しても現実的な時間で終わる */
    const soloCup = () => cupDef({
      participants: [
        { id: 'p1', name: 'A', seed: 1, program: { builtin: 'cpu' } },
        { id: 'p2', name: 'B', seed: 2, program: { builtin: 'cpu' } },
      ],
    });

    const waitFor = async (label: string, cond: () => boolean, timeoutMs = 40_000) => {
      const until = Date.now() + timeoutMs;
      while (!cond()) {
        if (Date.now() > until) throw new Error(`タイムアウト: ${label}`);
        await new Promise(r => setTimeout(r, 20));
      }
    };

    it('既定では切れていて、enabled と loop は別々に設定できる', () => {
      writeCup(soloCup());
      orch.bind(ROOM, CUP);
      expect(lastState()!.autoPlay).toEqual({ enabled: false, loop: false, stoppedReason: null });

      // 切ったまま繰り返しの設定だけ入れられる (パネルのボタンが2つに分かれているため)
      orch.setAutoPlay(ROOM, false, true);
      expect(lastState()!.autoPlay).toEqual({ enabled: false, loop: true, stoppedReason: null });

      // loop を省略した呼び出しは今の設定を巻き戻さない
      orch.setAutoPlay(ROOM, false);
      expect(lastState()!.autoPlay.loop).toBe(true);
    });

    it('準備・開始・確定を代行して最後まで進め、終わると自動で切れる', async () => {
      writeCup(soloCup());
      orch.bind(ROOM, CUP);
      orch.setAutoPlay(ROOM, true);

      // 完走しても同点で止まっても autoPlay は切れる。どちらだったかで期待を分ける
      await waitFor('自動進行の停止', () => !lastState()!.autoPlay.enabled);

      const reason = lastState()!.autoPlay.stoppedReason;
      if (reason?.includes('同点')) return;  // CPU 同士が同点。手動決着が要る (別テスト)

      expect(reason).toBe('全ての試合が終了しました');
      expect(matchOf('FINAL').status).toBe('done');
      expect(matchOf('FINAL').result!.roundResults).toHaveLength(1);
    }, 60_000);

    it('操作が通らなければ理由を添えて止まる', async () => {
      writeCup(cupDef({
        participants: [
          { id: 'p1', name: 'A', seed: 1, program: { builtin: 'cpu' } },
          { id: 'p2', name: 'B', seed: 2, program: null },
        ],
      }));
      orch.bind(ROOM, CUP);
      orch.setAutoPlay(ROOM, true);

      await waitFor('停止', () => lastState()!.autoPlay.stoppedReason !== null);
      expect(lastState()!.autoPlay.stoppedReason).toMatch(/B のプログラムが登録されていません/);
      expect(lastState()!.autoPlay.enabled).toBe(false);
      expect(matchOf('FINAL').status).toBe('ready');
    });

    it('切ると予約済みの操作は実行されない', async () => {
      writeCup(soloCup());
      orch.bind(ROOM, CUP);
      orch.setAutoPlay(ROOM, true);
      orch.setAutoPlay(ROOM, false);

      await new Promise(r => setTimeout(r, 500));   // arm の待機時間 (300ms) を超えて待つ
      expect(lastState()!.armedMatchId).toBeNull();
      expect(matchOf('FINAL').status).toBe('ready');
    });

    it('デモモードでは全試合が終わると進行を作り直して繰り返す', async () => {
      writeCup(soloCup());
      orch.bind(ROOM, CUP);
      orch.setWalkover(ROOM, 'FINAL', 0);          // 対戦せずに全試合終了の状態を作る
      expect(matchOf('FINAL').status).toBe('done');

      orch.setAutoPlay(ROOM, true, true);
      await waitFor('やり直し', () => matchOf('FINAL').status !== 'done');
      orch.setAutoPlay(ROOM, false);               // 次の対戦が始まる前に止める

      expect(matchOf('FINAL').result).toBeUndefined();
      expect(lastState()!.autoPlay.stoppedReason).toBeNull();  // 完走ではないので止まらない
      // 作り直した進行は state.json にも残る
      expect(loadTournament(CUP)!.state.matches.every(m => m.status !== 'done')).toBe(true);
    });

    it('デモモードでも回戦ごとのマップの差し替えは残る (進行だけ作り直す)', async () => {
      writeCup(soloCup());
      orch.bind(ROOM, CUP);
      orch.setStageMap(ROOM, 0, 'final-map');
      orch.setWalkover(ROOM, 'FINAL', 0);

      orch.setAutoPlay(ROOM, true, true);
      await waitFor('やり直し', () => matchOf('FINAL').status !== 'done');
      orch.setAutoPlay(ROOM, false);

      expect(lastState()!.stageMaps).toEqual(['final-map']);
    });

    it('繰り返さないなら全試合終了で止まる', async () => {
      writeCup(soloCup());
      orch.bind(ROOM, CUP);
      orch.setWalkover(ROOM, 'FINAL', 0);

      orch.setAutoPlay(ROOM, true);
      await waitFor('停止', () => !lastState()!.autoPlay.enabled);
      expect(lastState()!.autoPlay.stoppedReason).toBe('全ての試合が終了しました');
      expect(matchOf('FINAL').status).toBe('done');
    });
  });

  // ── 予選リーグ + 決勝トーナメント ────────────────────────────────────────
  describe('予選リーグ + 決勝トーナメント', () => {
    /**
     * 6人2リーグ×上位2。蛇行配分で A=[p1,p4,p5] / B=[p2,p3,p6]、各リーグ3試合。
     * 3人リーグにするのは、上位2枠の「外」に控えを1人置いて差し替えを試せるようにするため。
     */
    const groupCup = (overrides: Record<string, unknown> = {}) => cupDef({
      format: 'group-then-bracket',
      stage: { groupCount: 2, advancePerGroup: 2 },
      participants: Array.from({ length: 6 }, (_, i) => ({
        id: `p${i + 1}`, name: `T${i + 1}`, seed: i + 1, program: { builtin: 'cpu' },
      })),
      ...overrides,
    });

    /** 予選を全部 slotA の勝ちで終わらせる → 順位は選手番号順に決まる */
    const finishGroups = () => {
      for (const m of lastState()!.matches.filter(x => x.group !== undefined)) {
        orch.setWalkover(ROOM, m.id, 0);
      }
    };

    it('予選が終わると決勝進出者が自動で埋まり、1回戦がクロス配置になる', () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);
      expect(lastState()!.qualifiers!.every(q => q.pending)).toBe(true);
      expect(matchOf('SF1').status).toBe('pending');

      finishGroups();

      const qs = lastState()!.qualifiers!;
      expect(qs.every(q => !q.pending)).toBe(true);
      expect(qs.map(q => q.participantId)).toEqual(['p1', 'p4', 'p2', 'p3']);
      // A1 vs B2 / B1 vs A2 (先攻/後攻は1ゲーム制ではランダムなのでどちらの枠かは問わない)
      expect([matchOf('SF1').resolvedA, matchOf('SF1').resolvedB].sort()).toEqual(['p1', 'p3']);
      expect([matchOf('SF2').resolvedA, matchOf('SF2').resolvedB].sort()).toEqual(['p2', 'p4']);
      expect(matchOf('SF1').status).toBe('ready');
    });

    it('予選の引き分けはそのまま確定できる (決勝の引き分けは拒否する)', () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);

      orch.setWalkover(ROOM, 'G1-D1M1', null);
      expect(() => orch.confirmResult(ROOM, 'G1-D1M1')).not.toThrow();

      finishGroups();
      orch.setWalkover(ROOM, 'SF1', null);
      expect(() => orch.confirmResult(ROOM, 'SF1')).toThrow(TournamentError);
    });

    it('決勝進出者を差し替えるとトーナメント表の顔ぶれが変わり、null で自動に戻る', () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);
      finishGroups();
      const slotOf1 = (): [string | null, string | null] =>
        [matchOf('SF1').resolvedA, matchOf('SF1').resolvedB];
      expect(slotOf1()).toContain('p1');

      orch.setQualifier(ROOM, 0, 1, 'p5');
      expect(slotOf1()).toContain('p5');
      expect(slotOf1()).not.toContain('p1');
      expect(lastState()!.qualifiers![0]!.manualParticipantId).toBe('p5');
      expect(lastState()!.qualifiers![0]!.autoParticipantId).toBe('p1');

      orch.setQualifier(ROOM, 0, 1, null);
      expect(slotOf1()).toContain('p1');
    });

    it('そのリーグの所属でない人は指定できない', () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);
      finishGroups();
      expect(() => orch.setQualifier(ROOM, 0, 1, 'p2')).toThrow(TournamentError);
    });

    it('同じ人を2つの枠に入れられない', () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);
      finishGroups();
      // 2位の枠には自動で p4 が入っている
      expect(() => orch.setQualifier(ROOM, 0, 1, 'p4')).toThrow(TournamentError);
    });

    it('準備中の試合が使う枠は差し替えられない', async () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);
      finishGroups();
      orch.confirmQualifiers(ROOM, true);
      await orch.armMatch(ROOM, 'SF1');

      expect(() => orch.setQualifier(ROOM, 0, 1, 'p5')).toThrow(TournamentError);
    });

    it('実施済みの試合が使う枠は cascade なしでは差し替えられない', () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);
      finishGroups();
      orch.setWalkover(ROOM, 'SF1', 0);

      expect(() => orch.setQualifier(ROOM, 0, 1, 'p5')).toThrow(TournamentError);

      // cascade を付ければ結果ごと巻き戻して差し替わる
      orch.setQualifier(ROOM, 0, 1, 'p5', true);
      expect(matchOf('SF1').result).toBeUndefined();
      expect([matchOf('SF1').resolvedA, matchOf('SF1').resolvedB]).toContain('p5');
    });

    it('予選をやり直すと決勝トーナメントも巻き戻る', () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);
      finishGroups();
      orch.setWalkover(ROOM, 'SF1', 0);

      expect(() => orch.reopenMatch(ROOM, 'G1-D1M1')).toThrow(TournamentError);
      orch.reopenMatch(ROOM, 'G1-D1M1', true);

      expect(matchOf('SF1').status).toBe('pending');
      expect(lastState()!.qualifiers!.slice(0, 2).every(q => q.pending)).toBe(true);
    });

    it('予選が終わるまで決勝進出者は確定できない', () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);
      expect(lastState()!.qualifiersConfirmed).toBe(false);
      expect(() => orch.confirmQualifiers(ROOM, true)).toThrow(TournamentError);
    });

    it('確定するまで決勝トーナメントの試合は準備できない', async () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);
      finishGroups();
      expect(matchOf('SF1').status).toBe('ready');

      await expect(orch.armMatch(ROOM, 'SF1')).rejects.toThrow(TournamentError);

      orch.confirmQualifiers(ROOM, true);
      expect(lastState()!.qualifiersConfirmed).toBe(true);
      await expect(orch.armMatch(ROOM, 'SF1')).resolves.toBeUndefined();
    });

    it('オートプレイは予選が終わると決勝進出者を確定して決勝へ進む', async () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);
      finishGroups();
      expect(lastState()!.qualifiersConfirmed).toBe(false);

      orch.setAutoPlay(ROOM, true);
      const until = Date.now() + 5_000;
      while (!lastState()!.qualifiersConfirmed) {
        if (Date.now() > until) throw new Error('タイムアウト: 決勝進出者の確定');
        await new Promise(r => setTimeout(r, 20));
      }
      orch.setAutoPlay(ROOM, false);   // 決勝の対戦が始まる前に止める

      expect(lastState()!.qualifiersConfirmed).toBe(true);
      expect(lastState()!.autoPlay.stoppedReason).toBeNull();
    });

    it('予選の試合は確定前でも準備できる (確定は決勝の手前の関門)', async () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);
      await expect(orch.armMatch(ROOM, 'G1-D1M1')).resolves.toBeUndefined();
    });

    it('予選をやり直すと確定も外れる', () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);
      finishGroups();
      orch.confirmQualifiers(ROOM, true);

      orch.reopenMatch(ROOM, 'G1-D1M1', true);
      // 予選が終わっていない状態では確定は意味を持たない (payload で false に倒す)
      expect(lastState()!.qualifiersConfirmed).toBe(false);

      // やり直した試合を入れ直せば、また確定できる
      orch.setWalkover(ROOM, 'G1-D1M1', 0);
      expect(lastState()!.qualifiersConfirmed).toBe(false);
      orch.confirmQualifiers(ROOM, true);
      expect(lastState()!.qualifiersConfirmed).toBe(true);
    });

    it('確定は取り消せる', () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);
      finishGroups();
      orch.confirmQualifiers(ROOM, true);
      orch.confirmQualifiers(ROOM, false);
      expect(lastState()!.qualifiersConfirmed).toBe(false);
    });

    it('観戦画面の表示を切り替えられる (既定は進行に追従)', () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);
      expect(lastState()!.displayView).toBe('auto');

      orch.setDisplayView(ROOM, 'bracket');
      expect(lastState()!.displayView).toBe('bracket');

      // 予選の試合を進めても運営の指定は残る (勝手に戻らない)
      orch.setWalkover(ROOM, 'G1-D1M1', 0);
      expect(lastState()!.displayView).toBe('bracket');

      orch.setDisplayView(ROOM, 'auto');
      expect(lastState()!.displayView).toBe('auto');
    });

    it('予選の節にはマップを個別指定できない', () => {
      writeCup(groupCup());
      orch.bind(ROOM, CUP);

      expect(() => orch.setStageMap(ROOM, 0, 'some-map')).toThrow(TournamentError);
      // 決勝トーナメントの回戦は指定できる (index は予選ぶんを含めた通し番号)
      const bracketStage = lastState()!.stageLabels.findIndex(l => l === '準決勝');
      expect(() => orch.setStageMap(ROOM, bracketStage, null)).not.toThrow();
    });

    it('予選と決勝で別々の doubleMode を選べる', async () => {
      writeCup(groupCup({
        match: { doubleMode: true },
        stage: { groupCount: 2, advancePerGroup: 2, qualifyingDoubleMode: false },
      }));
      orch.bind(ROOM, CUP);

      await orch.armMatch(ROOM, 'G1-D1M1');
      expect(rm.getRoom(ROOM)!.manager.getStatus().doubleMode).toBe(false);

      finishGroups();
      orch.confirmQualifiers(ROOM, true);
      await orch.armMatch(ROOM, 'SF1');
      expect(rm.getRoom(ROOM)!.manager.getStatus().doubleMode).toBe(true);
    });
  });

  // ── BOT対戦予選 + 決勝トーナメント ──────────────────────────────────────
  describe('BOT対戦予選 + 決勝トーナメント', () => {
    /** 6人が同じ BOT と1試合ずつ。上位4名が決勝トーナメントへ */
    const botCup = (
      { bot, qualifyingDoubleMode, ...overrides }: Record<string, unknown> = {},
    ) => cupDef({
      format: 'bot-then-bracket',
      participants: Array.from({ length: 6 }, (_, i) => ({
        id: `p${i + 1}`, name: `T${i + 1}`, seed: i + 1, program: { builtin: 'cpu' },
      })),
      ...overrides,
      stage: {
        advanceCount: 4,
        ...(qualifyingDoubleMode !== undefined ? { qualifyingDoubleMode } : {}),
        bot: {
          program: { builtin: 'cpu' }, name: '運営BOT', map: 'fixed-map',
          ...(bot as object ?? {}),
        },
      },
    });

    /** 予選を「選手番号が小さいほど高得点」で終わらせる → 順位は p1..p6 の順になる */
    const finishQualifying = (points: Record<string, number> = {}) => {
      for (const m of lastState()!.matches.filter(x => x.group !== undefined)) {
        const pid = [m.resolvedA, m.resolvedB].find(id => id !== '__bot__')!;
        const no  = Number(pid.slice(1));
        const total = points[pid] ?? (100 - no * 10);
        // 参加者は slotA (既定は先攻)。合計ポイントだけ与えて確定させる
        orch.setWalkover(ROOM, m.id, 0);
        const match = lastState()!.matches.find(x => x.id === m.id)!;
        match.result!.set = {
          totals: [total, 0], wins: [1, 0], draws: 0, winnerSide: 0, decidedBy: 'points',
        };
        match.result!.roundResults = [];
      }
      // set を直接書き換えたので、順位表を計算し直させる
      orch.rescan(ROOM);
    };

    it('予選は参加者ごとに BOT との1試合になり、BOT は参加者一覧にだけ現れる', () => {
      writeCup(botCup());
      orch.bind(ROOM, CUP);
      const st = lastState()!;

      const qualifying = st.matches.filter(m => m.group !== undefined);
      expect(qualifying).toHaveLength(6);
      expect(qualifying.every(m => m.resolvedB === '__bot__')).toBe(true);
      expect(qualifying.every(m => m.status === 'ready')).toBe(true);

      // BOT はエントリーではない — 順位表にも、決勝トーナメントにも入らない
      expect(st.participants.find(p => p.isBot)?.name).toBe('運営BOT');
      expect(st.groups![0]!.participantIds).not.toContain('__bot__');
      expect(st.groups![0]!.participantIds).toHaveLength(6);
    });

    it('BOT対戦予選の予選試合は先攻・後攻を入れ替えられない (全員同一条件が根拠)', () => {
      writeCup(botCup());
      orch.bind(ROOM, CUP);
      const qualifying = lastState()!.matches.find(m => m.group !== undefined)!;
      expect(() => orch.swapSides(ROOM, qualifying.id)).toThrow(TournamentError);
    });

    it('参加者後攻の設定なら BOT が slotA になる', () => {
      writeCup(botCup({ bot: { participantSide: 1 } }));
      orch.bind(ROOM, CUP);
      const qualifying = lastState()!.matches.filter(m => m.group !== undefined);
      expect(qualifying.every(m => m.resolvedA === '__bot__')).toBe(true);
    });

    it('予選が終わると上位が決勝トーナメントへ入り、確定するまで準備できない', async () => {
      writeCup(botCup());
      orch.bind(ROOM, CUP);
      finishQualifying();

      const st = lastState()!;
      expect(st.groups![0]!.standings.map(s => s.participantId))
        .toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
      expect(st.qualifiers!.map(q => q.participantId)).toEqual(['p1', 'p2', 'p3', 'p4']);
      // 4人進出 → seedOrder(4) = [1,4,2,3] なので 1位-4位 / 2位-3位
      // (先攻/後攻は1ゲーム制ではランダムなのでどちらの枠かは問わない)
      expect([matchOf('SF1').resolvedA, matchOf('SF1').resolvedB].sort()).toEqual(['p1', 'p4']);
      expect([matchOf('SF2').resolvedA, matchOf('SF2').resolvedB].sort()).toEqual(['p2', 'p3']);

      await expect(orch.armMatch(ROOM, 'SF1')).rejects.toThrow(TournamentError);
      orch.confirmQualifiers(ROOM, true);
      await expect(orch.armMatch(ROOM, 'SF1')).resolves.toBeUndefined();
    });

    it('予選 (BOT対戦) と決勝で別々の doubleMode を選べる', async () => {
      writeCup(botCup({ match: { doubleMode: true }, qualifyingDoubleMode: false }));
      orch.bind(ROOM, CUP);

      const qualifying = lastState()!.matches.find(m => m.group !== undefined)!;
      await orch.armMatch(ROOM, qualifying.id);
      expect(rm.getRoom(ROOM)!.manager.getStatus().doubleMode).toBe(false);

      finishQualifying();
      orch.confirmQualifiers(ROOM, true);
      await orch.armMatch(ROOM, 'SF1');
      expect(rm.getRoom(ROOM)!.manager.getStatus().doubleMode).toBe(true);
    });

    it('ボーダーが同点なら確認リストが定員より多く並ぶ', () => {
      writeCup(botCup());
      orch.bind(ROOM, CUP);
      // 4位と5位を並ばせる
      finishQualifying({ p4: 50, p5: 50 });

      const list = lastState()!.qualifierCandidates!;
      expect(list).toHaveLength(5);
      expect(list.filter(c => c.onBorder).map(c => c.participantId).sort())
        .toEqual(['p4', 'p5']);
    });

    it('確認リストから削除すると下の順位が繰り上がる', () => {
      writeCup(botCup());
      orch.bind(ROOM, CUP);
      finishQualifying();
      expect(lastState()!.qualifiers!.map(q => q.participantId))
        .toEqual(['p1', 'p2', 'p3', 'p4']);

      orch.setQualifierExclusion(ROOM, 'p2', true);
      expect(lastState()!.qualifiers!.map(q => q.participantId))
        .toEqual(['p1', 'p3', 'p4', 'p5']);
      // 削除した人は行として残る (取り消せるように)
      expect(lastState()!.qualifierCandidates!.find(c => c.participantId === 'p2')?.excluded)
        .toBe(true);

      orch.setQualifierExclusion(ROOM, 'p2', false);
      expect(lastState()!.qualifiers!.map(q => q.participantId))
        .toEqual(['p1', 'p2', 'p3', 'p4']);
    });

    it('実施済みの決勝トーナメントがあれば cascade なしで削除できない', () => {
      writeCup(botCup());
      orch.bind(ROOM, CUP);
      finishQualifying();
      orch.confirmQualifiers(ROOM, true);
      orch.setWalkover(ROOM, 'SF1', 0);

      expect(() => orch.setQualifierExclusion(ROOM, 'p2', true)).toThrow(TournamentError);

      orch.setQualifierExclusion(ROOM, 'p2', true, true);
      expect(matchOf('SF1').result).toBeUndefined();
      expect([matchOf('SF2').resolvedA, matchOf('SF2').resolvedB]).toContain('p3');
    });

    it('予選のマップは差し替えられるが、実施済みがあれば拒否する', () => {
      writeCup(botCup());
      orch.bind(ROOM, CUP);

      // 全参加者が同じマップで戦うのが形式の根拠なので、予選も差し替えられる
      expect(() => orch.setStageMap(ROOM, 0, 'other-map')).not.toThrow();
      expect(lastState()!.stageMaps[0]).toBe('other-map');

      orch.setWalkover(ROOM, 'B-M1', 0);
      expect(() => orch.setStageMap(ROOM, 0, 'third-map')).toThrow(TournamentError);
    });

    it('予選の stage 名は「BOT対戦予選」になる (節と数えない)', () => {
      writeCup(botCup());
      orch.bind(ROOM, CUP);
      expect(lastState()!.stageLabels[0]).toBe('BOT対戦予選');
    });

    it('オートプレイは同点のボーダーでも止まらず自動で確定する', async () => {
      writeCup(botCup());
      orch.bind(ROOM, CUP);
      finishQualifying({ p4: 50, p5: 50 });
      expect(lastState()!.qualifierCandidates!.some(c => c.onBorder)).toBe(true);

      orch.setAutoPlay(ROOM, true);
      const until = Date.now() + 5_000;
      while (!lastState()!.qualifiersConfirmed) {
        if (Date.now() > until) throw new Error('タイムアウト: 決勝進出者の確定');
        await new Promise(r => setTimeout(r, 20));
      }
      orch.setAutoPlay(ROOM, false);

      expect(lastState()!.qualifiersConfirmed).toBe(true);
      expect(lastState()!.autoPlay.stoppedReason).toBeNull();
    });
  });
});
