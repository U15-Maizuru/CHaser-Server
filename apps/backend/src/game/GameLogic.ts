import {
  Action,
  AroundData,
  ConnectingStatus,
  GameMap,
  GameStatus,
  MapObject,
  Method,
  Point,
  Reason,
  Rote,
  ScanInfo,
  TEAM_COUNT,
  Team,
  Winner,
} from './types.js';
import { getRoteVector } from './GameSystem.js';

export interface GameState {
  map: GameMap;
  teamPos: [{ x: number; y: number }, { x: number; y: number }];
  teamScore: [number, number];
  turnCount: number;
  leaveItems: number;
  isDisconnected: [boolean, boolean];
}

export function countItems(map: GameMap): number {
  let count = 0;
  for (const row of map.field) {
    for (const cell of row) {
      if (cell === MapObject.ITEM) count++;
    }
  }
  return count;
}

export function applyMethod(state: GameState, method: Method): GameState {
  const next: GameState = {
    ...state,
    map: {
      ...state.map,
      field: state.map.field.map(row => [...row]),
    },
    teamPos: [{ ...state.teamPos[0] }, { ...state.teamPos[1] }],
    teamScore: [...state.teamScore] as [number, number],
  };

  // Team は COOL=0/HOT=1/UNKNOWN=2 の3値だが、teamPos は自チーム分の2要素タプル
  // (UNKNOWN が来ることはない) なので 0|1 として扱う
  const team = method.team as unknown as 0 | 1;
  const pos = next.teamPos[team];

  switch (method.action) {
    case Action.SEARCH:
    case Action.LOOK: {
      // LOOK/SEARCH: 位置は変わらない
      break;
    }
    case Action.WALK: {
      const { x: dx, y: dy } = getRoteVector(method.rote);
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      if (nx >= 0 && nx < next.map.size.x && ny >= 0 && ny < next.map.size.y) {
        // ブロックのあるマスへの移動も許可する。移動後の判定は judgeGame の
        // COLLISION 判定 (競技ルール1.④「相手がブロックのあるマスに移動する」) に委ねる。
        next.teamPos[team] = { x: nx, y: ny };
        if (next.map.field[ny][nx] === MapObject.ITEM) {
          next.map.field[ny][nx] = MapObject.NOTHING;
          next.teamScore[team]++;
          next.leaveItems--;
          // アイテム取得時、元居た場所にブロックができる
          next.map.field[pos.y][pos.x] = MapObject.BLOCK;
        }
      }
      break;
    }
    case Action.PUT: {
      const { x: dx, y: dy } = getRoteVector(method.rote);
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      if (nx >= 0 && nx < next.map.size.x && ny >= 0 && ny < next.map.size.y) {
        if (next.map.field[ny][nx] === MapObject.NOTHING) {
          next.map.field[ny][nx] = MapObject.BLOCK;
        }
      }
      break;
    }
  }

  return next;
}

/** pos を中心とする 3x3 を row-major (左上→右下) で返す */
function grid3x3(pos: Point): Point[] {
  const cells: Point[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      cells.push({ x: pos.x + dx, y: pos.y + dy });
    }
  }
  return cells;
}

/**
 * 行動が調べるマスを返す (常に9要素・盤外の座標も含む)。本家 CHaser 準拠:
 *
 * - LOOK   : 指定方向に 2 マス離れた地点を中心とする 3x3 (= その方向の距離 1〜3 の帯)。row-major 順。
 * - SEARCH : 指定方向の直線 9 マス (距離 1〜9)。index 0 が最も近い。
 * - それ以外 (WALK / PUT / GETREADY / UNKNOWN): 自機中心の 3x3。
 *
 * rote が UNKNOWN のとき getRoteVector は {0,0} を返すため、LOOK/SEARCH は自機中心に縮退する。
 * 不正な方向は Game.ts 側で切断扱いになるので、ここでは縮退した値を返すだけに留める。
 */
export function getScanCells(pos: Point, action: Action, rote: Rote): Point[] {
  const v = getRoteVector(rote);
  if (action === Action.LOOK) {
    return grid3x3({ x: pos.x + v.x * 2, y: pos.y + v.y * 2 });
  }
  if (action === Action.SEARCH) {
    return Array.from({ length: 9 }, (_, i) => ({
      x: pos.x + v.x * (i + 1),
      y: pos.y + v.y * (i + 1),
    }));
  }
  return grid3x3(pos);
}

