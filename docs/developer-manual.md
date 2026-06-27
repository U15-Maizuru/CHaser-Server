# U15 Server Maizuru — デベロッパーマニュアル

> 対象: 開発者・保守担当者

---

## 目次

1. [アーキテクチャ概要](#1-アーキテクチャ概要)
2. [ディレクトリ構成](#2-ディレクトリ構成)
3. [開発環境のセットアップ](#3-開発環境のセットアップ)
4. [各パッケージの役割](#4-各パッケージの役割)
5. [WebSocket / HTTP プロトコル](#5-websocket--http-プロトコル)
6. [TCP クライアントプロトコル](#6-tcp-クライアントプロトコル)
7. [ゲームロジック](#7-ゲームロジック)
8. [フロントエンド構成](#8-フロントエンド構成)
9. [ビルドとデプロイ](#9-ビルドとデプロイ)
10. [テスト](#10-テスト)
11. [拡張ガイド](#11-拡張ガイド)

---

## 1. アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────┐
│  Electron (apps/electron)                                   │
│  main.ts: バックエンド起動 + 2つの BrowserWindow 作成       │
│                                                             │
│  ┌──────────────────────┐   ┌──────────────────────────┐    │
│  │ 対戦表示ウィンドウ    │   │  コントロールウィンドウ   │    │
│  │ ?mode=display        │   │  ?mode=control           │    │
│  │ 1280×800             │   │  820×920                 │    │
│  │ DisplayMode.tsx      │   │  ControlApp (App.tsx)    │    │
│  │ 常時ゲームボード表示  │   │  セットアップ・操作 UI   │    │
│  └──────────────────────┘   └──────────────────────────┘    │
└──────┬──────────────────────────────────┬───────────────────┘
       │  child_process.spawn             │
┌──────▼──────────────────────────────────▼───────────────────┐
│  Backend (apps/backend)  — Node.js + TypeScript             │
│                                                             │
│  WsServer (port 8765) — WebSocket + HTTP 共存              │
│    ├── HttpServer — multipart ファイルアップロード          │
│    └── ServerManager — ゲーム状態管理                       │
│          ├── GameSession — ゲームループ実行 (turnDelayMs)   │
│          ├── TcpClient (port 12031/12032) — TCP接続        │
│          ├── ProcessClient — Python/Bot プロセス起動       │
│          ├── ManualClient — WS経由の手動入力               │
│          └── ComClient — 内蔵ダミーAI (SEARCH固定)         │
└───────────────────────────────────────────────────────────┘
  (両ウィンドウとも同一 WS サーバーに独立接続)
                │  TCP接続
┌───────────────▼──────────────────────────────────────────┐
│  外部クライアント (Python AI プログラム)                    │
│  python player.py --host 127.0.0.1 --port 12031           │
└────────────────────────────────────────────────────────────┘
```

### 2ウィンドウ構成の仕組み

- `Electron main.ts` が起動時に `?mode=display` と `?mode=control` の2ウィンドウを開く
- 両ウィンドウは独立して同じ WebSocket サーバー (`ws://localhost:8765`) に接続する
- バックエンドは接続クライアント数を意識しない。全 WS クライアントに同一メッセージをブロードキャストする
- コントロールウィンドウのみが `set_client`, `request_start` 等のコマンドを送信する（対戦表示ウィンドウは表示専用）
- コントロールウィンドウを閉じるとアプリ全体が終了する

---

## 2. ディレクトリ構成

```
U15-server-maizuru2/
├── apps/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── index.ts            エントリポイント
│   │   │   ├── clients/
│   │   │   │   ├── BaseClient.ts   クライアント抽象基底クラス
│   │   │   │   ├── ComClient.ts    CPU (SEARCH 固定)
│   │   │   │   ├── ManualClient.ts 手動操作クライアント
│   │   │   │   └── ProcessClient.ts Python/Bot プロセス起動
│   │   │   ├── game/
│   │   │   │   ├── types.ts        ゲーム内部型 (@u15/ws-types を再エクスポート)
│   │   │   │   ├── GameLogic.ts    純粋関数: applyMethod, judgeGame, calculatePoints
│   │   │   │   ├── GameSystem.ts   マップ生成・パース
│   │   │   │   ├── Game.ts         ゲームセッション (ターンループ + turnDelayMs)
│   │   │   │   └── ServerManager.ts ゲーム状態オーケストレーター
│   │   │   ├── log/
│   │   │   │   └── StableLog.ts    game.log への書き込み
│   │   │   └── network/
│   │   │       ├── TcpClient.ts    TCP リスナー + ライン受信
│   │   │       ├── WsServer.ts     WebSocket サーバー
│   │   │       ├── HttpServer.ts   multipart アップロード API
│   │   │       └── ws-types.ts     @u15/ws-types の再エクスポート
│   │   └── package.json            @u15/backend
│   │
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── App.tsx             モード分岐 + ControlApp (コントロール画面)
│   │   │   ├── components/
│   │   │   │   ├── DisplayMode.tsx     対戦表示専用コンポーネント (?mode=display)
│   │   │   │   ├── StartupDialog.tsx   セットアップ画面
│   │   │   │   ├── TeamSetupPanel.tsx  チーム設定パネル
│   │   │   │   ├── FileDropZone.tsx    ドラッグ&ドロップアップロード
│   │   │   │   ├── LibrarySection.tsx  カスタムライブラリ管理
│   │   │   │   ├── SetupFooter.tsx     マップ操作+スタートボタン
│   │   │   │   ├── MainWindow.tsx      対戦中メイン画面 (3カラム)
│   │   │   │   ├── GameBoardCanvas.tsx ゲームボード Canvas 描画
│   │   │   │   ├── PlayerSidePanel.tsx 左右プレイヤーパネル
│   │   │   │   ├── ManualControls.tsx  手動操作方向キーパッド
│   │   │   │   ├── SettingDialog.tsx   設定ダイアログ
│   │   │   │   └── MapEditorDialog.tsx マップエディタ
│   │   │   ├── hooks/
│   │   │   │   ├── useGameState.ts     WebSocket 状態管理・コマンド送信
│   │   │   │   ├── useSettings.ts      localStorage 設定永続化
│   │   │   │   ├── useSound.ts         SE 再生
│   │   │   │   └── useFileUpload.ts    HTTP アップロード (XHR + 進捗)
│   │   │   ├── styles/
│   │   │   │   └── tokens.ts           デザイントークン (色・フォント)
│   │   │   ├── types/
│   │   │   │   └── ws-types.ts         @u15/ws-types の再エクスポート
│   │   │   └── assets/
│   │   │       ├── Image/{Jewel,Light,Heavy,RPG}/ テクスチャ PNG
│   │   │       └── Sound/              SE mp3
│   │   └── package.json                @u15/frontend
│   │
│   └── electron/
│       ├── src/
│       │   ├── main.ts             Electron メインプロセス (2ウィンドウ管理)
│       │   └── preload.ts          コンテキストブリッジ (IPC)
│       ├── dev.js                  開発起動スクリプト
│       ├── test-e2e.mjs            E2E テストスクリプト
│       └── package.json            @u15/electron
│
├── packages/
│   └── ws-types/
│       └── src/index.ts            共有型定義 (唯一の正)
│
├── server/                         実行時自動生成
│   ├── programs/{cool,hot}/        アップロードされた AI プログラム
│   ├── libs/{cool,hot}/            カスタムライブラリ
│   └── maps/                       マップファイル
│
├── docs/
│   ├── user-manual.md
│   └── developer-manual.md
├── package.json                    ルートスクリプト
├── pnpm-workspace.yaml
└── test-screenshots/               E2E テスト出力
```

---

## 3. 開発環境のセットアップ

### 必要ツール

- Node.js v20+
- pnpm v8+
- Python 3.8+（クライアントプログラムのテスト用）

### セットアップ

```bash
# リポジトリをクローン
git clone https://github.com/U15-Maizuru/U15-server-maizuru2
cd U15-server-maizuru2

# 依存関係インストール (全ワークスペース)
pnpm install

# 共有型パッケージをビルド (必須 — 先にビルドしないと他がコンパイルエラー)
pnpm --filter @u15/ws-types build

# 開発モード起動 (対戦表示 + コントロールの2ウィンドウが開く)
pnpm --filter @u15/electron dev
```

### 環境変数

| 変数 | デフォルト | 説明 |
|---|---|---|
| `VITE_WS_URL` | `ws://localhost:8765` | フロントエンドのWS接続先 |
| `NODE_ENV` | `development` | `production` にすると本番ビルドを読む |

---

## 4. 各パッケージの役割

### `@u15/ws-types` (packages/ws-types)

**バックエンドとフロントエンドが共有する型定義の唯一の場所。**

```typescript
// 主要エクスポート
enum MapObject   // NOTHING=0, TARGET=1, BLOCK=2, ITEM=3
enum Winner      // COOL=0, HOT=1, DRAW=2, CONTINUE=3, NONE=4
enum Reason      // SCORE, TRAPPED, CONFINED, ATTACK, COLLISION, FOULED, NONE

interface RoundResult   // 試合1件の結果 (scores, points, winner, remainingTurns)
interface ServerStatusPayload  // doubleMode, currentRound, roundResults を含む
type FrontendMessage    // フロントエンド → バックエンド コマンド
type WsMessage          // バックエンド → フロントエンド ブロードキャスト
```

> **重要**: `apps/backend` や `apps/frontend` 内の `ws-types.ts` は薄い再エクスポートのみです。型の変更は必ず `packages/ws-types/src/index.ts` に行い、`pnpm --filter @u15/ws-types build` を実行してください。

### `@u15/backend` (apps/backend)

ゲームロジックと TCP/WebSocket サーバーの実装。

**ServerManager** — 中心的なオーケストレーター

```typescript
// 主要メソッド
setClientType(slot, type, processConfig?)  // クライアント設定
setDoubleMode(enabled)                      // 2試合制 ON/OFF
setTurnDelay(ms)                            // ターン表示待機時間 (0〜10000ms)
requestStart()                              // ゲーム開始
requestNextRound()                          // 2試合制: 次試合開始
requestReset()                              // リセット
deleteProgram(slot)                         // プログラム削除
loadMap(filePath)                           // マップ読み込み
```

**クライアント種別**

| クラス | 説明 |
|---|---|
| `TcpClient` | TCP ソケットからの接続を待ち受ける |
| `ProcessClient` | Python/Bot を子プロセスで起動し TCP で待ち受ける |
| `ManualClient` | WS `manual_action` イベントを受けてアクションを提供する。`need_input` イベントで入力要求を通知 |
| `ComClient` | 常に SEARCH を返すダミー AI |

**turnDelayMs (ターン表示待機時間)**

```typescript
// Game.ts のターンループ
this.emit('stateUpdate', state);       // ボード状態をブロードキャスト
if (turnDelayMs > 0) await sleep(ms); // ← ここで待機 (フロントが描画する時間)
// 次のプレイヤーの GetReady へ
```

デフォルト: `1000` ms (1秒)。`setTurnDelay(0)` で即時進行になる。

### `@u15/frontend` (apps/frontend)

React + Vite の UI 実装。`?mode=` クエリパラメータで動作を切り替える。

**モード分岐 (App.tsx)**

```typescript
const MODE = new URLSearchParams(window.location.search).get('mode') ?? 'control';

export default function App() {
  if (MODE === 'display') return <DisplayMode />;  // 対戦表示専用
  return <ControlApp />;                           // 従来のセットアップ+操作 UI
}
```

**DisplayMode** — 対戦表示専用コンポーネント
- `setup` フェーズ: チーム接続状態を表示する待機画面
- `playing`/`finished` フェーズ: `MainWindow` を read-only で表示（操作ボタンは no-op）
- SE は DisplayMode でも再生される

**ControlApp** — コントロールウィンドウ用
- 従来の `App` 相当の動作 (StartupDialog / MainWindow 切り替え)
- WS 接続時に `setTurnDelay` を送信（接続前は送信されないため `isConnected` を依存に含める）

### `@u15/electron` (apps/electron)

2ウィンドウを管理するメインプロセス。

```typescript
// main.ts の骨格
startBackend(__dirname);        // バックエンドを子プロセスで起動

createDisplayWindow();          // ?mode=display (1280×800)
createControlWindow();          // ?mode=control (820×920)
                                // コントロールウィンドウを閉じると app.quit()
```

---

## 5. WebSocket / HTTP プロトコル

### WebSocket (port 8765)

**フロントエンド → バックエンド (FrontendMessage)**

| メッセージ | ペイロード | 説明 |
|---|---|---|
| `set_client` | `{slot, clientType, processConfig?}` | クライアント種別設定 |
| `delete_program` | `{slot}` | プログラム削除・スロット初期化 |
| `request_start` | — | ゲーム開始 |
| `request_reset` | — | セットアップに戻る |
| `request_next_round` | — | 2試合制: 次試合開始 |
| `set_double_mode` | `{enabled}` | 2試合制 ON/OFF |
| `set_turn_delay` | `{ms}` | ターン表示待機時間 (ミリ秒, 0〜10000) |
| `manual_action` | `{slot, action, rote}` | 手動操作アクション |
| `load_map` | `{filePath}` | マップファイル読み込み |
| `set_map_params` | `{itemNum, blockNum, turnNum, mirror}` | ランダムマップパラメータ |
| `load_map_data` | `{field, size, turn, teamFirstPoint}` | マップデータ直接送信 |

**バックエンド → フロントエンド (WsMessage)**

| メッセージ | ペイロード | 説明 |
|---|---|---|
| `server_status` | `ServerStatusPayload` | フェーズ・クライアント状態・2試合制情報 |
| `game_state` | `GameStateSnapshot` | ボード全体の状態 |
| `turn_start` | `{turn, player}` | ターン開始通知 |
| `score_update` | `{teamScore, leaveItems}` | スコア更新 |
| `game_end` | `{winner, reason, finalScore, playerNames}` | ゲーム終了 |
| `manual_request` | `{slot, aroundData}` | 手動操作: アクション入力待ち |

### HTTP API (port 8765 / WS と共存)

| エンドポイント | メソッド | 説明 |
|---|---|---|
| `/api/upload/program?slot=0\|1` | POST | AI プログラム (.py/.exe) アップロード |
| `/api/upload/library?slot=0\|1` | POST | カスタムライブラリ (.py) アップロード |
| `/api/upload/map` | POST | マップファイル (.map) アップロード |
| `/api/libs?slot=0\|1` | GET | アップロード済みライブラリ一覧 |
| `/api/libs/:filename?slot=0\|1` | DELETE | ライブラリ削除 |

ファイルサイズ制限: プログラム/ライブラリ 512KB、マップ 1MB。CORS ヘッダー付き。

---

## 6. TCP クライアントプロトコル

Python AI プログラムはサーバーに TCP 接続して以下のプロトコルでゲームを行います。

### 接続

```
Client → Server: "[チーム名]\r\n"  (接続後最初の送信)
```

### ターンプロトコル (1ターン = 3フェーズ)

**フェーズ 1: GetReady**
```
Server → "@ \r\n"
Client → "gr\r\n"
```

**フェーズ 2: Method (アクション送信)**
```
Server → "[ConnectStatus][9マスのMapObject値]\r\n"
          例: "1012012012\r\n"
          ↑ConnectStatus(1桁) + 周囲3×3の状態(9桁)

Client → "[action][rote]\r\n"
          例: "wr\r\n"  (WALK RIGHT)
```

**フェーズ 3: EndSharp**
```
Server → "[更新後のAroundData]\r\n"
Client → "#\r\n"
```

> **ターン間の待機**: バックエンドは `stateUpdate` ブロードキャスト後に `turnDelayMs` ミリ秒待機してから次の GetReady を送信します。デフォルトは 1000ms。

### アクション文字一覧

| 文字 | アクション |
|---|---|
| `w` | WALK (移動) |
| `l` | LOOK (観察) |
| `s` | SEARCH (探索) |
| `p` | PUT (ブロック設置) |

### 方向文字一覧

| 文字 | 方向 |
|---|---|
| `u` | UP (y-1) |
| `d` | DOWN (y+1) |
| `r` | RIGHT (x+1) |
| `l` | LEFT (x-1) |

### AroundData レイアウト (3×3グリッド, インデックス 0〜8)

```
0 1 2
3 4 5    ← 4 = 自分自身の位置
6 7 8
```

MapObject 値: `0`=空 `1`=未使用 `2`=ブロック `3`=アイテム

### Python プログラム起動引数

```bash
python player.py --host 127.0.0.1 --port 12031
```

---

## 7. ゲームロジック

### ターン表示待機 (turnDelayMs)

```typescript
// Game.ts
async run(clients, map, log?, turnDelayMs = 0): Promise<GameResult> {
  // ...
  this.emit('stateUpdate', state);       // ボード状態をブロードキャスト
  if (turnDelayMs > 0) await sleep(ms); // 視覚的確認のための待機
  // 次フェーズへ
}
```

設定 → `ServerManager.setTurnDelay(ms)` → `session.run(..., ms)` に渡す。ゲーム開始時に適用（実行中の変更は次のゲームから）。

### ポイント計算 (`calculatePoints` in GameLogic.ts)

```typescript
function calculatePoints(
  score:          number,  // アイテム取得数
  remainingTurns: number,  // 終了時の残りターン数
  isWinner:       boolean, // この試合の勝者か
  allItemsTaken:  boolean, // 全アイテム取得したか
): number {
  return score * 10 + (isWinner ? remainingTurns : 0) + (isWinner && allItemsTaken ? 100 : 0);
}
```

### 勝ち点システム (2試合制)

- 1勝 = 3点 (`KACHI_PER_WIN = 3`)
- TOTAL 勝ち点 = 双方の勝ち点の合計
- TOTAL スコア = COOL スコア + HOT スコア

### 判定優先順位 (`judgeGame` in GameLogic.ts)

1. ブロック下敷き (COLLISION / ATTACK)
2. 4方向囲まれ (CONFINED / TRAPPED)
3. 切断 (FOULED)
4. ターン0 or 両者同時敗北 → スコア比較 (SCORE / DRAW)

### マップ形式 (.map ファイル)

```
N: [マップ名]
T: [最大ターン数]
S: [幅],[高さ]
D: [MapObject値のカンマ区切り, 行ごとに1行]
C: [COOLスタートX],[COOLスタートY]
H: [HOTスタートX],[HOTスタートY]
```

---

## 8. フロントエンド構成

### コンポーネントツリー

```
App.tsx
├── DisplayMode.tsx          (?mode=display — 対戦表示専用)
│   ├── SetupWaiting         (setup フェーズの待機画面)
│   └── MainWindow.tsx       (playing/finished フェーズ, 操作 no-op)
│
└── ControlApp               (?mode=control — コントロール)
    ├── SettingDialog.tsx    (overlay modal)
    ├── MapEditorDialog.tsx  (overlay modal)
    ├── StartupDialog.tsx    (phase === 'setup')
    │   ├── TeamSetupPanel.tsx  × 2 (COOL/HOT)
    │   │   ├── FileDropZone.tsx
    │   │   └── LibrarySection.tsx
    │   └── SetupFooter.tsx
    └── MainWindow.tsx       (phase !== 'setup')
        ├── PlayerSidePanel.tsx × 2 (side=0: COOL, side=1: HOT)
        ├── GameBoardCanvas.tsx
        └── ManualControls.tsx  (manual スロットある時のみ)
```

### 主要フック

| フック | 役割 |
|---|---|
| `useGameState(wsUrl)` | WS 接続・メッセージ受信・コマンド送信 |
| `useSettings()` | localStorage への AppSettings 永続化 |
| `useSound()` | HTMLAudioElement による SE 再生 |
| `useScoreSound(snapshot, muted, play)` | スコア変化時の SE トリガー |
| `useFileUpload()` | XHR multipart アップロード + 進捗管理 |

### AppSettings (localStorage キー: `u15_settings`)

```typescript
interface AppSettings {
  timeout:    number;   // TCP タイムアウト秒 (デフォルト: 5)
  turnDelay:  number;   // ターン表示待機時間 ms (デフォルト: 1000)
  muted:      boolean;  // SE ミュート
  doubleMode: boolean;  // 2試合制
  theme:      string;   // テクスチャテーマ ('Jewel' | 'Light' | 'Heavy' | 'RPG')
  itemNum:    number;   // ランダムマップアイテム数
  blockNum:   number;   // ランダムマップブロック数
  turnNum:    number;   // ランダムマップターン数
  mirror:     boolean;  // 対称マップ生成
}
```

> **WS タイミング注意**: `turnDelay` 等の設定は WS 接続後に送信します。接続前に `useEffect` が発火しても `send()` は無視されます。`isConnected` を依存に含めることで接続時に再送します。

### PlayerSidePanel の表示データ

- `side=0` (左パネル, COOL視点): COOL→HOT→TOTAL の順、列 = 勝ち点|スコア|B/P|アイテム
- `side=1` (右パネル, HOT視点): HOT→COOL→TOTAL の順、列 = アイテム|B/P|スコア|勝ち点 (反転)
- データは `roundResults.points` の累積 + 現在ゲームの `teamScore × 10`

---

## 9. ビルドとデプロイ

### 開発モード

```bash
pnpm --filter @u15/electron dev
# → backend を tsx で起動
# → Vite dev サーバー (port 5173) を起動
# → Electron が 2ウィンドウを開く (localhost:5173/?mode=display と ?mode=control)
```

### プロダクションビルド

```bash
# 全ワークスペースをビルド (ws-types → backend, frontend → electron の順)
pnpm build

# Windows インストーラー作成
pnpm --filter @u15/electron build:win
# → apps/electron/release/ に NSIS インストーラーが生成される
```

### ビルド依存順序

```
@u15/ws-types  →  @u15/backend
                →  @u15/frontend
                     →  @u15/electron
```

pnpm は `package.json` の `dependencies` から順序を自動解決します。

---

## 10. テスト

### 単体テスト (Vitest)

```bash
pnpm --filter @u15/backend test
```

`apps/backend/src/game/GameLogic.test.ts`, `GameSystem.test.ts`, `TcpClient.test.ts`, `WsServer.test.ts` 等。

### E2E テスト (Playwright)

```bash
# 2ウィンドウ Electron アプリを自動起動してシナリオを実行
pnpm test:e2e
# または
node apps/electron/test-e2e.mjs
```

**テスト前処理**: テスト開始時に `localStorage.turnDelay = 0` を設定してゲームを高速化します（デフォルト 1000ms のままではタイムアウトするため）。

**テスト対象ウィンドウ**: `?mode=control` のコントロールウィンドウで操作します（`?mode=display` は読み取り専用なので操作テストの対象外）。

**テストシナリオ (37項目)**

| スイート | 内容 |
|---|---|
| セットアップUI | 2カラム表示・モードボタン・FileDropZone・IP |
| 設定ダイアログ | タブ・2試合制トグル・各設定項目 |
| FileDropZone | ドロップエリア・拡張子・pychaser表示 |
| CPU vs CPU | ゲーム開始→終了→リセット・勝敗表示 |
| 2試合制 | 試合1→次戦スタート→第2試合→合計ポイント |
| 手動操作 | ManualControls表示・アクション送信・終了 |

---

## 11. 拡張ガイド

### 新しいクライアント種別の追加

1. `packages/ws-types/src/index.ts` の `ClientType` に追加
2. `apps/backend/src/clients/` に新クラスを作成 (`BaseClient` を継承)
3. `ServerManager.ts` の `setClientType` と `startListening` で処理追加
4. `apps/frontend/src/components/TeamSetupPanel.tsx` の `TYPE_LABELS` に追加

### 新しい WebSocket メッセージの追加

1. `packages/ws-types/src/index.ts` の `FrontendMessage` / `WsMessage` に追加
2. ビルド: `pnpm --filter @u15/ws-types build`
3. `apps/backend/src/network/WsServer.ts` の `onMessage` switch に追加
4. `apps/backend/src/index.ts` でイベントハンドラーを接続
5. `apps/frontend/src/hooks/useGameState.ts` に送信関数を追加

### 型変更の手順

```bash
# 1. packages/ws-types/src/index.ts を編集
# 2. 共有パッケージをリビルド
pnpm --filter @u15/ws-types build
# 3. 両ワークスペースをビルドしてエラーを確認
pnpm --filter @u15/backend build
pnpm --filter @u15/frontend build
```

### DisplayMode のカスタマイズ

`apps/frontend/src/components/DisplayMode.tsx` の `SetupWaiting` コンポーネントを編集することで、セットアップ中の待機画面をカスタマイズできます（大会名、ロゴ、背景色など）。

### ゲームロジックの変更

- `GameLogic.ts`: 純粋関数のみ。状態のコピーを返し副作用なし
- `GameSystem.ts`: マップ生成・パース
- `Game.ts`: ターンループ（`GameLogic` を呼ぶだけ）+ `turnDelayMs` 待機
- `ServerManager.ts`: 状態を保持する唯一のクラス

### ポイント計算の変更

`apps/backend/src/game/GameLogic.ts` の `calculatePoints` 関数を変更します。変更後は必ず `apps/backend/src/game/GameLogic.test.ts` でテストを追加してください。
