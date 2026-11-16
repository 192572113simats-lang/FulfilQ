import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@fulfilliq/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['apps/api/src/tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
