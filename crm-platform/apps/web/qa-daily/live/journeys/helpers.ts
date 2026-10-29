import type { Page } from '@playwright/test';

/** Open a page and dismiss the cookie dialog if it shows. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await page
    .getByRole('button', { name: 'Reject All' })
    .click({ timeout: 2500 })
    .catch(() => undefined);
}
