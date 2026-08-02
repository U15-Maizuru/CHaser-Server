import type { CatalogEntry, ProcessConfig } from '@u15/ws-types';

/**
 * プログラムライブラリのエントリを、対戦スロットへ渡す ProcessConfig に変換する。
 *
 * libPath の規約 (`server/rooms/<roomId>/libs/<cool|hot>`) をここだけに置く。デモモードの
 * ランダム割り当てと大会運営の自動割り当てが別々に組み立てると、片方だけ規約が古くなる。
 */
export function buildProcessConfig(entry: CatalogEntry, slot: 0 | 1, roomId: string): ProcessConfig {
  return {
    programType:    entry.programType,
    programPath:    entry.programPath,
    runtimeCommand: entry.runtimeCommand,
    libPath:        `server/rooms/${roomId}/libs/${slot === 0 ? 'cool' : 'hot'}`,
  };
}
