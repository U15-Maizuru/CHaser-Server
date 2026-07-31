import type { ClientType, InlineMapData, ProcessConfig, ServerStatusPayload } from '@u15/ws-types';
import { MapObject } from '@u15/ws-types';
import { TeamSetupPanel } from './TeamSetupPanel';
import { MapThumbnail } from './MapThumbnail';
import { useTextures } from '../hooks/useTextures';
import type { MatchConfig } from '../hooks/useMatchConfig';
import {
  BG_ROOT, BG_HEADER, BG_CARD,
  BORDER_COLOR, COOL_COLOR, COOL_PALE, COOL_DARK, HOT_COLOR, HOT_PALE, HOT_DARK,
  TURN_BASE, TURN_LIGHT, TURN_PALE,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  RADIUS_SM,
  FONT_UI, FONT_NUM,
} from '../styles/tokens';

interface Props {
  status:               ServerStatusPayload;
  httpBase:             string;
  roomId:               string;
  displayTitle:         string;
  theme:                string;
  currentMap:           InlineMapData | null;
  matchConfig:          MatchConfig;
  onSetClient:          (slot: 0 | 1, type: ClientType, cfg?: ProcessConfig) => void;
  onDeleteProgram:      (slot: 0 | 1) => void;
  onOpenLibraryManager: () => void;
  onOpenMapManagement:  () => void;
  onSetDoubleMode:      (enabled: boolean) => void;
  onSetRepeatMode:      (enabled: boolean) => void;
  onSetDemoMode:        (enabled: boolean) => void;
  onChangeMatchConfig:  (patch: Partial<MatchConfig>) => void;
  onCommitMatchConfig:  () => void;
}

const TEAM_LABEL  = ['COOL', 'HOT']        as const;
const TEAM_COLOR  = [COOL_COLOR, HOT_COLOR] as const;
const TEAM_BGCOL  = [COOL_PALE, HOT_PALE]   as const;
const TEAM_DARK   = [COOL_DARK, HOT_DARK]   as const;

export function StartupDialog({
  status, httpBase, roomId, displayTitle, theme, currentMap, matchConfig,
  onSetClient, onDeleteProgram, onOpenLibraryManager, onOpenMapManagement,
  onSetDoubleMode, onSetRepeatMode, onSetDemoMode,
  onChangeMatchConfig, onCommitMatchConfig,
}: Props) {
  // 2試合制の第2試合待機中も phase は 'setup' に戻るが、マップもルールもセット内で
  // 固定されており変更できない。同じ画面で同じ操作を見せると「押せるのに効かない」
  // 状態になるため、この場合は設定を編集させず要約だけを見せる。
  const isMidSet = status.roundResults.length > 0;

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.title}>{displayTitle}</span>
        <span style={s.subtitle}>セットアップ</span>
        <div style={s.ipBox}>
          <span style={s.ipLabel}>IP</span>
          <span style={s.ipValue}>{status.localIP}</span>
        </div>
        {status.doubleMode && (
          <div style={s.roundBadge}>
            {status.roundResults.length === 0
              ? '第1試合'
              : `第${(status.currentRound ?? 0) + 1}試合`}
          </div>
        )}
      </div>

      {/* 対戦設定 */}
      {isMidSet ? (
        <div style={s.midSetStrip}>
          第{(status.currentRound ?? 0) + 1}試合 — マップと対戦ルールは第1試合と共通です。
          両チームの再接続を待って「ゲームスタート」を押してください。
        </div>
      ) : (
        <MatchSetupStrip
          status={status}
          theme={theme}
          currentMap={currentMap}
          matchConfig={matchConfig}
          onOpenMapManagement={onOpenMapManagement}
          onSetDoubleMode={onSetDoubleMode}
          onSetRepeatMode={onSetRepeatMode}
          onSetDemoMode={onSetDemoMode}
          onChangeMatchConfig={onChangeMatchConfig}
          onCommitMatchConfig={onCommitMatchConfig}
        />
      )}

      {/* Two-column team panels */}
      <div style={s.columns}>
        {([0, 1] as const).map(slot => (
          <TeamSetupPanel
            key={slot}
            slot={slot}
            label={TEAM_LABEL[slot]}
            color={TEAM_COLOR[slot]}
            bgColor={TEAM_BGCOL[slot]}
            darkColor={TEAM_DARK[slot]}
            info={status.clients[slot]}
            httpBase={httpBase}
            roomId={roomId}
            onSetType={(type, cfg) => onSetClient(slot, type, cfg)}
            onDeleteProgram={() => onDeleteProgram(slot)}
            onOpenLibraryManager={onOpenLibraryManager}
          />
        ))}
      </div>
    </div>
  );
}

