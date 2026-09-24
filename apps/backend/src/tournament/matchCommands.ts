import type { ClientType, ProcessConfig, ResolvedParticipant, TournamentMatch } from '@u15/ws-types';
import {
  blockedByQualifiers, canRunInSideLane, doubleModeFor, groupLabel, groupStageCount, hasBracket,
  isConsolationMatch, isKnockoutMatch, isLeaguePointsMatch, isListDisplayView,
} from '@u15/ws-types';
import { buildProcessConfig } from '../game/processConfig.js';
import { getCatalogEntry } from '../programCatalog.js';
import { addMapCatalogEntryFromInline } from '../mapCatalog.js';
import type { ServerManager } from '../game/ServerManager.js';
import {
  TournamentError, commit, ctxOf, decide, disarmIfCleared, laneOfMatch, managerOf, primaryLane,
  requireMatch, requireParticipant, updateMatch, type Binding, type CommandEnv, type Lane,
} from './binding.js';
import {
  confirmResult as confirmInGraph,
  discardResult as discardInGraph,
  hasConfirmedDownstream,
  reopenMatch as reopenInGraph,
  setWalkover as walkoverInGraph,
} from './progress.js';
import {
  mapForMatch, mapForStage, qualifiersConfirmedOf, resolveParticipants, roundRobinMapPlanFor,
  saveState, stageCountOf,
} from './TournamentStore.js';

// 1つの試合に対する運営操作。準備 → 確定 → やり直し と、その試合が使うマップ。

/**
 * 対戦カードをスロットへ割り当てて、あとは「ゲームスタート」を押すだけの状態にする。
 *
 * 順序が重要: requestReset() → setDoubleMode() → setClientType() ×2。
 * requestReset は processConfig を消すため、先に割り当てると失われる。
 * また roundResults を空にすることで canEditMap()/canStart() の両ゲートが通るようになる。
 */
export async function armMatch(
  env: CommandEnv, b: Binding, lane: Lane, matchId: string,
): Promise<void> {
  const match = requireMatch(b, matchId);

  if (lane.armedMatchId && lane.armedMatchId !== matchId) {
    throw new TournamentError('別の試合が準備中です。先にそちらを終えるか取り消してください');
  }
  const held = laneOfMatch(b, matchId);
  if (held && held !== lane) {
    throw new TournamentError('この試合は別のレーンで準備中です');
  }
  if (match.status !== 'ready' && match.status !== 'armed') {
    throw new TournamentError(`この試合はまだ開始できません (${match.status})`);
  }
  if (!match.resolvedA || !match.resolvedB) {
    throw new TournamentError('対戦相手がまだ確定していません');
  }
  // 予選ありの大会では、決勝進出者を運営が確定するまで決勝トーナメントを始めない。
  // 自動判定は必ず枠を埋めるので、確認を挟まないと同点の枠を誰も見ないまま決勝が始まる
  const format = b.loaded.def.stage.format;
  if (blockedByQualifiers(format, match, qualifiersConfirmedOf(b.loaded))) {
    throw new TournamentError('先に決勝進出者を確定してください');
  }

  const participants = resolveParticipants(b.loaded);
  const a  = requireParticipant(participants, match.resolvedA);
  const bp = requireParticipant(participants, match.resolvedB);

  // スロットへ触る前に両者ぶんを解決しておく。片方だけ割り当ててから失敗すると
  // COOL だけ準備完了・HOT は未選択という中途半端な状態が残ってしまう。
  //
  // **libPath はそのレーンの部屋で組む。** 規約が server/rooms/<roomId>/libs/<cool|hot> なので、
  // 主レーンの部屋で組むと、並列に走る対戦どうしが同じライブラリ置き場を奪い合う
  const configs = [slotConfigOf(a, 0, lane.roomId), slotConfigOf(bp, 1, lane.roomId)];

  const manager = managerOf(env, lane.roomId);
  if (!manager) throw new TournamentError('ルームが見つかりません');

  // **副レーンの進む速さを主レーンに揃える。**
  //
  // ターン表示時間と TCP タイムアウトはコントロール窓が自分の部屋へ一方的に送る設定で、
  // コントロール窓は主レーンの部屋にしか開かない。揃えないと副レーンだけ既定値
  // (500ms/ターン) で走り、同じ画面に並んだ対戦の進みがレーンごとにばらばらに見える。
  //
  // レーンを作るときではなく **arm のたびに引き直す** — 運営が対戦の合間に設定を
  // 変えても、次の試合から効くようにするため
  if (!lane.primary) {
    const primary = managerOf(env, b.roomId);
    if (primary) {
      manager.setTurnDelay(primary.turnDelayMs);
      manager.setTcpTimeout(primary.tcpTimeoutMs);
    }
  }

  manager.setDemoMode(false);
  manager.setRepeatMode(false);
  // 対戦カードが決まったらアナウンスは役目を終える。文面は次の休憩のために残す
  manager.setAnnouncement({ visible: false });
  // 名簿 (参加者一覧 / 決勝進出者) も同じ。試合の合間に出すものなので、対戦カードが決まったら
  // 'auto' に戻す (戻さないと、次の試合が終わった待機画面でまた名簿が出てしまう)
  if (isListDisplayView(b.displayView)) b.displayView = 'auto';

  await manager.requestReset();
  manager.setDoubleMode(doubleModeFor(b.loaded.def, match));

  // 再試合の指定 → 回戦ごとのマップ → 大会全体の固定マップ の順に効かせる。
  // null (毎回ランダム生成) のときも明示的に切り替える — マップ管理は「ライブラリ由来なら
  // 引き直さず保持する」設計 (MapManager.refreshForNewGame) なので、ここで何もしないと
  // 前の試合 (例えば予選) で読み込んだ固定マップが決勝までそのまま残ってしまう
  applyMapTo(env, b, lane, match);

  for (const c of configs) {
    await manager.setClientType(c.slot, c.type, c.processConfig);
  }

  lane.armedMatchId = matchId;
  updateMatch(b, matchId, m => ({ ...m, status: 'armed' }));
  env.publish(b.roomId);
}

