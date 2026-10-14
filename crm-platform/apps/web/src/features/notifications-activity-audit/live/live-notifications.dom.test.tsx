// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REALTIME_EVENT, type NotificationListResponse } from '@crm/contracts';
import { RealtimeProvider } from '@/lib/realtime';
import { fakeSocketFactory } from '@/lib/realtime/fake-socket';
import { mount, text, type Mounted } from '../testing';
import { LiveNotifications } from './live-notifications';
import { FEED_RETRY_MS } from './controller';
import { HIDDEN_DELAY_MS } from './claim';
import { FLUSH_MS } from './model';
import { useLiveUpdatesPaused } from './use-live-paused';

/**
 * The whole chain on a page, as the owner met it: the socket, the controller, the presenter, the toast host and the tab title. Only the
 * network (the notifications API) and the socket are fakes.
 */
/** Shows what `useLiveUpdatesPaused` says. */
function LiveUpdatesProbe() {
  const paused = useLiveUpdatesPaused();
  return <span data-testid="probe-paused">{paused ? 'yes' : 'no'}</span>;
}

const api = vi.hoisted(() => ({
  unread: vi.fn(),
  list: vi.fn(),
  markRead: vi.fn(),
  readSubject: vi.fn(),
}));
vi.mock('../api/service', () => ({
  notificationsApi: {
    unread: (...a: unknown[]) => api.unread(...a),
    list: (...a: unknown[]) => api.list(...a),
    markRead: (...a: unknown[]) => api.markRead(...a),
    readSubject: (...a: unknown[]) => api.readSubject(...a),
    preferences: () => Promise.reject(new Error('not loaded')),
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => '/dashboard',
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));

const CONV = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROW_ID = '00000000-0000-4000-8000-000000000001';
const listOf = (rows: NotificationListResponse['data']): NotificationListResponse => ({
  data: rows,
  page: { nextCursor: null, hasMore: false, limit: 8 },
  meta: { unread: rows.filter((r) => r.readAt === null).length },
});
const ROW: NotificationListResponse['data'][number] = {
  id: ROW_ID,
  type: 'new_message',
  title: 'x',
  body: null,
  link: `/inbox?c=${CONV}`,
  data: { conversationId: CONV, contactName: 'Ada', preview: 'Hello there' },
  readAt: null,
  createdAt: '2026-10-07T10:00:00.000Z',
  count: 1,
  subject: { kind: 'conversation', id: CONV },
};
const created = (over: Record<string, unknown> = {}) => ({
  notificationId: ROW_ID,
  type: 'new_message',
  unread: 1,
  subjectKind: 'conversation',
  subjectId: CONV,
  collapsed: false,
  silent: false,
  ...over,
});

let visibility: 'visible' | 'hidden' = 'visible';
const setVisibility = async (next: 'visible' | 'hidden') => {
  visibility = next;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

let mounted: Mounted | null = null;
async function open(withSocket = true) {
  const { factory, last } = fakeSocketFactory();
  mounted = await mount(
    <RealtimeProvider
      url={withSocket ? 'http://api.test/realtime' : undefined}
      createSocket={factory}
      mintTicket={async () => 'rtk'}
    >
      <LiveNotifications />
      <LiveUpdatesProbe />
    </RealtimeProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const socket = withSocket ? last() : null;
  if (socket) await act(async () => socket.accept());
  let seq = 0;
  const push = (
    payload: Record<string, unknown>,
    type: string = REALTIME_EVENT.notificationCreated,
  ) =>
    act(async () => {
      socket!.push({ type, room: 'user', seq: ++seq, payload } as never);
      await vi.advanceTimersByTimeAsync(0);
    });
  const wait = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  return { socket, push, wait };
}
const toasts = () => [...document.querySelectorAll('[data-testid="live-toast"]')];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T10:00:00.000Z'));
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  document.title = 'Dashboard';
  api.unread.mockReset().mockResolvedValue(0);
  api.list.mockReset().mockResolvedValue(listOf([ROW]));
  api.markRead.mockReset();
  api.readSubject.mockReset().mockResolvedValue({ updated: 0, unread: 0 });
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe('LiveNotifications on a page', () => {
  it('a new notification changes the tab title AND shows a toast with its words', async () => {
    const { push, wait } = await open();
    await push(created());
    await wait(FLUSH_MS);
    expect(document.title).toBe('(1) Dashboard');
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.textContent).toContain('Ada');
    expect(toasts()[0]!.textContent).toContain('Hello there');
  });

  it('when the list cannot be fetched (twice) the person still gets a generic toast, never only the title', async () => {
    api.list.mockRejectedValue(new Error('network'));
    const { push, wait } = await open();
    await push(created());
    await wait(FLUSH_MS + FEED_RETRY_MS);
    expect(document.title).toBe('(1) Dashboard');
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.textContent).toContain(text('notifications.live.generic'));
  });

  it('when the new row is not among the newest rows, the generic toast shows', async () => {
    api.list.mockResolvedValue(listOf([{ ...ROW, id: '00000000-0000-4000-8000-0000000000ff' }]));
    const { push, wait } = await open();
    await push(created({ subjectId: null, subjectKind: null, type: 'task_due' }));
    await wait(FLUSH_MS);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.textContent).toContain(text('notifications.live.generic'));
  });

  it('a hidden tab shows the title but no toast, then the toast when the tab comes back', async () => {
    const { push, wait } = await open();
    await setVisibility('hidden');
    await push(created());
    await wait(FLUSH_MS + HIDDEN_DELAY_MS + 50); // a hidden tab waits a moment to let a visible tab claim the ping first
    expect(document.title).toBe('(1) Dashboard');
    expect(toasts()).toHaveLength(0);
    await setVisibility('visible');
    expect(toasts()).toHaveLength(1);
  });

  it('a silent event moves the title only', async () => {
    const { push, wait } = await open();
    await push(created({ silent: true }));
    await wait(FLUSH_MS);
    expect(document.title).toBe('(1) Dashboard');
    expect(toasts()).toHaveLength(0);
  });

  it('the toast host sits above the top bar, below page dialogs, and only the toast takes clicks', async () => {
    const { push, wait } = await open();
    await push(created());
    await wait(FLUSH_MS);
    const host = document.querySelector('[data-testid="live-toasts"]')!;
    expect(host.className).toContain('fixed');
    expect(host.className).toContain('z-[55]'); // the top bar is z-40, the mobile menu z-50, the command palette z-[70]
    expect(host.className).toContain('pointer-events-none');
    expect(host.className).toContain('sm:end-4'); // logical, so it mirrors in right-to-left languages
    expect(host.className).not.toMatch(/(^|\s)(left|right)-/);
    expect(toasts()[0]!.className).toContain('pointer-events-auto');
  });
});

describe('without a live connection', () => {
  it('only the polled count moves the title, and the paused state is reported after a few seconds', async () => {
    api.unread.mockResolvedValue(3);
    const { wait } = await open(false);
    expect(document.querySelector('[data-testid="probe-paused"]')!.textContent).toBe('no');
    await wait(5_000);
    expect(document.querySelector('[data-testid="probe-paused"]')!.textContent).toBe('yes');
    expect(document.title).toBe('(3) Dashboard');
    expect(toasts()).toHaveLength(0);
  });

  it('is not paused while the socket is connected', async () => {
    const { wait } = await open(true);
    await wait(10_000);
    expect(document.querySelector('[data-testid="probe-paused"]')!.textContent).toBe('no');
  });

  it('is paused after the socket drops for more than a few seconds, and clears when it is back', async () => {
    const { socket, wait } = await open(true);
    await act(async () => socket!.drop());
    await wait(4_000);
    expect(document.querySelector('[data-testid="probe-paused"]')!.textContent).toBe('no');
    await wait(1_500);
    expect(document.querySelector('[data-testid="probe-paused"]')!.textContent).toBe('yes');
    await act(async () => socket!.accept());
    expect(document.querySelector('[data-testid="probe-paused"]')!.textContent).toBe('no');
  });
});
