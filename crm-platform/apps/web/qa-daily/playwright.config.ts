import { defineConfig, devices } from '@playwright/test';

/** Daily exploration run. Needs the stack up (API :3000, web :3001), like e2e/. HEADLESS=1 for cron. */
export default defineConfig({
  testDir: '.',
  testMatch: /explore\.spec\.ts$/,
  outputDir: './out/.pw',
  workers: 1, // the API caps concurrent sessions per account
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  use: {
    headless: process.env.HEADLESS === '1',
    baseURL: process.env.WEB_URL ?? 'http://localhost:3001',
    ...devices['Desktop Chrome'],
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
});
