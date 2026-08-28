import { useMemo } from 'react';
import type { ResolvedParticipant, TournamentFormat, TournamentMatch } from '@u15/ws-types';
import { centeredBracketLayout } from '../../../lib/centeredBracketLayout';
import { FitArea } from '../../FitArea';
import { PLAYER_CARD_W, PLAYER_CARD_H, PlayerCard } from './PlayerCard';
import { matchInfoHeight, MatchInfoCard } from './MatchInfoCard';
import { FONT_UI, TEXT_MUTED, TEXT_SECONDARY, WIN_BASE } from '../../../ui';

// トーナメント表。決勝を中央に置き、左山は左→右、右山は右→左で決勝へ収束する。
// 接続線だけ SVG、カードは絶対配置の DOM というハイブリッド。こうするとカードは通常の
// DOM のままなので、省略表示・ホバー・クリックがそのまま効き、線は SVG なので
// bye や回戦数が変わっても破綻しない。

export interface BracketViewProps {
  matches:      TournamentMatch[];
  participants: ResolvedParticipant[];
  /** 未確定の枠の呼び名を形式に合わせるため (PlayerCard へそのまま渡す) */
  format?:      TournamentFormat;
  interactive?: boolean;
  selectedId?:  string | null;
  onSelect?:    (matchId: string) => void;
  /** 「この試合を準備」で確定した、これから行う試合 */
  upcomingId?:  string | null;
  /** たった今「確定」した試合 */
  finishedId?:  string | null;
  /** 表示倍率 (プロジェクタ表示で使う)。fit のときは無視される */
  scale?:       number;
  /** 親の空き領域いっぱいまで自動で拡大・縮小する (親は高さの決まった箱にすること) */
  fit?:         boolean;
  /** fit の拡大上限 */
  maxScale?:    number;
}

export function BracketView({
  matches, participants, format, interactive = false, selectedId = null, onSelect,
  upcomingId = null, finishedId = null, scale = 1, fit = false, maxScale = 3,
}: BracketViewProps) {
  const layout = useMemo(
    () => centeredBracketLayout(matches, {
      cardW: PLAYER_CARD_W, cardH: PLAYER_CARD_H, matchInfoHeightOf: matchInfoHeight,
    }),
    [matches],
  );
  const byId = useMemo(() => new Map(matches.map(m => [m.id, m])), [matches]);

  if (layout.nodes.length === 0) {
    return <div style={empty}>対戦カードがありません</div>;
  }

  const figure = (
    <>
      {/* 接続線 (クリックを邪魔しないよう pointerEvents は無効) */}
      <svg
        width={layout.width} height={layout.height}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {/* 'hidden' (不戦の試合へ/からの線) は描かずに省く。
            'decided' (勝ち上がりが実際に決まった線) は太く緑で強調する。
            'pending' (未対戦) は TEXT_MUTED で、決着線より目立たない程度に見える線にする
            (以前の BORDER_COLOR はカードの縁取り用の非常に薄い色で、線としては薄すぎた) */}
        {layout.edges.filter(e => e.kind !== 'hidden').map((e, i) => (
          <path
            key={`${e.from}-${e.to}-${i}`}
            d={e.d}
            fill="none"
            stroke={e.kind === 'decided' ? WIN_BASE : TEXT_MUTED}
            strokeWidth={e.kind === 'decided' ? 3 : 2}
          />
        ))}
      </svg>

      {/* 回戦の見出し (左山・中央・右山で3回登場しうる) */}
      {layout.columns.map(c => (
        <div key={c.x} style={{ ...colHead, left: c.x, width: PLAYER_CARD_W }}>
          {c.label}
        </div>
      ))}

      {/* 対戦カード (試合ラベル・状態バッジ・裁定注記。対になる2枚のプレイヤーカードの間) */}
      {layout.matchNodes.map(n => {
        const m = byId.get(n.matchId);
        if (!m) return null;
        return (
          <MatchInfoCard
            key={n.matchId}
            match={m}
            interactive={interactive}
            selected={selectedId === n.matchId}
            upcoming={upcomingId === n.matchId}
            justFinished={finishedId === n.matchId}
            {...(onSelect ? { onSelect } : {})}
            style={{ position: 'absolute', left: n.x, top: n.y, width: n.w }}
          />
        );
      })}

      {/* プレイヤーカード (1試合につき side0/side1 の2枚。名前と得点だけ) */}
      {layout.nodes.map(n => {
        const m = byId.get(n.matchId);
        if (!m) return null;
        return (
          <PlayerCard
            key={`${n.matchId}-${n.side}`}
            match={m}
            side={n.side}
            participants={participants}
            {...(format ? { format } : {})}
            interactive={interactive}
            selected={selectedId === n.matchId}
            upcoming={upcomingId === n.matchId}
            justFinished={finishedId === n.matchId}
            {...(onSelect ? { onSelect } : {})}
            style={{ position: 'absolute', left: n.x, top: n.y }}
          />
        );
      })}
    </>
  );

  // 空き領域に合わせて拡大・縮小する
  if (fit) {
    return (
      <FitArea maxScale={maxScale}>
        <div style={{ position: 'relative', width: layout.width, height: layout.height }}>
          {figure}
        </div>
      </FitArea>
    );
  }

  return (
    <div style={scroller}>
      <div
        style={{
          position: 'relative',
          width:  layout.width,
          height: layout.height,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {figure}
      </div>
    </div>
  );
}

const scroller: React.CSSProperties = {
  // 横に長い図なので、ページ本体ではなくここだけを横スクロールさせる
  overflowX: 'auto', overflowY: 'auto', maxWidth: '100%',
};

// headerH (centeredBracketLayout の既定値) の中にラベルの行の高さ + 隙間を収める。
// lineHeight を明示するのは、ブラウザ既定の行高に頼ると隙間の実測値が font-size で
// ぶれてカードとの間隔が意図どおりにならないため
const colHead: React.CSSProperties = {
  position: 'absolute', top: 0, textAlign: 'center',
  fontFamily: FONT_UI, fontSize: 20, lineHeight: '22px', fontWeight: 700, color: TEXT_SECONDARY,
};

const empty: React.CSSProperties = {
  padding: 24, textAlign: 'center', color: TEXT_SECONDARY,
  fontFamily: FONT_UI, fontSize: 12,
};
