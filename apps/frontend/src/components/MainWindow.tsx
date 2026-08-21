import { useMemo, useRef } from 'react';
import type {
  GameEndPayload, GameStateSnapshot, TurnStartPayload,
  ServerPhase, ServerStatusPayload,
} from '@u15/ws-types';
import { idxForSide, isBlunder, Reason, Winner } from '@u15/ws-types';
import { GameBoardCanvas } from './GameBoardCanvas';
import { PlayerSidePanel } from './PlayerSidePanel';
import { decisiveEffectFrom } from '../lib/decisiveEffect';
import {
  BG_ROOT, BG_CARD, BG_HEADER,
  COOL_COLOR, COOL_LIGHT, COOL_DARK,
  HOT_COLOR,  HOT_LIGHT,  HOT_DARK,
  TURN_BASE,  TURN_LIGHT,
  WIN_BASE,   WIN_PALE,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  SHADOW_SM, SHADOW_MD, BORDER_COLOR,
  RADIUS_SM, RADIUS_LG,
  FONT_UI, FONT_NUM,
} from '../ui';
import { drawText, reasonLabel, winnerText } from '../lib/resultText';
import { useBoardLayout } from '../hooks/useBoardLayout';

interface Props {
  snapshot:        GameStateSnapshot   | null;
  turnInfo:        TurnStartPayload    | null;
  gameEnd:         GameEndPayload      | null;
  serverStatus:    ServerStatusPayload | null;
  isConnected:     boolean;
  phase:           ServerPhase;
  theme?:          string;
  veilAlpha?:      number;   // ダーク幕の濃さ (0-1)。会場に合わせて設定から調整する
  variant:         'control' | 'display';
  countdown:       number | null;
  displayTitle:    string;
}

