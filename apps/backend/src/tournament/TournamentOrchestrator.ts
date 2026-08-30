import type {
  ServerStatusPayload,
  TournamentAutoPlay,
  TournamentDisplayView,
  TournamentStatePayload,
  WsMessage,
} from '@u15/ws-types';
import { hasQualifying } from '@u15/ws-types';
import type { RoomManager } from '../RoomManager.js';
import { TournamentError, commit, resolveFor, type Binding } from './binding.js';
import {
  armMatch, cancelArm, confirmResult, discardResult, reopenMatch, setMatchMap, setStageMap,
  setWalkover, swapSides,
} from './matchCommands.js';
import { confirmQualifiers, setQualifier, setQualifierExclusion } from './qualifierCommands.js';
import { applyServerStatus } from './statusBridge.js';
import { clearTimer, scheduleNext, type AutoPlayEnv } from './autoPlayRunner.js';
import { DEFAULT_AUTO_PLAY_DELAYS_MS, type AutoPlayDelaysMs } from './autoPlay.js';
import {
  assignProgram, buildStatePayload, loadTournament, mapForStage, scanTournaments,
  type LoadedTournament,
} from './TournamentStore.js';

// 大会の進行と ServerManager の橋渡し。
//
// ServerManager / RoundController / SlotManager / RoomManager にはトーナメントの知識を
// 一切持たせない。ここが公開 API と 'status' イベントだけを使って外から駆動する。
//
// このクラスが持つのは「どの部屋でどの大会を運営中か」と配信だけ。個々の操作は
// matchCommands / qualifierCommands / statusBridge / autoPlayRunner にある。
//
// 保存はグローバル (大会単位)、実行はルーム単位。1大会 ⇄ 1ルームの双方向排他。

export { TournamentError } from './binding.js';

/** bind 中はこの間隔でルームを touch し、TTL (30分) で消えるのを防ぐ */
const KEEPALIVE_MS = 60_000;

const AUTO_PLAY_OFF: TournamentAutoPlay = { enabled: false, loop: false, stoppedReason: null };

export interface OrchestratorDeps {
  rm:        RoomManager;
  broadcast: (roomId: string, msg: WsMessage) => void;
  /** 自動進行の待機時間 (テストで縮めるためだけの穴。既定は視認性を優先した秒単位) */
  autoPlayDelaysMs?: Partial<AutoPlayDelaysMs>;
}

export class TournamentOrchestrator {
  private readonly byRoom    = new Map<string, Binding>();
  private readonly roomOfCup = new Map<string, string>();
  private readonly env:      AutoPlayEnv;

  constructor(private readonly deps: OrchestratorDeps) {
    this.env = {
      rm:      deps.rm,
      publish: roomId => this.publish(roomId),
      delays:  { ...DEFAULT_AUTO_PLAY_DELAYS_MS, ...deps.autoPlayDelaysMs },
      stop:    (b, reason) => this.stopAuto(b, reason),
    };
  }

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

    const found = loadTournament(tournamentId);
    if (!found) throw new TournamentError('大会が見つかりません');

    // **ここが「大会運営の開始」。** 開始するまでは bye も未対戦のままにしてあるので、
    // この時点で startedAt を入れ、下の resolveMatches で不戦勝を確定させる
    // (2回目以降の bind では既に入っているので、時刻は最初の1回で固定される)
    const loaded: LoadedTournament = found.state.startedAt !== null
      ? found
      : { ...found, state: { ...found.state, startedAt: Date.now() } };

    // armed / in_progress はスロット割り当てというプロセス内の状態と対になっている。
    // 前回の運営が中断したまま保存されているとカードが永久に「準備中」で詰まるので、
    // bind のたびに ready へ戻す (結果を持つカードは resolveMatches 側が優先する)
    const revived = loaded.state.matches.map(m =>
      (m.status === 'armed' || m.status === 'in_progress') ? { ...m, status: 'ready' as const } : m);

    const listener = (st: ServerStatusPayload) => this.onServerStatus(roomId, st);
    room.manager.on('status', listener);

