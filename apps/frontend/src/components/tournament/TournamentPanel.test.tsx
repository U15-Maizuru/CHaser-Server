import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TournamentCommands } from '../../hooks/useGameState';
import { TournamentPanel } from './TournamentPanel';

// 運営パネルの「書き出し」— 大会データを .zip で持ち出す経路の検証。
// 中身の正しさはバックエンド (bundle.test.ts の往復テスト) が持つので、ここでは
// 「正しい URL を叩き、名前を付けて保存し、同梱できなかったものを運営に知らせるか」を見る。

const HTTP = 'http://x';

const SUMMARY = {
  id: 'spring-cup', name: '春季カップ', format: 'single-elimination',
  participants: 4, progress: [0, 3], boundRoomId: null as string | null,
};

let calls: string[] = [];
let skippedHeader: string | null = null;
let summary = { ...SUMMARY };

function jsonRes(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

/** ダウンロード用のレスポンス (blob + X-Bundle-Skipped) */
function zipRes(): Response {
  return {
    ok: true,
    status: 200,
    blob: () => Promise.resolve(new Blob(['PK'])),
    headers: { get: (name: string) => (name === 'X-Bundle-Skipped' ? skippedHeader : null) },
  } as unknown as Response;
}

const commands = {} as unknown as TournamentCommands;

beforeEach(() => {
  calls = [];
  skippedHeader = encodeURIComponent('[]');
  summary = { ...SUMMARY };

  vi.stubGlobal('fetch', vi.fn((url: string) => {
    calls.push(url);
    if (url.includes('format=bundle.zip')) return Promise.resolve(zipRes());
    if (url.endsWith('/api/programs')) return Promise.resolve(jsonRes({ entries: [] }));
    if (url.endsWith('/api/maps'))     return Promise.resolve(jsonRes({ entries: [] }));
    return Promise.resolve(jsonRes({ imported: [summary], errors: [] }));
  }));

  // jsdom には無い / 実際に遷移させたくないもの
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:zip'),
    revokeObjectURL: vi.fn(),
  }));
  vi.stubGlobal('alert', vi.fn());
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** ダウンロード用に生成された <a> を捕まえる (クリックで実際に遷移させない) */
function captureAnchor(): { downloads: string[] } {
  const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  return { downloads };
}

async function renderPanel() {
  render(
    <TournamentPanel
      state={null} httpBase={HTTP} commands={commands} lastError={null} clearError={() => {}}
    />,
  );
  await screen.findByText('春季カップ');
}

describe('TournamentPanel — 大会データの書き出し', () => {
  it('書き出しで bundle.zip を取りに行き、大会名を付けて保存する', async () => {
    const { downloads } = captureAnchor();
    await renderPanel();

    fireEvent.click(screen.getByText('書き出し'));

    await waitFor(() => expect(downloads).toEqual(['春季カップ_大会データ.zip']));
    expect(calls).toContain(`${HTTP}/api/tournament/spring-cup/export?format=bundle.zip`);
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('同梱できなかったプログラムがあれば運営に知らせる', async () => {
    skippedHeader = encodeURIComponent(JSON.stringify(['A: .exe のプログラムは同梱できません']));
    captureAnchor();
    await renderPanel();

    fireEvent.click(screen.getByText('書き出し'));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining('.exe のプログラムは同梱できません'),
    ));
  });

  it('運営中の大会でも書き出せる (読むだけなので止めない)', async () => {
    summary = { ...SUMMARY, boundRoomId: 'room-1' };
    const { downloads } = captureAnchor();
    await renderPanel();

    // 運営中は「編集」が押せなくなるが、「書き出し」は押せる
    expect(screen.getByText('編集')).toBeDisabled();
    fireEvent.click(screen.getByText('書き出し'));

    await waitFor(() => expect(downloads).toEqual(['春季カップ_大会データ.zip']));
  });
});
