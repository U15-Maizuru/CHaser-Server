import { useState } from 'react';
import { useGameState } from '../../hooks/useGameState';
import { BracketView } from './BracketView';
import { LeagueTable } from './LeagueTable';
import { TournamentPanel } from './TournamentPanel';
import {
  BG_CARD, BG_ROOT, BORDER_COLOR, FONT_UI, RADIUS_MD, SHADOW_MD,
  TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY,
} from '../../styles/tokens';

// ?mode=tournament — 運営席の専用ウィンドウ。
// 左に全体のトーナメント表 / リーグ表、右に運営パネル。

export interface TournamentModeProps {
  wsUrl:    string;
  roomId:   string;
  httpBase: string;
}

export function TournamentMode({ wsUrl, roomId, httpBase }: TournamentModeProps) {
  const state = useGameState(wsUrl, roomId);
  const [selected, setSelected] = useState<string | null>(null);
  const t = state.tournamentState;

  if (!state.isConnected) {
    return <div style={connecting}>バックエンドに接続中...</div>;
  }

  const download = (format: string) => {
    if (!t) return;
    const url = `${httpBase}/api/tournament/${encodeURIComponent(t.tournamentId)}/export?format=${format}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    a.click();
  };

  return (
    <div style={root}>
      <div style={main}>
        <header style={header}>
          <h1 style={h1}>{t?.name ?? '大会運営'}</h1>
          {t && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={btn} onClick={() => download('json')}>JSON</button>
              <button style={btn} onClick={() => download('matches.csv')}>試合CSV</button>
              {t.format === 'league' && (
                <button style={btn} onClick={() => download('standings.csv')}>順位CSV</button>
              )}
            </div>
          )}
        </header>

        <div style={board}>
          {!t ? (
            <div style={empty}>
              右のパネルで大会を選ぶと、ここにトーナメント表が表示されます。
            </div>
          ) : t.format === 'league' ? (
            <LeagueTable
              matches={t.matches}
              participants={t.participants}
              standings={t.standings ?? []}
              interactive
              onSelect={setSelected}
            />
          ) : (
            <BracketView
              matches={t.matches}
              participants={t.participants}
              interactive
              selectedId={selected}
              onSelect={setSelected}
            />
          )}
        </div>

        {t && selected && (
          <div style={selectedBar}>
            <span style={{ flex: 1 }}>
              選択中: {t.matches.find(m => m.id === selected)?.label}
            </span>
            <button style={btn} onClick={() => state.tournament.arm(selected)}>
              この試合を準備 ▶
            </button>
            <button style={btnGhost} onClick={() => setSelected(null)}>解除</button>
          </div>
        )}
      </div>

      <aside style={side}>
        <TournamentPanel
          state={t}
          httpBase={httpBase}
          commands={state.tournament}
          lastError={state.lastError}
          clearError={state.clearError}
        />
      </aside>
    </div>
  );
}

const root: React.CSSProperties = {
  display: 'flex', height: '100vh', background: BG_ROOT,
  fontFamily: FONT_UI, color: TEXT_PRIMARY, overflow: 'hidden',
};

const main: React.CSSProperties = {
  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
  padding: 16, gap: 12, overflow: 'hidden',
};

const header: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
};

const h1: React.CSSProperties = { margin: 0, fontSize: 20, fontWeight: 700 };

const board: React.CSSProperties = {
  flex: 1, minHeight: 0, background: BG_CARD, borderRadius: RADIUS_MD,
  border: `1px solid ${BORDER_COLOR}`, boxShadow: SHADOW_MD,
  padding: 12, overflow: 'auto',
};

const side: React.CSSProperties = {
  width: 400, flexShrink: 0, padding: 16, overflowY: 'auto',
  borderLeft: `1px solid ${BORDER_COLOR}`,
};

const selectedBar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  background: BG_CARD, border: `1px solid ${BORDER_COLOR}`,
  borderRadius: RADIUS_MD, padding: '10px 14px', fontSize: 13,
};

const btn: React.CSSProperties = {
  border: 'none', borderRadius: 999, background: '#3d88e8', color: '#fff',
  fontFamily: FONT_UI, fontWeight: 700, fontSize: 12, padding: '7px 14px', cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  ...btn, background: 'transparent', color: TEXT_SECONDARY,
};

const empty: React.CSSProperties = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: TEXT_MUTED, fontSize: 13,
};

const connecting: React.CSSProperties = {
  display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center',
  background: '#0d1117', color: '#666', fontFamily: 'monospace', fontSize: 16,
};
