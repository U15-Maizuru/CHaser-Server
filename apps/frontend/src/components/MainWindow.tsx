import { useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { clampNum } from '../lib/num';

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

// 勝因 (原本の ResultLabel 相当): 決着理由を必ず表示する。
// 表記は競技ルールの勝利条件に合わせる (TRAPPED = 閉じ込め)。FOULED は競技ルールでは
// 「中断」だが、フッターのリセットボタン (対戦中は「中断」) と紛れるため画面上は
// 「通信エラー」と表示する。
function reasonLabel(reason: Reason): string {
  switch (reason) {
    case Reason.SCORE:     return 'アイテム数';
    case Reason.TRAPPED:   return '閉じ込め';
    case Reason.CONFINED:  return '自縛';
    case Reason.ATTACK:    return 'アタック';
    case Reason.COLLISION: return '衝突';
    case Reason.FOULED:    return '通信エラー';
    default:                return '';
  }
}



// 勝者側にのみ表示する「勝ち」テキスト。反則決着 (自縛/衝突/通信エラー) でも敗者視点の
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

  // ── メイン行 (3カラム) の実サイズを計測 ────────────────────────────────
  // mainRef (行コンテナ) の大きさは子要素 (盤面のセルサイズやサイドパネル幅) には
  // 左右されない。これ「だけ」を測定に使い、セルサイズ・パネル幅は両方ともこの単一の
  // 実測値から analytical に導出する。子要素側を測定してサイズを決めると、その結果が
  // 子要素のサイズ自体を変え、それがまた測定結果を変える…という「測定→反映→再測定」の
  // 循環になるため、常に mainRef だけを測定源にすることでこの循環を避けている。
  //
  // ただし mainRef の**高さ**は子要素以外からは影響を受ける。main は縦並びの列の中で
  // flex:1 なので、同じ列の兄弟 (スコアバー) が厚くなるとその分だけ低くなる。
  // よって「main の高さから決めた値」でスコアバーの寸法を決めてはいけない (下記参照)。
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

  // スコアバーは main と同じ縦並びの**兄弟**なので、その高さは main の高さから差し引かれる。
  // そのためスコアバーの大きさを cellSize (= main の高さ由来) から決めると
  // 「main が高い → 文字が大きい → スコアバーが厚い → main が低い → 文字が小さい → …」
  // という循環になり、cellSize の floor() の境目に当たる高さでは 2 値を往復し続けて
  // 画面が振動する (3840x2160 の 150% 表示など、特定の高さで発生)。
  //
  // これを断ち切るため、スコアバーの寸法は「スコアバーと main が取り合う前の総高さ」
  // から決める。両者は同じ列の兄弟で main が flex:1 なので、
  // main の高さ + スコアバーの高さ = ヘッダー/フッターを除いた残り = スコアバーの
  // 厚みに影響されない安定値になる。この安定値だけを入力にすれば循環が閉じない。
  const scorePadRef = useRef<HTMLDivElement>(null);
  const [scorePadH, setScorePadH] = useState(0);

  useLayoutEffect(() => {
    const el = scorePadRef.current;
    if (!el) { setScorePadH(0); return; }
    // 高さは main から差し引かれる分 = 外形 (padding 込み) なので offsetHeight で読む
    const read = () => setScorePadH(el.offsetHeight);
    const obs = new ResizeObserver(read);
    obs.observe(el);
    read();
    return () => obs.disconnect();
  }, [!!snapshot]);

  // ── セルサイズ / サイドパネル幅を安定した mainSize から一意に導出 ──────────
  const MAIN_GAP    = 12; // s.main の gap と一致させる
  // サイドパネルの可読性のための固定最小幅 (盤面サイズに連動させない)。2ゲーム制は明細行の
  // ラベルと値が横に並ぶぶん幅を要求するため、この分だけ広く取る。doubleMode はセットアップ中
  // しか変更できないので、対戦中に盤面サイズが飛ぶことはない。
  const PANEL_MIN_W = doubleMode ? 130 : 110;
  const mapW = snapshot?.size.x ?? 0;
  const mapH = snapshot?.size.y ?? 0;

  // 幅制約: サイドパネルが最小幅を取った後に残る幅を基準に計算 (これが「幅方向の上限」)。
  // main の幅は列の高さの取り合いに影響されないので、この値は常に安定している。
  const byWAtMinPanel = mapW > 0
    ? Math.floor((mainSize.width - PANEL_MIN_W * 2 - MAIN_GAP * 2) / mapW)
    : 0;

  let cellSize = 28;
  if (mapW > 0 && mapH > 0) {
    // 高さ制約: サイドパネルの幅に関わらず main の高さいっぱいまで使える
    const byH = Math.floor(mainSize.height / mapH);
    // 上限 640 は極端に小さいマップでの暴走防止用の安全弁のみ
    cellSize = Math.max(10, Math.min(byH, byWAtMinPanel, 640));
  }
  const boardW = cellSize * mapW;

  // サイドパネルの幅: 行の実幅から盤面幅を差し引いた「本当の余り幅」を使う。盤面が
  // 高さ側で頭打ちになり幅に余りが出るケースでも、その余りをサイドパネルの拡大に使う。
  const leftoverW = Math.max(0, mainSize.width - boardW - MAIN_GAP * 2);
  const panelW    = Math.max(PANEL_MIN_W, leftoverW / 2);

  // ── スコアバー: 盤面の表示サイズに応じて内部要素を最大化 ──────────────────────
  // 「マップが今どれだけ大きく表示されているか」を基準に、スコアバーの幅・文字サイズ・
  // 余白を連動させる。基準点 28 からの平方根スケールで伸ばすことで、盤面が非常に大きい
  // 場合でも文字が線形に暴走しないようにする。
  //
  // ただし基準に cellSize そのものを使うと上記の循環に入るため、スコアバーが自分の厚みを
  // 差し引く前の高さ (budgetH) から求めた nominalCell を使う。cellSize とはスコアバー
  // 1本ぶんの差しかないので見た目はほぼ変わらず、入力が安定値なので振動しない。
  const budgetH = mainSize.height + scorePadH;
  let nominalCell = 28;
  if (mapW > 0 && mapH > 0) {
    nominalCell = Math.max(10, Math.min(Math.floor(budgetH / mapH), byWAtMinPanel, 640));
  }
  const mapScale = Math.sqrt(nominalCell / 28);
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
        <div ref={scorePadRef} style={s.scorePad}>
          <div style={{
            ...s.scoreCard,
            columnGap: scoreDim.gap,
            padding: `${scoreDim.cardPadV}px ${scoreDim.cardPadH}px`,
            minWidth: boardW > 0 ? boardW : undefined,
          }}>
            {/* 左側グループ: 名前+スコアを左寄せ (右側グループと独立) */}
            <div style={{ ...s.scoreSide, justifyContent: 'flex-start', gap: scoreDim.gap }}>
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

            {/* 右側グループ: 名前+スコアを右寄せ */}
            <div style={{ ...s.scoreSide, justifyContent: 'flex-end', gap: scoreDim.gap }}>
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
            <PlayerSidePanel side={0} snapshot={snapshot} serverStatus={serverStatus} width={panelW} maxHeight={mainSize.height} />

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
  // 左右グループの共通シェル。justifyContent は呼び出し側で 'flex-start'/'flex-end' を指定し、
  // それぞれ独立して左寄せ・右寄せにする
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
