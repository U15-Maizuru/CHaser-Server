import { useState } from 'react';
import { hasQualifying } from '@u15/ws-types';
import { useGameState } from '../../hooks/useGameState';
import { BracketView } from './board/BracketView';
import { QualifyingView } from './board/QualifyingView';
import { LeagueTable } from './board/LeagueTable';
import { QualifierPicker } from './qualifier/QualifierSection';
import { TournamentPanel } from './panel/TournamentPanel';
import {
  BG_CARD, BG_ROOT, BORDER_COLOR, FONT_UI, RADIUS_MD, SHADOW_MD,
  TEXT_MUTED, TEXT_PRIMARY, Button,
} from '../../ui';

// ?mode=tournament — 運営席の専用ウィンドウ。**大会運営の唯一の入口**。
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
    return <div style={s.connecting}>バックエンドに接続中...</div>;
  }

  return (
    <div style={s.root}>
      <div style={s.main}>
        <div style={s.board}>
          {!t ? (
            <div style={s.empty}>右のパネルで大会を選ぶと、ここに表が表示されます。</div>
          ) : hasQualifying(t.stage.format) ? (
            <QualifyingView
              state={t} interactive selectedId={selected} onSelect={setSelected}
              showTabs maxScale={1.6}
            />
          ) : t.stage.format === 'league' ? (
            <LeagueTable
              matches={t.matches}
              participants={t.participants}
              standings={t.standings ?? []}
              upcomingMatchId={t.armedMatchId}
              interactive
              onSelect={setSelected}
              fit
              maxScale={1.6}
            />
          ) : (
            <BracketView
              matches={t.matches}
              participants={t.participants}
              format={t.stage.format}
              upcomingId={t.armedMatchId}
              interactive
              selectedId={selected}
              onSelect={setSelected}
              fit
              maxScale={1.6}
            />
          )}
        </div>

        {t && selected && (() => {
          const m = t.matches.find(x => x.id === selected);
          // 決勝トーナメントの1回戦を選んだら、その場で進出者を差し替えられるようにする。
          // 運営パネルの一覧と、表のカードと、どちらからでも直せるのが要件
          const swaps = [m?.slotA, m?.slotB].filter(
            (r): r is Extract<NonNullable<typeof m>['slotA'], { kind: 'group-rank' }> =>
              r?.kind === 'group-rank');

          return (
            <div style={s.selectedBar}>
              <span style={{ flex: 1, minWidth: 0 }}>選択中: {m?.label}</span>
              {swaps.map(r => (
                <QualifierPicker
                  key={`${r.group}:${r.rank}`}
                  state={t}
                  group={r.group}
                  rank={r.rank}
                  compact
                  onChange={(pid: string | null, cascade?: boolean) =>
                    state.tournament.setQualifier(r.group, r.rank, pid, cascade)}
                />
              ))}
              <Button variant="accent" size="sm" onClick={() => state.tournament.arm(selected)}>
                この試合を準備 ▶
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>解除</Button>
            </div>
          );
        })()}
      </div>

      <aside style={s.side}>
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

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', height: '100vh', background: BG_ROOT,
    fontFamily: FONT_UI, color: TEXT_PRIMARY, overflow: 'hidden',
  },
  main: {
    flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
    padding: 16, gap: 12, overflow: 'hidden',
  },
  board: {
    // 高さの決まった箱にしておくこと (中の表がこの空きに合わせて自分で拡大・縮小する)
    flex: 1, minHeight: 0, background: BG_CARD, borderRadius: RADIUS_MD,
    border: `1px solid ${BORDER_COLOR}`, boxShadow: SHADOW_MD,
    padding: 12, overflow: 'hidden',
  },
  side: {
    width: 420, flexShrink: 0, padding: 16, overflow: 'hidden',
    borderLeft: `1px solid ${BORDER_COLOR}`,
  },
  selectedBar: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    background: BG_CARD, border: `1px solid ${BORDER_COLOR}`,
    borderRadius: RADIUS_MD, padding: '10px 14px', fontSize: 13,
  },
  empty: {
    height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: TEXT_MUTED, fontSize: 13,
  },
  connecting: {
    display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center',
    background: '#0d1117', color: '#666', fontFamily: 'monospace', fontSize: 16,
  },
};
