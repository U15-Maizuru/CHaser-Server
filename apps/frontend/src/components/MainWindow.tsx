import { useLayoutEffect, useRef, useState } from 'react';
import type {
  GameEndPayload, GameStateSnapshot, TurnStartPayload,
  ServerPhase, ServerStatusPayload,
} from '@u15/ws-types';
import { Reason, Winner } from '@u15/ws-types';
import { GameBoardCanvas } from './GameBoardCanvas';
import { PlayerSidePanel } from './PlayerSidePanel';
import { idxForSide } from '../lib/roundSide';
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
} from '../styles/tokens';

interface Props {
  snapshot:        GameStateSnapshot   | null;
  turnInfo:        TurnStartPayload    | null;
  gameEnd:         GameEndPayload      | null;
  serverStatus:    ServerStatusPayload | null;
  isConnected:     boolean;
  phase:           ServerPhase;
  theme?:          string;
  variant:         'control' | 'display';
  countdown:       number | null;
  displayTitle:    string;
}

// 勝因 (原本の ResultLabel 相当): 決着理由を必ず表示する
function reasonLabel(reason: Reason): string {
  switch (reason) {
    case Reason.SCORE:     return 'アイテム数';
    case Reason.TRAPPED:   return '包囲';
    case Reason.CONFINED:  return '自縛';
    case Reason.ATTACK:    return 'アタック';
    case Reason.COLLISION: return '衝突';
    case Reason.FOULED:    return 'エラー';
    default:                return '';
  }
}

// 反則 (自縛/衝突/エラー) による決着かどうか — 原本の isBlunder() と同じ定義
function isBlunder(reason: Reason): boolean {
  return reason === Reason.CONFINED || reason === Reason.COLLISION || reason === Reason.FOULED;
}

