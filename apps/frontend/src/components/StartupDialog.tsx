import { useLayoutEffect, useRef, useState } from 'react';
import type { ClientType, InlineMapData, MapCatalogEntry, ProcessConfig, ServerStatusPayload } from '@u15/ws-types';
import { MapObject } from '@u15/ws-types';
import { TeamSetupPanel } from './TeamSetupPanel';
import { MapThumbnail } from './MapThumbnail';
import { countObj } from '../lib/boardDraw';
import { MapSourceSection, sourceLabel } from './MapSourceSection';
import { useTextures } from '../hooks/useTextures';
import {
  BG_ROOT, BG_HEADER, BG_CARD,
  BORDER_COLOR, COOL_COLOR, COOL_PALE, COOL_DARK, HOT_COLOR, HOT_PALE, HOT_DARK,
  TURN_BASE, TURN_LIGHT, TURN_PALE,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  RADIUS_MD, RADIUS_SM,
  SHADOW_SM,
  FONT_UI, FONT_NUM,
} from '../ui';

interface Props {
  status:               ServerStatusPayload;
  httpBase:             string;
  roomId:               string;
  displayTitle:         string;
  theme:                string;
  currentMap:           InlineMapData | null;
  /** マップを差し替えてよいか (バックエンドの RoundController.canEditMap と同じ条件) */
  canEditMap:           boolean;
  onSetClient:          (slot: 0 | 1, type: ClientType, cfg?: ProcessConfig) => void;
  onDeleteProgram:      (slot: 0 | 1) => void;
  onOpenLibraryManager: () => void;
  onApplyMapEntry:      (entry: MapCatalogEntry) => void;
  onApplyMapParams:     () => void;
  onOpenMapEditor:      () => void;
  onSaveCurrentMap:     (displayName: string) => void;
  onDownloadCurrentMap: (displayName: string) => void;
  onOpenMapLibrary:     () => void;
}

const TEAM_LABEL  = ['COOL', 'HOT']        as const;
const TEAM_COLOR  = [COOL_COLOR, HOT_COLOR] as const;
const TEAM_BGCOL  = [COOL_PALE, HOT_PALE]   as const;
const TEAM_DARK   = [COOL_DARK, HOT_DARK]   as const;

export function StartupDialog({
  status, httpBase, roomId, displayTitle, theme, currentMap, canEditMap,
  onSetClient, onDeleteProgram, onOpenLibraryManager,
  onApplyMapEntry, onApplyMapParams, onOpenMapEditor,
  onSaveCurrentMap, onDownloadCurrentMap, onOpenMapLibrary,
}: Props) {
  // 2ゲーム制の第2ゲーム待機中も phase は 'setup' に戻るが、マップもルールも試合内で
  // 固定されており変更できない。マップの選択 (マップ列の「変更」) と対戦ルール
  // (SettingDialog の「対戦」タブ) がどちらも塞がるため、その理由をここで伝える。
  const isMidMatch = status.roundResults.length > 0;

  // ── 3カラム行の実サイズを計測 ──────────────────────────────────────────────
  // 測定するのは行コンテナ「だけ」。この幅・高さはウィンドウサイズだけで決まり、
  // マッププレビューの大きさには左右されないので「測定→反映→再測定」の循環に陥らない
  // (MainWindow のセルサイズ導出と同じ方針)。
  const columnsRef = useRef<HTMLDivElement>(null);
  const [columnsSize, setColumnsSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!columnsRef.current) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setColumnsSize({ width, height });
    });
    obs.observe(columnsRef.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div style={s.root}>
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
              ? '第1ゲーム'
              : `第${(status.currentRound ?? 0) + 1}ゲーム`}
          </div>
        )}
      </div>

      {isMidMatch && (
        <div style={s.midSetStrip}>
          第{(status.currentRound ?? 0) + 1}ゲーム — マップと対戦ルールは第1ゲームと共通です
          （先攻・後攻が入れ替わるため、盤面は180°反転して表示されます）。
          両プレイヤーの再接続を待って「ゲームスタート」を押してください。
        </div>
      )}

      {/* COOL / マップ / HOT の3カラム (対戦中の MainWindow と同じ骨格) */}
      <div ref={columnsRef} style={s.columns}>
        <TeamSetupPanel
          slot={0}
          label={TEAM_LABEL[0]}
          color={TEAM_COLOR[0]}
          bgColor={TEAM_BGCOL[0]}
          darkColor={TEAM_DARK[0]}
          info={status.clients[0]}
          httpBase={httpBase}
          roomId={roomId}
          onSetType={(type, cfg) => onSetClient(0, type, cfg)}
          onDeleteProgram={() => onDeleteProgram(0)}
          onOpenLibraryManager={onOpenLibraryManager}
        />

        <MapPreviewColumn
          status={status}
          httpBase={httpBase}
          theme={theme}
          currentMap={currentMap}
          canEditMap={canEditMap}
          columnsSize={columnsSize}
          onApplyMapEntry={onApplyMapEntry}
          onApplyMapParams={onApplyMapParams}
          onOpenMapEditor={onOpenMapEditor}
          onSaveCurrentMap={onSaveCurrentMap}
          onDownloadCurrentMap={onDownloadCurrentMap}
          onOpenMapLibrary={onOpenMapLibrary}
        />

        <TeamSetupPanel
          slot={1}
          label={TEAM_LABEL[1]}
          color={TEAM_COLOR[1]}
          bgColor={TEAM_BGCOL[1]}
          darkColor={TEAM_DARK[1]}
          info={status.clients[1]}
          httpBase={httpBase}
          roomId={roomId}
          onSetType={(type, cfg) => onSetClient(1, type, cfg)}
          onDeleteProgram={() => onDeleteProgram(1)}
          onOpenLibraryManager={onOpenLibraryManager}
        />
      </div>
    </div>
  );
}

