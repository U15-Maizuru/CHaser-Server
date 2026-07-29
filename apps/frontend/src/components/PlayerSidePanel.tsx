import { useLayoutEffect, useRef, useState } from 'react';
import type {
  GameStateSnapshot,
  RoundResult,
  ServerStatusPayload,
} from '@u15/ws-types';
import { Winner } from '@u15/ws-types';
import { idxForSide } from '../lib/roundSide';
import {
  BG_CARD,
  COOL_COLOR, COOL_LIGHT, COOL_PALE, COOL_DARK,
  HOT_COLOR,  HOT_LIGHT,  HOT_PALE,  HOT_DARK,
  WIN_BASE, WIN_LIGHT, WIN_PALE,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  SHADOW_SM, BORDER_COLOR,
  RADIUS_SM, RADIUS_MD,
  FONT_UI, FONT_NUM,
} from '../styles/tokens';

function clampNum(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

// 各試合のポイント/ボーナス表示エリア (カード幅・文字サイズ・余白) を、盤面の実描画サイズに
// 連動した scale (MainWindow から渡される、cellSize 基準の倍率) に応じて最大化するための寸法。
interface PanelDim {
  cardW: number;
  teamBoxGap: number; teamBoxPadB: number;
  headerPadV: number; headerPadH: number; headerMarginB: number;
  dotsFont: number; labelFont: number;
  gridGap: number;
  badgeFont: number; badgePadV: number; badgePadH: number;
  totalPadV: number; totalPadH: number;
  totalHeaderFont: number; totalHeaderMarginB: number; totalHeaderPadT: number;
  statLabelFont: number; statValueFont: number; statValueFontSmall: number;
  statValuePadV: number; statValuePadH: number;
}

// width: パネルに割り当てられた実際の幅 (px)。150 は基準幅で、これを 1.0 とした相対スケールを
// 内部要素のフォント/余白計算に使う。correction: 実測した内容の高さがカードの実高さに収まらない
// 場合に PlayerSidePanel 側で計算する縮小補正 (1 = 補正なし)。幅だけを基準に文字サイズを決めると
// 横長で縦が狭いウィンドウのときにカードの高さに収まらないため、実際に DOM を測定して補正する
// (「このくらいの高さになるはず」という事前見積りは実際の余白・行間の誤差で簡単にズレるため、
// 見積りではなく実測ベースにしている)。
function buildDim(width: number, correction: number): PanelDim {
  const scale = (width / 150) * correction;
  return {
    cardW: width,
    teamBoxGap: clampNum(6 * scale, 4, 26),
    teamBoxPadB: clampNum(7 * scale, 5, 26),
    headerPadV: clampNum(7 * scale, 5, 30),
    headerPadH: clampNum(9 * scale, 7, 34),
    headerMarginB: clampNum(3 * scale, 2, 13),
    dotsFont: clampNum(5 * scale, 4, 19),
    labelFont: clampNum(14 * scale, 10, 45),
    gridGap: clampNum(4 * scale, 3, 19),
    badgeFont: clampNum(9 * scale, 7, 26),
    badgePadV: clampNum(3 * scale, 2, 11),
    badgePadH: clampNum(8 * scale, 6, 30),
    totalPadV: clampNum(7 * scale, 5, 30),
    totalPadH: clampNum(8 * scale, 6, 30),
    totalHeaderFont: clampNum(11 * scale, 8, 34),
    totalHeaderMarginB: clampNum(5 * scale, 4, 22),
    totalHeaderPadT: clampNum(5 * scale, 4, 22),
    statLabelFont: clampNum(10 * scale, 7, 28),
    statValueFont: clampNum(15 * scale, 10, 49),
    statValueFontSmall: clampNum(12 * scale, 8, 38),
    statValuePadV: clampNum(4 * scale, 2, 19),
    statValuePadH: clampNum(4 * scale, 3, 15),
  };
}

interface Props {
  side:         0 | 1;
  snapshot:     GameStateSnapshot | null;
  serverStatus: ServerStatusPayload | null;
  width:        number;
  maxHeight:    number;
}

export function PlayerSidePanel({ side, snapshot, serverStatus, width, maxHeight }: Props) {
  const roundResults = serverStatus?.roundResults ?? [];
  const doubleMode   = serverStatus?.doubleMode   ?? false;

  const cardRef = useRef<HTMLDivElement>(null);
  const [correction, setCorrection] = useState(1);

  // 実際の内容の高さ (scrollHeight) を実測し、カードの実高さ (maxHeight) に収まる中で
  // 最大のフォントサイズ (correction) を二分探索で求める。フォントサイズ→必要な高さの関係は
  // buildDim 内の各プロパティごとの min/max クランプにより区間ごとに折れ線 (非線形) になって
  // おり、単純な比例計算では最適値に収束しないため、関数の形に関係なく「収まる最大値」に
  // 確実に収束する二分探索を用いる。
  const key = `${Math.round(width / 5)}|${Math.round(maxHeight / 5)}|${doubleMode}|${roundResults.length}`;
  const keyRef = useRef(key);
  const boundsRef = useRef({ lo: 0.35, hi: 1 }); // lo: 収まることが確認済みの最大値 / hi: 収まらないことが確認済みの最小値

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || maxHeight <= 0) return;

    if (keyRef.current !== key) {
      // 幅・高さ・内容の行数が変わったら探索範囲を最初からやり直す
      keyRef.current = key;
      boundsRef.current = { lo: 0.35, hi: 1 };
      if (correction !== 1) setCorrection(1);
      return; // correction=1 での再描画を待ってから測定する
    }

    const fits = el.scrollHeight <= maxHeight + 1;
    let { lo, hi } = boundsRef.current;
    // 「試合中は2項目・終了後は4項目」のようにコンテンツの形が変わると、width/maxHeight/
    // doubleMode/roundResults.length のどれも変化しないまま探索範囲が [lo,hi] に収束済み
    // (lo===hi) の状態で実際の要否だけが反転することがある。この場合に再探索が走るよう、
    // 収まらなかったときは lo を、収まったときは hi を、現在値から確実に離して区間を
    // 強制的に開き直す。
    if (fits) {
      lo = correction;
      if (hi <= lo) hi = 1;
    } else {
      hi = correction;
      if (lo >= hi) lo = Math.max(0.35, hi - 0.1);
    }
    boundsRef.current = { lo, hi };

    const next = hi - lo > 0.02 ? (lo + hi) / 2 : lo;
    if (Math.abs(next - correction) > 0.004) setCorrection(next);
  });

  const dim = buildDim(width, correction);

  return (
    <div ref={cardRef} style={{ ...s.card, width: dim.cardW }}>
      {doubleMode ? (
        <DoubleModeContent
          side={side}
          snapshot={snapshot}
          serverStatus={serverStatus}
          roundResults={roundResults}
          dim={dim}
        />
      ) : (
        <SingleModeContent side={side} snapshot={snapshot} roundResults={roundResults} dim={dim} />
      )}
    </div>
  );
}

