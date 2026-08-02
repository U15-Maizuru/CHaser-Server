import { useLayoutEffect, useRef, useState } from 'react';
import type {
  GameStateSnapshot,
  RoundResult,
  ServerStatusPayload,
} from '@u15/ws-types';
import { Winner } from '@u15/ws-types';
import { idxForSide } from '../lib/roundSide';
import { computeSetResult, roundPointsFor } from '../lib/setResult';
import {
  BG_CARD,
  COOL_COLOR, COOL_DARK, COOL_PALE,
  HOT_COLOR,  HOT_DARK,  HOT_PALE,
  WIN_BASE, WIN_PALE, WIN_LIGHT,
  PENALTY_COLOR,
  TEXT_MUTED,
  SHADOW_SM, BORDER_COLOR,
  RADIUS_SM, RADIUS_MD,
  FONT_UI, FONT_NUM,
} from '../styles/tokens';

function clampNum(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

// 各試合のポイント明細 (カード幅・文字サイズ・余白) を、盤面の実描画サイズに連動した
// スケール (MainWindow から渡される幅) に応じて最大化するための寸法。
interface PanelDim {
  cardW: number;
  teamBoxGap: number; teamBoxPadB: number;
  headerPadV: number; headerPadH: number; headerGap: number; headerMarginB: number;
  labelFont: number;
  badgeFont: number; badgePadV: number; badgePadH: number;
  rowGap: number;
  ledgerLabelFont: number; ledgerValueFont: number;
  subLabelFont: number; subValueFont: number;
  dividerMargin: number;
  totalPadV: number; totalPadH: number;
  totalHeaderFont: number; totalHeaderMarginB: number; totalHeaderPadT: number;
  winsFont: number; winsPadV: number;
  // 1ゲーム制の合計ポイント: パネル唯一の主役なので、他の数値より広いレンジで大きくする
  soloTotalLabelFont: number; soloTotalValueFont: number;
}

// 文字送りの見積り (em)。correction の二分探索は高さ (scrollHeight) しか見ないため、
// 横方向は「この幅なら何 px まで1行に収まるか」をここから逆算して上限にする。
//
// 明細行はラベルと値が同じ行を左右に分け合うため、両方の幅を同時に満たす必要がある。
/** 明細行の最長ラベル「アイテム」= 全角4文字 + letterSpacing ≒ 4.3em */
const LEDGER_LABEL_EM = 4.3;
/** 明細行の値は FONT_NUM (等幅 = 0.6em/文字)。符号付き4桁「+9999pt」= 7文字 ≒ 4.2em + 余裕 */
const LEDGER_VALUE_EM = 4.4;
/** ラベル/値のフォントサイズ比。値の下限を割り込むときだけ MIN まで落として値を優先する */
const LEDGER_LABEL_RATIO     = 0.8;
const LEDGER_LABEL_RATIO_MIN = 0.65;
/** これを下回るなら、ラベルを縮めてでも値のフォントを確保する */
const LEDGER_VALUE_MIN = 12;
// TOTAL 欄のラベル「合計ポイント」= 全角6文字 + letterSpacing ≒ 6.4em
const LABEL_EM = 6.4;
// 1ゲーム制の合計ポイントは符号なし「9999pt」= 6文字 ≒ 3.6em、フォント差の余裕を見て 3.7em
const POINTS_EM = 3.7;
// 勝敗表示「1勝0敗1分」= 漢字3 + 数字3 ≒ 4.7em + 余裕
const WINS_EM = 5.0;
// s.teamBox の左右パディング (明細行の使える幅を求めるのに使う)
const TEAM_BOX_PAD_H = 8;

// width: パネルに割り当てられた実際の幅 (px)。150 は基準幅で、これを 1.0 とした相対スケールを
// 内部要素のフォント/余白計算に使う。correction: 実測した内容の高さがカードの実高さに収まらない
// 場合に PlayerSidePanel 側で計算する縮小補正 (1 = 補正なし)。幅だけを基準に文字サイズを決めると
// 横長で縦が狭いウィンドウのときにカードの高さに収まらないため、実際に DOM を測定して補正する
// (「このくらいの高さになるはず」という事前見積りは実際の余白・行間の誤差で簡単にズレるため、
// 見積りではなく実測ベースにしている)。
function buildDim(width: number, correction: number): PanelDim {
  const scale = (width / 150) * correction;

  // 横方向の余白は先に確定させ、文字が使える実幅を出す
  const rowGap    = clampNum(6 * scale, 4, 24);
  const totalPadH = clampNum(8 * scale, 6, 30);

  // 1ゲーム制の合計ポイント欄 (totalSection の内側いっぱいを1要素が使う)
  const totalInnerW = Math.max(20, width - totalPadH * 2);
  // 明細行の実幅。teamBox 側と totalSection 側で左右余白が違うため、狭いほうに合わせて
  // 1種類のフォントサイズを両方で使う
  const rowsInnerW  = Math.max(20, Math.min(width - TEAM_BOX_PAD_H * 2, totalInnerW));
  const avail       = Math.max(16, rowsInnerW - rowGap);

  // 値のフォントは幅から逆算する。下限 (LEDGER_VALUE_MIN) を割り込む幅では、ラベル側の
  // 比率を落として値の可読性を優先する (数字が読めないパネルは意味がないため)。
  const valueCap = clampNum(16 * scale, 11, 46);
  let labelRatio = LEDGER_LABEL_RATIO;
  let ledgerValueFont = Math.min(valueCap, avail / (labelRatio * LEDGER_LABEL_EM + LEDGER_VALUE_EM));
  if (ledgerValueFont < LEDGER_VALUE_MIN) {
    labelRatio = LEDGER_LABEL_RATIO_MIN;
    ledgerValueFont = Math.min(valueCap, avail / (labelRatio * LEDGER_LABEL_EM + LEDGER_VALUE_EM));
  }
  const ledgerLabelFont = ledgerValueFont * labelRatio;

  return {
    cardW: width,
    teamBoxGap: clampNum(6 * scale, 4, 26),
    teamBoxPadB: clampNum(7 * scale, 5, 26),
    headerPadV: clampNum(7 * scale, 5, 30),
    headerPadH: clampNum(9 * scale, 7, 34),
    headerGap: clampNum(5 * scale, 4, 20),
    headerMarginB: clampNum(4 * scale, 3, 16),
    labelFont: clampNum(14 * scale, 10, 45),
    badgeFont: clampNum(9 * scale, 7, 26),
    badgePadV: clampNum(3 * scale, 2, 11),
    badgePadH: clampNum(7 * scale, 5, 26),
    rowGap,
    ledgerLabelFont,
    ledgerValueFont,
    // 小計は明細の合計なので一段大きく。ラベルが「小計」= 全角2文字と短いぶん幅は足りる
    subLabelFont: ledgerLabelFont * 1.05,
    subValueFont: ledgerValueFont * 1.15,
    dividerMargin: clampNum(3 * scale, 2, 12),
    totalPadV: clampNum(7 * scale, 5, 30),
    totalPadH,
    totalHeaderFont: clampNum(11 * scale, 8, 34),
    totalHeaderMarginB: clampNum(5 * scale, 4, 22),
    totalHeaderPadT: clampNum(4 * scale, 3, 18),
    // 試合勝者を決める第1基準 (勝利数) はこの欄の主役
    winsFont: Math.min(clampNum(22 * scale, 13, 64), totalInnerW / WINS_EM),
    winsPadV: clampNum(4 * scale, 3, 18),
    // 1ゲーム制は文字が大きいぶん横にあふれやすい。ラベルは1行に収まる上限、
    // 値は4桁 (9999pt) が収まる上限で頭打ちにする
    soloTotalLabelFont: Math.min(clampNum(13 * scale, 9, 44), totalInnerW / LABEL_EM),
    soloTotalValueFont: Math.min(clampNum(30 * scale, 18, 140), totalInnerW / POINTS_EM),
  };
}

interface Props {
  side:         0 | 1;
  snapshot:     GameStateSnapshot | null;
  serverStatus: ServerStatusPayload | null;
  width:        number;
  maxHeight:    number;
}

export function PlayerSidePanel({ side, snapshot, serverStatus, width, maxHeight }: Props) {
  const roundResults = serverStatus?.roundResults ?? [];
  const doubleMode   = serverStatus?.doubleMode   ?? false;

  const cardRef = useRef<HTMLDivElement>(null);
  const [correction, setCorrection] = useState(1);

  // 探索の上限。2ゲーム制は行数が多いぶん先に高さが埋まるが、明細行は1行1項目で縦に詰まって
  // いるため、幅基準の等倍 (correction=1) では縦に余ることがある。1ゲーム制は行が「明細3行」と
  // 「合計ポイント」だけでさらに大きく余るので、上限をより高く開く。いずれも buildDim の
  // clampNum の max と幅からの逆算で頭打ちになるため、上限を上げても青天井にはならない。
  const maxCorrection = doubleMode ? 1.6 : 2.2;

  // 実際の内容の高さ (scrollHeight) を実測し、カードの実高さ (maxHeight) に収まる中で
  // 最大のフォントサイズ (correction) を二分探索で求める。フォントサイズ→必要な高さの関係は
  // buildDim 内の各プロパティごとの min/max クランプにより区間ごとに折れ線 (非線形) になって
  // おり、単純な比例計算では最適値に収束しないため、関数の形に関係なく「収まる最大値」に
  // 確実に収束する二分探索を用いる。
  const key = `${Math.round(width / 5)}|${Math.round(maxHeight / 5)}|${doubleMode}|${roundResults.length}`;
  const keyRef = useRef(key);
  const boundsRef = useRef({ lo: 0.35, hi: maxCorrection }); // lo: 収まることが確認済みの最大値 / hi: 収まらないことが確認済みの最小値

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || maxHeight <= 0) return;

    if (keyRef.current !== key) {
      // 幅・高さ・内容の行数が変わったら探索範囲を最初からやり直す
      keyRef.current = key;
      boundsRef.current = { lo: 0.35, hi: maxCorrection };
      if (correction !== 1) setCorrection(1);
      return; // correction=1 での再描画を待ってから測定する
    }

    const fits = el.scrollHeight <= maxHeight + 1;
    let { lo, hi } = boundsRef.current;
    // 「ゲーム中は空欄・終了後は実値」のようにコンテンツの形が変わると、width/maxHeight/
    // doubleMode/roundResults.length のどれも変化しないまま探索範囲が [lo,hi] に収束済み
    // (lo===hi) の状態で実際の要否だけが反転することがある。この場合に再探索が走るよう、
    // 収まらなかったときは lo を、収まったときは hi を、現在値から確実に離して区間を
    // 強制的に開き直す。
    if (fits) {
      lo = correction;
      if (hi <= lo) hi = maxCorrection;
    } else {
      hi = correction;
      if (lo >= hi) lo = Math.max(0.35, hi - 0.1);
    }
    boundsRef.current = { lo, hi };

    const next = hi - lo > 0.02 ? (lo + hi) / 2 : lo;
    if (Math.abs(next - correction) > 0.004) setCorrection(next);
  });

  const dim = buildDim(width, correction);

  return (
    <div ref={cardRef} style={{ ...s.card, width: dim.cardW }}>
      {doubleMode ? (
        <DoubleModeContent
          side={side}
          snapshot={snapshot}
          serverStatus={serverStatus}
          roundResults={roundResults}
          dim={dim}
        />
      ) : (
        <SingleModeContent side={side} snapshot={snapshot} roundResults={roundResults} dim={dim} />
      )}
    </div>
  );
}

