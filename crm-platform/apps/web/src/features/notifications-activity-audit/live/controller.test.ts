import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REALTIME_EVENT,
  type NotificationListResponse,
  type NotificationResponse,
} from '@crm/contracts';
import { fakeSocketFactory } from '@/lib/realtime/fake-socket';
import { RealtimeClient } from '@/lib/realtime/realtime-client';
import { NOTIFICATION_KEYS } from '../api/keys';
import {
  INBOX_COUNTS_KEY,
  LiveNotificationsController,
  type LiveApi,
  type LivePresenter,
} from './controller';
import { FLUSH_MS, TOAST_PER_SUBJECT_MS, TOAST_WINDOW_MAX } from './model';

const CONV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONV_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONV_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function row(
  n: number,
  conv: string,
  over: Partial<NotificationResponse> = {},
): NotificationResponse {
  return {
    id: id(n),
    type: 'new_message',
    title: 'x',
    body: null,
    link: `/inbox?c=${conv}`,
    data: { conversationId: conv, contactName: 'Ada', preview: 'Hello' },
    readAt: null,
    createdAt: '2026-10-07T10:00:00.000Z',
    count: 1,
    subject: { kind: 'conversation', id: conv },
    ...over,
  };
}

interface Harness {
  qc: QueryClient;
  socket: ReturnType<ReturnType<typeof fakeSocketFactory>['last']>;
  rows: NotificationResponse[];
  presented: Array<Record<string, unknown>>;
  pings: number;
  desktops: string[];
  announces: number[];
  listCalls: number;
  readSubjects: string[];
  visible: boolean;
  location: { pathname: string; search: string };
  sound: boolean;
  desktopOn: boolean;
  claimResult: boolean;
  seq: number;
  emit(payload: Record<string, unknown>, type?: string): void;
  created(n: number, conv: string, over?: Record<string, unknown>): void;
  controller: LiveNotificationsController;
  client: RealtimeClient;
}

