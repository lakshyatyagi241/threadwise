import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-browser (QA task 19). By default one project, Chromium, exactly as before. Set CROSS_BROWSER=1 to add Firefox, WebKit (Safari's
 * engine) and a phone-sized WebKit, and E2E_PRIORITY=p0 or p0,p1 to run only the folders classed that way in `e2e/priority.json`.
 *
 *   CROSS_BROWSER=1 E2E_PRIORITY=p0,p1 HEADLESS=1 pnpm --filter @crm/web exec playwright test
 *   CROSS_BROWSER=1 HEADLESS=1 pnpm --filter @crm/web exec playwright test --project=webkit e2e/_matrix
 *
 * Engines: `pnpm --filter @crm/web exec playwright install --with-deps firefox webkit`. On a machine whose cached Chromium is older than
 * this Playwright expects and cannot be downloaded, point CHROMIUM_PATH at an installed Chromium.
 */
const priorities = (
  JSON.parse(readFileSync(join(__dirname, 'e2e/priority.json'), 'utf8')) as {
    folders: Record<string, string>;
  }
).folders;
const wanted = (process.env.E2E_PRIORITY ?? '')
  .split(',')
  .map((p) => p.trim().toUpperCase())
  .filter(Boolean);
/** Spec folders of the chosen priorities, or undefined (everything) when no priority is asked for. */
const priorityMatch = wanted.length
  ? Object.entries(priorities)
      .filter(([, p]) => wanted.includes(p))
      .map(([folder]) => new RegExp(`/e2e/${folder}/.*\\.spec\\.ts$`))
  : undefined;
const cross = process.env.CROSS_BROWSER === '1';

/**
 * Browser e2e for the web app. It drives the already running stack (API :3000, web :3001; see
 * the repo's setup skill), so it starts no server of its own and never touches production data:
 * the specs sign in as seeded local accounts.
 */
export default defineConfig({
  testDir: './e2e',
  ...(priorityMatch ? { testMatch: priorityMatch } : {}),
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
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
      },
    },
    ...(cross
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
          // Safari on a phone: touch, a narrow screen and the iOS user agent, on the same engine. Only the P0 folders.
          {
            name: 'mobile-safari',
            use: { ...devices['iPhone 14'] },
            testMatch: Object.entries(priorities)
              .filter(([, p]) => p === 'P0')
              .map(([folder]) => new RegExp(`/e2e/${folder}/.*\\.spec\\.ts$`)),
          },
        ]
      : []),
  ],
});
