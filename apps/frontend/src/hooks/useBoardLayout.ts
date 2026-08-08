import { useLayoutEffect, useRef, useState } from 'react';
import type { GameStateSnapshot } from '@u15/ws-types';
import { clampNum } from '../lib/num';

/** s.main の gap と一致させる */
const MAIN_GAP = 12;

export interface ScoreDim {
  numFont: number; nameFont: number; namePadV: number; namePadH: number;
  itemsFont: number; itemsPadV: number; itemsPadH: number;
  dividerH: number; gap: number; cardPadV: number; cardPadH: number;
}

export interface BoardLayout {
  /** メイン行 (3カラム) のコンテナに付ける */
  mainRef:    React.RefObject<HTMLDivElement>;
  /** スコアバーの外枠に付ける */
  scorePadRef: React.RefObject<HTMLDivElement>;
  cellSize: number;
  /** サイドパネルが使える高さ (メイン行の実高さ) */
  panelH:   number;
  boardW:   number;
  panelW:   number;
  scoreDim: ScoreDim;
}

/**
 * 盤面のセルサイズ・サイドパネル幅・スコアバーの寸法を、実測した1つの大きさから導出する。
 *
 * **測定源を mainRef だけに限るのが要点。** 子要素 (盤面やサイドパネル) を測ってサイズを
 * 決めると、その結果が子要素のサイズ自体を変え、それがまた測定結果を変える…という
 * 「測定→反映→再測定」の循環になる。mainRef の大きさは子要素には左右されないので循環しない。
 *
 * ただし mainRef の**高さ**は子要素以外からは影響を受ける。main は縦並びの列の中で flex:1 なので、
 * 同じ列の兄弟であるスコアバーが厚くなるとその分だけ低くなる。そのため
 * 「main の高さから決めた値」でスコアバーの寸法を決めてはいけない (下の budgetH を参照)。
 */
export function useBoardLayout(
  snapshot: GameStateSnapshot | null,
  doubleMode: boolean,
): BoardLayout {
  const mainRef = useRef<HTMLDivElement>(null);
  const [mainSize, setMainSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!mainRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
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

  return {
    mainRef,
    scorePadRef,
    cellSize,
    panelH: mainSize.height,
    boardW,
    panelW,
    scoreDim: {
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
    },
  };
}
