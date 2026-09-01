import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each test file gets an isolated in-memory / temp DB, so run them
    // in a single thread pool to keep sqlite file handles predictable.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 15000,
    globals: false,
  },
});
