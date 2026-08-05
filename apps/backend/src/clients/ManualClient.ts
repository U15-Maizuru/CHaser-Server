import { BaseClient } from '../network/BaseClient.js';
import type { AroundData, Method } from '../game/types.js';
import { Action, Rote, Team } from '../game/types.js';

// フロントから届く数値の許容集合 (GETREADY / UNKNOWN は手動操作から送れてはいけない)
const VALID_ACTIONS: number[] = [Action.WALK, Action.LOOK, Action.SEARCH, Action.PUT];
const VALID_ROTES:   number[] = [Rote.UP, Rote.DOWN, Rote.RIGHT, Rote.LEFT];

/**
 * フロントエンドのキーボード入力をWebSocket経由で受け取るクライアント。
 * 参照: U15-server-maizuru ManualClient.cpp
 */
export class ManualClient extends BaseClient {
  private readonly slot: 0 | 1;
  private readonly team: Team;
  private pendingMethod: ((m: Method) => void) | null = null;
  private pendingAroundData: number[] | null = null;

  constructor(slot: 0 | 1) {
    super();
    this.slot = slot;
    this.team = slot === 0 ? Team.COOL : Team.HOT;
    this.name = '手動操作';
    this.ip   = 'ローカル';
  }

  get currentSlot(): 0 | 1 { return this.slot; }
  get currentAroundData(): number[] | null { return this.pendingAroundData; }

  /**
   * WsServer から呼ばれる: フロントからのアクションを注入。
   * 想定外の数値は UNKNOWN に丸めて Game 側の不正アクション判定 (= 切断扱い) に乗せる。
   * 素通しすると switch のどの case にも当たらず、何も起きないターンになってしまう。
   */
  receiveAction(action: number, rote: number): void {
    if (this.pendingMethod) {
      this.pendingMethod({
        team:   this.team,
        action: VALID_ACTIONS.includes(action) ? (action as Action) : Action.UNKNOWN,
        rote:   VALID_ROTES.includes(rote)     ? (rote   as Rote)   : Rote.UNKNOWN,
      });
      this.pendingMethod    = null;
      this.pendingAroundData = null;
    }
  }

  async waitGetReady(): Promise<boolean> {
    return true;
  }

  async waitReturnMethod(around: AroundData): Promise<Method> {
    // フロントエンドにアラウンドデータを送信して入力を待つ
    this.pendingAroundData = around.data.map(v => v as number);
    this.emit('need_input', this.slot, this.pendingAroundData);

    return new Promise<Method>(resolve => {
      this.pendingMethod = resolve;
    });
  }

  async waitEndSharp(_around: AroundData): Promise<boolean> {
    return true;
  }

  startup(): void {
    // 即座に準備完了
  }
}
