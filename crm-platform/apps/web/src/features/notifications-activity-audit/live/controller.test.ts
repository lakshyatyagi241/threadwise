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
import { stateFromResponse, type PrefEntry } from '../prefs/model';
import { FLUSH_MS, TOAST_PER_SUBJECT_MS, TOAST_WINDOW_MAX } from './model';
import { FEED_RETRY_MS } from './controller';

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
  /** How many of the next list calls fail. */
  failLists: number;
  /** Makes the tab visible and tells the controller, as the browser's visibilitychange does. */
  becomeVisible(): void;
  visibleListeners: Array<() => void>;
  readSubjects: string[];
  visible: boolean;
  location: { pathname: string; search: string };
  sound: boolean;
  desktopOn: boolean;
  claimResult: boolean;
  prefs: readonly PrefEntry[] | undefined;
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
    failLists: 0,
    visibleListeners: [] as Array<() => void>,
    readSubjects: [] as string[],
    visible: true,
    location: { pathname: '/dashboard', search: '' },
    sound: true,
    desktopOn: false,
    claimResult: true,
    prefs: undefined,
    seq: 0,
    client,
  } as unknown as Harness;

  const api: LiveApi = {
    list: async () => {
      h.listCalls += 1;
      if (h.failLists > 0) {
        h.failLists -= 1;
        throw new Error('network');
      }
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
    prefs: () => h.prefs,
    settings: { soundOn: () => h.sound, desktopOn: () => h.desktopOn },
    claimer: { claim: async () => h.claimResult },
    env: {
      isVisible: () => h.visible,
      onVisible: (listener) => {
        h.visibleListeners.push(listener);
        return () => undefined;
      },
      location: () => h.location,
      now: () => Date.now(),
    },
  });
  h.becomeVisible = () => {
    h.visible = true;
    for (const l of h.visibleListeners) l();
  };
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

  it('does not toast or ping for a type whose default is quiet (task completed still moves the badge)', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A, { type: 'task_completed' })];
    h.created(1, CONV_A, { type: 'task_completed', subjectKind: null, subjectId: null });
    await settle();
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(1);
    expect(h.presented).toEqual([]);
    expect(h.pings).toBe(0);
  });

  it('toasts a task due without a ping (the catalogue: toast yes, sound no)', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A, { type: 'task_due', link: '/tasks' })];
    h.created(1, CONV_A, { type: 'task_due', subjectKind: null, subjectId: null });
    await settle();
    expect(h.presented).toHaveLength(1);
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

  it('survives a failing list call: it never throws, and still tells the person (see the resilient toast tests)', async () => {
    const h = await setup();
    h.failLists = 10;
    h.created(1, CONV_A);
    await settle(FLUSH_MS + FEED_RETRY_MS);
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(1);
    expect(h.presented).toEqual([{ kind: 'generic', count: 1 }]);
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

// --- phase 2: devices, sends, team chat, and the person's own choices -------------------------------------------------------

const DEVICE = 'dddddddd-dddd-4ddd-8ddd-dddddddd0001';
const CHANNEL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001';
const SEND = 'ffffffff-ffff-4fff-8fff-ffffffff0001';

const deviceRow = (n: number, type = 'device_disconnected'): NotificationResponse =>
  row(n, DEVICE, {
    type,
    link: null,
    data: { deviceId: DEVICE, deviceName: 'Sales' },
    subject: { kind: 'device', id: DEVICE },
  });

describe('phase 2 types', () => {
  it('toasts a disconnected number in the danger tone, opening the device, with no ping', async () => {
    const h = await setup();
    h.rows = [deviceRow(1)];
    h.created(1, DEVICE, { type: 'device_disconnected', subjectKind: 'device' });
    await settle();
    expect(h.presented).toHaveLength(1);
    expect(h.presented[0]).toMatchObject({
      kind: 'alert',
      alert: { type: 'device_disconnected', href: `/devices/${DEVICE}`, sound: false },
    });
    expect(h.pings).toBe(0);
    expect(h.announces).toEqual([1]);
  });

  it('opens a failed broadcast at its detail page', async () => {
    const h = await setup();
    h.rows = [
      row(1, SEND, {
        type: 'broadcast_failed',
        link: null,
        data: { kind: 'broadcast', id: SEND, name: 'Spring', status: 'failed' },
        subject: { kind: 'broadcast', id: SEND },
      }),
    ];
    h.created(1, SEND, { type: 'broadcast_failed', subjectKind: 'broadcast' });
    await settle();
    expect(h.presented[0]).toMatchObject({ alert: { href: `/campaigns/earlier/${SEND}` } });
  });

  it('toasts and pings a team chat message, opening that channel', async () => {
    const h = await setup();
    h.rows = [
      row(1, CHANNEL, {
        type: 'teamchat_message',
        link: null,
        data: { channelId: CHANNEL, authorName: 'Sam', direct: true },
        subject: { kind: 'team_chat_channel', id: CHANNEL },
      }),
    ];
    h.created(1, CHANNEL, { type: 'teamchat_message', subjectKind: 'team_chat_channel' });
    await settle();
    expect(h.presented[0]).toMatchObject({ alert: { href: `/team-chat?c=${CHANNEL}` } });
    expect(h.pings).toBe(1);
  });

  it('shows a desktop alert for a disconnect when the tab is hidden and the person allows it', async () => {
    const h = await setup();
    h.visible = false;
    h.desktopOn = true;
    h.rows = [deviceRow(1)];
    h.created(1, DEVICE, { type: 'device_disconnected', subjectKind: 'device' });
    await settle();
    expect(h.desktops).toEqual([id(1)]);
    expect(h.presented).toEqual([]);
  });
});

describe('the persons own choices', () => {
  type Choice = { bell: boolean | null; toast: boolean | null; sound: boolean | null };
  const prefs = (over: Record<string, Partial<Choice>> = {}): PrefEntry[] =>
    stateFromResponse({
      items: ['new_message', 'device_disconnected'].map((type) => {
        const o: Choice = { bell: null, toast: null, sound: null, ...over[type] };
        const base = { bell: true, toast: true, sound: type === 'new_message' };
        return {
          type,
          group: type === 'new_message' ? 'conversations' : 'devices',
          bell: o.bell ?? base.bell,
          toast: o.toast ?? base.toast,
          sound: o.sound ?? base.sound,
          defaults: base,
          overrides: o,
          workspaceInapp: true,
        } as never;
      }),
    }).entries;

  it('the event flag toast:false keeps the bell right but shows no toast', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A, { toast: false });
    await settle();
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(1);
    expect(h.presented).toEqual([]);
    expect(h.pings).toBe(0);
  });

  it('the event flag sound:false toasts without the ping', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A, { toast: true, sound: false });
    await settle();
    expect(h.presented).toHaveLength(1);
    expect(h.pings).toBe(0);
  });

  it('a silent event never toasts or pings, whatever its flags say', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A, { silent: true, toast: true, sound: true });
    await settle();
    expect(h.presented).toEqual([]);
    expect(h.pings).toBe(0);
  });

  it('without flags (an older server) the loaded preferences decide: pop-up off', async () => {
    const h = await setup();
    h.prefs = prefs({ new_message: { toast: false } });
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A);
    await settle();
    expect(h.presented).toEqual([]);
    expect(h.pings).toBe(0);
  });

  it('without flags: sound off toasts quietly', async () => {
    const h = await setup();
    h.prefs = prefs({ new_message: { sound: false } });
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A);
    await settle();
    expect(h.presented).toHaveLength(1);
    expect(h.pings).toBe(0);
  });

  it('the bell off silences the pop-up and ping as well', async () => {
    const h = await setup();
    h.prefs = prefs({ new_message: { bell: false } });
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A);
    await settle();
    expect(h.presented).toEqual([]);
    expect(h.pings).toBe(0);
  });

  it('the server flag wins over a stale local list', async () => {
    const h = await setup();
    h.prefs = prefs({ new_message: { toast: false } });
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A, { toast: true, sound: true });
    await settle();
    expect(h.presented).toHaveLength(1);
    expect(h.pings).toBe(1);
  });

  it('a choice saved after the controller started applies to the next event', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A);
    await settle();
    expect(h.presented).toHaveLength(1);
    h.prefs = prefs({ new_message: { toast: false } });
    await vi.advanceTimersByTimeAsync(TOAST_PER_SUBJECT_MS + 10);
    h.rows = [row(2, CONV_A)];
    h.created(2, CONV_A);
    await settle();
    expect(h.presented).toHaveLength(1);
  });
});