async function setup(): Promise<Harness> {
  const { factory, last } = fakeSocketFactory();
  const client = new RealtimeClient({
    url: 'http://api.test/realtime',
    mintTicket: async () => 'rtk_1',
    createSocket: factory,
  });
  client.start();
  await vi.advanceTimersByTimeAsync(0);
  const socket = last();
  socket.accept();

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const h = {
    qc,
    socket,
    rows: [] as NotificationResponse[],
    presented: [] as Array<Record<string, unknown>>,
    pings: 0,
    desktops: [] as string[],
    announces: [] as number[],
    listCalls: 0,
    readSubjects: [] as string[],
    visible: true,
    location: { pathname: '/dashboard', search: '' },
    sound: true,
    desktopOn: false,
    claimResult: true,
    seq: 0,
    client,
  } as unknown as Harness;

  const api: LiveApi = {
    list: async () => {
      h.listCalls += 1;
      return {
        data: h.rows,
        page: { nextCursor: null, hasMore: false, limit: 8 },
        meta: { unread: h.rows.filter((r) => r.readAt === null).length },
      } satisfies NotificationListResponse;
    },
    readSubject: async (conv) => {
      h.readSubjects.push(conv);
    },
  };
  const presenter: LivePresenter = {
    toast: (t) => h.presented.push(t as unknown as Record<string, unknown>),
    announce: (alerts) => h.announces.push(alerts.length),
    desktop: (a) => h.desktops.push(a.row.id),
    ping: () => {
      h.pings += 1;
    },
  };
  h.controller = new LiveNotificationsController({
    client,
    qc,
    api,
    presenter,
    settings: { soundOn: () => h.sound, desktopOn: () => h.desktopOn },
    claimer: { claim: async () => h.claimResult },
    env: { isVisible: () => h.visible, location: () => h.location, now: () => Date.now() },
  });
  h.controller.start();
  h.emit = (payload, type = REALTIME_EVENT.notificationCreated) => {
    socket.push({ type, room: 'user', seq: ++h.seq, payload } as never);
  };
  h.created = (n, conv, over = {}) =>
    h.emit({
      notificationId: id(n),
      type: 'new_message',
      unread: n,
      subjectKind: 'conversation',
      subjectId: conv,
      collapsed: false,
      silent: false,
      ...over,
    });
  return h;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T10:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const settle = (ms = FLUSH_MS) => vi.advanceTimersByTimeAsync(ms);

describe('notification.created', () => {
  it('moves the badge at once to the server number, before any fetch', async () => {
    const h = await setup();
    h.created(3, CONV_A);
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(3);
    expect(h.listCalls).toBe(0);
  });

  it('after the flush fetches the rows once and raises a toast, a ping and an announcement for a visible tab', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A, { count: 3 })];
    h.created(1, CONV_A);
    await settle();
    expect(h.listCalls).toBe(1);
    expect(h.presented).toHaveLength(1);
    expect(h.presented[0]).toMatchObject({
      kind: 'alert',
      alert: { notificationId: id(1), href: `/inbox?c=${CONV_A}` },
    });
    expect(h.pings).toBe(1);
    expect(h.announces).toEqual([1]);
    expect(h.desktops).toEqual([]);
    // the fetched list is now in the bell cache (the new row at the top)
    expect(
      (h.qc.getQueryData(NOTIFICATION_KEYS.feed) as NotificationListResponse).data[0]!.id,
    ).toBe(id(1));
  });

  it('coalesces a burst of 200 events into one fetch and one toast per conversation', async () => {
    const h = await setup();
    h.rows = [row(200, CONV_A, { count: 200 })];
    for (let i = 1; i <= 200; i++) h.created(i === 200 ? 200 : i, CONV_A);
    await settle();
    expect(h.listCalls).toBe(1);
    expect(h.presented).toHaveLength(1);
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(200);
  });

  it('shows the newest row of a conversation whose earlier event was collapsed into it', async () => {
    const h = await setup();
    h.rows = [row(2, CONV_A, { count: 2 })]; // event 1's row was replaced by 2
    h.created(1, CONV_A);
    await settle();
    expect(h.presented[0]).toMatchObject({ alert: { row: { id: id(2) } } });
  });

  it('stays quiet for a silent event but still updates the badge and marks the list stale', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A, { silent: true });
    await settle();
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(1);
    expect(h.listCalls).toBe(0);
    expect(h.presented).toEqual([]);
    expect(h.pings).toBe(0);
  });

  it('does not toast or ping for types that are not chats (a task still moves the badge)', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A, { type: 'task_due' })];
    h.created(1, CONV_A, { type: 'task_due', subjectKind: null, subjectId: null });
    await settle();
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(1);
    expect(h.presented).toEqual([]);
    expect(h.pings).toBe(0);
  });

  it('shows one alert when the same event is delivered twice', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A)];
    const payload = {
      notificationId: id(1),
      type: 'new_message',
      unread: 1,
      subjectKind: 'conversation',
      subjectId: CONV_A,
      collapsed: false,
      silent: false,
    };
    const env = {
      v: 1,
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      at: new Date(0).toISOString(),
      type: REALTIME_EVENT.notificationCreated,
      room: 'user',
      seq: 1,
      payload,
    };
    h.socket.serverEmit(env.type, env);
    h.socket.serverEmit(env.type, env);
    await settle();
    expect(h.presented).toHaveLength(1);
  });

  it('does nothing visible when the person is looking at that conversation, and marks its rows read', async () => {
    const h = await setup();
    h.location = { pathname: '/inbox', search: `?c=${CONV_A}` };
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A);
    await settle(1_500);
    expect(h.presented).toEqual([]);
    expect(h.pings).toBe(0);
    expect(h.listCalls).toBe(0);
    expect(h.readSubjects).toEqual([CONV_A]);
  });

  it('still tells them about a different conversation while the Inbox is open on another thread', async () => {
    const h = await setup();
    h.location = { pathname: '/inbox', search: `?c=${CONV_B}` };
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A);
    await settle();
    expect(h.presented).toHaveLength(1);
    expect(h.readSubjects).toEqual([]);
  });

  it('in a hidden tab: no toast, no announcement; the desktop alert only when allowed; the ping when this tab claims', async () => {
    const h = await setup();
    h.visible = false;
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A);
    await settle();
    expect(h.presented).toEqual([]);
    expect(h.announces).toEqual([]);
    expect(h.desktops).toEqual([]);
    expect(h.pings).toBe(1);

    h.desktopOn = true;
    h.rows = [row(2, CONV_B)];
    h.created(2, CONV_B);
    await settle();
    expect(h.desktops).toEqual([id(2)]);
  });

  it('another tab owns the sound and the desktop alert, this one still shows its toast', async () => {
    const h = await setup();
    h.claimResult = false;
    h.desktopOn = true;
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A);
    await settle();
    expect(h.pings).toBe(0);
    expect(h.desktops).toEqual([]);
    expect(h.presented).toHaveLength(1);
  });

  it('respects the sound switch', async () => {
    const h = await setup();
    h.sound = false;
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A);
    await settle();
    expect(h.pings).toBe(0);
    expect(h.presented).toHaveLength(1);
  });

  it('skips a row that was already read when the list arrived', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A, { readAt: '2026-10-07T10:00:01.000Z' })];
    h.created(1, CONV_A);
    await settle();
    expect(h.presented).toEqual([]);
  });

  it('survives a failing list call (no toast, no throw)', async () => {
    const h = await setup();
    h.controller.stop();
    const failing = new LiveNotificationsController({
      client: h.client,
      qc: h.qc,
      api: {
        list: async () => Promise.reject(new Error('down')),
        readSubject: async () => undefined,
      },
      presenter: {
        toast: () => h.presented.push({}),
        announce: () => undefined,
        desktop: () => undefined,
        ping: () => undefined,
      },
      settings: { soundOn: () => true, desktopOn: () => false },
      claimer: { claim: async () => true },
      env: { isVisible: () => true, location: () => h.location, now: () => Date.now() },
    });
    failing.start();
    h.created(1, CONV_A);
    await settle();
    expect(h.presented).toEqual([]);
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(1);
  });
});

