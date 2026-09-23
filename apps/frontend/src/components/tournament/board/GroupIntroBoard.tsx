import type { TournamentStatePayload } from '@u15/ws-types';
import { hasBotStage } from '@u15/ws-types';
import { FitArea } from '../../FitArea';
import { affiliationOf, ParticipantName } from './ParticipantName';
import {
  BG_CARD, BORDER_COLOR, FONT_NUM, FONT_UI, GOLD_BASE, GOLD_LIGHT, RADIUS_MD,
  RADIUS_PILL, SHADOW_SM, TEXT_MUTED, TEXT_PRIMARY,
} from '../../../ui';

// 予選開始前 (まだ1試合も確定していない間) だけ出す紹介画面。
//
// 星取表は「対戦が始まってから初めて意味を持つ」表現で、開始前に出すと全マスが「・」の
// まま並ぶだけになり、観客に伝わるのは「まだ何も無い」ことだけ。開始前に観客が知りたいのは
// 成績ではなく「誰が出るか」「どう組み分けられているか」なので、対戦成績を一切出さず
// リーグ分け (BOT対戦予選はエントリー1本) と参加者名をカードで見せることに絞る。
//
// 1試合でも確定すれば TournamentStandby がこちらではなく QualifyingView (星取表) に
// 切り替える — この画面の役目は「開始前の紹介」だけで、進行中の成績表示は持たない。

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

  return (
    <FitArea maxScale={maxScale}>
      <div style={row}>
        {groups.map(g => (
          <div key={g.group} style={card}>
            <div style={cardHead}>
              <span style={cardTitle}>{isBot ? 'エントリー' : `${g.label}リーグ`}</span>
              <span style={cardCount}>{g.participantIds.length}名</span>
            </div>
            <div style={list}>
              {g.participantIds.map((id, i) => {
                const p = state.participants.find(x => x.id === id);
                return (
                  <div key={id} style={entryRow}>
                    <span style={entryNo}>{i + 1}</span>
                    <ParticipantName
                      name={p?.name ?? id}
                      affiliation={affiliationOf(state.participants, id)}
                      nameStyle={entryName}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </FitArea>
  );
}

const row: React.CSSProperties = {
  display: 'flex', flexDirection: 'row', flexWrap: 'wrap',
  justifyContent: 'center', alignItems: 'flex-start', gap: 24,
  fontFamily: FONT_UI, color: TEXT_PRIMARY,
};

const card: React.CSSProperties = {
  minWidth: 240, background: BG_CARD, border: `1px solid ${BORDER_COLOR}`,
  borderRadius: RADIUS_MD, boxShadow: SHADOW_SM, padding: '14px 20px 18px',
};

const cardHead: React.CSSProperties = {
  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
  borderBottom: `2px solid ${GOLD_LIGHT}`, paddingBottom: 8, marginBottom: 10,
};

const cardTitle: React.CSSProperties = { fontSize: 18, fontWeight: 800, color: TEXT_PRIMARY };
const cardCount: React.CSSProperties = { fontSize: 12, fontFamily: FONT_NUM, color: TEXT_MUTED };

const list: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };

const entryRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };

// 順位ではなくエントリー順の通し番号なので、金色ではなく控えめな地色にとどめる
// (トーナメント表の通過圏・星取表の金色と役割が被らないようにする)
const entryNo: React.CSSProperties = {
  flexShrink: 0, width: 22, height: 22, borderRadius: RADIUS_PILL,
  background: GOLD_LIGHT, color: GOLD_BASE, fontFamily: FONT_NUM, fontWeight: 700, fontSize: 12,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const entryName: React.CSSProperties = { fontSize: 16, fontWeight: 600 };
