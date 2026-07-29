import {
  Action,
  AroundData,
  ConnectingStatus,
  GameMap,
  GameStatus,
  MapObject,
  Method,
  Reason,
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

export function getAroundData(state: GameState, team: Team): AroundData {
  const pos = state.teamPos[team as unknown as 0 | 1];
  const data: MapObject[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      if (nx < 0 || nx >= state.map.size.x || ny < 0 || ny >= state.map.size.y) {
        data.push(MapObject.BLOCK);
      } else {
        data.push(state.map.field[ny][nx]);
      }
    }
  }
  return { connect: ConnectingStatus.CONTINUE, data };
}

export function judgeGame(state: GameState, currentPlayer: number): GameStatus {
  const teamLose: boolean[] = [false, false];

  for (let i = 0; i < TEAM_COUNT; i++) {
    const p = (currentPlayer + 1 + i) % TEAM_COUNT;
    const around = getAroundData(state, p as Team);

    // ブロック下敷き
    if (around.data[4] === MapObject.BLOCK) {
      const reason = currentPlayer !== p ? Reason.ATTACK : Reason.COLLISION;
      return { winner: p === 0 ? Winner.HOT : Winner.COOL, reason };
    }

    // ブロック囲まれ
    if (
      around.data[1] === MapObject.BLOCK &&
      around.data[3] === MapObject.BLOCK &&
      around.data[5] === MapObject.BLOCK &&
      around.data[7] === MapObject.BLOCK
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

/**
 * 2試合制のラウンド別ボーナス内訳: 「一撃」(反則負け(自縛/衝突/通信エラー)時の減点) と
 * 「総取り」(競技ルール3.②: 規定ターン数前に決着した場合の残アイテムボーナス)。
 * reason===SCORE (ターン切れによるアイテム数判定) の場合はどちらも 0。
 */
export function calculateBonusBreakdown(
  status:     GameStatus,
  scores:     [number, number], // [cool, hot]
  leaveItems: number,
): { strikeBonus: [number, number]; sweepBonus: [number, number] } {
  const strikeBonus: [number, number] = [0, 0];
  const sweepBonus:  [number, number] = [0, 0];

  if (status.reason === Reason.SCORE) return { strikeBonus, sweepBonus };

  const winnerIdx = status.winner === Winner.COOL ? 0 : 1;
  const loserIdx  = winnerIdx === 0 ? 1 : 0;

  if (isBlunder(status)) {
    strikeBonus[loserIdx] = -3 * scores[loserIdx];
  }
  sweepBonus[winnerIdx] = 7 * leaveItems;

  return { strikeBonus, sweepBonus };
}
