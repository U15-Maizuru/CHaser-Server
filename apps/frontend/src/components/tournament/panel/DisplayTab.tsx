import type {
  AnnouncementState, TournamentBracketView, TournamentDisplayView, TournamentGroupView,
  TournamentStatePayload,
} from '@u15/ws-types';
import {
  displayViewAvailable, hasBotStage, hasBracket, hasQualifying, isListDisplayView,
  isTableDisplayView,
} from '@u15/ws-types';
import type { TournamentCommands } from '../../../hooks/useGameState';
import { TEXT_SECONDARY, Badge, Button, ChipRow, Hint, Section } from '../../../ui';
import { AnnouncementCard } from './AnnouncementCard';

// 観戦画面に何を出すか。**ここでの操作は観戦画面だけに効き、運営席の表は変わらない。**
//
// 観戦画面の表示は3つの軸が重なって決まり、軸ごとに節を分けてある (1つの平らな選択肢に
// 混ぜると、選べる組み合わせが見えなくなる):
//   ① アナウンス       … 試合の合間の待機画面を置き換える
//   ② 観戦画面の内容 … 進行に合わせる / 予選表 / 決勝表 / 名簿 (`displayView`)
//   ③ 表の見せ方       … 予選リーグの指定リーグ / トーナメントの型 (`groupView` / `bracketView`)
//
// 各行の先頭は「自動 (進行に合わせる)」で、指定を外すのはそのボタン1つ。指定中は見出しに
// 「指定中」、タブの見出しにも印を出す (外し忘れると次の試合の待機画面まで固定されるため)。

/** 表の見せ方 (予選リーグ・トーナメント) を指定しているか */
function looksPinned(state: TournamentStatePayload): boolean {
  return state.groupView !== 'auto' || state.bracketView !== 'auto';
}

/** 何かを固定しているか (タブの見出しの印にも使う) */
export function displayPinned(
  state: TournamentStatePayload, announcement: AnnouncementState,
): boolean {
  return announcement.visible || state.displayView !== 'auto' || looksPinned(state);
}

const BRACKET_VIEWS: [TournamentBracketView, string][] = [
  ['auto',    '自動'],
  ['whole',   '全体'],
  ['left',    '左ブロック'],
  ['right',   '右ブロック'],
  ['quarter', '準々決勝〜決勝'],
];

/** 排他の選択肢の並び。選んでいるものは塗られる */
function Choices<T extends string | number>({ options, value, onSelect }: {
  options:  readonly (readonly [T, string])[];
  value:    T;
  onSelect: (v: T) => void;
}) {
  return (
    <>
      {options.map(([v, label]) => (
        <Button key={v} variant="choice" size="sm" selected={value === v} onClick={() => onSelect(v)}>
          {label}
        </Button>
      ))}
    </>
  );
}

export interface DisplayTabProps {
  state:           TournamentStatePayload;
  commands:        TournamentCommands;
  /** 観戦画面に出す運営アナウンス (大会ではなくルームの状態なので commands とは別に受ける) */
  announcement:    AnnouncementState;
  setAnnouncement: (patch: Partial<AnnouncementState>) => void;
}

