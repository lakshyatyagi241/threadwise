import { defineConfig } from 'vitest/config';

/** The tests that need no database (no Docker): `node node_modules/vitest/vitest.mjs run --config vitest.pure.config.ts` */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.pure.spec.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