// ── 得点の表示 ────────────────────────────────────────────────────────────────

/** ボーナス値の表示。加点は符号付き (+50pt)、減点はそのまま (-9pt)、未加算は 0pt */
function bonusText(n: number): string {
  return n > 0 ? `+${n}pt` : `${n}pt`;
}

/** ボーナス値の色: 加点=ミント / 減点=オレンジ (盤面の自滅演出と同色) / 0=グレー */
function bonusColor(n: number): string {
  if (n > 0) return WIN_BASE;
  if (n < 0) return PENALTY_COLOR;
  return TEXT_MUTED;
}

// ── SingleModeContent (2ゲーム制OFF: 自分側のチームだけを表示) ────────────────────

// 1ゲーム制では idxForSide(side, 0) === side なので、画面側 (side) がそのまま team-index になる。
// 2ゲーム制の DoubleModeContent と同じく「1パネル = 自分側のプログラム」に揃え、左右で同じ表を
// 二重に出さない。勝敗はフッターの結果ピル、獲得アイテム数は上部スコアバーが既に大きく出して
// いるため、このパネルは得点計算の内訳 (アイテム → 一撃 → 総取り → 合計ポイント) に絞る。
function SingleModeContent({ side, snapshot, roundResults, dim }: {
  side: 0 | 1; snapshot: GameStateSnapshot | null; roundResults: RoundResult[]; dim: PanelDim;
}) {
  // 1ゲーム制で roundResults が2件以上になることはない (リピート/リセットのたびに
  // RoundController.resetForNewGame() で消え、2ゲーム制への切り替えは setup 中のみ)
  const rr       = roundResults.find(r => r.round === 0);
  const finished = rr !== undefined;

  const items = rr ? rr.scores[side] : (snapshot?.teamScore[side] ?? 0);
  // ゲーム中は確定していない一撃/総取りを除いた アイテム×10 をライブ表示し、
  // 決着後にボーナス込みの確定値へ切り替える
  const totalPoints = rr ? roundPointsFor(rr, side) : items * 10;

  const base  = side === 0 ? COOL_COLOR : HOT_COLOR;
  const dark  = side === 0 ? COOL_DARK  : HOT_DARK;
  const label = side === 0 ? 'COOL' : 'HOT';

  return (
    <>
      <div style={{ ...s.teamBox, gap: dim.teamBoxGap, paddingBottom: dim.teamBoxPadB }}>
        {/* グラデヘッダー: 自分側のチーム */}
        <div style={{
          ...s.teamHeader,
          gap: dim.headerGap,
          padding: `${dim.headerPadV}px ${dim.headerPadH}px`, marginBottom: dim.headerMarginB,
          background: `linear-gradient(135deg, ${base}, ${dark})`,
        }}>
          <span style={{ ...s.teamLabel, fontSize: dim.labelFont }}>{label}</span>
        </div>

        {/* 得点の明細。一撃/総取りが確定するのは決着後のみだが、ゲーム中も同じ3行を描いて
            高さを確保し、終了の瞬間に行が増えて下の合計ポイントがずれないようにする
            (2ゲーム制の RoundLedger と同じ方針)。未確定は「—」で示す。 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: dim.rowGap }}>
          <LedgerRow
            label="アイテム" value={`${items * 10}pt`} color={base}
            labelFont={dim.ledgerLabelFont} valueFont={dim.ledgerValueFont} gap={dim.rowGap}
          />
          <LedgerRow
            label="一撃"
            value={finished ? bonusText(rr.strikeBonus[side]) : '—'}
            color={finished ? bonusColor(rr.strikeBonus[side]) : TEXT_MUTED}
            labelFont={dim.ledgerLabelFont} valueFont={dim.ledgerValueFont} gap={dim.rowGap}
          />
          <LedgerRow
            label="総取り"
            value={finished ? bonusText(rr.sweepBonus[side]) : '—'}
            color={finished ? bonusColor(rr.sweepBonus[side]) : TEXT_MUTED}
            labelFont={dim.ledgerLabelFont} valueFont={dim.ledgerValueFont} gap={dim.rowGap}
          />
        </div>
      </div>

      {/* ── 合計ポイント (このパネルの主役) ── */}
      <div style={{ ...s.totalSection, padding: `${dim.totalPadV}px ${dim.totalPadH}px` }}>
        <div style={{
          ...s.totalHeader,
          fontSize: dim.soloTotalLabelFont, marginBottom: dim.totalHeaderMarginB, paddingTop: dim.totalHeaderPadT,
        }}>合計ポイント</div>
        <div style={{ ...s.soloTotalValue, fontSize: dim.soloTotalValueFont }}>{totalPoints}pt</div>
      </div>
    </>
  );
}

