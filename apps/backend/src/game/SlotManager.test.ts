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
