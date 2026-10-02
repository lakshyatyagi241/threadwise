import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { securityEventListResponseSchema } from '@crm/contracts';
import { renderWithMessages } from '../render-test-utils';
import { SecurityEvents } from './security-events';

let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/admin/security/events',
  useSearchParams: () => new URLSearchParams(search),
}));

const ORG = '3f2b8c1e-4a5d-4e6f-9a0b-1c2d3e4f5a6b';
const ACTOR = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';

const page = securityEventListResponseSchema.parse({
  data: [
    {
      id: 'evt-1',
      at: '2026-10-01T10:00:00.000Z',
      event: 'auth.failed',
      status: 'failure',
      actorType: 'user',
      actorId: ACTOR,
      actorName: 'Ann Lee',
      actorEmail: 'ann@example.com',
      orgId: ORG,
      orgSlug: 'acme',
      orgName: 'Acme Ltd',
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0',
      requestId: 'req-7f3a9c2e-1111-2222-3333-444455556666',
      payload: { identifier: 'ann@example.com' },
    },
    {
      id: 'evt-2',
      at: '2026-10-01T09:00:00.000Z',
      event: 'platform.security.policy_updated',
      status: 'info',
      actorType: 'system',
      actorId: null,
      actorName: null,
      actorEmail: null,
      orgId: null,
      orgSlug: null,
      orgName: null,
      ip: null,
      userAgent: null,
      requestId: null,
      payload: {},
    },
  ],
  page: { nextCursor: null, hasMore: false, limit: 50 },
});

const key = (filters: Record<string, string | undefined> = {}) => [
  'operator',
  'security-events',
  { event: undefined, q: undefined, status: undefined, ...filters },
];
const seeded = (filters?: Record<string, string | undefined>) =>
  [[key(filters), { pages: [page], pageParams: [undefined] }]] as const;

const render = (locale: 'en' | 'ar' = 'en', filters?: Record<string, string | undefined>) =>
  renderWithMessages(createElement(SecurityEvents), { locale, seed: seeded(filters) });

describe('SecurityEvents', () => {
  it('names the actor, with email, kind and a shortened id that can be copied', () => {
    search = '';
    const html = render();
    expect(html).toContain('Ann Lee');
    expect(html).toContain('ann@example.com');
    expect(html).toContain('(User)');
    expect(html).toContain('9a8b7c6d…');
    expect(html).toContain('aria-label="Copy actor id"');
  });

  it('names the workspace, with its slug, and offers the uuid to copy', () => {
    search = '';
    const html = render();
    expect(html).toContain('Acme Ltd');
    expect(html).toContain('>acme<');
    expect(html).not.toContain(`>${ORG}<`);
    expect(html).toContain('aria-label="Copy workspace id"');
  });

  it('shows the address, the request id (shortened, copyable) and the browser', () => {
    search = '';
    const html = render();
    expect(html).toContain('203.0.113.9');
    expect(html).toContain('req-7f3a…');
    expect(html).toContain('aria-label="Copy request id"');
    expect(html).toContain('Firefox/130.0');
  });

  it('describes a system event by its kind alone and leaves out what it does not have', () => {
    search = '';
    const html = render();
    const second = html.split('<li class="px-4 py-3">')[2] ?? '';
    expect(second).toContain('>System<');
    expect(second).not.toContain('Copy actor id');
    expect(second).not.toContain('Copy request id');
    expect(second).not.toContain('Browser');
  });

  it('offers a CSV export of the loaded rows and a text search beside the exact name', () => {
    search = '';
    const html = render();
    expect(html).toContain('Export CSV');
    expect(html).toContain('id="events-q"');
    expect(html).toContain('id="events-event"');
  });

  it('keeps the filters from the address in the boxes', () => {
    search = 'q=lock&event=auth.failed&status=failure';
    const html = renderWithMessages(createElement(SecurityEvents), {
      seed: seeded({ event: 'auth.failed', q: 'lock', status: 'failure' }),
    });
    expect(html).toContain('value="lock"');
    expect(html).toContain('value="auth.failed"');
    expect(html).toContain('Clear filters');
  });

  it('has no export to offer when nothing is loaded', () => {
    search = '';
    const empty = securityEventListResponseSchema.parse({
      data: [],
      page: { nextCursor: null, hasMore: false, limit: 50 },
    });
    const html = renderWithMessages(createElement(SecurityEvents), {
      seed: [[key(), { pages: [empty], pageParams: [undefined] }]],
    });
    expect(html).toContain('No security events have been recorded yet.');
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Export CSV/);
  });

  it('renders in Arabic with every message present', () => {
    search = '';
    expect(render('ar')).toContain('أحداث الأمان');
  });
});
