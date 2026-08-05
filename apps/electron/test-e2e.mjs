#!/usr/bin/env node
/**
 * U15 Server Maizuru — E2E 全自動テストスクリプト
 *
 * 実行方法:
 *   node apps/electron/test-e2e.mjs
 *
 * 前提:
 *   - apps/electron/dist/ が最新ビルド済み (pnpm --filter @u15/electron build)
 *   - apps/backend/dist/  が最新ビルド済み (pnpm --filter @u15/backend build)
 *   - playwright が apps/electron にインストール済み
 */

import { _electron as electron } from 'playwright';
import { spawn }                 from 'node:child_process';
import path                      from 'node:path';
import fs                        from 'node:fs';
import { fileURLToPath }         from 'node:url';
import { killTree }              from './dist/killTree.js';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT  = path.resolve(__dirname, '../..');
const SHOT_DIR      = path.join(PROJECT_ROOT, 'test-screenshots');
const ELECTRON_BIN  = process.platform === 'win32'
  ? path.join(__dirname, 'node_modules/electron/dist/electron.exe')
  : path.join(__dirname, 'node_modules/electron/dist/electron');

fs.mkdirSync(SHOT_DIR, { recursive: true });

// ── 結果管理 ─────────────────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;
const results = [];

function pass(name) {
  passCount++;
  results.push({ name, status: 'PASS' });
  console.log(`    ✓ ${name}`);
}

function fail(name, reason = '') {
  failCount++;
  results.push({ name, status: 'FAIL', reason });
  console.log(`    ✗ ${name}${reason ? ': ' + reason : ''}`);
}

function section(title) {
  console.log(`\n  ▶ ${title}`);
}

// ── ヘルパー ──────────────────────────────────────────────────────────────────

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function ss(page, name) {
  const f = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: f }).catch(() => {});
  return f;
}

/** ボタンテキストで DOM クリック */
async function clickText(page, text) {
  return page.evaluate(t => {
    const els = [...document.querySelectorAll('button, a, [role="button"]')];
    const el  = els.find(e => e.textContent?.trim() === t)
             ?? els.find(e => e.textContent?.includes(t));
    if (!el) return 'NOT_FOUND: ' + t;
    el.click();
    return 'OK';
  }, text);
}

/** 2番目の CPU ボタンをクリック (HOT 側) */
async function clickSecondCPU(page) {
  return page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
      .filter(b => b.textContent?.trim() === 'CPU');
    if (btns.length >= 2) { btns[1].click(); return 'OK'; }
    if (btns.length === 1) { btns[0].click(); return 'OK_1'; }
    return 'NOT_FOUND';
  });
}

/** ボディテキスト取得 */
async function bodyText(page) {
  return page.evaluate(() => document.body.innerText ?? '');
}

/**
 * 手動操作ウィンドウで指定アクション (観察/探索) を上方向に1回送る。
 * 手番でないタイミングに当たると演出が出ないので、方向ボタンが有効になるまで待つ。
 */
async function sendManualScan(manualPage, optionLabel, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await manualPage.evaluate((label) => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => !b.disabled && b.textContent === '↑');
      if (!btn) return 'NOT_MY_TURN';

      const select = document.querySelector('select');
      if (!select) return 'NO_SELECT';
      const opt = [...select.options].find(o => o.textContent?.includes(label));
      if (!opt) return 'NO_OPTION: ' + label;
      // React の onChange を発火させるため、value 設定後に change を明示的に投げる
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, opt.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));

      btn.click();
      return 'OK';
    }, optionLabel);
    if (r !== 'NOT_MY_TURN') return r;
    await wait(100);
  }
  return 'NOT_MY_TURN';
}

/** 設定ダイアログの「ダークモード」チェックボックスを目的の状態にする */
async function setDarkModeCheckbox(page, on) {
  return page.evaluate((want) => {
    const row = [...document.querySelectorAll('tr')]
      .find(tr => tr.textContent?.includes('ダークモード'));
    if (!row) return 'NO_ROW';
    const box = row.querySelector('input[type="checkbox"]');
    if (!box) return 'NO_CHECKBOX';
    if (box.checked !== want) box.click();
    return 'OK';
  }, on);
}

/** 設定ダイアログを開いて「対戦」タブを表示する */
async function openMatchTab(page) {
  await clickText(page, '設定');
  await wait(500);
  await clickText(page, '対戦');
  await wait(300);
}

/** 設定ダイアログを ✕ で閉じる (「対戦」タブは即時反映なので保存不要) */
async function closeSettingDialog(page) {
  await clickText(page, '✕');
  await wait(400);
}

/** 「対戦」タブの対戦ルールチップ (2ゲーム制 / リピート / デモ) を読み取る */
async function readMatchRuleChips(page) {
  return page.evaluate(() => {
    const out = {};
    for (const b of document.querySelectorAll('button')) {
      const label = (b.textContent ?? '').replace('✓', '').trim();
      if (!['2ゲーム制', 'リピート', 'デモ'].includes(label)) continue;
      out[label] = { active: (b.textContent ?? '').includes('✓'), disabled: b.disabled };
    }
    return out;
  });
}

/**
 * 設定ダイアログ「対戦」タブの対戦ルールチップを目的の状態に切り替えて閉じる。
 * ON のチップは先頭に "✓ " が付く。押した時点で反映されるので保存操作は要らない。
 */
async function setMatchRuleChip(page, label, on) {
  await openMatchTab(page);
  const result = await page.evaluate(({ label, on }) => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => (b.textContent ?? '').replace('✓', '').trim() === label);
    if (!btn) return 'NOT_FOUND';
    if (btn.disabled) return 'DISABLED';
    const active = (btn.textContent ?? '').includes('✓');
    if (active !== on) btn.click();
    return 'OK';
  }, { label, on });
  await wait(300);
  await closeSettingDialog(page);
  return result;
}

/** テキストが現れるまで待つ */
async function waitFor(page, text, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await bodyText(page)).includes(text)) return true;
    await wait(300);
  }
  return false;
}

/** ゲーム終了を示すテキストが現れるまで待つ */
async function waitForGameEnd(page, timeoutMs = 40000) {
  return waitFor(page, 'セットアップに戻る', timeoutMs);
}

