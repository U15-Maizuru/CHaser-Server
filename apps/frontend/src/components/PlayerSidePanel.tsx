import { useRef } from 'react';
import type {
  GameStateSnapshot,
  RoundResult,
  ServerStatusPayload,
} from '@u15/ws-types';
import { computeSetResult, idxForSide, ITEM_POINT, roundPointsFor, Winner } from '@u15/ws-types';
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
  teamGradient,
} from '../ui';
import { buildDim, TEAM_BOX_PAD_H, type PanelDim } from '../lib/panelDim';
import { computeRoundRow, type RoundRowData } from '../lib/roundRow';
import { useFitCorrection } from '../hooks/useFitCorrection';



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

  // 探索の上限。2ゲーム制は行数が多いぶん先に高さが埋まるが、明細行は1行1項目で縦に詰まって
  // いるため、幅基準の等倍 (correction=1) では縦に余ることがある。1ゲーム制は行が「明細3行」と
  // 「合計ポイント」だけでさらに大きく余るので、上限をより高く開く。いずれも buildDim の
  // clampNum の max と幅からの逆算で頭打ちになるため、上限を上げても青天井にはならない。
  const maxCorrection = doubleMode ? 1.6 : 2.2;

  // 中身がカードの実高さに収まる最大の拡大率を実測で求める (詳細は useFitCorrection)
  const key = `${Math.round(width / 5)}|${Math.round(maxHeight / 5)}|${doubleMode}|${roundResults.length}`;
  const correction = useFitCorrection(cardRef, { key, maxHeight, maxCorrection });

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

// ── SingleModeContent (2ゲーム制OFF: 自分側のプレイヤーだけを表示) ────────────────────

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
  const totalPoints = rr ? roundPointsFor(rr, side) : items * ITEM_POINT;

  const base  = side === 0 ? COOL_COLOR : HOT_COLOR;
  const dark  = side === 0 ? COOL_DARK  : HOT_DARK;
  const label = side === 0 ? 'COOL' : 'HOT';

  return (
    <>
      <div style={{ ...s.teamBox, gap: dim.teamBoxGap, paddingBottom: dim.teamBoxPadB }}>
        {/* グラデヘッダー: 自分側のプレイヤー */}
        <div style={{
          ...s.teamHeader,
          gap: dim.headerGap,
          padding: `${dim.headerPadV}px ${dim.headerPadH}px`, marginBottom: dim.headerMarginB,
          background: teamGradient(base, dark),
        }}>
          <span style={{ ...s.teamLabel, fontSize: dim.labelFont }}>{label}</span>
        </div>

        {/* 得点の明細。一撃/総取りが確定するのは決着後のみだが、ゲーム中も同じ3行を描いて
            高さを確保し、終了の瞬間に行が増えて下の合計ポイントがずれないようにする
            (2ゲーム制の RoundLedger と同じ方針)。未確定は「—」で示す。 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: dim.rowGap }}>
          <LedgerRow
            label="アイテム" value={`${items * ITEM_POINT}pt`} color={base}
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

      {/* ── 総合 (この画面側=このプログラム自身の2ゲームの成績) ── */}
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
        }}>{isSetWinner ? '🏆 総合' : '⭐ 総合'}</div>

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
      {/* グラデヘッダー: 第何ゲームか + そのゲームのプレイヤー (COOL/HOT) + 勝敗 */}
      <div style={{
        ...s.teamHeader,
        gap: dim.headerGap,
        padding: `${dim.headerPadV}px ${dim.headerPadH}px`, marginBottom: dim.headerMarginB,
        background: teamGradient(base, dark),
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
          変わり、下に続く行や総合欄の表示位置がズレてしまう。
          pending 時は中身を空にし、「未対戦」バッジを中央に重ねて表示する。 */}
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: dim.rowGap }}>
          {/* アイテムは個数ではなくポイント (獲得数×10) で出す。下の一撃/総取りと単位がそろい、
              アイテム + 一撃 + 総取り = 小計 と足し算で読める。獲得数そのものは上部スコアバーが
              大きく表示している。 */}
          <LedgerRow
            label={blank ? '' : 'アイテム'} value={blank ? '' : `${row.items * ITEM_POINT}pt`} color={base}
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
