import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Component tests render to a string (react-dom/server), so they are plain node tests with JSX.
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
});