/**
 * その試合を流すレーンを決める。
 *
 * - 既にどこかのレーンが抱えている試合なら、そのレーン (再 arm は同じ場所で行う)
 * - **副レーンで実施できない試合 (決勝トーナメント等) は、他のレーンが全部空いている
 *   ときだけ主レーンで行う。** 主戦場は単独で行う、という決まり
 * - それ以外は空いているレーンを主レーンから順に
 */
export function pickLaneFor(b: Binding, matchId: string): Lane {
  const match = requireMatch(b, matchId);
  const held  = laneOfMatch(b, matchId);
  if (held) return held;

  const busy = '別の試合が準備中です。先にそちらを終えるか取り消してください';

  if (!canRunInSideLane(b.loaded.def.stage.format, match)) {
    if (b.lanes.some(l => l.armedMatchId !== null)) throw new TournamentError(busy);
    return primaryLane(b);
  }

  const idle = b.lanes.find(l => l.armedMatchId === null);
  if (!idle) {
    throw new TournamentError(b.lanes.length === 1
      ? busy
      : '空いているレーンがありません。先にどれかの試合を終えてください');
  }
  return idle;
}

/**
 * 準備を取り消して ready に戻す。matchId を省略すると準備中のレーンをすべて取り消す
 * (運営が並列実行をまとめて畳むときの操作)。
 */
export function cancelArm(env: CommandEnv, b: Binding, matchId?: string): void {
  const target = matchId ? laneOfMatch(b, matchId) : undefined;
  const lanes  = matchId
    ? (target ? [target] : [])
    : b.lanes.filter(l => l.armedMatchId !== null);
  if (lanes.length === 0) return;

  for (const lane of lanes) {
    updateMatch(b, lane.armedMatchId!, m => ({ ...m, status: 'ready' }));
    lane.armedMatchId = null;
  }
  env.publish(b.roomId);
}

/**
 * そのレーンで準備中の試合のマップを引き直す (指定が無ければランダム生成に戻す)。
 *
 * 総当たり (league / 予選リーグ) の試合は `roundRobinMapPlanFor` が優先する — 対戦カードごと
 * ではなくリーグ単位で1つのマップに固定するため、`mapForMatch` (再試合の個別指定を含む)
 * は総当たりの試合には効かせない。
 */