// ── SingleModeContent (2試合制OFF: チーム別に表示) ────────────────────────

// 競技ルール4 (リーグ方式): 勝利3点・敗北0点・引き分け1点
function leaguePoints(winner: Winner, team: 0 | 1): number {
  if (winner === Winner.DRAW) return 1;
  return winner === (team === 0 ? Winner.COOL : Winner.HOT) ? 3 : 0;
}

function computeData(snapshot: GameStateSnapshot | null, roundResults: RoundResult[]) {
  const curItems: [number, number] = snapshot?.teamScore ?? [0, 0];
  const points: [number, number] = [
    roundResults.reduce((s, r) => s + leaguePoints(r.winner, 0), 0),
    roundResults.reduce((s, r) => s + leaguePoints(r.winner, 1), 0),
  ];
  // 完了したラウンドの合計 (アイテム×10+一撃+総取り) + 現在の試合の生スコア×10
  // (競技ルール3.①: 獲得アイテム数×10点を勝者・敗者ともに得る)
  const finishedTotal: [number, number] = [
    roundResults.reduce((s, r) => s + r.scores[0] * 10 + r.strikeBonus[0] + r.sweepBonus[0], 0),
    roundResults.reduce((s, r) => s + r.scores[1] * 10 + r.strikeBonus[1] + r.sweepBonus[1], 0),
  ];
  const totalPoints: [number, number] = [
    finishedTotal[0] + curItems[0] * 10,
    finishedTotal[1] + curItems[1] * 10,
  ];
  return { curItems, points, totalPoints, roundResults };
}

