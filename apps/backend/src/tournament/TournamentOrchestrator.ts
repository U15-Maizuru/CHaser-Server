import type {
  AutoPlayTieBreak,
  ServerStatusPayload,
  TournamentAutoPlay,
  TournamentDisplayView,
  TournamentStatePayload,
  WsMessage,
} from '@u15/ws-types';
import { canRunInSideLane, hasBotStage, hasQualifying, nextReadyMatches } from '@u15/ws-types';
import type { RoomManager } from '../RoomManager.js';
import { PortPool } from '../network/PortPool.js';
import {
  TournamentError, armedMatchIds, commit, laneOfRoom, managerOf, primaryLane, resolveFor,
  type Binding, type Lane,
} from './binding.js';
import {
  armMatch, cancelArm, confirmResult, discardResult, pickLaneFor, reopenMatch, setMatchMap,
  setStageMap, setWalkover, swapSides,
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
// 保存はグローバル (大会単位)、実行はレーン単位。1大会 ⇄ 1つの主ルームの双方向排他で、
// 並列実行するときは副レーンの部屋がそこにぶら下がる (Binding.lanes)。

export { TournamentError } from './binding.js';

/** bind 中はこの間隔でルームを touch し、TTL (30分) で消えるのを防ぐ */
const KEEPALIVE_MS = 60_000;

/**
 * 同時に走らせる試合の数の上限。
 *
 * 実装上の限界ではなく**運用上の限界**。1レーンにつき対戦プログラム2本が起動し、
 * 観戦画面もそのぶん盤面を描くので、増やすほど1試合あたりの描画も CPU も痩せる。
 * 分割画面で盤面が読める大きさに収まるのもこのあたりまで。
 */
const MAX_LANES = 4;

const AUTO_PLAY_OFF: TournamentAutoPlay = {
  enabled: false, loop: false, announce: false, tieBreak: 'pause', stoppedReason: null,
};

export interface OrchestratorDeps {
  rm:        RoomManager;
  broadcast: (roomId: string, msg: WsMessage) => void;
  /** 自動進行の待機時間 (テストで縮めるためだけの穴。既定は視認性を優先した秒単位) */
  autoPlayDelaysMs?: Partial<AutoPlayDelaysMs>;
  /** 自動進行の乱数 (同点の抽選・デモモードの組み合わせシャッフル)。テストで固定するための穴 */
  random?: () => number;
  /**
   * 並列実行の副レーンへ払い出す TCP ポートの範囲。**渡さないと並列実行できない。**
   *
   * ローカルモード (会場の Electron アプリ) だけが渡す。web モードのルームは
   * RoomManager 自身の PortPool から出ており、そこへ二重に払い出すと衝突するため。
   */
  lanePortRange?: [number, number];
}

export class TournamentOrchestrator {
  /** **レーンの部屋すべて**が引ける (主レーンも副レーンも同じ Binding を指す) */
  private readonly byRoom    = new Map<string, Binding>();
  /** 大会 → 主レーンの部屋 */
  private readonly roomOfCup = new Map<string, string>();
  private readonly env:      AutoPlayEnv;
  /** 副レーン用のポート。RoomManager ではなくこちらが持ち、レーンを畳むときに返す */
  private readonly lanePool: PortPool | null;

  constructor(private readonly deps: OrchestratorDeps) {
    this.lanePool = deps.lanePortRange
      ? new PortPool(deps.lanePortRange[0], deps.lanePortRange[1])
      : null;
    this.env = {
      rm:      deps.rm,
      publish: roomId => this.publish(roomId),
      delays:  { ...DEFAULT_AUTO_PLAY_DELAYS_MS, ...deps.autoPlayDelaysMs },
      random:  deps.random ?? Math.random,
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
      // 主レーンは bind した部屋そのもの。副レーンは setLaneCount で後から足す
      lanes: [{
        roomId,
        primary:      true,
        armedMatchId: null,
        lastStatus:   room.manager.getStatus(),
        autoTimer:    null,
        listener,
      }],
      displayView:  'auto',
      autoPlay:     AUTO_PLAY_OFF,
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
    const primary = primaryLane(b);
    this.detach(b);
    const manager = this.deps.rm.getRoom(primary.roomId)?.manager;
    manager?.off('status', primary.listener);
    // 大会運営中はスロット割り当て・フェーズを大会側が握っている。運営を終える
    // (途中で中断する場合も含む) ときにリセットしておかないと、コントロール窓が
    // 大会最後の対戦のフェーズに固まったまま手動操作に戻れなくなる
    manager?.requestReset().catch(e => console.error('大会運営終了時のリセットに失敗しました:', e));
    this.publish(primary.roomId);
  }

  /** ルームが破棄されたときの後始末 (RoomManager.onRoomDestroyed から呼ぶ) */
  handleRoomDestroyed(roomId: string): void {
    const b = this.byRoom.get(roomId);
    if (!b) return;
    const lane = laneOfRoom(b, roomId);
    // 副レーンの部屋が消えただけなら、そのレーンを畳んで運営は続ける
    if (lane && !lane.primary) {
      this.removeLane(b, lane);
      this.publish(b.roomId);
      return;
    }
    this.detach(b);
  }

  shutdown(): void {
    const primaries = new Set(Array.from(this.byRoom.values(), b => b.roomId));
    for (const roomId of primaries) this.unbind(roomId);
  }

  private detach(b: Binding): void {
    clearInterval(b.keepalive);
    clearTimer(b);
    // 副レーンは大会に紐づく実行環境なので、運営を終えるときに畳む
    for (const lane of [...b.lanes]) if (!lane.primary) this.removeLane(b, lane);
    this.byRoom.delete(b.roomId);
    this.roomOfCup.delete(b.tournamentId);
  }

  // ── レーン ────────────────────────────────────────────────────────────────

  /**
   * 同時に走らせる試合の数を変える。増やすと副レーンの部屋と TCP ポート対を確保する。
   *
   * **どのレーンも空いているときにしか変えられない** — 走っている対戦の足元で部屋を
   * 消すことになるため。2 以上にできるのは BOT対戦予選のある大会だけで、増やした
   * 副レーンには予選試合しか流れない (canRunInSideLane)。
   */
  setLaneCount(roomId: string, count: number): void {
    const b = this.require(roomId);
    const n = Math.floor(count);
    if (!Number.isFinite(n) || n < 1 || n > MAX_LANES) {
      throw new TournamentError(`同時に行える試合数は 1〜${MAX_LANES} です`);
    }
    if (n === b.lanes.length) return;
    if (n > 1 && !hasBotStage(b.loaded.def.stage.format)) {
      throw new TournamentError('同時に複数の試合を行えるのは BOT対戦予選のある大会だけです');
    }
    if (b.lanes.some(l => l.armedMatchId !== null)) {
      throw new TournamentError('準備中・対戦中の試合があります。先に終えるか取り消してください');
    }

    while (b.lanes.length < n) this.addLane(b);
    while (b.lanes.length > n) this.removeLane(b, b.lanes[b.lanes.length - 1]!);
    this.publish(b.roomId);
  }

  /**
   * 空いているレーンへ、次に実施すべき試合をまとめて配る。
   *
   * 並列にできる試合 (BOT対戦予選) があるならそれを空きぶん配り、無ければ
   * 次の1試合だけを準備する。**両者を混ぜない** — 主戦場の試合は単独で行う。
   */
  async armNext(roomId: string): Promise<void> {
    const b      = this.require(roomId);
    const format = b.loaded.def.stage.format;
    const busy   = armedMatchIds(b);
    const idle   = b.lanes.filter(l => l.armedMatchId === null);
    if (idle.length === 0) return;

    const parallel = nextReadyMatches(b.loaded.state.matches, idle.length, {
      busyIds: busy,
      canRun:  m => canRunInSideLane(format, m),
    });
    if (parallel.length > 0) {
      for (const [i, match] of parallel.entries()) {
        await armMatch(this.env, b, idle[i]!, match.id);
      }
      return;
    }

    // 並列にできる試合が無い → 次の1試合を。pickLaneFor が
    // 「他のレーンが空いているか」を見て断ってくれる
    const next = nextReadyMatches(b.loaded.state.matches, 1, { busyIds: busy })[0];
    if (next) await armMatch(this.env, b, pickLaneFor(b, next.id), next.id);
  }

  /**
   * 準備済みのレーンをまとめて開始する。
   *
   * **副レーンにはコントロール窓が無い** (窓は主レーンの部屋にしか開かない) ので、
   * 並列実行中の「ゲームスタート」はここが代わりに押す。準備できていないレーンは飛ばす。
   *
   * requestStart は対戦が終わるまで返らないので待たない — 進行は status イベントが運ぶ。
   */
  startLanes(roomId: string): void {
    const b = this.require(roomId);
    for (const lane of b.lanes) {
      if (lane.armedMatchId === null) continue;
      void managerOf(this.env, lane.roomId)?.requestStart();
    }
  }

  /**
   * 副レーンを1本足す。専用の部屋と TCP ポート対を確保して status を橋渡しする。
   *
   * 部屋は RoomManager に**固定ポートで**作らせる (ポートはこちらの PortPool が持つ) ので、
   * 畳むときはこちらでポートを返す — RoomManager 側の自動解放は web モードの
   * プールぶんだけを見ており、こちらのぶんは知らない。
   */
  private addLane(b: Binding): void {
    if (!this.lanePool) throw new TournamentError('このモードでは同時実行できません');

    const p0 = this.lanePool.alloc();
    const p1 = this.lanePool.alloc();
    if (p0 === null || p1 === null) {
      if (p0 !== null) this.lanePool.release(p0);
      if (p1 !== null) this.lanePool.release(p1);
      throw new TournamentError('同時実行に使える待ち受けポートが足りません');
    }

    const roomId = `${b.roomId}-lane${b.lanes.length}`;
    const room   = this.deps.rm.createRoom(roomId, [p0, p1]);
    if (!room) {
      this.lanePool.release(p0);
      this.lanePool.release(p1);
      throw new TournamentError('同時実行用のルームを作成できませんでした');
    }

    const listener = (st: ServerStatusPayload) => this.onServerStatus(roomId, st);
    room.manager.on('status', listener);
    b.lanes.push({
      roomId,
      primary:      false,
      armedMatchId: null,
      lastStatus:   room.manager.getStatus(),
      autoTimer:    null,
      listener,
    });
    this.byRoom.set(roomId, b);

    // 主レーンの bind と同じ初期化 (デモ・リピートと排他にし、最初の回戦のマップを出す)
    room.manager.setDemoMode(false);
    room.manager.setRepeatMode(false);
    const firstMap = mapForStage(b.loaded, 0);
    if (firstMap) room.manager.loadMap(firstMap);
  }

  /** 副レーンを畳む。主レーンには効かない */
  private removeLane(b: Binding, lane: Lane): void {
    if (lane.primary) return;
    if (lane.autoTimer) {
      clearTimeout(lane.autoTimer);
      lane.autoTimer = null;
    }
    const room = this.deps.rm.getRoom(lane.roomId);
    room?.manager.off('status', lane.listener);
    // 先に外しておく。destroyRoom が handleRoomDestroyed を呼び返すので、
    // ここが残っているとレーンを二重に畳もうとする
    this.byRoom.delete(lane.roomId);
    b.lanes = b.lanes.filter(l => l !== lane);

    const ports = room?.ports;
    this.deps.rm.destroyRoom(lane.roomId);
    if (ports) {
      this.lanePool?.release(ports[0]);
      this.lanePool?.release(ports[1]);
    }
  }

  // ── 運営コマンド ──────────────────────────────────────────────────────────

  // async のまま保つ。同期的に投げると呼び出し側が try/catch と .catch() の
  // 両方を書く羽目になるので、失敗は必ず rejection で返す
  async armMatch(roomId: string, matchId: string): Promise<void> {
    const b = this.require(roomId);
    return armMatch(this.env, b, pickLaneFor(b, matchId), matchId);
  }

  /** matchId を省略すると、準備中のレーンをすべて取り消す */
  cancelArm(roomId: string, matchId?: string): void {
    cancelArm(this.env, this.require(roomId), matchId);
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
   * `loop` / `announce` / `tieBreak` を省略すると今の設定を保つ — パネルのボタン (自動で進める /
   * 繰り返す / アナウンスを挟む / 同点の扱い) が互いの設定を巻き戻さないようにするため。
   * 入れ直しは停止理由も消す。
   */
  setAutoPlay(
    roomId: string, enabled: boolean, loop?: boolean, announce?: boolean, tieBreak?: AutoPlayTieBreak,
  ): void {
    const b = this.require(roomId);
    b.autoPlay = {
      enabled,
      loop:     loop     ?? b.autoPlay.loop,
      announce: announce ?? b.autoPlay.announce,
      tieBreak: tieBreak ?? b.autoPlay.tieBreak,
      stoppedReason: null,
    };
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
    // どのレーンから来た status か。レーンごとに独立して進むので取り違えない
    const lane = laneOfRoom(b, roomId);
    if (!lane) return;
    // 自動進行の判断材料。**先に更新すること** — この下の経路は publish して
    // そこから次の一手を予約するので、古い status で判断すると1手ぶんズレる
    lane.lastStatus = st;
    applyServerStatus(this.env, b, lane, st);
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

  /**
   * 配信する状態。**部屋がレーンのどれであっても、大会としては同じものを配る** —
   * boundRoomId と armedMatchId は常に主レーンのものにして、
   * 「どのレーンで何が走っているか」は lanes に入れる。
   */
  private payloadFor(roomId: string): TournamentStatePayload | null {
    const b = this.byRoom.get(roomId);
    if (!b) return null;
    return buildStatePayload(
      b.loaded, b.roomId, primaryLane(b).armedMatchId, b.displayView, b.autoPlay,
      b.lanes.map(l => ({ roomId: l.roomId, primary: l.primary, armedMatchId: l.armedMatchId })),
    );
  }

  /**
   * 配信する。**状態が変わる操作は必ずここを通る**ので、自動進行の次の一手も
   * ここで予約する (操作ごとに書いて回ると必ず1つ書き漏らす)。
   *
   * 並列実行中は**全レーンの部屋へ同じものを配る。** 分割画面の観戦窓は各レーンの部屋へ
   * join して盤面を受け取るので、大会の状態もそこへ届かないと表を出せない。
   */
  private publish(roomId: string): void {
    const b = this.byRoom.get(roomId);
    if (!b) {
      // unbind 直後。運営が終わったことを伝える
      this.deps.broadcast(roomId, { type: 'tournament_state', payload: null });
      return;
    }
    const payload = this.payloadFor(b.roomId);
    for (const lane of b.lanes) {
      this.deps.broadcast(lane.roomId, { type: 'tournament_state', payload });
    }
    scheduleNext(this.env, b);
  }
}