function applyMapTo(env: CommandEnv, b: Binding, lane: Lane, match: TournamentMatch): void {
  const manager = managerOf(env, lane.roomId);
  const rr = roundRobinMapPlanFor(b.loaded, match);
  if (rr) {
    const catalogId = rr.kind === 'fixed' ? rr.catalogId : resolveRandomRoundRobinMap(b, manager, rr.decisionKey, match);
    if (catalogId) manager?.loadMap(catalogId);
    return;
  }

  const mapId = mapForMatch(b.loaded, match);
  if (mapId) manager?.loadMap(mapId);
  else manager?.generateRandomMap();
}

/**
 * 総当たり試合用のランダムマップを決める。既に決定済みならその catalogId を返すだけ。
 * 未決定なら生成してライブラリへ保存し、以後同じリーグ (または大会全体) の全試合が
 * 同じ catalogId を使うよう `state.decisions.decidedRoundRobinMaps` に固定する。
 *
 * `canRunInSideLane` は league/予選リーグの総当たり試合を対象にしないため
 * (`isLeaguePointsMatch` が true の試合は常に主レーンで1試合ずつ進む)、
 * 「無ければ生成して保存」を複数レーンが同時に行う競合は起きない。
 */
function resolveRandomRoundRobinMap(
  b: Binding, manager: ServerManager | undefined, decisionKey: string, match: TournamentMatch,
): string | null {
  const existing = b.loaded.state.decisions.decidedRoundRobinMaps[decisionKey];
  if (existing) return existing;
  if (!manager) return null;

  manager.generateRandomMap();
  const data = manager.getCurrentMapData();
  const displayName = decisionKey === '*'
    ? `${b.loaded.def.name} 予選 (自動生成)`
    : `${b.loaded.def.name} ${groupLabel(match.group!)}リーグ (自動生成)`;
  const entry = addMapCatalogEntryFromInline(displayName, data);

  decide(b, d => ({
    ...d, decidedRoundRobinMaps: { ...d.decidedRoundRobinMaps, [decisionKey]: entry.id },
  }));
  saveState(b.loaded.state);

  return entry.id;
}

/**
 * 準備済みの試合のうち target に当たるものへ、その場でマップを反映し直す。
 *
 * **レーンを1つに絞らず、当たったレーンすべてに効かせる。** BOT対戦予選は全参加者が
 * 同じマップで戦うのが形式の根拠なので、並列実行中に片方のレーンだけ変えると条件が崩れる。
 * 1ゲームでも消化していると RoundController.canEditMap が塞ぐため、その試合は次の arm に任せる
 * (status が 'armed' の間だけが対象)。
 */
function reapplyArmedMaps(
  env: CommandEnv, b: Binding, target: (m: TournamentMatch) => boolean,
): void {
  for (const lane of b.lanes) {
    const armed = b.loaded.state.matches.find(m => m.id === lane.armedMatchId);
    if (armed && armed.status === 'armed' && target(armed)) applyMapTo(env, b, lane, armed);
  }
}

/**
 * 先攻・後攻を入れ替える。`ready` の試合だけに効く (armMatch を押す前まで)。
 *
 * slotA/slotB は試合グラフの構造 (winner-of/group-rank/participant への参照) ごと
 * 入れ替える。`updateMatch` は resolveMatches を呼び直さないので、resolvedA/B・byeA/B も
 * 同時に手で入れ替える必要がある — でないと表示と実際の割り当てがズレる。
 *
 * BOT対戦予選の予選試合は対象外 (全参加者が同一条件で測られるのがこの形式の根拠なので、
 * 参加者ごとに手番を変える余地は持たせない)。
 */
export function swapSides(env: CommandEnv, b: Binding, matchId: string): void {
  const match = requireMatch(b, matchId);
  if (match.status !== 'ready') {
    throw new TournamentError(`この試合は今は先攻・後攻を入れ替えられません (${match.status})`);
  }
  if (b.loaded.def.stage.format === 'bot-then-bracket' && match.group !== undefined) {
    throw new TournamentError(
      'BOT対戦予選は全参加者が同じ条件で戦うため、先攻・後攻を入れ替えられません',
    );
  }
  updateMatch(b, matchId, m => ({
    ...m,
    slotA: m.slotB, slotB: m.slotA,
    resolvedA: m.resolvedB, resolvedB: m.resolvedA,
    byeA: m.byeB, byeB: m.byeA,
  }));
  env.publish(b.roomId);
}

