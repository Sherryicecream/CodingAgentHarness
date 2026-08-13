import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  build: {
    outDir: '../dist/static-demo',
    rollupOptions: { input: resolve(import.meta.dirname, 'static-demo.html') },
  },
});