// ── DoubleModeContent (2ゲーム制ON: ゲームごとに明細を分け、自分側だけの成績を出す) ──────

type RoundRowStatus = 'finished' | 'live' | 'pending';
type RoundOutcome   = 'WIN' | 'LOSE' | 'DRAW';

function roundOutcome(winner: Winner, team: 0 | 1): RoundOutcome {
  if (winner === Winner.DRAW) return 'DRAW';
  return winner === (team === 0 ? Winner.COOL : Winner.HOT) ? 'WIN' : 'LOSE';
}

interface RoundRowData {
  round:       0 | 1;
  idx:         0 | 1;
  label:       'COOL' | 'HOT';
  status:      RoundRowStatus;
  items:       number;
  strikeBonus: number;
  sweepBonus:  number;
  outcome:     RoundOutcome | null;
  /** アイテム + 一撃 + 総取り。2ゲーム分を足すと TOTAL の合計ポイントになる */
  subtotal:    number;
}

// 画面側 (side) ×ゲーム番号 (round) から、確定済み/進行中/未対戦のいずれかを判定してスコア行を組み立てる。
// 第1ゲーム終了直後は phase='finished' のまま currentRound だけ 1 に進むため、対応する
// roundResults が無い限りは (currentRound===round であっても) 進行中とはみなさない —
// これにより第1ゲームの古いスナップショットを第2ゲームの行に誤表示することを防いでいる。
function computeRoundRow(
  side: 0 | 1,
  round: 0 | 1,
  roundResults: RoundResult[],
  serverStatus: ServerStatusPayload | null,
  snapshot: GameStateSnapshot | null,
): RoundRowData {
  const idx   = idxForSide(side, round);
  const label = idx === 0 ? 'COOL' : 'HOT';
  const rr    = roundResults.find(r => r.round === round);

  if (rr) {
    const items       = rr.scores[idx];
    const strikeBonus = rr.strikeBonus[idx];
    const sweepBonus  = rr.sweepBonus[idx];
    return {
      round, idx, label, status: 'finished',
      items, strikeBonus, sweepBonus,
      outcome: roundOutcome(rr.winner, idx),
      subtotal: items * 10 + strikeBonus + sweepBonus,
    };
  }

  const isLive = serverStatus?.currentRound === round && serverStatus?.phase === 'playing';
  if (isLive) {
    const items = snapshot?.teamScore[idx] ?? 0;
    return { round, idx, label, status: 'live', items, strikeBonus: 0, sweepBonus: 0, outcome: null, subtotal: items * 10 };
  }

  return { round, idx, label, status: 'pending', items: 0, strikeBonus: 0, sweepBonus: 0, outcome: null, subtotal: 0 };
}

