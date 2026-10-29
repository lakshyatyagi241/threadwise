import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/** Journeys written but not yet proven stable on the seeded stack (live/known-pending.json, titles). They are skipped so they cannot file false bugs. */
const pendingFile = join(__dirname, 'live/known-pending.json');
const pending: string[] = existsSync(pendingFile)
  ? JSON.parse(readFileSync(pendingFile, 'utf8'))
  : [];
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The daily functional journeys (qa-daily/live/journeys). QA_TARGET=local|prod, see live/qa.ts. HEADLESS=1 for cron. */
const prod = process.env.QA_TARGET === 'prod';
export default defineConfig({
  testDir: './live/journeys',
  testMatch: /\.spec\.ts$/,
  outputDir: './out/.pw-live',
  ...(pending.length ? { grepInvert: new RegExp(pending.map(esc).join('|')) } : {}),
  workers: 1, // the API caps concurrent sessions per account
  retries: prod ? 1 : 0, // one retry on prod so a network blip is not filed as a bug
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: process.env.PW_JSON ?? './out/live-results.json' }]],
  use: {
    headless: process.env.HEADLESS !== '0',
    baseURL:
      process.env.QA_BASE_URL ??
      (prod ? 'https://desk.wabo.ai' : (process.env.WEB_URL ?? 'http://localhost:3001')),
    ...devices['Desktop Chrome'],
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
});
