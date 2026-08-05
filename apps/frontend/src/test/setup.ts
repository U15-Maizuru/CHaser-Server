import '@testing-library/jest-dom/vitest';

// jsdom には ResizeObserver が無い。FitArea (useFitScale) を含む画面はマウントした
// 時点で参照するので、何もしないスタブを置いておく。jsdom はレイアウトを持たず
// 実寸が常に 0 なので、どのみち倍率の検証はここではできない (見た目は E2E のスクショで見る)。
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
