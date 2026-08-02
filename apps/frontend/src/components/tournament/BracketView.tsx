import { useMemo } from 'react';
import type { ResolvedParticipant, TournamentMatch } from '@u15/ws-types';
import { bracketLayout } from '../../lib/bracketLayout';
import { CARD_H, CARD_W, MatchCard } from './MatchCard';
import { BORDER_COLOR, FONT_UI, TEXT_SECONDARY } from '../../styles/tokens';

// トーナメント表。接続線だけ SVG、カードは絶対配置の DOM というハイブリッド。
// こうするとカードは通常の DOM のままなので、省略表示・ホバー・クリックがそのまま効き、
// 線は SVG なので bye や回戦数が変わっても破綻しない。

export interface BracketViewProps {
  matches:      TournamentMatch[];
  participants: ResolvedParticipant[];
  interactive?: boolean;
  selectedId?:  string | null;
  onSelect?:    (matchId: string) => void;
  /** 表示倍率 (プロジェクタ表示で使う) */
  scale?:       number;
}

export function BracketView({
  matches, participants, interactive = false, selectedId = null, onSelect, scale = 1,
}: BracketViewProps) {
  const layout = useMemo(
    () => bracketLayout(matches, { cardW: CARD_W, cardH: CARD_H }),
    [matches],
  );
  const byId = useMemo(() => new Map(matches.map(m => [m.id, m])), [matches]);

  if (layout.nodes.length === 0) {
    return <div style={empty}>対戦カードがありません</div>;
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
        {/* 接続線 (クリックを邪魔しないよう pointerEvents は無効) */}
        <svg
          width={layout.width} height={layout.height}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          {layout.edges.map((e, i) => (
            <path key={`${e.from}-${e.to}-${i}`} d={e.d}
                  fill="none" stroke={BORDER_COLOR} strokeWidth={2} />
          ))}
        </svg>

        {/* 回戦の見出し */}
        {layout.columns.map(c => (
          <div key={c.stage} style={{ ...colHead, left: c.x, width: CARD_W }}>
            {c.label}
          </div>
        ))}

        {/* カード */}
        {layout.nodes.map(n => {
          const m = byId.get(n.matchId);
          if (!m) return null;
          return (
            <MatchCard
              key={n.matchId}
              match={m}
              participants={participants}
              interactive={interactive}
              selected={selectedId === n.matchId}
              {...(onSelect ? { onSelect } : {})}
              style={{ position: 'absolute', left: n.x, top: n.y }}
            />
          );
        })}
      </div>
    </div>
  );
}

const scroller: React.CSSProperties = {
  // 横に長い図なので、ページ本体ではなくここだけを横スクロールさせる
  overflowX: 'auto', overflowY: 'auto', maxWidth: '100%',
};

const colHead: React.CSSProperties = {
  position: 'absolute', top: 0, textAlign: 'center',
  fontFamily: FONT_UI, fontSize: 11, fontWeight: 700, color: TEXT_SECONDARY,
};

const empty: React.CSSProperties = {
  padding: 24, textAlign: 'center', color: TEXT_SECONDARY,
  fontFamily: FONT_UI, fontSize: 12,
};
