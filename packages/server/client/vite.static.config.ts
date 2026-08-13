import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const pagesIndexEntry = (): Plugin => ({
  name: 'pages-index-entry',
  generateBundle: {
    order: 'post',
    handler(_options, bundle) {
      const sourceName = 'static-demo.html';
      const page = bundle[sourceName];
      if (!page || page.type !== 'asset') {
        this.error(`Expected Vite to emit ${sourceName}.`);
      }

      page.fileName = 'index.html';
    },
  },
});

export default defineConfig({
  plugins: [react(), pagesIndexEntry()],
  root: '.',
  base: './',
  build: {
    outDir: '../dist/static-demo',
    rollupOptions: { input: resolve(import.meta.dirname, 'static-demo.html') },
  },
});
