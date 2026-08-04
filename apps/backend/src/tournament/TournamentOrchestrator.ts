import type {
  ClientType,
  ProcessConfig,
  ResolvedParticipant,
  ServerStatusPayload,
  TournamentMatch,
  TournamentMatchResult,
  TournamentStatePayload,
  WsMessage,
} from '@u15/ws-types';
import { computeSetResult } from '@u15/ws-types';
import type { RoomManager } from '../RoomManager.js';
import { buildProcessConfig } from '../game/processConfig.js';
import { getCatalogEntry } from '../programCatalog.js';
import {
  assignProgram,
  buildStatePayload,
  loadTournament,
  mapForMatch,
  mapForStage,
  resolveParticipants,
  saveState,
  scanTournaments,
  stageCountOf,
  type LoadedTournament,
} from './TournamentStore.js';
import {
  captureResult,
  confirmResult as confirmInGraph,
  discardResult as discardInGraph,
  hasConfirmedDownstream,
  reopenMatch as reopenInGraph,
  setWalkover as walkoverInGraph,
} from './progress.js';

// 大会の進行と ServerManager の橋渡し。
//
// ServerManager / RoundController / SlotManager / RoomManager にはトーナメントの知識を
// 一切持たせない。ここが公開 API と 'status' イベントだけを使って外から駆動する。
//
// 保存はグローバル (大会単位)、実行はルーム単位。1大会 ⇄ 1ルームの双方向排他。

/** bind 中はこの間隔でルームを touch し、TTL (30分) で消えるのを防ぐ */
const KEEPALIVE_MS = 60_000;

export class TournamentError extends Error {}

interface Binding {
  tournamentId: string;
  loaded:       LoadedTournament;
  armedMatchId: string | null;
  listener:     (st: ServerStatusPayload) => void;
  keepalive:    ReturnType<typeof setInterval>;
}

export interface OrchestratorDeps {
  rm:        RoomManager;
  broadcast: (roomId: string, msg: WsMessage) => void;
}

export class TournamentOrchestrator {
  private readonly byRoom       = new Map<string, Binding>();
  private readonly roomOfCup    = new Map<string, string>();

  constructor(private readonly deps: OrchestratorDeps) {}

  // ── 問い合わせ ────────────────────────────────────────────────────────────

  /** その大会がどの部屋で運営中か (HTTP 側から使う) */
  boundRoomOf(tournamentId: string): string | null {
    return this.roomOfCup.get(tournamentId) ?? null;
  }

  /** join_room 直後に流し込む状態メッセージ (後から開いた窓へのリプレイ) */
  joinMessagesFor(roomId: string): WsMessage[] {
    return [{ type: 'tournament_state', payload: this.payloadFor(roomId) }];
  }

  // ── ライフサイクル ────────────────────────────────────────────────────────

  bind(roomId: string, tournamentId: string): void {
    const already = this.byRoom.get(roomId);
    if (already && already.tournamentId === tournamentId) return;
    if (already) {
      throw new TournamentError(`この部屋では既に「${already.loaded.def.name}」を運営中です`);
    }
    const otherRoom = this.roomOfCup.get(tournamentId);
    if (otherRoom && otherRoom !== roomId) {
      throw new TournamentError(`この大会は別の部屋 (${otherRoom}) で運営中です`);
    }

    const room = this.deps.rm.getRoom(roomId);
    if (!room) throw new TournamentError('ルームが見つかりません');

    const loaded = loadTournament(tournamentId);
    if (!loaded) throw new TournamentError('大会が見つかりません');

    // armed / in_progress はスロット割り当てというプロセス内の状態と対になっている。
    // 前回の運営が中断したまま保存されているとカードが永久に「準備中」で詰まるので、
    // bind のたびに ready へ戻す (結果を持つカードは resolveMatches 側が優先する)
    const revived = loaded.state.matches.map(m =>
      (m.status === 'armed' || m.status === 'in_progress') ? { ...m, status: 'ready' as const } : m);

    const listener = (st: ServerStatusPayload) => this.onServerStatus(roomId, st);
    room.manager.on('status', listener);

    const binding: Binding = {
      tournamentId,
      loaded,
      armedMatchId: null,
      listener,
      keepalive: setInterval(() => this.deps.rm.touchRoom(roomId), KEEPALIVE_MS),
    };
    this.byRoom.set(roomId, binding);
    this.roomOfCup.set(tournamentId, roomId);
    this.commit(binding, revived);

    // 大会運営中はデモ・リピートと排他 (自動進行が勝手に次の対戦を始めてしまうため)
    room.manager.setDemoMode(false);
    room.manager.setRepeatMode(false);
    // まだ試合を選んでいないので、最初の回戦のマップを出しておく (arm で改めて確定する)
    const firstMap = mapForStage(binding.loaded, 0);
    if (firstMap) room.manager.loadMap(firstMap);

    this.publish(roomId);
  }