describe('toast pacing', () => {
  it('shows one toast per conversation per 3 s and the newest state after the wait', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A, { count: 1 })];
    h.created(1, CONV_A);
    await settle();
    expect(h.presented).toHaveLength(1);

    h.rows = [row(2, CONV_A, { count: 2 })];
    h.created(2, CONV_A);
    await settle();
    expect(h.presented).toHaveLength(1); // deferred

    h.rows = [row(3, CONV_A, { count: 3 })];
    h.created(3, CONV_A);
    await settle();
    expect(h.presented).toHaveLength(1);

    await settle(TOAST_PER_SUBJECT_MS);
    expect(h.presented).toHaveLength(2);
    expect(h.presented[1]).toMatchObject({ alert: { row: { id: id(3), count: 3 } } });
  });

  it('turns toasts beyond three in ten seconds into one summary', async () => {
    const h = await setup();
    const convs = [CONV_A, CONV_B, CONV_C, CONV_D];
    h.rows = convs.map((c, i) => row(i + 1, c));
    convs.forEach((c, i) => h.created(i + 1, c));
    await settle();
    expect(h.presented.filter((p) => p.kind === 'alert')).toHaveLength(TOAST_WINDOW_MAX);
    expect(h.presented.some((p) => p.kind === 'summary')).toBe(false);
    await settle(10_000);
    expect(h.presented.filter((p) => p.kind === 'summary')).toEqual([
      { kind: 'summary', count: 1 },
    ]);
  });

  it('spaces announcements at least 3 s apart and batches what came between', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A);
    await settle();
    expect(h.announces).toEqual([1]);
    h.rows = [row(2, CONV_B), row(1, CONV_A)];
    h.created(2, CONV_B);
    await settle();
    expect(h.announces).toEqual([1]);
    await settle(3_000);
    expect(h.announces).toEqual([1, 1]);
  });
});

describe('notification.read', () => {
  it('sets the badge and marks the cached rows read (another tab or device read them)', async () => {
    const h = await setup();
    h.qc.setQueryData(NOTIFICATION_KEYS.feed, {
      data: [row(1, CONV_A), row(2, CONV_B)],
      page: { nextCursor: null, hasMore: false, limit: 8 },
      meta: { unread: 2 },
    } satisfies NotificationListResponse);
    h.emit({ unread: 1, notificationIds: [id(1)] }, REALTIME_EVENT.notificationRead);
    const feed = h.qc.getQueryData(NOTIFICATION_KEYS.feed) as NotificationListResponse;
    expect(feed.data.map((n) => n.readAt !== null)).toEqual([true, false]);
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(1);

    h.emit({ unread: 0, notificationIds: 'all' }, REALTIME_EVENT.notificationRead);
    expect(
      (h.qc.getQueryData(NOTIFICATION_KEYS.feed) as NotificationListResponse).data.every(
        (n) => n.readAt !== null,
      ),
    ).toBe(true);
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(0);
  });
});

describe('inbox signals and resync', () => {
  it('invalidates the inbox counts once for a burst of inbox events', async () => {
    const h = await setup();
    const spy = vi.spyOn(h.qc, 'invalidateQueries');
    h.emit({ conversationId: CONV_A, unread: 1 }, REALTIME_EVENT.unread);
    h.emit(
      { conversationId: CONV_A, rowVersion: 2, changed: ['x'] },
      REALTIME_EVENT.conversationUpsert,
    );
    h.emit(
      { conversationId: CONV_A, assigneeUserId: null, assigneeTeamId: null },
      REALTIME_EVENT.assignment,
    );
    await settle();
    expect(
      spy.mock.calls.filter(
        ([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(INBOX_COUNTS_KEY),
      ),
    ).toHaveLength(1);
  });

  it('a reconnect, a gap or a return to the tab refetches the bell once', async () => {
    const h = await setup();
    const spy = vi.spyOn(h.qc, 'invalidateQueries');
    h.socket.serverEmit('rt.ready', {
      v: 1,
      rooms: [
        { room: 'org', seq: 0 },
        { room: 'user', seq: 0 },
      ],
      serverTime: new Date(0).toISOString(),
    });
    await settle();
    const keys = spy.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(keys.filter((k) => k === JSON.stringify(NOTIFICATION_KEYS.unread))).toHaveLength(1);
    expect(keys.filter((k) => k === JSON.stringify(NOTIFICATION_KEYS.feed))).toHaveLength(1);
  });

  it('stops listening after stop(): later events change nothing', async () => {
    const h = await setup();
    h.controller.stop();
    h.created(1, CONV_A);
    await settle();
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBeUndefined();
  });
});
