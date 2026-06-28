import type {
  GameStateSnapshot,
  RoundResult as WsRoundResult,
  ServerStatusPayload,
} from '@u15/ws-types';
import { Winner } from '@u15/ws-types';
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

type RoundResult = WsRoundResult;

interface Props {
  side:         0 | 1;
  snapshot:     GameStateSnapshot | null;
  serverStatus: ServerStatusPayload | null;
}

const KACHI_PER_WIN = 3;

function computeData(snapshot: GameStateSnapshot | null, roundResults: RoundResult[]) {
  const curItems: [number, number] = snapshot?.teamScore ?? [0, 0];
  const accPoints: [number, number] = [
    roundResults.reduce((s, r) => s + r.points[0], 0),
    roundResults.reduce((s, r) => s + r.points[1], 0),
  ];
  const wins: [number, number] = [
    roundResults.filter(r => r.winner === Winner.COOL).length,
    roundResults.filter(r => r.winner === Winner.HOT).length,
  ];
  const totalPoints: [number, number] = [
    accPoints[0] + curItems[0] * 10,
    accPoints[1] + curItems[1] * 10,
  ];
  const kachi: [number, number] = [wins[0] * KACHI_PER_WIN, wins[1] * KACHI_PER_WIN];
  return { curItems, totalPoints, kachi, roundResults };
}

export function PlayerSidePanel({ side, snapshot, serverStatus }: Props) {
  const roundResults = serverStatus?.roundResults ?? [];
  const doubleMode   = serverStatus?.doubleMode   ?? false;
  const { curItems, totalPoints, kachi } = computeData(snapshot, roundResults);

  // 表示順: side=0 → COOL(0)→HOT(1), side=1 → HOT(1)→COOL(0)
  const order: [0 | 1, 0 | 1] = side === 0 ? [0, 1] : [1, 0];

  const grandKachi = kachi[0] + kachi[1];
  const grandScore = totalPoints[0] + totalPoints[1];

  return (
    <div style={s.card}>
      {/* ── チーム1 ── */}
      <TeamSection
        team={order[0]}
        kachi={kachi[order[0]]}
        score={totalPoints[order[0]]}
        items={curItems[order[0]]}
        roundResults={roundResults}
        doubleMode={doubleMode}
      />

      {/* ── チーム2 ── */}
      <TeamSection
        team={order[1]}
        kachi={kachi[order[1]]}
        score={totalPoints[order[1]]}
        items={curItems[order[1]]}
        roundResults={roundResults}
        doubleMode={doubleMode}
      />

      {/* ── TOTAL ── */}
      <div style={s.totalSection}>
        <div style={s.totalHeader}>⭐ TOTAL</div>
        <div style={s.totalGrid}>
          <StatCell label="勝ち点" value={`${grandKachi}pt`} bg={WIN_PALE} color={WIN_BASE} />
          <StatCell label="スコア"  value={`${grandScore}pt`} bg={WIN_PALE} color={WIN_BASE} />
        </div>
      </div>
    </div>
  );
}

// ── TeamSection ───────────────────────────────────────────────────────────────

function TeamSection({ team, kachi, score, items, roundResults, doubleMode }: {
  team: 0 | 1; kachi: number; score: number; items: number;
  roundResults: RoundResult[]; doubleMode: boolean;
}) {
  const base  = team === 0 ? COOL_COLOR : HOT_COLOR;
  const dark  = team === 0 ? COOL_DARK  : HOT_DARK;
  const pale  = team === 0 ? COOL_PALE  : HOT_PALE;
  const light = team === 0 ? COOL_LIGHT : HOT_LIGHT;
  const label = team === 0 ? 'COOL' : 'HOT';

  return (
    <div style={s.teamBox}>
      {/* グラデヘッダー */}
      <div style={{
        ...s.teamHeader,
        background: `linear-gradient(135deg, ${base}, ${dark})`,
      }}>
        <span style={s.dots}>●●●</span>
        <span style={s.teamLabel}>{label}</span>
      </div>

      {/* ラウンド別データ (doubleMode時) */}
      {doubleMode && roundResults.map((rr, i) => (
        <div key={i} style={s.roundRow}>
          <span style={{ ...s.roundBadge, background: light, color: dark }}>
            第{i + 1}試合
          </span>
          <div style={s.roundStats}>
            <StatCell label="勝ち点" value={`${rr.winner === (team === 0 ? Winner.COOL : Winner.HOT) ? KACHI_PER_WIN : 0}pt`} bg={pale} color={base} small />
            <StatCell label="スコア" value={`${rr.scores[team]}pt`} bg={pale} color={base} small />
            <StatCell label="ポイント" value={`${rr.points[team]}pt`} bg={pale} color={base} small />
          </div>
        </div>
      ))}

      {/* 現在のゲーム統計 */}
      <div style={s.statsGrid}>
        <StatCell label="勝ち点"  value={`${kachi}pt`}  bg={pale} color={base} />
        <StatCell label="スコア"   value={`${score}pt`}  bg={pale} color={base} />
        <StatCell label="アイテム" value={String(items)} bg={pale} color={base} />
      </div>
    </div>
  );
}