// ── 対戦設定ストリップ ────────────────────────────────────────────────────────

interface StripProps {
  status:              ServerStatusPayload;
  theme:               string;
  currentMap:          InlineMapData | null;
  matchConfig:         MatchConfig;
  onOpenMapManagement: () => void;
  onSetDoubleMode:     (enabled: boolean) => void;
  onSetRepeatMode:     (enabled: boolean) => void;
  onSetDemoMode:       (enabled: boolean) => void;
  onChangeMatchConfig: (patch: Partial<MatchConfig>) => void;
  onCommitMatchConfig: () => void;
}

function MatchSetupStrip({
  status, theme, currentMap, matchConfig,
  onOpenMapManagement, onSetDoubleMode, onSetRepeatMode, onSetDemoMode,
  onChangeMatchConfig, onCommitMatchConfig,
}: StripProps) {
  const tex = useTextures(theme);

  const blocks = currentMap ? countObj(currentMap.field, MapObject.BLOCK) : 0;
  const items  = currentMap ? countObj(currentMap.field, MapObject.ITEM)  : 0;

  const handleDemoToggle = (enabled: boolean) => {
    // setDemoMode(true) はサーバー側で randomizeFromCatalog() を呼び、両スロットの
    // プログラム選択を即座に上書きする。取り返しがつくとはいえ驚きが大きいので確認する。
    if (enabled && !window.confirm(
      'デモモードを ON にすると、両チームのプログラムがライブラリ（デモ対象）から'
      + 'ランダムに選び直されます。現在の選択は失われます。よろしいですか？',
    )) return;
    onSetDemoMode(enabled);
  };

  return (
    <div style={s.strip}>
      {/* 現在のマップ */}
      <section style={s.stripSection}>
        <div style={s.stripLabel}>マップ</div>
        <div style={s.mapRow}>
          {currentMap && (
            <MapThumbnail
              field={currentMap.field as MapObject[][]}
              size={currentMap.size}
              teamFirstPoint={currentMap.teamFirstPoint}
              textures={tex}
              cellSize={5}
            />
          )}
          <div style={s.mapInfo}>
            {currentMap ? (
              <>
                <span style={s.mapKind}>{status.mapIsCustom ? 'カスタム' : 'ランダム生成'}</span>
                <span>{currentMap.size.x}×{currentMap.size.y} ・ ターン {currentMap.turn}</span>
                <span>ブロック {blocks} ・ アイテム {items}</span>
              </>
            ) : (
              <span style={s.hint}>読み込み中...</span>
            )}
          </div>
          <button style={s.changeBtn} onClick={onOpenMapManagement}>変更...</button>
        </div>
      </section>

      <div style={s.stripDivider} />

      {/* 対戦ルール */}
      <section style={s.stripSection}>
        <div style={s.stripLabel}>対戦ルール</div>
        <div style={s.chipRow}>
          <ToggleChip
            active={status.doubleMode}
            onClick={() => onSetDoubleMode(!status.doubleMode)}
            title="先攻・後攻を入れ替えた2試合を行い、合計得点で勝者を決める"
          >
            2試合制
          </ToggleChip>
          <ToggleChip
            active={status.repeatMode}
            onClick={() => onSetRepeatMode(!status.repeatMode)}
            title="対戦終了後、接続を保ったまま先後を入れ替えて再戦できるようにする"
          >
            リピート
          </ToggleChip>
          <ToggleChip
            active={status.demoMode}
            onClick={() => handleDemoToggle(!status.demoMode)}
            title="無人で自動進行する。プログラムはライブラリからランダムに選ばれる"
          >
            デモ
          </ToggleChip>
        </div>
        {status.demoMode && (
          <span style={s.hint}>準備完了で自動開始します。止めるには下部の「リセット」を押してください。</span>
        )}
      </section>

      <div style={s.stripDivider} />

      {/* 進行パラメータ */}
      <section style={s.stripSection}>
        <div style={s.stripLabel}>進行 (次の試合から反映)</div>
        <div style={s.numRow}>
          <label style={s.numLabel}>
            ターン表示
            <input
              type="number" min={0} max={10} step={0.1}
              value={(matchConfig.turnDelay / 1000).toFixed(1)}
              onChange={e => onChangeMatchConfig({ turnDelay: Math.round(Number(e.target.value) * 1000) })}
              onBlur={onCommitMatchConfig}
              style={s.numInput}
            />
            <span style={s.unit}>秒</span>
          </label>
          <label style={s.numLabel}>
            TCPタイムアウト
            <input
              type="number" min={1} max={60} step={1}
              value={matchConfig.timeout}
              onChange={e => onChangeMatchConfig({ timeout: Number(e.target.value) })}
              onBlur={onCommitMatchConfig}
              style={s.numInput}
            />
            <span style={s.unit}>秒</span>
          </label>
        </div>
      </section>
    </div>
  );
}

