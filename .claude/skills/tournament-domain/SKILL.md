---
name: tournament-domain
description: 大会運営 (トーナメント / リーグ / 予選リーグ / BOT対戦予選) の不変条件と、壊しやすい前提。apps/backend/src/tournament、apps/frontend/src/components/tournament、packages/ws-types/tournament*.ts を触るとき、新しい大会形式を足すとき、進行や決勝進出者まわりのバグを追うときに読む。
---

# 大会運営ドメイン

**このファイルは経緯を残す。** 以下の決まりはどれも、破ると壊れることが分かっている形。
「なぜそうなっているか」を消すと、次に触る人が善意で元に戻してしまう。

全体像は `docs/developer-manual.md` §13。ここには**踏むと痛い前提**だけを書く。

## 形式の判定は述語を通す

`format` の直比較を書くと、あとから足した形式が黙って別の枝に落ちる。

| 述語 (`@u15/ws-types`) | true | 意味 |
|---|---|---|
| `hasQualifying` | `group-then-bracket` / `bot-then-bracket` | 予選がある = 決勝進出者の確定を挟む |
| `hasBotStage` | `bot-then-bracket` | 予選が BOT対戦である |
| `hasBracket` | `single-elimination` + 予選のある2形式 | 勝ち上がりの表を持つ |

> **かつて `hasGroupStage` (予選リーグ専用) という述語があり、`hasQualifying` と
> 取り違える事故が起きやすかった。** 前者で書くべき所を後者で書くと、BOT対戦予選が
> 決勝進出者の確定ゲートを素通りして決勝が始まってしまう。今は削除してあり、
> 予選リーグ固有の分岐は `stage.format === 'group-then-bracket'` と直に書く
> (`StageRules` が判別共用体なので、その形式にしかない項目へ型で辿れる)。

## 「予選か決勝か」は形式ではなく試合ごと

`TournamentMatch.group` を持つのが予選の試合。1つの大会に予選と決勝が同居するので、
次の3つは**試合を見て**決める。

- 引き分けをそのまま確定してよいか (`isKnockoutMatch`)
- どの順位表に効くか
- マップを個別指定できるか

**`bot-then-bracket` の予選も `group: 0` を持つ。** 「1グループの予選」として組むことで、
予選リーグのために作った機構 (group-rank 参照・stage のゲタ・巻き戻しの依存追跡) が
まるごと再利用できる。これは設計の要なので崩さないこと。

## 3位決定戦は決勝より先に実施する

`order` は「同一 stage 内の**表示**順」で、トーナメント表では決勝が上・3位決定戦が下。
**実施順は逆**で、決勝を大会の締めくくりにするため 3位決定戦を先に案内する
(`compareByPlayOrder`)。両者に依存関係が無いから選べる順序。

**実施順と表示順は別物。** `order` を入れ替えて解決しようとしないこと。

## 試合グラフを読む述語は共有する

`packages/ws-types/src/tournamentFlow.ts` に集めてある。

```
nextReadyMatch / isKnockoutMatch / groupStageCount / isGroupStageDone
blockedByQualifiers / nextOperatorAction
```

バックエンドの進行管理・自動進行と、運営パネルの「今やること」が同じ規則で動くための場所。
UI 側で「ready のうち実施順が最も早い試合」を組み直したり、arm のゲートを再実装したりしない。

## 決勝進出者の確定

- **自動判定は必ず枠を埋める。** 順位表の「位置」で機械的に決めるので、同点でも決勝は始まる。
  枠を空けると詰むため。同点には `tied` / `ambiguous` の印を立てて運営に見せる
- **確定するまで決勝トーナメントの試合は arm できない** — 関門が無いと、同点の枠を
  誰も見ないまま決勝が始まる
- **予選が終わっていない間、確定フラグは必ず false に倒す。** 配信時に
  `isGroupStageDone` と AND を取り、`commit()` が予選未完了に戻った時点で保存値も落とす。
  **試合を書き換える経路はすべて `commit()` を通る**ので、巻き戻しの種類
  (reopen / discard / walkover / cascade) ごとに書かなくてよい
- **`confirmQualifiers` は同点が残っていても通す。** ここで弾くとオートプレイが止まる。
  「人数を合わせてから押す」の誘導はフロント側の役目

同点の直し方は形式で違う。予選リーグは枠ごとの差し替え (`decisions.qualifiers`)、
BOT対戦予選は候補リストからの削除 (`decisions.exclusions`)。UI ごと分けてある。

## 巻き戻し

- **`group-rank` 参照は「そのリーグの全試合」に依存する。** `downstreamOf` はこれを数える。
  数えないと、予選をやり直したときに確定済みの準決勝の `resolvedA/B` だけが別人に
  書き換わり、「戦っていない相手に勝った」という記録ができる
- **巻き戻しで準備済み (`armed`) の試合まで消えたら `armedMatchId` も落とす**
  (`disarmIfCleared`)。グラフだけ `pending` に戻ると、`statusBridge` が
  「pending の試合を対戦中にする」という辻褄の合わない遷移をする
- **巻き戻してから commit し、そのあとで `disarmIfCleared`。** 逆にすると
  巻き戻す前のグラフで下流を数えてしまう

## 二層構造 (配布物 / 進行状態)

```
tournament.json  人が書く配布物。アプリは読むだけで絶対に書き戻さない
state.json       アプリが書く進行状態。消せば大会をやり直せる
```

**この PC でしか通じないものは `state.json` に置く。** プログラムライブラリの `catalogId`、
マップライブラリの ID、運営が当日下した判断 (`decisions`) がそれ。
`tournament.json` に書くと別の PC で壊れる。

`addCatalogEntry` は渡したファイルを rename するので、大会フォルダの原本を直接渡さないこと
(一時ファイルへコピーしてから渡す)。

## armMatch の順序

`requestReset()` → `setDoubleMode()` → `setClientType()` ×2。

`requestReset` が `processConfig` を消すため、逆順にすると割り当てが失われる。
また `roundResults` を空にすることで `canEditMap()` / `canStart()` の両ゲートが通る。

**スロットへ触る前に両者ぶんを解決しておくこと。** 片方だけ割り当ててから失敗すると
「COOL だけ準備完了」という中途半端な状態が残る。

## 新しい大会形式を足すとき

1. `StageRules` (`ws-types/tournament.ts`) に判別共用体の枝を足す
2. `definition.ts` の `parseStageRules` / 検証を足す
3. 試合グラフの組み立てを純関数で書く (`bracket.ts` / `league.ts` / `groupStage.ts` /
   `botStage.ts` にならう)
4. `TournamentStore.buildMatches` の `switch` に足す (網羅性で漏れが型エラーになる)
5. 作成 UI (`editor/FormatRulesEditor.tsx`) に、その形式で意味を持つ欄だけを足す
6. 予選を持つなら `hasQualifying` に含める — ここを忘れると確定ゲートを素通りする
