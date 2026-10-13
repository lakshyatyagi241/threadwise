// @vitest-environment jsdom
import type { NotificationResponse } from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, choose, click, mount, text, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  search: '',
  replace: vi.fn(),
  feed: {} as Record<string, unknown>,
  summary: {} as Record<string, unknown>,
  refetch: vi.fn(),
  fetchNext: vi.fn(),
  markRead: vi.fn(),
  markAll: vi.fn(),
  clear: vi.fn(),
  dismiss: vi.fn(),
  lastFilters: undefined as unknown,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: state.replace }),
  usePathname: () => '/notifications',
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: () => void }) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/features/admin-console-shell/header/clear-notifications', () => ({
  useClearNotifications: () => ({
    mutate: (_v: undefined, o?: { onSettled?: () => void }) => {
      state.clear();
      o?.onSettled?.();
    },
    isPending: false,
  }),
}));
vi.mock('../api/hooks', () => ({
  useMarkRead: () => ({ markRead: state.markRead, markAllRead: state.markAll, markingAll: false }),
  useUnreadCount: () => ({ data: 2 }),
  useFeed: () => ({ data: undefined, isPending: false, isError: false }),
  POLL_MS: 60_000,
  FEED_SIZE: 8,
  pollIntervalFor: () => false,
  NOTIFICATION_KEYS: {},
}));
vi.mock('../live/use-alert-settings', () => ({ useAlertSettings: () => ({}) }));
vi.mock('./hooks', () => ({
  PAGE_SIZE: 20,
  useNotificationsPage: (filters: unknown) => {
    state.lastFilters = filters;
    return { ...state.feed, refetch: state.refetch, fetchNextPage: state.fetchNext, isFetchingNextPage: false };
  },
  useNotificationSummary: () => state.summary,
  useDismissNotification: () => ({ mutate: state.dismiss, isPending: false }),
}));

import { NotificationsPage } from './notifications-page';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000 - 60_000).toISOString();
const n = (id: string, over: Partial<NotificationResponse> = {}): NotificationResponse => ({
  id,
  type: 'task_assigned',
  title: `Task ${id}`,
  body: 'body',
  link: '/tasks',
  data: { taskTitle: `Call ${id}`, actorName: 'Omar' },
  readAt: null,
  createdAt: iso(0),
  ...over,
});
const pages = (rows: NotificationResponse[], unread = 2) => ({
  pages: [{ data: rows, page: { nextCursor: null, hasMore: false, limit: 20 }, meta: { unread } }],
});

let m: Mounted | undefined;
beforeEach(() => {
  state.search = '';
  state.replace = vi.fn();
  state.markRead = vi.fn();
  state.markAll = vi.fn();
  state.clear = vi.fn();
  state.dismiss = vi.fn();
  state.fetchNext = vi.fn();
  state.refetch = vi.fn();
  state.feed = {
    isPending: false,
    isError: false,
    hasNextPage: false,
    data: pages([n('a'), n('b', { readAt: iso(0) }), n('c', { createdAt: iso(1) }), n('d', { createdAt: iso(30) })]),
  };
  state.summary = {
    data: { unread: 2, last24Hours: 2, last7Days: 3, total: 4, byType: { task_assigned: 3, new_chat: 1, brand_new_kind: 2 } },
  };
});
afterEach(async () => {
  await m?.unmount();
  m = undefined;
  document.body.innerHTML = '';
});