function ToggleChip({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      style={{ ...s.chip, ...(active ? s.chipActive : {}) }}
      onClick={onClick}
      title={title}
    >
      {active ? '✓ ' : ''}{children}
    </button>
  );
}

function countObj(field: number[][], obj: MapObject): number {
  return field.flat().filter(c => c === obj).length;
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: BG_ROOT,
    color: TEXT_PRIMARY,
    fontFamily: FONT_UI,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 20px',
    background: BG_HEADER,
    borderBottom: `1px solid ${BORDER_COLOR}`,
    flexShrink: 0,
  },
  title:    { fontSize: 16, fontWeight: 800, letterSpacing: '0.04em', color: TEXT_PRIMARY },
  subtitle: { fontSize: 12, color: TEXT_SECONDARY, letterSpacing: 2 },
  ipBox: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    padding: '3px 12px',
    background: BG_CARD,
    borderRadius: RADIUS_SM,
    border: `1px solid ${BORDER_COLOR}`,
  },
  ipLabel: { fontSize: 10, color: TEXT_MUTED, letterSpacing: 1 },
  ipValue: { fontSize: 14, fontWeight: 700, fontFamily: FONT_NUM, letterSpacing: 1, color: TEXT_PRIMARY },
  roundBadge: {
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 12px',
    borderRadius: 99,
    background: TURN_LIGHT,
    color: TURN_BASE,
    letterSpacing: 1,
  },

  // 対戦設定ストリップ
  strip: {
    display: 'flex',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 16,
    margin: '12px 16px 0',
    padding: '10px 14px',
    background: BG_CARD,
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: RADIUS_SM,
    flexShrink: 0,
  },
  stripSection: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
  stripLabel:   { fontSize: 9, color: TEXT_MUTED, letterSpacing: 1 },
  stripDivider: { width: 1, alignSelf: 'stretch', background: BORDER_COLOR },
  midSetStrip: {
    margin: '12px 16px 0',
    padding: '10px 14px',
    background: TURN_PALE,
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: RADIUS_SM,
    fontSize: 11,
    lineHeight: 1.6,
    color: TEXT_SECONDARY,
    flexShrink: 0,
  },

  mapRow:  { display: 'flex', alignItems: 'center', gap: 10 },
  mapInfo: { display: 'flex', flexDirection: 'column', gap: 1, fontSize: 10, color: TEXT_SECONDARY, fontFamily: FONT_NUM },
  mapKind: { fontSize: 10, fontWeight: 700, color: TEXT_PRIMARY, fontFamily: FONT_UI },
  changeBtn: {
    padding: '4px 12px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 99,
    background: BG_CARD, color: TEXT_SECONDARY, fontSize: 11, cursor: 'pointer', flexShrink: 0,
  },

  chipRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: {
    padding: '5px 12px',
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 99,
    background: BG_CARD,
    color: TEXT_SECONDARY,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  chipActive: { background: TURN_BASE, borderColor: TURN_BASE, color: '#fff' },

  numRow:   { display: 'flex', gap: 12, flexWrap: 'wrap' },
  numLabel: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: TEXT_SECONDARY },
  numInput: {
    width: 56, padding: '4px 6px', background: BG_ROOT,
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM, color: TEXT_PRIMARY,
    fontSize: 12, fontFamily: FONT_NUM,
  },
  unit: { fontSize: 10, color: TEXT_MUTED },
  hint: { fontSize: 9, color: TEXT_MUTED },

  columns: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    overflow: 'auto',
    padding: '16px 16px 0',
    alignItems: 'stretch',
  },
};