function SingleModeContent({ side, snapshot, roundResults, dim }: {
  side: 0 | 1; snapshot: GameStateSnapshot | null; roundResults: RoundResult[]; dim: PanelDim;
}) {
  const { curItems, points, totalPoints } = computeData(snapshot, roundResults);

  // 表示順: side=0 → COOL(0)→HOT(1), side=1 → HOT(1)→COOL(0)
  const order: [0 | 1, 0 | 1] = side === 0 ? [0, 1] : [1, 0];

  const grandPoints = points[0] + points[1];
  const grandScore  = totalPoints[0] + totalPoints[1];

  return (
    <>
      {/* ── チーム1 ── */}
      <TeamSection
        team={order[0]}
        points={points[order[0]]}
        totalPoints={totalPoints[order[0]]}
        items={curItems[order[0]]}
        roundResults={roundResults}
        doubleMode={false}
        dim={dim}
      />

      {/* ── チーム2 ── */}
      <TeamSection
        team={order[1]}
        points={points[order[1]]}
        totalPoints={totalPoints[order[1]]}
        items={curItems[order[1]]}
        roundResults={roundResults}
        doubleMode={false}
        dim={dim}
      />

      {/* ── TOTAL ── */}
      <div style={{ ...s.totalSection, padding: `${dim.totalPadV}px ${dim.totalPadH}px` }}>
        <div style={{
          ...s.totalHeader,
          fontSize: dim.totalHeaderFont, marginBottom: dim.totalHeaderMarginB, paddingTop: dim.totalHeaderPadT,
        }}>⭐ TOTAL</div>
        <div style={{ ...s.totalGrid, gap: dim.gridGap }}>
          <StatCell label="勝ち点"     value={`${grandPoints}pt`} bg={WIN_PALE} color={WIN_BASE} dim={dim} />
          <StatCell label="合計ポイント" value={`${grandScore}pt`}  bg={WIN_PALE} color={WIN_BASE} dim={dim} />
        </div>
      </div>
    </>
  );
}

// ── DoubleModeContent (2試合制ON: 試合ごとに行を分け、自分側だけの合計を出す) ──────

type RoundRowStatus = 'finished' | 'live' | 'pending';
type RoundOutcome   = 'WIN' | 'LOSE' | 'DRAW';

function roundOutcome(winner: Winner, team: 0 | 1): RoundOutcome {
  if (winner === Winner.DRAW) return 'DRAW';
  return winner === (team === 0 ? Winner.COOL : Winner.HOT) ? 'WIN' : 'LOSE';
}

interface RoundRowData {
  round:       0 | 1;
  idx:         0 | 1;
  label:       'COOL' | 'HOT';
  status:      RoundRowStatus;
  items:       number;
  strikeBonus: number;
  sweepBonus:  number;
  outcome:     RoundOutcome | null;
  points:      number;
  totalPoints: number;
}

