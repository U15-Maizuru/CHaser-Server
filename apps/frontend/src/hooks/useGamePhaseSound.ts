import { useEffect, useRef } from 'react';
import type { GameEndPayload, GameStateSnapshot, ServerStatusPayload, TurnStartPayload } from '@u15/ws-types';
import { isBlunder, Reason } from '@u15/ws-types';
import { useSound, useScoreSound } from './useSound';

export interface GamePhaseSoundInput {
  httpBase:     string;
  snapshot:     GameStateSnapshot   | null;
  serverStatus: ServerStatusPayload | null;
  gameEnd:      GameEndPayload      | null;
  turnInfo:     TurnStartPayload    | null;
  /** 開始カウントダウンの残り秒。出していない間は null */
  countdown:    number | null;
  /** 表彰画面を出しているか */
  awarding:     boolean;
  muted:        boolean;
  /**
   * この窓で鳴らすか。コントロール窓と観戦窓は同時にマウントされるため、
   * **両方で true にすると二重再生 (フラム) になる** — 観戦窓だけ true にする。
   */
  enabled:      boolean;
}

/**
 * 場面の切り替わりで鳴らす SE。
 *
 * 開始音 (game-start) は固定タイマーではなく、バックエンドが実際にターンループを開始した
 * 合図である turnInfo (turn_start メッセージ) の受信をもって再生する。
 */
export function useGamePhaseSound({
  httpBase, snapshot, serverStatus, gameEnd, turnInfo, countdown, awarding, muted, enabled,
}: GamePhaseSoundInput): void {
  const { play } = useSound(httpBase, enabled);
  const silent = muted || !enabled;
  useScoreSound(snapshot, silent, play);

  // 発火時点の最新値を見られるように ref で持つ
  const silentRef = useRef(silent);
  silentRef.current = silent;

  const prevPhase     = useRef(serverStatus?.phase);
  const awaitingGoRef = useRef(false);

  // 両プログラムが揃った瞬間。立ち上がりでのみ鳴らす (揃ったまま待機し続けるため)
  const allReady = serverStatus?.clients.every(c => c.state === 'ready') ?? false;
  const prevAllReady = useRef(allReady);
  useEffect(() => {
    if (!prevAllReady.current && allReady && !silentRef.current) play('players-ready');
    prevAllReady.current = allReady;
  }, [allReady, play]);

  // phase 遷移の監視: playing に入ったら開始音の待機フラグを立てる。
  // finished なら決着の付き方に応じた終了音を1つだけ鳴らす。
  useEffect(() => {
    const phase = serverStatus?.phase;
    if (prevPhase.current !== 'playing' && phase === 'playing') {
      awaitingGoRef.current = true;
    }
    if (phase === 'finished' && gameEnd) {
      if (!silentRef.current) {
        if (gameEnd.reason === Reason.SCORE) play('end-score');
        else if (isBlunder(gameEnd.reason))  play('end-blunder');
        else                                 play('end-decisive');
      }
    }
    if (phase !== 'playing') {
      awaitingGoRef.current = false;
    }
    prevPhase.current = phase;
  }, [serverStatus?.phase, gameEnd, play]);

  // 開始カウントダウンの秒が変わるたび
  useEffect(() => {
    if (countdown === null) return;
    if (!silentRef.current) play('countdown');
  }, [countdown, play]);

  // turn_start の受信 (= 実際にターンループが始まった瞬間) で開始音を鳴らす
  useEffect(() => {
    if (!turnInfo) return;
    if (awaitingGoRef.current) {
      awaitingGoRef.current = false;
      if (!silentRef.current) play('game-start');
    }
  }, [turnInfo, play]);

  // 表彰画面に入った瞬間
  const prevAwarding = useRef(awarding);
  useEffect(() => {
    if (!prevAwarding.current && awarding && !silentRef.current) play('award-fanfare');
    prevAwarding.current = awarding;
  }, [awarding, play]);
}