/** ゲーム中 (ボード表示) を確認 — 1ゲーム制のサイドパネルは主役として「合計ポイント」を
 *  大きく表示する (2ゲーム制は明細 + 総合欄の「合計」なので、この文字列では判定できない) */
async function waitForGameStart(page, timeoutMs = 15000) {
  const found = await waitFor(page, '合計ポイント', timeoutMs);
  return found;
}

// ── Vite dev サーバー起動 ─────────────────────────────────────────────────────

async function startViteServer() {
  // 既に起動中かチェック
  try {
    const res = await fetch('http://localhost:5173').catch(() => null);
    if (res) { console.log('  Vite server は既に起動中です'); return null; }
  } catch { /* ignore */ }

  return new Promise((resolve, reject) => {
    const proc = spawn('pnpm', ['--filter', '@u15/frontend', 'dev'], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let ready = false;
    const timer = setTimeout(() => {
      if (!ready) reject(new Error('Vite サーバー起動タイムアウト'));
    }, 30000);

    proc.stdout.on('data', (d) => {
      // eslint-disable-next-line no-control-regex
      const plain = d.toString().replace(/\x1b\[[0-9;]*m/g, '');
      if (plain.includes('localhost:5173') && !ready) {
        ready = true;
        clearTimeout(timer);
        setTimeout(() => resolve(proc), 800);
      }
    });

    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (!ready) reject(new Error(`Vite が終了: ${code}`));
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// テストスイート
// ═══════════════════════════════════════════════════════════════════════════

/** テスト 1: セットアップ画面の UI 構造確認 */
async function testSetupUI(page) {
  section('セットアップUI');

  const text = await bodyText(page);

  // 2カラムレイアウト
  text.includes('COOL') && text.includes('HOT')
    ? pass('COOL / HOT パネルが 2カラムで表示される')
    : fail('COOL / HOT パネルが 2カラムで表示される');

  // モードボタン
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map(b => b.textContent?.trim())
  );
  const hasCPU     = buttons.includes('CPU');
  const hasTCP     = buttons.includes('TCP接続');
  const hasManual  = buttons.includes('手動操作');
  hasCPU && hasTCP && hasManual
    ? pass('モードボタン CPU / TCP接続 / 手動操作 が全て存在する')
    : fail('モードボタン CPU / TCP接続 / 手動操作 が全て存在する',
           `[${buttons.filter(Boolean).join(', ')}]`);

  // プログラム選択 UI (アップロードはプログラム管理ダイアログに一本化されている)
  text.includes('プログラム未選択')
    ? pass('プログラム選択 UI が表示される')
    : fail('プログラム選択 UI が表示される');

  // 中央のマッププレビュー列 (表示専用。差し替えはフッターの「マップ設定...」から)
  const hasPreviewCanvas = await page.evaluate(() => document.querySelectorAll('canvas').length > 0);
  hasPreviewCanvas && text.includes('マップ') && text.includes('ターン')
    ? pass('マッププレビュー列がセットアップ画面の中央に表示される')
    : fail('マッププレビュー列がセットアップ画面の中央に表示される', `canvas=${hasPreviewCanvas}`);

  // 対戦ルール・進行は設定ダイアログへ移したので、セットアップ画面には無いのが正
  !text.includes('2ゲーム制') && !text.includes('TCPタイムアウト')
    ? pass('対戦ルール/進行の操作はセットアップ画面に残っていない')
    : fail('対戦ルール/進行の操作はセットアップ画面に残っていない');

  // スタートボタンが初期は無効
  const startDisabled = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => b.textContent?.includes('ゲームスタート'));
    return btn?.disabled ?? true;
  });
  startDisabled
    ? pass('ゲームスタートボタンは初期状態で無効')
    : fail('ゲームスタートボタンは初期状態で無効');

  // IP 表示
  /\d+\.\d+\.\d+\.\d+|\.\.\./.test(text)
    ? pass('ローカル IP が表示される')
    : fail('ローカル IP が表示される');

  await ss(page, '01_setup_ui');
}

/** テスト 2: 設定ダイアログ */
async function testSettingsDialog(page) {
  section('設定ダイアログ');

  await clickText(page, '設定');
  await wait(600);

  const text = await bodyText(page);
  text.includes('観戦画面のタイトル')
    ? pass('設定ダイアログが開く')
    : fail('設定ダイアログが開く');

  text.includes('表示') && text.includes('対戦') && text.includes('BGM')
    ? pass('タブ (表示 / 対戦 / BGM) が存在する')
    : fail('タブ (表示 / 対戦 / BGM) が存在する');

  text.includes('テクスチャテーマ') && text.includes('ダークモード')
    ? pass('表示設定項目 (テーマ・ダークモード) が表示される')
    : fail('表示設定項目 (テーマ・ダークモード) が表示される');

  await ss(page, '02_settings_dialog');

  // 対戦ルール・進行パラメータはここに統合されている
  await clickText(page, '対戦');
  await wait(400);
  const matchText = await bodyText(page);
  matchText.includes('2ゲーム制') && matchText.includes('リピート') && matchText.includes('デモ')
    ? pass('「対戦」タブに対戦ルールのチップが揃う')
    : fail('「対戦」タブに対戦ルールのチップが揃う');

  matchText.includes('ターン表示') && matchText.includes('TCPタイムアウト')
    ? pass('「対戦」タブに進行パラメータが表示される')
    : fail('「対戦」タブに進行パラメータが表示される');

  // setup フェーズなのでルールは編集できる
  const chips = await readMatchRuleChips(page);
  Object.values(chips).length === 3 && Object.values(chips).every(c => !c.disabled)
    ? pass('セットアップ中は対戦ルールのチップが有効')
    : fail('セットアップ中は対戦ルールのチップが有効', JSON.stringify(chips));

  await ss(page, '02b_settings_match_tab');
  await closeSettingDialog(page);
}

/** テスト 3: CPU vs CPU 通常1ゲーム */
async function testCpuVsCpu(page) {
  section('CPU vs CPU 通常対戦');

  // 両スロットを CPU に
  await clickText(page, 'CPU');
  await wait(400);
  await clickSecondCPU(page);
  await wait(1000);

  const readyCount = await page.evaluate(() =>
    document.body.innerText.split('準備完了').length - 1
  );
  readyCount >= 2
    ? pass('両スロットが「準備完了」になる')
    : fail('両スロットが「準備完了」になる', `準備完了: ${readyCount} 個`);

  await ss(page, '03_both_cpu_ready');

  // スタート
  await clickText(page, 'ゲームスタート');
  const started = await waitForGameStart(page);
  started
    ? pass('ゲームが開始しボードが表示される')
    : fail('ゲームが開始しボードが表示される', 'タイムアウト');

  await ss(page, '04_game_playing');

  // 終了待ち
  const ended = await waitForGameEnd(page);
  ended
    ? pass('ゲームが正常に終了する')
    : fail('ゲームが正常に終了する', 'タイムアウト');

  const resultText = await bodyText(page);
  resultText.includes('の勝ち') || resultText.includes('引き分け')
    ? pass('勝敗結果 (WIN / DRAW) が表示される')
    : fail('勝敗結果 (WIN / DRAW) が表示される');

  // 1ゲーム制のサイドパネルは自チームだけを表示し、内訳 (一撃/総取り) と合計ポイントに絞る。
  // 勝ち点・アイテム数はここには出ない (勝敗はフッター、アイテム数は上部スコアバーが担当)
  resultText.includes('合計ポイント') && resultText.includes('一撃') && resultText.includes('総取り')
    ? pass('1ゲーム制のスコアパネル (一撃/総取り/合計ポイント) が表示される')
    : fail('1ゲーム制のスコアパネル (一撃/総取り/合計ポイント) が表示される');

  await ss(page, '05_game_result');

  // リセット
  await clickText(page, 'セットアップに戻る');
  const backToSetup = await waitFor(page, 'ゲームスタート', 6000);
  backToSetup
    ? pass('セットアップ画面に戻れる')
    : fail('セットアップ画面に戻れる', 'タイムアウト');

  await wait(500);
}

/** テスト 4: 2ゲーム制モード */
async function testDoubleMatch(page) {
  section('2ゲーム制モード');

  // 設定ダイアログ「対戦」タブで 2ゲーム制 を ON (即時反映・保存ボタン不要)
  const toggled = await setMatchRuleChip(page, '2ゲーム制', true);
  toggled === 'OK'
    ? pass('"2ゲーム制" チップを ON にできる')
    : fail('"2ゲーム制" チップを ON にできる', toggled);

  await wait(600);

  // ゲームバッジ確認
  const setupText = await bodyText(page);
  setupText.includes('第1ゲーム')
    ? pass('"第1ゲーム" バッジがセットアップ画面に表示される')
    : fail('"第1ゲーム" バッジがセットアップ画面に表示される');

  await ss(page, '06_double_setup_round1');

  // 両スロット CPU → ゲームスタート
  await clickText(page, 'CPU');
  await wait(400);
  await clickSecondCPU(page);
  await wait(800);
  await clickText(page, 'ゲームスタート');

  // ゲーム 1 終了 → 「第2ゲームへ」
  const round1Done = await waitFor(page, '第2ゲームへ', 30000);
  round1Done
    ? pass('ゲーム1終了後に「第2ゲームへ」ボタンが表示される')
    : fail('ゲーム1終了後に「第2ゲームへ」ボタンが表示される', 'タイムアウト');

  // 新UIでは総合の合計ボックスと 第2ゲームへボタンが表示される
  const r1Text = await bodyText(page);
  r1Text.includes('第2ゲームへ') && r1Text.includes('総合')
    ? pass('ゲーム1のポイントが ScorePanel に表示される')
    : fail('ゲーム1のポイントが ScorePanel に表示される');

  // 2ゲーム制のサイドパネルは1ゲームぶんの得点明細 (アイテム/一撃/総取り → 小計) を出す
  ['アイテム', '一撃', '総取り', '小計'].every(t => r1Text.includes(t))
    ? pass('2ゲーム制パネルに得点明細 (アイテム/一撃/総取り/小計) が並ぶ')
    : fail('2ゲーム制パネルに得点明細 (アイテム/一撃/総取り/小計) が並ぶ', r1Text.slice(0, 200));

  // 第2ゲームは「未対戦」として枠だけ確保しておく (状態が進んでも高さがずれないようにするため)
  r1Text.includes('未対戦')
    ? pass('未対戦の第2ゲームが「未対戦」として表示される')
    : fail('未対戦の第2ゲームが「未対戦」として表示される');

  await ss(page, '07_round1_result');

  // 第2ゲームへ → セットアップ画面に戻る → 第2ゲーム開始
  await clickText(page, '第2ゲームへ');
  const round2Setup = await waitFor(page, 'ゲームスタート', 8000);
  round2Setup
    ? pass('第2ゲームへ後にセットアップ画面 (第2ゲーム) に遷移する')
    : fail('第2ゲームへ後にセットアップ画面 (第2ゲーム) に遷移する', 'タイムアウト');

  // 第2ゲームバッジ
  const r2SetupText = await bodyText(page);
  r2SetupText.includes('第2ゲーム')
    ? pass('"第2ゲーム" バッジが表示される')
    : fail('"第2ゲーム" バッジが表示される');

  // 試合の途中はマップ・ルールを変更させない (押せるのに無反応、を防ぐ)。
  // マップは入口ボタン自体を消し、対戦ルールは「対戦」タブのチップを disabled にする。
  const hasMapBtn = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(b => b.textContent?.trim() === 'マップ設定...')
  );
  !hasMapBtn
    ? pass('第2ゲーム待機中はフッターの「マップ設定...」が出ない')
    : fail('第2ゲーム待機中はフッターの「マップ設定...」が出ない');

  await openMatchTab(page);
  const midMatchChips = await readMatchRuleChips(page);
  Object.values(midMatchChips).length === 3 && Object.values(midMatchChips).every(c => c.disabled)
    ? pass('第2ゲーム待機中は対戦ルールのチップが無効になる')
    : fail('第2ゲーム待機中は対戦ルールのチップが無効になる', JSON.stringify(midMatchChips));
  await closeSettingDialog(page);

  await ss(page, '08_double_setup_round2');

  // 第2ゲームスタート (CPU スロットは既に準備完了)
  await clickText(page, 'ゲームスタート');
  const round2Done = await waitForGameEnd(page, 30000);
  round2Done
    ? pass('ゲーム2が正常に終了する')
    : fail('ゲーム2が正常に終了する', 'タイムアウト');

  // 合計ポイント / 最終勝者
  // 新UIでは総合の合計ボックスに pt サフィックス付きで両スコアが表示される
  const finalText = await bodyText(page);
  finalText.includes('総合') && finalText.includes('pt')
    ? pass('最終結果 (合計ポイント) が表示される')
    : fail('最終結果 (合計ポイント) が表示される', `text: ${finalText.slice(0,200)}`);

  // セット全体の勝者 (勝利数 → 同数なら合計ポイント) は、勝者側パネルの総合欄の 🏆 で示す。
  // フッターは第2ゲーム終了時もそのゲームの勝敗を表示する。
  finalText.includes('🏆 総合')
    ? pass('セット全体の勝者側パネルの総合に 🏆 が付く')
    : fail('セット全体の勝者側パネルの総合に 🏆 が付く', `text: ${finalText.slice(0,200)}`);

  // 勝者判定の第1基準である勝利数を総合欄に出す (例: 2勝0敗)。
  // 左右のパネルの勝敗数を足すと、引き分けが無ければ 2ゲームぶんになる
  const winsTexts = [...finalText.matchAll(/(\d+)勝(\d+)敗/g)].map(m => [+m[1], +m[2]]);
  winsTexts.length === 2 && winsTexts.every(([w, l]) => w + l <= 2) &&
  winsTexts[0][0] === winsTexts[1][1] && winsTexts[0][1] === winsTexts[1][0]
    ? pass(`総合欄に勝敗数が表示され左右で整合する (${winsTexts.map(([w, l]) => `${w}勝${l}敗`).join(' / ')})`)
    : fail('総合欄に勝敗数が表示され左右で整合する', JSON.stringify(winsTexts));

  // 「第2ゲームへ」ではなく「セットアップに戻る」が表示される
  finalText.includes('セットアップに戻る') && !finalText.includes('第2ゲームへ')
    ? pass('2ゲーム終了後は「セットアップに戻る」のみが表示される')
    : fail('2ゲーム終了後は「セットアップに戻る」のみが表示される');

  await ss(page, '09_double_match_final');

  // リセットして 2ゲーム制 を OFF に戻す
  await clickText(page, 'セットアップに戻る');
  await wait(800);

  await setMatchRuleChip(page, '2ゲーム制', false);
  await wait(500);
}