function DoubleModeContent({ side, snapshot, serverStatus, roundResults, dim }: {
  side: 0 | 1; snapshot: GameStateSnapshot | null;
  serverStatus: ServerStatusPayload | null; roundResults: RoundResult[]; dim: PanelDim;
}) {
  const rows: [RoundRowData, RoundRowData] = [
    computeRoundRow(side, 0, roundResults, serverStatus, snapshot),
    computeRoundRow(side, 1, roundResults, serverStatus, snapshot),
  ];
  // 進行中ゲームの分 (アイテム×10) も含めてライブ更新したいので、確定分だけを扱う
  // computeSetResult の totals ではなく行データから合算する。2ゲームとも確定した時点では
  // totals と一致するため、下の勝者判定と食い違うことはない。
  const sideTotalPoints = rows[0].subtotal + rows[1].subtotal;

  // 競技ルール: 勝利数が多い方が勝者、同数なら合計ポイント。勝利数は確定したゲームだけを数える。
  const setResult = computeSetResult(roundResults);
  const wins   = setResult.wins[side];
  const draws  = setResult.draws;
  const losses = roundResults.length - wins - draws;
  const winsText = `${wins}勝${losses}敗${draws > 0 ? `${draws}分` : ''}`;

  // 2ゲームとも終わってから、試合勝者のマークと「何で決まったか」の強調を出す
  const setComplete = serverStatus?.phase === 'finished' && roundResults.length >= 2;
  const isSetWinner = setComplete && setResult.winnerSide === side;
  const wonByWins   = isSetWinner && setResult.decidedBy === 'wins';
  const wonByPoints = isSetWinner && setResult.decidedBy === 'points';

  return (
    <>
      <RoundLedger row={rows[0]} dim={dim} />
      <RoundLedger row={rows[1]} dim={dim} />

      {/* ── TOTAL (この画面側=このプログラム自身の2ゲームの成績) ── */}
      <div style={{
        ...s.totalSection,
        padding: `${dim.totalPadV}px ${dim.totalPadH}px`,
        // 枠は内側に描く (inset shadow)。外形の高さが変わらないので、パネルの
        // フォントサイズを決める二分探索の測定結果に影響しない。
        ...(isSetWinner ? { boxShadow: `inset 0 0 0 3px ${WIN_BASE}` } : null),
      }}>
        <div style={{
          ...s.totalHeader,
          fontSize: dim.totalHeaderFont, marginBottom: dim.totalHeaderMarginB, paddingTop: dim.totalHeaderPadT,
        }}>{isSetWinner ? '🏆 TOTAL' : '⭐ TOTAL'}</div>

        {/* 勝敗数 = 勝者を決める第1基準。決め手になったときは枠で示す */}
        <div style={{
          ...s.winsBox,
          padding: `${dim.winsPadV}px 0`, marginBottom: dim.rowGap,
          ...(wonByWins ? { background: WIN_LIGHT, boxShadow: `inset 0 0 0 2px ${WIN_BASE}` } : null),
        }}>
          <span style={{ ...s.winsValue, fontSize: dim.winsFont }}>{winsText}</span>
        </div>

        {/* 合計ポイント = 勝利数が並んだときの第2基準 */}
        <div style={{
          ...s.totalPointsBox,
          padding: `${dim.winsPadV}px ${dim.rowGap}px`,
          ...(wonByPoints ? { background: WIN_LIGHT, boxShadow: `inset 0 0 0 2px ${WIN_BASE}` } : null),
        }}>
          <LedgerRow
            label="合計" value={`${sideTotalPoints}pt`} color={WIN_BASE}
            labelFont={dim.subLabelFont} valueFont={dim.subValueFont} gap={dim.rowGap}
          />
        </div>
      </div>
    </>
  );
}

