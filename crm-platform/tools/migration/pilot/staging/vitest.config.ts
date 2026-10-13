import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests of the staging tooling. They need the scratch database (`node pilot/scratch-db.cjs up`); they clone throwaway databases from it.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
