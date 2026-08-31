import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4652, // deliberately not 5173 — every Vite app on the machine fights over that one

    proxy: {
      '/api': 'http://localhost:4650',
      '/ws': { target: 'ws://localhost:4650', ws: true },
    },
  },
  build: { outDir: 'dist' },
});
