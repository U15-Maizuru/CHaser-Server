import { describe, expect, it } from 'vitest';
import { ManualClient } from './ManualClient.js';
import { Action, ConnectingStatus, MapObject, Rote, Team } from '../game/types.js';

const AROUND = { connect: ConnectingStatus.CONTINUE, data: Array(9).fill(MapObject.NOTHING) };

/** waitReturnMethod を待たせておき、指定の数値を注入した結果の Method を返す */
async function inject(client: ManualClient, action: number, rote: number) {
  const pending = client.waitReturnMethod(AROUND);
  client.receiveAction(action, rote);
  return pending;
}

describe('ManualClient.receiveAction', () => {
  it('正規の行動と方向はそのまま通す', async () => {
    const client = new ManualClient(0);
    const method = await inject(client, Action.LOOK, Rote.UP);
    expect(method).toEqual({ team: Team.COOL, action: Action.LOOK, rote: Rote.UP });
  });

  it('slot 1 は HOT になる', async () => {
    const client = new ManualClient(1);
    const method = await inject(client, Action.SEARCH, Rote.LEFT);
    expect(method.team).toBe(Team.HOT);
  });

  // 素通しすると applyMethod の switch にも Game.ts の妥当性チェックにも当たらず、
  // 何も起きないターンになってしまう。UNKNOWN に丸めて切断ルートへ乗せる。
  it('範囲外のアクションは UNKNOWN に丸める', async () => {
    const client = new ManualClient(0);
    for (const action of [-1, 99, Action.GETREADY, Action.UNKNOWN]) {
      expect((await inject(client, action, Rote.UP)).action).toBe(Action.UNKNOWN);
    }
  });

  it('範囲外の方向は UNKNOWN に丸める', async () => {
    const client = new ManualClient(0);
    for (const rote of [-1, 99, Rote.UNKNOWN]) {
      expect((await inject(client, Action.WALK, rote)).rote).toBe(Rote.UNKNOWN);
    }
  });

  it('入力待ちでないときの receiveAction は無視する', () => {
    const client = new ManualClient(0);
    expect(() => client.receiveAction(Action.WALK, Rote.UP)).not.toThrow();
  });
});

describe('ManualClient.forceDisconnect', () => {
  it('入力待ち中に呼ぶと pendingMethod を即座に UNKNOWN で解決する', async () => {
    const client = new ManualClient(0);
    const pending = client.waitReturnMethod(AROUND);

    client.forceDisconnect();

    expect(client.isDisconnected).toBe(true);
    await expect(pending).resolves.toEqual({ team: Team.COOL, action: Action.UNKNOWN, rote: Rote.UNKNOWN });
  });

  it('入力待ちの前に呼んでいても、その後の waitReturnMethod が永久に待たされない', async () => {
    const client = new ManualClient(1);
    client.forceDisconnect(); // まだ waitReturnMethod を呼んでいない状態での中断

    // 中断前に作った Promise が無いので、ここで新しく作った Promise が
    // 誰にも解決されず永久に pending になっていないかを確認する
    const method = await client.waitReturnMethod(AROUND);
    expect(method).toEqual({ team: Team.HOT, action: Action.UNKNOWN, rote: Rote.UNKNOWN });
  });
});