/** テスト 5: 手動操作モード
 *  操作パネル (ManualControls) はコントロールウィンドウではなく、
 *  スロットを「手動操作」にすると自動で開く専用ウィンドウ (?mode=manual) にある。 */
async function testManualMode(app, page) {
  section('手動操作モード (ManualClient)');

  // COOL スロットを手動操作に
  const r = await clickText(page, '手動操作');
  r === 'OK'
    ? pass('"手動操作" モードボタンをクリックできる')
    : fail('"手動操作" モードボタンをクリックできる', r);

  await wait(500);

  // HOT を CPU に
  await clickSecondCPU(page);
  await wait(800);

  const setupText = await bodyText(page);
  setupText.includes('手動操作') && setupText.includes('準備完了')
    ? pass('手動操作スロットが「準備完了」になる')
    : fail('手動操作スロットが「準備完了」になる');

  await ss(page, '10_manual_ready');

  // 手動操作ウィンドウは manual:openWindow IPC 経由で自動的に開く
  let manualPage = null;
  const winDeadline = Date.now() + 10000;
  while (Date.now() < winDeadline) {
    manualPage = app.windows().find(w => w.url().includes('mode=manual'));
    if (manualPage) break;
    await wait(300);
  }
  manualPage
    ? pass('手動操作ウィンドウが自動的に開く')
    : fail('手動操作ウィンドウが自動的に開く', 'ウィンドウが見つからない');

  // ゲーム開始
  await clickText(page, 'ゲームスタート');
  const gameStarted = await waitForGameStart(page);
  gameStarted
    ? pass('手動対戦ゲームが開始される')
    : fail('手動対戦ゲームが開始される', 'タイムアウト');

  if (manualPage) {
    await manualPage.waitForSelector('button', { timeout: 10000 }).catch(() => {});
    const ctrlText = await bodyText(manualPage);

    ctrlText.includes('手動操作')
      ? pass('手動操作ウィンドウに ManualControls パネルが表示される')
      : fail('手動操作ウィンドウに ManualControls パネルが表示される');

    ctrlText.includes('↑') || ctrlText.includes('↓')
      ? pass('方向キーパッド (↑↓←→) が表示される')
      : fail('方向キーパッド (↑↓←→) が表示される');

    ctrlText.includes('WALK') || ctrlText.includes('アクション')
      ? pass('アクション選択 (WALK/LOOK 等) が表示される')
      : fail('アクション選択 (WALK/LOOK 等) が表示される');

    await ss(manualPage, '11_manual_controls');

    // LOOK / SEARCH の探索範囲演出。演出は 220〜900ms で消えるためクリック直後に撮る。
    // タイミング依存なので pass/fail の判定材料にはせず、目視確認用の成果物として残す
    // (盤面に出るのはメイン窓なので、スクショ対象は page 側)。
    for (const [label, name] of [['観察 (LOOK)', '11a_scan_look'], ['探索 (SEARCH)', '11b_scan_search']]) {
      const sent = await sendManualScan(manualPage, label);
      if (sent === 'OK') {
        // 演出は 220〜900ms で消えるので即座に撮る
        await ss(page, name);
        pass(`${label} の探索範囲を盤面に描画できる (${name}.png)`);
      } else {
        fail(`${label} の探索範囲を盤面に描画できる`, sent);
      }
      await wait(200);
    }

    // ダークモード中は探索範囲だけベールが打ち抜かれる。ダークモードは保存不要の
    // ライブ切替なので、対戦中に設定ダイアログから ON にしてそのまま撮る。
    await clickText(page, '設定');
    await wait(500);
    const darkOn = await setDarkModeCheckbox(page, true);
    await clickText(page, 'キャンセル');
    await wait(400);

    if (darkOn === 'OK') {
      // LOOK と SEARCH は対になる行動なので、ダークモードでも両方撮っておく
      for (const [label, name] of [['探索 (SEARCH)', '11c_scan_search_dark'], ['観察 (LOOK)', '11d_scan_look_dark']]) {
        const sent = await sendManualScan(manualPage, label);
        if (sent === 'OK') {
          await ss(page, name);
          pass(`ダークモード中でも${label}の範囲が見える (${name}.png)`);
        } else {
          fail(`ダークモード中でも${label}の範囲が見える`, sent);
        }
        await wait(200);
      }
      // 後続のテストに影響しないよう元に戻す
      await clickText(page, '設定');
      await wait(500);
      await setDarkModeCheckbox(page, false);
      await clickText(page, 'キャンセル');
      await wait(400);
    } else {
      fail('ダークモード中でも探索範囲が見える', `ダークモード切替に失敗: ${darkOn}`);
    }

    // 探索アクションでゲームが壊れていないこと (この後の通常ループが回れば OK)
    const afterScanText = await bodyText(page);
    !afterScanText.includes('エラー')
      ? pass('LOOK/SEARCH を実行してもゲームが継続する')
      : fail('LOOK/SEARCH を実行してもゲームが継続する', afterScanText.slice(0, 200));
  }

  // ゲーム終了まで ↑/↓ ボタンを送り続ける (タイムアウト 40 秒)
  // アクションループとゲーム終了チェックを一体化させることで
  // 「ループ終了後にゲームが止まる」問題を防ぐ
  let actionsSent = 0;
  let gameEnded   = false;
  const deadline  = Date.now() + 40000;

  while (Date.now() < deadline) {
    // 終了判定はコントロールウィンドウ、入力は手動操作ウィンドウに対して行う
    const txt = await bodyText(page);
    if (txt.includes('セットアップに戻る') || txt.includes('の勝ち') || txt.includes('引き分け')) {
      gameEnded = true;
      break;
    }
    if (manualPage) {
      const clicked = await manualPage.evaluate(() => {
        const btn = [...document.querySelectorAll('button')]
          .find(b => !b.disabled && (b.textContent === '↑' || b.textContent === '↓'));
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (clicked) actionsSent++;
    }
    await wait(150);
  }

  actionsSent > 0
    ? pass(`手動アクションを ${actionsSent} 回送信できた`)
    : fail('手動アクションを送信できた', '0 回');

  gameEnded
    ? pass('手動対戦が正常に終了する')
    : fail('手動対戦が正常に終了する', 'タイムアウト');

  await ss(page, '12_manual_game_end');

  await clickText(page, 'セットアップに戻る');
  await wait(800);

  const backOk = await waitFor(page, 'ゲームスタート', 5000);
  backOk
    ? pass('手動対戦後にセットアップ画面に戻れる')
    : fail('手動対戦後にセットアップ画面に戻れる');
}

/** テスト 6: プログラムライブラリ管理とカスタムライブラリの UI */
async function testFileDropZone(page) {
  section('プログラムアップロード UI (FileDropZone)');

  // アップロードはプログラム管理ダイアログに一本化されている
  await clickText(page, 'プログラム管理...');
  await wait(600);

  const dialogText = await bodyText(page);
  dialogText.includes('プログラムライブラリ管理')
    ? pass('プログラム管理ダイアログが開く')
    : fail('プログラム管理ダイアログが開く');

  dialogText.includes('新規プログラムをライブラリに追加') && dialogText.includes('クリックして選択')
    ? pass('FileDropZone にアップロード誘導テキストが表示される')
    : fail('FileDropZone にアップロード誘導テキストが表示される');

  dialogText.includes('.py') && dialogText.includes('.exe')
    ? pass('対応拡張子 (.py, .exe) が表示される')
    : fail('対応拡張子 (.py, .exe) が表示される');

  await ss(page, '13a_program_library');
  await clickText(page, '閉じる');
  await wait(500);

  const text = await bodyText(page);
  text.includes('カスタムライブラリ')
    ? pass('カスタムライブラリ折り畳みセクションが存在する')
    : fail('カスタムライブラリ折り畳みセクションが存在する');

  // ライブラリ折り畳みを開く
  await clickText(page, 'カスタムライブラリ ▼');
  await wait(400);
  const libText = await bodyText(page);
  libText.includes('pyCHaser')
    ? pass('展開後に "pyCHaser" プリインストール表示がある')
    : fail('展開後に "pyCHaser" プリインストール表示がある');

  await ss(page, '13_file_dropzone');
}

// ═══════════════════════════════════════════════════════════════════════════
// メイン
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const startAt = Date.now();
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  U15 Server Maizuru — E2E 全自動テスト          ║');
  console.log('╚══════════════════════════════════════════════════╝');

  let viteProc = null;
  let app      = null;

  try {
    // 1. Vite dev サーバー
    console.log('\n[1/3] Vite dev サーバー起動中...');
    viteProc = await startViteServer();
    console.log('      http://localhost:5173 — OK');

    // 2. Electron 起動
    console.log('[2/3] Electron アプリ起動中...');
    const env = { ...process.env, NODE_ENV: 'development' };
    delete env.ELECTRON_RUN_AS_NODE;

    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args:           [__dirname],
      env,
      timeout:        30000,
    });

    // Electron の stdout/stderr を読み捨てる。バックエンドを子プロセスとして起動する
    // 構成上そこそこの量を出力するため、パイプを誰も読まないとバッファが埋まって
    // メインプロセスが停止し、ウィンドウが生成されないままタイムアウトする。
    app.process().stdout?.on('data', () => {});
    app.process().stderr?.on('data', () => {});

    // 2ウィンドウ構成: 表示ウィンドウが先に作成されるため、固定時間待機だと
    // まだ登録されていないウィンドウ一覧を早取りしてそちらを拾ってしまうことがある。
    // コントロールウィンドウ (mode=control) が現れるまでポーリングして待つ。
    let page = null;
    const windowDeadline = Date.now() + 20000;
    while (Date.now() < windowDeadline) {
      page = app.windows().find(w => w.url().includes('mode=control'));
      if (page) break;
      await wait(300);
    }

    const windows = app.windows();
    console.log(`      Windows: ${windows.length} [${windows.map(w => w.url()).join(', ')}]`);

    page = page
        ?? windows.find(w => w.url().includes('5173'))
        ?? await app.firstWindow();

    await page.waitForSelector('button', { timeout: 15000 }).catch(() => {});
    await wait(1000);

    console.log('      Electron — OK');
    console.log(`\n[3/3] テスト実行中... (スクリーンショット: ${SHOT_DIR})`);
    console.log('─'.repeat(52));

    // テスト用前処理: ターン表示時間を 0ms に設定 (テストを高速化)
    // 保存先は useMatchConfig の 'u15_match_config' キー。App が接続後に一度だけ
    // この値をサーバーへ送るため、書き込んだ後にリロードする必要がある。
    await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('u15_match_config');
        const s = raw ? JSON.parse(raw) : {};
        s.turnDelay = 0;
        localStorage.setItem('u15_match_config', JSON.stringify(s));
      } catch { /* ignore */ }
    });
    await page.reload();
    await page.waitForSelector('button', { timeout: 10000 }).catch(() => {});
    await wait(800);
    console.log('  (ターン表示時間を 0ms に設定しました)');


