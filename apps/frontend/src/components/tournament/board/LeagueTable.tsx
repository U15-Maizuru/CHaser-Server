import type { ResolvedParticipant, StandingRow, TournamentMatch } from '@u15/ws-types';
import { FitArea } from '../../FitArea';
import {
  BG_CARD, BG_ROOT, BORDER_COLOR, COOL_PALE, FONT_NUM, FONT_UI, GOLD_BASE, GOLD_LIGHT,
  HOT_COLOR, RADIUS_SM, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WIN_BASE, WIN_LIGHT,
} from '../../../ui';

// リーグの星取表 + 順位表。素の DOM (既存方針どおり CSS ファイルは作らない)。
//
// 順位は公式ルールどおり「勝ち点(3-1-0) → 全試合の合計ポイント → 直接対決」で決まる。
// そこまで並んだ場合は同順位として出す (tied)。
//
// 予選リーグでは**決勝トーナメントへ上がる順位までを強調する** (advanceCount)。
// 1位だけを金色にすると、観客にも運営にも「あと1つ上がれば通過」の境目が見えない —
// 予選で本当に知りたいのは優勝者ではなく通過ラインなので、そこに線を引く。
//
// **星取表の行・列はエントリー順 (選手番号順) で固定する。** 順位順に並べ替えると
// 試合が確定するたびに表の行が動き、観客も運営も同じプレイヤーを目で追えなくなる。
// 順位で並ぶのは下段の順位表だけ。

export interface LeagueTableProps {
  /**
   * この表に出す試合。予選リーグでは**そのリーグのぶんだけ**渡すこと —
   * cellOf は対戦相手の組み合わせで試合を引くので、他リーグや決勝トーナメントの
   * 試合が混ざると同じ顔合わせを拾ってしまう。
   */
  matches:      TournamentMatch[];
  /** この表の軸 (エントリー順)。予選リーグではそのリーグの参加者だけ */
  participants: ResolvedParticipant[];
  standings:    StandingRow[];
  /** 「Aリーグ」のような見出し。予選リーグが複数あるときに要る */
  title?:       string;
  /**
   * 見出し・星取表・順位表を「囲みの無い3つの塊」として並べて返す。
   *
   * 予選リーグを横に並べるとき、リーグごとにプレイヤー数が違うと星取表の高さが変わり、
   * その下の順位表の位置がリーグ間でずれてしまう。呼び出し側で CSS グリッドの
   * 行にそろえられるよう、まとめる div を外して個々の塊を直接返す。
   */
  gridCells?:   boolean;
  /**
   * 決勝トーナメントへ上がる人数 (予選リーグのみ)。順位表の上位この人数までを金色にし、
   * 直下に通過ラインを引く。0 / 省略時は「1位だけ金色」の従来どおり (単独リーグの優勝者)。
   */
  advanceCount?: number;
  /**
   * 実際に上がる人。**運営が枠を手で差し替えたときだけ**渡すこと。
   * 省略すれば順位表の位置 (上位 advanceCount 人) で塗るので、予選の途中でも
   * 「いまの通過圏」が見える — 差し替えの有無で通過ラインの位置は動かさない。
   */
  qualifiedIds?: string[] | null;
  interactive?: boolean;
  onSelect?:    (matchId: string) => void;
  /** 「この試合を準備」で確定した、これから行う試合 */
  upcomingMatchId?: string | null;
  /** たった今「確定」した試合 */
  finishedMatchId?: string | null;
  /** 親の空き領域いっぱいまで自動で拡大・縮小する (親は高さの決まった箱にすること) */
  fit?:         boolean;
  /** fit の拡大上限 */
  maxScale?:    number;
}

