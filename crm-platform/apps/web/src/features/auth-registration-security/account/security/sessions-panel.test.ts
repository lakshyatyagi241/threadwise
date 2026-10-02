import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { keys } from '../api';
import { renderAccount } from '../render-test-utils';

vi.mock('next/navigation', () => ({
  usePathname: () => '/account/security',
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
}));

const { SessionsPanel } = await import('./sessions-panel');

const row = (n: number, over = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  current: false,
  device: `Chrome on Windows ${n}`,
  deviceKind: 'desktop',
  ip: `203.0.113.${n}`,
  createdAt: '2026-10-01T08:00:00.000Z',
  lastUsedAt: '2026-10-01T09:00:00.000Z',
  remember: false,
  ...over,
});
const meta = {
  sessionLifetimeSeconds: 7 * 86_400,
  rememberLifetimeSeconds: 30 * 86_400,
  idleTimeoutMinutes: 60,
};
const page = (rows: object[], total: number, hasMore = false) => ({
  data: rows,
  page: { nextCursor: hasMore ? 'abc' : null, hasMore, limit: 10 },
  total,
  meta,
});
const render = (data: object, locale: 'en' | 'ar' = 'en') =>
  renderAccount(createElement(SessionsPanel), {
    locale,
    seed: [[[...keys.sessions, 'first'], data]],
  });

describe('SessionsPanel', () => {
  const html = render(
    page([row(1, { current: true, remember: true }), row(2), row(3, { ip: null })], 3),
  );

  it('is a table with Device, IP address and Last active columns', () => {
    expect(html).toContain('<table');
    for (const col of ['Device', 'IP address', 'Last active']) expect(html).toContain(`>${col}<`);
  });

  it('keeps the screen-reader-only text of a scrolling table inside it, so it cannot widen the page', () => {
    // An absolutely positioned sr-only span escapes an overflow clip unless the clip is positioned too.
    expect(html).toContain('class="relative overflow-x-auto"');
  });

  it('marks this device and gives every other row a Revoke button', () => {
    expect(html).toContain('This device');
    expect(html).toContain('Stays signed in');
    expect(html.match(/>Revoke</g)?.length).toBe(2);
    expect(html).toContain('203.0.113.2');
    expect(html).toContain('Address unknown');
  });

  it('has the sign-out-of-all-others button, enabled when there are other devices', () => {
    expect(html).toContain('Sign out of all others');
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Sign out of all others/);
  });

  it('states how long a sign-in lasts, from the API, not from the page', () => {
    expect(html).toContain('after 7 days');
    expect(html).toContain('after 30 days');
    expect(html).toContain('after 1 hour of no activity');
  });

  it('shows no pager for a single page', () => {
    expect(html).not.toContain('Showing');
  });

  it('pages by ten with the range and the total when there are more', () => {
    const many = render(
      page(
        Array.from({ length: 10 }, (_, i) => row(i + 1, i === 0 ? { current: true } : {})),
        23,
        true,
      ),
    );
    expect(many).toContain('Showing 1–10 of 23');
    expect(many).toContain('1 / 3');
    expect(many).toMatch(/<button[^>]*\sdisabled=""[^>]*>Prev/);
    expect(many).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Next/);
  });

  it('only this device: nothing to sign out of', () => {
    const only = render(page([row(1, { current: true })], 1));
    expect(only).toMatch(/<button[^>]*\sdisabled=""[^>]*>Sign out of all others/);
    expect(only).not.toContain('>Revoke<');
  });

  it('renders in Arabic with the unit in Arabic', () => {
    expect(render(page([row(1, { current: true })], 1), 'ar')).toContain('الجهاز');
  });
});