  unbind(roomId: string): void {
    const b = this.byRoom.get(roomId);
    if (!b) return;
    clearInterval(b.keepalive);
    this.deps.rm.getRoom(roomId)?.manager.off('status', b.listener);
    this.byRoom.delete(roomId);
    this.roomOfCup.delete(b.tournamentId);
    this.publish(roomId);
  }

  /** ルームが破棄されたときの後始末 (RoomManager.onRoomDestroyed から呼ぶ) */
  handleRoomDestroyed(roomId: string): void {
    const b = this.byRoom.get(roomId);
    if (!b) return;
    clearInterval(b.keepalive);
    this.byRoom.delete(roomId);
    this.roomOfCup.delete(b.tournamentId);
  }

  shutdown(): void {
    for (const roomId of Array.from(this.byRoom.keys())) this.unbind(roomId);
  }

  // ── 運営コマンド ──────────────────────────────────────────────────────────

  /**
   * 対戦カードをスロットへ割り当てて、あとは「ゲームスタート」を押すだけの状態にする。
   *
   * 順序が重要: requestReset() → setDoubleMode() → setClientType() ×2。
   * requestReset は resetAllToDefault() で processConfig を消すため、先に割り当てると失われる。
   * また roundResults を空にすることで canEditMap()/canStart() の両ゲートが通るようになる。
   */
  async armMatch(roomId: string, matchId: string): Promise<void> {
    const b     = this.require(roomId);
    const match = this.requireMatch(b, matchId);

    if (b.armedMatchId && b.armedMatchId !== matchId) {
      throw new TournamentError('別の試合が準備中です。先にそちらを終えるか取り消してください');
    }
    if (match.status !== 'ready' && match.status !== 'armed') {
      throw new TournamentError(`この試合はまだ開始できません (${match.status})`);
    }
    if (!match.resolvedA || !match.resolvedB) {
      throw new TournamentError('対戦相手がまだ確定していません');
    }

    const participants = resolveParticipants(b.loaded);
    const a  = this.requireParticipant(participants, match.resolvedA);
    const bp = this.requireParticipant(participants, match.resolvedB);

    // スロットへ触る前に両者ぶんを解決しておく。片方だけ割り当ててから失敗すると
    // COOL だけ準備完了・HOT は未選択という中途半端な状態が残ってしまう
    const configs = [this.resolveSlotConfig(a, 0, roomId), this.resolveSlotConfig(bp, 1, roomId)];

    const room = this.deps.rm.getRoom(roomId);
    if (!room) throw new TournamentError('ルームが見つかりません');
    const manager = room.manager;

    manager.setDemoMode(false);
    manager.setRepeatMode(false);

    await manager.requestReset();
    manager.setDoubleMode(b.loaded.def.rules.doubleMode);

    // 再試合の指定 → 回戦ごとのマップ → 大会全体の固定マップ の順に効かせる
    const mapId = mapForMatch(b.loaded, match);
    if (mapId) manager.loadMap(mapId);

    for (const c of configs) {
      await manager.setClientType(c.slot, c.type, c.processConfig);
    }

    b.armedMatchId = matchId;
    this.updateMatch(b, matchId, m => ({ ...m, status: 'armed' }));
    this.publish(roomId);
  }

  /** 準備を取り消して ready に戻す */
  cancelArm(roomId: string): void {
    const b = this.require(roomId);
    if (!b.armedMatchId) return;
    this.updateMatch(b, b.armedMatchId, m => ({ ...m, status: 'ready' }));
    b.armedMatchId = null;
    this.publish(roomId);
  }

  confirmResult(
    roomId: string, matchId: string, winnerSide?: 0 | 1, note?: string,
  ): void {
    const b     = this.require(roomId);
    const match = this.requireMatch(b, matchId);
    if (!match.result) throw new TournamentError('確定できる結果がありません');

    const decided = winnerSide !== undefined ? winnerSide : match.result.winnerSide;
    if (decided === null && b.loaded.def.format !== 'league') {
      // トーナメントで勝者不在のまま確定すると勝ち上がりが決まらず詰む
      throw new TournamentError('同点です。再試合するか、勝者を指定してください');
    }

    const patch: Parameters<typeof confirmInGraph>[2] = {};
    if (winnerSide !== undefined) {
      patch.winnerSide = winnerSide;
      patch.decidedBy  = 'manual';
    }
    if (note !== undefined) patch.note = note;

    this.commit(b, confirmInGraph(b.loaded.state.matches, matchId, patch));
    if (b.armedMatchId === matchId) b.armedMatchId = null;
    this.publish(roomId);
  }

