import { defineConfig, devices } from '@playwright/test';

/**
 * Browser e2e for the web app. It drives the already running stack (API :3000, web :3001; see
 * the repo's setup skill), so it starts no server of its own and never touches production data:
 * the specs sign in as seeded local accounts.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  // The specs share one seeded operator and the API caps concurrent sessions per account, so a
  // sign-out or a new login in one test would end another test's session. Serial until each spec
  // gets its own account.
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    // A visible browser by default so a run can be watched; set HEADLESS=1 for CI or a quiet run.
    headless: process.env.HEADLESS === '1',
    baseURL: process.env.WEB_URL ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