/**
 * 同点の結果を「この結果で確定」でいったん認める。confirmResult と違って勝者を決めるのでは
 * なく、再試合か審判裁定かをこのあと運営が選ぶための前段 — `TournamentMatch.tieAcknowledged`
 * を立てるだけの軽量な操作 (swapSides と同じ形)。
 *
 * armedMatchId はまだ残ったまま (winnerSide が決まっていないので resolveMatches は status を
 * awaiting_confirm のままにする)。対戦表示画面はこのフラグを見て、運営が実際に再試合/裁定の
 * どちらを選ぶかを待つ間も、盤面の結果画面からトーナメント表 (スコアと「引き分け」の表示) へ
 * 進めてよいと判断する (DisplayMode.tsx の baseDisplayScene 参照)。
 */
export function acknowledgeTie(env: CommandEnv, b: Binding, matchId: string): void {
  const match = requireMatch(b, matchId);
  if (match.status !== 'awaiting_confirm' || !match.result) {
    throw new TournamentError('確定できる結果がありません');
  }
  if (match.result.winnerSide !== null) {
    throw new TournamentError('同点ではない試合には使えません (この結果で確定 を使ってください)');
  }
  updateMatch(b, matchId, m => ({ ...m, tieAcknowledged: true }));
  env.publish(b.roomId);
}

export function confirmResult(
  env: CommandEnv, b: Binding, matchId: string, winnerSide?: 0 | 1, note?: string,
): void {
  const match = requireMatch(b, matchId);
  if (!match.result) throw new TournamentError('確定できる結果がありません');

  const decided = winnerSide !== undefined ? winnerSide : match.result.winnerSide;
  // **判定は形式ではなく試合ごと。** 予選リーグの引き分けは正当な結果で勝ち点1が付くが、
  // 勝ち上がりの試合で勝者不在のまま確定すると次の対戦が決まらず詰む
  if (decided === null && isKnockoutMatch(b.loaded.def.stage.format, match)) {
    throw new TournamentError('同点です。再試合するか、勝者を指定してください');
  }

  const patch: Parameters<typeof confirmInGraph>[2] = {};
  if (winnerSide !== undefined) {
    patch.winnerSide = winnerSide;
    patch.decidedBy  = 'manual';
  }
  if (note !== undefined) patch.note = note;

  commit(b, confirmInGraph(b.loaded.state.matches, matchId, patch, Date.now(), ctxOf(b)));
  const lane = laneOfMatch(b, matchId);
  if (lane) lane.armedMatchId = null;
  env.publish(b.roomId);
}

/**
 * やり直し / 同点の再試合。結果を捨てて ready に戻す。
 *
 * 公式ルールは同点時に「マップを変更して再試合を行う」と定めている。ランダムマップなら
 * requestReset() が自動で引き直すが、固定マップでは引き直されないため別マップの指定を
 * 必須にする (同じマップのまま再試合するとルール違反になる)。
 *
 * 「固定かどうか」は回戦ごとのマップも含めた実効値で見る — 大会全体はランダムでも
 * その回戦だけマップを指定していれば、やはり引き直されない。
 *
 * **総当たり (league / 予選リーグ) の試合はマップを個別に選べない。** リーグ内で違う
 * マップを使うと合計ポイントの比較が壊れるため、やり直しても常にそのリーグに割り当てた
 * マップ (roundRobinMapPlanFor が解決する) をそのまま使う。
 */
export function discardResult(
  env: CommandEnv, b: Binding, matchId: string, rematchMapCatalogId?: string,
): void {
  const match = requireMatch(b, matchId);

  if (rematchMapCatalogId !== undefined && isLeaguePointsMatch(b.loaded.def.stage.format, match)) {
    throw new TournamentError(
      '予選リーグ・リーグ戦の試合はマップを個別に変更できません (リーグ内は同じマップで統一します)',
    );
  }

  const wasTie   = match.result?.winnerSide === null;
  const fixedMap = mapForStage(b.loaded, match.stage);
  if (wasTie && fixedMap && !rematchMapCatalogId) {
    throw new TournamentError('同点の再試合ではマップを変更してください (別のマップを選んでから実行してください)');
  }

  commit(b, discardInGraph(b.loaded.state.matches, matchId, rematchMapCatalogId, ctxOf(b), wasTie));
  disarmIfCleared(b, matchId);
  env.publish(b.roomId);
}

