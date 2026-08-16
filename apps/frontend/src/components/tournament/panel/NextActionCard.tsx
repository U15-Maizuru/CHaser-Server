import type { CatalogEntry, TournamentStatePayload } from '@u15/ws-types';
import { doubleModeFor, nextOperatorAction, type OperatorAction } from '@u15/ws-types';
import type { TournamentCommands } from '../../../hooks/useGameState';
import { MatchCard } from '../board/MatchCard';
import {
  BG_HEADER, BORDER_COLOR, RADIUS_MD, SHADOW_MD, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY,
  Button, EmptyState, Hint, Select,
} from '../../../ui';

// 運営パネルの最上部に固定される「今やること」1枚。
//
// 状況に対して押すべきものは常に1つに定まる (nextOperatorAction)。設定や一覧を
// 探しに行かなくても、この1枚だけ見ていれば大会が最後まで進むのが要件。

export interface NextActionCardProps {
  state:    TournamentStatePayload | null;
  commands: TournamentCommands;
  /** プログラム未登録の参加者に割り当てる候補 */
  programs: CatalogEntry[];
}

export function NextActionCard({ state, commands, programs }: NextActionCardProps) {
  if (!state) {
    return (
      <div style={s.card}>
        <div style={s.label}>大会を選ぶ</div>
        <EmptyState style={{ padding: 8 }}>
          下の「大会」タブで運営する大会を選んでください。
        </EmptyState>
      </div>
    );
  }

  const action = nextOperatorAction(state);
  return (
    <div style={s.card} data-testid="next-action" data-action={action.kind}>
      <div style={s.label}>{HEADING[action.kind]}</div>
      <Body state={state} action={action} commands={commands} programs={programs} />
    </div>
  );
}

const HEADING: Record<OperatorAction['kind'], string> = {
  'confirm':            '結果を確定する',
  'start':              'ゲームを開始する',
  'confirm-qualifiers': '決勝進出者を確定する',
  'arm':                '次の試合を準備する',
  'assign-programs':    'プログラムを割り当てる',
  'finished':           '大会終了',
  'idle':               '待機中',
};

function Body({ state, action, commands, programs }: {
  state:    TournamentStatePayload;
  action:   OperatorAction;
  commands: TournamentCommands;
  programs: CatalogEntry[];
}) {
  const card = (match: Parameters<typeof MatchCard>[0]['match']) => (
    <MatchCard
      match={match}
      participants={state.participants}
      format={state.stage.format}
      style={{ width: '100%' }}
    />
  );

  switch (action.kind) {
    case 'confirm':
      return (
        <>
          <p style={s.note}>対戦が終わりました。結果を確認して確定してください。</p>
          {card(action.match)}
        </>
      );

    case 'start':
      return (
        <>
          <p style={s.note}>
            両者の割り当てが済みました。コントロール画面の「ゲームスタート」で開始します。
            やめるときは同じ画面の「リセット」で準備を取り消せます。
          </p>
          {card(action.match)}
        </>
      );

    case 'confirm-qualifiers':
      return (
        <>
          <p style={s.note}>
            予選が終わりました。下の「決勝進出者」で顔ぶれを確認し、確定すると決勝トーナメントへ進みます。
            確定するまで観客席には予選の最終結果が出続けます。
          </p>
          <Button variant="primary" onClick={() => commands.confirmQualifiers(true)}>
            この顔ぶれで確定 ▶
          </Button>
        </>
      );

    case 'arm': {
      // 1ゲーム制の試合だけ先攻・後攻を入れ替えられる (2ゲーム制は第2ゲームで自動的に
      // 入れ替わるため対象外)。BOT対戦予選は全参加者が同一条件で測られるのが根拠なので除外
      const swappable = !doubleModeFor(state, action.match)
        && !(state.stage.format === 'bot-then-bracket' && action.match.group !== undefined);
      return (
        <>
          {card(action.match)}
          {swappable && (
            <>
              <Button size="sm" onClick={() => commands.swapSides(action.match.id)}>
                先攻・後攻を入れ替える
              </Button>
              <Hint>
                1ゲーム制なので、先攻・後攻はこの試合ごとにランダムに決まっています。
                必要ならここで入れ替えられます。
              </Hint>
            </>
          )}
          <Button variant="primary" onClick={() => commands.arm(action.match.id)}>
            この試合を準備 ▶
          </Button>
        </>
      );
    }

    case 'assign-programs':
      return (
        <>
          <p style={s.note}>
            次の試合の出場者にプログラムが登録されていません。
            当日届いたプログラムを「プログラム管理」で追加してから割り当ててください。
          </p>
          {card(action.match)}
          {action.participants.map(p => (
            <div key={p.id} style={s.assign}>
              <span style={s.assignName}>{p.isBot ? `🤖 ${p.name}` : p.name}</span>
              <Select
                defaultValue=""
                aria-label={`${p.name} のプログラム`}
                onChange={e => e.target.value && commands.assignProgram(p.id, e.target.value)}
                style={{ flex: 1, minWidth: 0 }}
              >
                <option value="">プログラムを選ぶ…</option>
                {programs.map(pr => (
                  <option key={pr.id} value={pr.id}>{pr.displayName}</option>
                ))}
              </Select>
            </div>
          ))}
        </>
      );

    case 'finished':
      return <p style={s.note}>全ての試合が終了しました 🎉 「進行」タブで結果を書き出せます。</p>;

    case 'idle':
      return <p style={s.note}>{action.reason}</p>;
  }
}

const s: Record<string, React.CSSProperties> = {
  card: {
    background: BG_HEADER, border: `1px solid ${BORDER_COLOR}`,
    borderRadius: RADIUS_MD, boxShadow: SHADOW_MD, padding: 14,
    display: 'flex', flexDirection: 'column', gap: 8,
    minWidth: 0, boxSizing: 'border-box', flexShrink: 0,
  },
  label: {
    fontSize: 11, letterSpacing: '0.06em', color: TEXT_SECONDARY, fontWeight: 700,
  },
  note: { margin: 0, fontSize: 12, lineHeight: 1.7, color: TEXT_PRIMARY },
  assign: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 12 },
  assignName: {
    width: 110, flexShrink: 0, color: TEXT_SECONDARY,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
};
