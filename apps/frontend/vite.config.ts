import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,   // 0.0.0.0 にバインド → LAN 上の別 PC からアクセス可能
  },
});
