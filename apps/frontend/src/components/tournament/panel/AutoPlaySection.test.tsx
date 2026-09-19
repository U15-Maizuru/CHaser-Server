import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TournamentAutoPlay, TournamentStatePayload } from '@u15/ws-types';
import type { TournamentCommands } from '../../../hooks/useGameState';
import { AutoPlaySection } from './AutoPlaySection';

// オートプレイは「設定」タブの末尾に置く (本来は使わない機能なので前面に出さない)。
// 押したときに**変えたい1項目だけ**をバックエンドへ送ること (省略した項目は今の設定が保たれる)
// と、止まった理由が出ることを押さえる。

const OFF: TournamentAutoPlay = {
  enabled: false, loop: false, announce: false, tieBreak: 'pause', stoppedReason: null,
};

const setAutoPlay = vi.fn();
const commands = { setAutoPlay } as unknown as TournamentCommands;

const stateWith = (autoPlay: Partial<TournamentAutoPlay>) =>
  ({ autoPlay: { ...OFF, ...autoPlay } }) as unknown as TournamentStatePayload;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('AutoPlaySection — 開始/停止', () => {
  it('停止中なら「始める」を出し、押すと開始を送る', () => {
    render(<AutoPlaySection state={stateWith({})} commands={commands} />);
    fireEvent.click(screen.getByRole('button', { name: /始める/ }));
    expect(setAutoPlay).toHaveBeenCalledWith(true);
  });

  it('実行中なら「止める」を出し、押すと停止を送る', () => {
    render(<AutoPlaySection state={stateWith({ enabled: true })} commands={commands} />);
    expect(screen.queryByRole('button', { name: /始める/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /止める/ }));
    expect(setAutoPlay).toHaveBeenCalledWith(false);
  });

  it('止まった理由を出す', () => {
    render(
      <AutoPlaySection
        state={stateWith({ stoppedReason: '「決勝」が同点です。再試合するか、勝者を指定してください' })}
        commands={commands}
      />,
    );
    expect(screen.getByText(/「決勝」が同点です/)).toBeInTheDocument();
  });
});

describe('AutoPlaySection — 設定', () => {
  it('同点の扱いは、変えたい項目だけを送る (実行中の状態は保つ)', () => {
    render(<AutoPlaySection state={stateWith({ enabled: true })} commands={commands} />);
    fireEvent.click(screen.getByRole('button', { name: '抽選で決めて続ける' }));
    expect(setAutoPlay).toHaveBeenCalledWith(true, undefined, undefined, 'random');
  });

  it('選ばれている同点の扱いに応じた説明を出す', () => {
    const { rerender } = render(
      <AutoPlaySection state={stateWith({ tieBreak: 'pause' })} commands={commands} />,
    );
    expect(screen.getByText(/自動進行を止め/)).toBeInTheDocument();

    rerender(<AutoPlaySection state={stateWith({ tieBreak: 'random' })} commands={commands} />);
    expect(screen.getByText(/ランダムに勝者を決めて/)).toBeInTheDocument();
  });

  it('アナウンスとデモモードはチェックボックスで、それぞれ自分の項目だけを送る', () => {
    render(<AutoPlaySection state={stateWith({})} commands={commands} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /アナウンスを挟む/ }));
    expect(setAutoPlay).toHaveBeenLastCalledWith(false, undefined, true);

    fireEvent.click(screen.getByRole('checkbox', { name: /デモモード/ }));
    expect(setAutoPlay).toHaveBeenLastCalledWith(false, true);
  });

  it('入っている設定はチェック済みで見せ、外すと false を送る', () => {
    render(
      <AutoPlaySection state={stateWith({ announce: true, loop: true })} commands={commands} />,
    );
    const announce = screen.getByRole('checkbox', { name: /アナウンスを挟む/ });
    expect(announce).toBeChecked();
    fireEvent.click(announce);
    expect(setAutoPlay).toHaveBeenLastCalledWith(false, undefined, false);
  });
});
