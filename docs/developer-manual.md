# CHaser Server — デベロッパーマニュアル

> 対象: 開発者・保守担当者

---

## 目次

0. [用語と識別子の対応](#0-用語と識別子の対応-先に読むこと)
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
13. [大会運営 (トーナメント / リーグ / 予選リーグ)](#13-大会運営-トーナメント--リーグ--予選リーグ)

---

## 0. 用語と識別子の対応 (先に読むこと)

日本語のドキュメント・UI 文言・コードコメントは、**[公式競技ルール](official/競技ルール.pdf)の
用語**に統一している。一方、**コード中の英語識別子は歴史的に `round` / `set` を使っており、
公式用語とは1段ずれている**。両者の対応は次のとおり:

| 公式用語 | 意味 | コード上の識別子 |
|---|---|---|
| **ゲーム** | 1回の対戦 (盤面用意 → 決着 / ターン切れ) | `round` — `currentRound` / `roundResults` / `RoundResult` / `RoundController` / `idxForSide(side, round)` / `roundPointsFor` |
| **試合** | 同じマップで先後を入れ替えた2ゲームのまとまり | `set` — `computeSetResult` / `SetResult` (`ws-types/scoring.ts`)、および `doubleMode` (= 2ゲーム制)<br>大会運営では `match` — `TournamentMatch` / `matchId` / `MatchStatus` (粒度は `set` と同じ) |
| **回戦 / 節** | トーナメントの1回戦・準決勝、リーグの第N節 | `stage` — `TournamentMatch.stage`。`round` は「ゲーム」に使っているので流用しない |
| **予選グループ** | 予選リーグの Aリーグ / Bリーグ。BOT対戦予選では1つだけ | `group` — `TournamentMatch.group`。**これを持つ試合が「予選」**で、持たない試合が決勝トーナメント |
| **運営BOT** | BOT対戦予選で全参加者の対戦相手になるプログラム | `BOT_PARTICIPANT_ID` (`'__bot__'`) — `participants` には入れず、配信ペイロードにだけ合成する |

識別子をリネームすると `ServerStatusPayload` などのプロトコル型まで波及するため、**識別子は
据え置き、日本語表記だけを公式用語に合わせる**方針を採っている。新しいコードを書くときも
この対応表に従うこと (英語識別子は `round`/`set`、日本語コメントは「ゲーム」「試合」)。

決着理由の表記も公式ルールに合わせている。唯一の例外は `Reason.FOULED` で、公式の呼称は
「中断」だが、フッターのリセットボタン (対戦中は「中断」と表示) と紛れるため、UI・ドキュメント
では **「通信エラー」** と表記する (得点上の扱いは公式の「中断【敗】」と同じ)。

| `Reason` | 公式ルールの呼称 | UI 表記 |
|---|---|---|
| `SCORE` | 規定ターン終了時のアイテム数 | アイテム数 |
| `COLLISION` | 衝突 | 衝突 |
| `ATTACK` | アタック | アタック |
| `TRAPPED` | 閉じ込め | 閉じ込め |
| `CONFINED` | 自縛 | 自縛 |
| `FOULED` | 中断 | 通信エラー |

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
│    ├── http/router — ファイルアップロード / default-room     │
│    └── RoomManager — 部屋管理                               │
│          └── Room "local" (ports 2009/2010)                 │
│                └── ServerManager                            │
│                      ├── TcpClient (port 2009)               │
│                      └── TcpClient (port 2010)               │
└─────────────────────────────────────────────────────────────┘
```

手動操作ウィンドウは、コントロールウィンドウがいずれかのスロットを `clientType='manual'` に
設定すると `manual:openWindow` IPC 経由で自動的に開く (`apps/electron/src/main.ts` の
`createManualWindow`)。COOL/HOT それぞれ独立したウィンドウで、`ManualControls.tsx` の
矢印キー操作またはボタンで `manual_action` メッセージを送信する。

対戦表示ウィンドウの全画面化は、コントロール画面の `⛶` から `display:toggleFullscreen` IPC で行う。
全画面中は切り替え元のボタンが裏に隠れるため、`main.ts` の `enableFullscreenEscape` が
全ウィンドウの `before-input-event` を見て `ESC` (解除) と `F11` (切り替え) を受け付ける。

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
│   │       ├── programName.ts      プログラムのソースから名乗るプレイヤー名を読み取る
│   │       ├── mapCatalog.ts       マップライブラリ (CRUD カタログ、全ルーム共通)
│   │       ├── libTemplates.ts     既定ライブラリ (pyCHaser 等) を各ルームの libs/ に配置
│   │       ├── assets/
│   │       │   └── lib-templates/  配置元テンプレート (ビルド時に dist へコピー)
│   │       ├── clients/
│   │       │   ├── ComClient.ts        内蔵 CPU
│   │       │   ├── ManualClient.ts     手動操作
│   │       │   └── ProcessClient.ts    アップロードされたプログラムの子プロセス実行
│   │       ├── game/
│   │       │   ├── types.ts
│   │       │   ├── GameLogic.ts
│   │       │   ├── GameSystem.ts
│   │       │   ├── Game.ts
│   │       │   ├── ServerManager.ts    1ゲームを管理するコーディネーター (コンストラクタでポート番号ペアを受け取る)
│   │       │   ├── SlotManager.ts      クライアント接続・スロット管理
│   │       │   ├── MapManager.ts       マップ状態管理
│   │       │   ├── RoundController.ts  フェーズ・ゲーム制御
│   │       │   ├── roundResult.ts      1ゲームの結果から RoundResult を組み立てる
│   │       │   └── inlineMap.ts        InlineMapData ⇄ GameMap の相互変換
│   │       ├── catalog/
│   │       │   └── JsonIndexStore.ts   「ディレクトリ + index.json」で永続化するカタログの土台
│   │       ├── log/
│   │       │   └── StableLog.ts        対戦ログ (openGameLog がゲームごとのファイルを開く)
│   │       ├── http/
│   │       │   ├── router.ts           入口。リソース別のハンドラへ振り分ける
│   │       │   ├── programs.ts         /api/programs, /api/upload/program
│   │       │   ├── maps.ts             /api/maps* (一覧・ランダム生成・保存・エクスポート)
│   │       │   ├── libs.ts             /api/libs, /api/upload/library
│   │       │   ├── music.ts            /api/music, /api/upload/music
│   │       │   ├── sounds.ts           /api/sounds, /api/upload/sounds/:key (SE の差し替えファイル)
│   │       │   ├── static.ts           frontend/dist の静的配信 (SPA フォールバック付き)
│   │       │   └── paths.ts            ルーム・音源のディレクトリ規約
│   │       └── network/
│   │           ├── PortPool.ts             TCP ポートプール
│   │           ├── BaseClient.ts           全クライアント種別の基底 (Process/Tcp/Manual/Com)
│   │           ├── TcpClient.ts
│   │           ├── WsServer.ts             WebSocket サーバー。setRoomManager でルームマネージャを注入し、ソケット⇔ルームの紐付けを管理する薄いコーディネーター
│   │           ├── LobbyRouter.ts          ロビー系メッセージ (create/join/list/destroy_room) を処理
│   │           ├── GameMessageDispatch.ts  ルーム内ゲームメッセージを対応する ServerManager へディスパッチ
│   │           ├── TournamentMessageDispatch.ts  ルーム内の大会運営メッセージを転送
│   │           └── localIp.ts               LAN から到達できる自分の IPv4 アドレス
│   │
│   ├── frontend/
│   │   ├── public/
│   │   │   └── favicon.ico      ブラウザのタブ用アイコン (icon.ico と同じ絵。dist の直下へコピーされる)
│   │   └── src/
│   │       ├── App.tsx             ?room=/?mode= に応じて画面を分岐 (Lobby/Display/Control/Tournament/Manual)
│   │       ├── ui/                 画面共通の見た目 (tokens / Button / Card / Dialog / Field / Tabs)
│   │       ├── assets/
│   │       │   ├── Image/          テーマ別の盤面テクスチャ (Jewel / Light / Heavy / RPG)
│   │       │   └── Sound/          同梱の SE (server/sounds に同名を置くと差し替わる)
│   │       ├── components/
│   │       │   ├── Lobby.tsx           ロビー画面 (Web モード)
│   │       │   ├── DisplayMode.tsx     観戦画面。出す画面を決め、BGM と SE もその場面に合わせる
│   │       │   ├── StartupDialog.tsx
│   │       │   ├── MapLibraryDialog.tsx     マップライブラリの管理モーダル (追加・DL・削除のみ。選択はしない)
│   │       │   ├── MapSourceSection.tsx     使うマップの選択 (ライブラリ/ランダム生成/エディタ) — マップ列にインライン展開
│   │       │   ├── MapEditorDialog.tsx      Canvas ベースのマップ編集 (現在のマップを起点に編集し、適用/ライブラリ保存/ダウンロードを分離)
│   │       │   ├── MapThumbnail.tsx         マップの縮小プレビュー (マップ列・待機画面で使用。flip で第2ゲームの反転表示)
│   │       │   ├── FitArea.tsx              中身を親の空きいっぱいまで拡大・縮小して中央に置く入れ物 (観戦画面・大会の表)
│   │       │   ├── MainWindow.tsx      盤面・スコア・進行状況の表示 (対戦表示/コントロール共用)
│   │       │   ├── GameBoardCanvas.tsx 盤面描画 (テクスチャ・探索範囲・決着演出・ダーク幕)
│   │       │   ├── PlayerSidePanel.tsx 左右のスコアパネル (ゲームごとの明細と総合)
│   │       │   ├── BottomBar.tsx       フッター (ライブラリ管理 / 次の一手 / 大会運営・設定・リセット)
│   │       │   ├── tournament/        大会運営 (13章)
│   │       │   │   ├── TournamentMode.tsx  ?mode=tournament のルート
│   │       │   │   ├── board/              表を描く部品 (観客席と運営席で共用)
│   │       │   │   ├── panel/              運営パネル (今やること + 大会/進行/設定タブ)
│   │       │   │   ├── qualifier/          決勝進出者の確認と差し替え
│   │       │   │   └── editor/             大会データの作成・編集フォーム
│   │       │   ├── ManualMode.tsx      手動操作ウィンドウのルート
│   │       │   ├── ManualControls.tsx  手動操作の入力パネル (矢印キー/ボタン)
│   │       │   ├── ErrorBoundary.tsx   描画エラーを捕捉して各ウィンドウの落ちを防ぐ
│   │       │   └── ...
│   │       ├── hooks/
│   │       │   ├── useGameState.ts     WS 接続・roomId 引数・join_room 送信・ゲーム状態管理
│   │       │   ├── useLobby.ts         ロビー用 WS フック
│   │       │   ├── useGamePhaseSound.ts  場面の切り替わりとスコア変化の SE
│   │       │   ├── useSound.ts           SE の読込と再生 (同梱 + server/sounds での差し替え)
│   │       │   ├── useTextures.ts        テーマ別テクスチャの読込
│   │       │   ├── useCurrentMap.ts      今出ているマップの取得 (コントロール窓と観戦窓で共用)
│   │       │   ├── useFitScale.ts        空き領域に合わせた表示倍率の算出 (FitArea の中身)
│   │       │   ├── useBgm.ts             場面に応じた BGM 再生
│   │       │   ├── useStartCountdown.ts  ゲーム開始カウントダウンの表示制御
│   │       │   ├── useBoardLayout.ts     盤面のセルサイズ・サイドパネル幅・スコアバー寸法の導出
│   │       │   ├── useFitCorrection.ts   中身が高さに収まる最大の拡大率を二分探索で求める
│   │       │   └── ...
│   │       ├── lib/
│   │       │   ├── api.ts             バックエンドの HTTP API を叩く場所 (URL とレスポンスの形はここだけが知る)
│   │       │   ├── appMode.ts         URL のクエリから「どの画面を出すか」を読む + ウィンドウ/タブのタイトル
│   │       │   ├── boardDraw.ts       盤面 canvas の共通部品 (色・反転の式・テクスチャのフォールバック)
│   │       │   ├── boardLayers.ts     盤面に重ねるレイヤー (決着演出・ダーク幕)
│   │       │   ├── panelDim.ts        サイドパネルの寸法計算
│   │       │   ├── roundRow.ts        2ゲーム制サイドパネルの明細1行の組み立て
│   │       │   ├── resultText.ts      決着理由・勝敗の文言
│   │       │   ├── decisiveEffect.ts   決着理由 → 盤面演出 (勝者の 👑・敗者の暗転・敗因バッジ/リング) の変換
│   │       │   └── ...
│   │       └── ...
│   │
│   └── electron/
│       ├── assets/
│       │   ├── icon.ico    Windows 版アイコン (ウィンドウ・タスクバー・インストーラー・exe で共用)
│       │   └── icon.icns   macOS 版アイコン (icon.ico から sips/iconutil で生成)
│       └── src/
│           └── main.ts   バックエンド起動 → /api/default-room から roomId を取得 → 対戦表示/コントロール
│                          ウィンドウを開く。手動操作ウィンドウは manual:openWindow IPC で必要時に開く
│
├── packages/
│   └── ws-types/
│       └── src/
│           ├── protocol.ts       基本型・enum・共有の既定値 (依存なし)
│           ├── scoring.ts        競技ルールの得点・勝敗判定の純関数と係数
│           ├── messages.ts       WS メッセージ union
│           ├── tournament.ts     大会運営の型と純関数
│           ├── tournamentFlow.ts 試合グラフを読む述語
│           └── index.ts          re-export の集約点
│
├── server/
│   ├── program-catalog/            プログラムライブラリ (CRUD カタログ、全ルーム共通)
│   ├── map-catalog/                マップライブラリ (CRUD カタログ、全ルーム共通)
│   ├── music/                      BGM ファイル (全ルーム共通)
│   ├── sounds/                     SE の差し替えファイル (全ルーム共通)
│   └── rooms/<roomId>/
│       ├── programs/cool/          COOL プレイヤーのアップロードプログラム
│       ├── programs/hot/
│       ├── libs/cool/              pyCHaser 等の既定ライブラリ + カスタムライブラリ
│       └── libs/hot/
│
└── docs/
```

---

> 上記に加えて、大会運営機能のファイルがある (詳細は [13章](#13-大会運営-トーナメント--リーグ--予選リーグ)):
> `apps/backend/src/tournament/` (試合グラフ・永続化・オーケストレータ) /
> `apps/frontend/src/components/tournament/` + `lib/bracketLayout.ts` (トーナメント表) /
> `packages/ws-types/src/{protocol,scoring,tournament,tournamentFlow,messages}.ts` (共有型と純関数) /
> 実行時データは `server/tournament/<大会id>/`。

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

### 残るプロセス (dev の終了処理)

dev で立ち上がるのは3つのサーバー的プロセスで、**実体は孫の位置にいる**:

```
node dev.js
├── vite                       … 5173 (esbuild を子に持つ)
└── electron
    └── node tsx/cli.cjs
        └── node backend       … 8765 (対戦プログラムを子に持つ)
```

Windows には POSIX のプロセスグループが無く、`child.kill()` は指定した PID しか殺さない。
そのため直接の子だけを kill すると Vite やバックエンドが生き残り、ポートを握ったままになる。
この状態で次に dev すると、新しいバックエンドは 8765 を取れず画面は**前回の**ゴーストに
つながる (前の対戦状態が見える・変更が反映されない) ため、原因が非常に分かりにくい。

対策は2つ:

- **`killTree()` (`apps/electron/src/killTree.ts`) で木ごと落とす。** Ctrl+C・コントロール
  画面を閉じた場合・E2E の後始末のすべてがこれを通る (`dev.js` / `main.ts` の `stopBackend` /
  `test-e2e.mjs`)。Windows は `taskkill /T /F`、POSIX はプロセスグループへのシグナル
  (`process.kill(-pid, ...)`)。POSIX でこれが届くのは、backend を起動する
  `spawn()` (`main.ts`) に `detached: true` を渡してプロセスグループ長にしているため
  (対戦プログラム側の `spawn()` (`ProcessClient.ts`) は detached にせず backend と同じ
  グループに留めることで、backend を kill すると一緒に落ちるようにしている)。
- **起動前にポートを点検する。** 5173 / 8765 が既に使われていたら、黙って壊れた状態で
  立ち上がらず、掃除のコマンドを表示して止まる (`dev.js` の `preflight`)。

`dev.js` が Vite を pnpm 経由ではなく直接起動しているのも同じ理由 (pnpm/cmd を挟むと
実体が3階層下に来る)。**新しい子プロセスを足すときは、必ず `killTree` の対象に入れること。**

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
interface CatalogEntry { id, displayName, programPath, programType, runtimeCommand, uploadedAt, demoEnabled, declaredName? }
interface MapCatalogEntry { id, displayName, mapPath, uploadedAt, size, turn, blockCount, itemCount }
interface MapParams { itemNum, blockNum, turnNum, mirror, size? }
interface InlineMapData { field, size, turn, teamFirstPoint }
type MapSourceKind = 'random' | 'catalog' | 'editor'
interface MapSourceInfo { kind, catalogId?, displayName? }   // ServerStatusPayload.mapSource

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
  | { type: 'load_map'; payload: { catalogId } }
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

大会運営の型と純関数は `tournament.ts` / `tournamentFlow.ts` にある (13章)。

```typescript
// 大会データ (tournament.json)。stage は format で判別する共用体
interface TournamentDefinition { formatVersion, id, name, match, stage, participants, bracket?, schedule? }
interface MatchRules { doubleMode }
type StageRules =
  | { format: 'single-elimination'; map; thirdPlaceMatch }
  | { format: 'league';             map; league }
  | { format: 'group-then-bracket'; map; thirdPlaceMatch; league; groupCount; advancePerGroup }
  | { format: 'bot-then-bracket';   map; thirdPlaceMatch; bot; advanceCount }

// 進行状態 (state.json)
interface TournamentState { tournamentId, matches, programs, decisions, updatedAt }
interface OperatorDecisions { stageMaps, qualifiers, exclusions, qualifiersConfirmed }

// 試合グラフを読む述語 (tournamentFlow.ts)
nextReadyMatch / isKnockoutMatch / groupStageCount / isGroupStageDone
blockedByQualifiers / nextOperatorAction
```

**形式ごとに意味を持つ設定が違うので `StageRules` は判別共用体にしてある。** 平坦な設定袋に
すると「この項目はこの形式のときだけ意味がある」という約束がコメントにしか無くなる。
利用側は `hasThirdPlaceMatch` / `leagueRulesOf` / `botRulesOf` / `advancePerGroupOf` で取り出す。

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
| `MapManager` | マップ状態と**選択中のソース** (`random` / `catalog` / `editor`) の保持。`loadFromCatalog` / `setMapParams` / `loadInlineData` / `refreshForNewGame` / `getCurrentMapData` |
| `RoundController` | フェーズ (`setup`/`playing`/`finished`)・2ゲーム制のゲーム進行・デモ/リピートモード・ターン表示待機時間 |

```typescript
// ポートはコンストラクタで指定する (省略時は [2009, 2010])
constructor(ports: [number, number] = [2009, 2010])

// 部屋削除時の安全なクリーンアップ (TCP を閉じるだけ、再起動しない)
shutdown(): void
```

デモモード (`setDemoMode`) は、全スロットが ready になった時点で自動的に `requestStart` を、
2ゲーム制の第1ゲーム終了時に自動的に `requestNextRound` を、リピートモード併用時は最終ゲーム終了時に
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
| `request_next_round` | — | 次ゲーム開始 |
| `set_double_mode` | `{enabled}` | 2ゲーム制 ON/OFF |
| `set_repeat_mode` | `{enabled}` | リピートモード ON/OFF (setup フェーズのみ変更可) |
| `set_demo_mode` | `{enabled}` | デモモード (無人自動進行) ON/OFF (setup フェーズのみ変更可) |
| `set_dark_mode` | `{enabled}` | 対戦表示のダークモード ON/OFF |
| `set_turn_delay` | `{ms}` | ターン表示待機時間 |
| `set_tcp_timeout` | `{ms}` | TCP クライアントの応答タイムアウト |
| `set_log_dir` | `{dir}` | ログ保存先 (ローカルモードのみ有効) |
| `set_python_command` | `{command}` | Python 実行コマンドの上書き (ローカルモードのみ有効) |
| `request_next_round` | — | 2ゲーム制: 次ゲームの準備 (先後を入れ替えて再接続待ちにする) |
| `request_repeat` | — | 最終ゲーム終了後、接続 (type) を維持したまま先後を入れ替えて再戦準備する |
| `manual_action` | `{slot, action, rote}` | 手動操作 |
| `load_map` | `{catalogId}` | マップライブラリのエントリを選択 (パスの解決はサーバー側) |
| `set_map_params` | `{...}` | ランダム生成に切り替え、パラメータを記憶して生成 |
| `load_map_data` | `{...}` | マップデータ直接送信 (エディタ由来) |

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
| `/api/default-room` | GET | ローカルモード用: `{roomId: "local", ports: [2009, 2010]}` を返す |
| `/api/upload/program?slot=0\|1&room=<id>` | POST | AI プログラム (.py/.exe) をルームのスロットへ直接アップロード |
| `/api/programs` | POST | プログラムライブラリへの新規アップロード (.py/.exe) — 全ルーム共通、`programCatalog.ts` |
| `/api/programs` | GET | プログラムライブラリの一覧 (`CatalogEntry[]`) |
| `/api/programs/:id` | PATCH | デモ対象フラグの更新 (`{demoEnabled: boolean}`) |
| `/api/programs/:id` | DELETE | プログラムライブラリからの削除 |
| `/api/upload/library?slot=0\|1&room=<id>` | POST | カスタムライブラリ (.py) アップロード |
| `/api/libs?slot=0\|1&room=<id>` | GET | アップロード済みライブラリ一覧 |
| `/api/libs/:filename?slot=0\|1&room=<id>` | DELETE | ライブラリ削除 |
| `/api/maps` | POST | マップライブラリへの新規アップロード (.map) — 全ルーム共通、`mapCatalog.ts` |
| `/api/maps` | GET | マップライブラリの一覧 (`MapCatalogEntry[]`) |
| `/api/maps/:id` | DELETE | マップライブラリからの削除 |
| `/api/maps/:id/download` | GET | ライブラリ内マップのダウンロード (Content-Disposition 付き) |
| `/api/maps/current?room=<id>` | GET | 指定ルームの現在のマップ (`InlineMapData`)。エディタ起点・現在マップ表示に使用 |
| `/api/maps/random` | POST | ステートレスなランダムマップ生成 (`MapParams` → `InlineMapData`)。`GameSystem.createRandomMap` を直接呼ぶだけでどの部屋にも影響しない |
| `/api/maps/save-inline` | POST | 今出ているマップ (`InlineMapData`) をライブラリへ保存。ランダム生成・エディタのどちらからも使う |
| `/api/maps/export` | POST | 今出ているマップをライブラリに残さずそのままダウンロード |
| `/api/upload/music` | POST | BGM (.mp3/.wav) アップロード — 全ルーム共通 (`server/music/`) |
| `/api/music` | GET | 利用可能な BGM ファイル名の一覧 |
| `/api/music/:filename` | GET | BGM の再生用ストリーム |
| `/api/music/:filename` | DELETE | BGM ライブラリから削除。存在しないファイルへの DELETE も 204 (べき等) |
| `/api/sounds` | GET | `server/sounds/` に在る差し替え用 SE のファイル名の一覧。無ければ空配列 |
| `/api/sounds/:filename` | GET | 差し替え用 SE の再生用ストリーム |
| `/api/upload/sounds/:key` | POST | SE (.mp3/.wav) の差し替えアップロード。`key` は `SoundKey` のいずれか。保存ファイル名は `key + 拡張子` に強制され、同じ key の別拡張子ファイルは削除される |
| `/api/sounds/:filename` | DELETE | 差し替えファイルを削除し、同梱の音に戻す。存在しないファイルへの DELETE も 204 (べき等) |

アップロードされたファイルは `server/rooms/<roomId>/programs/cool/` 等にルーム別に保存されます。プログラム・マップ・BGM・SE は `server/program-catalog/` / `server/map-catalog/` / `server/music/` / `server/sounds/` にルームを跨いで共通保存されます。

SE の実体は `apps/frontend/src/assets/Sound/` に同梱し、`server/sounds/` は**差し替え用**です。同名 (拡張子は問わない) が置かれていれば同梱分より優先されます。BGM (`music.ts`) が「自由な名前で蓄積して選ぶ」構造なのに対し、SE は場面ごとに名前 (`SoundKey`、`packages/ws-types` の `SOUND_KEYS` が単一情報源) が決まっていて選ぶ余地がないため、アップロードは「この場面キーを差し替える」1本のみで、保存名は常にサーバー側で場面キーへ強制する。設定ダイアログの SE タブから場面ごとにアップロード/削除できるほか、`server/sounds/` へ利用者が直接ファイルを置く (正規名にリネームして) こともできる。

**`server/music/` と `server/sounds/` はどちらも空でありえます。** そのとき一覧は空配列を返し、BGM は無音、SE は同梱分が鳴ります。音源の有無で画面や進行が変わってはいけません。

---

## 6. TCP クライアントプロトコル

Python AI プログラムはサーバーに TCP 接続して以下のプロトコルでゲームを行います。**ローカルモードでも Web サービスモードでも同一プロトコルです。** 異なるのは接続先ポート番号のみです。

### 接続

```
Client → Server: "[プレイヤー名]\r\n"
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

#### 9マスの「値」— 相手プレイヤーは TARGET

各マスの値は `MapObject` (`NOTHING=0` / `TARGET=1` / `BLOCK=2` / `ITEM=3`)。盤外は `BLOCK` 扱い。

**問い合わせたマスに相手プレイヤーがいる場合は、盤面の値より優先して `TARGET`(1) を返す**
(`GameLogic.getAroundData`)。本家 Qt 版の `GameBoard::FieldAccess` と同じ挙動で、選手のボットが
`look()` / `search()` で相手を発見する唯一の手段になる。上表のどの範囲でも、また `get_ready()` /
`walk()` / `put()` でも同様に効く。

一方 **勝敗判定 (`judgeGame`) はこのオーバーレイを載せない生の盤面 (`getJudgeAround`) を見る**。
両者が同一マスに重なったとき、下敷き判定 (`[4]`) の `BLOCK` が `TARGET` に隠されて判定が
消えるのを防ぐため。`getJudgeAround` は範囲も常に自機中心 3x3 で固定してある
(下敷き `[4]` / 囲まれ `[1][3][5][7]` のインデックス前提を崩さない)。

なお、方向が `Rote.UNKNOWN` のとき `getRoteVector` は `{0,0}` を返すため範囲は自機中心に縮退する
(不正な方向自体は `Game.ts` で切断扱いになる)。盤面演出用の `ScanInfo` はこの場合 `null` を返し、
縮退した範囲を描画側に渡さない。

#### 盤面演出への連携

LOOK/SEARCH が行われたターンは `stateUpdate` の第2引数に `ScanInfo` (`packages/ws-types`) が乗り、
`WsServer.toSnapshot` 経由で `game_state` の `lastScan` としてフロントに届く。マスの座標はサーバー側で
確定させて送るため、フロントは探索範囲の幾何を持たない。描画は `GameBoardCanvas` のレイヤー5
(ダーク幕より後) で行う。

`ScanInfo.cells` は **自機から近い順** に並べて送る (`GameLogic.scanInfoFrom` の `orderByDistance`)。
描画側が自機から先端へ走るスイープ演出を index だけで書けるようにするため。SEARCH は 1 マスずつ、
LOOK は 3 マスずつが同じ距離の帯になる (`cells[0..2]` が距離1、`[3..5]` が距離2、`[6..8]` が距離3)。
**ワイヤの AroundData とは順序が違う**点に注意 — あちらは絶対座標の row-major で固定
(`getScanCells` の出力そのまま)。並べ替えは `scanInfoFrom` の中だけで行い、`getScanCells` /
`getAroundData` には持ち込まない。

### ポート番号

| モード | COOL ポート | HOT ポート |
|---|---|---|
| ローカル | 2009 (固定) | 2010 (固定) |
| Web サービス | 動的 (13000〜14999) | 動的 (13000〜14999) |

Web サービスモードではロビーまたはコントロール画面に表示された値を使います。

### Python プログラム例

```bash
python player.py --host 192.168.x.x --port 2009   # ローカル COOL
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

### ゲーム別ボーナス (`calculateBonusBreakdown`)

決着理由が `SCORE` (ターン切れによるアイテム数判定) の場合、および勝者が COOL/HOT に定まらない
場合はボーナスなし。それ以外の決着では:

```typescript
if (isBlunder(status)) {
  // 「一撃」(ペナルティ) — 自滅 (自縛/衝突/通信エラー) した敗者に -3×自スコア
  strikeBonus[loserIdx] = -BLUNDER_PENALTY_PER_ITEM * scores[loserIdx];
} else {
  // 「一撃」(ボーナス) — 相手を仕留めた決着 (アタック/閉じ込め) の勝者に定額 +50
  strikeBonus[winnerIdx] = STRIKE_WIN_BONUS;
}
// 「総取り」— 勝者に、決着時点の残アイテム数×6 のボーナス
sweepBonus[winnerIdx] = SWEEP_POINT_PER_ITEM * leaveItems;
```

係数は競技ルールの「ポイント」に対応する (アイテム×10 / アタック・閉じ込め【勝】+50 /
衝突・自縛【敗】−獲得数×3 / 総取り【勝】+残り×6)。`strikeBonus` は勝者側の加点と敗者側の
減点の両方を取りうる (決着理由が排他なので、1ゲームでどちらか一方だけが入る) 点に注意。

ボーナスは1ゲーム制でも発生する（決着理由が `SCORE` 以外なら常に計算される）。1ゲームの
ポイントは `scores × 10 + strikeBonus + sweepBonus`。

試合全体の集計は `@u15/ws-types` の `scoring.ts` (`roundPointsFor` / `roundWonBy` /
`computeSetResult`) に集約している。集計の単位が team-index ではなく画面側 (`side`) である点に
注意 — 2ゲーム制ではゲームごとに先攻/後攻が入れ替わるため、`idxForSide(side, round)` で
team-index を引き直さないと同じプログラムを追いかけられない。

試合勝者の判定順は競技ルールどおり **① 勝利数 → ② 合計ポイント**。`computeSetResult()` は
どちらで決まったかを `decidedBy: 'wins' | 'points'` で返し、`PlayerSidePanel` の総合欄が
決め手になった側の行を枠で強調するのに使う。

**勝利数・合計ポイントとも並んだ場合、競技ルールでは「マップを変更して再試合」** となる。
アプリはこの再試合を自動化していない: `computeSetResult()` は `winnerSide: null` /
`decidedBy: null` を返し、どちらのパネルにも 🏆 を付けずに終わる (運営がリセットして
マップを選び直す運用)。自動化するならこの戻り値が分岐点になる。

表示の役割分担: `MainWindow` のフッター結果ピルは `gameEnd` (直前ゲームの結果) をそのまま
表示し、2ゲーム制の第2ゲーム終了時も切り替えない。試合全体の勝者は `PlayerSidePanel` の
総合欄に付く 🏆 (`computeSetResult().winnerSide`) だけが示す。

### 判定優先順位 (`judgeGame`)

1. ブロック下敷き (COLLISION / ATTACK)
2. 4方向囲まれ (CONFINED / TRAPPED)
3. 切断 (FOULED)
4. ターン0 → スコア比較 (SCORE / DRAW)

### 競技ルールが定める盤面の値

| 項目 | 競技ルール | 実装 |
|---|---|---|
| マップサイズ | 横 15・縦 17 | `GameSystem.createRandomMap` の既定サイズが 15×17。フロントの `MAP_SIZES` は「決戦 (15×17)」= 公式、「広域 (21×17)」= 公式外の練習用 |
| ターン数 | 1ゲーム 100〜240 | 既定 100 (`MapManager.params.turnNum`)。入力欄 (`MapSourceSection`) の許容範囲は 10〜500 と公式より広く、`.map` の `T:` 行にも上限チェックが無いため、**公式範囲外の値も通る** (練習・デモ用途のため意図的) |
| プレイヤー初期位置 | 中央より左に先攻・右に後攻 | ランダム生成は `mirror` で左右対称に配置。`.map` は `C:` / `H:` 行の座標をそのまま使う |

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
│   │                       displayScene() が出す画面を決め、BGM もその場面から選ぶ
│   ├── SetupWaiting        (waiting = 接続待ち)
│   │   ├── MapPreview (SetupWaiting 内) これから戦うマップ。第2ゲーム前は盤面と同じ向きに反転
│   │   └── BracketView / LeagueTable    大会運営中の勝ち上がり (fit で空きいっぱいに拡大)
│   ├── TournamentStandby   (standby = 大会運営中で次の試合が未準備。表だけを大きく見せる)
│   ├── TournamentFinale    (award   = 全試合が確定したあとの表彰)
│   └── MainWindow.tsx      (playing = 対戦中 / result = 決着した盤面)
│       ├── PlayerSidePanel.tsx × 2   左右のスコアパネル (1ゲーム制/2ゲーム制で明細が変わる)
│       └── GameBoardCanvas.tsx       盤面描画 (探索範囲・決着演出・ダーク幕)
│
├── ControlApp              (?room=xxx&mode=control)
│   ├── SettingDialog.tsx        表示/対戦/BGM/SE/環境 (全フェーズ)。設定の集約先
│   ├── ProgramLibraryDialog.tsx プログラムライブラリの管理 (setup フェーズのみ)
│   ├── MapLibraryDialog.tsx     マップライブラリの管理 (setup フェーズのみ)
│   ├── MapEditorDialog.tsx      (マップ列「エディタ」タブの「エディタで編集...」から開く)
│   ├── StartupDialog.tsx        セットアップ画面 = COOL / マップ / HOT の3カラム
│   │   ├── TeamSetupPanel.tsx
│   │   │   └── ProgramLibrarySection.tsx  使うプログラムの「選択」専用
│   │   └── MapPreviewColumn (StartupDialog 内)
│   │       └── MapSourceSection.tsx       使うマップの「選択」専用 (ライブラリ/ランダム/エディタ)
│   ├── BottomBar.tsx            フッター (ライブラリ管理 / 次の一手 / 大会運営・設定・全画面・リセット)
│   └── MainWindow.tsx
│
├── TournamentMode.tsx       (?room=xxx&mode=tournament — 大会運営ウィンドウ / 13章)
│   ├── BracketView / LeagueTable / QualifyingView   左: 大会の表
│   └── TournamentPanel                              右: 今やること + 大会/進行/設定タブ
│
└── ManualMode.tsx           (?room=xxx&mode=manual&slot=0|1 — 手動操作ウィンドウ)
    └── ManualControls.tsx
```

**画面共通の見た目は `src/ui/` に集約する。** 色トークン (`tokens.ts`) と、
`Button` / `Card` / `Section` / `Dialog` / `Field` 系 / `Tabs` / `Callout` がある。
ダイアログの幕やボタンの塗りを各画面で書き起こさないこと — 6画面で少しずつ違う幕を
持っていると、余白や角丸を直すたびに全部を触ることになる。

盤面反転・左右スコア表示・差分アニメーションのリセット判定 (`MainWindow.tsx` /
`GameBoardCanvas.tsx`) は、バックエンドから明示的な「新ゲーム開始」通知が来ないため、
`turnCount` が前回より増加したことを検知してゲーム境界とみなす設計になっている。

**待機画面のマップも同じ向きで出す**: 第2ゲームは先攻・後攻が入れ替わるぶん盤面を180°反転する
(`doubleMode && currentRound === 1`)。待機中のプレビュー (`DisplayMode` の `MapPreview` と
`StartupDialog` の `MapPreviewColumn`) にも同じ条件で `MapThumbnail flip` を渡すこと。
反転しないと、ゲームが始まった瞬間に向きが変わって見える。反転の式は `GameBoardCanvas` と同一。

### 主要フック

| フック | 役割 |
|---|---|
| `useGameState(wsUrl, roomId)` | WS 接続・join_room 送信・ゲーム状態管理 |
| `useLobby(wsUrl)` | ロビー用 WS 接続・create_room / join_room |
| `usePersistedState(key, defaults)` | localStorage 永続化 + storage イベントでのウィンドウ間同期の共通実装 |
| `useMuteOverride()` | ブラウザ観戦者が自分の端末用に SE/BGM ミュートを上書きする値。`ServerStatusPayload` には乗らないローカル専用設定。`u15_mute_override` |
| `useMatchConfig()` | timeout / turnDelay。`ServerStatusPayload` に無いためクライアント側でキャッシュ。`u15_match_config` |
| `useEnvConfig()` | logDir / pythonCommand (Electron ローカル限定)。`u15_env_config` |
| `useMapGenParams()` | ランダム生成のパラメータ (sizeIdx/blockNum/itemNum/turnNum/mirror)。`u15_map_gen_params` |
| `useSound(httpBase, enabled)` | SE 再生。`SoundKey` の値がそのまま音源のファイル名。同梱の音を同期的に読み、`GET /api/sounds` に同名があればそちらへ差し替える。`enabled=false` の窓では読み込まない |
| `useGamePhaseSound(input)` | 場面の切り替わりとスコア変化の SE 再生。ControlApp と DisplayMode で共用し、`enabled` で鳴らす窓を 1 つに絞る |
| `useTextures(theme)` | テーマ別テクスチャ読込。GameBoardCanvas / MapEditorDialog / MapThumbnail で共用 |
| `useCurrentMap(httpBase, roomId, isConnected, serverStatus)` | 今出ているマップ (`GET /api/maps/current`)。マップ変更の WS イベントは無いので setup 中は `server_status` のたびに取り直す。同じ内容なら state を更新しない |
| `useFitScale(max, min)` | 入れ物と中身を実測して表示倍率を出す。`FitArea` 経由で使う |
| `useBgm(httpBase, track, muted, enabled)` | BGM の再生・停止。鳴らす曲は呼び出し側が場面から決める。Audio は常に 1 つだけ持つ |
| `useStartCountdown(phase, turnInfo)` | ゲーム開始カウントダウンの表示制御 |
| `useFileUpload()` | XHR multipart アップロード |

### 設定の分類と置き場所 (重要)

設定は「**いつ効くか**」と「**誰が真実を持つか**」で置き場所を決めている。新しい設定を足すときはこの表のどれに当たるかを先に決めること。

| 分類 | 例 | 真実の所在 | UI 上の置き場所 |
|---|---|---|---|
| A. 観戦画面の表示・音設定 | `muted` `bgmMuted` `bgmTrack{0,1,Wait,Result,Award}` `theme` `displayTitle` `veilAlpha` | **`ServerStatusPayload.displayPrefs`**。`darkMode` と同じくクライアントにキャッシュを持たない (SE/BGM ミュートだけはブラウザ観戦者が `useMuteOverride` でローカルに上書きできる) | `SettingDialog` (全フェーズ) |
| B. 対戦設定・サーバー既読返し | `doubleMode` `repeatMode` `demoMode` `darkMode` | **`ServerStatusPayload`**。クライアントにキャッシュを持たない | `SettingDialog`「対戦」タブ (`darkMode` のみ「表示」タブ) |
| C. 対戦設定・サーバー未返却 | `timeout` `turnDelay` | クライアントのキャッシュのみ (`useMatchConfig`) | `SettingDialog`「対戦」タブ |
| B'. マップの選択状態 | `mapSource` (`random` / `catalog` / `editor`) | **`ServerStatusPayload.mapSource`**。`MapManager` が保持する | `StartupDialog` マップ列の `MapSourceSection` |
| C'. マップ生成パラメータ | `sizeIdx` `blockNum` `itemNum` `turnNum` `mirror` | クライアントのキャッシュ (`useMapGenParams`) + **サーバーも `MapManager.params` として保持** | `MapSourceSection`「ランダム」タブ・`MapEditorDialog` |
| D. 環境設定 (ローカル限定) | `logDir` `pythonCommand` | クライアントのキャッシュ (`useEnvConfig`) | `SettingDialog`「環境」タブ |

**分類 A は表示・BGM・SE のどの項目も [保存] を待たずに即反映する。** `darkMode` と同じく
サーバーが真実を持つ値で、会場のプロジェクタに投影しながら見え方や音を確かめて決めるため、
保存を挟むと調整にならない。`veilAlpha` の範囲 (`VEIL_ALPHA_MIN`/`MAX`) と既定値は
`@u15/ws-types` (`protocol.ts`) が持ち、`GameBoardCanvas` 側でも同じ範囲にクランプする。

**分類 C' は接続後に一度 push すること。** `MapManager` は自分の `params` を使って
起動時・`requestReset`・`requestRepeat` でマップを再生成する。クライアントが `set_map_params` を
送らない限りサーバー側はハードコードの既定値 (15×17 / ブロック20 / アイテム51 / ターン100) を
使い続けるため、保存済みの設定が初期マップとリセット後の再生成に効かない。`ControlApp` は
接続後・かつ `canEditMap` かつ `mapSource.kind === 'random'` のときに一度だけ送る
(`random` 以外で送らないのは、後からコントロール窓を開いたときに選択済みのライブラリ・
エディタのマップを再生成で捨ててしまわないため)。

### マップの「登録」と「使用」の分離

プログラムライブラリと同じ2段階構成にしてある。**アップロードしただけでは対戦に使われない。**

| 役割 | プログラム | マップ |
|---|---|---|
| 管理 (追加・DL・削除) | `ProgramLibraryDialog` (フッター「プログラム管理...」) | `MapLibraryDialog` (フッター「マップ管理...」) |
| 選択 (対戦で使うもの) | `ProgramLibrarySection` (プレイヤーパネル内) | `MapSourceSection` (マップ列内) |

マップの選択は3ソースから行い、サーバーが `MapManager.source` として覚える:

| `kind` | 設定経路 | `requestReset` / `requestRepeat` 後 |
|---|---|---|
| `random` | `set_map_params` | 記憶したパラメータで**引き直す** |
| `catalog` | `load_map {catalogId}` | 選んだマップのまま |
| `editor` | `load_map_data` | 適用したマップのまま |

`refreshForNewGame()` がこの分岐を担う。無条件に `regenerate()` すると、選んだマップが消える。
`random` / `editor` のマップは `/api/maps/save-inline` でライブラリに保存でき、
`/api/maps/export` でそのままダウンロードできる。保存してもソースは切り替わらない。

> **`window.prompt` を使わないこと。** Electron の renderer は `prompt()` を実装していないため、
> 名前の入力はダイアログ内のテキスト入力で受け取る (`MapEditorDialog` / `MapSourceSection`)。

**分類 B をローカルにキャッシュして再送しないこと。** クライアント側の値を setup フェーズに入るたび
re-push していたため、コントロールウィンドウを複数開くと互いの古い値で上書きし合っていた。これらは
`serverStatus` から直接読み、`state.set*` で直接書く。

**バックエンドのゲート条件と UI の表示条件を一致させること。** サーバーが黙って無視するコマンドを
UI が受け付けると「押せるのに何も起きない」状態になる。対応は以下:

| ゲート (`RoundController`) | 対象コマンド | UI 側の扱い |
|---|---|---|
| `canStart()` = `phase==='setup'` | `set_client` / `request_start` | セットアップ画面自体が setup のときだけ描画される |
| `canStart()` = `phase==='setup'` | `set_*_mode` | `SettingDialog` は全フェーズで開けるため、「対戦」タブのチップを `disabled` にし理由を表示する。**UI 側は `setup && roundResults.length===0` とサーバーより厳しく塞ぐ** (試合内でルールが変わるのを防ぐため) |
| `canEditMap()` = `setup && roundResults.length===0` | `load_map` / `set_map_params` / `load_map_data` | `MapSourceSection` の「変更」トリガを `disabled` にする (理由は `StartupDialog` の帯で説明)。プレビューと `MapLibraryDialog` (管理のみ) は選択を伴わないので setup 中は常に出す |
| ゲートなし | `request_reset` / `set_dark_mode` / `set_turn_delay` / `set_tcp_timeout` | `request_reset` は BottomBar に常設 (デモ/リピート/対戦中からの唯一の出口)。`darkMode` と進行パラメータは全フェーズで編集可 (`turnDelay` は `requestStart` 時に値渡しで消費されるため、効くのは次のゲームから) |

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

`NODE_ENV=production` にすると `http/static.ts` が `apps/frontend/dist/` を port 8765 で静的配信します。ポート1つで完結します。

### ビルド依存順序

```
@u15/ws-types  →  @u15/backend
                →  @u15/frontend
                     →  @u15/electron
```

### インストーラーのビルド (ローカルモード)

```bash
pnpm --filter @u15/electron build:win   # → release/ に NSIS インストーラー (win-unpacked も同時生成)
pnpm --filter @u15/electron build:mac   # → release/ に dmg (Apple Silicon のみ)
```

`build:win` / `build:mac` は内部で以下を順に行い、**Node/pnpm も Python も入っていない端末でそのまま動く**単一インストーラーを作る。

1. `@u15/backend` を `esbuild` で `dist/index.js` 単一ファイルにバンドル（`ws`/`busboy`/`@u15/ws-types` を inline 化。node_modules 同梱・pnpm シンボリックリンク解決は不要）
2. `@u15/frontend` を `vite build`
3. `apps/electron/scripts/fetch-python.mjs` が同梱用 Python を取得する。取得元・展開先は `process.platform` で分岐:
   - Windows: python.org の embeddable package (x64) → `apps/electron/vendor/python/`
   - macOS: [python-build-standalone](https://github.com/astral-sh/python-build-standalone) の
     install_only ビルド (aarch64-apple-darwin) → `apps/electron/vendor/python-mac/`
   どちらも初回のみダウンロードし、以降は既存ディレクトリをそのまま使う (キャッシュ)。
4. `electron-builder` が backend/frontend を共通の `extraResources`、python を `build.win.extraResources` /
   `build.mac.extraResources` (`apps/electron/package.json`) でそれぞれ platform 別に同梱してパッケージを作る。
   electron-builder はこの2つを**マージ**する (どちらか一方を採用するのではない) ため、python の
   エントリだけは root ではなく必ず platform 別ブロックに置く必要がある — root に置くと
   Windows 用/mac 用の両方が両プラットフォームのビルドに混入してしまう。

配布版アプリでは、対戦プログラム（Python, 単体 `.py` のみ対応）は同梱の Python で実行されるため、エンドユーザー側で Python をインストールする必要はない（`apps/backend/src/clients/ProcessClient.ts` が `U15_PYTHON_EXE` 環境変数を優先利用。未設定時は開発環境と同じく PATH 上の `python` にフォールバックする）。同梱 Python の実行ファイルパスは `main.ts` が `process.platform` で出し分けてこの環境変数にセットする (Windows: `python/python.exe`、macOS: `python/bin/python3`)。アップロードされたプログラム/マップの保存先も `app.getPath('userData')`（インストール先ディレクトリに依存しない、OS 標準のユーザーデータフォルダ）に固定される。

macOS 版は Apple Developer 証明書での署名・notarization を行っていない。配布先の Mac では
初回起動時に Gatekeeper が確認を求めるため、README の案内 (右クリック→開く) が必要になる。

---

## 10. マルチルーム / Web サービスモード

### ポート設計

| 用途 | ポート範囲 |
|---|---|
| HTTP / WebSocket | 8765 (固定) |
| ローカルモード AI | 2009, 2010 (固定) |
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

テストファイル:

| 範囲 | ファイル |
|---|---|
| ゲーム進行・判定 | `game/GameLogic.test.ts`, `game/GameSystem.test.ts`, `game/Game.test.ts` |
| ServerManager の分割クラス | `game/ServerManager.test.ts`, `game/MapManager.test.ts`, `game/SlotManager.test.ts` |
| ネットワーク | `network/TcpClient.test.ts`, `network/WsServer.test.ts`, `http/router.test.ts` |
| ルーム・カタログ | `RoomManager.test.ts`, `programCatalog.test.ts`, `programName.test.ts`, `mapCatalog.test.ts`, `libTemplates.test.ts` |
| クライアント | `clients/ProcessClient.test.ts` |
| 大会運営 | `tournament/bracket.test.ts`, `league.test.ts`, `standings.test.ts`, `progress.test.ts`, `definition.test.ts`, `TournamentStore.test.ts`, `TournamentOrchestrator.test.ts`, `zip.test.ts`, `exporter.test.ts`, `httpRoutes.test.ts` |

大会運営のテストは実ファイルシステム (`server/tournament`, `server/program-catalog`) と
TCP ポートを共有するため、`apps/backend/vitest.config.ts` で `fileParallelism: false` にしている。
並列実行すると互いの後片付けで消し合う。

`WsServer.test.ts` は `RoomManager` を使ってルーム対応の統合テストを行います。メッセージ受信はバッファ付き `connectWs()` で競合状態を回避しています。

### 単体テスト (Vitest + React Testing Library) — frontend

```bash
pnpm --filter @u15/frontend test
```

`vite.config.ts` の `test` ブロック (environment: jsdom) で設定。テストファイル:

| 範囲 | ファイル |
|---|---|
| フック | `hooks/useTextures.test.ts`, `hooks/useGamePhaseSound.test.ts`, `hooks/usePersistedState.test.ts` |
| 得点・演出のロジック | `lib/decisiveEffect.test.ts`, `lib/roundRow.test.ts`, `lib/resultText.test.ts`<br>競技ルールそのものは `packages/ws-types/src/scoring.test.ts` |
| 大会運営のロジック | `lib/bracketLayout.test.ts`, `lib/bracketSlots.test.ts` |
| コンポーネント | `components/PlayerSidePanel.test.tsx`, `components/tournament/TournamentEditorDialog.test.tsx` |

`vite.config.ts` は `globals` を有効にしていないため、React Testing Library の**自動 cleanup は動かない**。
1つのテストファイルで複数回 `render` する場合は `afterEach(cleanup)` を自分で書くこと
(書かないと前のテストの DOM が残り、`getByLabelText` が多重ヒットして落ちる)。

canvas を多用するコンポーネント (`MapEditorDialog` / `GameBoardCanvas` など) は E2E で既にカバーされているため、フックと純粋ロジック (`lib/`) を切り出した単位でのテストを優先しています。得点表示のようにルールを直接反映する箇所は `PlayerSidePanel.test.tsx` でレンダリング結果まで確認しています。

### E2E テスト (Playwright)

```bash
pnpm test:e2e
# または
node apps/electron/test-e2e.mjs
```

前提: `apps/electron/node_modules/electron/dist/` の実行ファイル (Windows: `electron.exe`、macOS: `Electron.app`) と `apps/electron/dist/`
(`killTree` を読み込むためビルド済みであること)。ポート 5173 を他プロセスが使用していると
Vite dev サーバーの起動検知がタイムアウトするため、事前に空けておくこと。
後始末は `killTree` で木ごと行うため、Vite やバックエンドの残骸は出ない
(「残るプロセス (dev の終了処理)」参照)。

テスト開始時に `localStorage['u15_match_config'].turnDelay = 0` を設定してからページをリロードし、ゲームを高速化します（`ControlApp` は接続後に一度だけこの値をサーバーへ送るため、リロードが必要）。テストは `?room=local&mode=control` で操作します。

手動操作モードのテストは、コントロールウィンドウではなく `?mode=manual` の専用ウィンドウ
(`app.windows()` から取得) に対して入力を送ります。操作パネル `ManualControls` はそちらにしか無いためです。

Electron を Playwright から起動する際は、`app.process()` の stdout/stderr を必ず読み捨てること。
パイプが詰まるとメイン側が停止し、ウィンドウが生成されないままタイムアウトします。

**dev サーバーには `127.0.0.1` でつなぐこと。** `main.ts` の `loadUrl` と、描画側から叩く
`fetch` の両方に効きます。Chromium 側の名前解決が詰まると (Docker Desktop などが DNS に
割り込むと起きる) `http://localhost:5173/` の読み込みが返らず、`BrowserWindow` は
生成されるのに `did-finish-load` が永久に来ない — Playwright からは
「ウィンドウが0個」に見えるため原因が非常に分かりにくい。同じ URL を `127.0.0.1` /
`[::1]` で読むと即座に通るので、切り分けにはホスト名を差し替えて試すのが早いです。

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

---

## 13. 大会運営 (トーナメント / リーグ / 予選リーグ / BOT対戦予選)

大会当日の進行 (組み合わせの読み込み → 対戦カードの割り当て → 結果の反映 → 勝ち上がり) を
サポートする。**トーナメントの1カード = 公式ルールの「試合」= 2ゲーム制の1セット**なので、
勝敗判定は既存の `computeSetResult()` をそのまま使う。

### 13-1. 設計方針

`ServerManager` / `RoundController` / `SlotManager` / `RoomManager` に大会の知識は持たせない。
`TournamentOrchestrator` が**公開 API と `'status'` イベントだけ**を使って外から駆動する。
将来まるごと切り出せるよう、実装は `apps/backend/src/tournament/` に閉じている。

| ファイル | 役割 |
|---|---|
| `definition.ts` | `tournament.json` の手書きバリデータ (日本語のエラーメッセージを返す) |
| `bracket.ts` | 【純関数】参加者 → トーナメントの試合グラフ (標準シード順 / bye / 3位決定戦) |
| `league.ts` | 【純関数】参加者 → リーグの試合グラフ (円卓法で節に分割) |
| `groupStage.ts` | 【純関数】参加者 → 予選リーグ N 本 + 決勝トーナメントの試合グラフ |
| `botStage.ts` | 【純関数】参加者 → BOT対戦予選 (1グループ) + 決勝トーナメントの試合グラフ |
| `qualifiers.ts` | 【純関数】予選の順位表 → 決勝トーナメントの枠・最終決定確認リスト (同点の印つき) |
| `standings.ts` | 【純関数】順位表。`rankBy` で 勝ち点系 / ポイント系 を切り替える |
| `progress.ts` | 【純関数】slot の解決・bye の自動確定・確定の取り消し |
| `autoPlay.ts` | 【純関数】自動進行の「次の一手」と、その前に置く待機時間 |
| `TournamentStore.ts` | 永続化・フォルダ検出・プログラムライブラリへの取り込み |
| `zip.ts` | `node:zlib` だけで動く最小 ZIP 展開 (zip-slip 防御込み) |
| `bundle.ts` | 大会データ + プログラムを `.zip` に固める書き出し |
| `exporter.ts` | 結果の JSON / CSV 書き出し |
| `binding.ts` | 「ある部屋で運営中の大会」1つぶんの状態と、保存を伴う最小の書き換え |
| `matchCommands.ts` | 1試合への運営操作 (準備 / 確定 / やり直し / 不戦勝 / 回戦ごとのマップ) |
| `qualifierCommands.ts` | 決勝進出者の差し替え・削除・確定 |
| `statusBridge.ts` | `ServerManager` の `'status'` を試合の進行へ写す |
| `autoPlayRunner.ts` | 自動進行の予約と実行 (判断は `autoPlay.ts`) |
| `TournamentOrchestrator.ts` | どの部屋でどの大会を運営中かの管理と、配信 |
| `httpRoutes.ts` | `/api/tournament/*` |

試合グラフを読む述語 (`nextReadyMatch` / `isKnockoutMatch` / `isGroupStageDone` /
`blockedByQualifiers` / `nextOperatorAction`) は `@u15/ws-types` の `tournamentFlow.ts` にあり、
バックエンドの進行管理と運営パネルの「今やること」が同じ規則で動くようにしてある。

### 13-2. データの置き場所

```
server/tournament/<大会id>/
├── tournament.json   ← 人が書く。アプリは読むだけで絶対に書き戻さない
├── programs/*.py     ← 参加プログラムの原本
└── state.json        ← アプリが書く進行状態。消せば大会をやり直せる
                        matches   … 試合グラフと結果
                        programs  … participantId → プログラムライブラリのエントリ
                        decisions … 運営が当日下した判断 (マップ差し替え・進出者・確定)
```

`server/program-catalog` / `server/map-catalog` と同じグローバル層に置く。ルームは 30分 TTL で
消えるため、大会データをルームに紐づけて保存してはいけない。

**保存はグローバル (大会単位)、実行はルーム単位** (1大会 ⇄ 1ルームの双方向排他)。

### 13-3. 押さえておくべき不変条件

- **`side 0 = slotA`**: `armMatch` は必ず `slotA → スロット0 (COOL)` で第1ゲームを始める。
  公式ルール「1回目のゲームでは選手番号の小さい選手を先攻」に対応する。第2ゲームは既存の
  `swapSlotConfigs()` が入れ替えるので、`idxForSide(side, round)` により
  `computeSetResult()` の `[0]/[1]` が `slotA/slotB` に一致する。
  なお `RoundResult.playerNames` は入替**後**の順なので、表示には `resolvedA/resolvedB` を使う。
- **`armMatch` の順序**: `requestReset()` → `setDoubleMode()` → `setClientType()` ×2。
  `requestReset` が `resetAllToDefault()` で `processConfig` を消すため、逆順にすると割り当てが失われる。
  また `roundResults` を空にすることで `canEditMap()` / `canStart()` の両ゲートが通る。
- **スロットへ触る前に両者を解決する**: 片方だけ割り当ててから失敗すると
  「COOL だけ準備完了」という中途半端な状態が残る。`resolveSlotConfig()` で先に2人ぶん解決してから
  `setClientType` を呼ぶ。
- **`armed` / `in_progress` は永続化しない前提**: これらはプロセス内のスロット割り当てと対になる
  状態なので、`bind()` のたびに `ready` へ戻す (中断した運営を再開してもカードが詰まらない)。
- **`addCatalogEntry` は渡したファイルを rename する**: 大会フォルダの原本を直接渡さず、
  一時ファイルへコピーしてから渡すこと。登録直後に `setDemoEnabled(id, false)` でデモ抽選から外す。
- **`unbind()` は `ServerManager.requestReset()` を伴う**: 運営中はスロット割り当て・フェーズを
  大会側が握っているため、外さずに運営を終えるとコントロール窓が最後の対戦のフェーズに
  固まったまま手動操作へ戻れない。
- **マップの解決順**: `match.rematchMapCatalogId` → `state.decisions.stageMaps[stage]` (運営中の差し替え)
  → `def.stage.map.bracketStages[stage - 予選の節数]` (回戦ごとの指定) → `def.stage.map.catalogId` (大会全体)。
  **`stage` は予選と決勝を通した通し番号 (combined) で統一する。** 運営中の差し替えも
  `mapForStage` への引数も配信ペイロードの `stageMaps` も全て combined。ゲタを当てるのは
  「定義に書かれた回戦ごとのマップ」の読み出しだけで、そこだけが決勝トーナメント相対
  (作成画面が決勝Tの回戦しか出さないため)。予選を持たない形式ではゲタが 0 になる。
  `TournamentStore.mapForMatch()` / `mapForStage()` に一本化してあるので、判定を各所で書き直さないこと。
  配信ペイロードには解決済みの `stageMaps` を載せるため、UI 側でこの順序を再現する必要はない。
  `catalogId` はこの PC でしか通じないので、運営中の差し替えは配布物 (`tournament.json`) ではなく
  `state.json` に書く (`programs` と同じ二層構造)。
- **`group` の有無が「予選か決勝か」を決める**: `TournamentMatch.group` を持つのは
  `group-then-bracket` の予選リーグの試合だけ。1つの大会に予選と決勝が同居するので、
  「引き分けを確定してよいか」「どの順位表に効くか」「マップを個別指定できるか」は
  **形式ではなく試合ごと**に判定する (`isKnockoutMatch` を参照)。
- **`group-rank` 参照は「そのリーグの全試合」に依存する**: `downstreamOf` はこれを数える。
  数えないと、予選をやり直したときに確定済みの準決勝の `resolvedA/B` だけが別人に
  書き換わり、「戦っていない相手に勝った」という記録ができてしまう。
  巻き戻しで準備済み (`armed`) の試合まで消えたら `armedMatchId` も落とすこと
  (`disarmIfCleared`) — グラフだけ `pending` に戻ると、`onServerStatus` が
  「pending の試合を対戦中にする」という辻褄の合わない遷移をする。
- **解決文脈 (`ResolveContext`) は末尾の省略可能引数**: `resolveMatches` は
  `captureResult` / `confirmResult` / `discardResult` / `setWalkover` / `reopenMatch` から
  内部で呼ばれる。途中に差し込むと既存の呼び出しとテストを軒並み書き換えることになるので、
  必ず末尾に足す。文脈を渡さない呼び出しは空の文脈で動く。
  なお `ctx.groups` が未指定のとき `group-rank` は **known:false** (まだ分からない) に倒す —
  空配列として扱うと参加者0人と読めてしまい、不戦勝として勝手に確定してしまう。
- **自動判定は必ず枠を埋める**: 公式ルールの同点処理でも並びが決まらないことは通常運用で
  起こるが、そこで枠を空けると決勝が始められなくなる。順位表の「位置」で機械的に埋めたうえで
  `tied` / `ambiguous` の印を立て、運営が `tournament_set_qualifier` で差し替えられるようにする。
- **実施順と表示順は別物**: `TournamentMatch.order` は「同一 stage 内の**表示**順」で、
  トーナメント表では決勝 (order 0) が上、3位決定戦 (order 1) がその下に来る。
  一方**実施順は3位決定戦が先** — 決勝を締めくくりにするためで、両者は依存関係が無いので選べる。
  「対戦試合」を出す箇所は必ず `compareByPlayOrder` (`@u15/ws-types`) を使うこと。
  `nextReadyMatch` / `nextOperatorAction` (`@u15/ws-types` の `tournamentFlow.ts`) が
  これを使っており、backend の自動進行と運営パネルは同じ規則で動く。
  なお `resolveMatches` / `downstreamOf` の `stage → order` ソートは依存解決のためのもの。
  ただし**予選リーグでは同一 stage に全リーグの試合が並ぶ**ため、`groupStage.ts` は
  `order = リーグ内の順 × リーグ数 + リーグ番号` としてリーグ間で衝突しないようにしている
  (衝突すると `compareByPlayOrder` が同値を返し、次に実施する試合が不定になる)。

### 13-4. 同点 (`winnerSide === null`) の扱い

`calculateBonusBreakdown` は勝者が定まらない決着では加点しないため、引き分けゲームのポイントは
アイテム×10 のみになる。1勝1敗や2引き分けで合計が並ぶのは**通常運用の範囲**で起こる。

- **リーグ / 予選リーグの試合**: 引き分けは正当な結果。そのまま確定でき、勝ち点1が付く。
- **勝ち上がりの試合**: `confirmResult` は勝者不在のままの確定を**拒否する** (詰み防止)。UI では
  ①マップを変更して再試合 ②審判裁定で勝者を指定 ③両者敗退 の3択を出す。
  固定マップ運用 (その試合の実効マップが `null` でない = `mapForStage()` が返す) では、
  公式ルール「マップを変更して再試合」に従い別マップを指定しないと `discardResult` が通らない。
  大会全体はランダムでも、その回戦だけマップを指定していれば同じ扱いになる。

  **判定は形式ではなく試合ごと** (`isKnockoutMatch`)。`group-then-bracket` では1つの大会に
  予選 (引き分けOK) と決勝 (引き分け不可) が同居する。frontend も同じで、
  `ResultConfirmDialog` の `isLeague` は `awaiting.group !== undefined` で決める。

  **予選の同点は別の問題**: 試合の勝敗ではなく「順位が決まらない」ケース
  (勝ち点・合計ポイント・直接対決まで並ぶ) は再試合の対象ではなく、
  運営が決勝進出者を指名して解決する (13-8)。

### 13-5. WebSocket / HTTP

`FrontendMessage` に `tournament_bind` / `tournament_unbind` / `tournament_arm_match` /
`tournament_confirm_result` / `tournament_discard_result` / `tournament_reopen_match` /
`tournament_set_walkover` / `tournament_assign_program` / `tournament_set_stage_map` /
`tournament_set_qualifier` / `tournament_set_display_view` / `tournament_set_auto_play` /
`tournament_rescan` を追加。失敗は握りつぶさず `error` メッセージで理由を返す。

`tournament_set_stage_map` は運営中に回戦のマップを差し替える (`state.json` へ保存)。
準備済み (`armed`) の試合が同じ回戦なら、その場で `loadMap` し直す — 次の `arm` まで待つと
「変えたのに反映されない」ように見えるため。

`WsMessage` に `tournament_state` (`TournamentStatePayload | null`) を追加し、bind 中の
ルームへ丸ごと配信する。後から開いたウィンドウには、`WsServer.getExtraJoinMessages` という
汎用フック経由で `join_room` 直後にリプレイする (`WsServer` / `LobbyRouter` は「大会」を知らない)。

| エンドポイント | メソッド | 説明 |
|---|---|---|
| `/api/tournament` | GET | 検出済み大会の一覧 |
| `/api/tournament/scan` | POST | `server/tournament/` の再走査 |
| `/api/tournament/import` | POST | 定義 JSON をボディで取り込み |
| `/api/tournament/upload` | POST | `.zip` / `.json` のアップロード |
| `/api/tournament/:id` | GET / DELETE | 詳細プレビュー (`{ state, definition }`) / 削除 |
| `/api/tournament/:id/reset` | POST | 進行状態のみ初期化 |
| `/api/tournament/:id/assign` | POST | プログラムライブラリのエントリをまとめて紐付け |
| `/api/tournament/:id/export` | GET | `?format=json / matches.csv / standings.csv / bundle.zip` |

> **ルーティング順序に注意**: `handleTournamentRequest` は固定セグメント (`scan` / `import` /
> `upload`) を `:id` パターンより先に判定する。逆にすると `id === 'scan'` と解釈されてしまう。

作成 UI (13-7) のために、`GET /api/tournament/:id` は配信用の `state` に加えて生の
`definition` も返す。`bracket.slots` や `program.file` は `TournamentStatePayload` に現れないため、
これが無いと編集画面が元の指定を復元できない。

`POST /api/tournament/import` は `?reset=1` で取り込み後に進行状態を作り直す。
`loadTournament` の噛み合わせ判定 (`stateMatchesDefinition`) は、定義から組み直した試合グラフと
**骨組みの指紋** (`id | stage | order | group | slotA種別 | slotB種別`) を突き合わせる。
participant id だけを見ていた頃は「参加者を変えずにルールだけ変えた上書き」も
「予選のリーグ分けの入れ替え」も素通りしていたが、指紋比較ならその全部が引っかかる。
それでも上書き保存では `?reset=1` を付けること (意図が明示される)。

運営中 (bind 中) の大会に対する `import` の上書きと `assign` は **409 で拒否する**。
オーケストレータが進行状態をメモリに握っているため、裏から `state.json` を書き換えると食い違う。
運営中の割り当ては WS の `tournament_assign_program` を使う。

#### 13-5-1. 大会データの書き出し (`format=bundle.zip`)

`bundle.ts` の `buildTournamentBundle` が **取り込み口へそのまま投げ返せる `.zip`** を組む
(`tournament.json` + `programs/*.py`)。結果の書き出し (`exporter.ts`) とは目的が別 —
あちらは大会後の記録用で、取り込み直せない。

要点:

- **プログラムの実体は2箇所から拾う。** 定義の `program.file` (フォルダ/zip 由来) と、
  `state.programs[].catalogId` → `programCatalog` (作成 UI で割り当てただけの大会)。
  後者を拾わないと、画面で作った大会が「参加者だけの空の zip」になる。書き出す定義では
  どちらも `{ kind:'file', file:'programs/<参加者id>.py' }` に統一する。
- **`state.json` は入れない。** 進行状態はこの PC のライブラリ ID を握っているので、
  持って行っても噛み合わない。移動先ではまっさらな大会として始まる。
- **`.exe` は同梱しない。** `extractZip` の `allowedExtensions` (`.json/.py/.txt/.md`) は
  意図的な防御線で、`zip.test.ts` / `TournamentStore.test.ts` に回帰テストがある。
  ここを緩めて往復を完全にするより、同梱を諦めて運営に知らせる方を選ぶ。
  512KB 超のファイルも同じ理由で外す (**自分の importer が弾く zip を作らない**)。
- 外した理由は `BundleResult.skipped` に日本語一文で積み、`X-Bundle-Skipped` ヘッダに
  `encodeURIComponent(JSON.stringify(...))` で載せる。ダウンロードのレスポンスなので
  本文には混ぜられない。フロントは `<a href>` ではなく fetch + Blob で受けてこれを読む。
- `rules.mapCatalogId` / `rules.stageMaps` はこの PC のマップ ID だが**消さずに残す**。
  見つからない ID は黙って無視される決まり (`definition.ts`) で、消すと元の PC で
  読み直したときに設定が飛ぶ。

ZIP を書く実装 (`zip.writeZip`) は元々テスト用ヘルパー (`test/buildZip.ts`) にあったもので、
本番へ昇格させて `buildZip` はそれに委譲する薄い包みにした。読む側と書く側が同じ
`node:zlib` だけの実装で揃うので、外部の zip ライブラリは今も入っていない。

### 13-6. フロントエンド

| ファイル | 役割 |
|---|---|
| `lib/bracketLayout.ts` | 【純関数】試合グラフ → カード座標と接続線のパス |
| `lib/bracketSlots.ts` | 【純関数】組み合わせ編集のスロット操作 (`autoSlots` / `fitSlots` / 試合数の見積り) |
| `components/FitArea.tsx` | 中身を親の空きいっぱいまで拡大・縮小して中央に置く入れ物 (`useFitScale`) |
| `ui/` | 画面共通の見た目 (色トークン・Button / Card / Dialog / Field / Tabs)。生の色や幕を各画面で書き起こさない |
| `components/tournament/TournamentMode.tsx` | `?mode=tournament` のルート。**大会運営の唯一の入口** |

`components/tournament/` は関心ごとに4つに分かれている。

| ディレクトリ | 中身 |
|---|---|
| `board/` | 表示部品。観客席 (`DisplayMode`) と運営席が共用する |
| `panel/` | 運営パネル。「今やること」+ 3タブ |
| `qualifier/` | 決勝進出者の確認と差し替え |
| `editor/` | 大会データの作成・編集フォーム (13-7) |

| ファイル | 役割 |
|---|---|
| `board/BracketView.tsx` | トーナメント表。接続線は SVG、カードは絶対配置の DOM |
| `board/LeagueTable.tsx` | リーグの星取表 + 順位表 (素の DOM)。予選では**そのリーグの試合・参加者だけ**を渡す |
| `board/QualifyingView.tsx` | 予選の表 ⇄ 決勝トーナメント表の切り替え。観戦画面の出し分け (`displayQualifyingPhase`) もここ。**位相の判断は予選リーグ / BOT対戦予選で共通** |
| `board/BotStageBoard.tsx` | BOT対戦予選の表。エントリーリスト + 順位リスト (終わった人だけ載る) |
| `board/MatchCard.tsx` | 1試合のカード。3画面で共用 (`interactive` で操作の有無を切替) |
| `board/TournamentStandby.tsx` / `TournamentFinale.tsx` | 観客席の待機画面と表彰画面 |
| `panel/TournamentPanel.tsx` | 運営パネルの骨格。「今やること」を固定し、下をタブで切り替える |
| `panel/NextActionCard.tsx` | 「今やること」1枚。`nextOperatorAction` の返り値をそのまま描く |
| `panel/LibraryTab.tsx` / `ProgressTab.tsx` / `SettingsTab.tsx` | 各タブの中身 |
| `panel/ResultConfirmDialog.tsx` | 結果確定。同点時の3択を出す |
| `qualifier/QualifierSection.tsx` | 決勝進出者の一覧と差し替え (予選リーグ。`QualifierPicker` は表のカードからも使う) |
| `qualifier/BotQualifierSection.tsx` | 決勝進出者の最終決定確認リスト (BOT対戦予選。多めに出して削る) |

**運営パネルは「今やること」を1枚だけ出す。** 状況に対して押すべきものは
`nextOperatorAction` (`@u15/ws-types`) で1つに定まるので、パネルはそれを描くだけで
判定を持たない。設定・一覧・巻き戻しはタブの下に置き、進めるだけなら触らせない。

大会の状態は `useGameState` が `tournament_state` を受けて保持する
(「サーバーが返す状態はクライアントにキャッシュしない」方針 = 分類 B。localStorage には置かない)。
新しいフックを作らないのは、control 画面で WebSocket が2本になるのを避けるため。

**ブラケット描画をハイブリッドにした理由**: Canvas だと DPR 対応・テキスト省略・当たり判定を
全部自前で書くことになり、静的な図には割に合わない。DOM だけだと bye や回戦数の変化で
接続線が破綻する。線だけ SVG にすれば両方の問題が消える。

**観客に見せるための拡大 (`fit`)**: `BracketView` / `LeagueTable` に `fit` を渡すと、
`FitArea` (= `useFitScale`) が親の空きに合わせて図ごと `transform: scale()` する。
文字サイズだけを上げないのは、カード幅・接続線・余白との比率が崩れ `bracketLayout` の
座標計算にも手を入れることになるため。**`fit` の親は高さの決まった箱にすること** —
中身を絶対配置で流れから外すので、親が `height:auto` だと高さ 0 になって何も見えない。
`transform` はレイアウトサイズに影響しないので「拡大 → 再測定 → さらに拡大」の循環は起きない。
リーグ表は `fit` のとき星取表と順位表を横に並べる (縦積みだと高さで頭打ちになる)。

**星取表の並びはエントリー順で固定**: 行・列は `participants` (= seed 順) をそのまま使う。
順位順に並べ替えると、試合が確定するたびに表の行が動いて観客も運営も同じプレイヤーを追えなくなる。
順位で並ぶのは下段の順位表だけ。

**これから行う試合の強調**: `armedMatchId` (「この試合を準備」で確定) を
`BracketView.upcomingId` / `LeagueTable.upcomingMatchId` に渡すと、該当カード・該当セルが
金色になる。運営席 (`?mode=tournament`) と観戦席 (`?mode=display`) の両方で同じ見え方にする。

### 13-7. 大会データ作成 UI

`TournamentEditorDialog` は **`tournament.json` をフォームで書くための道具**であって、
独自の保存経路を持たない。保存先は既存の取り込み口 `POST /api/tournament/import` なので、
手で書いた JSON・zip で取り込んだ大会と出来上がるものは完全に同じ。新しい大会形式を
足すときは、まず `definition.ts` のスキーマを広げてからこの画面に項目を足す。

**プログラムの割り当てを定義に書かない理由**: プログラムライブラリの `catalogId` は
その PC の `server/program-catalog` でしか通じない。配布物である `tournament.json` に
書くと別の PC で壊れるので、`POST /api/tournament/:id/assign` 経由で `state.json` 側へ保存する。
一方 `{ builtin: 'cpu' }` と `{ file: ... }` は移植できるので定義に残す。
編集時は `GET /api/tournament/:id` の `state.participants[].programCatalogId` から復元する。
別の PC へ持ち出すときは、この割り当てを `program.file` に焼き直してプログラムの実体ごと
固める書き出し (13-5-1) を使う。

**プレイヤー名の初期値 (`CatalogEntry.declaredName`)**: 参加者の名前欄は、プログラムを
選んだときにプログラム自身が名乗る名前で埋まる。抽出は backend の `programName.ts`
(`extractDeclaredName`) が担当し、`Client(name='…')` の文字列リテラル →
argparse の `--name` の `default` の順に見る。Python はパースせず、雛形
(`assets/lib-templates/pyCHaser.py`) の使われ方に合わせた正規表現で拾うだけ。
拾えなければ `undefined` で、名前欄は空欄のまま手入力に任せる。

> **雛形のままの `default='player'` も除外せずそのまま採用する。** 実際にスコアバーへ
> 出るのがその値である以上、隠すと表示と実態が食い違う。

`declaredName` は `index.json` に保存しない。JSON は `undefined` を落とすので
「名前が無い」ことを保存できず結局毎回読み直すことになるため、`listCatalogEntries` /
`getCatalogEntry` / `addCatalogEntry` で都度パースする方に統一している
(対象は数十件の小さな `.py` で、カタログを引くのはダイアログを開いたときだけ)。
名前の整形は TCP 経路と同じ `sanitizeName` (`network/TcpClient.ts`) を通し、
どちらの経路でも表示がブレないようにする。

上書き規則は `selectProgramAt` にある。`DraftParticipant.nameFromProgram` に
「自動で入れた値」を控えておき、`name` がそれと一致している間だけプログラムの
選び直しに追従させる。一度手で書き換えたら一致しなくなるので、以後は上書きしない。
名前を持たないプログラムへ替えたときは、選んでいないプログラム由来の名前が残らないよう
空欄へ戻す。`nameFromProgram` は保存対象ではない (`buildDefinition` は `name` しか見ない)。

**シード配置の共有**: 「手動で指定する」の初期値は、サーバーが自動生成するのと
寸分違わぬ並びでなければならない。そのため `seedOrder` / `bracketSizeFor` / `stageCountFor` /
`stageLabel` / `autoGroupAssign` / `groupLabel` / `slotPlaceholder` は
`@u15/ws-types` (`tournament.ts`) に置き、
`apps/backend/src/tournament/bracket.ts` はそこから re-export している。二重定義すると必ずズレる。

**回戦ごとのマップ**: 「ルール」欄の下に回戦ぶんのセレクトを出し、`stage.map.bracketStages`
(`null` は大会の設定に従う) として保存する。回戦数はトーナメントなら参加者数
(`stageCountFor(参加者数)`)、予選ありなら進出者数 (`draft.bracketStageCount`)
で決まるので、人数を減らして回戦が減ったら余った指定は保存しない。
**予選ありのとき index は決勝トーナメント相対** (0 = 決勝Tの1回戦)。予選の節は
「大会の設定」に従うだけなので画面に出さない (節数の算出を frontend に二重定義しないため —
運営画面では backend が配る `stageLabels` を使う)。
3位決定戦は決勝と同じ stage なので決勝と同じマップになる。
運営中は編集画面が開けないため、差し替えは運営パネル (`tournament_set_stage_map`) から行う。
リーグの節には用意していない (節数の算出を frontend に二重定義することになるため)。

**参加者 id の扱い**: 表示順がそのまま `seed` (選手番号 = 第1ゲームの先攻順) になる。
新しい行には `p01`, `p02`, … を採番するが、**既存の大会を編集するときは元の id を必ず保つ**。
`state.json` の `programs` マップと `bracket.slots` が id で参照しているため。

**別名保存**: 編集中に「別名で保存」を押すと大会ID に空いている `<元のid>-2` が入る。
保存先は同じ `POST /api/tournament/import` で、新しいフォルダを作るだけなので
**元の大会の進行状態には触れない** (`?reset=1` を付けない)。去年のデータを土台に
今年のを作る / 予選の組み分けだけ変えた案を残す、といった使い方を想定。

**大会ID の変更 (改名)**: 大会ID 欄は新規作成でも編集でも入力できる。編集中に
「別名で保存」を使わずID を書き換えると改名で、`POST /api/tournament/import?reset=1&from=<旧id>`
を投げる。バックエンドは**取り込む前にフォルダごと `fs.rename` する**
(`TournamentStore.renameTournament`)。

> **新しい id で取り込んで古いフォルダを消す作り方にしないこと。** 定義に書ける
> `program: { kind: 'file', file: 'programs/x.py' }` の実体はフォルダの中にあり、
> 作り直すと付いてこない ⇒ `syncPrograms` が「プログラムが見つかりません」を出す。

改名の拒否条件は改名を実行する前に判定する (どちらの大会も壊さない):
新旧どちらかが運営中なら 409、改名先が既にあれば 409、id が不正なら 400。
`state.json` の `tournamentId` は `readState` が引数の id で上書きするので触らない。

### 13-8. 予選のある形式 (`group-then-bracket` / `bot-then-bracket`)

予選を行い、その上位が決勝トーナメントへ勝ち上がる2形式。予選の中身 (リーグの総当たりか、
運営BOT との1試合か) と順位の付け方だけが違い、**試合グラフ・決勝進出者の確定・観戦画面の
出し分けは完全に共通**の骨格に乗る。共通部分を先に、形式ごとの差分をあとに書く。

#### 形式の判定は述語を通す (最重要)

`format` の比較を直に書くと、あとから足した形式が黙って別の枝へ落ちて事故になる。
「予選がある」の意味で書く判定は**必ず `hasQualifying`** を通すこと — ここを
`format === 'group-then-bracket'` と書くと、BOT対戦予選が決勝進出者の確定ゲートを
素通りして決勝が始まってしまう。

| 述語 | true になる形式 | 「何が言いたいか」 |
|---|---|---|
| `hasQualifying` | `group-then-bracket` / `bot-then-bracket` | **予選がある** = 決勝進出者の確定を挟む |
| `hasBotStage` | `bot-then-bracket` | 予選が**BOT対戦**である。順位の付け方・予選マップ・表の分岐だけ |
| `hasBracket` | `single-elimination` / 予選のある2形式 | 勝ち上がりの表を持つ |

予選リーグ固有のもの (星取表・リーグ数・所属リーグ) は `format === 'group-then-bracket'` で
直に分ける。`StageRules` が判別共用体なので、この比較でその形式にしかない項目へ辿れる。

#### 試合グラフは1本にまとめる

```
stage 0 … g-1     予選の各節 (全リーグが同じ stage を共有。group を持つ)
stage g … g+b-1   決勝トーナメントの各回戦 (group は undefined)
```

id は予選が `G1-D1M1` (Gリーグ番号-D節-M試合)、決勝が `SF1` / `FINAL` / `THIRD`。
**予選が必ず先の stage に来る**ことが、`resolveMatches` が `group-rank` を単一パスで
解ける根拠になっている。この並びを崩さないこと。

#### 拡張点は `MatchSlotRef`

```ts
| { kind: 'group-rank'; group: number; rank: number }   // 「Aリーグ 1位」
```

これ1種類を足すだけで、既存の slot 解決・bye の自動確定・下流の巻き戻しがそのまま効く。
`resolveSlot` は `ResolveContext`（リーグの顔ぶれ・勝ち点・運営の差し替え）を見て解く。
**リーグの試合は `byId` から取ること** — 引数の配列をそのまま見ると、このパスで bye が
自動確定したぶんや、組み立て直後で `resolvedA/B` がまだ空の状態を読んでしまう。

#### 予選リーグ (`group-then-bracket`)

予選を N リーグ (既定2) の総当たりで行い、各リーグの上位 M 名 (既定2) が決勝トーナメントへ
勝ち上がる。

##### 1回戦のクロス配置

決勝の1回戦は「(順位昇順, リーグ番号昇順) をシード1..N として `seedOrder` で並べる」だけ。
2リーグ×上位2なら シードは `A1,B1,A2,B2` → `seedOrder(4)=[1,4,2,3]` → `A1,B2,B1,A2` と並び、
準決勝が **A1-B2 / B1-A2** という定石の配置になる。専用の組み合わせロジックは持たない。

> 3リーグ以上では1回戦で同リーグ同士が当たる組み合わせが出うる。既定の2リーグでは起きない。
> 起きた場合は運営が枠を入れ替えて回避できるので、専用の回避ロジックは入れていない。

その順位に届く人数がいないリーグの枠は、**組み立ての時点で `bye` にする**。
`group-rank` のまま残すと順位表に行が無く、`loadTournament` の中で落ちる。

##### 決勝進出者の自動判定と手動差し替え

`qualifiers.ts` が `QualifierSlot[]` を作り、配信ペイロードに載せる。

| フラグ | 意味 |
|---|---|
| `pending` | 予選がまだ終わっていない |
| `tied` | 順位表でこの順位が同着 |
| `ambiguous` | 同着が「上がる/上がらない」の境目をまたいでいる = 運営が決めるべき |
| `bye` | 参加者が足りずこの枠は不戦 |

`ambiguous` は「最後の枠と、その次の人が並んでいる」ときだけ立てる。上位内だけで
並んでいる (両方上がる) のは運営が決めることが無いので `tied` だけ。

手動指定は `state.json` の `decisions.qualifiers`（キーは `"<group>:<rank>"`）へ。
`decisions.stageMaps` と同じ二層構造で、配布物の `tournament.json` は書き換えない。
`tournament_set_qualifier` は次を拒否する:

- そのリーグの所属でない人
- 差し替えた**あと**の顔ぶれで重複が出る場合 (自動判定は位置で埋まるので玉突きが起きる)
- その枠を使う1回戦が準備中・対戦中のとき (先にリセットしてもらう)
- 実施済みのとき (`cascade` を付ければ結果ごと巻き戻して差し替える)

読み込み時に、今の定義から見て意味を失った指定は黙って捨てる。残すと `armMatch` が
「参加者が見つかりません」で落ちる — しかも本番の対戦直前に落ちる。

#### 観戦画面に何を出すか

`displayView` (`'auto' | 'groups' | 'bracket'`) を運営パネルから切り替える。
`armedMatchId` と同じくプロセス内の状態で、`state.json` には残さない。

**運営席 (`?mode=tournament`) のタブとは連動させない。** 観客には予選表を出したまま、
手元で決勝の組み合わせを確認したい場面があるため、運営席のタブはローカル state のまま、
観戦画面はサーバー配信の `displayView` だけを見る。`QualifyingView` は `phase` を
渡されたらそれに従い、渡されなければ自前のタブと自動追従で動く。

`'auto'` の解決は `displayQualifyingPhase` (純関数。配信された state だけで決まるので、
どの窓で開いても・いつ開いても同じ画面になる):

- 予選が終わっていない → 予選表
- **予選が終わっても自動では決勝表へ移らない。運営が決勝進出者を確定する
  (`qualifiersConfirmed`) まで予選の最終結果を出し続ける** (`holdingResult: true` →
  `TournamentStandby` の見出しが「予選リーグ 最終結果」になる)
- 確定済み → 決勝トーナメント表
- 全工程が終わったうえで決勝側を見ていれば表彰画面 (`shouldShowFinale`)

> **時間では切り替えない。** 運営が同点の枠を見直す前に画面が進んでしまい、
> 確認を挟む意味が無くなるため。

#### 決勝進出者の確定

`tournament_confirm_qualifiers` → `TournamentOrchestrator.confirmQualifiers`。
`state.json` の `decisions.qualifiersConfirmed` に持つ (運営の判断なので `armedMatchId` のような
プロセス内状態ではなく、再起動しても残す)。

不変条件が2つ:

- **予選が終わっていない間は必ず false。** 配信時に `qualifiersConfirmedOf` が
  `isGroupStageDone` と AND を取り、`commit()` は予選が未完了に戻った時点で
  保存値も落とす。**試合を書き換える経路はすべて `commit()` を通る**ので、
  巻き戻しの種類 (reopen / discard / walkover / cascade) ごとに書かなくてよい。
- **確定するまで決勝トーナメントの試合は `armMatch` できない** (日本語エラー)。
  自動判定は必ず枠を埋めるので、関門が無いと同点の枠を誰も見ないまま決勝が始まる。
  予選の試合は確定前でも準備できる。

確定後の `setQualifier` は確定を外さない — 決勝表を出したまま差し替えを反映させたい
場面 (組み合わせを見て気づく) があり、そこで観客席が予選表へ戻ると混乱するため。

**表彰画面は決勝トーナメントだけを出す** (`TournamentFinale`)。予選の試合を混ぜると
`bracketLayout` が節ごとに列を作り、列見出しが「Aリーグ」になって表が壊れる。
予選の最終結果は運営パネルから `'groups'` を選べばいつでも出せる。

##### リーグ表の並べ方

予選リーグを横に並べるとき、**リーグごとにプレイヤー数が違うと星取表の高さが変わり、
その下の順位表の位置がずれる。** `LeagueTable` に `gridCells` を渡すと、まとめる div を
外して「見出し / 星取表 / 順位表」の3つの塊をそのまま返すので、呼び出し側の CSS グリッド
(3行 × リーグ数列、`grid-auto-flow: column`) の行にそろう。
**`grid-auto-flow` を `column` にすること** — 既定の `row` だと1リーグぶんの3つが
横に並んでしまい、見出しと表が入り乱れる。

凡例 (○ 勝ち / △ 引き分け / ● 負け) は星取表のすぐ下に置く。順位表の下だと何の記号の
説明なのか離れて分かりにくい。「未消化」は表の `・` を見れば分かるので載せない。

##### 通過ラインの強調

順位表は **決勝トーナメントへ上がる順位までを金色にし、その直下に線を引く**
(`LeagueTable.advanceCount` ← `advancePerGroupOf(stage)`)。1位だけを金色にすると、
予選でいちばん知りたい「あと1つ上がれば通過」の境目が観客にも運営にも見えない。
色だけに頼らないよう「上位 N 名が決勝トーナメントへ進出」の注記を表の下に添える。
予選を持たない単独リーグでは `advanceCount` を渡さず、1位 (優勝者) だけを金色にする。

塗る対象は既定では**順位表の位置**。予選の途中は枠 (`qualifiers`) がまだ埋まっていない
(`pending`) ので、枠を見て塗ると通過圏が消えてしまう。運営が枠を手で差し替えたリーグだけ
`QualifyingView` が `qualifiedIds` に実際に上がる人を渡し、色をその人へ移す。
**通過ラインの位置 (線) は差し替えがあっても動かさない** — 線は順位の境目であって、
誰が上がったかとは別の情報だから。


#### BOT対戦予選 (`bot-then-bracket`)

運営が用意した1つの BOT を基準器として、全参加者が**同一 BOT・同一マップ**と1試合ずつ戦い、
獲得ポイントで順位を付ける形式。予選の試合数が参加者数と等しくなる (総当たりは nC2 で爆発する)。

##### 予選を「1グループの予選」として組む

これが設計の要。BOT対戦予選の全試合を `group: 0` / `stage: 0` に置くと、
予選リーグのために作った機構がまるごと再利用できる:

```
stage 0     予選 (参加者ごとに BOT と1試合。group は常に 0)
stage 1..   決勝トーナメントの各回戦 (group は undefined)
```

| 再利用できるもの | 変更 |
|---|---|
| `MatchSlotRef` の `group-rank` による1回戦の参照 | なし |
| `progress.resolveMatches` / `downstreamOf` / `isKnockoutMatch` | なし |
| `groupStageCount` / `isGroupStageDone` | なし (`group` の有無で数えているため) |
| `qualifiers.computeQualifiers` / `TournamentStore.resolveStageMaps` | 引数を足しただけ |
| `buildBracket(..., { firstRoundRefs, stageOffset })` | なし |

試合 id は `B-M1` … `B-Mn`。`buildBotStage` (`botStage.ts`) が予選と決勝を1本にして返す。

`groupCount` は持たない (常に1グループ)。進出人数は **`advanceCount`** という名前で、
予選リーグの `advancePerGroup` (各リーグから上がる人数) とは意味が違う。
予選が1グループなので値としては一致するため、両者をまとめて読みたい箇所では
`advancePerGroupOf(stage)` を使う。

##### BOT は予約 id を持つ合成参加者

`TournamentDefinition.participants` には**入れない**。エントリー数・順位表・決勝トーナメントから
自動的に外すためで、代わりに `resolveParticipants` が配信ペイロードの `participants` にだけ
`BOT_PARTICIPANT_ID` (`'__bot__'`) を末尾に合成する。

```
stage.bot.program → syncPrograms → state.programs['__bot__'] → resolveParticipants
                                                                   ↓
                        試合の slot は普通の { kind: 'participant' } でこの id を指す
```

おかげで `armMatch` / `MatchCard` / `BracketView` / `exporter` は**BOT を知らないまま動く**
(どれも `participants` から id 引きしているだけ)。`ResolvedParticipant.isBot` は表示の印
(🤖) と、順位表から外す判定にだけ使う。

BOT のプログラムは参加者と同じ二層構造 — 同梱ファイル (`file`) は `tournament.json`、
ライブラリ割り当ては `state.programs` (`/api/tournament/:id/assign` に `__bot__` を渡す)。

##### 順位は 合計ポイント → 一撃 → アイテム

`computeStandings` の `rankBy` で切り替える。

| `rankBy` | 使う形式 | 並べ方 |
|---|---|---|
| `'league-points'` (既定) | `league` / `group-then-bracket` | 勝ち点 → 合計ポイント → 直接対決 (公式ルール) |
| `'total-points'` | `bot-then-bracket` | 合計ポイント → 一撃ボーナス → アイテムポイント |

**`'league-points'` は1ビットも変えていない。** 公式ルールがタイブレークの連鎖を定めているので、
`'total-points'` はその外側に足した別系統。全員が BOT としか戦わない以上「直接対決」は
成立しないため、代わりに合計ポイントの内訳で割る。

内訳 (`StandingRow.itemPoints` / `strikePoints` / `sweepPoints`) は `m.result.roundResults` から
積む。`set` は不戦勝で `null` になるが `roundResults` は必ずあるため。side → team-index の
引き直しは `scoring.ts` の `roundItemPointsFor` / `roundStrikeBonusFor` / `roundSweepBonusFor`
に閉じてある (再実装しないこと)。

`totalPoints` の算出元は `set.totals` のまま — 既存の順位計算を動かさないため。

##### 決勝進出者は「多めに出して削る」

予選リーグの枠ごとの差し替え (`decisions.qualifiers`) とは別に、**除外リスト**
(`TournamentState.decisions.exclusions`) を持つ。

```
computeQualifierCandidates → 上位 advanceCount 人 + その最下位と同順位の人 全員
                                    ↓ 運営が ✕ を押す
tournament_exclude_qualifier { participantId, excluded, cascade? }
                                    ↓
qualifiers.autoPick が「除外を除いた並びの rank 番目」を返す
   → computeQualifiers と progress.resolveGroupRank の両方に一度で効く
```

`autoPick` 1箇所に閉じているので、除外の反映漏れが構造的に起きない。

**`confirmQualifiers` は同点が残っていても通す。** 自動判定は必ず決定的に枠を埋めるので
決勝は始められるし、ここで弾くとオートプレイ (順位表の並び順で自動確定する仕様) が止まる。
「人数を合わせてから押す」の誘導は `BotQualifierSection` (フロント) の役目。

除外で顔ぶれが変わる決勝トーナメントの試合は、`setQualifier` と同じく `cascade` 確認を
挟んで巻き戻す (`TournamentOrchestrator.setQualifierExclusion`)。

##### 予選のマップ

`stage.bot.map`。`resolveStageMaps` は予選 stage (`stage < offset`) では基本 `null` を
返すが、BOT対戦予選だけここを返す。解決順は

```
運営中の差し替え (decisions.stageMaps) → stage.bot.map → stage.map.catalogId → ランダム生成
```

**`definition.ts` は `stage.bot.map` と `stage.map.catalogId` の両方が未指定なら弾く** —
参加者ごとに違う盤面になると、ポイントで順位を付ける前提が崩れるため。
マップ ID の存在チェックはしない (他の PC で書かれた `tournament.json` を読めなくしない)。

`setStageMap` は BOT対戦予選の stage 0 を許すが、**予選の試合が1つでも確定済みなら拒否する**。

##### フロントエンド

| ファイル | 役割 |
|---|---|
| `QualifyingView.tsx` | 予選 + 決勝の全体像。**位相の判断 (`autoQualifyingPhase` / `displayQualifyingPhase` / `shouldShowFinale`) は両形式で完全に共通**で、差し替わるのは予選ボードだけ。分けると片方だけ確定待ちを実装し忘れる |
| `BotStageBoard.tsx` | 予選の表。エントリーリスト (左) + 順位リスト (右)。**順位リストには終わった人だけを載せる** — 予選が進むにつれ伸びるのがこの画面の要点で、未実施を0ポイントで並べると通過ラインが動かなくなる |
| `BotQualifierSection.tsx` | 最終決定確認リスト。定員を超えている間は確定ボタンを無効化する |

##### オートプレイ

`nextAutoPlayAction` は予選のある形式なら、ボーダーが同点でも順位表の並び順で自動確定して
完走する。無人展示で止まらないことを優先した判断で、同点を人が決めたい本番では
予選が終わったところで自動進行を切る運用にする。

### 13-9. オートプレイ (自動進行 / デモモード)

運営が押していた操作をバックエンドが順に代行し、大会を最後まで進める。用途は
無人展示とリハーサル — **観客が見て分かること**が目的なので、画面が切り替わるたびに
数秒ずつ間を置く。

```
この試合を準備 (arm) → ゲームスタート → (2ゲーム制なら) 第2ゲームへ → 結果を確定 → 次の試合
```

**`ServerManager` のデモモード (`demoMode` / `repeatMode`) とは別物。** あちらは
ライブラリからランダムに2つ選んで延々と対戦させるもので、大会運営中は
`TournamentOrchestrator` が常に打ち消している (勝手に次の対戦を始めてしまうため)。
大会側の自動進行はこの節のオートプレイだけで、組み合わせも結果も大会データに従う。

#### 判断は純関数、予約と実行だけがオーケストレータ

`autoPlay.ts` の `nextAutoPlayAction()` は「今の状態から見て次にやること」を1つ返すだけで、
状態遷移を持たない。判定の優先順は次のとおり:

1. 確定待ちの試合 → `confirm` (勝ち上がりの同点だけは `pause`)
2. 準備済みの試合 → `start` / `next-round` (対戦中・接続待ちの間は `null`)
3. 予選が終わっている → `confirm-qualifiers`
4. 実施できる試合がある → `arm` (`nextReadyMatch` = 手動操作と同じ実施順)
5. 全試合が終わった → `restart` (デモモード) / `finish`

- **予約は常に高々1つ。予約したときと発火したときの2回、同じ純関数を通す。**
  待っている数秒の間に運営が手で操作しているかもしれないので、予約した内容を
  そのまま実行してはいけない。食い違っていたら、今の状態に合う一手を
  改めて (その一手ぶんの待機時間で) 予約し直す。
- **予約は `publish()` から行う。** 状態が変わる操作はすべて `publish()` を通るので、
  操作ごとに予約を書いて回ると必ず1つ書き漏らす。`ServerManager` の `'status'` は
  publish しない経路があるので、`onServerStatus` の末尾でも保険で叩く
  (予約済みなら何もしないので二重予約にはならない)。
- **失敗したら理由を添えて止める** (`autoPlay.stoppedReason`)。同じ操作を延々と
  再試行すると、運営が気づかないまま止まっているのと変わらない。

#### 自動では決めないこと

**勝ち上がりの試合が同点になったら止まる。** 公式ルールでは「マップを変更して再試合」か
審判裁定で、どちらも運営の判断だから (13-4)。判定は形式ではなく試合ごと
(`isKnockoutMatch`) なので、`group-then-bracket` の予選の引き分けはそのまま確定して進む。

`isKnockoutMatch` は `progress.ts` にある (オーケストレータと `autoPlay.ts` の両方が
使うため。`autoPlay.ts` からオーケストレータを参照すると循環 import になる)。

#### デモモード (`loop`) のやり直し

全試合が終わると表彰画面をしばらく出したあと、`restartForLoop()` が進行状態を作り直す。

- `resetTournamentState()` は**使わない**。あちらは `state.json` を読み直すが、
  運営中は進行状態をオーケストレータがメモリに握っているので食い違う。
- 残すもの: `programs` (プログラムの紐付け)、`decisions.stageMaps` (回戦ごとのマップ) —
  進行ではなく運営の設定なので、繰り返しのたびに消えると設定し直しになる。
- 捨てるもの: 試合の結果、`decisions` の進出者まわり — どれも
  今回の結果に紐づくもので、次の周では意味を持たない。
- 盤面も `requestReset()` で戻し、最初の回戦のマップを読み直す (bind 直後と同じ絵にする)。

#### 待機時間

`DEFAULT_AUTO_PLAY_DELAYS_MS` (`autoPlay.ts`)。**視認性のための間なので、詰めると
この機能の意味が消える。**

| キー | 既定 | 何を見せている時間か |
|---|---|---|
| `arm` | 6s | 直前の試合の結果 (表の中で強調されている) |
| `start` | 5s | これから戦う2人とマップ |
| `nextRound` | 6s | 2ゲーム制の第1ゲームの結果 |
| `confirm` | 8s | 対戦の最終結果 |
| `qualifiers` | 12s | 予選リーグの最終順位 (確定するまで観戦画面はこれを出し続ける) |
| `restart` | 20s | 表彰画面 |

テストからは `OrchestratorDeps.autoPlayDelaysMs` で縮められる。**`arm` だけは
ある程度残すこと** — 0 にすると、確定や決勝進出者の確定を見届ける前に
次の対戦が始まってしまい、アサーションが競走する。

---