// ── 大会運営 ─────────────────────────────────────────────────────────────────

const E2E_CUP_ID  = 'e2e-cup';
const E2E_CUP_DIR = path.join(PROJECT_ROOT, 'server/tournament', E2E_CUP_ID);

/** 全員 内蔵CPU の4人トーナメントを書き出す (Python 不要で最後まで回せる) */
function writeE2ECup() {
  fs.mkdirSync(E2E_CUP_DIR, { recursive: true });
  fs.writeFileSync(path.join(E2E_CUP_DIR, 'tournament.json'), JSON.stringify({
    formatVersion: 1,
    id: E2E_CUP_ID,
    name: 'E2E杯',
    format: 'single-elimination',
    rules: { doubleMode: false },
    participants: [
      { id: 'e1', name: 'E2E-A', seed: 1, program: { builtin: 'cpu' } },
      { id: 'e2', name: 'E2E-B', seed: 2, program: { builtin: 'cpu' } },
      { id: 'e3', name: 'E2E-C', seed: 3, program: { builtin: 'cpu' } },
      { id: 'e4', name: 'E2E-D', seed: 4, program: { builtin: 'cpu' } },
    ],
  }, null, 2));
}

/**
 * aria-label で入力欄を特定して値を入れる。
 * React の制御コンポーネントは value を直接代入しても onChange が走らないので、
 * ネイティブの setter を呼んでからイベントを明示的に投げる。
 */
