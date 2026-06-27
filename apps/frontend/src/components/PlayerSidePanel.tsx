import type {
  GameStateSnapshot,
  RoundResult as WsRoundResult,
  ServerStatusPayload,
} from '@u15/ws-types';
import { Winner } from '@u15/ws-types';

type RoundResult = WsRoundResult;

/**
 * 対戦画面の左右プレイヤーパネル
 * 参照: U15-server-maizuru mainwindow.ui (frameA / frameB)
 *
 * side=0 → 左パネル (COOL 視点): COOL→HOT→TOTAL 順, 列=勝ち点|スコア|B/P|アイテム
 * side=1 → 右パネル (HOT 視点) : HOT→COOL→TOTAL 順, 列=アイテム|B/P|スコア|勝ち点 (反転)
 */
interface Props {
  side:         0 | 1;
  snapshot:     GameStateSnapshot | null;
  serverStatus: ServerStatusPayload | null;
}

const KACHI_PER_WIN = 3;

const TEAM_COLOR  = ['#1a5fcc', '#cc1a1a'] as const;  // COOL blue / HOT red
const TEAM_BG     = ['#b3d4ff', '#ffb3b3'] as const;  // COOL item bg / HOT item bg
const TEAM_LABEL  = ['COOL', 'HOT']        as const;

function computeData(snapshot: GameStateSnapshot | null, roundResults: RoundResult[]) {
  // 現在のゲームのスコア (ターン中はアイテム数×10、終了後はroundResultsに入る)
  const curItems: [number, number] = snapshot?.teamScore ?? [0, 0];

  // 完了したラウンドの累積
  const accItems: [number, number] = [
    roundResults.reduce((s, r) => s + r.scores[0], 0),
    roundResults.reduce((s, r) => s + r.scores[1], 0),
  ];
  const accPoints: [number, number] = [
    roundResults.reduce((s, r) => s + r.points[0], 0),
    roundResults.reduce((s, r) => s + r.points[1], 0),
  ];
  const wins: [number, number] = [
    roundResults.filter(r => r.winner === Winner.COOL).length,
    roundResults.filter(r => r.winner === Winner.HOT).length,
  ];

  // 累積 + 現在ゲーム
  const totalItems: [number, number]  = [accItems[0]  + curItems[0],  accItems[1]  + curItems[1]];
  const totalPoints: [number, number] = [accPoints[0] + curItems[0] * 10, accPoints[1] + curItems[1] * 10];
  const kachi: [number, number]       = [wins[0] * KACHI_PER_WIN, wins[1] * KACHI_PER_WIN];

  return { totalItems, totalPoints, kachi };
}

