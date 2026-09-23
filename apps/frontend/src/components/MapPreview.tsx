import type { InlineMapData } from '@u15/ws-types';
import { MapObject } from '@u15/ws-types';
import { useTextures } from '../hooks/useTextures';
import { MapThumbnail } from './MapThumbnail';
import {
  BG_CARD, RADIUS_MD, SHADOW_SM,
  TEXT_PRIMARY, TEXT_SECONDARY,
  TURN_BASE, TURN_LIGHT,
  FONT_NUM,
} from '../ui';

/**
 * これから戦うマップ。第2ゲーム前は対戦画面と同じ向き (反転) で見せる。
 *
 * `compact` はマップ名・ターン数/アイテム数・盤面反転バッジを省いて盤面だけにする。
 * 運営席のコントロールパネルで同じ情報を確認できる場面 (SetupWaiting) で、
 * 縦に余裕が無いときに使う。手動プレビュー (画面いっぱいに使う) では付けたままにする。
 */
export function MapPreview({ map, theme, flip, label, compact = false }: {
  map: InlineMapData; theme: string; flip: boolean; label: string; compact?: boolean;
}) {
  const tex = useTextures(theme);
  // 15×17 のマップでプレイヤーカードと釣り合う大きさ
  const cellSize = Math.max(4, Math.min(12, Math.floor(200 / Math.max(map.size.x, map.size.y))));
  const itemCount = map.field.flat().filter(c => c === MapObject.ITEM).length;
  return (
    <div style={mp.card}>
      {!compact && <div style={mp.name}>{label}</div>}
      <MapThumbnail
        field={map.field as MapObject[][]}
        size={map.size}
        teamFirstPoint={map.teamFirstPoint}
        textures={tex}
        cellSize={cellSize}
        flip={flip}
      />
      {!compact && <div style={mp.meta}>ターン {map.turn} ・ アイテム {itemCount}</div>}
      {!compact && flip && <div style={mp.flip}>盤面反転</div>}
    </div>
  );
}

const mp: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    padding: '14px 18px', background: BG_CARD,
    borderRadius: RADIUS_MD, boxShadow: SHADOW_SM,
  },
  name: {
    fontSize: 14, fontWeight: 700, color: TEXT_PRIMARY,
    maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  meta: { fontSize: 11, color: TEXT_SECONDARY, fontFamily: FONT_NUM },
  flip: {
    fontSize: 11, fontWeight: 700, color: TURN_BASE, background: TURN_LIGHT,
    borderRadius: 99, padding: '3px 10px',
  },
};