// ── マッププレビュー列 ────────────────────────────────────────────────────────

const COLUMNS_GAP  = 16;  // s.columns の gap と一致させる
const TEAM_MIN_W   = 280; // TeamSetupPanel の minWidth と一致させる
const MAP_COL_PAD  = 16;  // s.mapColumn の左右パディング
const MAP_COL_VPAD = 14;  // s.mapColumn の上下パディング
const MAP_COL_GAP  = 8;   // s.mapColumn の gap
// プレビューが取りうる幅の範囲。上限は「これ以上大きくしても情報が増えない」線、
// 下限を割り込む狭さでは列自体が折り返して COOL/HOT の下に回る
const PREVIEW_MIN_W = 140;
const PREVIEW_MAX_W = 340;
// マップ選択パネルが読める最小幅。プレビューがこれより細くても列はこの幅を保つ
const PANEL_MIN_W   = 220;
// 折り返しの境界ちょうどに座らないための安全マージン。垂直スクロールバーの出現で
// 行幅がわずかに減っても、3カラムが1行に収まったままでいられるようにする
const WRAP_SAFETY = 16;

// プレビュー + 「使用するマップ」の選択 (MapSourceSection)。
// アップロード・削除はここでは行わず、フッターの「マップ管理...」に一本化する。
function MapPreviewColumn({
  status, httpBase, theme, currentMap, canEditMap, columnsSize,
  onApplyMapEntry, onApplyMapParams, onOpenMapEditor,
  onSaveCurrentMap, onDownloadCurrentMap, onOpenMapLibrary,
}: {
  status: ServerStatusPayload;
  httpBase: string;
  theme: string;
  currentMap: InlineMapData | null;
  canEditMap: boolean;
  columnsSize: { width: number; height: number };
  onApplyMapEntry:      (entry: MapCatalogEntry) => void;
  onApplyMapParams:     () => void;
  onOpenMapEditor:      () => void;
  onSaveCurrentMap:     (displayName: string) => void;
  onDownloadCurrentMap: (displayName: string) => void;
  onOpenMapLibrary:     () => void;
}) {
  const tex = useTextures(theme);

  // 第2ゲームは先攻・後攻が入れ替わるので盤面も180°反転する (MainWindow と同じ条件)。
  // プレビューだけ反転しないと、開始した瞬間に上下左右が入れ替わって見えてしまう。
  const flip = status.doubleMode && status.currentRound === 1;

  // ── プレビュー以外 (ラベル・要約・選択パネル) が使う高さを実測する ─────────────
  // 選択パネルは開閉で高さが変わるので定数では持てない。ただしこの高さは
  // プレビューの大きさには一切依存しないため、「測定→反映→再測定」の循環にはならない。
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [chromeH, setChromeH] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      const h = (headerRef.current?.offsetHeight ?? 0) + (footerRef.current?.offsetHeight ?? 0);
      setChromeH(prev => (prev === h ? prev : h));
    };
    const obs = new ResizeObserver(measure);
    if (headerRef.current) obs.observe(headerRef.current);
    if (footerRef.current) obs.observe(footerRef.current);
    measure();
    return () => obs.disconnect();
  }, [currentMap === null]);

  // 幅の予算 = 行の実幅から「COOL/HOT が最小幅を取ったあとの残り」を出し、
  // この列自身のパディングと安全マージンを差し引いたもの。こうして求めた幅に
  // 収めておけば、プレビューが原因で HOT が次の行に押し出されることがない。
  const budgetW = columnsSize.width - TEAM_MIN_W * 2 - COLUMNS_GAP * 2 - MAP_COL_PAD * 2 - WRAP_SAFETY;

  // 3カラムに割れない幅では、COOL と HOT を引き離すより両者を並べたまま
  // マップを下段へ送るほうが読みやすい。order で折り返し順だけを入れ替える。
  const inline = budgetW >= PREVIEW_MIN_W;
  const availW = inline ? budgetW : columnsSize.width - MAP_COL_PAD * 2;
  const previewW = inline
    ? Math.min(PREVIEW_MAX_W, budgetW)
    : Math.max(PREVIEW_MIN_W, Math.min(PREVIEW_MAX_W, availW));
  // 列の幅はプレビューと選択パネルの両方が要る幅。予算を超えない範囲で広げる。
  const contentW = Math.max(previewW, Math.min(PANEL_MIN_W, Math.max(availW, PREVIEW_MIN_W)));

  const column = { ...s.mapColumn, order: inline ? 0 : 1, width: contentW };

  const selector = (
    <MapSourceSection
      httpBase={httpBase}
      source={status.mapSource}
      canEdit={canEditMap}
      onApplyEntry={onApplyMapEntry}
      onApplyParams={onApplyMapParams}
      onOpenEditor={onOpenMapEditor}
      onSaveCurrent={onSaveCurrentMap}
      onDownloadCurrent={onDownloadCurrentMap}
      onOpenLibraryManager={onOpenMapLibrary}
    />
  );

  if (!currentMap) {
    return (
      <div style={column}>
        <div ref={headerRef} style={s.mapLabel}>マップ</div>
        <span style={s.hint}>読み込み中...</span>
        <div ref={footerRef} style={s.mapFooter}>{selector}</div>
      </div>
    );
  }

  const blocks = countObj(currentMap.field, MapObject.BLOCK);
  const items  = countObj(currentMap.field, MapObject.ITEM);

  const previewH = Math.max(
    120,
    columnsSize.height - chromeH - MAP_COL_VPAD * 2 - MAP_COL_GAP * 2,
  );
  const cellSize = Math.max(4, Math.min(
    Math.floor(previewW / currentMap.size.x),
    Math.floor(previewH / currentMap.size.y),
  ));

  return (
    <div style={column}>
      <div ref={headerRef} style={s.mapLabel}>マップ</div>
      <MapThumbnail
        field={currentMap.field as MapObject[][]}
        size={currentMap.size}
        teamFirstPoint={currentMap.teamFirstPoint}
        textures={tex}
        cellSize={cellSize}
        flip={flip}
      />
      <div ref={footerRef} style={s.mapFooter}>
        <div style={s.mapInfo}>
          <span style={s.mapKind}>{sourceLabel(status.mapSource)}</span>
          <span>{currentMap.size.x}×{currentMap.size.y} ・ ターン {currentMap.turn}</span>
          <span>ブロック {blocks} ・ アイテム {items}</span>
          {flip && <span style={s.flipBadge}>盤面反転</span>}
        </div>
        {selector}
      </div>
    </div>
  );
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

  // マッププレビュー列 (COOL と HOT の間)
  mapColumn: {
    flex: '0 0 auto',
    alignSelf: 'flex-start',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '14px 16px',
    background: BG_CARD,
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: RADIUS_MD,
    boxShadow: SHADOW_SM,
  },
  mapLabel: { fontSize: 9, color: TEXT_MUTED, letterSpacing: 1, alignSelf: 'flex-start' },
  // 要約 + マップ選択パネル。プレビュー高さを決めるために高さを実測する塊
  mapFooter: {
    width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
  },
  mapInfo: {
    width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
    fontSize: 10, color: TEXT_SECONDARY, fontFamily: FONT_NUM,
  },
  mapKind: {
    maxWidth: '100%', fontSize: 11, fontWeight: 700, color: TEXT_PRIMARY, fontFamily: FONT_UI,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  flipBadge: {
    fontSize: 10, fontWeight: 700, fontFamily: FONT_UI, color: TURN_BASE,
    background: TURN_LIGHT, borderRadius: 99, padding: '2px 8px', margin: '2px 0',
  },
  hint: { fontSize: 10, color: TEXT_MUTED },

  columns: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    overflow: 'auto',
    // スクロールバーの領域を常に確保する。これが無いと「プレビューを大きくする →
    // 行が縦にあふれてスクロールバーが出る → 行の内幅が縮む → プレビューが小さくなる →
    // スクロールバーが消える」という循環に入り、既定ウィンドウサイズで画面が振動する。
    scrollbarGutter: 'stable',
    padding: '16px 16px 0',
    alignItems: 'stretch',
  },
};
