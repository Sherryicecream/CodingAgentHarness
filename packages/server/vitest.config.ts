import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@harness/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    environmentOptions: {
      jsdom: {
        url: 'http://public.example/',
      },
    },
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
