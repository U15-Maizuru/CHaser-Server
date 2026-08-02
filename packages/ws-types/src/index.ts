// Shared WebSocket protocol types used by both backend and frontend.
// Do NOT duplicate these in apps/backend or apps/frontend.
//
// このファイルは re-export の集約点。実体は下記の3ファイルにあり、依存は一方向:
//
//   protocol.ts … 基本型・enum (依存なし)
//   scoring.ts  … 競技ルールの得点/勝敗の純関数 (→ protocol)
//   messages.ts … WS メッセージ union (→ protocol)
//
// scoring.ts が Winner のような実行時 enum を参照するため、index.ts から値を import し返すと
// 循環参照になる。上の一方向依存を崩さないこと。

export * from './protocol.js';
export * from './scoring.js';
export * from './messages.js';
