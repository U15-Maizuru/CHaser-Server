import { afterEach, describe, expect, it } from 'vitest';
import { SlotManager } from './SlotManager.js';
import type { ClientType, ProcessConfig } from '@u15/ws-types';

interface SlotInfoLike {
  type: ClientType;
  processConfig?: ProcessConfig;
}

/** private な slots フィールドへの読み書き。ネットワークI/O (listen) を経由せず直接状態を組み立てるためのテスト用アクセサ。 */
function slotsOf(sm: SlotManager): [SlotInfoLike, SlotInfoLike] {
  return (sm as unknown as { slots: [SlotInfoLike, SlotInfoLike] }).slots;
}

function makeConfig(label: string): ProcessConfig {
  return { programType: 'python', programPath: label, runtimeCommand: 'python' };
}

describe('SlotManager.swapSlotConfigs', () => {
  let sm: SlotManager | undefined;
  let nextPort = 39500;

  afterEach(() => {
    sm?.shutdown();
    sm = undefined;
  });

  const types: ClientType[] = ['tcp', 'cpu', 'process', 'manual'];

  for (const type0 of types) {
    for (const type1 of types) {
      it(`type0=${type0}, type1=${type1} → 両スロットの type と processConfig が入れ替わる`, () => {
        const port = nextPort;
        nextPort += 2;
        sm = new SlotManager([port, port + 1]);

        const cfg0 = makeConfig('slot0-program');
        const cfg1 = makeConfig('slot1-program');
        const slots = slotsOf(sm);
        slots[0] = { ...slots[0], type: type0, processConfig: cfg0 };
        slots[1] = { ...slots[1], type: type1, processConfig: cfg1 };

        sm.swapSlotConfigs();

        expect(slots[0].type).toBe(type1);
        expect(slots[1].type).toBe(type0);
        expect(slots[0].processConfig).toBe(cfg1);
        expect(slots[1].processConfig).toBe(cfg0);
      });
    }
  }
});

// スロットの状態遷移。以前は「tcp を閉じて state/name/ip/error を消す」処理が
// setClientType / deleteProgram / resetAllToDefault / resetForNextRound に散っており、
// cpu・manual を即 ready にする分岐も setClientType と startListening の2箇所にあった。
// まとめ直したときに挙動が変わっていないことを、ここで直接押さえる。
describe('SlotManager のスロット状態', () => {
  let sm: SlotManager | undefined;
  let nextPort = 39600;

  afterEach(() => {
    sm?.shutdown();
    sm = undefined;
  });

  function makeSlotManager(): SlotManager {
    const port = nextPort;
    nextPort += 2;
    return new SlotManager([port, port + 1]);
  }

  it('cpu にすると即 ready になり、名前と接続元が CPU / ローカルになる', async () => {
    sm = makeSlotManager();
    await sm.setClientType(0, 'cpu');

    const [s0] = sm.getStatuses();
    expect(s0.type).toBe('cpu');
    expect(s0.state).toBe('ready');
    expect(s0.name).toBe('CPU');
    expect(s0.ip).toBe('ローカル');
    expect(slotsOf(sm)[0].processConfig).toBeUndefined();
  });

  it('manual にすると即 ready になり、名前と接続元が 手動操作 / ローカルになる', async () => {
    sm = makeSlotManager();
    await sm.setClientType(1, 'manual');

    const [, s1] = sm.getStatuses();
    expect(s1.type).toBe('manual');
    expect(s1.state).toBe('ready');
    expect(s1.name).toBe('手動操作');
    expect(s1.ip).toBe('ローカル');
  });

  it('process にすると接続待ちに戻り、processConfig は保持される', async () => {
    sm = makeSlotManager();
    const cfg = makeConfig('p.py');
    await sm.setClientType(0, 'process', cfg);

    const [s0] = sm.getStatuses();
    expect(s0.state).toBe('waiting');
    expect(s0.name).toBe('');
    expect(s0.ip).toBe('');
    expect(slotsOf(sm)[0].processConfig).toBe(cfg);
  });

  it('tcp にすると processConfig は捨てられる (プログラム起動の対象ではなくなるため)', async () => {
    sm = makeSlotManager();
    await sm.setClientType(0, 'process', makeConfig('p.py'));
    await sm.setClientType(0, 'tcp');

    expect(slotsOf(sm)[0].processConfig).toBeUndefined();
    expect(sm.getStatuses()[0].state).toBe('waiting');
  });

  it('deleteProgram は processConfig ごと接続待ちへ戻す', async () => {
    sm = makeSlotManager();
    await sm.setClientType(0, 'process', makeConfig('p.py'));
    sm.deleteProgram(0);

    const [s0] = sm.getStatuses();
    expect(s0.state).toBe('waiting');
    expect(s0.name).toBe('');
    expect(s0.ip).toBe('');
    expect(s0.error).toBeUndefined();
    expect(slotsOf(sm)[0].processConfig).toBeUndefined();
  });

  it('resetAllToDefault は type も既定 (process) に戻す', async () => {
    sm = makeSlotManager();
    await sm.setClientType(0, 'cpu');
    await sm.setClientType(1, 'manual');

    sm.resetAllToDefault();

    const statuses = sm.getStatuses();
    for (const s of statuses) {
      expect(s.type).toBe('process');
      expect(s.state).toBe('waiting');
      expect(s.name).toBe('');
      expect(s.ip).toBe('');
    }
  });

  it('resetForNextRound は type を維持したまま接続状態だけ戻す', async () => {
    sm = makeSlotManager();
    await sm.setClientType(0, 'cpu');
    await sm.setClientType(1, 'manual');

    sm.resetForNextRound();

    const statuses = sm.getStatuses();
    expect(statuses[0].type).toBe('cpu');
    expect(statuses[1].type).toBe('manual');
    expect(statuses[0].state).toBe('waiting');
    expect(statuses[1].state).toBe('waiting');
    expect(statuses[0].name).toBe('');
    expect(statuses[1].name).toBe('');
  });

  it('resetForNextRound のあと listening を張り直すと cpu / manual は即 ready へ戻る', async () => {
    sm = makeSlotManager();
    await sm.setClientType(0, 'cpu');
    await sm.setClientType(1, 'manual');
    sm.resetForNextRound();

    await sm.startListeningBoth();

    const statuses = sm.getStatuses();
    expect(statuses[0].state).toBe('ready');
    expect(statuses[0].name).toBe('CPU');
    expect(statuses[1].state).toBe('ready');
    expect(statuses[1].name).toBe('手動操作');
  });

  it('allReady は両スロットが ready のときだけ true', async () => {
    sm = makeSlotManager();
    expect(sm.allReady()).toBe(false);
    await sm.setClientType(0, 'cpu');
    expect(sm.allReady()).toBe(false);
    await sm.setClientType(1, 'cpu');
    expect(sm.allReady()).toBe(true);
  });
});
