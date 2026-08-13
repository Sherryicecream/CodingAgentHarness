import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: '../dist/client',
    rollupOptions: process.env.HARNESS_STATIC_DEMO === '1' ? {
      input: resolve(import.meta.dirname, 'static-demo.html'),
    } : undefined,
  },
});
