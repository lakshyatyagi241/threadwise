import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    // every spec file clones its own database from one migrated template; keep them serial on a laptop
    fileParallelism: false,
    testTimeout: 1_800_000,
    hookTimeout: 900_000,
  },
});
