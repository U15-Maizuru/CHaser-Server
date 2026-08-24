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

/** これから戦うマップ。第2ゲーム前は対戦画面と同じ向き (反転) で見せる */
export function MapPreview({ map, theme, flip, label }: {
  map: InlineMapData; theme: string; flip: boolean; label: string;
}) {
  const tex = useTextures(theme);
  // 15×17 のマップでプレイヤーカードと釣り合う大きさ
  const cellSize = Math.max(4, Math.min(12, Math.floor(200 / Math.max(map.size.x, map.size.y))));
  const itemCount = map.field.flat().filter(c => c === MapObject.ITEM).length;
  return (
    <div style={mp.card}>
      <div style={mp.name}>{label}</div>
      <MapThumbnail
        field={map.field as MapObject[][]}
        size={map.size}
        teamFirstPoint={map.teamFirstPoint}
        textures={tex}
        cellSize={cellSize}
        flip={flip}
      />
      <div style={mp.meta}>ターン {map.turn} ・ アイテム {itemCount}</div>
      {flip && <div style={mp.flip}>盤面反転</div>}
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