/** 盤面の生の値。盤外は BLOCK 扱い。プレイヤーの位置は考慮しない */
function fieldAt(state: GameState, { x, y }: Point): MapObject {
  return x < 0 || x >= state.map.size.x || y < 0 || y >= state.map.size.y
    ? MapObject.BLOCK
    : state.map.field[y][x];
}

/**
 * judgeGame 専用の自機中心 3x3。相手プレイヤーのオーバーレイを載せない生の盤面値を返す。
 *
 * 下敷き判定 ([4]) / 囲まれ判定 ([1][3][5][7]) はどちらも「そのマスがブロックか」しか見ないため、
 * getAroundData の TARGET オーバーレイが混ざると、両者が同一マスに重なったときに BLOCK が
 * 隠れて判定が消えてしまう。範囲も常に 3x3 で固定する (行動依存にしない)。
 */
export function getJudgeAround(state: GameState, team: Team): MapObject[] {
  return grid3x3(state.teamPos[team as unknown as 0 | 1]).map(c => fieldAt(state, c));
}

/**
 * クライアントに返す9マス。method を省略すると自機中心の 3x3 (GetReady フェーズの挙動)。
 *
 * 本家 GameBoard::FieldAccess と同じく、相手プレイヤーがいるマスは盤面値より優先して
 * TARGET を返す。これが look()/search() で相手を発見する唯一の手段になる。
 * 勝敗判定にこのオーバーレイを持ち込まないため、judgeGame は getJudgeAround を使うこと。
 */
export function getAroundData(state: GameState, team: Team, method?: Method): AroundData {
  const self  = team as unknown as 0 | 1;
  const enemy = state.teamPos[(1 - self) as 0 | 1];
  const cells = getScanCells(state.teamPos[self], method?.action ?? Action.WALK, method?.rote ?? Rote.UNKNOWN);
  const data = cells.map(c =>
    c.x === enemy.x && c.y === enemy.y ? MapObject.TARGET : fieldAt(state, c),
  );
  return { connect: ConnectingStatus.CONTINUE, data };
}

/**
 * 演出用に探索範囲を自機から近い順へ並べ替える。SEARCH は getScanCells の時点で既に
 * 近い順なので実質そのまま。LOOK は絶対座標の row-major (ワイヤ形式に合わせた順序) で
 * 届くため、方向ベクトルへの射影で並べ替えて「距離1の帯 3マス → 距離2 → 距離3」にする。
 * 同じ帯の中の並びは row-major のまま保たれる (Array.prototype.sort は安定ソート)。
 */
function orderByDistance(cells: Point[], rote: Rote): Point[] {
  const v = getRoteVector(rote);
  return [...cells].sort((a, b) => (a.x * v.x + a.y * v.y) - (b.x * v.x + b.y * v.y));
}

/**
 * 盤面演出用に、LOOK/SEARCH が調べた範囲を組み立てる。それ以外の行動と、
 * 方向が不正で範囲が縮退する場合は null。
 *
 * cells は描画側がスイープ演出に使えるよう自機から近い順に並べる。クライアントに返る
 * AroundData の順序 (絶対座標 row-major) とは別物なので、getScanCells 側は触らない。
 */
export function scanInfoFrom(state: GameState, team: 0 | 1, method: Method): ScanInfo | null {
  if (method.action !== Action.LOOK && method.action !== Action.SEARCH) return null;
  if (method.rote === Rote.UNKNOWN) return null;
  return {
    team,
    action: method.action,
    rote:   method.rote,
    cells:  orderByDistance(
      getScanCells(state.teamPos[team], method.action, method.rote),
      method.rote,
    ),
  };
}

