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
10. [マルチルーム / Web サービスモード](#10-マルチルーム--web-サービスモード)
11. [テスト](#11-テスト)
12. [拡張ガイド](#12-拡張ガイド)

---

## 1. アーキテクチャ概要

### ローカルモード (U15_MODE=local)

```
┌─────────────────────────────────────────────────────────────┐
│  Electron (apps/electron)                                   │
│  main.ts: バックエンド起動(local) → /api/default-room で    │
│           roomId 取得 → 2つの BrowserWindow を開く         │
│                                                             │
│  ┌──────────────────────┐   ┌──────────────────────────┐    │
│  │ 対戦表示ウィンドウ    │   │  コントロールウィンドウ   │    │
│  │ ?room=local&mode=    │   │  ?room=local&mode=       │    │
│  │   display           │   │    control               │    │
│  └──────────────────────┘   └──────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 手動操作ウィンドウ (COOL/HOT 独立、必要時のみ)          │    │
│  │ ?room=local&mode=manual&slot=0|1                       │    │
│  └──────────────────────────────────────────────────────┘    │
└──────┬──────────────────────────────────┬───────────────────┘
       │  child_process.spawn             │
┌──────▼──────────────────────────────────▼───────────────────┐
│  Backend (apps/backend) — Node.js + TypeScript              │
│                                                             │
│  WsServer (port 8765)                                       │
│    ├── HttpServer — ファイルアップロード / default-room      │
│    └── RoomManager — 部屋管理                               │
│          └── Room "local" (ports 12031/12032)               │
│                └── ServerManager                            │
│                      ├── TcpClient (port 12031)             │
│                      └── TcpClient (port 12032)             │
└─────────────────────────────────────────────────────────────┘
```

手動操作ウィンドウは、コントロールウィンドウがいずれかのスロットを `clientType='manual'` に
設定すると `manual:openWindow` IPC 経由で自動的に開く (`apps/electron/src/main.ts` の
`createManualWindow`)。COOL/HOT それぞれ独立したウィンドウで、`ManualControls.tsx` の
矢印キー操作またはボタンで `manual_action` メッセージを送信する。

### Web サービスモード (U15_MODE=web)

```
ブラウザ (ロビー)
  → GET http://server:8765/         → Lobby.tsx 表示
  → WS  create_room                 → RoomManager が部屋生成
  → WS  join_room {roomId}          → 部屋に入室

RoomManager
  │  createRoom() → ServerManager(ports=[13042, 13043])
  │  createRoom() → ServerManager(ports=[13044, 13045])
  │  ...最大500並列 (ポートプール 13000-14999)
  └── 30分非アクティブで自動削除

各 ServerManager
  ├── TcpClient (動的ポート)
  └── TcpClient (動的ポート)

Python AI:  python player.py --host server --port 13042
```

---

## 2. ディレクトリ構成

```
U15-server-maizuru/
├── apps/
│   ├── backend/
│   │   └── src/
│   │       ├── index.ts            エントリポイント (U15_MODE 分岐)
│   │       ├── RoomManager.ts      部屋ライフサイクル管理
│   │       ├── programCatalog.ts   対戦用プログラムライブラリ (CRUD カタログ、全ルーム共通)
│   │       ├── mapCatalog.ts       マップライブラリ (CRUD カタログ、全ルーム共通)
│   │       ├── clients/
│   │       │   ├── BaseClient.ts
│   │       │   ├── ComClient.ts
│   │       │   ├── ManualClient.ts
│   │       │   └── ProcessClient.ts
│   │       ├── game/
│   │       │   ├── types.ts
│   │       │   ├── GameLogic.ts
│   │       │   ├── GameSystem.ts
│   │       │   ├── Game.ts
│   │       │   ├── ServerManager.ts    1ゲームを管理するコーディネーター (コンストラクタでポート番号ペアを受け取る)
│   │       │   ├── SlotManager.ts      クライアント接続・スロット管理
│   │       │   ├── MapManager.ts       マップ状態管理
│   │       │   └── RoundController.ts  フェーズ・ラウンド制御
│   │       ├── log/
│   │       │   └── StableLog.ts
│   │       └── network/
│   │           ├── PortPool.ts             TCP ポートプール
│   │           ├── TcpClient.ts
│   │           ├── WsServer.ts             WebSocket サーバー。setRoomManager でルームマネージャを注入し、ソケット⇔ルームの紐付けを管理する薄いコーディネーター
│   │           ├── LobbyRouter.ts          ロビー系メッセージ (create/join/list/destroy_room) を処理
│   │           ├── GameMessageDispatch.ts  ルーム内ゲームメッセージを対応する ServerManager へディスパッチ
│   │           └── HttpServer.ts           静的配信 + room別パスでのファイルアップロード + /api/default-room
│   │
│   ├── frontend/
│   │   └── src/
│   │       ├── App.tsx             ?room=/?mode= に応じて Lobby/DisplayMode/ControlApp/ManualMode に分岐
│   │       ├── components/
│   │       │   ├── Lobby.tsx           ロビー画面 (Web モード)
│   │       │   ├── DisplayMode.tsx     対戦表示 (wsUrl/roomId を props で受け取る)
│   │       │   ├── StartupDialog.tsx
│   │       │   ├── MapManagementDialog.tsx  マップ設定 (ライブラリ選択・アップロード・ランダム生成・エディタ起動) の統合モーダル
│   │       │   ├── MapEditorDialog.tsx      Canvas ベースのマップ編集 (現在のマップを起点に編集し、適用/ライブラリ保存/ダウンロードを分離)
│   │       │   ├── MapThumbnail.tsx         マップの縮小プレビュー (現在マップ要約カードで使用)
│   │       │   ├── MainWindow.tsx      盤面・スコア・進行状況の表示 (対戦表示/コントロール共用)
│   │       │   ├── ManualMode.tsx      手動操作ウィンドウのルート
│   │       │   ├── ManualControls.tsx  手動操作の入力パネル (矢印キー/ボタン)
│   │       │   ├── ErrorBoundary.tsx   描画エラーを捕捉して各ウィンドウの落ちを防ぐ
│   │       │   └── ...
│   │       ├── hooks/
│   │       │   ├── useGameState.ts     WS 接続・roomId 引数・join_room 送信・ゲーム状態管理
│   │       │   ├── useLobby.ts         ロビー用 WS フック
│   │       │   ├── useGamePhaseSound.ts  ControlApp/DisplayMode 共用のフェーズ遷移 SE
│   │       │   ├── useTextures.ts        GameBoardCanvas/MapEditorDialog/MapThumbnail 共用のテクスチャ読込
│   │       │   ├── useBgm.ts             フェーズに応じた BGM 再生
│   │       │   ├── useStartCountdown.ts  試合開始カウントダウンの表示制御
│   │       │   └── ...
│   │       ├── lib/
│   │       │   ├── roundSide.ts        2試合制のラウンド番号から画面左右の team-index を算出
│   │       │   ├── setResult.ts        画面側 (side) ごとの合計ポイントとセット全体の勝者を算出
│   │       │   │                        (フッターの勝者宣言とサイドパネルの TOTAL 欄で共有)
│   │       │   └── ...
│   │       └── ...
│   │
│   └── electron/
│       └── src/
│           └── main.ts   バックエンド起動 → /api/default-room から roomId を取得 → 対戦表示/コントロール
│                          ウィンドウを開く。手動操作ウィンドウは manual:openWindow IPC で必要時に開く
│
├── packages/
│   └── ws-types/
│       └── src/index.ts    バックエンド・フロントエンド共有のプロトコル型・メッセージ型を定義
│
├── server/
│   ├── program-catalog/            プログラムライブラリ (CRUD カタログ、全ルーム共通)
│   ├── map-catalog/                マップライブラリ (CRUD カタログ、全ルーム共通)
│   └── rooms/<roomId>/
│       ├── programs/cool/          COOL チームのアップロードプログラム
│       ├── programs/hot/
│       ├── libs/cool/
│       └── libs/hot/
│
└── docs/
```

---

## 3. 開発環境のセットアップ

### 必要ツール

- Node.js v20+
- pnpm v8+
- Python 3.8+（クライアントプログラムのテスト用）

### セットアップ

```bash
# 依存関係インストール
pnpm install

# 共有型パッケージをビルド (必須)
pnpm --filter @u15/ws-types build

# 開発モード起動 (ローカルモード)
pnpm --filter @u15/electron dev
```

> **トラブルシューティング**: `pnpm install` で `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: electron, esbuild...` という警告が出た場合、`electron` の実行バイナリ (`electron.exe`) がダウンロードされておらず `pnpm --filter @u15/electron dev` や E2E テストが動きません。`pnpm-workspace.yaml` の `allowBuilds` で `electron`/`esbuild` を許可済みですが、初回や pnpm のバージョンアップ後に再度出た場合は `pnpm approve-builds --all` を実行してください。

### 環境変数

| 変数 | デフォルト | 説明 |
|---|---|---|
| `U15_MODE` | `local` | `local` = Electron向け1ルーム自動生成 / `web` = マルチルームサービス |
| `PORT` | `8765` | バックエンド HTTP/WS サーバーのポート |
| `NODE_ENV` | `development` | `production` にすると frontend/dist を静的配信 |
| `VITE_WS_URL` | `ws://hostname:8765` | フロントエンドの WS 接続先 (自動検出) |

---

## 4. 各パッケージの役割

### `@u15/ws-types` (packages/ws-types)

**バックエンドとフロントエンドが共有する型定義の唯一の場所。**

```typescript
// ゲームの状態・結果を表す型
enum MapObject, Winner, Reason
interface GameStateSnapshot, TurnStartPayload, ScoreData, GameEndPayload
interface RoundResult, ServerStatusPayload, ClientStatusPayload
type ServerPhase, ClientType, ClientState

// プログラム/マップの各ライブラリ (カタログ) を表す型
interface CatalogEntry { id, displayName, programPath, programType, runtimeCommand, uploadedAt, demoEnabled }
interface MapCatalogEntry { id, displayName, mapPath, uploadedAt, size, turn, blockCount, itemCount }
interface MapParams { itemNum, blockNum, turnNum, mirror, size? }
interface InlineMapData { field, size, turn, teamFirstPoint }

// ルーム / ロビーを表す型
interface RoomSummary { id, phase, ports, createdAt }
type LobbyMessage =
  | { type: 'room_created'; payload: { roomId, ports } }
  | { type: 'room_joined';  payload: { roomId, ports } }
  | { type: 'room_list';    payload: { rooms: RoomSummary[] } }
  | { type: 'error';        payload: { message } }

// フロントエンド → バックエンド (ゲーム操作 + ロビー操作)
type FrontendMessage =
  | { type: 'set_client'; payload: { slot, clientType, processConfig? } }
  | { type: 'delete_program'; payload: { slot } }
  | { type: 'request_start' } | { type: 'request_reset' }
  | { type: 'load_map'; payload: { filePath } }
  | { type: 'set_map_params'; payload: MapParams }
  | { type: 'load_map_data'; payload: InlineMapData }
  | { type: 'set_double_mode' | 'set_repeat_mode' | 'set_demo_mode' | 'set_dark_mode'; payload: { enabled } }
  | { type: 'set_turn_delay' | 'set_tcp_timeout'; payload: { ms } }
  | { type: 'set_log_dir'; payload: { dir } }
  | { type: 'set_python_command'; payload: { command } }
  | { type: 'request_next_round' } | { type: 'request_repeat' }
  | { type: 'manual_action'; payload: { slot, action, rote } }
  | { type: 'create_room' }
  | { type: 'join_room'; payload: { roomId } }
  | { type: 'list_rooms' }
  | { type: 'destroy_room' }
```

### `@u15/backend` (apps/backend)

**PortPool** — TCP ポートプール

```typescript
class PortPool {
  alloc(): number | null   // プールから1ポートを確保 (なければ null)
  release(port: number): void
  get size(): number
}
```

**RoomManager** — 部屋のライフサイクル管理

```typescript
class RoomManager {
  constructor(webPortRange?: [number, number])  // 未指定 = ローカルモード
  createRoom(id?: string, fixedPorts?: [number, number]): Room | null
  getRoom(id: string): Room | undefined
  listRooms(): RoomSummary[]
  destroyRoom(id: string): void
  touchRoom(id: string): void  // 最終アクティブ時刻を更新
  shutdown(): void             // 全部屋を閉じてタイマーを停止

  // WsServer が設定するコールバック
  onRoomStatus?:    (roomId, payload) => void
  onRoomSession?:   (roomId, session, names) => void
  onManualClient?:  (roomId, mc) => void
  onRoomDestroyed?: (roomId) => void
}
```

**ServerManager** — 1つのゲームを管理するコーディネーター

内部状態は3つのクラスに分割されており、ServerManager 自体はそれらを束ねて `setClientType` / `requestStart` / `requestReset` などの薄い外部向け API を提供する。

| クラス | 責務 |
|---|---|
| `SlotManager` | スロットごとのクライアント接続 (Process/Tcp/Manual/Com) のライフサイクル管理。`setClientType` / `deleteProgram` / `startListening` など |
| `MapManager` | マップ状態の保持・生成・読込 (`loadMap` / `setMapParams` / `loadMapData` / `getCurrentMapData`) |
| `RoundController` | フェーズ (`setup`/`playing`/`finished`)・2試合制のラウンド進行・デモ/リピートモード・ターン表示待機時間 |

```typescript
// ポートはコンストラクタで指定する (省略時は [12031, 12032])
constructor(ports: [number, number] = [12031, 12032])

// 部屋削除時の安全なクリーンアップ (TCP を閉じるだけ、再起動しない)
shutdown(): void
```

デモモード (`setDemoMode`) は、全スロットが ready になった時点で自動的に `requestStart` を、
2試合制の1試合目終了時に自動的に `requestNextRound` を、リピートモード併用時は最終戦終了時に
自動的に `requestRepeat` を発行する (`DemoDelaysMs` で各ステップの待機時間を調整可能)。
ログ保存先 (`setLogDir`) と Python 実行コマンド (`setPythonCommand`) の上書きは、
`U15_MODE=local` のときのみ有効になる。Web モードではリモートのクライアントがサーバー上の
任意パスへの書き込みや任意コマンドの実行経路に触れないよう、常に無視される。

**WsServer** — ルーム対応の WebSocket サーバー

ソケット⇔ルームの紐付け (`socketToRoom` / `roomSockets`) とブロードキャストを WsServer 自身が保持し、実際のメッセージ処理は2つのクラスに委譲する薄いコーディネーター。

```typescript
class WsServer {
  constructor(port: number)
  setRoomManager(rm: RoomManager): void   // 起動後に呼ぶ (LobbyRouter/GameMessageDispatch もここで生成)
  broadcastToRoom(roomId, msg: WsMessage): void
  broadcastAll(msg: WsMessage | LobbyMessage): void
  attachRoom(roomId, session, playerNames): void  // セッション開始時
  close(): Promise<void>
}
```

| クラス | 責務 |
|---|---|
| `LobbyRouter` | `create_room` / `join_room` / `list_rooms` / `destroy_room` を処理。該当しなければ `false` を返す |
| `GameMessageDispatch` | ルーム内専用メッセージ (`set_client` / `request_start` / `manual_action` など) を対応する `ServerManager` に dispatch |

接続時の動作:
- 全クライアントに `room_list` を即送信
- `join_room` 受信 → ソケットをルームに紐付け → キャッシュ済みの `server_status` を送信 → `room_joined` を送信
- ゲームメッセージ → `socketToRoom` でルームを特定 → `GameMessageDispatch` がそのルームの `ServerManager` に dispatch

### `@u15/frontend` (apps/frontend)

**モード分岐 (App.tsx)**

```typescript
const ROOM_ID = new URLSearchParams(window.location.search).get('room');
const MODE    = new URLSearchParams(window.location.search).get('mode') ?? 'display';

export default function App() {
  if (!ROOM_ID) return <Lobby wsUrl={WS_URL} />;           // ロビー (Web モード)
  if (MODE === 'display') return <DisplayMode wsUrl={WS_URL} roomId={ROOM_ID} />;
  return <ControlApp roomId={ROOM_ID} />;
}
```

**Lobby** — ロビー画面 (Web モード専用)

- WS 接続時に `list_rooms` を送信し `room_list` を表示
- 「新しいルームを作成」→ `create_room` → `room_created` → `?room=xxx&mode=control` へリダイレクト
- 「観戦」→ `?room=xxx&mode=display` へリダイレクト

**useGameState(wsUrl, roomId)**

```typescript
// 接続後に join_room を自動送信
ws.onopen = () => {
  setIsConnected(true);
  ws.send(JSON.stringify({ type: 'join_room', payload: { roomId } }));
};
```

---

## 5. WebSocket / HTTP プロトコル

### WebSocket (port 8765)

**フロントエンド → バックエンド (FrontendMessage)**

| メッセージ | ペイロード | 説明 |
|---|---|---|
| `create_room` | — | 新しいルームを作成 (Web モード) |
| `join_room` | `{roomId}` | ルームに参加 (全モード必須) |
| `list_rooms` | — | ルーム一覧を要求 |
| `destroy_room` | — | 参加中のルームを削除 |
| `set_client` | `{slot, clientType, processConfig?}` | クライアント種別設定 |
| `delete_program` | `{slot}` | プログラム削除 |
| `request_start` | — | ゲーム開始 |
| `request_reset` | — | リセット |
| `request_next_round` | — | 次試合開始 |
| `set_double_mode` | `{enabled}` | 2試合制 ON/OFF |
| `set_repeat_mode` | `{enabled}` | リピートモード ON/OFF (setup フェーズのみ変更可) |
| `set_demo_mode` | `{enabled}` | デモモード (無人自動進行) ON/OFF (setup フェーズのみ変更可) |
| `set_dark_mode` | `{enabled}` | 対戦表示のダークモード ON/OFF |
| `set_turn_delay` | `{ms}` | ターン表示待機時間 |
| `set_tcp_timeout` | `{ms}` | TCP クライアントの応答タイムアウト |
| `set_log_dir` | `{dir}` | ログ保存先 (ローカルモードのみ有効) |
| `set_python_command` | `{command}` | Python 実行コマンドの上書き (ローカルモードのみ有効) |
| `request_next_round` | — | 2試合制: 次ラウンドの準備 (先後を入れ替えて再接続待ちにする) |
| `request_repeat` | — | 最終戦終了後、接続 (type) を維持したまま先後を入れ替えて再戦準備する |
| `manual_action` | `{slot, action, rote}` | 手動操作 |
| `load_map` | `{filePath}` | マップ読み込み |
| `set_map_params` | `{...}` | ランダムマップパラメータ |
| `load_map_data` | `{...}` | マップデータ直接送信 |

> **重要**: ゲームメッセージはルームに `join_room` してから有効になります。未入室のソケットからのメッセージは無視されます。

**バックエンド → フロントエンド**

ロビー向け (LobbyMessage):

| メッセージ | ペイロード | 説明 |
|---|---|---|
| `room_list` | `{rooms: RoomSummary[]}` | 接続時と変更時に全クライアントへブロードキャスト |
| `room_created` | `{roomId, ports}` | create_room 発行者に返す |
| `room_joined` | `{roomId, ports}` | join_room 発行者に返す |
| `error` | `{message}` | エラー通知 |

ゲーム向け (WsMessage、ルーム内のソケットのみ):

| メッセージ | ペイロード | 説明 |
|---|---|---|
| `server_status` | `ServerStatusPayload` | フェーズ・クライアント状態 |
| `game_state` | `GameStateSnapshot` | ボード全体の状態 |
| `turn_start` | `{turn, player}` | ターン開始通知 |
| `score_update` | `{teamScore, leaveItems}` | スコア更新 |
| `game_end` | `{winner, reason, finalScore, playerNames}` | ゲーム終了 |
| `manual_request` | `{slot, aroundData}` | 手動操作入力待ち |

### HTTP API (port 8765)

| エンドポイント | メソッド | 説明 |
|---|---|---|
| `/api/default-room` | GET | ローカルモード用: `{roomId: "local", ports: [12031, 12032]}` を返す |
| `/api/upload/program?slot=0\|1&room=<id>` | POST | AI プログラム (.py/.exe) アップロード |
| `/api/upload/library?slot=0\|1&room=<id>` | POST | カスタムライブラリ (.py) アップロード |
| `/api/libs?slot=0\|1&room=<id>` | GET | アップロード済みライブラリ一覧 |
| `/api/libs/:filename?slot=0\|1&room=<id>` | DELETE | ライブラリ削除 |
| `/api/maps` | POST | マップライブラリへの新規アップロード (.map) — 全ルーム共通、`mapCatalog.ts` |
| `/api/maps` | GET | マップライブラリの一覧 (`MapCatalogEntry[]`) |
| `/api/maps/:id` | DELETE | マップライブラリからの削除 |
| `/api/maps/:id/download` | GET | ライブラリ内マップのダウンロード (Content-Disposition 付き) |
| `/api/maps/current?room=<id>` | GET | 指定ルームの現在のマップ (`InlineMapData`)。エディタ起点・現在マップ表示に使用 |
| `/api/maps/random` | POST | ステートレスなランダムマップ生成 (`MapParams` → `InlineMapData`)。`GameSystem.createRandomMap` を直接呼ぶだけでどの部屋にも影響しない |
| `/api/maps/save-inline` | POST | エディタで組んだマップ (`InlineMapData`) をライブラリへ保存 |
| `/api/maps/export` | POST | エディタの内容をライブラリに残さずそのままダウンロード |

アップロードされたファイルは `server/rooms/<roomId>/programs/cool/` 等にルーム別に保存されます。プログラム・マップの各ライブラリは `server/program-catalog/` / `server/map-catalog/` にルームを跨いで共通保存されます。

---

## 6. TCP クライアントプロトコル

Python AI プログラムはサーバーに TCP 接続して以下のプロトコルでゲームを行います。**ローカルモードでも Web サービスモードでも同一プロトコルです。** 異なるのは接続先ポート番号のみです。

### 接続

```
Client → Server: "[チーム名]\r\n"
```

### ターンプロトコル (1ターン = 3フェーズ)

**フェーズ 1: GetReady**
```
Server → "@ \r\n"
Client → "gr\r\n"
```

**フェーズ 2: Method**
```
Server → "[ConnectStatus][9マスのMapObject値]\r\n"
Client → "[action][rote]\r\n"  例: "wr\r\n" (WALK RIGHT)
```

**フェーズ 3: EndSharp**
```
Server → "[更新後のAroundData]\r\n"
Client → "#\r\n"
```

#### AroundData がどの範囲を指すか

**フェーズ 2 の AroundData は常に自機中心の 3x3**。この時点ではまだクライアントの行動を
受け取っていないため、原理的に行動依存にできない (`Game.ts` の `aroundBefore`)。

**フェーズ 3 の AroundData だけが行動依存** (`Game.ts` の `aroundAfter` / `getAroundData(state, team, method)`)。
範囲は `GameLogic.getScanCells()` が決める:

| 行動 | 9マスの範囲 |
|---|---|
| WALK / PUT | 自機中心の 3x3 (row-major) |
| LOOK | 指定方向に2マス離れた地点を中心とする 3x3 (= 距離1〜3の帯、row-major) |
| SEARCH | 指定方向の直線9マス (距離1〜9)。index 0 が最も近い |

Python ライブラリ側では `get_ready()` の戻り値がフェーズ2、`walk()`/`look()`/`search()`/`put()` の
戻り値がフェーズ3にあたる。つまり **LOOK/SEARCH の結果は行動関数の戻り値でしか受け取れない**。
同梱サンプルボットは行動関数の戻り値を捨てているため、この点は `pyCHaser.py` の docstring で明示している。

ワイヤ形式は「1桁の ConnectStatus + 9桁の値」で固定。LOOK/SEARCH も9マスなので形式の変更は不要。

なお、方向が `Rote.UNKNOWN` のとき `getRoteVector` は `{0,0}` を返すため範囲は自機中心に縮退する
(不正な方向自体は `Game.ts` で切断扱いになる)。盤面演出用の `ScanInfo` はこの場合 `null` を返し、
縮退した範囲を描画側に渡さない。

#### 盤面演出への連携

LOOK/SEARCH が行われたターンは `stateUpdate` の第2引数に `ScanInfo` (`packages/ws-types`) が乗り、
`WsServer.toSnapshot` 経由で `game_state` の `lastScan` としてフロントに届く。マスの座標はサーバー側で
確定させて送るため、フロントは探索範囲の幾何を持たない。描画は `GameBoardCanvas` のレイヤー5
(ダーク幕より後) で行う。

### ポート番号

| モード | COOL ポート | HOT ポート |
|---|---|---|
| ローカル | 12031 (固定) | 12032 (固定) |
| Web サービス | 動的 (13000〜14999) | 動的 (13000〜14999) |

Web サービスモードではロビーまたはコントロール画面に表示された値を使います。

### Python プログラム例

```bash
python player.py --host 192.168.x.x --port 12031  # ローカル COOL
python player.py --host example.com --port 13042  # Web COOL (ルームに応じて変わる)
```

---

## 7. ゲームロジック

### ターン表示待機 (turnDelayMs)

```typescript
// Game.ts
this.emit('stateUpdate', state);
if (turnDelayMs > 0) await sleep(ms);
// 次フェーズへ
```

### ラウンド別ボーナス (`calculateBonusBreakdown`)

決着理由が `SCORE` (ターン切れによるアイテム数判定) の場合はボーナスなし。それ以外の決着では:

```typescript
// 「一撃」— 反則負け (自縛/衝突/通信エラー) の場合のみ、敗者に -3×自スコアの罰点
strikeBonus[loserIdx] = isBlunder(status) ? -3 * scores[loserIdx] : 0;
// 「総取り」— 勝者に、決着時点の残アイテム数×7 のボーナス
sweepBonus[winnerIdx] = 7 * leaveItems;
```

ボーナスは1試合制でも発生する（決着理由が `SCORE` 以外なら常に計算される）。合計ポイントは
`scores × 10 + strikeBonus + sweepBonus` で、1試合制ではその1試合分、2試合制では両ラウンドの
合算が最終順位を決める。

この合算はフロントの `lib/setResult.ts` (`roundPointsFor` / `computeSetResult`) に集約している。
集計の単位が team-index ではなく画面側 (`side`) である点に注意 — 2試合制ではラウンドごとに
先攻/後攻が入れ替わるため、`idxForSide(side, round)` で team-index を引き直さないと同じ
プログラムを追いかけられない。

表示の役割分担: `MainWindow` のフッター結果ピルは `gameEnd` (直前ラウンドの結果) をそのまま
表示し、2試合制の第2試合終了時も切り替えない。2試合の合計ポイントで決まるセット全体の勝者は
`PlayerSidePanel` の TOTAL 欄に付く 🏆 (`computeSetResult().winnerSide`) だけが示す。

### 判定優先順位 (`judgeGame`)

1. ブロック下敷き (COLLISION / ATTACK)
2. 4方向囲まれ (CONFINED / TRAPPED)
3. 切断 (FOULED)
4. ターン0 → スコア比較 (SCORE / DRAW)

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
App.tsx (ErrorBoundary でラップ)
├── Lobby.tsx               (?room なし — Web サービスモードのロビー)
│
├── DisplayMode.tsx         (?room=xxx&mode=display)
│   ├── SetupWaiting        (setup フェーズの待機画面, ポートを動的表示)
│   └── MainWindow.tsx      (playing/finished フェーズ)
│
├── ControlApp              (?room=xxx&mode=control)
│   ├── SettingDialog.tsx        表示/BGM/環境のみ (全フェーズ)。対戦ルールは持たない
│   ├── ProgramLibraryDialog.tsx プログラムライブラリ CRUD (setup フェーズのみ)
│   ├── MapManagementDialog.tsx  マップ設定 (setup かつ roundResults が空のときのみ)
│   │   └── MapEditorDialog.tsx  (MapManagementDialog の「エディタで編集...」から開く)
│   ├── StartupDialog.tsx        セットアップ画面 = チーム設定 + 「対戦設定」ストリップ
│   └── MainWindow.tsx
│
└── ManualMode.tsx           (?room=xxx&mode=manual&slot=0|1 — 手動操作ウィンドウ)
    └── ManualControls.tsx
```

盤面反転・左右スコア表示・差分アニメーションのリセット判定 (`MainWindow.tsx` /
`GameBoardCanvas.tsx`) は、バックエンドから明示的な「新ラウンド開始」通知が来ないため、
`turnCount` が前回より増加したことを検知してラウンド境界とみなす設計になっている。

### 主要フック

| フック | 役割 |
|---|---|
| `useGameState(wsUrl, roomId)` | WS 接続・join_room 送信・ゲーム状態管理 |
| `useLobby(wsUrl)` | ロビー用 WS 接続・create_room / join_room |
| `usePersistedState(key, defaults)` | localStorage 永続化 + storage イベントでのウィンドウ間同期の共通実装 |
| `useClientPrefs()` | 表示・音の好み (muted/bgmMuted/bgmTrack/theme/displayTitle)。`u15_client_prefs` |
| `useMatchConfig()` | timeout / turnDelay。`ServerStatusPayload` に無いためクライアント側でキャッシュ。`u15_match_config` |
| `useEnvConfig()` | logDir / pythonCommand (Electron ローカル限定)。`u15_env_config` |
| `useSound()` | SE 再生 |
| `useGamePhaseSound(snapshot, serverStatus, gameEnd, muted)` | フェーズ遷移 (go/finish/win) とスコア変化の SE 再生。ControlApp と DisplayMode で共用 |
| `useTextures(theme)` | テーマ別テクスチャ読込。GameBoardCanvas / MapEditorDialog / MapThumbnail で共用 |
| `useBgm(phase, muted)` | フェーズに応じた BGM 再生・停止 |
| `useStartCountdown(phase, turnInfo)` | 試合開始カウントダウンの表示制御 |
| `useFileUpload()` | XHR multipart アップロード |

### 設定の分類と置き場所 (重要)

設定は「**いつ効くか**」と「**誰が真実を持つか**」で置き場所を決めている。新しい設定を足すときはこの表のどれに当たるかを先に決めること。

| 分類 | 例 | 真実の所在 | UI 上の置き場所 |
|---|---|---|---|
| A. クライアント表示設定 | `muted` `bgmTrack` `theme` `displayTitle` | localStorage (`useClientPrefs`)。storage イベントで観戦ウィンドウと同期する | `SettingDialog` (全フェーズ) |
| B. 対戦設定・サーバー既読返し | `doubleMode` `repeatMode` `demoMode` `darkMode` | **`ServerStatusPayload`**。クライアントにキャッシュを持たない | `StartupDialog` の「対戦設定」ストリップ (`darkMode` のみ全フェーズ操作可のため `SettingDialog`) |
| C. 対戦設定・サーバー未返却 | `timeout` `turnDelay` | クライアントのキャッシュのみ (`useMatchConfig`) | `StartupDialog` の「対戦設定」ストリップ |
| D. 環境設定 (ローカル限定) | `logDir` `pythonCommand` | クライアントのキャッシュ (`useEnvConfig`) | `SettingDialog`「環境」タブ |

**分類 B をローカルにキャッシュして再送しないこと。** 以前は `useSettings` の値を setup フェーズに入るたび
re-push していたため、コントロールウィンドウを複数開くと互いの古い値で上書きし合っていた。これらは
`serverStatus` から直接読み、`state.set*` で直接書く。

**バックエンドのゲート条件と UI の表示条件を一致させること。** サーバーが黙って無視するコマンドを
UI が受け付けると「押せるのに何も起きない」状態になる。対応は以下:

| ゲート (`RoundController`) | 対象コマンド | UI 側の扱い |
|---|---|---|
| `canStart()` = `phase==='setup'` | `set_client` / `set_*_mode` / `request_start` | セットアップ画面自体が setup のときだけ描画される |
| `canEditMap()` = `setup && roundResults.length===0` | `load_map` / `set_map_params` / `load_map_data` | 「マップ設定...」ボタンと「対戦設定」ストリップを非表示にし、`MapManagementDialog` にも `canApply` を渡して二重に塞ぐ |
| ゲートなし | `request_reset` / `set_dark_mode` / `set_turn_delay` / `set_tcp_timeout` | `request_reset` は BottomBar に常設 (デモ/リピート/対戦中からの唯一の出口)。`darkMode` は即時反映 |

### WS URL の自動検出

```typescript
const WS_URL = env?.VITE_WS_URL ?? `ws://${window.location.hostname}:8765`;
```

`http://192.168.1.11:8765` でアクセスすれば `ws://192.168.1.11:8765` に自動接続。

---

## 9. ビルドとデプロイ

### 開発モード (ローカル)

```bash
pnpm --filter @u15/electron dev
# U15_MODE=local で自動起動
# ?room=local&mode=display と ?room=local&mode=control で2ウィンドウが開く
```

Electron の `main.ts` はバックエンドプロセスを起動した後、`/api/default-room` に一定間隔で
ポーリングして roomId を取得してからウィンドウを開く (バックエンドから明示的な起動完了通知が
来ないための設計)。取得に失敗し続けた場合は `roomId='local'` にフォールバックする。

### Web サービスとしてデプロイ

```bash
# ビルド
pnpm build

# 起動
NODE_ENV=production U15_MODE=web PORT=8765 node apps/backend/dist/index.js
```

`NODE_ENV=production` にすると `HttpServer` が `apps/frontend/dist/` を port 8765 で静的配信します。ポート1つで完結します。

### ビルド依存順序

```
@u15/ws-types  →  @u15/backend
                →  @u15/frontend
                     →  @u15/electron
```

### Windows インストーラー (ローカルモード)

```bash
pnpm --filter @u15/electron build:win
# → apps/electron/release/ に NSIS インストーラー (win-unpacked も同時生成)
```

`build:win` は内部で以下を順に行い、**Node/pnpm も Python も入っていない端末でそのまま動く**単一インストーラーを作る。

1. `@u15/backend` を `esbuild` で `dist/index.js` 単一ファイルにバンドル（`ws`/`busboy`/`@u15/ws-types` を inline 化。node_modules 同梱・pnpm シンボリックリンク解決は不要）
2. `@u15/frontend` を `vite build`
3. `apps/electron/scripts/fetch-python.mjs` が Python embeddable package (Windows x64) を `apps/electron/vendor/python/` に取得（初回のみダウンロード、以降はキャッシュ）
4. `electron-builder` が上記 backend/frontend/python を `extraResources` として同梱し NSIS インストーラーを生成

配布版アプリでは、対戦プログラム（Python, 単体 `.py` のみ対応）は同梱の Python で実行されるため、エンドユーザー側で Python をインストールする必要はない（`apps/backend/src/clients/ProcessClient.ts` が `U15_PYTHON_EXE` 環境変数を優先利用。未設定時は開発環境と同じく PATH 上の `python` にフォールバックする）。アップロードされたプログラム/マップの保存先も `app.getPath('userData')`（インストール先ディレクトリに依存しない、OS 標準のユーザーデータフォルダ）に固定される。

---

## 10. マルチルーム / Web サービスモード

### ポート設計

| 用途 | ポート範囲 |
|---|---|
| HTTP / WebSocket | 8765 (固定) |
| ローカルモード AI | 12031, 12032 (固定) |
| Web モード AI | 13000〜14999 (動的、最大500ルーム) |

PortPool は `Set<number>` ベースで O(1) alloc/release。Node.js はシングルスレッドのためロック不要。

### ルームのライフサイクル

```
create_room
  → PortPool.alloc() × 2
  → new ServerManager([p0, p1])
  → ServerManager が TCP 待機開始
  → Room {id, ports, manager, lastActive, phase} を rooms Map に追加

ゲーム実行中は phase='playing' → 自動削除対象外

30分以上 lastActive が更新されない (非playing) → sweepExpired() で自動削除

destroy_room (明示的削除)
  → manager.shutdown() でTCP を閉じる
  → PortPool.release() でポートを返却
  → WsServer の lastRoomStatus, roomManualClients, roomSockets を削除
```

### WsServer のルーティング

```
接続時
  → room_list を全クライアントに送信

join_room {roomId}
  → socketToRoom.set(ws, roomId)
  → roomSockets.get(roomId).add(ws)
  → lastRoomStatus にキャッシュがあれば server_status を即送信
  → room_joined を送信

ゲームメッセージ
  → socketToRoom.get(ws) でルームを特定
  → room.manager.xxx() に dispatch

ルーム削除 (onRoomDestroyed コールバック)
  → lastRoomStatus, roomManualClients, roomSockets から削除
```

### アップロードパスの命名規則

```
server/rooms/<roomId>/programs/cool/   ← COOL プログラム
server/rooms/<roomId>/programs/hot/    ← HOT プログラム
server/rooms/<roomId>/libs/cool/       ← COOL カスタムライブラリ
server/rooms/<roomId>/libs/hot/        ← HOT カスタムライブラリ
server/program-catalog/                ← プログラムライブラリ (全ルーム共通)
server/map-catalog/                    ← マップライブラリ (全ルーム共通)
```

ローカルモードでは `roomId='local'` なので `server/rooms/local/programs/cool/` になります。

---

## 11. テスト

### 単体テスト (Vitest) — backend

```bash
pnpm --filter @u15/backend test
```

テストファイル: `GameLogic.test.ts`, `GameSystem.test.ts`, `ServerManager.test.ts`, `TcpClient.test.ts`, `WsServer.test.ts`, `RoomManager.test.ts`, `HttpServer.test.ts`

`WsServer.test.ts` は `RoomManager` を使ってルーム対応の統合テストを行います。メッセージ受信はバッファ付き `connectWs()` で競合状態を回避しています。

### 単体テスト (Vitest + React Testing Library) — frontend

```bash
pnpm --filter @u15/frontend test
```

`vite.config.ts` の `test` ブロック (environment: jsdom) で設定。テストファイル: `hooks/useTextures.test.ts`, `hooks/useGamePhaseSound.test.ts`。

canvas を多用するコンポーネント (`MapEditorDialog` など) は E2E で既にカバーされているため、まず新規抽出したフック単位のテストを優先しています。

### E2E テスト (Playwright)

```bash
pnpm test:e2e
# または
node apps/electron/test-e2e.mjs
```

前提: `apps/electron/node_modules/electron/dist/electron.exe` が存在すること（セットアップ節のトラブルシューティング参照）。ポート 5173 を他プロセスが使用していると Vite dev サーバーの起動検知がタイムアウトするため、事前に空けておくこと。テスト終了後に Vite の子プロセスが残ることがあるので、連続実行する場合は 5173 が解放されているか確認する。

テスト開始時に `localStorage['u15_match_config'].turnDelay = 0` を設定してからページをリロードし、ゲームを高速化します（`ControlApp` は接続後に一度だけこの値をサーバーへ送るため、リロードが必要）。テストは `?room=local&mode=control` で操作します。

手動操作モードのテストは、コントロールウィンドウではなく `?mode=manual` の専用ウィンドウ
(`app.windows()` から取得) に対して入力を送ります。操作パネル `ManualControls` はそちらにしか無いためです。

Electron を Playwright から起動する際は、`app.process()` の stdout/stderr を必ず読み捨てること。
パイプが詰まるとメイン側が停止し、ウィンドウが生成されないままタイムアウトします。

---

## 12. 拡張ガイド

### 新しいクライアント種別の追加

1. `packages/ws-types/src/index.ts` の `ClientType` に追加
2. `apps/backend/src/clients/` に新クラスを作成 (`BaseClient` を継承)
3. `apps/backend/src/game/SlotManager.ts` の `setClientType` と `startListening` で処理追加
4. `apps/frontend/src/components/TeamSetupPanel.tsx` の `TYPE_LABELS` に追加

### 新しい WebSocket メッセージの追加

1. `packages/ws-types/src/index.ts` の `FrontendMessage` / `WsMessage` / `LobbyMessage` に追加
2. `pnpm --filter @u15/ws-types build`
3. ロビー系メッセージなら `apps/backend/src/network/LobbyRouter.ts`、ルーム内ゲームメッセージなら `apps/backend/src/network/GameMessageDispatch.ts` の switch に追加
4. `apps/frontend/src/hooks/useGameState.ts` に送信関数を追加

### DisplayMode のカスタマイズ

`apps/frontend/src/components/DisplayMode.tsx` の `SetupWaiting` コンポーネントを編集。待機画面（大会名・ロゴ・背景色）をカスタマイズできます。TCP ポートは `clients[0].port` / `clients[1].port` で動的に表示されます。

### ポートプール範囲の変更

`apps/backend/src/index.ts` の `WEB_PORTS` を変更します。

```typescript
const WEB_PORTS: [number, number] = [13000, 14999]; // デフォルト: 最大500ルーム
```

ファイアウォールのポート範囲も合わせて変更してください。

### ルーム TTL の変更

`apps/backend/src/RoomManager.ts` の `ROOM_TTL_MS` を変更します (デフォルト 30分)。