describe('the page', () => {
  it('shows the numbers, day sections and every row', async () => {
    m = await mount(<NotificationsPage />);
    expect(m.host.querySelector('h1')?.textContent).toBe(text('notifications.page.title'));
    const heads = [...m.host.querySelectorAll('h2[id^="notif-"]')].map((h) => h.textContent);
    expect(heads).toEqual([
      text('notifications.page.sections.today'),
      text('notifications.page.sections.yesterday'),
      text('notifications.page.sections.older'),
    ]);
    expect(m.host.querySelectorAll('[data-testid="notification-item"]')).toHaveLength(4);
    const tiles = m.host.textContent!;
    for (const k of ['unread', 'day', 'week', 'total']) {
      expect(tiles).toContain(text(`notifications.page.tiles.${k}`));
    }
  });

  it('marks all read, and a row read when it is opened', async () => {
    m = await mount(<NotificationsPage />);
    await click(button(m.host, text('notifications.page.markAll')));
    expect(state.markAll).toHaveBeenCalledTimes(1);
    await click(m.host.querySelector('[data-testid="notification-item"] a')!);
    expect(state.markRead).toHaveBeenCalledWith('a');
  });

  it('dismisses one row', async () => {
    m = await mount(<NotificationsPage />);
    const x = m.host.querySelectorAll<HTMLButtonElement>(
      `button[aria-label="${text('notifications.page.dismiss')}"]`,
    );
    expect(x).toHaveLength(4);
    await click(x[2]!);
    expect(state.dismiss).toHaveBeenCalledWith('c');
  });

  it('clears everything only after a confirmation', async () => {
    m = await mount(<NotificationsPage />);
    await click(button(m.host, text('notifications.page.clearAll')));
    expect(state.clear).not.toHaveBeenCalled();
    expect(m.host.textContent).toContain(text('notifications.page.clearBody'));
    const confirm = [...m.host.querySelectorAll('dialog button')].find(
      (b) => b.textContent === text('notifications.page.clearConfirm'),
    )!;
    await click(confirm);
    expect(state.clear).toHaveBeenCalledTimes(1);
  });

  it('links to the preferences', async () => {
    m = await mount(<NotificationsPage />);
    const a = [...m.host.querySelectorAll('a')].find(
      (x) => x.textContent === text('notifications.page.preferences'),
    );
    expect(a?.getAttribute('href')).toBe('/account/notifications');
  });
});

describe('filters', () => {
  it('Unread writes the URL and sends the filter', async () => {
    state.search = 'read=unread&type=new_chat';
    m = await mount(<NotificationsPage />);
    expect(state.lastFilters).toEqual({ read: 'unread', type: 'new_chat', q: '' });
    await click(button(m.host, text('notifications.page.filters.all')));
    expect(state.replace).toHaveBeenLastCalledWith('/notifications?type=new_chat', { scroll: false });
  });

  it('the type list is built from what the person has, grouped, with a type this build does not know under Other', async () => {
    m = await mount(<NotificationsPage />);
    const select = m.host.querySelector<HTMLSelectElement>('select')!;
    const groups = [...select.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toContain(text('notifications.prefs.groups.conversations'));
    expect(groups).toContain(text('notifications.prefs.groups.tasks'));
    expect(groups).toContain(text('notifications.page.filters.otherTypes'));
    expect([...select.querySelectorAll('option')].map((o) => o.value)).toContain('brand_new_kind');
    await choose(select, 'new_chat');
    expect(state.replace).toHaveBeenLastCalledWith('/notifications?type=new_chat', { scroll: false });
  });

  it('the unread tile toggles the unread filter', async () => {
    m = await mount(<NotificationsPage />);
    const tile = m.host.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
    await click(tile);
    expect(state.replace).toHaveBeenLastCalledWith('/notifications?read=unread', { scroll: false });
  });
});

describe('states', () => {
  it('loading', async () => {
    state.feed = { isPending: true, isError: false, data: undefined };
    m = await mount(<NotificationsPage />);
    expect(m.host.textContent).toContain(text('notifications.page.loading'));
  });
  it('error with retry', async () => {
    state.feed = { isPending: false, isError: true, data: undefined };
    m = await mount(<NotificationsPage />);
    expect(m.host.querySelector('[data-testid="notifications-error"]')).not.toBeNull();
    await click(button(m.host, text('notifications.page.retry')));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });
  it('empty, and empty with a filter (Reset)', async () => {
    state.feed = { isPending: false, isError: false, hasNextPage: false, data: pages([], 0) };
    state.summary = { data: { unread: 0, last24Hours: 0, last7Days: 0, total: 0, byType: {} } };
    m = await mount(<NotificationsPage />);
    expect(m.host.textContent).toContain(text('notifications.page.empty'));
    expect(button(m.host, text('notifications.page.markAll')).disabled).toBe(true);
    expect(button(m.host, text('notifications.page.clearAll')).disabled).toBe(true);
    await m.unmount();
    state.search = 'q=zzz';
    m = await mount(<NotificationsPage />);
    expect(m.host.textContent).toContain(text('notifications.page.emptyFiltered'));
  });
  it('Load more', async () => {
    state.feed = { ...state.feed, hasNextPage: true };
    m = await mount(<NotificationsPage />);
    await click(button(m.host, text('notifications.page.loadMore')));
    expect(state.fetchNext).toHaveBeenCalledTimes(1);
  });
});

describe('Arabic', () => {
  it('is worded in Arabic with no message key showing', async () => {
    m = await mount(<NotificationsPage />, { locale: 'ar' });
    expect(m.host.querySelector('h1')?.textContent).toBe(text('notifications.page.title', 'ar'));
    expect(m.host.textContent).not.toMatch(/notifications\.page\./);
  });
});
