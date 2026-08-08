# CHaser Server Maizuru — 作業の前提

U15プログラミングコンテスト舞鶴大会 向けのゲームサーバー。Electron デスクトップアプリとして
動き、`U15_MODE=web` ではブラウザから複数ルームを扱う Web サービスにもなる。

詳細は [README.md](README.md) / [docs/user-manual.md](docs/user-manual.md) /
[docs/developer-manual.md](docs/developer-manual.md)。ここには**毎回効く前提**だけを書く。

## 用語（間違えると設計を誤る）

公式競技ルールの用語に合わせている。**「ゲーム」と「試合」は別物**。

| 語 | 意味 | 型 |
|---|---|---|
| ゲーム (round) | 1回の対戦 | `RoundResult` |
| 試合 (set / match) | 先攻・後攻を入れ替えた2ゲーム | `SetResult` / `TournamentMatch` |
| 回戦・節 (stage) | トーナメントの回戦、リーグの節 | `TournamentMatch.stage` |

`round` を回戦の意味で使わないこと（`RoundResult.round` はゲーム番号 0|1）。

## 構成

```
apps/backend/    Node.js ゲームサーバー (ゲーム進行・TCP・HTTP/WS・大会運営)
apps/frontend/   React UI (Vite)。src/ui/ が画面共通の見た目
apps/electron/   Electron シェル (対戦表示 / コントロール / 大会運営の3ウィンドウ)
packages/ws-types/  バックエンドとフロントエンドが共有する型と純関数
```

**共有する型と純関数は `packages/ws-types` にだけ置く。** 同じ規則を両側で書くと必ずズレる。
特に「1回戦の並べ方」「回戦名」「次に実施する試合」「勝敗とポイントの計算」は共有側にある。

## コマンド

```bash
pnpm install
pnpm build                          # 全ワークスペースの型チェック + ビルド
pnpm -r test                        # 単体テスト (vitest)
pnpm test:e2e                       # Electron + Playwright の全自動 E2E
pnpm --filter @u15/electron dev     # 開発起動 (Electron + Vite + Backend)
```

- `@u15/ws-types` を変えたら **先に `pnpm --filter @u15/ws-types build`**。
  他パッケージは `dist/` を参照するので、ビルドしないと型が古いまま。
- 個別のテストは `pnpm --filter @u15/frontend exec vitest run <パターン>`
  （`npx vitest` はワークスペース外の vitest を拾って jsdom が無いと言われる）。

## コミット

- メッセージは日本語。`feat:` / `fix:` / `refactor:` / `docs:` / `chore:` を付ける
- `Co-Authored-By: Claude` 行は付けない

## 変更するときに必ず読むもの

`.claude/skills/` に、この repo で繰り返し必要になる知識を置いてある。

| スキル | 読むとき |
|---|---|
| `dev-workflow` | アプリを起動する / E2E を回す / 見た目を検証する |
| `tournament-domain` | 大会運営 (`apps/*/tournament`, `ws-types/tournament*.ts`) を触る |
| `docs-and-comments` | コメントを書く / ドキュメントを直す |