describe('a toast is never dropped silently', () => {
  it('retries a failed fetch once and shows the real toast when the second try works', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A)];
    h.failLists = 1;
    h.created(1, CONV_A);
    await settle();
    expect(h.presented).toEqual([]); // waiting for the retry
    await settle(FEED_RETRY_MS);
    expect(h.listCalls).toBe(2);
    expect(h.presented).toHaveLength(1);
    expect(h.presented[0]).toMatchObject({ kind: 'alert', alert: { row: { id: id(1) } } });
  });

  it('shows the generic toast when both tries fail, and pings once', async () => {
    const h = await setup();
    h.failLists = 2;
    h.created(1, CONV_A);
    await settle(FLUSH_MS + FEED_RETRY_MS);
    expect(h.listCalls).toBe(2);
    expect(h.presented).toEqual([{ kind: 'generic', count: 1 }]);
    expect(h.pings).toBe(1);
    expect(h.announces).toEqual([]);
  });

  it('shows the generic toast when the row is not among the newest rows', async () => {
    const h = await setup();
    h.rows = [row(50, CONV_B), row(49, CONV_C)]; // the new row (1) was pushed out, or never listed
    h.created(1, CONV_A);
    await settle();
    expect(h.presented).toEqual([{ kind: 'generic', count: 1 }]);
  });

  it('counts several rows that could not be found in one generic toast', async () => {
    const h = await setup();
    h.rows = [row(50, CONV_D)];
    h.created(1, CONV_A);
    h.created(2, CONV_B);
    await settle();
    expect(h.presented).toEqual([{ kind: 'generic', count: 2 }]);
  });

  it('says nothing when the badge is back at zero (it was read somewhere else meanwhile)', async () => {
    const h = await setup();
    h.failLists = 2;
    h.created(1, CONV_A);
    await settle();
    h.emit({ unread: 0, notificationIds: 'all' }, REALTIME_EVENT.notificationRead);
    await settle(FEED_RETRY_MS);
    expect(h.presented).toEqual([]);
  });

  it('shows nothing for a silent event, whatever the fetch does', async () => {
    const h = await setup();
    h.failLists = 5;
    h.created(1, CONV_A, { silent: true });
    await settle(FLUSH_MS + FEED_RETRY_MS);
    expect(h.presented).toEqual([]);
    expect(h.listCalls).toBe(0);
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(1);
  });

  it('shows nothing when the event says toast:false', async () => {
    const h = await setup();
    h.failLists = 5;
    h.created(1, CONV_A, { toast: false });
    await settle(FLUSH_MS + FEED_RETRY_MS);
    expect(h.presented).toEqual([]);
  });

  it('shows nothing when the person is looking at that conversation, even if the fetch fails', async () => {
    const h = await setup();
    h.location = { pathname: '/inbox', search: `?c=${CONV_A}` };
    h.failLists = 5;
    h.created(1, CONV_A);
    await settle(FLUSH_MS + FEED_RETRY_MS);
    expect(h.presented).toEqual([]);
  });

  it('shows nothing when they open that conversation while the retry waits', async () => {
    const h = await setup();
    h.failLists = 2;
    h.created(1, CONV_A);
    await settle();
    h.location = { pathname: '/inbox', search: `?c=${CONV_A}` };
    await settle(FEED_RETRY_MS);
    expect(h.presented).toEqual([]);
  });

  it('skips a row that was read elsewhere (found, with a read time): nothing is left to tell', async () => {
    const h = await setup();
    h.rows = [row(1, CONV_A, { readAt: '2026-10-07T10:00:01.000Z' })];
    h.created(1, CONV_A);
    await settle();
    expect(h.presented).toEqual([]);
  });

  it('paces the generic toast like one conversation: one now, the rest merged into one later', async () => {
    const h = await setup();
    h.rows = [];
    const convs = [CONV_A, CONV_B, CONV_C, CONV_D];
    for (let i = 0; i < 4; i++) {
      h.created(i + 1, convs[i]!);
      await settle();
    }
    expect(h.presented).toEqual([{ kind: 'generic', count: 1 }]);
    await settle(TOAST_PER_SUBJECT_MS);
    expect(h.presented).toEqual([
      { kind: 'generic', count: 1 },
      { kind: 'generic', count: 3 },
    ]);
  });
});

