import type { ClientType, ProcessConfig, ResolvedParticipant } from '@u15/ws-types';
import {
  blockedByQualifiers, doubleModeFor, groupStageCount, hasBracket, isKnockoutMatch,
} from '@u15/ws-types';
import { buildProcessConfig } from '../game/processConfig.js';
import { getCatalogEntry } from '../programCatalog.js';
import {
  TournamentError, commit, ctxOf, decide, disarmIfCleared, managerOf, requireMatch,
  requireParticipant, updateMatch, type Binding, type CommandEnv,
} from './binding.js';
import {
  confirmResult as confirmInGraph,
  discardResult as discardInGraph,
  hasConfirmedDownstream,
  reopenMatch as reopenInGraph,
  setWalkover as walkoverInGraph,
} from './progress.js';
import {
  mapForMatch, mapForStage, qualifiersConfirmedOf, resolveParticipants, saveState, stageCountOf,
} from './TournamentStore.js';

// 1つの試合に対する運営操作。準備 → 確定 → やり直し と、その試合が使うマップ。

/**
 * 対戦カードをスロットへ割り当てて、あとは「ゲームスタート」を押すだけの状態にする。
 *
 * 順序が重要: requestReset() → setDoubleMode() → setClientType() ×2。
 * requestReset は processConfig を消すため、先に割り当てると失われる。
 * また roundResults を空にすることで canEditMap()/canStart() の両ゲートが通るようになる。
 */
export async function armMatch(env: CommandEnv, b: Binding, matchId: string): Promise<void> {
  const match = requireMatch(b, matchId);

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
  // 自動判定は必ず枠を埋めるので、確認を挟まないと同点の枠を誰も見ないまま決勝が始まる
  const format = b.loaded.def.stage.format;
  if (blockedByQualifiers(format, match, qualifiersConfirmedOf(b.loaded))) {
    throw new TournamentError('先に決勝進出者を確定してください');
  }

  const participants = resolveParticipants(b.loaded);
  const a  = requireParticipant(participants, match.resolvedA);
  const bp = requireParticipant(participants, match.resolvedB);

  // スロットへ触る前に両者ぶんを解決しておく。片方だけ割り当ててから失敗すると
  // COOL だけ準備完了・HOT は未選択という中途半端な状態が残ってしまう
  const configs = [slotConfigOf(a, 0, b.roomId), slotConfigOf(bp, 1, b.roomId)];

  const manager = managerOf(env, b);
  if (!manager) throw new TournamentError('ルームが見つかりません');

  manager.setDemoMode(false);
  manager.setRepeatMode(false);

  await manager.requestReset();
  manager.setDoubleMode(doubleModeFor(b.loaded.def, match));

  // 再試合の指定 → 回戦ごとのマップ → 大会全体の固定マップ の順に効かせる。
  // null (毎回ランダム生成) のときも明示的に切り替える — マップ管理は「ライブラリ由来なら
  // 引き直さず保持する」設計 (MapManager.refreshForNewGame) なので、ここで何もしないと
  // 前の試合 (例えば予選) で読み込んだ固定マップが決勝までそのまま残ってしまう
  const mapId = mapForMatch(b.loaded, match);
  if (mapId) manager.loadMap(mapId);
  else manager.generateRandomMap();

  for (const c of configs) {
    await manager.setClientType(c.slot, c.type, c.processConfig);
  }

  b.armedMatchId = matchId;
  updateMatch(b, matchId, m => ({ ...m, status: 'armed' }));
  env.publish(b.roomId);
}

/** 準備を取り消して ready に戻す */
export function cancelArm(env: CommandEnv, b: Binding): void {
  if (!b.armedMatchId) return;
  updateMatch(b, b.armedMatchId, m => ({ ...m, status: 'ready' }));
  b.armedMatchId = null;
  env.publish(b.roomId);
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
  if (b.armedMatchId === matchId) b.armedMatchId = null;
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
 */
export function discardResult(
  env: CommandEnv, b: Binding, matchId: string, rematchMapCatalogId?: string,
): void {
  const match = requireMatch(b, matchId);

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
  if (b.armedMatchId === matchId) b.armedMatchId = null;
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

  // 準備済みの試合が同じ回戦なら、その場で反映する。1ゲームでも消化していると
  // RoundController.canEditMap が塞ぐので、その場合は次の arm に任せる。
  const armed = b.armedMatchId
    ? b.loaded.state.matches.find(m => m.id === b.armedMatchId)
    : undefined;
  if (armed && armed.stage === stage && armed.status === 'armed') {
    const mapId = mapForMatch(b.loaded, armed);
    if (mapId) managerOf(env, b)?.loadMap(mapId);
    else managerOf(env, b)?.generateRandomMap();
  }

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