    const binding: Binding = {
      roomId,
      tournamentId,
      loaded,
      armedMatchId: null,
      displayView:  'auto',
      autoPlay:     AUTO_PLAY_OFF,
      lastStatus:   room.manager.getStatus(),
      autoTimer:    null,
      listener,
      keepalive: setInterval(() => this.deps.rm.touchRoom(roomId), KEEPALIVE_MS),
    };
    this.byRoom.set(roomId, binding);
    this.roomOfCup.set(tournamentId, roomId);
    // 文脈は binding の startedAt を見るので、ここで初めて bye が不戦勝になる
    commit(binding, resolveFor(binding, revived));

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
    this.detach(b);
    const manager = this.deps.rm.getRoom(roomId)?.manager;
    manager?.off('status', b.listener);
    // 大会運営中はスロット割り当て・フェーズを大会側が握っている。運営を終える
    // (途中で中断する場合も含む) ときにリセットしておかないと、コントロール窓が
    // 大会最後の対戦のフェーズに固まったまま手動操作に戻れなくなる
    manager?.requestReset().catch(e => console.error('大会運営終了時のリセットに失敗しました:', e));
    this.publish(roomId);
  }

  /** ルームが破棄されたときの後始末 (RoomManager.onRoomDestroyed から呼ぶ) */
  handleRoomDestroyed(roomId: string): void {
    const b = this.byRoom.get(roomId);
    if (b) this.detach(b);
  }

  shutdown(): void {
    for (const roomId of Array.from(this.byRoom.keys())) this.unbind(roomId);
  }

  private detach(b: Binding): void {
    clearInterval(b.keepalive);
    clearTimer(b);
    this.byRoom.delete(b.roomId);
    this.roomOfCup.delete(b.tournamentId);
  }

  // ── 運営コマンド ──────────────────────────────────────────────────────────

  // async のまま保つ。同期的に投げると呼び出し側が try/catch と .catch() の
  // 両方を書く羽目になるので、失敗は必ず rejection で返す
  async armMatch(roomId: string, matchId: string): Promise<void> {
    return armMatch(this.env, this.require(roomId), matchId);
  }

  cancelArm(roomId: string): void {
    cancelArm(this.env, this.require(roomId));
  }

  confirmResult(roomId: string, matchId: string, winnerSide?: 0 | 1, note?: string): void {
    confirmResult(this.env, this.require(roomId), matchId, winnerSide, note);
  }

  discardResult(roomId: string, matchId: string, rematchMapCatalogId?: string): void {
    discardResult(this.env, this.require(roomId), matchId, rematchMapCatalogId);
  }

  reopenMatch(roomId: string, matchId: string, cascade = false): void {
    reopenMatch(this.env, this.require(roomId), matchId, cascade);
  }

  setWalkover(roomId: string, matchId: string, winnerSide: 0 | 1 | null): void {
    setWalkover(this.env, this.require(roomId), matchId, winnerSide);
  }

  setStageMap(roomId: string, stage: number, mapCatalogId: string | null): void {
    setStageMap(this.env, this.require(roomId), stage, mapCatalogId);
  }

  setMatchMap(roomId: string, matchId: string, mapCatalogId: string | null): void {
    setMatchMap(this.env, this.require(roomId), matchId, mapCatalogId);
  }

  swapSides(roomId: string, matchId: string): void {
    swapSides(this.env, this.require(roomId), matchId);
  }

  setQualifier(
    roomId: string, group: number, rank: number, participantId: string | null, cascade = false,
  ): void {
    setQualifier(this.env, this.require(roomId), group, rank, participantId, cascade);
  }

  setQualifierExclusion(
    roomId: string, participantId: string, excluded: boolean, cascade = false,
  ): void {
    setQualifierExclusion(this.env, this.require(roomId), participantId, excluded, cascade);
  }

  confirmQualifiers(roomId: string, confirmed: boolean): void {
    confirmQualifiers(this.env, this.require(roomId), confirmed);
  }

  /**
   * 観戦画面に出すものを切り替える。
   *
   * **運営席 (?mode=tournament) の表示とは連動しない。** 観客には予選表を出したまま、
   * 手元では決勝の組み合わせを確認したい、という場面があるため別々に持つ。
   */
  setDisplayView(roomId: string, view: TournamentDisplayView): void {
    const b = this.require(roomId);
    if (!hasQualifying(b.loaded.def.stage.format)) {
      throw new TournamentError('この大会には切り替える表がありません');
    }
    b.displayView = view;
    this.publish(roomId);
  }

  /**
   * 自動進行 (オートプレイ) を入れる / 切る。
   *
   * `loop` を省略すると今の設定を保つ — パネルの2つのボタン (自動で進める / 繰り返す) が
   * 互いの設定を巻き戻さないようにするため。入れ直しは停止理由も消す。
   */
  setAutoPlay(roomId: string, enabled: boolean, loop?: boolean): void {
    const b = this.require(roomId);
    b.autoPlay = { enabled, loop: loop ?? b.autoPlay.loop, stoppedReason: null };
    if (!enabled) clearTimer(b);
    this.publish(roomId);   // publish の中で次の一手を予約する
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

  // ── 内部 ──────────────────────────────────────────────────────────────────

  private onServerStatus(roomId: string, st: ServerStatusPayload): void {
    const b = this.byRoom.get(roomId);
    if (!b) return;
    // 自動進行の判断材料。**先に更新すること** — この下の経路は publish して
    // そこから次の一手を予約するので、古い status で判断すると1手ぶんズレる
    b.lastStatus = st;
    applyServerStatus(this.env, b, st);
    // 状態が変わらなかった (publish しなかった) 経路のための保険。
    // 予約済みなら scheduleNext は何もしないので、二重に予約されることはない
    scheduleNext(this.env, b);
  }

  private stopAuto(b: Binding, reason: string): void {
    clearTimer(b);
    b.autoPlay = { ...b.autoPlay, enabled: false, stoppedReason: reason };
    this.publish(b.roomId);
  }

  private require(roomId: string): Binding {
    const b = this.byRoom.get(roomId);
    if (!b) throw new TournamentError('この部屋では大会を運営していません');
    return b;
  }

  private payloadFor(roomId: string): TournamentStatePayload | null {
    const b = this.byRoom.get(roomId);
    return b
      ? buildStatePayload(b.loaded, roomId, b.armedMatchId, b.displayView, b.autoPlay)
      : null;
  }

  /**
   * 配信する。**状態が変わる操作は必ずここを通る**ので、自動進行の次の一手も
   * ここで予約する (操作ごとに書いて回ると必ず1つ書き漏らす)。
   */
  private publish(roomId: string): void {
    this.deps.broadcast(roomId, { type: 'tournament_state', payload: this.payloadFor(roomId) });
    const b = this.byRoom.get(roomId);
    if (b) scheduleNext(this.env, b);
  }
}
