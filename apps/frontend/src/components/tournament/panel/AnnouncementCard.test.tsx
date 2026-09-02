import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AnnouncementState } from '@u15/ws-types';
import { NO_ANNOUNCEMENT } from '@u15/ws-types';
import { AnnouncementCard } from './AnnouncementCard';

// 合間のアナウンス。文面はサーバーが持つ (観客席は別端末) ので、送るのは差分。
// 入力のたびに送らない (保存が1文字ごとに走る) というのがこのカードの肝。
//
// 既定は畳んだ状態で、出し入れだけは畳んだまま押せる。文面に触る試験は先に開くこと。

const onChange = vi.fn();

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function show(over: Partial<AnnouncementState> = {}) {
  render(<AnnouncementCard announcement={{ ...NO_ANNOUNCEMENT, ...over }} onChange={onChange} />);
}

/** 文面の入力欄を出す (表示中の大会では最初から開いている) */
function expand() {
  const head = screen.getByText('合間のアナウンス');
  if (head.parentElement?.getAttribute('aria-expanded') === 'false') fireEvent.click(head);
}

const titleBox = () => screen.getByLabelText('アナウンスの見出し');
const bodyBox  = () => screen.getByLabelText('アナウンスの本文');

describe('AnnouncementCard', () => {
  it('既定では畳まれていて、開くと文面を書ける', () => {
    show();
    expect(screen.queryByLabelText('アナウンスの見出し')).toBeNull();
    expand();
    expect(titleBox()).toBeInTheDocument();
  });

  it('表示中の大会では開いた状態から始まる (出しっぱなしに気づけるように)', () => {
    show({ title: '休憩', visible: true });
    expect(titleBox()).toHaveValue('休憩');
  });

  it('文面が空のうちは観客席に出せない', () => {
    show();
    expect(screen.getByText('▶ 出す')).toBeDisabled();
  });

  it('入力しただけでは送らず、入力欄を離れたときに送る', () => {
    show();
    expand();
    fireEvent.change(bodyBox(), { target: { value: '10分間の休憩にします' } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(bodyBox());
    expect(onChange).toHaveBeenCalledWith({ title: '', body: '10分間の休憩にします' });
  });

  it('出すときは、まだ送っていない文面ごと表示に切り替える', () => {
    show();
    expand();
    fireEvent.change(titleBox(), { target: { value: '休憩' } });
    fireEvent.click(screen.getByText('▶ 出す'));

    expect(onChange).toHaveBeenCalledWith({ title: '休憩', body: '', visible: true });
  });

  it('表示中は消す操作になり、文面は残したまま visible だけ落とす', () => {
    show({ title: '休憩', body: 'いま休憩中です', visible: true });
    fireEvent.click(screen.getByText('■ 消す'));

    expect(onChange).toHaveBeenCalledWith({
      title: '休憩', body: 'いま休憩中です', visible: false,
    });
  });

  it('別の窓で文面が変わったら追従する', () => {
    const { rerender } = render(
      <AnnouncementCard
        announcement={{ ...NO_ANNOUNCEMENT, title: '休憩', visible: true }}
        onChange={onChange}
      />,
    );
    rerender(
      <AnnouncementCard
        announcement={{ ...NO_ANNOUNCEMENT, title: '再開', visible: true }}
        onChange={onChange}
      />,
    );
    expect(titleBox()).toHaveValue('再開');
  });
});
