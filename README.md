# U15 Server Maizuru

U15プログラミングコンテスト舞鶴大会 向けゲームサーバー。

Python で書かれた AI プログラムを対戦させる **CHaser 系 2人対戦ゲーム**のサーバー実装です。Electron デスクトップアプリとして動作し、リモートブラウザからも操作可能な WebSocket/HTTP API を備えています。

Electron アプリとして1台のPCで動かす**ローカルモード**に加え、`U15_MODE=web` で起動すると
ブラウザから複数のルーム(対戦)を同時に作成・観戦できる**Webサービスモード**としても動作します。
詳細は [docs/developer-manual.md](docs/developer-manual.md#10-マルチルーム--web-サービスモード) を参照してください。

---

## 2ウィンドウ構成

アプリ起動時に**2つのウィンドウ**が開きます。

| ウィンドウ | 用途 |
|---|---|
| **対戦表示ウィンドウ** (1280×800) | ゲームボードを常時表示。プロジェクターや観客用モニターに向ける |
| **コントロールウィンドウ** (820×920) | チーム設定・プログラムアップロード・ゲーム開始など操作専用 |

---

## 特徴

- **Python プログラムアップロード** — `.py` ファイルをドラッグ&ドロップするだけで AI を登録
- **pychaser ライブラリ対応** — プリインストール済み。カスタムライブラリの追加も可能
- **2試合制** — 先攻・後攻を入れ替えた2試合モード。勝ち点・スコア集計を自動表示
- **手動操作モード** — キーボード/ボタンで人間がプレイ（デモ・動作確認用）
- **1ターン表示時間設定** — 各ターンの表示待機時間を調整可能（デフォルト 1秒）
- **リアルタイム観戦** — WebSocket で複数ブラウザから同時観戦可能
- **マップエディタ** — Canvas ベースのインタラクティブマップ編集機能

---

## ゲームルール概要

```
マップ上のアイテムを集めて得点を競う 2人ターン制ゲーム

プレイヤーアクション:
  WALK(移動)  LOOK(観察)  SEARCH(探索)  PUT(ブロック設置)

勝敗条件:
  アイテム数 > 相手  →  スコア勝利
  相手を4方向から囲む  →  包囲勝利
  相手をブロックに衝突させる  →  アタック勝利
  通信切断  →  失格
```

---

## 動作環境

| 項目 | 要件 |
|---|---|
| OS | Windows 10/11 |
| Node.js | v20 以上 |
| pnpm | v8 以上 |
| Python | 3.8 以上（クライアントプログラム実行用） |

---

## クイックスタート

```bash
# 依存関係インストール
pnpm install

# 開発モード起動 (Electron + Vite + Backend が同時起動)
# → 対戦表示ウィンドウ と コントロールウィンドウ の2つが開く
pnpm --filter @u15/electron dev

# ビルド (全ワークスペース)
pnpm build
```

---

## ポート一覧

| ポート | 用途 |
|---|---|
| 5173 | Vite dev サーバー (開発時のみ) |
| 8765 | WebSocket + HTTP API |
| 12031 | COOL チーム TCP 接続 |
| 12032 | HOT チーム TCP 接続 |

---

## リポジトリ構成

```
U15-server-maizuru/
├── apps/
│   ├── backend/       Node.js ゲームサーバー
│   ├── frontend/      React UI (Vite)
│   └── electron/      Electron シェル (2ウィンドウ管理)
├── packages/
│   └── ws-types/      共有型定義 (@u15/ws-types)
├── server/            アップロードファイル保存先 (実行時生成)
│   ├── maps/          マップファイル (全ルーム共通)
│   └── rooms/<roomId>/
│       ├── programs/cool/  COOLチームプログラム
│       ├── programs/hot/   HOTチームプログラム
│       ├── libs/cool/      COOLカスタムライブラリ
│       └── libs/hot/       HOTカスタムライブラリ
├── docs/              マニュアル
│   ├── user-manual.md     ユーザーマニュアル
│   └── developer-manual.md デベロッパーマニュアル
└── test-screenshots/  E2E テストスクリーンショット
```

---

## 開発

```bash
# 単体テスト
pnpm --filter @u15/backend test
pnpm --filter @u15/frontend test

# E2E 全自動テスト
pnpm test:e2e

# 型チェック (全ワークスペース)
pnpm build

# 個別ビルド
pnpm --filter @u15/ws-types build
pnpm --filter @u15/backend build
pnpm --filter @u15/frontend build
```

---

## ライセンス

本リポジトリは U15プログラミングコンテスト舞鶴大会 の運営目的で作成されました。

ベース実装: [U15-maizuru/U15-server](https://github.com/U15-maizuru/U15-server) (Qt/C++)