export function PlayerSidePanel({ side, snapshot, serverStatus }: Props) {
  const roundResults = serverStatus?.roundResults ?? [];
  const { totalItems, totalPoints, kachi } = computeData(snapshot, roundResults);

  // 表示順: side=0 → COOL(0)→HOT(1), side=1 → HOT(1)→COOL(0)
  const order: [0 | 1, 0 | 1] = side === 0 ? [0, 1] : [1, 0];

  // TOTAL 計算
  const grandScore = totalPoints[0] + totalPoints[1];
  const grandKachi = kachi[0] + kachi[1];

  return (
    <div style={s.panel}>
      {/* COOL or HOT ボックス (上) */}
      <TeamBox
        team={order[0]}
        items={totalItems[order[0]]}
        score={totalPoints[order[0]]}
        kachi={kachi[order[0]]}
        reversed={side === 1}
      />

      {/* HOT or COOL ボックス (下) */}
      <TeamBox
        team={order[1]}
        items={totalItems[order[1]]}
        score={totalPoints[order[1]]}
        kachi={kachi[order[1]]}
        reversed={side === 1}
      />

      {/* TOTAL ボックス */}
      <div style={s.totalWrap}>
        <div style={s.totalHeader}>TOTAL 合計</div>
        <div style={{ ...s.totalRow, flexDirection: side === 0 ? 'row' : 'row-reverse' }}>
          <div style={s.totalCell}>
            <div style={s.totalLabel}>勝ち点</div>
            <div style={s.totalValue}>{grandKachi}pt</div>
          </div>
          <div style={s.totalCell}>
            <div style={s.totalLabel}>スコア</div>
            <div style={s.totalValue}>{grandScore}pt</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TeamBox ───────────────────────────────────────────────────────────────────

function TeamBox({ team, items, score, kachi, reversed }: {
  team: 0 | 1; items: number; score: number; kachi: number; reversed: boolean;
}) {
  const color   = TEAM_COLOR[team];
  const itemBg  = TEAM_BG[team];
  const label   = TEAM_LABEL[team];

  // 列: side=0 → 勝ち点|スコア|B/P|アイテム, side=1 → アイテム|B/P|スコア|勝ち点
  const cols: { key: string; value: number | string; highlight: boolean }[] = reversed
    ? [
        { key: 'アイテム', value: score,  highlight: true  },
        { key: 'B/P',      value: 0,      highlight: false },
        { key: 'スコア',   value: score,  highlight: true  },
        { key: '勝ち点',   value: kachi,  highlight: false },
      ]
    : [
        { key: '勝ち点',   value: kachi,  highlight: false },
        { key: 'スコア',   value: score,  highlight: true  },
        { key: 'B/P',      value: 0,      highlight: false },
        { key: 'アイテム', value: score,  highlight: true  },
      ];

  return (
    <div style={s.teamBox}>
      <div style={{ ...s.teamHeader, background: color }}>{label}</div>
      <div style={s.colRow}>
        {cols.map(col => (
          <div key={col.key} style={s.col}>
            <div style={s.colLabel}>{col.key}</div>
            <div style={{
              ...s.colValue,
              background: col.highlight ? itemBg : '#fff',
              borderColor: col.highlight ? color : '#aaa',
            }}>
              {col.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex', flexDirection: 'column', gap: 10,
    padding: '10px 12px',
    background: '#ffffff',
    border: '2px solid #d0d0c0',
    borderRadius: 8,
    minWidth: 230, maxWidth: 310,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  teamBox: {
    display: 'flex', flexDirection: 'column', gap: 6,
    padding: '6px 8px',
    background: '#fafaf0',
    border: '1px solid #ccc',
    borderRadius: 8,
  },
  teamHeader: {
    color: '#fff', fontWeight: 'bold', fontSize: 14,
    textAlign: 'center', padding: '3px 0', borderRadius: 20,
    letterSpacing: 2,
  },
  colRow: { display: 'flex', gap: 6, justifyContent: 'space-between' },
  col:    { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 },
  colLabel: { fontSize: 10, color: '#666', marginBottom: 2, whiteSpace: 'nowrap' },
  colValue: {
    fontSize: 15, fontWeight: 'bold', color: '#111',
    border: '2px solid', borderRadius: 8,
    padding: '2px 6px', minWidth: 36, textAlign: 'center',
    width: '100%',
  },
  totalWrap: {
    padding: '6px 8px',
    background: '#fafaf0',
    border: '1px solid #ccc',
    borderRadius: 8,
  },
  totalHeader: {
    background: '#228B22', color: '#fff',
    fontWeight: 'bold', fontSize: 14,
    textAlign: 'center', padding: '3px 0', borderRadius: 20,
    letterSpacing: 2, marginBottom: 8,
    position: 'relative',
  },
  totalRow: { display: 'flex', gap: 10, justifyContent: 'center' },
  totalCell: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 },
  totalLabel: { fontSize: 11, color: '#666', marginBottom: 4 },
  totalValue: {
    fontSize: 26, fontWeight: 'bold', color: '#111',
    border: '2px solid #228B22', borderRadius: 8,
    padding: '4px 10px', textAlign: 'center', width: '100%',
    background: '#fff',
  },
};
