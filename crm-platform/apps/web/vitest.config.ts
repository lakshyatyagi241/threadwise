import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Component tests render to a string (react-dom/server), so they are plain node tests with JSX.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // Coverage of the web app's logic: every feature's `lib/` (models, formatters, validators) and the shared `src/lib`. Components
    // render to a string in these tests, so they are exercised but not gated. `pnpm --filter @crm/web test:coverage`.
    coverage: {
      provider: 'v8',
      // A failing test must not hide the coverage report.
      reportOnFailure: true,
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: ['src/**/lib/**/*.ts', 'src/lib/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/*.generated.ts', 'src/features/_registry/**'],
    },
  },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
});
