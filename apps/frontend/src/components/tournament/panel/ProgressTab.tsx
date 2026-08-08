import type { TournamentMatch, TournamentStatePayload } from '@u15/ws-types';
import { compareByPlayOrder, hasQualifying } from '@u15/ws-types';
import type { TournamentCommands } from '../../../hooks/useGameState';
import { BotQualifierSection } from '../qualifier/BotQualifierSection';
import { QualifierSection } from '../qualifier/QualifierSection';
import { MatchCard } from '../board/MatchCard';
import {
  TEXT_MUTED, Button, EmptyState, Hint, Section,
} from '../../../ui';

// 大会の進み具合。決勝進出者の確認、試合の一覧と巻き戻し、結果の書き出し。

export interface ProgressTabProps {
  state:    TournamentStatePayload;
  httpBase: string;
  commands: TournamentCommands;
}

export function ProgressTab({ state, httpBase, commands }: ProgressTabProps) {
  const done = state.matches.filter(m => m.status === 'done').length;

  const download = (format: string) => {
    const a = document.createElement('a');
    a.href = `${httpBase}/api/tournament/${encodeURIComponent(state.tournamentId)}/export?format=${format}`;
    a.download = '';
    a.click();
  };

  return (
    <>
      {/* 決勝進出者。予選リーグは枠ごとの差し替え、BOT対戦予選は確認リストからの削除。
          同点の決め方が違うので UI ごと分ける (詳しくは各コンポーネントの冒頭) */}
      {state.stage.format === 'bot-then-bracket' ? (
        <BotQualifierSection
          state={state}
          onExclude={commands.excludeQualifier}
          onConfirm={commands.confirmQualifiers}
        />
      ) : hasQualifying(state.stage.format) && (
        <QualifierSection
          state={state}
          onChange={commands.setQualifier}
          onConfirm={commands.confirmQualifiers}
        />
      )}

      <Section title={`試合 (${done}/${state.matches.length} 完了)`}>
        <Hint>
          確定した結果は取り消せます。取り消すとその試合より後の結果も一緒に消えるので、
          聞かれたら内容を確認してから進めてください。
        </Hint>
        {[...state.matches].sort(compareByPlayOrder).map(m => (
          <MatchRow key={m.id} state={state} match={m} commands={commands} />
        ))}
      </Section>

      <Section title="結果の書き出し">
        <Hint>大会後の記録・表彰に使います。CSV は Excel でそのまま開けます。</Hint>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" onClick={() => download('json')}>JSON</Button>
          <Button size="sm" onClick={() => download('matches.csv')}>試合CSV</Button>
          {(state.stage.format === 'league' || hasQualifying(state.stage.format)) && (
            <Button size="sm" onClick={() => download('standings.csv')}>順位CSV</Button>
          )}
        </div>
      </Section>
    </>
  );
}

function MatchRow({ state, match, commands }: {
  state:    TournamentStatePayload;
  match:    TournamentMatch;
  commands: TournamentCommands;
}) {
  // bye による不戦勝は巻き戻しても同じ結果に組み直されるので、取り消す意味が無い
  const canReopen = match.status === 'done' && !(match.byeA || match.byeB);

  const reopen = () => {
    if (!window.confirm(
      `「${match.label}」の結果を取り消します。\n`
      + 'この試合より後の結果も一緒に取り消されます。よろしいですか？')) return;
    commands.reopen(match.id, true);
  };

  return (
    <div style={s.row}>
      <MatchCard
        match={match}
        participants={state.participants}
        format={state.stage.format}
        style={{ flex: 1, minWidth: 0 }}
      />
      {canReopen && <Button size="sm" noShrink onClick={reopen}>取り消す</Button>}
    </div>
  );
}

export function EmptyProgress() {
  return <EmptyState style={{ color: TEXT_MUTED }}>大会を選ぶと進行状況が出ます。</EmptyState>;
}

const s: Record<string, React.CSSProperties> = {
  row: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
};
