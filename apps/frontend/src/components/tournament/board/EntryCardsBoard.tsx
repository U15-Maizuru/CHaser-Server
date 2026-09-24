import { FitArea } from '../../FitArea';
import { ParticipantName } from './ParticipantName';
import {
  BG_CARD, BORDER_COLOR, FONT_NUM, FONT_UI, GOLD_BASE, GOLD_LIGHT, RADIUS_MD,
  RADIUS_PILL, SHADOW_SM, TEXT_MUTED, TEXT_PRIMARY,
} from '../../../ui';

// 名前の一覧をカードで見せる共通の盤面。予選の紹介 (GroupIntroBoard)、参加者一覧、
// 決勝進出者の一覧 (QualifierListBoard) が同じ見た目で並ぶよう、描画だけをここに持つ。
//
// 人数が多いカードは列を増やして縦に伸びすぎないようにする (伸びすぎると fit で縮み、
// 会場の後ろの席から読めなくなる)。

export interface EntryRow {
  id:           string;
  /** 行頭のバッジ。エントリー順の通し番号や順位 */
  no:           number;
  name:         string;
  affiliation?: string | null;
  /** まだ決まっていない行 (名前を弱く見せる) */
  pending?:     boolean;
}

export interface EntryCard {
  key:   number;
  title: string;
  rows:  EntryRow[];
}

/** 1列に並べる人数の上限。これを超えたら列を増やす */
const ROWS_PER_COLUMN = 10;

export function EntryCardsBoard({ cards, maxScale = 3 }: { cards: EntryCard[]; maxScale?: number }) {
  return (
    <FitArea maxScale={maxScale}>
      <div style={row}>
        {cards.map(c => {
          const columns  = Math.max(1, Math.ceil(c.rows.length / ROWS_PER_COLUMN));
          const rowCount = Math.max(1, Math.ceil(c.rows.length / columns));
          return (
            <div key={c.key} style={card}>
              <div style={cardHead}>
                <span style={cardTitle}>{c.title}</span>
                <span style={cardCount}>{c.rows.length}名</span>
              </div>
              <div
                style={{
                  display: 'grid', gridAutoFlow: 'column',
                  gridTemplateRows: `repeat(${rowCount}, auto)`, gap: 8, columnGap: 28,
                }}
              >
                {c.rows.map(r => (
                  <div key={r.id} style={entryRow}>
                    <span style={entryNo}>{r.no}</span>
                    <ParticipantName
                      name={r.name}
                      affiliation={r.affiliation ?? null}
                      nameStyle={r.pending ? { ...entryName, color: TEXT_MUTED } : entryName}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
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

const entryRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };

// 番号はエントリー順の通し番号か順位。金色ではなく控えめな地色にとどめる
// (トーナメント表の通過圏・星取表の金色と役割が被らないようにする)
const entryNo: React.CSSProperties = {
  flexShrink: 0, width: 22, height: 22, borderRadius: RADIUS_PILL,
  background: GOLD_LIGHT, color: GOLD_BASE, fontFamily: FONT_NUM, fontWeight: 700, fontSize: 12,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const entryName: React.CSSProperties = { fontSize: 16, fontWeight: 600 };
