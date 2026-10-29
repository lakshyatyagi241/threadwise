import { expect, test } from '@playwright/test';

/**
 * The request throttle (TW-INFRA-010) as a browser sees it, through the web app's own proxy. The public trust page allows 60
 * requests a minute per address (`@Throttle({ limit: 60, windowSeconds: 60, by: 'ip' })`). Runs against the real stack and Redis.
 * It does not assume a fresh counter: it sends until the first refusal and checks where that lands and what it carries.
 */
const THROTTLED = '/api/v2/public/compliance/trust';
const UNTHROTTLED = '/api/v2/public/robots.txt';

test('a caller over the limit gets 429 RATE_LIMITED with Retry-After, and quota headers before that', async ({
  page,
  request,
}) => {
  const seen: number[] = [];
  let refused: Awaited<ReturnType<typeof request.get>> | undefined;
  let firstAllowed: Awaited<ReturnType<typeof request.get>> | undefined;
  for (let i = 0; i < 70; i++) {
    const res = await request.get(`${THROTTLED}/e2e-${i}`);
    seen.push(res.status());
    if (res.status() === 429) {
      refused = res;
      break;
    }
    firstAllowed ??= res;
  }

  expect(refused, 'the 60/minute limit trips within 70 requests').toBeDefined();
  expect(
    seen.filter((s) => s !== 404 && s !== 429),
    'allowed requests are served',
  ).toEqual([]);
  expect(seen.length, 'no refusal before the 60th request of the window').toBeLessThanOrEqual(61);

  expect(firstAllowed!.headers()['x-ratelimit-limit']).toBe('60');
  expect(Number(firstAllowed!.headers()['x-ratelimit-remaining'])).toBeLessThan(60);

  expect(refused!.headers()['content-type']).toContain('application/problem+json');
  expect(Number(refused!.headers()['retry-after'])).toBeGreaterThanOrEqual(1);
  expect(refused!.headers()['x-ratelimit-remaining']).toBe('0');
  expect(await refused!.json()).toMatchObject({ status: 429, code: 'RATE_LIMITED' });

  // Counted per route: the refused caller is still served by a route with no limit.
  expect((await request.get(UNTHROTTLED)).status()).toBe(200);

  // And the page itself can read the headers (same origin, through the proxy). A browser may reach localhost over IPv6, a different
  // caller with its own counter, so it runs its own loop to the limit.
  await page.goto('/login');
  const seenByPage = await page.evaluate(async (url) => {
    for (let i = 0; i < 70; i++) {
      const r = await fetch(`${url}/e2e-page-${i}`);
      if (r.status === 429) {
        return {
          status: 429,
          retryAfter: r.headers.get('retry-after'),
          limit: r.headers.get('x-ratelimit-limit'),
        };
      }
    }
    return { status: 0, retryAfter: null, limit: null };
  }, THROTTLED);
  expect(seenByPage.status).toBe(429);
  expect(Number(seenByPage.retryAfter)).toBeGreaterThanOrEqual(1);
  expect(seenByPage.limit).toBe('60');
});
