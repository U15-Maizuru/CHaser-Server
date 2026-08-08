import { useLobby } from '../hooks/useLobby';
import type { RoomSummary } from '@u15/ws-types';
import {
  BG_ROOT, BG_CARD, BG_HEADER,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  COOL_COLOR, HOT_COLOR, WIN_BASE,
  BORDER_COLOR, SHADOW_MD, RADIUS_MD, RADIUS_LG,
  FONT_UI, FONT_NUM,
} from '../ui';

const PHASE_LABEL: Record<string, string> = {
  setup:    'セットアップ中',
  playing:  '対戦中',
  finished: '終了',
};

function phaseColor(phase: string): string {
  switch (phase) {
    case 'playing':  return WIN_BASE;
    case 'finished': return TEXT_MUTED;
    default:         return COOL_COLOR;
  }
}

function RoomCard({ room }: { room: RoomSummary }) {
  const createdAgo = Math.floor((Date.now() - room.createdAt) / 60000);
  return (
    <div style={s.roomCard}>
      <div style={s.roomRow}>
        <span style={{ ...s.phaseBadge, color: phaseColor(room.phase), borderColor: phaseColor(room.phase) }}>
          {PHASE_LABEL[room.phase] ?? room.phase}
        </span>
        <span style={s.roomId}>{room.id.slice(0, 8)}…</span>
        <span style={s.roomTime}>{createdAgo}分前</span>
      </div>
      <div style={s.portRow}>
        <span style={s.portLabel}>COOL:</span>
        <span style={{ ...s.portNum, color: COOL_COLOR }}>{room.ports[0]}</span>
        <span style={s.portLabel}>HOT:</span>
        <span style={{ ...s.portNum, color: HOT_COLOR }}>{room.ports[1]}</span>
      </div>
      <a
        href={`?room=${room.id}&mode=display`}
        style={s.watchBtn}
      >
        観戦
      </a>
    </div>
  );
}

export function Lobby({ wsUrl }: { wsUrl: string }) {
  const { rooms, isConnected, createRoom } = useLobby(wsUrl);

  if (!isConnected) {
    return (
      <div style={s.splash}>
        <div style={s.title}>CHaser Server</div>
        <div style={s.sub}>接続中...</div>
      </div>
    );
  }

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span style={s.title}>CHaser Server</span>
        <span style={s.sub}>ロビー</span>
      </div>

      <button style={s.createBtn} onClick={createRoom}>
        + 新しいルームを作成
      </button>

      <div style={s.roomList}>
        {rooms.length === 0 ? (
          <div style={s.empty}>ルームがありません。上のボタンから作成してください。</div>
        ) : (
          rooms.map(room => <RoomCard key={room.id} room={room} />)
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  splash: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: BG_ROOT, fontFamily: FONT_UI, gap: 16,
  },
  root: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center',
    background: BG_ROOT, fontFamily: FONT_UI, padding: '40px 24px', gap: 32,
  },
  header: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
  },
  title: {
    fontSize: 32, fontWeight: 800, letterSpacing: '0.04em', color: TEXT_PRIMARY,
  },
  sub: {
    fontSize: 14, color: TEXT_MUTED,
  },
  createBtn: {
    padding: '12px 32px', fontSize: 15, fontWeight: 700,
    background: COOL_COLOR, color: '#fff',
    border: 'none', borderRadius: RADIUS_MD, cursor: 'pointer',
    letterSpacing: '0.04em',
  },
  roomList: {
    display: 'flex', flexDirection: 'column', gap: 12,
    width: '100%', maxWidth: 520,
  },
  empty: {
    textAlign: 'center', color: TEXT_MUTED, fontSize: 14, padding: '24px 0',
  },
  roomCard: {
    background: BG_CARD,
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: RADIUS_LG,
    boxShadow: SHADOW_MD,
    padding: '16px 20px',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  roomRow: {
    display: 'flex', alignItems: 'center', gap: 12,
  },
  phaseBadge: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
    border: '1px solid', borderRadius: 4, padding: '2px 7px',
  },
  roomId: {
    fontFamily: FONT_NUM, fontSize: 13, color: TEXT_SECONDARY, flex: 1,
  },
  roomTime: {
    fontSize: 11, color: TEXT_MUTED,
  },
  portRow: {
    display: 'flex', alignItems: 'center', gap: 8,
  },
  portLabel: {
    fontSize: 11, color: TEXT_MUTED,
  },
  portNum: {
    fontFamily: FONT_NUM, fontWeight: 700, fontSize: 15,
  },
  watchBtn: {
    display: 'inline-block', alignSelf: 'flex-end',
    padding: '6px 18px', fontSize: 13, fontWeight: 700,
    background: BG_HEADER, color: TEXT_SECONDARY,
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: RADIUS_MD, textDecoration: 'none',
  },
};