export function LeagueTable({
  matches, participants, standings, title, gridCells = false,
  advanceCount = 0, qualifiedIds = null,
  interactive = false, onSelect,
  upcomingMatchId = null, finishedMatchId = null, fit = false, maxScale = 3,
}: LeagueTableProps) {
  const nameOf = (id: string) => participants.find(p => p.id === id)?.name ?? id;
  // エントリー順 (participants は seed 順で配信される)。順位で並べ替えない
  const order  = participants.map(p => p.id);

  const upcoming = matches.find(m => m.id === upcomingMatchId) ?? null;
  const isUpcomingTeam = (id: string) =>
    !!upcoming && (upcoming.resolvedA === id || upcoming.resolvedB === id);
  const hasRematchPending = matches.some(m => m.rematchPending);

  /** a から見た b との対戦結果 */
  const cellOf = (a: string, b: string): {
    text: string; match: TournamentMatch | null; tone: 'none' | 'win' | 'loss' | 'draw' | 'rematch';
  } => {
    const m = matches.find(x =>
      (x.resolvedA === a && x.resolvedB === b) || (x.resolvedA === b && x.resolvedB === a));
    if (!m) return { text: '—', match: null, tone: 'none' };
    // 同点で再試合になった試合は、結果を捨てた時点で他の未実施のマスと同じ「・」に戻って
    // しまう。観客・運営が「再試合待ち」だと分かるよう別の記号にする
    if (m.rematchPending) return { text: '↻', match: m, tone: 'rematch' };
    if (m.status !== 'done' || !m.result) return { text: '・', match: m, tone: 'none' };

    const aIsSideA = m.resolvedA === a;
    const w = m.result.winnerSide;
    if (w === null) return { text: '△', match: m, tone: 'draw' };
    const aWon = (w === 0) === aIsSideA;
    return { text: aWon ? '○' : '●', match: m, tone: aWon ? 'win' : 'loss' };
  };

  // ── 星取表 (凡例つき) ──
  // 凡例は星取表のすぐ下に置く。順位表の下に置くと、何の記号の説明なのかが離れて分かりにくい
  const crossTable = (
    <div style={crossWrap}>
      <div style={scroller}>
        <table style={table}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>プレイヤー</th>
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
                  // 星取表は対称なので、終わった試合は (a,b) と (b,a) の2セルが光る
                  const isFinished = !!finishedMatchId && c.match?.id === finishedMatchId;
                  return (
                    <td
                      key={b}
                      style={{
                        ...td,
                        ...(c.tone === 'win'  ? { color: WIN_BASE, fontWeight: 700 } : null),
                        ...(c.tone === 'draw' ? { color: TEXT_SECONDARY } : null),
                        ...(c.tone === 'loss' ? { color: TEXT_MUTED } : null),
                        ...(c.tone === 'rematch' ? cellRematch : null),
                        ...(isFinished ? cellFinished : null),
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
      <div style={legend}>
        ○ 勝ち ・ △ 引き分け ・ ● 負け
        {hasRematchPending ? ' ・ ↻ 再試合待ち' : ''}
        {upcoming ? ' ・ ▶ 次の試合' : ''}
      </div>
    </div>
  );

  // ── 順位表 ──
  /** その行が決勝トーナメントへ上がるか。差し替えが無ければ順位表の「位置」で決める */
  const advances = (participantId: string, index: number): boolean => {
    if (advanceCount <= 0) return false;
    return qualifiedIds ? qualifiedIds.includes(participantId) : index < advanceCount;
  };

  const standingsTable = (
    <div style={standingsWrap}>
      <div style={scroller}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>順位</th>
              <th style={{ ...th, textAlign: 'left' }}>プレイヤー</th>
              <th style={th}>試合</th>
              <th style={th}>勝</th>
              <th style={th}>分</th>
              <th style={th}>敗</th>
              <th style={th}>勝点</th>
              <th style={th}>合計ポイント</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => {
              // 予選リーグは通過圏を、単独リーグは優勝者だけを金色にする
              const up = advanceCount > 0 ? advances(s.participantId, i) : s.rank === 1;
              // 通過ラインは位置で引く。最下位の下には引かない (全員通過なら線に意味が無い)
              const cut = advanceCount > 0
                && i === advanceCount - 1 && i < standings.length - 1;
              const cell    = { ...td,    ...(cut ? cutLine : null) };
              const cellNum = { ...tdNum, ...(cut ? cutLine : null) };
              return (
                <tr key={s.participantId} style={up ? rowTop : undefined}>
                  <td style={{ ...cell, fontWeight: 700 }}>
                    {s.rank}{s.tied ? '=' : ''}
                  </td>
                  <td style={{ ...cell, textAlign: 'left' }}>{nameOf(s.participantId)}</td>
                  <td style={cellNum}>{s.played}</td>
                  <td style={cellNum}>{s.wins}</td>
                  <td style={cellNum}>{s.draws}</td>
                  <td style={cellNum}>{s.losses}</td>
                  <td style={{ ...cellNum, fontWeight: 700 }}>{s.points}</td>
                  <td style={cellNum}>{s.totalPoints}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* 色だけでは「金色が何なのか」が伝わらないので、言葉でも添える */}
      {advanceCount > 0 && (
        <div style={advanceNote}>
          <span style={advanceSwatch} />上位 {advanceCount} 名が決勝トーナメントへ進出
        </div>
      )}
    </div>
  );

  const heading = title ? <div style={tableTitle}>{title}</div> : <div />;

  // グリッドの行にそろえる場合は、まとめる div を外して3つの塊をそのまま返す。
  // 呼び出し側が同じ行に並べることで、星取表の高さが違っても順位表の上端がそろう
  if (gridCells) {
    return <>{heading}{crossTable}{standingsTable}</>;
  }

  const body = (
    <div style={wrap}>
      {title && <div style={tableTitle}>{title}</div>}
      {/* fit のときは2つの表を横に並べる。縦に積むと高さで頭打ちになり、
          横長の画面では拡大できる余地を捨ててしまう */}
      <div style={fit ? tablesRow : tablesColumn}>
        {crossTable}
        {standingsTable}
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

const crossWrap: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, alignItems: 'flex-start',
};

// 順位表と、その下の「上位N名が進出」の注記。crossWrap と同じ組み方にして
// グリッドに並べたときの見え方をそろえる
const standingsWrap: React.CSSProperties = crossWrap;

const tableTitle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: TEXT_PRIMARY,
};

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

// 決勝トーナメントへ上がる行 (予選なしのリーグでは1位のみ)
const rowTop: React.CSSProperties = { background: GOLD_LIGHT };

// 通過ライン。ここから下は上がれない、を1本の線で示す
const cutLine: React.CSSProperties = { borderBottom: `2px solid ${GOLD_BASE}` };

const advanceNote: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: 10, color: TEXT_MUTED, background: COOL_PALE,
  borderRadius: 8, padding: '6px 10px', alignSelf: 'flex-start',
};

const advanceSwatch: React.CSSProperties = {
  display: 'inline-block', width: 12, height: 12, borderRadius: 2,
  background: GOLD_LIGHT, borderBottom: `2px solid ${GOLD_BASE}`, boxSizing: 'border-box',
};

// これから行う試合。該当セルと、その2プレイヤーの見出しを金色で示す
const cellUpcoming: React.CSSProperties = {
  background: GOLD_BASE, color: '#fff', fontWeight: 700,
};

// たった今確定した試合。○●△ の文字は残したまま、枠と地色で「ここが終わった」を示す
const cellFinished: React.CSSProperties = {
  background: WIN_LIGHT, fontWeight: 700,
  outline: `2px solid ${WIN_BASE}`, outlineOffset: -2,
};

// 同点で再試合待ちの試合。MatchCard の再試合バッジと同じ色で揃える
const cellRematch: React.CSSProperties = {
  color: HOT_COLOR, fontWeight: 700,
};

const headUpcoming: React.CSSProperties = {
  background: GOLD_LIGHT, color: TEXT_PRIMARY, fontWeight: 700,
};

const legend: React.CSSProperties = {
  fontSize: 10, color: TEXT_MUTED, background: COOL_PALE,
  borderRadius: 8, padding: '6px 10px', alignSelf: 'flex-start',
};
