import type { TournamentStatePayload } from '@u15/ws-types';
import { groupLabel, hasBotStage } from '@u15/ws-types';
import { EntryCardsBoard, type EntryCard, type EntryRow } from './EntryCardsBoard';

// 決勝トーナメントへ進む人の一覧 (予選のある形式)。運営が「表示」タブで選んだときだけ出る。
//
// 元にするのは決勝トーナメントの枠 (`state.qualifiers`) — 運営が差し替えた人・
// BOT対戦予選で確認リストから外した人も反映された「実際にこの枠へ入る人」。
// 順位表を読み直さないので、決勝トーナメント表に出る顔ぶれと必ず一致する。
//
// 予選が終わっていない間は枠が空 (participantId が null) なので、名前の代わりに「—」を出す。
// 参加者が足りず不戦になる枠 (bye) は誰も入らないので行に出さない。

export interface QualifierListBoardProps {
  state:     TournamentStatePayload;
  maxScale?: number;
}

export function QualifierListBoard({ state, maxScale = 3 }: QualifierListBoardProps) {
  const isBot = hasBotStage(state.stage.format);
  const byId  = new Map(state.participants.map(p => [p.id, p]));

  // リーグごとに、順位順の行へまとめる
  const rowsByGroup = new Map<number, EntryRow[]>();
  for (const q of [...(state.qualifiers ?? [])].sort((a, b) => a.group - b.group || a.rank - b.rank)) {
    if (q.bye) continue;
    const p = q.participantId ? byId.get(q.participantId) : undefined;
    const rows = rowsByGroup.get(q.group) ?? [];
    rows.push({
      id: `${q.group}:${q.rank}`, no: q.rank,
      name: p?.name ?? '—', affiliation: p?.affiliation ?? null, pending: !p,
    });
    rowsByGroup.set(q.group, rows);
  }

  const cards: EntryCard[] = [...rowsByGroup].map(([group, rows]) => ({
    key: group, title: isBot ? 'BOT対戦予選' : `${groupLabel(group)}リーグ`, rows,
  }));

  return <EntryCardsBoard cards={cards} maxScale={maxScale} />;
}
