import type { GameEndPayload } from '@u15/ws-types';
import { Reason, Winner } from '@u15/ws-types';

// 決着の瞬間に盤面上へ出す演出のパラメータ。
//
// 方針: 決着理由が何であれ、盤面を見れば必ず「どちらが勝ったか」が分かるようにする。
// そのため勝者には常に 👑 を付け、敗者は暗く沈ませる。敗者側のバッジ (💥💫🚧🔒📵) は
// その上で「なぜ負けたか」を追加で説明する役割を持つ。
//
// 敗因は「相手に仕掛けられた」ものと「自滅」が対になっている (アタック↔衝突、閉じ込め↔自縛)。
// この対は敗者リングの色で見分ける — 攻撃側チーム色なら相手のせい、警告色なら自滅。

export type DecisiveKind = 'attack' | 'collision' | 'trapped' | 'confined' | 'fouled' | 'score';

/** 敗因の物理表現。'none' は形なし (リングとバッジだけ) */
export type MarkShape = 'crush' | 'surround' | 'none';

/**
 * リングの色。'opponent' は描画時に「そのチームの相手の色」に解決する
 * (= 敗者から見た攻撃側の色)。null ならリングを描かない。
 */
export type MarkAccent = 'gold' | 'opponent' | 'warn';

export interface TeamMark {
  team:   0 | 1;
  role:   'winner' | 'loser' | 'draw';
  shape:  MarkShape;
  accent: MarkAccent | null;
  /** マス中央のバッジ絵文字。null なら描かない */
  badge:  string | null;
  /** 敗北を表す暗転を掛けるか */
  dim:    boolean;
}

export interface DecisiveEffect {
  kind:  DecisiveKind;
  /** 通常は勝者+敗者の2件。引き分けも両チーム分の2件 */
  marks: TeamMark[];
}

// 勝者の印は決着理由によらず共通。金色の 👑 で、暗転は掛けない。
const WINNER_MARK: Omit<TeamMark, 'team'> = {
  role: 'winner', shape: 'none', accent: 'gold', badge: '👑', dim: false,
};

// 引き分けの印。実際には SCORE (タイムアップ) でしか発生しない。
const DRAW_MARK: Omit<TeamMark, 'team'> = {
  role: 'draw', shape: 'none', accent: 'gold', badge: '🤝', dim: false,
};

type LoserShape = Pick<TeamMark, 'shape' | 'accent' | 'badge'>;

// 敗者側の表。見た目を変えたくなったらここだけを触ればよい。
// タイムアップ (SCORE) の敗者はリングもバッジも持たず、暗転だけで負けを示す
// (勝者の 👑 との対比で勝敗が読める)。
const LOSER_BY_REASON: Partial<Record<Reason, { kind: DecisiveKind } & LoserShape>> = {
  [Reason.ATTACK]:    { kind: 'attack',    shape: 'crush',    accent: 'opponent', badge: '💥'  },
  [Reason.COLLISION]: { kind: 'collision', shape: 'crush',    accent: 'warn',     badge: '💫'  },
  [Reason.TRAPPED]:   { kind: 'trapped',   shape: 'surround', accent: 'opponent', badge: '🚧'  },
  [Reason.CONFINED]:  { kind: 'confined',  shape: 'surround', accent: 'warn',     badge: '🔒'  },
  [Reason.FOULED]:    { kind: 'fouled',    shape: 'none',     accent: 'warn',     badge: '📵'  },
  [Reason.SCORE]:     { kind: 'score',     shape: 'none',     accent: null,       badge: null  },
};

/**
 * game_end から盤面演出のパラメータを求める。演出の対象外なら null。
 *
 * 敗者は winner から一意に決まる: バックエンドの judgeGame は敗者 p に対して
 * `winner = (p === 0 ? HOT : COOL)` を返すため、その逆写像を取ればよい
 * (バックエンドの calculateBonusBreakdown と同じ導出)。
 */
export function decisiveEffectFrom(gameEnd: GameEndPayload | null): DecisiveEffect | null {
  if (!gameEnd) return null;

  const loserShape = LOSER_BY_REASON[gameEnd.reason];
  if (!loserShape) return null; // Reason.NONE

  const { kind, ...shape } = loserShape;

  // 引き分けは勝敗が無いので、両チームに同じ印を付ける
  if (gameEnd.winner === Winner.DRAW) {
    return { kind, marks: [{ team: 0, ...DRAW_MARK }, { team: 1, ...DRAW_MARK }] };
  }

  // 未決着 (CONTINUE) 等では勝者・敗者が定まらないので演出しない
  if (gameEnd.winner !== Winner.COOL && gameEnd.winner !== Winner.HOT) return null;

  const loser:  0 | 1 = gameEnd.winner === Winner.COOL ? 1 : 0;
  const winner: 0 | 1 = loser === 0 ? 1 : 0;

  return {
    kind,
    marks: [
      { team: loser,  role: 'loser', dim: true, ...shape },
      { team: winner, ...WINNER_MARK },
    ],
  };
}
