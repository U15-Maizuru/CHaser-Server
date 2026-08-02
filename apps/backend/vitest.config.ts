import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // バックエンドのテストはプロセス全体で共有される資源に触れる:
    //   ・server/program-catalog, server/map-catalog, server/tournament などの実ディレクトリ
    //     (programCatalog.test.ts と TournamentStore.test.ts が同じカタログを消し合う)
    //   ・TCP のリッスンポート (並列に立てると EADDRINUSE で落ちる)
    // ファイル単位で直列に実行してこの競合を無くす。
    fileParallelism: false,
  },
});
