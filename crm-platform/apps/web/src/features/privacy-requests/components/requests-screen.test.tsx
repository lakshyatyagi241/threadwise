// @vitest-environment jsdom
import type { PrivacyRequest } from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, makeRequest, mount, text, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  query: {} as Record<string, unknown>,
  lastFilters: undefined as unknown,
  fetchNext: vi.fn(),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../api/hooks', () => ({
  KEYS: { all: ['privacy-requests'], settings: ['privacy-requests', 'settings'] },
  usePrivacyRequests: (filters: unknown) => {
    state.lastFilters = filters;
    return state.query;
  },
  usePrivacySettings: () => ({ data: { slaDays: 30 }, isError: false }),
  useSubjectSearch: () => ({ data: undefined, isFetching: false }),
}));
vi.mock('../api/service', () => ({ privacyApi: {}, privacyExportFileUrl: () => '#' }));

import { RequestsScreen } from './requests-screen';

const page = (rows: PrivacyRequest[], hasMore = false) => ({
  isError: false,
  isPending: false,
  error: null,
  data: { pages: [{ data: rows, page: { nextCursor: 'c', hasMore, limit: 25 } }] },
  hasNextPage: hasMore,
  isFetchingNextPage: false,
  fetchNextPage: state.fetchNext,
  refetch: vi.fn(),
});

let m: Mounted | null = null;
beforeEach(() => {
  state.perms = new Set(['privacy.requests.read', 'privacy.requests.manage']);
  state.fetchNext.mockReset();
  state.query = page([
    makeRequest(),
    makeRequest({
      id: '33333333-3333-4333-8333-333333333333',
      reference: 'DSR-LATE0001',
      requestType: 'export',
      daysLeft: -4,
      overdue: true,
      status: 'received',
    }),
    makeRequest({
      id: '44444444-4444-4444-8444-444444444444',
      reference: 'DSR-DONE0001',
      status: 'completed',
      daysLeft: null,
    }),
  ]);
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});

describe.each(['en', 'ar'])('data requests list (%s)', (locale) => {
  it('lists reference, type, masked subject, status and the clock; overdue is red', async () => {
    m = await mount(<RequestsScreen />, { locale });
    const h = m.host;
    expect(h.textContent).toContain(text('list.title', locale));
    expect(h.textContent).toContain('DSR-3F9A12BC');
    expect(h.textContent).toContain('A. K. ••• 4821');
    expect(h.textContent).toContain(text('type.erasure', locale));
    expect(h.textContent).toContain(text('status.in_progress', locale));
    expect(h.querySelectorAll('tbody tr')).toHaveLength(3);
    const late = h.querySelector('[data-sla="overdue"]')!;
    expect(late.className).toContain('text-danger');
    expect(h.querySelectorAll('[data-sla="open"]')).toHaveLength(1);
    expect(h.textContent).toContain(text('sla.closed', locale));
  });

  it('passes the filters to the query', async () => {
    m = await mount(<RequestsScreen />, { locale });
    const select = m.host.querySelector<HTMLSelectElement>('#pr-status')!;
    await import('react').then(({ act }) =>
      act(async () => {
        select.value = 'received';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }),
    );
    expect(state.lastFilters).toMatchObject({ status: 'received' });
    await click(m.host.querySelector('#pr-overdue')!);
    expect(state.lastFilters).toMatchObject({ status: 'received', overdue: true });
  });

  it('loads more with the cursor button', async () => {
    state.query = page([makeRequest()], true);
    m = await mount(<RequestsScreen />, { locale });
    await click(button(m.host, text('list.loadMore', locale)));
    expect(state.fetchNext).toHaveBeenCalledOnce();
  });

  it('shows New request only to people who manage requests', async () => {
    m = await mount(<RequestsScreen />, { locale });
    expect(button(m.host, text('list.newRequest', locale))).toBeTruthy();
    await m.unmount();
    state.perms = new Set(['privacy.requests.read']);
    m = await mount(<RequestsScreen />, { locale });
    expect(
      [...m.host.querySelectorAll('button')].some(
        (b) => b.textContent === text('list.newRequest', locale),
      ),
    ).toBe(false);
  });

  it('is refused without the read permission', async () => {
    state.perms = new Set();
    m = await mount(<RequestsScreen />, { locale });
    expect(m.host.textContent).toContain(text('errors.forbidden', locale));
    expect(m.host.querySelector('table')).toBeNull();
  });
});
