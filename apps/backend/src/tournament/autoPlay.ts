import type {
  ServerStatusPayload,
  TournamentFormat,
  TournamentMatch,
} from '@u15/ws-types';
import {
  canRunInSideLane, hasQualifying, isKnockoutMatch, nextReadyMatches,
} from '@u15/ws-types';

// オートプレイ (自動進行) の「次の一手」を決める純関数。
//
// 運営が押していた操作を1つずつ代行するだけで、判定は一切増やさない:
//   この試合を準備 (arm) → ゲームスタート → (2ゲーム制なら) 第2ゲームへ → 結果を確定
//
// **状態遷移そのものは持たない。** 呼ばれるたびに「今の状態から見て次にやること」を
// 1つ返すだけなので、運営が途中で手動操作しても・巻き戻しても、次の呼び出しで
// 辻褄が合う (TournamentOrchestrator は実行の直前にもう一度ここを通す)。

/** 各操作の前に置く待機時間。**視認性のための間**なので、短くすると機能の意味が消える */
export interface AutoPlayDelaysMs {
  /** 直前の結果を表で見せてから、次の対戦カードを組むまで */
  arm:        number;
  /**
   * 直前の結果を表で見せてから、アナウンス画面に切り替えるまで。
   * **アナウンスを見せる時間は次の `arm` の待機時間**になる (アナウンス → 次の対戦カード)
   */
  announce:   number;
  /** 対戦カードとマップを見せてから、ゲームを開始するまで */
  start:      number;
  /** 第1ゲームの結果を見せてから、第2ゲームへ進むまで */
  nextRound:  number;
  /** 最終結果の画面を見せてから、結果を確定するまで */
  confirm:    number;
  /** 予選リーグの最終順位を見せてから、決勝進出者を確定するまで */
  qualifiers: number;
  /** 表彰画面を見せてから、進行を最初に戻すまで (デモモード) */
  restart:    number;
}

export const DEFAULT_AUTO_PLAY_DELAYS_MS: AutoPlayDelaysMs = {
  arm:         6_000,
  announce:    6_000,
  start:       5_000,
  nextRound:   6_000,
  confirm:     8_000,
  qualifiers: 12_000,
  restart:    20_000,
};

export type AutoPlayAction =
  | { kind: 'arm';        matchId: string }
  /** 次の試合を準備する前に、観客席へ運営アナウンスを出す */
  | { kind: 'announce' }
  | { kind: 'start' }
  | { kind: 'next-round' }
  | { kind: 'confirm';    matchId: string }
  | { kind: 'confirm-qualifiers' }
  | { kind: 'restart' }
  /** 全試合が終わり、繰り返さないので自動進行を終える */
  | { kind: 'finish' }
  /** 自動では決められないので運営に返す */
  | { kind: 'pause';      reason: string };

export interface AutoPlayInput {
  matches:             TournamentMatch[];
  armedMatchId:        string | null;
  format:              TournamentFormat;
  qualifiersConfirmed: boolean;
  groupStageDone:      boolean;
  /** ServerManager の今の状態 (フェーズ・接続状況・消化したゲーム数・アナウンス) */
  status:              ServerStatusPayload;
  loop:                boolean;
  /** 次の試合を準備する前にアナウンス画面を挟むか (自動進行中は試合ごとに選べないので一律) */
  announce:            boolean;
  /**
   * **このレーン以外**が実行中の試合。準備の候補から外し、その結果の確定もそのレーンに任せる。
   * 並列実行していなければ空配列
   */
  otherArmedIds:       readonly string[];
  /**
   * 主レーンか。**大会全体に効く一手は主レーンだけが出す** — 決勝進出者の確定・
   * 観客席へのアナウンス・デモの作り直しがそれで、副レーンも出すと同じ操作が並列数ぶん飛ぶ。
   * 並列実行していなければ常に true
   */
  primary:             boolean;
}

/** その操作の前に置く待機時間 */
export function delayFor(kind: AutoPlayAction['kind'], delays: AutoPlayDelaysMs): number {
  switch (kind) {
    case 'arm':                return delays.arm;
    case 'announce':           return delays.announce;
    case 'start':              return delays.start;
    case 'next-round':         return delays.nextRound;
    case 'confirm':            return delays.confirm;
    case 'confirm-qualifiers': return delays.qualifiers;
    case 'restart':            return delays.restart;
    // 進行を止めるだけなので待つ意味が無い
    case 'finish':
    case 'pause':              return 0;
  }
}