describe('a hidden tab', () => {
  it('shows the title only (no toast) while hidden, then the toast when the tab comes back and the row is still unread', async () => {
    const h = await setup();
    h.visible = false;
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A);
    await settle();
    expect(h.presented).toEqual([]);
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(1);

    h.becomeVisible();
    expect(h.presented).toHaveLength(1);
    expect(h.presented[0]).toMatchObject({ kind: 'alert', alert: { row: { id: id(1) } } });
    expect(h.announces).toEqual([1]);
  });

  it('does not show the toast later when everything was read in the meantime', async () => {
    const h = await setup();
    h.visible = false;
    h.rows = [row(1, CONV_A)];
    h.created(1, CONV_A);
    await settle();
    h.emit({ unread: 0, notificationIds: [id(1)] }, REALTIME_EVENT.notificationRead);
    h.becomeVisible();
    expect(h.presented).toEqual([]);
  });

  it('folds many missed notifications into one summary when the tab comes back', async () => {
    const h = await setup();
    h.visible = false;
    h.rows = [row(1, CONV_A), row(2, CONV_B), row(3, CONV_C)];
    h.created(1, CONV_A);
    h.created(2, CONV_B);
    h.created(3, CONV_C);
    await settle();
    h.becomeVisible();
    expect(h.presented).toEqual([{ kind: 'generic', count: 3 }]);
  });

  it('a missed notification whose row could not be fetched comes back as the generic toast', async () => {
    const h = await setup();
    h.visible = false;
    h.failLists = 5;
    h.created(1, CONV_A);
    await settle(FLUSH_MS + FEED_RETRY_MS);
    expect(h.presented).toEqual([]);
    h.becomeVisible();
    expect(h.presented).toEqual([{ kind: 'generic', count: 1 }]);
  });

  it('shows nothing extra when the tab becomes visible with nothing missed', async () => {
    const h = await setup();
    h.becomeVisible();
    expect(h.presented).toEqual([]);
  });
});

