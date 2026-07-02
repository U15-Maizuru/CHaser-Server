import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './', // Electron の file:// 読み込み (本番パッケージ) でルート相対パスが解決できないため
  plugins: [react()],
  server: {
    port: 5173,
    host: true,   // 0.0.0.0 にバインド → LAN 上の別 PC からアクセス可能
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