function RoundLedger({ row, dim }: { row: RoundRowData; dim: PanelDim }) {
  const base = row.idx === 0 ? COOL_COLOR : HOT_COLOR;
  const dark = row.idx === 0 ? COOL_DARK  : HOT_DARK;
  const pale = row.idx === 0 ? COOL_PALE  : HOT_PALE;

  const blank    = row.status === 'pending';
  const finished = row.status === 'finished';
  // 一撃/総取りが確定するのは決着後だけ。ゲーム中は「—」で未確定を示す
  const bonusPlaceholder = blank ? '' : '—';

  return (
    <div style={{ ...s.teamBox, gap: dim.teamBoxGap, paddingBottom: dim.teamBoxPadB }}>
      {/* グラデヘッダー: 第何ゲームか + そのゲームのチーム (COOL/HOT) + 勝敗 */}
      <div style={{
        ...s.teamHeader,
        gap: dim.headerGap,
        padding: `${dim.headerPadV}px ${dim.headerPadH}px`, marginBottom: dim.headerMarginB,
        background: `linear-gradient(135deg, ${base}, ${dark})`,
      }}>
        <span style={{ ...s.roundNum, fontSize: dim.badgeFont }}>第{row.round + 1}ゲーム</span>
        <span style={{ ...s.teamLabel, fontSize: dim.labelFont }}>{row.label}</span>
        {row.outcome && (
          <span style={{
            ...s.outcomeBadge,
            fontSize: dim.badgeFont, padding: `${dim.badgePadV}px ${dim.badgePadH}px`,
            // 勝ったゲームだけ白ベタで強く出し、勝利数の数え上げが目で追えるようにする
            background: row.outcome === 'WIN' ? '#fff' : 'rgba(255,255,255,0.25)',
            color:      row.outcome === 'WIN' ? base   : '#fff',
          }}>{row.outcome}</span>
        )}
      </div>

      {/* 明細は pending/live/finished のどの状態でも同じ行数を描画し、高さをゲーム開始前から
          確保しておく。そうしないと 未対戦→ゲーム中→終了 と状態が進むたびにこの行の高さが
          変わり、下に続く行や TOTAL 欄の表示位置がズレてしまう。
          pending 時は中身を空にし、「未対戦」バッジを中央に重ねて表示する。 */}
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: dim.rowGap }}>
          {/* アイテムは個数ではなくポイント (獲得数×10) で出す。下の一撃/総取りと単位がそろい、
              アイテム + 一撃 + 総取り = 小計 と足し算で読める。獲得数そのものは上部スコアバーが
              大きく表示している。 */}
          <LedgerRow
            label={blank ? '' : 'アイテム'} value={blank ? '' : `${row.items * 10}pt`} color={base}
            labelFont={dim.ledgerLabelFont} valueFont={dim.ledgerValueFont} gap={dim.rowGap}
          />
          <LedgerRow
            label={blank ? '' : '一撃'}
            value={finished ? bonusText(row.strikeBonus) : bonusPlaceholder}
            color={finished ? bonusColor(row.strikeBonus) : TEXT_MUTED}
            labelFont={dim.ledgerLabelFont} valueFont={dim.ledgerValueFont} gap={dim.rowGap}
          />
          <LedgerRow
            label={blank ? '' : '総取り'}
            value={finished ? bonusText(row.sweepBonus) : bonusPlaceholder}
            color={finished ? bonusColor(row.sweepBonus) : TEXT_MUTED}
            labelFont={dim.ledgerLabelFont} valueFont={dim.ledgerValueFont} gap={dim.rowGap}
          />

          <div style={{ ...s.ledgerDivider, margin: `${dim.dividerMargin}px 0` }} />

          <LedgerRow
            label={blank ? '' : '小計'} value={blank ? '' : `${row.subtotal}pt`} color={base}
            labelFont={dim.subLabelFont} valueFont={dim.subValueFont} gap={dim.rowGap}
          />
        </div>
        {blank && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{
              ...s.outcomeBadge, fontSize: dim.badgeFont,
              padding: `${dim.badgePadV}px ${dim.badgePadH}px`,
              background: pale, color: base,
            }}>未対戦</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── LedgerRow (ラベル左・値右の明細1行) ────────────────────────────────────────

