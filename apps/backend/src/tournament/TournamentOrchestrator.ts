import type {
  ClientType,
  ProcessConfig,
  ResolvedParticipant,
  ServerStatusPayload,
  TournamentAutoPlay,
  TournamentMatch,
  TournamentDisplayView,
  TournamentMatchResult,
  TournamentState,
  TournamentStatePayload,
  WsMessage,
} from '@u15/ws-types';
import { computeSetResult, groupLabel, hasBotStage, hasBracket, hasQualifying } from '@u15/ws-types';
import type { RoomManager } from '../RoomManager.js';
import { buildProcessConfig } from '../game/processConfig.js';
import { getCatalogEntry } from '../programCatalog.js';
import {
  assignProgram,
  buildMatches,
  buildStatePayload,
  groupsOf,
  loadTournament,
  mapForMatch,
  mapForStage,
  qualifiersConfirmedOf,
  qualifiersOf,
  resolveContextOf,
  resolveParticipants,
  saveState,
  scanTournaments,
  stageCountOf,
  type LoadedTournament,
} from './TournamentStore.js';
import { groupStageCountOf, isGroupStageDone } from './groupStage.js';
import { qualifierKey } from './qualifiers.js';
import {
  captureResult,
  confirmResult as confirmInGraph,
  discardResult as discardInGraph,
  downstreamOf,
  hasConfirmedDownstream,
  isKnockoutMatch,
  reopenMatch as reopenInGraph,
  setWalkover as walkoverInGraph,
} from './progress.js';
import {
  DEFAULT_AUTO_PLAY_DELAYS_MS,
  delayFor,
  nextAutoPlayAction,
  type AutoPlayAction,
  type AutoPlayDelaysMs,
} from './autoPlay.js';

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
  /** 観戦画面に出すもの。運営席の表示とは独立 (armedMatchId と同じくプロセス内の状態) */
  displayView:  TournamentDisplayView;
  /** 自動進行。armedMatchId と同じくプロセス内の状態なので bind のたびに切れている */
  autoPlay:     TournamentAutoPlay;
  /** 自動進行の判断材料。ServerManager の最新の status を持っておく */
  lastStatus:   ServerStatusPayload;
  /** 予約中の自動操作 (常に高々1つ) */
  autoTimer:    ReturnType<typeof setTimeout> | null;
  listener:     (st: ServerStatusPayload) => void;
  keepalive:    ReturnType<typeof setInterval>;
}

const AUTO_PLAY_OFF: TournamentAutoPlay = { enabled: false, loop: false, stoppedReason: null };

export interface OrchestratorDeps {
  rm:        RoomManager;
  broadcast: (roomId: string, msg: WsMessage) => void;
  /** 自動進行の待機時間 (テストで縮めるためだけの穴。既定は視認性を優先した秒単位) */
  autoPlayDelaysMs?: Partial<AutoPlayDelaysMs>;
}

export class TournamentOrchestrator {
  private readonly byRoom       = new Map<string, Binding>();
  private readonly roomOfCup    = new Map<string, string>();
  private readonly autoDelays:  AutoPlayDelaysMs;

