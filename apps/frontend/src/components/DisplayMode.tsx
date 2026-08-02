import type { ServerStatusPayload, TournamentStatePayload } from '@u15/ws-types';
import { DEFAULT_DISPLAY_PREFS } from '@u15/ws-types';
import { useGameState } from '../hooks/useGameState';
import { useGamePhaseSound } from '../hooks/useGamePhaseSound';
import { useStartCountdown } from '../hooks/useStartCountdown';
import { useBgm } from '../hooks/useBgm';
import { MainWindow } from './MainWindow';
import { BracketView } from './tournament/BracketView';
import { LeagueTable } from './tournament/LeagueTable';
import { idxForSide } from '../lib/roundSide';
import { roundPointsFor } from '../lib/setResult';
import {
  BG_ROOT, BG_CARD,
  COOL_COLOR, COOL_DARK, COOL_PALE,
  HOT_COLOR,  HOT_DARK,  HOT_PALE,
  TURN_BASE, TURN_LIGHT,
  WIN_BASE, WIN_LIGHT,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  SHADOW_MD, SHADOW_SM,
  RADIUS_MD,
  FONT_UI, FONT_NUM,
} from '../styles/tokens';

export function DisplayMode({ wsUrl, roomId, httpBase }: { wsUrl: string; roomId: string; httpBase: string }) {
  const state   = useGameState(wsUrl, roomId);
  const { serverStatus, snapshot, turnInfo, gameEnd, isConnected } = state;
  const prefs = serverStatus?.displayPrefs ?? DEFAULT_DISPLAY_PREFS;
  const phase = serverStatus?.phase ?? 'setup';

  useGamePhaseSound(snapshot, serverStatus, gameEnd, turnInfo, prefs.muted, true);
  const countdown = useStartCountdown(serverStatus?.phase, turnInfo);
  useBgm(httpBase, serverStatus?.phase, prefs.bgmTrack, prefs.bgmMuted, true);

  if (!isConnected) {
    return (
      <div style={splash.root}>
        <div style={splash.title}>{prefs.displayTitle}</div>
        <div style={splash.sub}>バックエンドに接続中...</div>
      </div>
    );
  }

  if (phase === 'setup') {
    return (
      <SetupWaiting
        serverStatus={serverStatus}
        displayTitle={prefs.displayTitle}
        tournament={state.tournamentState}
      />
    );
  }

  return (
    <div style={{ height: '100vh' }}>
      <MainWindow
        snapshot={snapshot}
        turnInfo={turnInfo}
        gameEnd={gameEnd}
        serverStatus={serverStatus}
        isConnected={isConnected}
        phase={phase}
        theme={prefs.theme}
        variant="display"
        countdown={countdown}
        displayTitle={prefs.displayTitle}
      />
    </div>
  );
}

// ── 待機画面 ──────────────────────────────────────────────────────────────────

const STATE_LABEL: Record<string, string> = {
  waiting:   '接続待ち',
  connected: '接続中...',
  ready:     '準備完了',
};

function stateBadgeStyle(state: string): React.CSSProperties {
  switch (state) {
    case 'ready':     return { background: WIN_LIGHT,   color: WIN_BASE };
    case 'connected': return { background: TURN_LIGHT,  color: TURN_BASE };
    default:          return { background: '#e8e4f0',   color: TEXT_MUTED };
  }
}

// team-index (0=COOL / 1=HOT) ごとの配色一式
const TEAM_COLORS = [
  { label: 'COOL', color: COOL_COLOR, dark: COOL_DARK, pale: COOL_PALE },
  { label: 'HOT',  color: HOT_COLOR,  dark: HOT_DARK,  pale: HOT_PALE  },
] as const;