async function setByLabel(page, label, value, tag = 'input') {
  return page.evaluate(({ label, value, tag }) => {
    const el = document.querySelector(`${tag}[aria-label="${label}"]`);
    if (!el) return 'NOT_FOUND: ' + label;
    const proto = tag === 'select'   ? HTMLSelectElement.prototype
                : tag === 'textarea' ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event(tag === 'select' ? 'change' : 'input', { bubbles: true }));
    return 'OK';
  }, { label, value, tag });
}

/** 要素が現れるまで待つ */
async function waitForLabel(page, label, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const found = await page.evaluate(
      l => document.querySelector(`[aria-label="${l}"]`) !== null, label);
    if (found) return 'OK';
    await wait(200);
  }
  return 'TIMEOUT';
}

/** 非同期に描画される要素を待ってからクリックする */
async function clickWhenReady(page, text, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await clickText(page, text) === 'OK') return 'OK';
    await wait(300);
  }
  return 'TIMEOUT';
}

/**
 * 運営窓の「いま操作する試合」を準備済みにする。
 * 既に準備済み (armed) ならそのまま通す — 呼び出し側が arm 済みかを知らなくてよいようにする。
 */
async function armNextMatch(tw, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if ((await bodyText(tw)).includes('フッターの「ゲームスタート」')) return 'ARMED';
    if (await clickText(tw, 'この試合を準備') === 'OK') {
      await wait(2500);
      continue; // 準備済みの表示に変わったかを次の周回で確かめる
    }
    await wait(300);
  }
  return 'TIMEOUT';
}