export function MainWindow({
  snapshot, turnInfo, gameEnd, serverStatus, isConnected, phase,
  theme = 'Jewel', veilAlpha, variant, countdown, displayTitle,
}: Props) {
  const darkMode = (serverStatus?.darkMode ?? false) && countdown === null;

  const turnCount  = snapshot?.turnCount     ?? 0;
  const leaveItems = snapshot?.leaveItems    ?? 0;
  const names      = snapshot?.playerNames   ?? ['COOL', 'HOT'];

  // ステップ数ゲージの最大値 (原本の map.turn 相当): turnCount はゲーム中は単調減少するのみなので、
  // 新しいゲームの開始で値が増加した瞬間を検知して満タン値を更新する
  const maxTurnRef = useRef(0);
  if (snapshot && snapshot.turnCount > maxTurnRef.current) {
    maxTurnRef.current = snapshot.turnCount;
  }
  const maxTurn = maxTurnRef.current;
  const gaugePercent = maxTurn > 0 ? Math.max(0, Math.min(100, (turnCount / maxTurn) * 100)) : 0;

  // 盤面上の決着演出 (敗者の上にブロック / 周囲4マスの強調)。GameBoardCanvas 側は参照の変化を
  // 演出開始のトリガーにしているため、gameEnd が変わったときだけ新しい参照になるようにする
  const decisive = useMemo(() => decisiveEffectFrom(gameEnd), [gameEnd]);

  const winnerTeamIdx = gameEnd?.winner === Winner.COOL ? 0 : gameEnd?.winner === Winner.HOT ? 1 : null;
  const isDraw         = gameEnd?.winner === Winner.DRAW;
  const doubleMode   = serverStatus?.doubleMode   ?? false;
  const currentRound  = serverStatus?.currentRound ?? 0;

  // 盤面反転・左右スコア表示に使う「表示中のゲーム番号」は、今表示している snapshot が
  // 属するゲームに固定する。snapshot の参照が変わった (= 新しいゲームの対局が実際に
  // 始まった) タイミングでのみ更新することで、結果表示中は currentRound が次ゲームへ
  // 先行して進んでいても表示は現在のゲームのまま保たれる。
  const displayRoundRef = useRef(currentRound);
  const prevSnapshotForRoundRef = useRef(snapshot);
  if (snapshot !== prevSnapshotForRoundRef.current) {
    prevSnapshotForRoundRef.current = snapshot;
    displayRoundRef.current = currentRound;
  }
  const displayRound = displayRoundRef.current;
  const flip = doubleMode && displayRound === 1;

  // 画面左右のスコア表示: 第2ゲームは先攻/後攻(COOL/HOT)が入れ替わるため、
  // 画面の左右は固定したまま中身の team-index を round に応じて入れ替える
  const leftIdx    = idxForSide(0, displayRound);
  const rightIdx   = idxForSide(1, displayRound);
  const leftScore  = snapshot?.teamScore[leftIdx]  ?? 0;
  const rightScore = snapshot?.teamScore[rightIdx] ?? 0;

  // ボトムバーの勝者側ピルをどちらの列 (画面左/右) に出すか — 画面左右は固定、
  // 中身の team-index は displayRound に応じて入れ替わる leftIdx/rightIdx で判定する
  // フッターは常に「直前のゲームの」勝敗を表示する (2ゲーム制の第2ゲーム終了時も同様)。
  // 2ゲームの合計ポイントで決まる試合全体の勝者は、サイドパネルの総合欄に付く 🏆 で示す。
  const leftIsWinner  = winnerTeamIdx !== null && winnerTeamIdx === leftIdx;
  const rightIsWinner = winnerTeamIdx !== null && winnerTeamIdx === rightIdx;

  // 盤面のセルサイズ・サイドパネル幅・スコアバーの寸法 (測定源は main 行だけ。詳細は useBoardLayout)
  const { mainRef, scorePadRef, cellSize, panelH, boardW, panelW, scoreDim } = useBoardLayout(snapshot, doubleMode);

  return (
    <div style={s.root}>
      {/* ── ヘッダーバー (観覧用画面では非表示) ────────────────────
          設定への入口は BottomBar に一本化しているため、ここには置かない */}
      {variant === 'control' && (
        <div style={s.headerBar}>
          <span style={s.title}>{displayTitle}</span>
        </div>
      )}

      {/* ── スコアバー ─────────────────────────────────────────── */}
      {snapshot && (
        <div ref={scorePadRef} style={s.scorePad}>
          <div style={{
            ...s.scoreCard,
            columnGap: scoreDim.gap,
            padding: `${scoreDim.cardPadV}px ${scoreDim.cardPadH}px`,
            minWidth: boardW > 0 ? boardW : undefined,
          }}>
            {/* 左側グループ: 名前は左寄せ、獲得スコアは中央のアイテム数ピルに隣接させる。
                space-between で「名前を外側の端、スコアを内側の端」に固定することで、
                名前の長さが左右で違っても中央のアイテム数からのスコアの距離は揃う */}
            <div style={{ ...s.scoreSide, justifyContent: 'space-between', gap: scoreDim.gap }}>
              <span style={{
                ...s.namePill,
                fontSize: scoreDim.nameFont,
                padding: `${scoreDim.namePadV}px ${scoreDim.namePadH}px`,
                background: leftIdx === 0 ? COOL_LIGHT : HOT_LIGHT,
                color:      leftIdx === 0 ? COOL_DARK  : HOT_DARK,
              }}>
                {leftIdx === 0 ? '🔵' : '🔴'} {names[leftIdx]}
              </span>
              <span style={{ ...s.scoreNum, fontSize: scoreDim.numFont, color: leftIdx === 0 ? COOL_COLOR : HOT_COLOR }}>{leftScore}</span>
            </div>

            {/* 中央グループ: 残りアイテム数。自身の幅を持つ grid の中央カラムに置くことで、
                左右グループ (名前の長さ・獲得スコアの桁数) がどう変わっても常に幾何学的中央に来る */}
            <div style={{ ...s.scoreCenter, gap: scoreDim.gap }}>
              <span style={{ ...s.scoreDivider, height: scoreDim.dividerH }} />
              <span style={{ ...s.itemsPill, fontSize: scoreDim.itemsFont, padding: `${scoreDim.itemsPadV}px ${scoreDim.itemsPadH}px` }}>{leaveItems}</span>
              <span style={{ ...s.scoreDivider, height: scoreDim.dividerH }} />
            </div>

            {/* 右側グループ: 左側グループと対称 (名前は右寄せ、スコアは中央側の端に固定) */}
            <div style={{ ...s.scoreSide, justifyContent: 'space-between', gap: scoreDim.gap }}>
              <span style={{ ...s.scoreNum, fontSize: scoreDim.numFont, color: rightIdx === 0 ? COOL_COLOR : HOT_COLOR }}>{rightScore}</span>
              <span style={{
                ...s.namePill,
                fontSize: scoreDim.nameFont,
                padding: `${scoreDim.namePadV}px ${scoreDim.namePadH}px`,
                background: rightIdx === 0 ? COOL_LIGHT : HOT_LIGHT,
                color:      rightIdx === 0 ? COOL_DARK  : HOT_DARK,
              }}>
                {rightIdx === 0 ? '🔵' : '🔴'} {names[rightIdx]}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── メイン3カラム ─────────────────────────────────────── */}
      <div ref={mainRef} style={s.main}>
        {snapshot ? (
          <>
            <PlayerSidePanel side={0} snapshot={snapshot} serverStatus={serverStatus} width={panelW} maxHeight={panelH} />

            {/* 中央列: probe div で実サイズを計測し board を中央に置く */}
            <div style={s.centerProbe}>
              <div style={s.center}>
                <div style={s.boardWrap}>
                  <GameBoardCanvas
                    snapshot={snapshot} theme={theme} cellSize={cellSize} darkMode={darkMode}
                    veilAlpha={veilAlpha}
                    flip={flip} roundEnded={phase === 'finished'} decisive={decisive}
                  />
                  {countdown !== null && (
                    <div style={s.countdownOverlay}>
                      <span style={s.countdownNum}>{countdown}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <PlayerSidePanel side={1} snapshot={snapshot} serverStatus={serverStatus} width={panelW} maxHeight={panelH} />
          </>
        ) : (
          <div style={s.waiting}>
            {isConnected ? 'ゲーム開始を待っています...' : 'バックエンドに接続中...'}
          </div>
        )}
      </div>

      {/* ── ボトムバー ─────────────────────────────────────────── */}
      {snapshot && (
        <div style={s.bottomPad}>
          <div style={{
            ...s.bottomCard,
            // ターンゲージ表示中 (!gameEnd) は左右カラムを content-fit (auto) にして
            // 空のときは幅0にし、中央カラム (1fr) が残り幅を全て取ってゲージを画面幅
            // いっぱいまで広げる。結果ピル表示中は左右均等な 1fr のままにする。
            gridTemplateColumns: gameEnd
              ? 'minmax(0, 1fr) auto minmax(0, 1fr)'
              : 'auto minmax(0, 1fr) auto',
          }}>
            {/* 列1 (左): 左側プレイヤーが勝者のときだけ結果ピルを表示。それ以外は空 */}
            {gameEnd && leftIsWinner && (
              <span style={{
                ...s.resultPill, gridColumn: '1',
                background: leftIdx === 0 ? COOL_LIGHT : HOT_LIGHT,
                color: TEXT_PRIMARY,
              }}>
                {winnerText(gameEnd, gameEnd.playerNames[leftIdx])}
              </span>
            )}

            {/* 列2 (中央): ゲーム中はターンゲージ、引き分け時のみ引き分けピル */}
            {!gameEnd && maxTurn > 0 && (
              <div style={s.turnGaugeGroup}>
                <span style={s.gaugeBarTrack}>
                  <span style={{ ...s.gaugeBarFillLeft, width: `${gaugePercent}%` }} />
                </span>
                <span style={s.turnGaugeNumber}>{turnCount}</span>
                <span style={s.gaugeBarTrack}>
                  <span style={{ ...s.gaugeBarFillRight, width: `${gaugePercent}%` }} />
                </span>
              </div>
            )}
            {gameEnd && isDraw && (
              <span style={s.drawPill}>{drawText(gameEnd)}</span>
            )}

            {/* 列3 (右): 右側プレイヤーが勝者のときだけ結果ピルを表示。列1と対称構造
                (アクションボタンは BottomBar.tsx が別途担当するため、ここでは扱わない) */}
            {gameEnd && rightIsWinner && (
              <span style={{
                ...s.resultPill, gridColumn: '3',
                background: rightIdx === 0 ? COOL_LIGHT : HOT_LIGHT,
                color: TEXT_PRIMARY,
              }}>
                {winnerText(gameEnd, gameEnd.playerNames[rightIdx])}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── スタイル ──────────────────────────────────────────────────────────────────

// ボトムバーの中央行 (結果ピル/引き分けピル/ターンゲージ) で共有する一行の高さ。
// 状態が切り替わってもフッターの高さが変わらないよう、3者で同じ値を使う。
const FOOTER_ROW_H = 'clamp(24px, 3.2vh, 34px)';

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
    background: BG_ROOT, color: TEXT_PRIMARY, fontFamily: FONT_UI,
  },

  // ヘッダーバー (コントロール画面のみ)
  headerBar: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '0.4vh 14px', background: BG_HEADER, flexShrink: 0,
    borderBottom: `1px solid ${BORDER_COLOR}`,
  },
  title: {
    flex: 1, textAlign: 'center',
    fontSize: 'clamp(0.65rem, 1.1vw, 1rem)',
    fontWeight: 700, letterSpacing: '0.06em', color: TEXT_SECONDARY,
  },
  // スコアバー
  scorePad: {
    padding: '0.5vh 14px 0', flexShrink: 0,
  },
  // gap/padding/fontSize/height はレンダー時に scoreDim (盤面サイズ連動) で上書きされる
  // 3カラム grid (左グループ/中央アイテム数/右グループ)。左右のカラムを同じ幅の 1fr にすることで、
  // 名前の長さや獲得スコアの桁数が左右非対称でも、中央のアイテム数は常に幾何学的中央に来る
  // (bottomCard の 3カラム構成と同じ考え方)。
  scoreCard: {
    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems: 'center',
    background: BG_CARD, borderRadius: RADIUS_LG, boxShadow: SHADOW_MD,
  },
  // 左右グループの共通シェル。呼び出し側で justifyContent: 'space-between' を指定し、
  // 名前 (外側の端) と獲得スコア (中央のアイテム数に隣接する内側の端) を両端に振り分ける
  scoreSide: {
    display: 'flex', alignItems: 'center', minWidth: 0,
  },
  // 中央グループ (区切り線+残りアイテム数+区切り線)。幅は中身にフィットし、grid の auto
  // カラムとして左右の 1fr カラムのちょうど中間に固定される
  scoreCenter: {
    display: 'flex', alignItems: 'center', flexShrink: 0,
  },
  namePill: {
    fontWeight: 700,
    borderRadius: 99, letterSpacing: '0.04em', whiteSpace: 'nowrap',
    maxWidth: '32vw', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
  },
  scoreNum: {
    fontFamily: FONT_NUM, fontWeight: 800, lineHeight: 1,
    minWidth: '4ch', textAlign: 'center',
  },
  scoreDivider: {
    width: 1, background: BORDER_COLOR, flexShrink: 0,
  },
  itemsPill: {
    background: WIN_PALE, color: WIN_BASE,
    fontWeight: 800, borderRadius: 99,
    whiteSpace: 'nowrap',
  },

  // メイン3カラム
  main: {
    flex: 1, display: 'flex', alignItems: 'stretch',
    gap: 12, padding: '0.8vh 12px',
    overflow: 'hidden', minHeight: 0,
  },
  // 中央のサイズプローブ: パネル間の残りスペースを全て取る
  centerProbe: {
    flex: 1, minWidth: 0, minHeight: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  center: {
    display: 'flex', flexDirection: 'column',
    gap: '0.8vh', flexShrink: 0, alignItems: 'center',
  },
  boardWrap: {
    position: 'relative',
    borderRadius: RADIUS_SM, overflow: 'hidden', boxShadow: SHADOW_MD,
  },
  countdownOverlay: {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.55)',
  },
  countdownNum: {
    fontFamily: FONT_NUM, fontWeight: 800, color: '#fff',
    fontSize: 'clamp(3rem, 12vw, 9rem)', textShadow: '0 4px 24px rgba(0,0,0,0.5)',
  },

  // ボトムバー
  bottomPad: {
    padding: '0 14px 0.6vh', flexShrink: 0,
  },
  bottomCard: {
    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems: 'center',
    gap: 12, padding: '0.6vh 16px', minHeight: FOOTER_ROW_H,
    background: BG_CARD, borderRadius: RADIUS_LG, boxShadow: SHADOW_SM,
  },
  resultPill: {
    // gridColumn は呼び出し側 (列1/列3) でそれぞれ指定 — 左右対称にするため既定値を持たせない
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '100%', height: FOOTER_ROW_H, boxSizing: 'border-box',
    minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
    textAlign: 'center', fontWeight: 700,
    fontSize: 'clamp(0.5rem, 0.8vw, 0.85rem)',
    padding: '0 10px', borderRadius: 99, letterSpacing: '0.02em',
  },
  // ステップ数ゲージ (原本の TimeBar_A/B 相当): 画面中央に数値を置き、その左右を
  // 独立した2本のゲージバーで挟む。残ターン数が減ると各バーが中央側から先に埋まった
  // ぶんだけ外側から縮んでいき、中央に向かって縮む見た目になる。
  // ゲーム終了時は非表示にして結果ピルに切り替わる。
  // 幅は 100% にして、親の中央カラム (試合中は bottomCard の gridTemplateColumns 側で
  // 1fr に切り替わり残り幅を全て取る) いっぱいまで広げる。
  turnGaugeGroup: {
    gridColumn: '2',
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', height: FOOTER_ROW_H,
  },
  gaugeBarTrack: {
    position: 'relative', overflow: 'hidden',
    flex: 1, minWidth: 0, height: '70%',
    background: TURN_LIGHT, borderRadius: 99,
  },
  gaugeBarFillLeft: {
    position: 'absolute', right: 0, top: 0, bottom: 0,
    background: TURN_BASE, transition: 'width 0.3s ease',
  },
  gaugeBarFillRight: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    background: TURN_BASE, transition: 'width 0.3s ease',
  },
  turnGaugeNumber: {
    fontFamily: FONT_NUM, fontWeight: 800, color: TURN_BASE,
    fontSize: 'clamp(0.9rem, 1.8vw, 1.6rem)', lineHeight: 1,
    minWidth: '2.2em', textAlign: 'center',
  },
  // 引き分け専用ピル (中央列、ターンゲージと排他表示)
  drawPill: {
    gridColumn: '2',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: FOOTER_ROW_H, boxSizing: 'border-box',
    minWidth: 0, maxWidth: '100%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
    textAlign: 'center', fontWeight: 700,
    fontSize: 'clamp(0.5rem, 0.8vw, 0.85rem)',
    padding: '0 10px', borderRadius: 99, letterSpacing: '0.02em',
    background: WIN_PALE, color: TEXT_PRIMARY,
  },
  waiting: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flex: 1, fontSize: 'clamp(0.9rem, 1.8vw, 1.4rem)', color: TEXT_MUTED,
  },
};
