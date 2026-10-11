import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The FAQ specs on a machine whose Playwright browser cache holds an older Chromium than this Playwright version expects (no
 * download is possible there). `FAQ_CHROMIUM` points at an installed Chromium; the base config is otherwise unchanged.
 */
export default defineConfig({
  ...base,
  use: {
    ...base.use,
    launchOptions: { executablePath: process.env.FAQ_CHROMIUM || undefined },
  },
});
