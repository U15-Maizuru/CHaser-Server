import { EventEmitter } from 'node:events';
import { applyMethod, countItems, getAroundData, judgeGame, scanInfoFrom, type GameState } from './GameLogic.js';
import { aroundDataFinish } from './GameSystem.js';
import {
  Action,
  type GameMap,
  type GameStatus,
  Rote,
  TEAM_COUNT,
  type Team,
  Winner,
} from './types.js';
import type { BaseClient } from '../network/BaseClient.js';
import type { StableLog } from '../log/StableLog.js';

export interface GameResult {
  status: GameStatus;
  state: GameState;
}

// Events emitted by GameSession:
//   'turnStart'   (player: number, state: GameState)
//   'stateUpdate' (state: GameState, scan?: ScanInfo | null)
//   'gameEnd'     (result: GameResult)
export class GameSession extends EventEmitter {
  async run(
    clients:      [BaseClient, BaseClient],
    map:          GameMap,
    log?:         StableLog,
    turnDelayMs = 0,
    startDelayMs = 0,
  ): Promise<GameResult> {
    let state: GameState = {
      map,
      teamPos: [{ ...map.teamFirstPoint[0] }, { ...map.teamFirstPoint[1] }],
      teamScore: [0, 0],
      turnCount: map.turn,
      leaveItems: countItems(map),
      isDisconnected: [false, false],
    };

    // Broadcast initial state
    this.emit('stateUpdate', state);

    // 開始カウントダウン演出 (フロント) と同じ時間だけ、実際のターン処理開始を待つ
    if (startDelayMs > 0) await sleep(startDelayMs);

    while (state.turnCount > 0) {
      for (let player = 0; player < TEAM_COUNT; player++) {
        const client = clients[player];

        // ====== GetReady phase: send @, wait gr ======
        this.emit('turnStart', player, state);

        const getReadyOk = await client.waitGetReady();
        if (!getReadyOk) {
          state = setDisconnected(state, player);
          log?.write(`[停止] player${player} GetReadyに失敗\r\n`);
        }

        // Get around data at current position (before move)
        const aroundBefore = getAroundData(state, player as Team);

        // Send around data, wait for method response
        const method = await client.waitReturnMethod(aroundBefore);
        method.team = player as Team;

        // Validate: double get_ready / unknown action
        if (method.action === Action.GETREADY || method.action === Action.UNKNOWN) {
          state = setDisconnected(state, player);
          log?.write(`[停止] player${player} 不正なアクション\r\n`);
        }
        if (method.rote === Rote.UNKNOWN) {
          state = setDisconnected(state, player);
          log?.write(`[停止] player${player} 不正な方向\r\n`);
        }

        // Apply method to game state
        const prevScore = state.teamScore[player];
        state = applyMethod(state, method);
        state = syncDisconnected(state, clients);

        // Emit state after move; emit score_update if score changed.
        // LOOK/SEARCH は位置を変えないので、ここで組み立てた範囲は下の aroundAfter と同じ座標になる。
        this.emit('stateUpdate', state, scanInfoFrom(state, player as 0 | 1, method));
        if (turnDelayMs > 0) await sleep(turnDelayMs);
        if (state.teamScore[player] !== prevScore) {
          this.emit('scoreUpdate', state);
        }

        // Judge after GetReady phase
        let status = judgeGame(state, player);
        if (status.winner !== Winner.CONTINUE) {
          return await this.finishGame(status, state, player, clients, log);
        }

        // ====== EndSharp phase: send updated around, wait # ======
        // クライアントの行動関数 (walk()/look()/search()/put()) が受け取るのはこのデータ。
        // method を渡すことで LOOK/SEARCH のときだけ探索範囲が返る。
        // 一方 GetReady フェーズの aroundBefore は method 確定前に送るため常に自機中心の 3x3。
        const aroundAfter = getAroundData(state, player as Team, method);
        const endSharpOk = await client.waitEndSharp(aroundAfter);
        if (!endSharpOk) {
          state = setDisconnected(state, player);
          log?.write(`[停止] player${player} EndSharpに失敗\r\n`);
        }

        state = syncDisconnected(state, clients);

        // Judge after EndSharp phase
        status = judgeGame(state, player);
        if (status.winner !== Winner.CONTINUE) {
          return await this.finishGame(status, state, player, clients, log);
        }
      }

      state = { ...state, turnCount: state.turnCount - 1 };
      log?.write(`-----残${state.turnCount}ターン-----\r\n`);
    }

    // Turn 0: score judgment
    const status = judgeGame({ ...state, turnCount: 0 }, TEAM_COUNT - 1);
    log?.write(formatResult(status) + '\r\n');
    const result: GameResult = { status, state };
    this.emit('gameEnd', result);
    return result;
  }

  /** ターン処理の途中で決着した場合の共通の終了処理: ログ出力・相手プレイヤーへの決着通知・gameEnd 通知 */
  private async finishGame(
    status:  GameStatus,
    state:   GameState,
    player:  number,
    clients: [BaseClient, BaseClient],
    log?:    StableLog,
  ): Promise<GameResult> {
    log?.write(formatResult(status) + '\r\n');
    await notifyOtherPlayer(clients, state, player);
    const result: GameResult = { status, state };
    this.emit('gameEnd', result);
    return result;
  }
}

function setDisconnected(state: GameState, player: number): GameState {
  const isDisconnected: [boolean, boolean] = [...state.isDisconnected] as [boolean, boolean];
  isDisconnected[player] = true;
  return { ...state, isDisconnected };
}

function syncDisconnected(state: GameState, clients: [BaseClient, BaseClient]): GameState {
  const isDisconnected: [boolean, boolean] = [
    state.isDisconnected[0] || clients[0].isDisconnected,
    state.isDisconnected[1] || clients[1].isDisconnected,
  ];
  return { ...state, isDisconnected };
}

async function notifyOtherPlayer(
  clients: [BaseClient, BaseClient],
  state: GameState,
  currentPlayer: number,
): Promise<void> {
  const other = (currentPlayer + 1) % TEAM_COUNT;
  const otherClient = clients[other];
  if (otherClient.isDisconnected) return;

  await otherClient.waitGetReady();
  const finished = aroundDataFinish(getAroundData(state, other as Team));
  await otherClient.waitReturnMethod(finished);
}

function formatResult(status: GameStatus): string {
  return `[決着] winner=${status.winner} reason=${status.reason}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
