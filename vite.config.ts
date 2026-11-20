import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // 開発中（npm run dev）も、別ウィンドウで npm run bridge を動かせば PCのClaude を使える
  server: { proxy: { '/api': 'http://127.0.0.1:5175' } },
});
