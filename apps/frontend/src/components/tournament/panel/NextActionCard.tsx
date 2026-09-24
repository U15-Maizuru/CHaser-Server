import type { CatalogEntry, TournamentMatch, TournamentStatePayload } from '@u15/ws-types';
import {
  armedLaneMatchIds, canRunInSideLane, doubleModeFor, nextOperatorAction,
  nextReadyMatches, type OperatorAction,
} from '@u15/ws-types';
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

/** 「今やること」の中に出す試合カード。1枚しか出さないので幅は親いっぱいに広げる */
function ActionMatchCard({ state, match }: {
  state: TournamentStatePayload;
  match: TournamentMatch;
}) {
  return (
    <MatchCard
      match={match}
      participants={state.participants}
      format={state.stage.format}
      style={{ width: '100%' }}
    />
  );
}

/**
 * 空いているレーンの数と、そこへ実際に配れる試合の数。
 *
 * **バックエンドの armNext と同じ述語 (canRunInSideLane) で、空きレーンの数を上限にして
 * 数える** — ここだけ独自条件にすると、押しても何も起きないボタンや、数が合わない案内ができる。
 */
function spareLanesOf(state: TournamentStatePayload): { idle: number; count: number } {
  const idle  = state.lanes.filter(l => l.armedMatchId === null).length;
  const count = nextReadyMatches(state.matches, idle, {
    busyIds: armedLaneMatchIds(state),
    canRun:  m => canRunInSideLane(state.stage.format, m),
  }).length;
  return { idle, count };
}

function Body({ state, action, commands, programs }: {
  state:    TournamentStatePayload;
  action:   OperatorAction;
  commands: TournamentCommands;
  programs: CatalogEntry[];
}) {
  const card = (match: TournamentMatch) => <ActionMatchCard state={state} match={match} />;

  switch (action.kind) {
    case 'confirm': {
      // 並列実行では複数のレーンがほぼ同時に決着する。確定は1件ずつのダイアログなので、
      // **残りが何件あるか**を先に見せておかないと「終わったはずの試合が消えない」に見える
      const waiting = state.matches.filter(m => m.status === 'awaiting_confirm').length;
      return (
        <>
          <p style={s.note}>
            対戦が終わりました。結果を確認して確定してください。
            {waiting > 1 && <strong>（確定待ち {waiting} 件。1件ずつ確定します）</strong>}
          </p>
          {card(action.match)}
        </>
      );
    }

    case 'start':
      // 並列実行中は「どのレーンが何を抱えているか」をまとめて見せ、開始も1操作にする
      if (state.lanes.length > 1) return <LaneStart state={state} commands={commands} />;
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
      // action.over (BOT対戦予選だけ意味を持つ。nextOperatorAction が判定する) が
      // 0より大きい間はボタンを出さない。ここで無条件に出すと、BotQualifierSection 側の
      // disabled={over > 0} を素通りして、同点のボーダーを1人も削らずに確定できてしまう
      // (削る手段はそちらにしか無い)
      return (
        <>
          <p style={s.note}>
            予選が終わりました。下の「決勝進出者」を確認し、確定すると決勝トーナメントへ進みます。
            確定するまで観戦画面には予選の最終結果が出続けます。
          </p>
          {action.over > 0 ? (
            <Hint>
              同点で並んでいます。「進行」タブの「決勝進出者」から、あと{action.over}名を削ってください。
            </Hint>
          ) : (
            <Button variant="primary" onClick={() => commands.confirmQualifiers(true)}>
              この決勝進出者で確定 ▶
            </Button>
          )}
        </>
      );

    case 'arm': {
      // 1ゲーム制の試合だけ先攻・後攻を入れ替えられる (2ゲーム制は第2ゲームで自動的に
      // 入れ替わるため対象外)。BOT対戦予選は全参加者が同一条件で測られるのが根拠なので除外
      const swappable = !doubleModeFor(state, action.match)
        && !(state.stage.format === 'bot-then-bracket' && action.match.group !== undefined);
      // 並列実行中に配れる予選試合があるなら、**まとめて配るほうを主役にする**。
      // 逆にすると「この試合を準備」を押した時点で action が 'start' へ移り、残りの
      // レーンへ配る入口をその画面から失う (1レーンだけで走らせることになる)
      const spare = spareLanesOf(state);
      const bulk  = state.lanes.length > 1 && spare.count > 1;
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
          {bulk && (
            <>
              <Button variant="primary" onClick={() => commands.armNext()}>
                {spare.count}試合をまとめて準備 ▶
              </Button>
              <Hint>
                次に実施する予選試合を、空いている{spare.idle}レーンへ一度に配ります。
              </Hint>
            </>
          )}
          <Button
            variant={bulk ? 'secondary' : 'primary'}
            onClick={() => commands.arm(action.match.id)}
          >
            {bulk ? 'この試合だけ準備' : 'この試合を準備 ▶'}
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

/**
 * 並列実行中の「ゲームを開始する」。どのレーンが何を抱えているかを並べ、開始は1操作にする。
 *
 * **副レーンにはコントロール画面が無い** (窓は主レーンの部屋にしか開かない) ので、
 * 並列実行中の「ゲームスタート」はここが唯一の入口になる。
 */
function LaneStart({ state, commands }: {
  state:    TournamentStatePayload;
  commands: TournamentCommands;
}) {
  const spare   = spareLanesOf(state);
  const running = state.matches.some(m => m.status === 'in_progress');
  // **レーン番号を添える。** 観戦画面の分割表示が「レーン1〜N」で並ぶので、
  // 番号が無いと「レーン2が止まっている」をどの試合のことか言い当てられない
  const armed = state.lanes
    .map((l, i) => ({ lane: i + 1, match: state.matches.find(m => m.id === l.armedMatchId) }))
    .filter((x): x is { lane: number; match: TournamentMatch } => x.match !== undefined);

  return (
    <>
      <p style={s.note}>
        {armed.length}試合ぶんの割り当てが済みました。
        同時に行う試合には<strong>コントロール画面がありません</strong>ので、
        開始はこのボタンから行います。
      </p>
      {armed.map(({ lane, match }) => (
        <div key={match.id} style={s.laneRow}>
          <span style={s.laneTag}>レーン{lane}</span>
          <div style={s.laneCard}><ActionMatchCard state={state} match={match} /></div>
        </div>
      ))}
      <Button variant="primary" onClick={() => commands.startLanes()}>
        準備できた試合をまとめて開始 ▶
      </Button>
      {/* 1試合ずつ準備してしまった運営が、残りのレーンを空けたまま始めなくて済むように。
          ここに出さないと、いったん準備した時点で配り直す入口が無くなる。
          **走り出したあとは出さない** — 「まとめて開始」は準備済みのレーンを全部
          押しにいくので、対戦中のレーンへもう一度スタートを投げることになる */}
      {spare.count > 0 && !running && (
        <>
          <Button variant="accent" onClick={() => commands.armNext()}>
            空いているレーンへ、あと{spare.count}試合を準備 ▶
          </Button>
          <Hint>
            レーンが{spare.idle}本空いています。開始前なら追加で配れます。
          </Hint>
        </>
      )}
    </>
  );
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
  laneRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  // 観戦画面の分割表示の「レーン1」と同じ呼び名。番号で画面と試合を結ぶ
  laneTag: {
    width: 46, flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
    color: TEXT_MUTED,
  },
  laneCard: { flex: 1, minWidth: 0 },
  assign: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 12 },
  assignName: {
    width: 110, flexShrink: 0, color: TEXT_SECONDARY,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
};