  constructor(private readonly deps: OrchestratorDeps) {
    this.autoDelays = { ...DEFAULT_AUTO_PLAY_DELAYS_MS, ...deps.autoPlayDelaysMs };
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
      displayView:  'auto',
      autoPlay:     AUTO_PLAY_OFF,
      lastStatus:   room.manager.getStatus(),
      autoTimer:    null,
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
    this.clearAutoTimer(b);
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
    this.clearAutoTimer(b);
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
    // 予選ありの大会では、決勝進出者を運営が確定するまで決勝トーナメントを始めない。
    // 自動判定は必ず枠を埋めるので、確認を挟まないと同点の枠を誰も見ないまま
    // 決勝が始まってしまう
    if (isKnockoutMatch(b.loaded.def.format, match) && hasQualifying(b.loaded.def.format)
      && !qualifiersConfirmedOf(b.loaded)) {
      throw new TournamentError('先に決勝進出者を確定してください');
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
    // **判定は形式ではなく試合ごと。** 予選リーグの引き分けは正当な結果で勝ち点1が付くが、
    // 勝ち上がりの試合で勝者不在のまま確定すると次の対戦が決まらず詰む
    if (decided === null && isKnockoutMatch(b.loaded.def.format, match)) {
      throw new TournamentError('同点です。再試合するか、勝者を指定してください');
    }

    const patch: Parameters<typeof confirmInGraph>[2] = {};
    if (winnerSide !== undefined) {
      patch.winnerSide = winnerSide;
      patch.decidedBy  = 'manual';
    }
    if (note !== undefined) patch.note = note;

    this.commit(b, confirmInGraph(b.loaded.state.matches, matchId, patch, Date.now(), this.ctx(b)));
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

    this.commit(b, discardInGraph(b.loaded.state.matches, matchId, rematchMapCatalogId, this.ctx(b)));
    this.disarmIfCleared(b, matchId);
    this.publish(roomId);
  }

  /** 確定を取り消す。下流に確定済みがあれば cascade が要る */
  reopenMatch(roomId: string, matchId: string, cascade = false): void {
    const b = this.require(roomId);
    this.requireMatch(b, matchId);
    if (!cascade && hasConfirmedDownstream(b.loaded.state.matches, matchId)) {
      throw new TournamentError('この試合より後の結果も取り消されます。確認のうえ実行してください');
    }
    this.commit(b, reopenInGraph(b.loaded.state.matches, matchId, this.ctx(b)));
    this.disarmIfCleared(b, matchId);
    this.publish(roomId);
  }

  /** 不戦勝・両者棄権 (対戦せずに確定させる) */
  setWalkover(roomId: string, matchId: string, winnerSide: 0 | 1 | null): void {
    const b = this.require(roomId);
    this.requireMatch(b, matchId);
    this.commit(b, walkoverInGraph(b.loaded.state.matches, matchId, winnerSide, Date.now(), this.ctx(b)));
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
    if (!hasBracket(b.loaded.def.format)) {
      throw new TournamentError('回戦ごとのマップはトーナメント (勝ち上がり) でのみ設定できます');
    }
    if (stage < groupStageCountOf(b.loaded.state.matches)) {
      // BOT対戦予選は「全参加者が同じマップ」が形式の根拠なので、予選のマップも差し替えられる。
      // ただし1試合でも終わっていたら、そこから先だけ別マップになって条件が崩れる
      if (!hasBotStage(b.loaded.def.format)) {
        throw new TournamentError('予選リーグの節にはマップを個別指定できません (大会の設定が使われます)');
      }
      if (b.loaded.state.matches.some(m => m.group !== undefined && m.status === 'done')) {
        throw new TournamentError(
          'BOT対戦予選は全参加者が同じマップで戦う必要があります。'
          + '実施済みの試合があるのでマップは変更できません (変えるなら予選をやり直してください)',
        );
      }
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

  /**
   * 決勝進出者を運営が差し替える。`participantId: null` で自動判定に戻す。
   *
   * 公式ルールの同点処理 (勝ち点 → 合計ポイント → 直接対決) でも並びが決まらないことは
   * 通常運用で起こる。自動判定は必ず枠を埋めるので決勝は始められるが、その中身を人が
   * 最終的に決め直せるようにするための操作。
   */
  setQualifier(
    roomId: string, group: number, rank: number,
    participantId: string | null, cascade = false,
  ): void {
    const b = this.require(roomId);
    if (!hasQualifying(b.loaded.def.format)) {
      throw new TournamentError('この大会には予選がありません');
    }

    const slots = qualifiersOf(b.loaded) ?? [];
    const slot  = slots.find(s => s.group === group && s.rank === rank);
    if (!slot) throw new TournamentError('その枠は存在しません');

    if (participantId !== null) {
      const groupIds = groupsOf(b.loaded.def)[group] ?? [];
      if (!groupIds.includes(participantId)) {
        throw new TournamentError(hasBotStage(b.loaded.def.format)
          ? `${this.nameOf(b, participantId)} は予選の参加者ではありません`
          : `${this.nameOf(b, participantId)} は${groupLabel(group)}リーグの参加者ではありません`);
      }
      // 差し替えた「あと」の顔ぶれで重複を見る。自動判定は順位表の位置で埋まるので、
      // 手動で1人繰り上げると別の枠の自動値と衝突することがある
      const after = slots.map(s => (
        s.group === group && s.rank === rank ? participantId : s.participantId
      ));
      const dup = after.filter(id => id === participantId).length > 1;
      if (dup) {
        throw new TournamentError(
          `${this.nameOf(b, participantId)} は既に別の枠に入っています。先にそちらを変更してください`,
        );
      }
    }

    // その枠を使う1回戦が動いていたら、結果と食い違うので先に巻き戻す必要がある
    const first = this.firstRoundMatchOf(b, group, rank);
    if (first && first.status !== 'pending' && first.status !== 'ready') {
      const playedByHand = first.status === 'done' && !(first.byeA || first.byeB);
      if (first.status === 'armed' || first.status === 'in_progress' || first.status === 'awaiting_confirm') {
        throw new TournamentError(
          `「${first.label}」が準備中・対戦中です。先にリセットしてから変更してください`,
        );
      }
      if (playedByHand && !cascade) {
        throw new TournamentError(
          `「${first.label}」は実施済みです。この変更でその結果も取り消されます。確認のうえ実行してください`,
        );
      }
    }

    const overrides = { ...(b.loaded.state.qualifierOverrides ?? {}) };
    if (participantId === null) delete overrides[qualifierKey(group, rank)];
    else overrides[qualifierKey(group, rank)] = participantId;

    b.loaded = {
      ...b.loaded,
      state: { ...b.loaded.state, qualifierOverrides: overrides, updatedAt: Date.now() },
    };

    // 差し替えで顔ぶれが変わる試合と、その下流の結果は捨てる。
    // 残すと「戦っていない相手に勝った」という記録ができてしまう
    const matches = first
      ? reopenInGraph(b.loaded.state.matches, first.id, this.ctx(b))
      : b.loaded.state.matches;
    this.commit(b, matches);
    if (first) this.disarmIfCleared(b, first.id);
    this.publish(roomId);
  }

  /**
   * 最終決定確認リストから参加者を削除する / 取り消す。
   *
   * 削除された人は順位表から居なかったものとして扱われ、下の順位が繰り上がる。
   * 同ポイントでボーダーに並んだときに「多めに出して削る」ための操作で、枠ごとの
   * 差し替え (setQualifier) と違い**誰がどの枠に入るかは指定しない** — 順位の並びに任せる。
   */
  setQualifierExclusion(
    roomId: string, participantId: string, excluded: boolean, cascade = false,
  ): void {
    const b = this.require(roomId);
    if (!hasQualifying(b.loaded.def.format)) {
      throw new TournamentError('この大会には予選がありません');
    }
    if (!b.loaded.def.participants.some(p => p.id === participantId)) {
      throw new TournamentError('参加者が見つかりません');
    }

    const before = b.loaded.state.qualifierExclusions ?? [];
    const after  = excluded
      ? (before.includes(participantId) ? before : [...before, participantId])
      : before.filter(id => id !== participantId);
    if (after.length === before.length && excluded === before.includes(participantId)) return;

    // 削除で顔ぶれが変わりうる決勝トーナメントの試合。1つでも動いていたら先に巻き戻す必要がある
    const affected = this.qualifierDependentMatches(b);
    const running  = affected.find(m =>
      m.status === 'armed' || m.status === 'in_progress' || m.status === 'awaiting_confirm');
    if (running) {
      throw new TournamentError(
        `「${running.label}」が準備中・対戦中です。先にリセットしてから変更してください`,
      );
    }
    const played = affected.find(m => m.status === 'done' && !(m.byeA || m.byeB));
    if (played && !cascade) {
      throw new TournamentError(
        `「${played.label}」は実施済みです。この変更でその結果も取り消されます。確認のうえ実行してください`,
      );
    }

    b.loaded = {
      ...b.loaded,
      state: { ...b.loaded.state, qualifierExclusions: after, updatedAt: Date.now() },
    };

    // 顔ぶれが変わる試合と、その下流の結果は捨てる。
    // 残すと「戦っていない相手に勝った」という記録ができてしまう。
    // **巻き戻してから commit し、そのあとで armed を落とす** — disarmIfCleared は
    // b.loaded の下流を数えるので、順番を逆にすると巻き戻す前のグラフを見てしまう
    let matches = b.loaded.state.matches;
    for (const m of affected) matches = reopenInGraph(matches, m.id, this.ctx(b));
    this.commit(b, matches);
    for (const m of affected) this.disarmIfCleared(b, m.id);
    this.publish(roomId);
  }

  /** 決勝進出者の並びが変われば顔ぶれが変わる試合 (= group-rank を参照する1回戦) */
  private qualifierDependentMatches(b: Binding): TournamentMatch[] {
    return b.loaded.state.matches.filter(m =>
      [m.slotA, m.slotB].some(r => r.kind === 'group-rank'));
  }

  /** その枠 (リーグ・順位) を参照している1回戦の試合 */
  private firstRoundMatchOf(
    b: Binding, group: number, rank: number,
  ): TournamentMatch | undefined {
    return b.loaded.state.matches.find(m =>
      [m.slotA, m.slotB].some(r =>
        r.kind === 'group-rank' && r.group === group && r.rank === rank));
  }

  private nameOf(b: Binding, participantId: string): string {
    return b.loaded.def.participants.find(p => p.id === participantId)?.name ?? participantId;
  }

  /**
   * 決勝進出者を「この顔ぶれで始める」と確定する / 確定を取り消す。
   *
   * 予選が終わっても自動では決勝へ進ませない。観戦画面はここが true になるまで
   * 予選の最終結果を出し続けるので、観客が順位と勝ち上がりを見る時間になり、
   * 同時に運営が同点の枠を見直す機会にもなる。
   */
  confirmQualifiers(roomId: string, confirmed: boolean): void {
    const b = this.require(roomId);
    if (!hasQualifying(b.loaded.def.format)) {
      throw new TournamentError('この大会には予選がありません');
    }
    if (confirmed && !isGroupStageDone(b.loaded.state.matches)) {
      throw new TournamentError('予選がまだ終わっていません');
    }
    // **同点のボーダーが残っていても通す。** 自動判定は必ず決定的に枠を埋めるので決勝は
    // 始められるし、ここで弾くとオートプレイ (順位表の並び順で自動確定する仕様) が止まる。
    // 「人数を合わせてから押す」の誘導は運営パネル側の役目

    b.loaded = {
      ...b.loaded,
      state: { ...b.loaded.state, qualifiersConfirmed: confirmed, updatedAt: Date.now() },
    };
    saveState(b.loaded.state);
    this.publish(roomId);
  }

  /**
   * 観戦画面に出すものを切り替える。
   *
   * **運営席 (?mode=tournament) の表示とは連動しない。** 観客には予選表を出したまま、
   * 手元では決勝の組み合わせを確認したい、という場面があるため別々に持つ。
   */
  setDisplayView(roomId: string, view: TournamentDisplayView): void {
    const b = this.require(roomId);
    if (!hasQualifying(b.loaded.def.format)) {
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
    b.autoPlay = {
      enabled,
      loop: loop ?? b.autoPlay.loop,
      stoppedReason: null,
    };
    if (!enabled) this.clearAutoTimer(b);
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

  // ── ServerManager の状態変化を受ける ──────────────────────────────────────

  private onServerStatus(roomId: string, st: ServerStatusPayload): void {
    const b = this.byRoom.get(roomId);
    if (!b) return;
    // 自動進行の判断材料。**先に更新すること** — この下の経路は publish して
    // そこから次の一手を予約するので、古い status で判断すると1手ぶんズレる
    b.lastStatus = st;
    this.applyServerStatus(roomId, b, st);
    // 状態が変わらなかった (publish しなかった) 経路のための保険。
    // 予約済みなら autoTick は何もしないので、二重に予約されることはない
    this.autoTick(roomId);
  }

  private applyServerStatus(roomId: string, b: Binding, st: ServerStatusPayload): void {
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
          this.ctx(b),
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

  // ── 自動進行 (オートプレイ) ────────────────────────────────────────────────
  //
  // 「次の一手」の判断は純関数 (autoPlay.ts) に閉じ、ここは予約と実行だけを持つ。
  //
  // 予約は常に高々1つ。**予約したときと発火したときの2回、同じ純関数を通す** —
  // 待っている数秒の間に運営が手で操作しているかもしれないので、予約した内容を
  // そのまま実行してはいけない。食い違っていたら、今の状態に合う一手を
  // 改めて (その一手ぶんの待機時間で) 予約し直す。

  /** 今の状態から次の一手を予約する。予約済み・自動進行が切なら何もしない */
  private autoTick(roomId: string): void {
    const b = this.byRoom.get(roomId);
    if (!b || !b.autoPlay.enabled || b.autoTimer) return;

    const planned = this.planAuto(b);
    if (!planned) return;

    b.autoTimer = setTimeout(() => {
      b.autoTimer = null;
      const now = this.planAuto(b);
      if (!now) return;
      // 待っている間に状況が変わった → 今の一手を、その一手ぶん待ってから
      if (now.kind !== planned.kind) { this.autoTick(roomId); return; }
      void this.runAuto(roomId, now);
    }, delayFor(planned.kind, this.autoDelays));
  }

  private planAuto(b: Binding): AutoPlayAction | null {
    if (!b.autoPlay.enabled) return null;
    return nextAutoPlayAction({
      matches:             b.loaded.state.matches,
      armedMatchId:        b.armedMatchId,
      format:              b.loaded.def.format,
      qualifiersConfirmed: qualifiersConfirmedOf(b.loaded),
      groupStageDone:      isGroupStageDone(b.loaded.state.matches),
      status:              b.lastStatus,
      loop:                b.autoPlay.loop,
    });
  }

  /**
   * 一手ぶんの操作を実行する。
   *
   * 失敗 (プログラム未登録など) は握りつぶさず、理由を添えて自動進行を止める —
   * 同じ操作を延々と再試行すると、運営が気づかないまま止まっているのと変わらない。
   */
  private async runAuto(roomId: string, action: AutoPlayAction): Promise<void> {
    const b = this.byRoom.get(roomId);
    if (!b || !b.autoPlay.enabled) return;

    const manager = this.deps.rm.getRoom(roomId)?.manager;
    if (!manager) return;

    try {
      switch (action.kind) {
        case 'arm':                await this.armMatch(roomId, action.matchId); break;
        // requestStart は対戦が終わるまで返らない。その間の進行は status イベントが動かす
        case 'start':              await manager.requestStart(); break;
        case 'next-round':         await manager.requestNextRound(); break;
        case 'confirm':            this.confirmResult(roomId, action.matchId); break;
        case 'confirm-qualifiers': this.confirmQualifiers(roomId, true); break;
        case 'restart':            await this.restartForLoop(roomId); break;
        case 'finish':             this.stopAuto(roomId, '全ての試合が終了しました'); return;
        case 'pause':              this.stopAuto(roomId, action.reason); return;
      }
    } catch (e) {
      this.stopAuto(roomId, (e as Error).message);
      return;
    }
    // 操作の中で publish していれば予約済み。していない経路のための保険
    this.autoTick(roomId);
  }

  /** 理由を添えて自動進行を止める (運営パネルにそのまま出る) */
  private stopAuto(roomId: string, reason: string): void {
    const b = this.byRoom.get(roomId);
    if (!b) return;
    this.clearAutoTimer(b);
    b.autoPlay = { ...b.autoPlay, enabled: false, stoppedReason: reason };
    this.publish(roomId);
  }

  private clearAutoTimer(b: Binding): void {
    if (b.autoTimer) {
      clearTimeout(b.autoTimer);
      b.autoTimer = null;
    }
  }

  /**
   * デモモード: 進行状態を作り直して最初からやり直す。
   *
   * `resetTournamentState` を使わないのは、あちらが state.json を読み直すため
   * (運営中はこちらがメモリに握っているので食い違う)。回戦ごとのマップの差し替えは
   * 進行ではなく運営の設定なので残し、結果に紐づくもの (決勝進出者の指名・確定) は捨てる。
   */
  private async restartForLoop(roomId: string): Promise<void> {
    const b = this.require(roomId);

    const state: TournamentState = {
      tournamentId: b.tournamentId,
      matches:      buildMatches(b.loaded.def),
      programs:     b.loaded.state.programs,
      updatedAt:    Date.now(),
    };
    if (b.loaded.state.stageMapOverrides) {
      state.stageMapOverrides = b.loaded.state.stageMapOverrides;
    }
    b.loaded = { ...b.loaded, state };
    saveState(state);
    b.armedMatchId = null;

    // 盤面と割り当てをセットアップへ戻す (bind 直後と同じ見た目にする)
    await this.deps.rm.getRoom(roomId)?.manager.requestReset();
    const firstMap = mapForStage(b.loaded, 0);
    if (firstMap) this.deps.rm.getRoom(roomId)?.manager.loadMap(firstMap);

    this.publish(roomId);
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

  /** group-rank を解くための文脈 (予選を持たない大会では空) */
  private ctx(b: Binding) {
    return resolveContextOf(b.loaded);
  }

  /**
   * 巻き戻しで準備済みの試合まで消えたら、armed の記録も落とす。
   *
   * armedMatchId は ServerManager のスロット割り当てと対になっている。グラフ側だけ
   * pending に戻ると、onServerStatus が「pending の試合を対戦中にする」という
   * 辻褄の合わない遷移をしてしまう。
   */
  private disarmIfCleared(b: Binding, matchId: string): void {
    if (!b.armedMatchId) return;
    if (b.armedMatchId === matchId
      || downstreamOf(b.loaded.state.matches, matchId).has(b.armedMatchId)) {
      b.armedMatchId = null;
    }
  }

  private commit(b: Binding, matches: TournamentMatch[]): void {
    const state = { ...b.loaded.state, matches, updatedAt: Date.now() };
    // 予選が「終わっていない」状態に戻ったら確定も外す。取り消して入れ直せば順位が
    // 変わっているかもしれないので、確定はやり直してもらう。
    // **試合を書き換える経路はすべてここを通る**ので、巻き戻しの種類ごとに書かなくてよい
    if (state.qualifiersConfirmed && !isGroupStageDone(matches)) state.qualifiersConfirmed = false;

    b.loaded = { ...b.loaded, state };
    saveState(b.loaded.state);
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
    this.autoTick(roomId);
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
