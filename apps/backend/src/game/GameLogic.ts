import {
  AroundData,
  Cause,
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

  const team = method.team as unknown as number;
  const pos = next.teamPos[team];

  switch (method.action) {
    case 2 /* SEARCH */:
    case 1 /* LOOK */: {
      // LOOK/SEARCH: 位置は変わらない
      break;
    }
    case 0 /* WALK */: {
      const dx = method.rote === 3 ? -1 : method.rote === 2 ? 1 : 0;
      const dy = method.rote === 0 ? -1 : method.rote === 1 ? 1 : 0;
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      if (nx >= 0 && nx < next.map.size.x && ny >= 0 && ny < next.map.size.y) {
        if (next.map.field[ny][nx] !== MapObject.BLOCK) {
          next.teamPos[team] = { x: nx, y: ny };
          if (next.map.field[ny][nx] === MapObject.ITEM) {
            next.map.field[ny][nx] = MapObject.NOTHING;
            next.teamScore[team]++;
            next.leaveItems--;
          }
        }
      }
      break;
    }
    case 3 /* PUT */: {
      const dx = method.rote === 3 ? -1 : method.rote === 2 ? 1 : 0;
      const dy = method.rote === 0 ? -1 : method.rote === 1 ? 1 : 0;
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
  const pos = state.teamPos[team as unknown as number];
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
      return { winner: p === 0 ? Winner.HOT : Winner.COOL, reason, cause: Cause.NONE };
    }

    // ブロック囲まれ
    if (
      around.data[1] === MapObject.BLOCK &&
      around.data[3] === MapObject.BLOCK &&
      around.data[5] === MapObject.BLOCK &&
      around.data[7] === MapObject.BLOCK
    ) {
      const reason = currentPlayer !== p ? Reason.TRAPPED : Reason.CONFINED;
      return { winner: p === 0 ? Winner.HOT : Winner.COOL, reason, cause: Cause.NONE };
    }

    // 切断
    if (state.isDisconnected[p]) {
      teamLose[p] = true;
      return { winner: p === 0 ? Winner.HOT : Winner.COOL, reason: Reason.FOULED, cause: Cause.NONE };
    }
  }

  // 時間切れ or 相打ち → アイテム判定
  if (state.turnCount === 0 || (teamLose[0] && teamLose[1])) {
    if (state.teamScore[0] === state.teamScore[1]) {
      return { winner: Winner.DRAW, reason: Reason.SCORE, cause: Cause.NONE };
    }
    const winner = state.teamScore[0] > state.teamScore[1] ? Winner.COOL : Winner.HOT;
    return { winner, reason: Reason.SCORE, cause: Cause.NONE };
  }

  return { winner: Winner.CONTINUE, reason: Reason.NONE, cause: Cause.NONE };
}

export function isBlunder(status: GameStatus): boolean {
  return (
    status.reason === Reason.CONFINED ||
    status.reason === Reason.COLLISION ||
    status.reason === Reason.FOULED
  );
}