describe('repeated and newer events', () => {
  const envelope = (eventId: string, seq: number, payload: Record<string, unknown>) => ({
    v: 1,
    id: eventId,
    at: new Date(0).toISOString(),
    type: REALTIME_EVENT.notificationCreated,
    room: 'user',
    seq,
    payload,
  });
  const payload = (n: number, unread: number) => ({
    notificationId: id(n),
    type: 'new_message',
    unread,
    subjectKind: 'conversation',
    subjectId: CONV_A,
    collapsed: false,
    silent: false,
  });

  it('a repeat of one event id changes nothing, and a newer event with its own id still moves the badge', async () => {
    const h = await setup();
    h.rows = [row(2, CONV_A, { count: 2 })];
    const first = envelope('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 1, payload(1, 1));
    const second = envelope('ffffffff-ffff-4fff-8fff-ffffffffffff', 2, payload(2, 2));
    h.socket.serverEmit(first.type, first);
    h.socket.serverEmit(first.type, first);
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(1);
    h.socket.serverEmit(second.type, second);
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(2);
    h.socket.serverEmit(first.type, first); // a late repeat of the older one must not pull the badge back
    expect(h.qc.getQueryData(NOTIFICATION_KEYS.unread)).toBe(2);
    await settle();
    expect(h.presented).toHaveLength(1);
  });
});