function LedgerRow({ label, value, color, labelFont, valueFont, gap }: {
  label: string; value: string; color: string;
  labelFont: number; valueFont: number; gap: number;
}) {
  return (
    <div style={{ ...rowS.wrap, gap }}>
      {/* 空文字だと行送りが発生せず高さが潰れるため、非改行スペースで行の高さを確保する */}
      <span style={{ ...rowS.label, fontSize: labelFont }}>{label || ' '}</span>
      <span style={{ ...rowS.value, fontSize: valueFont, color }}>{value || ' '}</span>
    </div>
  );
}

const rowS: Record<string, React.CSSProperties> = {
  // fontSize/gap はレンダー時に dim (パネル幅連動) で上書きされる
  wrap: {
    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
    minWidth: 0, width: '100%', lineHeight: 1.25,
  },
  label: {
    color: TEXT_MUTED, letterSpacing: '0.04em',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
  },
  value: {
    fontFamily: FONT_NUM, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
  },
};

// ── Styles ───────────────────────────────────────────────────────────────────
// width/padding/gap/fontSize の多くはレンダー時に dim (パネル幅連動) で上書きされる

const s: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex', flexDirection: 'column', gap: 0,
    background: BG_CARD, borderRadius: RADIUS_MD, boxShadow: SHADOW_SM,
    flexShrink: 0,
    // 実測補正が効くまでの一瞬 (フルスケール描画時) に内容がはみ出ても下端が無言で消えないよう、
    // 縦方向は auto (必要なら軽くスクロール) にする。横方向は cardW を超えないよう hidden のまま。
    overflowX: 'hidden', overflowY: 'auto', fontFamily: FONT_UI,
    alignSelf: 'stretch',  // 親の高さに合わせて縦に伸びる
  },
  teamBox: {
    display: 'flex', flexDirection: 'column',
    padding: `0 ${TEAM_BOX_PAD_H}px`,
    borderBottom: `1px solid ${BORDER_COLOR}`,
  },
  teamHeader: {
    display: 'flex', alignItems: 'center',
    margin: `0 -${TEAM_BOX_PAD_H}px`,
    color: '#fff',
  },
  roundNum: { fontWeight: 600, opacity: 0.85, whiteSpace: 'nowrap' },
  teamLabel: { fontWeight: 700, letterSpacing: '0.08em', whiteSpace: 'nowrap' },
  outcomeBadge: {
    fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '0.04em',
    borderRadius: 99, marginLeft: 'auto',
  },
  ledgerDivider: { height: 1, background: BORDER_COLOR },
  totalSection: {
    background: WIN_PALE,
  },
  totalHeader: {
    fontWeight: 700, color: WIN_BASE,
    letterSpacing: '0.06em',
    // フォント差で見積り (LABEL_EM) をわずかに超えても「合計ポイント」を折り返させない
    whiteSpace: 'nowrap',
  },
  winsBox: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: RADIUS_SM,
  },
  winsValue: {
    fontWeight: 700, color: WIN_BASE, letterSpacing: '0.02em',
    whiteSpace: 'nowrap', lineHeight: 1.15,
  },
  totalPointsBox: { borderRadius: RADIUS_SM },
  // 1ゲーム制の合計ポイント (明細行を介さない単独の大きい数値)
  soloTotalValue: {
    fontFamily: FONT_NUM, fontWeight: 700, color: WIN_BASE,
    textAlign: 'center', lineHeight: 1.05,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
};
