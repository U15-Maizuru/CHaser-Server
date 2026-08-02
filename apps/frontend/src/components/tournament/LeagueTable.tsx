import type { ResolvedParticipant, StandingRow, TournamentMatch } from '@u15/ws-types';
import {
  BG_CARD, BG_ROOT, BORDER_COLOR, COOL_PALE, FONT_NUM, FONT_UI, GOLD_LIGHT,
  RADIUS_SM, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WIN_BASE,
} from '../../styles/tokens';

// リーグの星取表 + 順位表。素の DOM (既存方針どおり CSS ファイルは作らない)。
//
// 順位は公式ルールどおり「勝ち点(3-1-0) → 全試合の合計ポイント → 直接対決」で決まる。
// そこまで並んだ場合は同順位として出す (tied)。

export interface LeagueTableProps {
  matches:      TournamentMatch[];
  participants: ResolvedParticipant[];
  standings:    StandingRow[];
  interactive?: boolean;
  onSelect?:    (matchId: string) => void;
}

export function LeagueTable({
  matches, participants, standings, interactive = false, onSelect,
}: LeagueTableProps) {
  const nameOf = (id: string) => participants.find(p => p.id === id)?.name ?? id;
  const order  = standings.map(s => s.participantId);

  /** a から見た b との対戦結果 */
  const cellOf = (a: string, b: string): {
    text: string; match: TournamentMatch | null; tone: 'none' | 'win' | 'loss' | 'draw';
  } => {
    const m = matches.find(x =>
      (x.resolvedA === a && x.resolvedB === b) || (x.resolvedA === b && x.resolvedB === a));
    if (!m) return { text: '—', match: null, tone: 'none' };
    if (m.status !== 'done' || !m.result) return { text: '・', match: m, tone: 'none' };

    const aIsSideA = m.resolvedA === a;
    const w = m.result.winnerSide;
    if (w === null) return { text: '△', match: m, tone: 'draw' };
    const aWon = (w === 0) === aIsSideA;
    return { text: aWon ? '○' : '●', match: m, tone: aWon ? 'win' : 'loss' };
  };

  return (
    <div style={wrap}>
      {/* ── 星取表 ── */}
      <div style={scroller}>
        <table style={table}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>チーム</th>
              {order.map(id => (
                <th key={id} style={th} title={nameOf(id)}>{shortName(nameOf(id))}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map(a => (
              <tr key={a}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{nameOf(a)}</td>
                {order.map(b => {
                  if (a === b) return <td key={b} style={{ ...td, background: BG_ROOT }} />;
                  const c = cellOf(a, b);
                  const clickable = interactive && !!onSelect && !!c.match;
                  return (
                    <td
                      key={b}
                      style={{
                        ...td,
                        ...(c.tone === 'win'  ? { color: WIN_BASE, fontWeight: 700 } : null),
                        ...(c.tone === 'draw' ? { color: TEXT_SECONDARY } : null),
                        ...(c.tone === 'loss' ? { color: TEXT_MUTED } : null),
                        cursor: clickable ? 'pointer' : undefined,
                      }}
                      onClick={clickable ? () => onSelect!(c.match!.id) : undefined}
                      title={c.match?.label}
                    >
                      {c.text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── 順位表 ── */}
      <div style={scroller}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>順位</th>
              <th style={{ ...th, textAlign: 'left' }}>チーム</th>
              <th style={th}>試合</th>
              <th style={th}>勝</th>
              <th style={th}>分</th>
              <th style={th}>敗</th>
              <th style={th}>勝点</th>
              <th style={th}>合計ポイント</th>
            </tr>
          </thead>
          <tbody>
            {standings.map(s => (
              <tr key={s.participantId} style={s.rank === 1 ? rowTop : undefined}>
                <td style={{ ...td, fontWeight: 700 }}>
                  {s.rank}{s.tied ? '=' : ''}
                </td>
                <td style={{ ...td, textAlign: 'left' }}>{nameOf(s.participantId)}</td>
                <td style={tdNum}>{s.played}</td>
                <td style={tdNum}>{s.wins}</td>
                <td style={tdNum}>{s.draws}</td>
                <td style={tdNum}>{s.losses}</td>
                <td style={{ ...tdNum, fontWeight: 700 }}>{s.points}</td>
                <td style={tdNum}>{s.totalPoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={legend}>○ 勝ち ・ △ 引き分け ・ ● 負け ・ ・ 未消化</div>
    </div>
  );
}

/** 星取表の列見出しは幅が限られるので短く切る */
function shortName(name: string): string {
  return name.length <= 4 ? name : name.slice(0, 3) + '…';
}

const wrap: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 14,
  fontFamily: FONT_UI, color: TEXT_PRIMARY, minWidth: 0,
};

const scroller: React.CSSProperties = { overflowX: 'auto', maxWidth: '100%' };

const table: React.CSSProperties = {
  borderCollapse: 'collapse', fontSize: 12, background: BG_CARD,
  borderRadius: RADIUS_SM, minWidth: 'max-content',
};

const th: React.CSSProperties = {
  padding: '6px 10px', fontSize: 10, fontWeight: 700, color: TEXT_SECONDARY,
  borderBottom: `1px solid ${BORDER_COLOR}`, textAlign: 'center', whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '6px 10px', borderBottom: `1px solid ${BORDER_COLOR}`,
  textAlign: 'center', whiteSpace: 'nowrap',
};

const tdNum: React.CSSProperties = { ...td, fontFamily: FONT_NUM };

const rowTop: React.CSSProperties = { background: GOLD_LIGHT };

const legend: React.CSSProperties = {
  fontSize: 10, color: TEXT_MUTED, background: COOL_PALE,
  borderRadius: 8, padding: '6px 10px', alignSelf: 'flex-start',
};
