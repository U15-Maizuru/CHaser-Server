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
│   │       │   ├── ServerManager.ts    コーディネーター (ポート注入対応 constructor(ports))
│   │       │   ├── SlotManager.ts      クライアント接続・スロット管理
│   │       │   ├── MapManager.ts       マップ状態管理
│   │       │   └── RoundController.ts  フェーズ・ラウンド制御
│   │       ├── log/
│   │       │   └── StableLog.ts
│   │       └── network/
│   │           ├── PortPool.ts             TCP ポートプール
│   │           ├── TcpClient.ts
│   │           ├── WsServer.ts             ルーム対応 (setRoomManager) / ソケット⇔ルーム紐付けの薄いコーディネーター
│   │           ├── LobbyRouter.ts          ロビー系メッセージ (create/join/list/destroy_room)
│   │           ├── GameMessageDispatch.ts  ルーム内ゲームメッセージのディスパッチ
│   │           └── HttpServer.ts           room別パス + /api/default-room
│   │
│   ├── frontend/
│   │   └── src/
│   │       ├── App.tsx             ?room= ルーティング + Lobby 分岐
│   │       ├── components/
│   │       │   ├── Lobby.tsx           ロビー画面 (Web モード)
│   │       │   ├── DisplayMode.tsx     wsUrl/roomId props 対応
│   │       │   ├── StartupDialog.tsx
│   │       │   ├── MainWindow.tsx
│   │       │   └── ...
│   │       ├── hooks/
│   │       │   ├── useGameState.ts     roomId 引数 + join_room 送信
│   │       │   ├── useLobby.ts         ロビー用 WS フック
│   │       │   ├── useGamePhaseSound.ts  ControlApp/DisplayMode 共用のフェーズ遷移 SE
│   │       │   ├── useTextures.ts        GameBoardCanvas/MapEditorDialog 共用のテクスチャ読込
│   │       │   └── ...
│   │       └── ...
│   │
│   └── electron/
│       └── src/
│           └── main.ts   /api/default-room で roomId 取得後にウィンドウを開く
│
├── packages/
│   └── ws-types/
│       └── src/index.ts    RoomSummary, LobbyMessage, 新 FrontendMessage 追加
│
├── server/
│   ├── maps/                       マップファイル (全ルーム共通)
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
// ゲーム型 (変更なし)
enum MapObject, Winner, Reason
interface GameStateSnapshot, TurnStartPayload, ScoreData, GameEndPayload
interface RoundResult, ServerStatusPayload, ClientStatusPayload
type ServerPhase, ClientType, ClientState

// ルーム / ロビー型 (追加)
interface RoomSummary { id, phase, ports, createdAt }
type LobbyMessage =
  | { type: 'room_created'; payload: { roomId, ports } }
  | { type: 'room_joined';  payload: { roomId, ports } }
  | { type: 'room_list';    payload: { rooms: RoomSummary[] } }
  | { type: 'error';        payload: { message } }

// フロントエンド → バックエンド (ゲーム + ロビー)
type FrontendMessage =
  | ... (既存ゲームコマンド)
  | { type: 'create_room' }
  | { type: 'join_room';  payload: { roomId } }
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

内部状態は3つのクラスに分割されており、ServerManager 自体はそれらを束ねて外部向けの薄い API (`setClientType` / `requestStart` / `requestReset` など) を提供するだけ。呼び出し側 (`WsServer` / `RoomManager`) から見た公開メソッド名・シグネチャは分割前と同一。

| クラス | 責務 |
|---|---|
| `SlotManager` | スロットごとのクライアント接続 (Process/Tcp/Manual/Com) のライフサイクル管理。`setClientType` / `deleteProgram` / `startListening` など |
| `MapManager` | マップ状態の保持・生成・読込 (`loadMap` / `setMapParams` / `loadMapData`) |
| `RoundController` | フェーズ (`setup`/`playing`/`finished`)・2試合制のラウンド進行・ターン表示待機時間 |

```typescript
// ポートをコンストラクタで注入 (デフォルト [12031, 12032] で後方互換)
constructor(ports: [number, number] = [12031, 12032])

// 部屋削除時の安全なクリーンアップ (TCP を閉じるだけ、再起動しない)
shutdown(): void
```

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
| `set_turn_delay` | `{ms}` | ターン表示待機時間 |
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
| `/api/upload/map` | POST | マップファイル (.map) — 全ルーム共通 |
| `/api/libs?slot=0\|1&room=<id>` | GET | アップロード済みライブラリ一覧 |
| `/api/libs/:filename?slot=0\|1&room=<id>` | DELETE | ライブラリ削除 |

アップロードされたファイルは `server/rooms/<roomId>/programs/cool/` 等にルーム別に保存されます。マップファイルのみ `server/maps/` に共通保存されます。

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

### ポイント計算 (`calculatePoints`)

```typescript
score * 10 + (isWinner ? remainingTurns : 0) + (isWinner && allItemsTaken ? 100 : 0)
```

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
App.tsx
├── Lobby.tsx               (?room なし — Web サービスモードのロビー)
│
├── DisplayMode.tsx         (?room=xxx&mode=display)
│   ├── SetupWaiting        (setup フェーズの待機画面, ポートを動的表示)
│   └── MainWindow.tsx      (playing/finished フェーズ)
│
└── ControlApp              (?room=xxx&mode=control)
    ├── SettingDialog.tsx
    ├── MapEditorDialog.tsx
    ├── StartupDialog.tsx
    └── MainWindow.tsx
```

### 主要フック

| フック | 役割 |
|---|---|
| `useGameState(wsUrl, roomId)` | WS 接続・join_room 送信・ゲーム状態管理 |
| `useLobby(wsUrl)` | ロビー用 WS 接続・create_room / join_room |
| `useSettings()` | localStorage への設定永続化 |
| `useSound()` | SE 再生 |
| `useGamePhaseSound(snapshot, serverStatus, gameEnd, muted)` | フェーズ遷移 (go/finish/win) とスコア変化の SE 再生。ControlApp と DisplayMode で共用 |
| `useTextures(theme)` | テーマ別テクスチャ読込。GameBoardCanvas と MapEditorDialog で共用 |
| `useFileUpload()` | XHR multipart アップロード |

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
# → apps/electron/release/ に NSIS インストーラーが生成
```

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
server/maps/                           ← マップ (全ルーム共通)
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

前提: `apps/electron/node_modules/electron/dist/electron.exe` が存在すること（セットアップ節のトラブルシューティング参照）。ポート 5173 を他プロセスが使用していると Vite dev サーバーの起動検知がタイムアウトするため、事前に空けておくこと。

テスト開始時に `localStorage.turnDelay = 0` を設定してゲームを高速化します。テストは `?room=local&mode=control` で操作します。

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
