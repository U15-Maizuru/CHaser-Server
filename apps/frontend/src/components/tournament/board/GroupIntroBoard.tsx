import type { TournamentStatePayload } from '@u15/ws-types';
import { hasBotStage } from '@u15/ws-types';
import { EntryCardsBoard, type EntryCard } from './EntryCardsBoard';

// 予選開始前 (まだ1試合も確定していない間) だけ出す紹介画面。
//
// 星取表は「対戦が始まってから初めて意味を持つ」表現で、開始前に出すと全マスが「・」の
// まま並ぶだけになり、観客に伝わるのは「まだ何も無い」ことだけ。開始前に観客が知りたいのは
// 成績ではなく「誰が出るか」「どう組み分けられているか」なので、対戦成績を一切出さず
// リーグ分け (BOT対戦予選はエントリー1本) と参加者名をカードで見せることに絞る。
//
// 1試合でも確定すれば TournamentStandby がこちらではなく QualifyingView (星取表) に
// 切り替える — この画面の役目は「開始前の紹介」だけで、進行中の成績表示は持たない。
//
// **運営が「参加者一覧」を選んだときにも使う** (ParticipantListScreen)。リーグ分けを持たない
// 形式 (トーナメント・リーグ) は groups が空なので、参加者全員を1枚のカードにまとめる。

export interface GroupIntroBoardProps {
  state:     TournamentStatePayload;
  maxScale?: number;
}

export function GroupIntroBoard({ state, maxScale = 3 }: GroupIntroBoardProps) {
  const groups = state.groups ?? [];
  // BOT対戦予選は全参加者が同じ BOT と1試合ずつ戦うだけで「組み分け」が無い
  // (group: 0 の1グループにまとまっているだけ)。ここに「Aリーグ」と出すと
  // 実際には無い組み分けがあるように見えるので、単なる参加者一覧として見せる
  const isBot = hasBotStage(state.stage.format);

  const byId = new Map(state.participants.map(p => [p.id, p]));
  const rowsOf = (ids: string[]) => ids.map((id, i) => ({
    id, no: i + 1, name: byId.get(id)?.name ?? id, affiliation: byId.get(id)?.affiliation ?? null,
  }));

  // 運営BOT はエントリーではないので一覧に出さない
  const entrants = state.participants.filter(p => !p.isBot);
  const cards: EntryCard[] = groups.length > 0
    ? groups.map(g => ({
        key: g.group, title: isBot ? 'エントリー' : `${g.label}リーグ`, rows: rowsOf(g.participantIds),
      }))
    : [{ key: 0, title: '参加者', rows: rowsOf(entrants.map(p => p.id)) }];

  return <EntryCardsBoard cards={cards} maxScale={maxScale} />;
}