export function DisplayTab({ state, commands, announcement, setAnnouncement }: DisplayTabProps) {
  const format = state.stage.format;
  const groups = state.groups ?? [];
  const showGroupView = format === 'group-then-bracket' && groups.length > 1;
  const showLooks     = hasBracket(format) || showGroupView;
  const avail = (v: TournamentDisplayView) => displayViewAvailable(format, v);

  const resetLooks = () => {
    if (state.groupView !== 'auto')   commands.setGroupView('auto');
    if (state.bracketView !== 'auto') commands.setBracketView('auto');
  };

  // 「進行 / 表 / 名簿」の行が使う、画面の指定ボタン
  const view = (v: TournamentDisplayView, label: string) => (
    <Choices options={[[v, label]]} value={state.displayView} onSelect={commands.setDisplayView} />
  );

  const groupOptions: [TournamentGroupView, string][] = [
    ['auto', '自動'],
    ['all',  '全リーグ'],
    ...groups.map(g => [g.group, `${g.label}リーグ`] as [TournamentGroupView, string]),
  ];

  return (
    <>
      <Hint>
        ここでの操作は<strong>観戦画面だけ</strong>に効きます (この運営画面の表は変わりません)。
        対戦中は盤面が優先されます。
      </Hint>

      <AnnouncementCard announcement={announcement} onChange={setAnnouncement} />

      <Section
        title="観戦画面の内容"
        actions={state.displayView !== 'auto' ? <Badge>指定中</Badge> : undefined}
      >
        <Row label="進行">{view('auto', '進行に合わせる')}</Row>
        {avail('groups') && (
          <Row label="表">
            {view('groups', hasBotStage(format) ? 'BOT対戦予選の表' : '予選リーグ表')}
            {view('bracket', '決勝トーナメント表')}
          </Row>
        )}
        <Row label="名簿">
          {view('participants', '参加者一覧')}
          {avail('qualifiers') && view('qualifiers', '決勝進出者')}
        </Row>

        {state.displayView === 'auto' && hasQualifying(format) && (
          <Hint>
            予選が終わっても自動では切り替わらず、決勝進出者を
            <strong>確定するまで予選の最終結果を出し続けます</strong>。
          </Hint>
        )}
        {isTableDisplayView(state.displayView) && (
          <Hint>
            表を指定している間は、<strong>直前の試合の結果を出しません</strong>。
            戻すには「進行に合わせる」を押します。
          </Hint>
        )}
        {isListDisplayView(state.displayView) && (
          <Hint>
            試合の合間に{state.displayView === 'qualifiers' ? '決勝進出者' : '参加者'}の一覧を出しています。
            <strong>「この試合を準備」を押すと自動で「進行に合わせる」に戻ります</strong>。
            {state.displayView === 'qualifiers' && !state.qualifiersConfirmed &&
              ' 決勝進出者を確定するまでは「暫定」と表示されます。'}
          </Hint>
        )}
      </Section>

      {showLooks && (
        <Section
          title="表の見せ方"
          actions={looksPinned(state) ? (
            <>
              <Badge>指定中</Badge>
              <Button size="sm" variant="ghost" onClick={resetLooks}>すべて自動に戻す</Button>
            </>
          ) : undefined}
        >
          {showGroupView && (
            <Row label="予選リーグ">
              <Choices options={groupOptions} value={state.groupView} onSelect={commands.setGroupView} />
            </Row>
          )}
          {hasBracket(format) && (
            <Row label="トーナメント">
              <Choices options={BRACKET_VIEWS} value={state.bracketView} onSelect={commands.setBracketView} />
            </Row>
          )}
          <Hint>
            {showGroupView && (
              <>予選リーグの<strong>自動</strong>は、試合を確定した直後だけそのリーグを大きく出します。
                リーグを指定すると、そのリーグの星取表と順位表 (スコア) だけを出し続けます。<br /></>
            )}
            {hasBracket(format) && (
              <>トーナメントの<strong>自動</strong>は、予選のない4回戦以上の表で、1回戦の間は準備した試合の山だけ、
                準々決勝以降は準々決勝から決勝までを出します。回戦数が足りない型は全体を出します。</>
            )}
          </Hint>
        </Section>
      )}
    </>
  );
}

/** 見出し + 選択肢の1行。見出しの幅を揃えて、縦の目線を通す */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={row}>
      <span style={rowLabel}>{label}</span>
      <ChipRow style={{ flex: 1, minWidth: 0 }}>{children}</ChipRow>
    </div>
  );
}

const row: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 };
// ボタン (size=sm) の1行目と目線が合うよう、上に少し空ける
const rowLabel: React.CSSProperties = {
  flexShrink: 0, width: 64, paddingTop: 5, fontSize: 11, color: TEXT_SECONDARY, fontWeight: 700,
};