// ── StatCell ─────────────────────────────────────────────────────────────────

function StatCell({ label, value, bg, color, small }: {
  label: string; value: string; bg: string; color: string; small?: boolean;
}) {
  return (
    <div style={{ ...cellS.wrap, flex: 1 }}>
      <div style={cellS.label}>{label}</div>
      <div style={{
        ...cellS.value,
        background: bg,
        color,
        fontSize: small ? '0.85rem' : '1rem',
      }}>
        {value}
      </div>
    </div>
  );
}

const cellS: Record<string, React.CSSProperties> = {
  wrap:  { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 },
  label: { fontSize: 'clamp(0.45rem, 0.75vw, 0.8rem)', color: TEXT_MUTED, letterSpacing: '0.04em' },
  value: {
    fontFamily: FONT_NUM, fontWeight: 700, textAlign: 'center',
    borderRadius: RADIUS_SM, padding: 'clamp(2px, 0.5vh, 6px) 4px', width: '100%',
    fontSize: 'clamp(0.65rem, 1.1vw, 1.2rem)',
  },
};

// ── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex', flexDirection: 'column', gap: 0,
    background: BG_CARD, borderRadius: RADIUS_MD, boxShadow: SHADOW_SM,
    width: 'clamp(110px, 18vw, 240px)', flexShrink: 0,
    overflow: 'hidden', fontFamily: FONT_UI,
    alignSelf: 'stretch',  // 親の高さに合わせて縦に伸びる
  },
  teamBox: {
    display: 'flex', flexDirection: 'column', gap: 'clamp(4px, 0.8vh, 10px)',
    padding: '0 8px clamp(6px, 1vh, 10px)',
    borderBottom: `1px solid ${BORDER_COLOR}`,
  },
  teamHeader: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: 'clamp(5px, 1vh, 12px) 10px', margin: '0 -8px clamp(2px, 0.5vh, 5px)',
    color: '#fff',
  },
  dots: { fontSize: 'clamp(4px, 0.7vw, 8px)', opacity: 0.7, letterSpacing: 2 },
  teamLabel: { fontWeight: 700, fontSize: 'clamp(0.6rem, 1vw, 1.1rem)', letterSpacing: '0.08em' },
  statsGrid: { display: 'flex', gap: 'clamp(3px, 0.6vw, 7px)' },
  roundRow: { display: 'flex', flexDirection: 'column', gap: 3 },
  roundBadge: {
    fontSize: 'clamp(0.45rem, 0.75vw, 0.7rem)', fontWeight: 600, padding: '2px 7px',
    borderRadius: 99, alignSelf: 'flex-start',
  },
  roundStats: { display: 'flex', gap: 3 },
  totalSection: {
    padding: 'clamp(5px, 0.8vh, 10px) 8px clamp(8px, 1.2vh, 14px)',
    background: WIN_PALE,
  },
  totalHeader: {
    fontWeight: 700, fontSize: 'clamp(0.5rem, 0.85vw, 0.9rem)', color: WIN_BASE,
    letterSpacing: '0.06em', marginBottom: 'clamp(4px, 0.7vh, 8px)',
    borderTop: `2px solid ${WIN_LIGHT}`, paddingTop: 'clamp(4px, 0.7vh, 8px)',
  },
  totalGrid: { display: 'flex', gap: 'clamp(4px, 0.8vw, 10px)' },
};