// 画面側 (side) ×試合番号 (round) から、確定済み/進行中/未対戦のいずれかを判定してスコア行を組み立てる。
// 1試合目終了直後は phase='finished' のまま currentRound だけ 1 に進むため、対応する
// roundResults が無い限りは (currentRound===round であっても) 進行中とはみなさない —
// これにより1試合目の古いスナップショットを2試合目の行に誤表示することを防いでいる。
function computeRoundRow(
  side: 0 | 1,
  round: 0 | 1,
  roundResults: RoundResult[],
  serverStatus: ServerStatusPayload | null,
  snapshot: GameStateSnapshot | null,
): RoundRowData {
  const idx   = idxForSide(side, round);
  const label = idx === 0 ? 'COOL' : 'HOT';
  const rr    = roundResults.find(r => r.round === round);

  if (rr) {
    const items        = rr.scores[idx];
    const strikeBonus  = rr.strikeBonus[idx];
    const sweepBonus   = rr.sweepBonus[idx];
    return {
      round, idx, label, status: 'finished',
      items, strikeBonus, sweepBonus,
      outcome: roundOutcome(rr.winner, idx),
      points: leaguePoints(rr.winner, idx),
      totalPoints: items * 10 + strikeBonus + sweepBonus,
    };
  }

  const isLive = serverStatus?.currentRound === round && serverStatus?.phase === 'playing';
  if (isLive) {
    const items = snapshot?.teamScore[idx] ?? 0;
    return { round, idx, label, status: 'live', items, strikeBonus: 0, sweepBonus: 0, outcome: null, points: 0, totalPoints: items * 10 };
  }

  return { round, idx, label, status: 'pending', items: 0, strikeBonus: 0, sweepBonus: 0, outcome: null, points: 0, totalPoints: 0 };
}

function DoubleModeContent({ side, snapshot, serverStatus, roundResults, dim }: {
  side: 0 | 1; snapshot: GameStateSnapshot | null;
  serverStatus: ServerStatusPayload | null; roundResults: RoundResult[]; dim: PanelDim;
}) {
  const rows: [RoundRowData, RoundRowData] = [
    computeRoundRow(side, 0, roundResults, serverStatus, snapshot),
    computeRoundRow(side, 1, roundResults, serverStatus, snapshot),
  ];
  const sidePoints      = rows[0].points + rows[1].points;
  const sideTotalPoints = rows[0].totalPoints + rows[1].totalPoints;

  return (
    <>
      <RoundSection row={rows[0]} dim={dim} />
      <RoundSection row={rows[1]} dim={dim} />

      {/* ── TOTAL (この画面側=このプログラム自身の2試合合計) ── */}
      <div style={{ ...s.totalSection, padding: `${dim.totalPadV}px ${dim.totalPadH}px` }}>
        <div style={{
          ...s.totalHeader,
          fontSize: dim.totalHeaderFont, marginBottom: dim.totalHeaderMarginB, paddingTop: dim.totalHeaderPadT,
        }}>⭐ TOTAL</div>
        <div style={{ ...s.totalGrid, gap: dim.gridGap }}>
          <StatCell label="勝ち点"      value={`${sidePoints}pt`}      bg={WIN_PALE} color={WIN_BASE} dim={dim} />
          <StatCell label="合計ポイント" value={`${sideTotalPoints}pt`} bg={WIN_PALE} color={WIN_BASE} dim={dim} />
        </div>
      </div>
    </>
  );
}

