import { clampNum } from './num';

// サイドパネル (得点明細) の寸法計算。盤面の実描画サイズに連動して文字と余白を最大化する。
// 純粋な計算なので、描画から切り離してテストできるようここに置く。

// 各試合のポイント明細 (カード幅・文字サイズ・余白) を、盤面の実描画サイズに連動した
// スケール (MainWindow から渡される幅) に応じて最大化するための寸法。
export interface PanelDim {
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
// 総合欄のラベル「合計ポイント」= 全角6文字 + letterSpacing ≒ 6.4em
const LABEL_EM = 6.4;
// 1ゲーム制の合計ポイントは符号なし「9999pt」= 6文字 ≒ 3.6em、フォント差の余裕を見て 3.7em
const POINTS_EM = 3.7;
// 勝敗表示「1勝0敗1分」= 漢字3 + 数字3 ≒ 4.7em + 余裕
const WINS_EM = 5.0;
// s.teamBox の左右パディング (明細行の使える幅を求めるのに使う)
export const TEAM_BOX_PAD_H = 8;

// width: パネルに割り当てられた実際の幅 (px)。150 は基準幅で、これを 1.0 とした相対スケールを
// 内部要素のフォント/余白計算に使う。correction: 実測した内容の高さがカードの実高さに収まらない
// 場合に PlayerSidePanel 側で計算する縮小補正 (1 = 補正なし)。幅だけを基準に文字サイズを決めると
// 横長で縦が狭いウィンドウのときにカードの高さに収まらないため、実際に DOM を測定して補正する
// (「このくらいの高さになるはず」という事前見積りは実際の余白・行間の誤差で簡単にズレるため、
// 見積りではなく実測ベースにしている)。
export function buildDim(width: number, correction: number): PanelDim {
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