  /**
   * やり直し / 同点の再試合。結果を捨てて ready に戻す。
   *
   * 公式ルールは同点時に「マップを変更して再試合を行う」と定めている。ランダムマップなら
   * requestReset() が自動で引き直すが、大会で固定マップを使っている場合は引き直されないため、
   * 別マップの指定を必須にする (同じマップのまま再試合するとルール違反になる)。
   *
   * 「固定かどうか」は回戦ごとのマップも含めた実効値で見る — 大会全体はランダムでも
   * その回戦だけマップを指定していれば、やはり引き直されない。
   */
  discardResult(roomId: string, matchId: string, rematchMapCatalogId?: string): void {
    const b     = this.require(roomId);
    const match = this.requireMatch(b, matchId);

    const wasTie   = match.result?.winnerSide === null;
    const fixedMap = mapForStage(b.loaded, match.stage);
    if (wasTie && fixedMap && !rematchMapCatalogId) {
      throw new TournamentError('同点の再試合ではマップを変更してください (別のマップを選んでから実行してください)');
    }

    this.commit(b, discardInGraph(b.loaded.state.matches, matchId, rematchMapCatalogId));
    if (b.armedMatchId === matchId) b.armedMatchId = null;
    this.publish(roomId);
  }

  /** 確定を取り消す。下流に確定済みがあれば cascade が要る */
  reopenMatch(roomId: string, matchId: string, cascade = false): void {
    const b = this.require(roomId);
    this.requireMatch(b, matchId);
    if (!cascade && hasConfirmedDownstream(b.loaded.state.matches, matchId)) {
      throw new TournamentError('この試合より後の結果も取り消されます。確認のうえ実行してください');
    }
    this.commit(b, reopenInGraph(b.loaded.state.matches, matchId));
    if (b.armedMatchId === matchId) b.armedMatchId = null;
    this.publish(roomId);
  }

  /** 不戦勝・両者棄権 (対戦せずに確定させる) */
  setWalkover(roomId: string, matchId: string, winnerSide: 0 | 1 | null): void {
    const b = this.require(roomId);
    this.requireMatch(b, matchId);
    this.commit(b, walkoverInGraph(b.loaded.state.matches, matchId, winnerSide));
    if (b.armedMatchId === matchId) b.armedMatchId = null;
    this.publish(roomId);
  }

  /**
   * 回戦 (stage) ごとのマップを差し替える。null で「大会の設定に従う」に戻す。
   *
   * 定義 (tournament.json) は配布物なので書き換えず、state.json 側に上書きとして持つ
   * (プログラムの割り当てと同じ考え方)。既に準備済みの試合がその回戦なら、次の arm を
   * 待たずにその場でマップを読み直す — でないと「変えたのに反映されない」が起きる。
   */
  setStageMap(roomId: string, stage: number, mapCatalogId: string | null): void {
    const b = this.require(roomId);

    const count = stageCountOf(b.loaded.state.matches);
    if (!Number.isInteger(stage) || stage < 0 || stage >= count) {
      throw new TournamentError('その回戦は存在しません');
    }
    if (b.loaded.def.format !== 'single-elimination') {
      throw new TournamentError('回戦ごとのマップはトーナメント (勝ち上がり) でのみ設定できます');
    }

    const overrides = { ...(b.loaded.state.stageMapOverrides ?? {}), [String(stage)]: mapCatalogId };
    b.loaded = {
      ...b.loaded,
      state: { ...b.loaded.state, stageMapOverrides: overrides, updatedAt: Date.now() },
    };
    saveState(b.loaded.state);

    // 準備済みの試合が同じ回戦なら、その場で反映する。1ゲームでも消化していると
    // RoundController.canEditMap が塞ぐので、その場合は次の arm に任せる。
    const armed = b.armedMatchId
      ? b.loaded.state.matches.find(m => m.id === b.armedMatchId)
      : undefined;
    if (armed && armed.stage === stage && armed.status === 'armed') {
      const manager = this.deps.rm.getRoom(roomId)?.manager;
      const mapId   = mapForMatch(b.loaded, armed);
      if (manager && mapId) manager.loadMap(mapId);
    }

    this.publish(roomId);
  }

  /** 未提出だった参加者に、当日届いたプログラムを紐付ける */
  assignProgram(roomId: string, participantId: string, catalogId: string | null): void {
    const b = this.require(roomId);
    const updated = assignProgram(b.tournamentId, participantId, catalogId);
    if (!updated) throw new TournamentError('参加者またはプログラムが見つかりません');
    b.loaded = updated;
    this.publish(roomId);
  }

  /** server/tournament/ を再走査し、運営中の大会も読み直す */
  rescan(roomId: string): void {
    scanTournaments(id => this.boundRoomOf(id));
    const b = this.byRoom.get(roomId);
    if (b) {
      const reloaded = loadTournament(b.tournamentId);
      if (reloaded) b.loaded = reloaded;
    }
    this.publish(roomId);
  }