/** 確定を取り消す。下流に確定済みがあれば cascade が要る */
export function reopenMatch(
  env: CommandEnv, b: Binding, matchId: string, cascade = false,
): void {
  requireMatch(b, matchId);
  if (!cascade && hasConfirmedDownstream(b.loaded.state.matches, matchId)) {
    throw new TournamentError('この試合より後の結果も取り消されます。確認のうえ実行してください');
  }
  commit(b, reopenInGraph(b.loaded.state.matches, matchId, ctxOf(b)));
  disarmIfCleared(b, matchId);
  env.publish(b.roomId);
}

/** 不戦勝・両者棄権 (対戦せずに確定させる) */
export function setWalkover(
  env: CommandEnv, b: Binding, matchId: string, winnerSide: 0 | 1 | null,
): void {
  requireMatch(b, matchId);
  commit(b, walkoverInGraph(b.loaded.state.matches, matchId, winnerSide, Date.now(), ctxOf(b)));
  const lane = laneOfMatch(b, matchId);
  if (lane) lane.armedMatchId = null;
  env.publish(b.roomId);
}

/**
 * 回戦 (stage) ごとのマップを差し替える。null で「大会の設定に従う」に戻す。
 *
 * 定義 (tournament.json) は配布物なので書き換えず、state.json 側に上書きとして持つ。
 * 既に準備済みの試合がその回戦なら、次の arm を待たずにその場でマップを読み直す —
 * でないと「変えたのに反映されない」が起きる。
 */
export function setStageMap(
  env: CommandEnv, b: Binding, stage: number, mapCatalogId: string | null,
): void {
  const count = stageCountOf(b.loaded.state.matches);
  if (!Number.isInteger(stage) || stage < 0 || stage >= count) {
    throw new TournamentError('その回戦は存在しません');
  }
  if (!hasBracket(b.loaded.def.stage.format)) {
    throw new TournamentError('回戦ごとのマップはトーナメント (勝ち上がり) でのみ設定できます');
  }
  if (stage < groupStageCount(b.loaded.state.matches)) {
    // BOT対戦予選は「全参加者が同じマップ」が形式の根拠なので、予選のマップも差し替えられる。
    // ただし1試合でも終わっていたら、そこから先だけ別マップになって条件が崩れる
    if (b.loaded.def.stage.format !== 'bot-then-bracket') {
      throw new TournamentError('予選リーグの節にはマップを個別指定できません (大会の設定が使われます)');
    }
    if (b.loaded.state.matches.some(m => m.group !== undefined && m.status === 'done')) {
      throw new TournamentError(
        'BOT対戦予選は全参加者が同じマップで戦う必要があります。'
        + '実施済みの試合があるのでマップは変更できません (変えるなら予選をやり直してください)',
      );
    }
  }

  decide(b, d => ({ ...d, stageMaps: { ...d.stageMaps, [String(stage)]: mapCatalogId } }));
  saveState(b.loaded.state);

  // 準備済みの試合が同じ回戦なら、その場で反映する
  reapplyArmedMaps(env, b, m => m.stage === stage);

  env.publish(b.roomId);
}

/**
 * 試合ごとのマップを差し替える (3位決定戦のみ)。null で「決勝と同じマップに戻す」。
 *
 * 3位決定戦は決勝と同じ stage を共有するため (bracket.ts)、setStageMap では書き分けられない。
 * それ以外の試合は「回戦ごとに同じマップ」が設計の前提なので対象外にする。
 */
export function setMatchMap(
  env: CommandEnv, b: Binding, matchId: string, mapCatalogId: string | null,
): void {
  const match = requireMatch(b, matchId);
  if (!isConsolationMatch(match)) {
    throw new TournamentError('この試合はマップを個別に指定できません（決勝と同じ回戦のマップに従います）');
  }

  decide(b, d => {
    const matchMaps = { ...d.matchMaps };
    if (mapCatalogId === null) delete matchMaps[matchId];
    else matchMaps[matchId] = mapCatalogId;
    return { ...d, matchMaps };
  });
  saveState(b.loaded.state);

  // 準備済みの試合が同じ試合なら、その場で反映する (setStageMap と同じ考え方)
  reapplyArmedMaps(env, b, m => m.id === matchId);

  env.publish(b.roomId);
}

/** 参加者をスロット設定へ解決する (副作用なし。失敗するならここで分かる) */
function slotConfigOf(
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
