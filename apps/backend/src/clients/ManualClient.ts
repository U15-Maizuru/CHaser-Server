import { BaseClient } from '../network/BaseClient.js';
import type { AroundData, Method } from '../game/types.js';
import { Action, Rote, Team } from '../game/types.js';

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

  /** WsServer から呼ばれる: フロントからのアクションを注入 */
  receiveAction(action: number, rote: number): void {
    if (this.pendingMethod) {
      this.pendingMethod({
        team:   this.team,
        action: action as Action,
        rote:   rote   as Rote,
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
