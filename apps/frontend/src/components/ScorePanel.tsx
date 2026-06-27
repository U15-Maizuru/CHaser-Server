import type { GameEndPayload, GameStateSnapshot, ServerPhase, TurnStartPayload } from '../types/ws-types';
import { Winner, Reason } from '../types/ws-types';

interface Props {
  snapshot:  GameStateSnapshot | null;
  turnInfo:  TurnStartPayload  | null;
  gameEnd:   GameEndPayload    | null;
  phase:     ServerPhase;
  onReset:   () => void;
}

const TEAM_COLOR = ['#3a82c4', '#c43a3a'] as const;
const TEAM_LABEL = ['COOL', 'HOT'] as const;

export function ScorePanel({ snapshot, turnInfo, gameEnd, phase, onReset }: Props) {
  const names: [string, string] = snapshot?.playerNames ?? ['COOL', 'HOT'];
  const score: [number, number] = snapshot?.teamScore   ?? [0, 0];
  const turn  = snapshot?.turnCount ?? 0;
  const items = snapshot?.leaveItems ?? 0;

  return (
    <div style={styles.panel}>
      {/* Teams */}
      <div style={styles.teams}>
        {([0, 1] as const).map((t) => (
          <div key={t} style={{ ...styles.teamBox, borderColor: TEAM_COLOR[t] }}>
            <span style={{ ...styles.teamLabel, color: TEAM_COLOR[t] }}>
              {TEAM_LABEL[t]}
            </span>
            <span style={styles.teamName}>{names[t]}</span>
            <span style={styles.teamScore}>{score[t]}</span>
          </div>
        ))}
      </div>

      {/* Turn & items */}
      <div style={styles.info}>
        <div style={styles.infoRow}>
          <span style={styles.infoLabel}>残りターン</span>
          <span style={styles.infoValue}>{turn}</span>
        </div>
        <div style={styles.infoRow}>
          <span style={styles.infoLabel}>残りアイテム</span>
          <span style={styles.infoValue}>{items}</span>
        </div>
        {turnInfo && (
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>行動中</span>
            <span style={{ ...styles.infoValue, color: TEAM_COLOR[turnInfo.player] }}>
              {TEAM_LABEL[turnInfo.player]}
            </span>
          </div>
        )}
      </div>

      {/* Game result */}
      {gameEnd && <GameResult result={gameEnd} phase={phase} onReset={onReset} />}
    </div>
  );
}

function GameResult({ result, phase, onReset }: { result: GameEndPayload; phase: ServerPhase; onReset: () => void }) {
  const winnerText =
    result.winner === Winner.DRAW
      ? 'DRAW'
      : result.winner === Winner.COOL
      ? `${result.playerNames[0]} WIN!`
      : `${result.playerNames[1]} WIN!`;

  const reasonText = REASON_LABELS[result.reason] ?? '';

  return (
    <div style={styles.result}>
      <div style={styles.resultTitle}>{winnerText}</div>
      <div style={styles.resultReason}>{reasonText}</div>
      <div style={styles.resultScore}>
        {result.playerNames[0]}: {result.finalScore[0]} &nbsp;
        {result.playerNames[1]}: {result.finalScore[1]}
      </div>
      {phase === 'finished' && (
        <button style={styles.resetBtn} onClick={onReset}>セットアップに戻る</button>
      )}
    </div>
  );
}

const REASON_LABELS: Record<number, string> = {
  0: 'アイテム数',
  1: '包囲',
  2: '自縛',
  3: 'アタック',
  4: '衝突',
  5: '通信エラー',
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: 16,
    minWidth: 200,
    background: '#1a1a2e',
    color: '#eee',
    fontFamily: 'monospace',
  },
  teams: { display: 'flex', flexDirection: 'column', gap: 8 },
  teamBox: {
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 12px',
    border: '2px solid',
    borderRadius: 8,
    background: '#16213e',
  },
  teamLabel:  { fontSize: 11, fontWeight: 'bold', letterSpacing: 2 },
  teamName:   { fontSize: 14, marginTop: 2 },
  teamScore:  { fontSize: 32, fontWeight: 'bold', textAlign: 'right' },
  info: { display: 'flex', flexDirection: 'column', gap: 6 },
  infoRow: { display: 'flex', justifyContent: 'space-between' },
  infoLabel: { fontSize: 12, color: '#888' },
  infoValue: { fontSize: 14, fontWeight: 'bold' },
  result: {
    padding: 12,
    background: '#0f3460',
    borderRadius: 8,
    textAlign: 'center',
  },
  resultTitle:  { fontSize: 22, fontWeight: 'bold', marginBottom: 4 },
  resultReason: { fontSize: 13, color: '#aaa' },
  resultScore:  { fontSize: 12, marginTop: 8, color: '#ccc' },
  resetBtn: {
    marginTop: 12,
    padding: '6px 18px',
    border: '1px solid #444',
    borderRadius: 4,
    background: 'transparent',
    color: '#ccc',
    fontSize: 12,
    cursor: 'pointer',
  },
};