/**
 * 1試合を最後まで進めて確定する (準備 → ゲームスタート → 確定)。
 *
 * CPU 同士は同点で終わることがある。同点の試合はトーナメントでは「確定」できないので、
 * ダイアログの②審判裁定で勝者を決めて先へ進める (再試合を選ぶと終わらない可能性がある)。
 */
async function playAndConfirmMatch(page, tw, label) {
  if (await armNextMatch(tw) !== 'ARMED') return `準備できない (${label})`;

  await clickText(page, 'ゲームスタート');
  if (!await waitForGameStart(page)) return `開始しない (${label})`;
  if (!await waitForGameEnd(page))   return `終了しない (${label})`;

  if (!await waitFor(tw, 'の結果', 15000)) return `確定ダイアログが出ない (${label})`;

  if ((await bodyText(tw)).includes('同点です')) {
    await clickText(tw, 'の勝ち');          // 審判裁定の勝者チップ
    await wait(300);
    await clickText(tw, 'この裁定で確定');
  } else {
    await clickText(tw, 'この結果で確定');
  }
  await wait(1800);
  return 'OK';
}

const UI_CUP_ID  = 'e2e-ui-cup';
const UI_CUP_DIR = path.join(PROJECT_ROOT, 'server/tournament', UI_CUP_ID);

/** 大会運営ウィンドウを開いて取得する (既に開いていれば focus されるだけ) */
async function openTournamentWindow(app, page) {
  await clickWhenReady(page, '大会運営');
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const tw = app.windows().find(w => w.url().includes('mode=tournament'));
    if (tw) {
      await tw.waitForSelector('button', { timeout: 15000 }).catch(() => {});
      return tw;
    }
    await wait(300);
  }
  return null;
}

