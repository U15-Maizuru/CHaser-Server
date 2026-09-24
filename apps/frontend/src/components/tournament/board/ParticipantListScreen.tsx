import type { TournamentStatePayload } from '@u15/ws-types';
import { GroupIntroBoard } from './GroupIntroBoard';
import { QualifierListBoard } from './QualifierListBoard';
import { BG_ROOT, FONT_UI, TEXT_PRIMARY, TEXT_SECONDARY } from '../../../ui';

// 運営が観戦画面へ出す名簿。**大会の流れの中では自動で出ない** — 運営パネルの
// 「表示」タブで選んだときだけ、試合の合間 (待機中) に TournamentStandby の代わりとして出る。
//
// どちらの名簿かは `state.displayView` で決まる:
// - 'participants' (参加者一覧): どの形式でも出せる。予選のある形式はリーグ分けごと、
//   それ以外は全員を1枚にまとめる (GroupIntroBoard)
// - 'qualifiers' (決勝進出者): 予選のある形式だけ。決勝トーナメントへ進む人だけの一覧
//   (QualifierListBoard)

export interface ParticipantListScreenProps {
  state:        TournamentStatePayload;
  displayTitle: string;
}

export function ParticipantListScreen({ state, displayTitle }: ParticipantListScreenProps) {
  const qualifiers = state.displayView === 'qualifiers';
  return (
    <div style={s.root}>
      <div style={s.titleWrap}>
        <div style={s.eyebrow}>{displayTitle}</div>
        <div style={s.title}>{state.name}</div>
        <div style={s.sub}>
          {qualifiers
            ? `決勝トーナメント進出者${state.qualifiersConfirmed ? '' : ' (暫定)'}`
            : '参加者一覧'}
        </div>
      </div>
      {/* 残りの高さを全部渡す。中で fit が最大化する */}
      <div style={s.figure}>
        {qualifiers
          ? <QualifierListBoard state={state} />
          : <GroupIntroBoard state={state} />}
      </div>
    </div>
  );
}

// 骨格は TournamentStandby と同じ (上段は自然な高さ、下段が残りをもらう)
const s: Record<string, React.CSSProperties> = {
  root: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'stretch', justifyContent: 'center',
    background: BG_ROOT, fontFamily: FONT_UI, gap: 16, padding: '20px 16px',
    boxSizing: 'border-box', overflow: 'hidden',
  },
  titleWrap: {
    textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8,
    alignItems: 'center', flexShrink: 0,
  },
  eyebrow: { fontSize: 14, color: TEXT_SECONDARY, letterSpacing: '0.1em' },
  title:   { fontSize: 34, fontWeight: 800, letterSpacing: '0.05em', color: TEXT_PRIMARY },
  sub:     { fontSize: 16, color: TEXT_SECONDARY },
  figure:  { flex: 1, minHeight: 0, width: '100%' },
};