function RoundSection({ row, dim }: { row: RoundRowData; dim: PanelDim }) {
  const base = row.idx === 0 ? COOL_COLOR : HOT_COLOR;
  const dark = row.idx === 0 ? COOL_DARK  : HOT_DARK;
  const pale = row.idx === 0 ? COOL_PALE  : HOT_PALE;

  return (
    <div style={{ ...s.teamBox, gap: dim.teamBoxGap, paddingBottom: dim.teamBoxPadB }}>
      {/* グラデヘッダー: ラベル (COOL/HOT) + 第何試合か */}
      <div style={{
        ...s.teamHeader,
        padding: `${dim.headerPadV}px ${dim.headerPadH}px`, marginBottom: dim.headerMarginB,
        background: `linear-gradient(135deg, ${base}, ${dark})`,
      }}>
        <span style={{ ...s.dots, fontSize: dim.dotsFont }}>●●●</span>
        <span style={{ ...s.teamLabel, fontSize: dim.labelFont }}>{row.label}</span>
        <span style={{
          ...s.roundBadge,
          fontSize: dim.badgeFont, padding: `${dim.badgePadV}px ${dim.badgePadH}px`,
          background: 'rgba(255,255,255,0.25)', color: '#fff', marginLeft: 'auto',
        }}>
          第{row.round + 1}試合
        </span>
      </div>

      {row.status === 'pending' ? (
        <div style={{
          ...s.roundBadge, fontSize: dim.badgeFont, padding: `${dim.badgePadV}px ${dim.badgePadH}px`,
          background: pale, color: base, alignSelf: 'center',
        }}>未対戦</div>
      ) : (
        <div style={{ ...s.statsGrid, gap: dim.gridGap }}>
          {/* 完了済み (finished) は4列表示になるため、カード幅内に収まるよう全セルを small サイズに揃える */}
          <StatCell label="勝敗"     value={row.outcome ?? '-'} bg={pale} color={base} small={row.status === 'finished'} dim={dim} />
          <StatCell label="アイテム" value={String(row.items)} bg={pale} color={base} small={row.status === 'finished'} dim={dim} />
          {row.status === 'finished' && (
            <>
              <StatCell label="一撃"   value={`${row.strikeBonus}pt`} bg={pale} color={base} small dim={dim} />
              <StatCell label="総取り" value={`${row.sweepBonus}pt`} bg={pale} color={base} small dim={dim} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── TeamSection ───────────────────────────────────────────────────────────────

function TeamSection({ team, points, totalPoints, items, roundResults, doubleMode, dim }: {
  team: 0 | 1; points: number; totalPoints: number; items: number;
  roundResults: RoundResult[]; doubleMode: boolean; dim: PanelDim;
}) {
  const base  = team === 0 ? COOL_COLOR : HOT_COLOR;
  const dark  = team === 0 ? COOL_DARK  : HOT_DARK;
  const pale  = team === 0 ? COOL_PALE  : HOT_PALE;
  const light = team === 0 ? COOL_LIGHT : HOT_LIGHT;
  const label = team === 0 ? 'COOL' : 'HOT';

  return (
    <div style={{ ...s.teamBox, gap: dim.teamBoxGap, paddingBottom: dim.teamBoxPadB }}>
      {/* グラデヘッダー */}
      <div style={{
        ...s.teamHeader,
        padding: `${dim.headerPadV}px ${dim.headerPadH}px`, marginBottom: dim.headerMarginB,
        background: `linear-gradient(135deg, ${base}, ${dark})`,
      }}>
        <span style={{ ...s.dots, fontSize: dim.dotsFont }}>●●●</span>
        <span style={{ ...s.teamLabel, fontSize: dim.labelFont }}>{label}</span>
      </div>

      {/* ラウンド別データ (doubleMode時): 原本 (U15-server) のアイテム/一撃/総取りに対応 */}
      {doubleMode && roundResults.map((rr, i) => (
        <div key={i} style={s.roundRow}>
          <span style={{
            ...s.roundBadge, fontSize: dim.badgeFont, padding: `${dim.badgePadV}px ${dim.badgePadH}px`,
            background: light, color: dark,
          }}>
            第{i + 1}試合
          </span>
          <div style={{ ...s.roundStats, gap: dim.gridGap }}>
            <StatCell label="アイテム" value={String(rr.scores[team])} bg={pale} color={base} small dim={dim} />
            <StatCell label="一撃"    value={`${rr.strikeBonus[team]}pt`} bg={pale} color={base} small dim={dim} />
            <StatCell label="総取り"  value={`${rr.sweepBonus[team]}pt`} bg={pale} color={base} small dim={dim} />
          </div>
        </div>
      ))}

      {/* 現在のゲーム統計 */}
      <div style={{ ...s.statsGrid, gap: dim.gridGap }}>
        <StatCell label="勝ち点"      value={`${points}pt`}      bg={pale} color={base} dim={dim} />
        <StatCell label="合計ポイント" value={`${totalPoints}pt`} bg={pale} color={base} dim={dim} />
        <StatCell label="アイテム"    value={String(items)}      bg={pale} color={base} dim={dim} />
      </div>
    </div>
  );
}

// ── StatCell ─────────────────────────────────────────────────────────────────

function StatCell({ label, value, bg, color, small, dim }: {
  label: string; value: string; bg: string; color: string; small?: boolean; dim: PanelDim;
}) {
  return (
    <div style={{ ...cellS.wrap, flex: 1 }}>
      <div style={{ ...cellS.label, fontSize: dim.statLabelFont }}>{label}</div>
      <div style={{
        ...cellS.value,
        background: bg,
        color,
        fontSize: small ? dim.statValueFontSmall : dim.statValueFont,
        padding: `${dim.statValuePadV}px ${dim.statValuePadH}px`,
      }}>
        {value}
      </div>
    </div>
  );
}

const cellS: Record<string, React.CSSProperties> = {
  wrap:  { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0, width: '100%' },
  // fontSize/padding はレンダー時に dim (盤面サイズ連動) で上書きされる
  label: {
    color: TEXT_MUTED, letterSpacing: '0.04em', width: '100%', textAlign: 'center',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  value: {
    fontFamily: FONT_NUM, fontWeight: 700, textAlign: 'center',
    borderRadius: RADIUS_SM, width: '100%',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
};

// ── Styles ───────────────────────────────────────────────────────────────────
// width/padding/gap/fontSize の多くはレンダー時に dim (盤面サイズ連動) で上書きされる

const s: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex', flexDirection: 'column', gap: 0,
    background: BG_CARD, borderRadius: RADIUS_MD, boxShadow: SHADOW_SM,
    flexShrink: 0,
    // 実測補正が効くまでの一瞬 (フルスケール描画時) に内容がはみ出ても下端が無言で消えないよう、
    // 縦方向は auto (必要なら軽くスクロール) にする。横方向は cardW を超えないよう hidden のまま。
    overflowX: 'hidden', overflowY: 'auto', fontFamily: FONT_UI,
    alignSelf: 'stretch',  // 親の高さに合わせて縦に伸びる
  },
  teamBox: {
    display: 'flex', flexDirection: 'column',
    padding: '0 8px',
    borderBottom: `1px solid ${BORDER_COLOR}`,
  },
  teamHeader: {
    display: 'flex', alignItems: 'center', gap: 6,
    margin: '0 -8px',
    color: '#fff',
  },
  dots: { opacity: 0.7, letterSpacing: 2, whiteSpace: 'nowrap' },
  teamLabel: { fontWeight: 700, letterSpacing: '0.08em', whiteSpace: 'nowrap' },
  statsGrid: { display: 'flex' },
  roundRow: { display: 'flex', flexDirection: 'column', gap: 3 },
  roundBadge: {
    fontWeight: 600, whiteSpace: 'nowrap',
    borderRadius: 99, alignSelf: 'flex-start',
  },
  roundStats: { display: 'flex' },
  totalSection: {
    background: WIN_PALE,
  },
  totalHeader: {
    fontWeight: 700, color: WIN_BASE,
    letterSpacing: '0.06em',
    borderTop: `2px solid ${WIN_LIGHT}`,
  },
  totalGrid: { display: 'flex' },
};
