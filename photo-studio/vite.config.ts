import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