function clampNum(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

// 勝者側にのみ表示する「勝ち」テキスト。反則決着 (自縛/衝突/エラー) でも敗者視点の
// LOSE 表記にはせず、常に勝者視点の文言 (相手の反則で勝った、という言い回し) にする。
function winnerText(gameEnd: GameEndPayload, winnerName: string): string {
  const reason = reasonLabel(gameEnd.reason);
  return isBlunder(gameEnd.reason)
    ? `⭐ ${winnerName} の勝ち！ (相手の反則: ${reason})`
    : `⭐ ${winnerName} の勝ち！ (${reason})`;
}

function drawText(gameEnd: GameEndPayload): string {
  return `🤝 引き分け (${reasonLabel(gameEnd.reason)})`;
}

export function MainWindow({
  snapshot, turnInfo, gameEnd, serverStatus, isConnected, phase,
  theme = 'Jewel', variant, countdown, displayTitle,
}: Props) {
  const darkMode = (serverStatus?.darkMode ?? false) && countdown === null;

  const turnCount  = snapshot?.turnCount     ?? 0;
  const leaveItems = snapshot?.leaveItems    ?? 0;
  const names      = snapshot?.playerNames   ?? ['COOL', 'HOT'];

  // ステップ数ゲージの最大値 (原本の map.turn 相当): turnCount は試合中は単調減少するのみなので、
  // 新しい試合/ラウンドの開始で値が増加した瞬間を検知して満タン値を更新する
  const maxTurnRef = useRef(0);
  if (snapshot && snapshot.turnCount > maxTurnRef.current) {
    maxTurnRef.current = snapshot.turnCount;
  }
  const maxTurn = maxTurnRef.current;
  const gaugePercent = maxTurn > 0 ? Math.max(0, Math.min(100, (turnCount / maxTurn) * 100)) : 0;

  const winnerTeamIdx = gameEnd?.winner === Winner.COOL ? 0 : gameEnd?.winner === Winner.HOT ? 1 : null;
  const isDraw         = gameEnd?.winner === Winner.DRAW;
  const doubleMode   = serverStatus?.doubleMode   ?? false;
  const currentRound  = serverStatus?.currentRound ?? 0;

  // 盤面反転・左右スコア表示に使う「表示中のラウンド番号」は、今表示している snapshot が
  // 属するラウンドに固定する。snapshot の参照が変わった (= 新しいラウンドの対局が実際に
  // 始まった) タイミングでのみ更新することで、結果表示中は currentRound が次ラウンドへ
  // 先行して進んでいても表示は現在のラウンドのまま保たれる。
  const displayRoundRef = useRef(currentRound);
  const prevSnapshotForRoundRef = useRef(snapshot);
  if (snapshot !== prevSnapshotForRoundRef.current) {
    prevSnapshotForRoundRef.current = snapshot;
    displayRoundRef.current = currentRound;
  }
  const displayRound = displayRoundRef.current;
  const flip = doubleMode && displayRound === 1;

  // 画面左右のスコア表示: 2試合目は先攻/後攻(COOL/HOT)が入れ替わるため、
  // 画面の左右は固定したまま中身の team-index を round に応じて入れ替える
  const leftIdx    = idxForSide(0, displayRound);
  const rightIdx   = idxForSide(1, displayRound);
  const leftScore  = snapshot?.teamScore[leftIdx]  ?? 0;
  const rightScore = snapshot?.teamScore[rightIdx] ?? 0;

  // ボトムバーの勝者側ピルをどちらの列 (画面左/右) に出すか — 画面左右は固定、
  // 中身の team-index は displayRound に応じて入れ替わる leftIdx/rightIdx で判定する
  // フッターは常に「直前のラウンドの」勝敗を表示する (2試合制の第2試合終了時も同様)。
  // 2試合の合計ポイントで決まるセット全体の勝者は、サイドパネルの TOTAL 欄に付く 🏆 で示す。
  const leftIsWinner  = winnerTeamIdx !== null && winnerTeamIdx === leftIdx;
  const rightIsWinner = winnerTeamIdx !== null && winnerTeamIdx === rightIdx;

  // ── メイン行 (3カラム) の実サイズを計測 ────────────────────────────────
  // mainRef (行コンテナ) 自体の幅・高さは子要素 (盤面のセルサイズやサイドパネル幅) に
  // 左右されない安定した値 (ウィンドウサイズだけで決まる)。これ「だけ」を測定に使い、
  // セルサイズ・パネル幅は両方ともこの単一の実測値から analytical に導出する。
  // 子要素側を測定してサイズを決めると、その結果が子要素のサイズ自体を変え、それがまた
  // 測定結果を変える…という「測定→反映→再測定」の循環になるため、常に mainRef だけを
  // 測定源にすることでこの循環を避けている。
  const mainRef = useRef<HTMLDivElement>(null);
  const [mainSize, setMainSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!mainRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setMainSize({ width, height });
    });
    obs.observe(mainRef.current);
    return () => obs.disconnect();
  }, []);

  // ── セルサイズ / サイドパネル幅を安定した mainSize から一意に導出 ──────────
  const MAIN_GAP    = 12; // s.main の gap と一致させる
  const PANEL_MIN_W = 110; // サイドパネルの可読性のための固定最小幅 (盤面サイズに連動させない)
  const mapW = snapshot?.size.x ?? 0;
  const mapH = snapshot?.size.y ?? 0;

  let cellSize = 28;
  if (mapW > 0 && mapH > 0) {
    // 高さ制約: サイドパネルの幅に関わらず main の高さいっぱいまで使える
    const byH = Math.floor(mainSize.height / mapH);
    // 幅制約: サイドパネルが最小幅を取った後に残る幅を基準に計算 (これが「幅方向の上限」)
    const byWAtMinPanel = Math.floor((mainSize.width - PANEL_MIN_W * 2 - MAIN_GAP * 2) / mapW);
    // 上限 640 は極端に小さいマップでの暴走防止用の安全弁のみ
    cellSize = Math.max(10, Math.min(byH, byWAtMinPanel, 640));
  }
  const boardW = cellSize * mapW;

  // サイドパネルの幅: 行の実幅から盤面幅を差し引いた「本当の余り幅」を使う。盤面が
  // 高さ側で頭打ちになり幅に余りが出るケースでも、その余りをサイドパネルの拡大に使う。
  const leftoverW = Math.max(0, mainSize.width - boardW - MAIN_GAP * 2);
  const panelW    = Math.max(PANEL_MIN_W, leftoverW / 2);

  // ── スコアバー: 盤面の実描画サイズ (cellSize) に応じて内部要素を最大化 ──────────
  // cellSize は「マップが今どれだけ大きく表示されているか」そのものなので、これを基準に
  // スコアバーの幅・文字サイズ・余白を連動させる。cellSize=28 (初期値) を基準点とし、
  // 平方根スケールで伸ばすことで、盤面が非常に大きい場合でも文字が線形に暴走しないようにする。
  const mapScale = Math.sqrt(cellSize / 28);
  const scoreDim = {
    numFont:   clampNum(26 * mapScale, 20, 180),
    nameFont:  clampNum(13 * mapScale, 9, 50),
    namePadV:  clampNum(5  * mapScale, 3, 22),
    namePadH:  clampNum(12 * mapScale, 8, 56),
    itemsFont: clampNum(15 * mapScale, 11, 56),
    itemsPadV: clampNum(6  * mapScale, 4, 26),
    itemsPadH: clampNum(13 * mapScale, 10, 60),
    dividerH:  clampNum(28 * mapScale, 20, 130),
    gap:       clampNum(12 * mapScale, 6, 60),
    cardPadV:  clampNum(6  * mapScale, 4, 30),
    cardPadH:  clampNum(18 * mapScale, 10, 90),
  };

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
        <div style={s.scorePad}>
          <div style={{
            ...s.scoreCard,
            gap: scoreDim.gap,
            padding: `${scoreDim.cardPadV}px ${scoreDim.cardPadH}px`,
            minWidth: boardW > 0 ? boardW : undefined,
          }}>
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
            <span style={{ ...s.scoreDivider, height: scoreDim.dividerH }} />
            <span style={{ ...s.itemsPill, fontSize: scoreDim.itemsFont, padding: `${scoreDim.itemsPadV}px ${scoreDim.itemsPadH}px` }}>🎯 {leaveItems}</span>
            <span style={{ ...s.scoreDivider, height: scoreDim.dividerH }} />
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
      )}

      {/* ── メイン3カラム ─────────────────────────────────────── */}
      <div ref={mainRef} style={s.main}>
        {snapshot ? (
          <>
            <PlayerSidePanel side={0} snapshot={snapshot} serverStatus={serverStatus} width={panelW} maxHeight={mainSize.height} />

            {/* 中央列: probe div で実サイズを計測し board を中央に置く */}
            <div style={s.centerProbe}>
              <div style={s.center}>
                <div style={s.boardWrap}>
                  <GameBoardCanvas
                    snapshot={snapshot} theme={theme} cellSize={cellSize} darkMode={darkMode}
                    flip={flip} roundEnded={phase === 'finished'}
                  />
                  {countdown !== null && (
                    <div style={s.countdownOverlay}>
                      <span style={s.countdownNum}>{countdown}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <PlayerSidePanel side={1} snapshot={snapshot} serverStatus={serverStatus} width={panelW} maxHeight={mainSize.height} />
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
          <div style={s.bottomCard}>
            {/* 列1 (左): 左側チームが勝者のときだけ結果ピルを表示。それ以外は空 */}
            {gameEnd && leftIsWinner && (
              <span style={{
                ...s.resultPill, gridColumn: '1',
                background: leftIdx === 0 ? COOL_LIGHT : HOT_LIGHT,
                color: TEXT_PRIMARY,
              }}>
                {winnerText(gameEnd, gameEnd.playerNames[leftIdx])}
              </span>
            )}

            {/* 列2 (中央): 試合中はターンゲージ、引き分け時のみ引き分けピル */}
            {!gameEnd && maxTurn > 0 && (
              <div style={{ ...s.turnGaugeGroup, width: boardW > 0 ? boardW : undefined }}>
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

            {/* 列3 (右): 右側チームが勝者のときだけ結果ピルを表示。列1と対称構造
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
  scoreCard: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexWrap: 'wrap',
    background: BG_CARD, borderRadius: RADIUS_LG, boxShadow: SHADOW_MD,
  },
  namePill: {
    fontWeight: 700,
    borderRadius: 99, letterSpacing: '0.04em', whiteSpace: 'nowrap',
    maxWidth: '32vw', overflow: 'hidden', textOverflow: 'ellipsis',
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
  // 試合終了時は非表示にして結果ピルに切り替わる。
  // 幅は盤面の実描画幅 (boardW) にインラインで合わせる。boardW が未計測の間だけ、
  // このフォールバック幅を使う。
  turnGaugeGroup: {
    gridColumn: '2',
    display: 'flex', alignItems: 'center', gap: 8,
    width: 'clamp(160px, 30vw, 420px)', height: FOOTER_ROW_H,
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