/** 大会データを画面のフォームだけで作り、そのまま運営できるところまで確認する */
async function testTournamentEditor(app, page) {
  section('大会データの作成 (画面から)');

  fs.rmSync(UI_CUP_DIR, { recursive: true, force: true });

  const tw = await openTournamentWindow(app, page);
  if (!tw) { fail('大会運営ウィンドウが開く (作成)'); return null; }
  await wait(1200);

  await clickWhenReady(tw, '新規作成');
  await waitForLabel(tw, '大会名') === 'OK'
    ? pass('大会データ作成ダイアログが開く')
    : fail('大会データ作成ダイアログが開く');

  await setByLabel(tw, '大会名', 'UI作成杯');
  await setByLabel(tw, '大会ID', UI_CUP_ID);

  // 参加者をまとめて4人追加
  await clickWhenReady(tw, 'まとめて追加');
  await setByLabel(tw, '参加者をまとめて追加', 'UI-A\nUI-B\nUI-C\nUI-D', 'textarea');
  await clickWhenReady(tw, 'この内容で追加');
  await wait(400);

  const rows = await tw.evaluate(() =>
    document.querySelectorAll('[data-testid="participant-row"]').length);
  rows === 4 ? pass('参加者をまとめて追加できる') : fail('参加者をまとめて追加できる', `rows=${rows}`);

  // Python 不要で回せるよう全員 内蔵CPU にする
  for (let i = 1; i <= 4; i++) await setByLabel(tw, `参加者${i} のプログラム`, 'cpu', 'select');

  const preview = await tw.evaluate(() =>
    document.querySelector('[data-testid="editor-preview"]')?.textContent ?? '');
  preview.includes('全 3 試合')
    ? pass('生成される試合数がプレビューされる')
    : fail('生成される試合数がプレビューされる', preview);

  await ss(tw, 'tournament-editor');

  await clickWhenReady(tw, 'この内容で作成');
  await wait(2500);

  // tournament.json が書き出されている (手書き・zip 取り込みと同じ成果物)
  const defFile = path.join(UI_CUP_DIR, 'tournament.json');
  if (fs.existsSync(defFile)) {
    const def = JSON.parse(fs.readFileSync(defFile, 'utf-8'));
    def.name === 'UI作成杯'
      && def.participants.length === 4
      && def.participants.every(p => p.program?.builtin === 'cpu')
      && def.participants.map(p => p.seed).join(',') === '1,2,3,4'
      ? pass('tournament.json が書き出される')
      : fail('tournament.json が書き出される', JSON.stringify(def).slice(0, 200));
  } else {
    fail('tournament.json が書き出される', '生成されていない');
  }

  (await bodyText(tw)).includes('UI作成杯')
    ? pass('作った大会が一覧に出る')
    : fail('作った大会が一覧に出る');

  // 作ったデータでそのまま運営を始められる
  await clickWhenReady(tw, 'この大会を運営');
  await wait(2000);
  const paths = await tw.evaluate(() => document.querySelectorAll('svg path').length);
  paths >= 2 ? pass('作った大会のトーナメント表が描画される')
             : fail('作った大会のトーナメント表が描画される', `paths=${paths}`);

  await clickWhenReady(tw, 'この試合を準備');
  await wait(2500);
  (await bodyText(page)).match(/準備完了/g)?.length >= 2
    ? pass('作った大会で試合を準備できる')
    : fail('作った大会で試合を準備できる');
  await ss(tw, 'tournament-editor-armed');

  // 運営中は編集・削除ができないこと (誤操作の防止)
  const guarded = await tw.evaluate(() =>
    [...document.querySelectorAll('button')].filter(b => b.textContent === '編集')
      .every(b => b.disabled));
  guarded ? pass('運営中の大会は編集ボタンが無効になる')
          : fail('運営中の大会は編集ボタンが無効になる');

  await clickWhenReady(tw, '運営を終了', 5000);
  await wait(1000);
  // ウィンドウを閉じてから片付ける。開いたままだと後続の節が
  // 「開いた時点の一覧」を検証できなくなる (一覧はウィンドウを開いたときに取りに行くため)
  await tw.close().catch(() => {});
  await wait(500);
  fs.rmSync(UI_CUP_DIR, { recursive: true, force: true });
}

