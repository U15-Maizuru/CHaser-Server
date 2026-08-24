import { useEffect, useState } from 'react';
import type {
  CatalogEntry, MapCatalogEntry, TournamentStatePayload, TournamentSummary,
} from '@u15/ws-types';
import type { TournamentCommands } from '../../../hooks/useGameState';
import { NextActionCard } from './NextActionCard';
import { LibraryTab } from './LibraryTab';
import { ProgressTab } from './ProgressTab';
import { SettingsTab } from './SettingsTab';
import { ResultConfirmDialog } from './ResultConfirmDialog';
import {
  FONT_UI, TEXT_PRIMARY, TEXT_SECONDARY, Callout, EmptyState, Tabs, type TabDef,
} from '../../../ui';

// 運営パネル。上に「今やること」を固定し、その下をタブで切り替える。
//
// 大会を最後まで進めるだけなら上の1枚しか見なくてよく、タブは
//   大会 … 運営する大会を選ぶ・作る・持ち出す
//   進行 … 決勝進出者の確認、試合の一覧と巻き戻し、結果の書き出し
//   設定 … 観客席の表示・回戦ごとのマップ・オートプレイ
// と、運営の関心ごとに分ける。

type PanelTab = 'library' | 'progress' | 'settings';

export interface TournamentPanelProps {
  state:      TournamentStatePayload | null;
  httpBase:   string;
  commands:   TournamentCommands;
  lastError:  string | null;
  clearError: () => void;
}

export function TournamentPanel({
  state, httpBase, commands, lastError, clearError,
}: TournamentPanelProps) {
  const [summaries,  setSummaries]  = useState<TournamentSummary[]>([]);
  const [scanErrors, setScanErrors] = useState<{ id: string; message: string }[]>([]);
  const [programs,   setPrograms]   = useState<CatalogEntry[]>([]);
  const [maps,       setMaps]       = useState<MapCatalogEntry[]>([]);
  // 大会を選ぶ前は「大会」タブしか意味を持たないので、そこから始める
  const [tab, setTab] = useState<PanelTab>('library');

  const refresh = async () => {
    try {
      const res  = await fetch(`${httpBase}/api/tournament`);
      const body = await res.json() as { imported: TournamentSummary[]; errors: typeof scanErrors };
      setSummaries(body.imported ?? []);
      setScanErrors(body.errors ?? []);
    } catch { /* オフラインなら一覧は空のまま */ }
    try {
      const res = await fetch(`${httpBase}/api/programs`);
      setPrograms((await res.json() as { entries: CatalogEntry[] }).entries ?? []);
    } catch { /* 未提出の割り当てができないだけ */ }
    try {
      const res = await fetch(`${httpBase}/api/maps`);
      setMaps((await res.json() as { entries: MapCatalogEntry[] }).entries ?? []);
    } catch { /* 回戦ごとのマップを選べないだけ */ }
  };

  useEffect(() => { void refresh(); }, [httpBase, state?.tournamentId]);

  // 大会を選んだら進行へ、終了したら大会一覧へ。運営の視線を追わせない
  useEffect(() => { setTab(state ? 'progress' : 'library'); }, [state?.tournamentId]);

  const awaiting = state?.matches.find(m => m.status === 'awaiting_confirm') ?? null;

  const tabs: TabDef<PanelTab>[] = [
    { id: 'library',  label: '大会' },
    { id: 'progress', label: '進行', ...(state ? {} : { disabledReason: '大会を選ぶと使えます' }) },
    { id: 'settings', label: '設定', ...(state ? {} : { disabledReason: '大会を選ぶと使えます' }) },
  ];

  return (
    <div style={s.root}>
      {state && <div style={s.title}>{state.name}</div>}

      {lastError && <Callout tone="error" onDismiss={clearError}>{lastError}</Callout>}

      <NextActionCard state={state} commands={commands} programs={programs} />

      <Tabs tabs={tabs} active={tab} onSelect={setTab} />

      <div style={s.body}>
        {tab === 'library' && (
          <LibraryTab
            state={state}
            summaries={summaries}
            scanErrors={scanErrors}
            httpBase={httpBase}
            commands={commands}
            refresh={refresh}
          />
        )}
        {tab === 'progress' && (state
          ? <ProgressTab state={state} httpBase={httpBase} commands={commands} />
          : <EmptyState>大会を選ぶと進行状況が出ます。</EmptyState>)}
        {tab === 'settings' && (state
          ? <SettingsTab state={state} maps={maps} commands={commands} />
          : <EmptyState>大会を選ぶと設定できます。</EmptyState>)}
      </div>

      {state && awaiting && (
        <ResultConfirmDialog
          match={awaiting}
          participants={state.participants}
          // 予選リーグの試合は引き分けをそのまま確定できる。1つの大会に予選と決勝が
          // 同居するので、形式ではなくその試合が予選かどうかで決める
          isLeague={awaiting.group !== undefined || state.stage.format === 'league'}
          httpBase={httpBase}
          // 回戦ごとのマップも「固定マップ運用」— リセットしても引き直されないので
          // 同点の再試合では別マップを選ばせる (バックエンドの discardResult と同じ判定)
          requireMapChangeOnRematch={
            (state.stageMaps[awaiting.stage] ?? state.stage.map.catalogId) !== null
          }
          ruleSet={state.ruleSet}
          onConfirm={(winnerSide, note) => commands.confirm(awaiting.id, winnerSide, note)}
          onRematch={mapId => commands.discard(awaiting.id, mapId)}
          onWalkover={winnerSide => commands.walkover(awaiting.id, winnerSide)}
        />
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, height: '100%',
    fontFamily: FONT_UI, color: TEXT_PRIMARY,
  },
  title: {
    fontSize: 13, fontWeight: 700, color: TEXT_SECONDARY,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  // タブの中身だけがスクロールする。「今やること」は常に見えている必要がある
  body: {
    flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
};
