import { useEffect, useState } from 'react';
import type { AnnouncementState } from '@u15/ws-types';
import {
  BG_HEADER, BORDER_COLOR, RADIUS_MD, SHADOW_MD, TEXT_MUTED, TEXT_SECONDARY,
  Badge, Button, ChipRow, Field, Hint, TextArea, TextInput,
} from '../../../ui';

// 試合と試合の合間に、観戦画面へ出す運営アナウンス (「10分間の休憩にします」など)。
//
// 「今やること」(NextActionCard) の真下に置く。次の試合を準備するか、その前に
// アナウンスを出すか — 運営が選ぶのはこの場面なので、選択肢を隣に並べる。
//
// **対戦カードが決まっている間 (armed) は出さない。** そこから先は観戦画面が
// 対戦画面に入っているので、出しても見えない (出しっぱなしを消せるよう、
// 表示中だけは armed でもカードを残す)。判定は TournamentPanel が持つ。
//
// **既定は畳んだ状態。** 運営パネルの縦は「今やること」と試合一覧のためのもので、
// 常時展開だと 800px の窓ではタブより下が全部スクロール送りになる。畳んだ見出しの行から
// 「出す」「消す」だけは直接押せるようにしてあるので、休憩を出し入れするだけなら
// 開かなくてよい — 開くのは文面を書き換えるときだけ。

export interface AnnouncementCardProps {
  announcement: AnnouncementState;
  /** 差分で送る。文面だけ・表示だけ、どちらも直せる */
  onChange: (patch: Partial<AnnouncementState>) => void;
}

export function AnnouncementCard({ announcement, onChange }: AnnouncementCardProps) {
  // 入力のたびに送るとサーバー側の保存が1文字ごとに走るので、手元で持って
  // 入力欄を離れたとき (blur) とボタンを押したときにだけ送る
  const [title, setTitle] = useState(announcement.title);
  const [body,  setBody]  = useState(announcement.body);
  // 出しっぱなしのまま畳まれると気づけないので、表示中は開いた状態から始める
  const [open,  setOpen]  = useState(announcement.visible);

  // 別の窓から書き換えられたら追従する (運営席が2つ開いていることがある)
  useEffect(() => { setTitle(announcement.title); }, [announcement.title]);
  useEffect(() => { setBody(announcement.body);  }, [announcement.body]);

  const dirty = title !== announcement.title || body !== announcement.body;
  const empty = title.trim() === '' && body.trim() === '';

  /** 入力欄を離れたときの反映。表示中なら観戦画面の文字がその場で変わる */
  const flush = () => { if (dirty) onChange({ title, body }); };

  const show = () => onChange({ title, body, visible: true });
  const hide = () => onChange({ title, body, visible: false });

  /** 畳んでいるときに文面の代わりに出す一行。何も無いことも伝える */
  const digest = title.trim() || body.trim().split('\n')[0] || '文面がありません';

  return (
    <div style={s.card} data-testid="announcement-card">
      <div style={s.head}>
        <button
          type="button"
          style={s.toggle}
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          <span style={s.caret}>{open ? '▾' : '▸'}</span>
          <span style={s.label}>合間のアナウンス</span>
          {announcement.visible && <Badge>表示中</Badge>}
          {!open && (
            <span style={{ ...s.digest, ...(empty ? s.digestEmpty : null) }}>{digest}</span>
          )}
        </button>

        {/* 出し入れは畳んだままでも押せる。休憩の開始・終了はこの2つで足りる */}
        {announcement.visible ? (
          <Button size="sm" variant="danger" noShrink onClick={hide}>■ 消す</Button>
        ) : (
          <Button
            size="sm" variant="accent" noShrink disabled={empty}
            title={empty ? '見出しか本文を入力すると押せます' : undefined}
            onClick={show}
          >
            ▶ 出す
          </Button>
        )}
      </div>

      {open && (
        <>
          <Field label="見出し" labelWidth={44}>
            <TextInput
              value={title}
              placeholder="休憩"
              aria-label="アナウンスの見出し"
              onChange={e => setTitle(e.target.value)}
              onBlur={flush}
              style={{ flex: 1, minWidth: 0 }}
            />
          </Field>
          <TextArea
            value={body}
            rows={3}
            placeholder={'10分間の休憩にします\n午後の開始は13:00です'}
            aria-label="アナウンスの本文"
            onChange={e => setBody(e.target.value)}
            onBlur={flush}
          />

          {announcement.visible && dirty && (
            <ChipRow>
              <Button size="sm" onClick={flush}>文面の変更を反映</Button>
            </ChipRow>
          )}

          <Hint>
            {announcement.visible
              ? '観戦画面に表示中です。「この試合を準備」すると自動で消えます。'
              : '待機中の観戦画面を、この案内で置き換えます。対戦中は割り込みません。'}
            文面は消したあとも残るので、次の休憩でもそのまま使えます。
          </Hint>
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    background: BG_HEADER, border: `1px solid ${BORDER_COLOR}`,
    borderRadius: RADIUS_MD, boxShadow: SHADOW_MD, padding: 14,
    display: 'flex', flexDirection: 'column', gap: 8,
    minWidth: 0, boxSizing: 'border-box', flexShrink: 0,
  },
  head: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  // 見出しの行ごと開閉のあたり判定にする (小さな三角だけを狙わせない)
  toggle: {
    flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6,
    background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
  },
  caret: { fontSize: 10, color: TEXT_SECONDARY, flexShrink: 0 },
  label: {
    fontSize: 11, letterSpacing: '0.06em', color: TEXT_SECONDARY, fontWeight: 700,
    flexShrink: 0,
  },
  // 畳んでいるときの中身のあらすじ。1行に収める
  digest: {
    fontSize: 11, color: TEXT_SECONDARY, minWidth: 0,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  digestEmpty: { color: TEXT_MUTED },
};