async function testTournament(app, page) {
  section('大会運営 (トーナメント)');

  writeE2ECup();

  // Electron では「大会運営...」は専用ウィンドウを開く
  await clickWhenReady(page, '大会運営');

  let tw = null;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    tw = app.windows().find(w => w.url().includes('mode=tournament'));
    if (tw) break;
    await wait(300);
  }

  if (!tw) {
    fail('大会運営ウィンドウが開く');
    return;
  }
  pass('大会運営ウィンドウが開く');
  await tw.waitForSelector('button', { timeout: 15000 }).catch(() => {});
  await wait(1200);

  // 一覧に E2E杯 が出ているか (フォルダ配置 → 自動検出)
  (await bodyText(tw)).includes('E2E杯')
    ? pass('server/tournament/ に置いた大会が一覧に出る')
    : fail('server/tournament/ に置いた大会が一覧に出る');

  // 運営開始 → ブラケットが描画される
  await clickWhenReady(tw, 'この大会を運営');
  await wait(2000);
  await ss(tw, 'tournament-bracket');

  const bracket = await tw.evaluate(() => ({
    paths: document.querySelectorAll('svg path').length,
    cards: [...document.querySelectorAll('div')]
      .filter(d => d.style.position === 'absolute' && d.style.left && d.style.top).length,
  }));
  bracket.paths >= 2 && bracket.cards >= 3
    ? pass(`トーナメント表が描画される (線${bracket.paths} カード${bracket.cards})`)
    : fail('トーナメント表が描画される', JSON.stringify(bracket));

  const twText = await bodyText(tw);
  twText.includes('準決勝') && twText.includes('決勝')
    ? pass('回戦の見出しが出る')
    : fail('回戦の見出しが出る');

  // 運営を始めた直後の観戦画面: 対戦カードはまだ無く、表だけを見せる
  const dw = app.windows().find(w => w.url().includes('mode=display'));
  if (dw) {
    await waitFor(dw, 'まもなく開始します', 10000);
    const standby = await dw.evaluate(() => ({
      text:  document.body.innerText ?? '',
      paths: document.querySelectorAll('svg path').length,
    }));
    standby.text.includes('まもなく開始します')
      && !standby.text.includes('対戦開始をお待ちください')
      && standby.paths >= 2
      ? pass('「この大会を運営」で観戦画面にトーナメント表が出る')
      : fail('「この大会を運営」で観戦画面にトーナメント表が出る', JSON.stringify(standby).slice(0, 160));
    await ss(dw, 'tournament-standby');
  }

  // 試合を準備 → コントロール画面のスロットへ自動割り当てされる
  await clickWhenReady(tw, 'この試合を準備');
  await wait(2500);

  const ctrl = await bodyText(page);
  (ctrl.match(/準備完了/g) ?? []).length >= 2
    ? pass('両スロットにプログラムが自動割り当てされる')
    : fail('両スロットにプログラムが自動割り当てされる');
  await ss(page, 'tournament-armed');

  // 準備すると、これまでどおりの試合準備画面 (対戦カード + マップ + 表) に切り替わる
  if (dw) {
    await waitFor(dw, '対戦開始をお待ちください', 10000);
    const armedView = await dw.evaluate(() => ({
      text:  document.body.innerText ?? '',
      paths: document.querySelectorAll('svg path').length,
    }));
    armedView.text.includes('対戦開始をお待ちください') && armedView.text.includes('次の試合')
      ? pass('「この試合を準備」で観戦画面が試合準備画面になる')
      : fail('「この試合を準備」で観戦画面が試合準備画面になる', armedView.text.slice(0, 160));
    armedView.paths >= 2
      ? pass('試合準備画面にもトーナメント表が出る')
      : fail('試合準備画面にもトーナメント表が出る', `paths=${armedView.paths}`);
    await ss(dw, 'tournament-display');
  }

  // 1試合目: 確定すると観戦画面が表に戻り、終わった試合が強調される
  let played = await playAndConfirmMatch(page, tw, '準決勝1');
  played === 'OK'
    ? pass('1試合目を確定できる')
    : fail('1試合目を確定できる', played);

  if (dw && played === 'OK') {
    await waitFor(dw, '試合終了', 10000);
    const afterConfirm = await dw.evaluate(() => ({
      text:  document.body.innerText ?? '',
      paths: document.querySelectorAll('svg path').length,
      // 見出しの結果ピルと、表の中の該当カードのバッジの2か所だけに出る
      marked: [...document.querySelectorAll('span')]
        .filter(el => el.textContent === '✓ 試合終了').length,
    }));
    afterConfirm.text.includes('試合終了') && afterConfirm.paths >= 2
      ? pass('「この結果で確定」で観戦画面がトーナメント表に戻る')
      : fail('「この結果で確定」で観戦画面がトーナメント表に戻る', afterConfirm.text.slice(0, 160));
    afterConfirm.marked === 2
      ? pass('確定した試合が表の中で強調される')
      : fail('確定した試合が表の中で強調される', `「✓ 試合終了」=${afterConfirm.marked}`);
    await ss(dw, 'tournament-standby-confirmed');
  }

  // 残り (準決勝2 + 決勝)。最後の「確定」で観戦画面が表彰画面に切り替わる
  for (const label of ['準決勝2', '決勝']) {
    if (played !== 'OK') break;
    played = await playAndConfirmMatch(page, tw, label);
  }
  played === 'OK'
    ? pass('3試合を最後まで進めて確定できる')
    : fail('3試合を最後まで進めて確定できる', played);

  (await bodyText(tw)).includes('全ての試合が終了しました')
    ? pass('運営席が大会の終了を示す')
    : fail('運営席が大会の終了を示す');

  // 観戦用画面: 確定した瞬間に、試合結果ではなく表彰画面が出る
  if (dw && played === 'OK') {
    await waitFor(dw, '全試合終了', 10000);
    const finale = await dw.evaluate(() => ({
      text:  document.body.innerText ?? '',
      paths: document.querySelectorAll('svg path').length,
    }));
    finale.text.includes('全試合終了') && finale.text.includes('優勝')
      ? pass('最後の確定で観戦画面が表彰画面に切り替わる')
      : fail('最後の確定で観戦画面が表彰画面に切り替わる', finale.text.slice(0, 120));
    finale.paths >= 2
      ? pass('表彰画面にトーナメント表が残る')
      : fail('表彰画面にトーナメント表が残る', `paths=${finale.paths}`);
    await ss(dw, 'tournament-finale');
  }

  // エクスポート
  const exported = await tw.evaluate(async (id) => {
    // 描画側からの fetch は Chromium の名前解決を通るので、ホスト名ではなく IP を直接使う
    const res = await fetch(`http://127.0.0.1:8765/api/tournament/${id}/export?format=matches.csv`);
    const txt = await res.text();
    return { status: res.status, head: txt.split(String.fromCharCode(13, 10))[0] ?? '' };
  }, E2E_CUP_ID);
  exported.status === 200 && exported.head.includes('試合ID')
    ? pass('試合結果 CSV をエクスポートできる')
    : fail('試合結果 CSV をエクスポートできる', JSON.stringify(exported));

  // 後始末: 運営を終了してから大会フォルダを消す
  await clickWhenReady(tw, '運営を終了', 5000);
  await wait(800);
  await tw.close().catch(() => {});
  fs.rmSync(E2E_CUP_DIR, { recursive: true, force: true });
}


    // テストスイート実行
    await testSetupUI(page);
    await testSettingsDialog(page);
    await testFileDropZone(page);
    await testCpuVsCpu(page);
    await testDoubleMatch(page);
    await testManualMode(app, page);
    await testTournamentEditor(app, page);
    await testTournament(app, page);

  } catch (err) {
    console.error('\n  FATAL:', err.message);
    fail('テスト実行全体', err.message);
  } finally {
    if (app) {
      // close() が正常に効かなかった場合の保険。バックエンドは Electron の子なので
      // 木ごと落とせば 8765 を握った残骸が出ない (既に終了していれば無害)
      const electronPid = app.process()?.pid;
      await app.close().catch(() => {});
      killTree(electronPid);
    }
    // pnpm/cmd を挟んでいるので Vite の実体は孫プロセス。木ごと落とさないと
    // 5173 を握ったまま残り、次回の実行が**前回のサーバー**につながって大量に失敗する
    if (viteProc) killTree(viteProc.pid);
  }

  // ── 結果サマリー ────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startAt) / 1000).toFixed(1);
  const total   = passCount + failCount;

  console.log('\n' + '═'.repeat(52));
  console.log(`  テスト完了  ${elapsed}s`);
  console.log(`  合格: ${passCount} / ${total}  失敗: ${failCount}`);

  if (failCount > 0) {
    console.log('\n  ✗ 失敗したテスト:');
    results.filter(r => r.status === 'FAIL').forEach(r =>
      console.log(`    - ${r.name}${r.reason ? '\n      → ' + r.reason : ''}`)
    );
  } else {
    console.log('\n  全テスト合格 ✓');
  }

  console.log(`\n  スクリーンショット: ${SHOT_DIR}`);
  console.log('═'.repeat(52));

  process.exit(failCount > 0 ? 1 : 0);
}

main();