function SetupWaiting({ serverStatus, displayTitle, tournament }: {
  serverStatus: ServerStatusPayload | null;
  displayTitle: string;
  /** 大会運営中なら、待機中にトーナメント表 / リーグ表を見せる */
  tournament?: TournamentStatePayload | null;
}) {
  const clients      = serverStatus?.clients;
  const doubleMode   = serverStatus?.doubleMode ?? false;
  const currentRound = serverStatus?.currentRound ?? 0;
  const roundResults = serverStatus?.roundResults ?? [];

  // 2ゲーム制の第1ゲームと第2ゲームの間 (プログラム再接続待ち)。この間 snapshot は破棄されるが
  // roundResults は ServerStatusPayload に残るので、ここから第1ゲームの結果を再構成できる。
  const intermission = doubleMode && roundResults.length === 1 ? roundResults[0] : null;

  // カードの左右は MainWindow と同じく idxForSide で決める。そうしないと swapSlotConfigs 後の
  // 待機画面だけプログラムの左右が入れ替わって見え、第2ゲームが始まるとまた元に戻ってしまう。
  // 第1ゲーム前 (currentRound=0) は恒等写像なので、従来どおり COOL が左・HOT が右になる。
  const leftIdx  = idxForSide(0, currentRound);
  const rightIdx = idxForSide(1, currentRound);

  return (
    <div style={sw.root}>
      {/* タイトル */}
      <div style={sw.titleWrap}>
        <div style={sw.title}>{displayTitle}</div>
        <div style={sw.sub}>
          {doubleMode ? `第${currentRound + 1}ゲーム — ` : ''}対戦開始をお待ちください
        </div>
      </div>

      {/* 第1ゲームの結果 (2ゲーム制のインターミッション中のみ) */}
      {intermission && (
        <div style={sw.recap}>
          <div style={sw.recapTitle}>第1ゲームの結果</div>
          <div style={sw.recapRow}>
            <span style={sw.recapName}>{intermission.playerNames[idxForSide(0, intermission.round)]}</span>
            <span style={sw.recapScore}>{roundPointsFor(intermission, 0)}</span>
            <span style={sw.recapDash}>—</span>
            <span style={sw.recapScore}>{roundPointsFor(intermission, 1)}</span>
            <span style={sw.recapName}>{intermission.playerNames[idxForSide(1, intermission.round)]}</span>
          </div>
          <div style={sw.recapNote}>↳ 先攻・後攻を入れ替えて第2ゲームを行います</div>
        </div>
      )}

      {/* チームカード */}
      {clients && (
        <div style={sw.teams}>
          <TeamCard idx={leftIdx}  name={clients[leftIdx].name  || '---'} state={clients[leftIdx].state} />
          <div style={sw.vs}>VS</div>
          <TeamCard idx={rightIdx} name={clients[rightIdx].name || '---'} state={clients[rightIdx].state} />
        </div>
      )}

      {/* 大会運営中は勝ち上がりを観客に見せる (待機中の間だけ) */}
      {tournament && (
        <div style={sw.bracket}>
          {tournament.format === 'league' ? (
            <LeagueTable
              matches={tournament.matches}
              participants={tournament.participants}
              standings={tournament.standings ?? []}
            />
          ) : (
            <BracketView
              matches={tournament.matches}
              participants={tournament.participants}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TeamCard({ idx, name, state }: { idx: 0 | 1; name: string; state: string }) {
  const { label, color, dark, pale } = TEAM_COLORS[idx];
  const badge = stateBadgeStyle(state);
  return (
    <div style={{ ...tc.card, background: pale }}>
      <div style={{ ...tc.header, background: `linear-gradient(135deg, ${color}, ${dark})` }}>
        {label}
      </div>
      <div style={{ ...tc.name, color: dark }}>{name}</div>
      <div style={{ ...tc.badge, ...badge }}>{STATE_LABEL[state] ?? state}</div>
    </div>
  );
}

// ── スタイル ──────────────────────────────────────────────────────────────────

const splash: Record<string, React.CSSProperties> = {
  root: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: BG_ROOT, fontFamily: FONT_UI, gap: 16,
  },
  title: { fontSize: 32, fontWeight: 800, letterSpacing: '0.04em', color: TEXT_PRIMARY },
  sub:   { fontSize: 16, color: TEXT_MUTED },
};

const sw: Record<string, React.CSSProperties> = {
  root: {
    // 大会のトーナメント表が入ると縦に伸びるので、中央寄せのまま縦スクロールできるようにする
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: BG_ROOT, fontFamily: FONT_UI, gap: 40, padding: '32px 16px',
    boxSizing: 'border-box',
  },
  // 待機中に見せる勝ち上がり表。横に長い図なので中身側でスクロールさせる
  bracket: {
    maxWidth: '100%', display: 'flex', justifyContent: 'center',
  },
  titleWrap: { textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 },
  title: { fontSize: 38, fontWeight: 800, letterSpacing: '0.05em', color: TEXT_PRIMARY },
  sub:   { fontSize: 16, color: TEXT_SECONDARY },
  teams: { display: 'flex', alignItems: 'center', gap: 40 },
  vs: {
    fontSize: 28, fontWeight: 800, color: TEXT_MUTED,
    fontFamily: FONT_NUM, letterSpacing: '0.1em',
  },

  // 第1ゲームの結果 (2ゲーム制のインターミッション)。左右の並びは下のチームカードと揃える
  recap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    padding: '18px 32px',
    background: BG_CARD, borderRadius: RADIUS_MD, boxShadow: SHADOW_SM,
  },
  recapTitle: {
    fontSize: 13, fontWeight: 700, color: WIN_BASE, letterSpacing: '0.1em',
  },
  recapRow:   { display: 'flex', alignItems: 'baseline', gap: 16 },
  recapName:  { fontSize: 18, fontWeight: 700, color: TEXT_PRIMARY, minWidth: 120, textAlign: 'center' },
  recapScore: { fontSize: 34, fontWeight: 800, color: TEXT_PRIMARY, fontFamily: FONT_NUM },
  recapDash:  { fontSize: 22, color: TEXT_MUTED },
  recapNote:  { fontSize: 13, color: TEXT_SECONDARY },
};

const tc: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
    padding: '0 0 20px',
    borderRadius: RADIUS_MD, overflow: 'hidden',
    boxShadow: SHADOW_MD, minWidth: 220,
  },
  header: {
    width: '100%', textAlign: 'center',
    color: '#fff', fontWeight: 800, fontSize: 20,
    padding: '14px 0', letterSpacing: '0.1em',
    marginBottom: 4,
  },
  name:  {
    fontSize: 22, fontWeight: 800,
    minHeight: 32, letterSpacing: '0.02em',
  },
  badge: {
    fontWeight: 700, fontSize: 12,
    padding: '5px 18px', borderRadius: 99, letterSpacing: '0.06em',
  },
};
