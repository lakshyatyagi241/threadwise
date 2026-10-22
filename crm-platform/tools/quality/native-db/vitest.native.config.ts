// Copy next to apps/api/vitest.config.ts and run: pnpm exec vitest run --config vitest.native.config.ts test/integration
// The repo's config, with Testcontainers replaced by the native Postgres and Redis in this folder, and files run in parallel
// (every file owns its own cluster, so they cannot collide).
import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const SHIM = process.env.NATIVE_DB_SHIM ?? resolve(__dirname, '../../../tools/quality/native-db');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts', '**/*.test.ts'],
    fileParallelism: true,
    maxWorkers: Number(process.env.NATIVE_WORKERS || 3),
    minWorkers: 1,
    testTimeout: 120000,
    hookTimeout: 180000,
  },
  resolve: {
    alias: [
      { find: '@testcontainers/postgresql', replacement: `${SHIM}/pgcontainer.mjs` },
      { find: /^testcontainers$/, replacement: `${SHIM}/testcontainers.mjs` },
      { find: '@', replacement: resolve(__dirname, 'src') },
    ],
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        keepClassNames: true,
      },
    }),
  ],
});
