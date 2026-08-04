import type { ResolvedParticipant, StandingRow, TournamentMatch } from '@u15/ws-types';
import { FitArea } from '../FitArea';
import {
  BG_CARD, BG_ROOT, BORDER_COLOR, COOL_PALE, FONT_NUM, FONT_UI, GOLD_BASE, GOLD_LIGHT,
  RADIUS_SM, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WIN_BASE,
} from '../../styles/tokens';

// リーグの星取表 + 順位表。素の DOM (既存方針どおり CSS ファイルは作らない)。
//
// 順位は公式ルールどおり「勝ち点(3-1-0) → 全試合の合計ポイント → 直接対決」で決まる。
// そこまで並んだ場合は同順位として出す (tied)。
//
// **星取表の行・列はエントリー順 (選手番号順) で固定する。** 順位順に並べ替えると
// 試合が確定するたびに表の行が動き、観客も運営も同じチームを目で追えなくなる。
// 順位で並ぶのは下段の順位表だけ。

export interface LeagueTableProps {
  matches:      TournamentMatch[];
  participants: ResolvedParticipant[];
  standings:    StandingRow[];
  interactive?: boolean;
  onSelect?:    (matchId: string) => void;
  /** 「この試合を準備」で確定した、これから行う試合 */
  upcomingMatchId?: string | null;
  /** 親の空き領域いっぱいまで自動で拡大・縮小する (親は高さの決まった箱にすること) */
  fit?:         boolean;
  /** fit の拡大上限 */
  maxScale?:    number;
}

export function LeagueTable({
  matches, participants, standings, interactive = false, onSelect,
  upcomingMatchId = null, fit = false, maxScale = 3,
}: LeagueTableProps) {
  const nameOf = (id: string) => participants.find(p => p.id === id)?.name ?? id;
  // エントリー順 (participants は seed 順で配信される)。順位で並べ替えない
  const order  = participants.map(p => p.id);

  const upcoming = matches.find(m => m.id === upcomingMatchId) ?? null;
  const isUpcomingTeam = (id: string) =>
    !!upcoming && (upcoming.resolvedA === id || upcoming.resolvedB === id);

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

  const body = (
    <div style={wrap}>
      {/* fit のときは2つの表を横に並べる。縦に積むと高さで頭打ちになり、
          横長の画面では拡大できる余地を捨ててしまう */}
      <div style={fit ? tablesRow : tablesColumn}>
      {/* ── 星取表 ── */}
      <div style={scroller}>
        <table style={table}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>チーム</th>
              {order.map(id => (
                <th
                  key={id}
                  style={{ ...th, ...(isUpcomingTeam(id) ? headUpcoming : null) }}
                  title={nameOf(id)}
                >
                  {shortName(nameOf(id))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map(a => (
              <tr key={a}>
                <td style={{
                  ...td, textAlign: 'left', fontWeight: 600,
                  ...(isUpcomingTeam(a) ? headUpcoming : null),
                }}>
                  {nameOf(a)}
                </td>
                {order.map(b => {
                  if (a === b) return <td key={b} style={{ ...td, background: BG_ROOT }} />;
                  const c = cellOf(a, b);
                  const clickable = interactive && !!onSelect && !!c.match;
                  const isUpcoming = !!upcoming && c.match?.id === upcoming.id;
                  return (
                    <td
                      key={b}
                      style={{
                        ...td,
                        ...(c.tone === 'win'  ? { color: WIN_BASE, fontWeight: 700 } : null),
                        ...(c.tone === 'draw' ? { color: TEXT_SECONDARY } : null),
                        ...(c.tone === 'loss' ? { color: TEXT_MUTED } : null),
                        ...(isUpcoming ? cellUpcoming : null),
                        cursor: clickable ? 'pointer' : undefined,
                      }}
                      onClick={clickable ? () => onSelect!(c.match!.id) : undefined}
                      title={c.match?.label}
                    >
                      {isUpcoming ? '▶' : c.text}
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
      </div>

      <div style={legend}>
        ○ 勝ち ・ △ 引き分け ・ ● 負け ・ ・ 未消化{upcoming ? ' ・ ▶ 次の試合' : ''}
      </div>
    </div>
  );

  // 空き領域に合わせて拡大・縮小する
  return fit ? <FitArea maxScale={maxScale}>{body}</FitArea> : body;
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

const tablesColumn: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0,
};

const tablesRow: React.CSSProperties = {
  display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 20,
};

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

// これから行う試合。該当セルと、その2チームの見出しを金色で示す
const cellUpcoming: React.CSSProperties = {
  background: GOLD_BASE, color: '#fff', fontWeight: 700,
};

const headUpcoming: React.CSSProperties = {
  background: GOLD_LIGHT, color: TEXT_PRIMARY, fontWeight: 700,
};

const legend: React.CSSProperties = {
  fontSize: 10, color: TEXT_MUTED, background: COOL_PALE,
  borderRadius: 8, padding: '6px 10px', alignSelf: 'flex-start',
};
