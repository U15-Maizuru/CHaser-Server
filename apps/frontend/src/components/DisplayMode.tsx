import { useEffect, useRef } from 'react';
import type { ServerStatusPayload } from '@u15/ws-types';
import { Winner } from '@u15/ws-types';
import { useGameState } from '../hooks/useGameState';
import { useSettings } from '../hooks/useSettings';
import { useSound, useScoreSound } from '../hooks/useSound';
import { MainWindow } from './MainWindow';

const WS_URL = (import.meta as { env?: { VITE_WS_URL?: string } }).env?.VITE_WS_URL
  ?? 'ws://localhost:8765';

/**
 * 対戦表示専用モード (Electron の displayWindow が読み込む)
 *
 * セットアップ中 → 「対戦開始をお待ちください」待機画面
 * 対戦中/終了後 → MainWindow (ボード + スコアパネル, 操作ボタンなし)
 */
export function DisplayMode() {
  const state   = useGameState(WS_URL);
  const { settings } = useSettings();
  const { play } = useSound();
  const { serverStatus, snapshot, turnInfo, gameEnd, isConnected } = state;
  const phase = serverStatus?.phase ?? 'setup';

  useScoreSound(snapshot, settings.muted, play);

  const prevPhase = useRef(serverStatus?.phase);
  useEffect(() => {
    if (settings.muted) return;
    const p = serverStatus?.phase;
    if (prevPhase.current !== 'playing' && p === 'playing') play('go');
    if (p === 'finished' && gameEnd) {
      play('finish');
      if (gameEnd.winner === Winner.COOL || gameEnd.winner === Winner.HOT)
        setTimeout(() => play('win'), 800);
    }
    prevPhase.current = p;
  }, [serverStatus?.phase, gameEnd, play, settings.muted]);

  if (!isConnected) {
    return (
      <div style={s.splash}>
        <div style={s.title}>U15 Server Maizuru</div>
        <div style={s.sub}>バックエンドに接続中...</div>
      </div>
    );
  }

  if (phase === 'setup') {
    return <SetupWaiting serverStatus={serverStatus} />;
  }

  // playing / finished — ボードを常時表示 (操作は全て no-op)
  return (
    <MainWindow
      snapshot={snapshot}
      turnInfo={turnInfo}
      gameEnd={gameEnd}
      serverStatus={serverStatus}
      isConnected={isConnected}
      phase={phase}
      theme={settings.theme}
      manualRequest={state.manualRequest}
      onReset={() => {}}
      onNextRound={() => {}}
      onManualAction={() => {}}
      onOpenSettings={() => {}}
    />
  );
}

// ── 待機画面 ─────────────────────────────────────────────────────────────────

const STATE_LABEL: Record<string, string> = {
  waiting:   '接続待ち',
  connected: '接続中...',
  ready:     '準備完了',
};
const STATE_COLOR: Record<string, string> = {
  waiting:   '#888',
  connected: '#f0a500',
  ready:     '#3fb950',
};

function SetupWaiting({ serverStatus }: { serverStatus: ServerStatusPayload | null }) {
  const clients   = serverStatus?.clients;
  const localIP   = serverStatus?.localIP ?? '...';
  const doubleMode = serverStatus?.doubleMode ?? false;
  const currentRound = serverStatus?.currentRound ?? 0;

  return (
    <div style={sw.root}>
      {/* タイトル */}
      <div style={sw.title}>U15 Server Maizuru</div>
      <div style={sw.sub}>
        {doubleMode ? `第${currentRound + 1}試合 ` : ''}対戦開始をお待ちください
      </div>

      {/* チーム状態 */}
      <div style={sw.teams}>
        {clients ? (
          <>
            <TeamCard
              label="COOL"
              color="#54C3F1"
              name={clients[0].name || '---'}
              state={clients[0].state}
            />
            <div style={sw.vs}>VS</div>
            <TeamCard
              label="HOT"
              color="#EE87B4"
              name={clients[1].name || '---'}
              state={clients[1].state}
            />
          </>
        ) : (
          <div style={sw.connecting}>接続を確認中...</div>
        )}
      </div>

      {/* IP / ポート情報 */}
      <div style={sw.info}>
        <div>ローカル IP: <strong>{localIP}</strong></div>
        <div style={sw.ports}>COOL: port 12031 &nbsp;|&nbsp; HOT: port 12032</div>
      </div>
    </div>
  );
}

function TeamCard({ label, color, name, state }: {
  label: string; color: string; name: string; state: string;
}) {
  return (
    <div style={{ ...tc.card, borderColor: color }}>
      <div style={{ ...tc.header, background: color }}>{label}</div>
      <div style={tc.name}>{name}</div>
      <div style={{ ...tc.badge, background: STATE_COLOR[state] ?? '#888' }}>
        {STATE_LABEL[state] ?? state}
      </div>
    </div>
  );
}

// ── スタイル ─────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  splash: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: '#f0f0d8', fontFamily: 'monospace',
  },
  title: { fontSize: 32, fontWeight: 'bold', letterSpacing: 2, color: '#333' },
  sub:   { fontSize: 16, color: '#888', marginTop: 12 },
};

const sw: Record<string, React.CSSProperties> = {
  root: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: '#f0f0d8', fontFamily: 'monospace', gap: 32,
  },
  title: { fontSize: 38, fontWeight: 'bold', letterSpacing: 3, color: '#222' },
  sub:   { fontSize: 18, color: '#555', marginTop: -20 },
  teams: { display: 'flex', alignItems: 'center', gap: 40 },
  vs:    { fontSize: 36, fontWeight: 'bold', color: '#888' },
  connecting: { fontSize: 16, color: '#888' },
  info:  { textAlign: 'center', color: '#666', fontSize: 13, lineHeight: 1.8 },
  ports: { fontSize: 11, color: '#999' },
};

const tc: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    padding: '16px 24px', border: '3px solid', borderRadius: 12,
    background: '#fff', minWidth: 200,
  },
  header: {
    width: '100%', textAlign: 'center',
    color: '#fff', fontWeight: 'bold', fontSize: 18,
    padding: '6px 0', borderRadius: 20, letterSpacing: 2,
  },
  name:  { fontSize: 20, fontWeight: 'bold', color: '#222', minHeight: 28 },
  badge: {
    color: '#fff', fontWeight: 'bold', fontSize: 13,
    padding: '4px 16px', borderRadius: 20, letterSpacing: 1,
  },
};