  // ── ServerManager の状態変化を受ける ──────────────────────────────────────

  private onServerStatus(roomId: string, st: ServerStatusPayload): void {
    const b = this.byRoom.get(roomId);
    if (!b) return;

    // デモ・リピートが別のコントロール窓から有効化されても打ち消す (自己修復)
    const manager = this.deps.rm.getRoom(roomId)?.manager;
    if (manager && (st.demoMode || st.repeatMode)) {
      if (st.demoMode)   manager.setDemoMode(false);
      if (st.repeatMode) manager.setRepeatMode(false);
      return; // setXxxMode が再度 status を発火するのでここでは進めない
    }

    const armedId = b.armedMatchId;
    if (!armedId) return;
    const match = b.loaded.state.matches.find(m => m.id === armedId);
    if (!match) return;

    const expected = b.loaded.def.rules.doubleMode ? 2 : 1;

    if (match.status === 'armed' && st.phase === 'playing') {
      this.updateMatch(b, armedId, m => ({ ...m, status: 'in_progress' }));
      this.publish(roomId);
      return;
    }

    if (match.status === 'in_progress') {
      if (st.phase === 'finished' && st.roundResults.length >= expected) {
        // 全ゲーム終了。結果を取り込んで運営の確定を待つ
        // (この時点で state.json に保存するので、以降にリセットされても結果は失われない)
        this.commit(b, captureResult(
          b.loaded.state.matches, armedId, buildMatchResult(st.roundResults.slice(0, expected)),
        ));
        this.publish(roomId);
        return;
      }
      if (st.phase === 'setup' && st.roundResults.length === 0) {
        // 運営が中断・リセットした → カードは未実施へ戻す
        this.updateMatch(b, armedId, m => ({ ...m, status: 'ready' }));
        b.armedMatchId = null;
        this.publish(roomId);
        return;
      }
    }

    if (match.status === 'armed' && st.phase === 'setup' && st.roundResults.length === 0) {
      // まだ始まっていない状態でリセットされた場合は準備だけ取り消す
      return;
    }
  }

  // ── 補助 ──────────────────────────────────────────────────────────────────

  /** 参加者をスロット設定へ解決する (副作用なし。失敗するならここで分かる) */
  private resolveSlotConfig(
    p: ResolvedParticipant, slot: 0 | 1, roomId: string,
  ): { slot: 0 | 1; type: ClientType; processConfig?: ProcessConfig } {
    if (p.builtinCpu) return { slot, type: 'cpu' };

    if (!p.programCatalogId) {
      throw new TournamentError(`${p.name} のプログラムが登録されていません`);
    }
    const entry = getCatalogEntry(p.programCatalogId);
    if (!entry) {
      throw new TournamentError(`${p.name} のプログラムがライブラリに見つかりません`);
    }
    return { slot, type: 'process', processConfig: buildProcessConfig(entry, slot, roomId) };
  }

  private require(roomId: string): Binding {
    const b = this.byRoom.get(roomId);
    if (!b) throw new TournamentError('この部屋では大会を運営していません');
    return b;
  }

  private requireMatch(b: Binding, matchId: string): TournamentMatch {
    const m = b.loaded.state.matches.find(x => x.id === matchId);
    if (!m) throw new TournamentError('試合が見つかりません');
    return m;
  }

  private requireParticipant(ps: ResolvedParticipant[], id: string): ResolvedParticipant {
    const p = ps.find(x => x.id === id);
    if (!p) throw new TournamentError('参加者が見つかりません');
    return p;
  }

  private updateMatch(
    b: Binding, matchId: string, fn: (m: TournamentMatch) => TournamentMatch,
  ): void {
    this.commit(b, b.loaded.state.matches.map(m => (m.id === matchId ? fn(m) : m)));
  }

  private commit(b: Binding, matches: TournamentMatch[]): void {
    b.loaded = { ...b.loaded, state: { ...b.loaded.state, matches, updatedAt: Date.now() } };
    saveState(b.loaded.state);
  }

  private payloadFor(roomId: string): TournamentStatePayload | null {
    const b = this.byRoom.get(roomId);
    return b ? buildStatePayload(b.loaded, roomId, b.armedMatchId) : null;
  }

  private publish(roomId: string): void {
    this.deps.broadcast(roomId, { type: 'tournament_state', payload: this.payloadFor(roomId) });
  }
}

/** 完了したゲーム結果から、試合の結果レコードを組み立てる */
function buildMatchResult(roundResults: ServerStatusPayload['roundResults']): TournamentMatchResult {
  const set = computeSetResult(roundResults);
  return {
    roundResults,
    set,
    // side0 = slotA の不変条件により、computeSetResult の winnerSide がそのまま使える
    winnerSide: set.winnerSide,
    decidedBy:  set.decidedBy ?? 'points',
    capturedAt: Date.now(),
  };
}
