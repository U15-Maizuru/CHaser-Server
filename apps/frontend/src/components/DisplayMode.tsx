import type { ServerStatusPayload } from '@u15/ws-types';
import { useGameState } from '../hooks/useGameState';
import { useSettings } from '../hooks/useSettings';
import { useGamePhaseSound } from '../hooks/useGamePhaseSound';
import { useStartCountdown } from '../hooks/useStartCountdown';
import { useBgm } from '../hooks/useBgm';
import { MainWindow } from './MainWindow';
import {
  BG_ROOT,
  COOL_COLOR, COOL_LIGHT, COOL_DARK, COOL_PALE,
  HOT_COLOR,  HOT_LIGHT,  HOT_DARK,  HOT_PALE,
  TURN_BASE, TURN_LIGHT,
  WIN_BASE, WIN_LIGHT,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  SHADOW_MD,
  RADIUS_MD,
  FONT_UI, FONT_NUM,
} from '../styles/tokens';

export function DisplayMode({ wsUrl, roomId, httpBase }: { wsUrl: string; roomId: string; httpBase: string }) {
  const state   = useGameState(wsUrl, roomId);
  const { settings } = useSettings();
  const { serverStatus, snapshot, turnInfo, gameEnd, isConnected } = state;
  const phase = serverStatus?.phase ?? 'setup';

  useGamePhaseSound(snapshot, serverStatus, gameEnd, turnInfo, settings.muted, true);
  const countdown = useStartCountdown(serverStatus?.phase, turnInfo);
  useBgm(httpBase, serverStatus?.phase, settings.bgmTrack, settings.bgmMuted, true);

  if (!isConnected) {
    return (
      <div style={splash.root}>
        <div style={splash.title}>{settings.displayTitle}</div>
        <div style={splash.sub}>バックエンドに接続中...</div>
      </div>
    );
  }

  if (phase === 'setup') {
    return <SetupWaiting serverStatus={serverStatus} displayTitle={settings.displayTitle} />;
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
        theme={settings.theme}
        variant="display"
        countdown={countdown}
        onOpenSettings={() => {}}
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

function SetupWaiting({ serverStatus, displayTitle }: { serverStatus: ServerStatusPayload | null; displayTitle: string }) {
  const clients      = serverStatus?.clients;
  const doubleMode   = serverStatus?.doubleMode ?? false;
  const currentRound = serverStatus?.currentRound ?? 0;

  return (
    <div style={sw.root}>
      {/* タイトル */}
      <div style={sw.titleWrap}>
        <div style={sw.title}>{displayTitle}</div>
        <div style={sw.sub}>
          {doubleMode ? `第${currentRound + 1}試合 — ` : ''}対戦開始をお待ちください
        </div>
      </div>

      {/* チームカード */}
      {clients && (
        <div style={sw.teams}>
          <TeamCard
            label="COOL" color={COOL_COLOR} darkColor={COOL_DARK}
            paleColor={COOL_PALE} lightColor={COOL_LIGHT}
            name={clients[0].name || '---'} state={clients[0].state}
          />
          <div style={sw.vs}>VS</div>
          <TeamCard
            label="HOT"  color={HOT_COLOR}  darkColor={HOT_DARK}
            paleColor={HOT_PALE}  lightColor={HOT_LIGHT}
            name={clients[1].name || '---'} state={clients[1].state}
          />
        </div>
      )}
    </div>
  );
}

function TeamCard({ label, color, darkColor, paleColor, lightColor, name, state }: {
  label: string; color: string; darkColor: string; paleColor: string; lightColor: string;
  name: string; state: string;
}) {
  const badge = stateBadgeStyle(state);
  return (
    <div style={{ ...tc.card, background: paleColor }}>
      <div style={{ ...tc.header, background: `linear-gradient(135deg, ${color}, ${darkColor})` }}>
        {label}
      </div>
      <div style={{ ...tc.name, color: darkColor }}>{name}</div>
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
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: BG_ROOT, fontFamily: FONT_UI, gap: 40,
  },
  titleWrap: { textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 },
  title: { fontSize: 38, fontWeight: 800, letterSpacing: '0.05em', color: TEXT_PRIMARY },
  sub:   { fontSize: 16, color: TEXT_SECONDARY },
  teams: { display: 'flex', alignItems: 'center', gap: 40 },
  vs: {
    fontSize: 28, fontWeight: 800, color: TEXT_MUTED,
    fontFamily: FONT_NUM, letterSpacing: '0.1em',
  },
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
