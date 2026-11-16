import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // The suites share one PostgreSQL and Redis, including the rate-limit counters.
    fileParallelism: false,
  },
});