export function judgeGame(state: GameState, currentPlayer: number): GameStatus {
  const teamLose: boolean[] = [false, false];

  for (let i = 0; i < TEAM_COUNT; i++) {
    const p = (currentPlayer + 1 + i) % TEAM_COUNT;
    const around = getJudgeAround(state, p as Team);

    // ブロック下敷き
    if (around[4] === MapObject.BLOCK) {
      const reason = currentPlayer !== p ? Reason.ATTACK : Reason.COLLISION;
      return { winner: p === 0 ? Winner.HOT : Winner.COOL, reason };
    }

    // ブロック囲まれ
    if (
      around[1] === MapObject.BLOCK &&
      around[3] === MapObject.BLOCK &&
      around[5] === MapObject.BLOCK &&
      around[7] === MapObject.BLOCK
    ) {
      const reason = currentPlayer !== p ? Reason.TRAPPED : Reason.CONFINED;
      return { winner: p === 0 ? Winner.HOT : Winner.COOL, reason };
    }

    // 切断
    if (state.isDisconnected[p]) {
      teamLose[p] = true;
      return { winner: p === 0 ? Winner.HOT : Winner.COOL, reason: Reason.FOULED };
    }
  }

  // 時間切れ or 相打ち → アイテム判定
  if (state.turnCount === 0 || (teamLose[0] && teamLose[1])) {
    if (state.teamScore[0] === state.teamScore[1]) {
      return { winner: Winner.DRAW, reason: Reason.SCORE };
    }
    const winner = state.teamScore[0] > state.teamScore[1] ? Winner.COOL : Winner.HOT;
    return { winner, reason: Reason.SCORE };
  }

  return { winner: Winner.CONTINUE, reason: Reason.NONE };
}

// 反則負けの減点対象 (自縛・衝突・通信エラー。相手を追い詰めた側 (TRAPPED/ATTACK) は対象外)
export function isBlunder(status: GameStatus): boolean {
  return (
    status.reason === Reason.CONFINED ||
    status.reason === Reason.COLLISION ||
    status.reason === Reason.FOULED
  );
}

// 競技ルールの得点係数
/** アタック・閉じ込めで勝った側への「一撃」加点 */
const STRIKE_WIN_BONUS = 50;
/** 衝突・自縛・通信エラーで負けた側への「一撃」減点 (×自分の獲得アイテム数) */
const BLUNDER_PENALTY_PER_ITEM = 3;
/** 「総取り」ボーナス (×決着時点の残アイテム数) */
const SWEEP_POINT_PER_ITEM = 6;

/**
 * ゲーム別のボーナス内訳。競技ルールの「ポイント」より:
 *
 *   一撃ボーナス (ペナルティ)
 *     アタック・閉じ込め【勝】: 50点を加点
 *     衝突・自縛【敗】       : 獲得したアイテム数×3点を減点 (通信エラーも同扱い)
 *   総取り【勝】             : 残りのアイテム数×6点を加点
 *
 * reason===SCORE (ターン切れによるアイテム数判定) の場合はどちらも 0。
 * 勝者が定まらない決着 (引き分け等) でも 0。
 */
export function calculateBonusBreakdown(
  status:     GameStatus,
  scores:     [number, number], // [cool, hot]
  leaveItems: number,
): { strikeBonus: [number, number]; sweepBonus: [number, number] } {
  const strikeBonus: [number, number] = [0, 0];
  const sweepBonus:  [number, number] = [0, 0];

  if (status.reason === Reason.SCORE) return { strikeBonus, sweepBonus };
  // 勝者が COOL/HOT に定まらない場合 (DRAW/CONTINUE/NONE) は加点対象が無い。
  // 勝者側への加点 (+50・総取り) が入るため、ここで明示的に弾く
  if (status.winner !== Winner.COOL && status.winner !== Winner.HOT) {
    return { strikeBonus, sweepBonus };
  }

  const winnerIdx = status.winner === Winner.COOL ? 0 : 1;
  const loserIdx  = winnerIdx === 0 ? 1 : 0;

  if (isBlunder(status)) {
    // 自滅による決着: 敗者に減点。勝者は「一撃」の加点対象ではない
    strikeBonus[loserIdx] = -BLUNDER_PENALTY_PER_ITEM * scores[loserIdx];
  } else {
    // 相手を仕留めた決着 (アタック / 閉じ込め): 勝者に定額加点
    strikeBonus[winnerIdx] = STRIKE_WIN_BONUS;
  }
  sweepBonus[winnerIdx] = SWEEP_POINT_PER_ITEM * leaveItems;

  return { strikeBonus, sweepBonus };
}