/**
 * 今の状態から見て、自動進行が次にやること。何もしないで待つべきなら null。
 *
 * null を返すのは「対戦中」「プログラムの接続待ち」「運営が巻き戻して実施できる試合が無い」
 * のいずれか — どれも外(ServerManager の status / 運営操作)が動けば状況が変わるので、
 * その時にもう一度呼ばれる。
 */
export function nextAutoPlayAction(i: AutoPlayInput): AutoPlayAction | null {
  // ① 結果の確定待ちが最優先。ここを飛ばすと次の試合を準備してしまう。
  //
  // 並列実行中は**自分のレーンが抱えている試合だけ**を確定する。他のレーンのぶんを横から
  // 取ると、同じ試合に確定が二重に飛ぶ。ただし、どのレーンも抱えていない確定待ち
  // (前回の運営が中断して残ったものなど) は主レーンが拾う — 誰も拾わないとそこで止まる
  const awaiting = i.matches.find(m => m.status === 'awaiting_confirm' && (
    m.id === i.armedMatchId || (i.primary && !i.otherArmedIds.includes(m.id))
  ));
  if (awaiting) {
    // 勝ち上がりの同点は公式ルールでは「マップを変更して再試合」か審判裁定。
    // どちらも運営の判断なので、勝手に決めずに止まる
    if (awaiting.result?.winnerSide == null && isKnockoutMatch(i.format, awaiting)) {
      return {
        kind:   'pause',
        reason: `「${awaiting.label}」が同点です。再試合するか、勝者を指定してください`,
      };
    }
    return { kind: 'confirm', matchId: awaiting.id };
  }

  // ② 準備済みの試合があるなら、その試合を最後まで進める
  const armed = i.armedMatchId
    ? i.matches.find(m => m.id === i.armedMatchId)
    : undefined;
  if (armed) {
    const st = i.status;
    if (st.phase === 'playing') return null;  // 対戦中。終われば status が動く
    if (st.phase === 'finished') {
      // 2ゲーム制の第1ゲーム後だけ次のゲームへ。全ゲーム終了なら
      // オーケストレータが結果を取り込むので、次の呼び出しで①に落ちる
      return st.doubleMode && st.roundResults.length === 1 ? { kind: 'next-round' } : null;
    }
    // setup: 両者の接続が済むまで待つ (第2ゲームの再接続待ちもここ)
    return st.clients.every(c => c.state === 'ready') ? { kind: 'start' } : null;
  }

  // ③ 予選が終わっていれば、決勝進出者を確定して決勝トーナメントへ進む。
  //    観戦画面はここが確定するまで予選の最終結果を出し続けるので、
  //    qualifiers の待機時間がそのまま「順位表を見せる時間」になる。
  //
  //    **ボーダーが同点でも止めない。** 自動判定は順位表の並び順で必ず決定的に枠を埋めるので、
  //    運営が居なくても大会は完走する。同点を人が決め直したいときは自動進行を切る運用。
  if (i.primary && hasQualifying(i.format) && i.groupStageDone && !i.qualifiersConfirmed) {
    return { kind: 'confirm-qualifiers' };
  }

  // ④ 次の試合を準備する。アナウンスを挟む設定なら、その前に観客席へ出す。
  //    出したあとは status.announcement.visible が立つのでここを素通りし、次の呼び出しで
  //    arm に落ちる (armMatch がアナウンスを消すので、次の試合ではまた出る)。
  //    **文面が空なら挟まない** — 真っ白な画面を数秒出すだけになるため
  //
  //    並列実行中は、他のレーンが実行中の試合を候補から外す。副レーンへ流せるのは
  //    BOT対戦予選の予選だけで、それ以外 (決勝トーナメント) は他のレーンが全部空いて
  //    いるときにだけ主レーンが取る — 主戦場は単独で行う、という pickLaneFor と同じ決まり
  const next = nextReadyMatches(i.matches, 1, {
    busyIds: new Set(i.otherArmedIds),
    canRun:  m => canRunInSideLane(i.format, m)
      ? true
      : i.primary && i.otherArmedIds.length === 0,
  })[0];
  if (next) {
    // アナウンスは観客席に1つしか無いので主レーンだけが出す
    const st = i.status.announcement;
    if (i.primary && i.announce && !st.visible && (st.title !== '' || st.body !== '')) {
      return { kind: 'announce' };
    }
    return { kind: 'arm', matchId: next.id };
  }

  // ⑤ 全試合が終わった (大会全体の判断なので主レーンだけ)
  if (i.primary && i.matches.every(m => m.status === 'done')) {
    return i.loop ? { kind: 'restart' } : { kind: 'finish' };
  }

  // 実施できる試合が無い (運営が巻き戻した直後など)。運営操作を待つ
  return null;
}
