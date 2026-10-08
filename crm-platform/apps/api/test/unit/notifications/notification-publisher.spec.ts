import { describe, expect, it, vi } from 'vitest';
import { REALTIME_EVENT, realtimeEventSchemas } from '@crm/contracts';
import { ConversationReadState } from '../../../src/modules/notifications/conversation-read-state';
import { NotificationPublisher } from '../../../src/modules/notifications/notification.publisher';
import type { WrittenNotification } from '../../../src/modules/notifications/notifications.repository';
import { NotificationPrefsResolver } from '../../../src/modules/notifications/notification-prefs.resolver';
import { notifyConfig } from '../../../src/config/domains/notifications.env';
import { toNotificationResponse } from '../../../src/modules/notifications/notifications.mapper';
import type { NotificationRow } from '../../../src/modules/notifications/notifications.repository';

const UUID = '11111111-1111-4111-8111-111111111111';
const CONV = '22222222-2222-4222-8222-222222222222';
const row = (over: Partial<WrittenNotification> = {}): WrittenNotification => ({
  id: 1,
  uuid: UUID,
  userId: 7,
  type: 'new_message',
  subjectKind: 'conversation',
  subjectUuid: CONV,
  collapsed: false,
  ...over,
});

/** A publisher over fakes: the database answers a fixed unread total, Redis keeps SET NX in a map. */
function harness(opts: { unread?: number; redisFails?: boolean; emitFails?: boolean } = {}) {
  const emitted: Array<{ orgId: number; users: number[]; type: string; payload: unknown }> = [];
  const keys = new Map<string, string>();
  const db = { txAs: vi.fn(async (_t: unknown, fn: (tx: unknown) => unknown) => fn({})) };
  const repo = { countUnread: vi.fn(async () => opts.unread ?? 3) };
  const emitter = {
    emitToUsers: vi.fn(async (orgId: number, users: number[], type: string, payload: unknown) => {
      if (opts.emitFails) throw new Error('redis down');
      emitted.push({ orgId, users: [...users], type, payload });
    }),
  };
  const redis = {
    set: vi.fn(async (key: string) => {
      if (opts.redisFails) throw new Error('redis down');
      if (keys.has(key)) return null;
      keys.set(key, '1');
      return 'OK';
    }),
  };
  const publisher = new NotificationPublisher(
    db as never,
    repo as never,
    emitter as never,
    redis as never,
  );
  return { publisher, emitted, redis, repo };
}

describe('NotificationPublisher', () => {
  it('announces a new row to that person only, with the true unread total and no text', async () => {
    const { publisher, emitted } = harness({ unread: 5 });
    await publisher.created(4, row());
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      orgId: 4,
      users: [7],
      type: REALTIME_EVENT.notificationCreated,
    });
    const payload = realtimeEventSchemas[REALTIME_EVENT.notificationCreated].parse(
      emitted[0]!.payload,
    );
    expect(payload).toEqual({
      notificationId: UUID,
      type: 'new_message',
      unread: 5,
      subjectKind: 'conversation',
      subjectId: CONV,
      collapsed: false,
      silent: false,
      // Phase 2: the person's own toast and ping choice (a chat type defaults to both on).
      toast: true,
      sound: true,
    });
    expect(Object.keys(payload).sort()).toEqual(
      [
        'collapsed',
        'notificationId',
        'silent',
        'sound',
        'subjectId',
        'subjectKind',
        'toast',
        'type',
        'unread',
      ].sort(),
    );
  });

  it('a burst in one chat pings once: the next push inside the window is silent, another chat is not', async () => {
    const { publisher, emitted } = harness();
    await publisher.created(4, row(), { throttleKey: CONV });
    await publisher.created(4, row({ collapsed: true }), { throttleKey: CONV });
    await publisher.created(4, row(), { throttleKey: 'another-chat' });
    const silent = emitted.map((e) => (e.payload as { silent: boolean }).silent);
    expect(silent).toEqual([false, true, false]);
  });

  it('a different person has their own window', async () => {
    const { publisher, emitted } = harness();
    await publisher.created(4, row({ userId: 7 }), { throttleKey: CONV });
    await publisher.created(4, row({ userId: 8 }), { throttleKey: CONV });
    expect(emitted.map((e) => (e.payload as { silent: boolean }).silent)).toEqual([false, false]);
    expect(emitted.map((e) => e.users[0])).toEqual([7, 8]);
  });

  it('silent stays silent, whatever the window says', async () => {
    const { publisher, emitted } = harness();
    await publisher.created(4, row(), { silent: true });
    expect((emitted[0]!.payload as { silent: boolean }).silent).toBe(true);
  });

  it('a Redis failure never loses a ping and never throws', async () => {
    const { publisher, emitted } = harness({ redisFails: true });
    await expect(publisher.created(4, row(), { throttleKey: CONV })).resolves.toBeUndefined();
    expect((emitted[0]!.payload as { silent: boolean }).silent).toBe(false);
  });

  it('never throws when the emit itself fails', async () => {
    const { publisher } = harness({ emitFails: true });
    await expect(publisher.created(4, row())).resolves.toBeUndefined();
    await expect(publisher.read(4, 7, 'all')).resolves.toBeUndefined();
  });

  it('read tells the person their other tabs should clear, with the new total', async () => {
    const { publisher, emitted } = harness({ unread: 0 });
    await publisher.read(4, 7, [UUID]);
    await publisher.read(4, 7, 'all');
    expect(emitted.map((e) => e.type)).toEqual([
      REALTIME_EVENT.notificationRead,
      REALTIME_EVENT.notificationRead,
    ]);
    for (const e of emitted) {
      expect(e.users).toEqual([7]);
      realtimeEventSchemas[REALTIME_EVENT.notificationRead].parse(e.payload);
    }
    expect(emitted[1]!.payload).toEqual({ unread: 0, notificationIds: 'all' });
  });
});

describe('ConversationReadState', () => {
  function fake() {
    const store = new Map<string, string>();
    const redis = {
      set: vi.fn(async (k: string, v: string) => void store.set(k, v)),
      mget: vi.fn(async (keys: string[]) => keys.map((k) => store.get(k) ?? null)),
    };
    return { state: new ConversationReadState(redis as never), store, redis };
  }

  it('someone who marked the thread read after the message arrived is looking at it', async () => {
    const { state } = fake();
    await state.markSeen(1, 7, CONV);
    const arrived = Date.now() - 500;
    expect([...(await state.seenSince(1, [7, 8], CONV, arrived))]).toEqual([7]);
  });

  it('a read from long before the message does not count', async () => {
    const { state, store } = fake();
    store.set(`rt:nc:seen:1:7:${CONV}`, String(Date.now() - 20_000));
    expect((await state.seenSince(1, [7], CONV, Date.now())).size).toBe(0);
  });

  it('another workspace or another chat never matches', async () => {
    const { state } = fake();
    await state.markSeen(1, 7, CONV);
    expect((await state.seenSince(2, [7], CONV, 0)).size).toBe(0);
    expect((await state.seenSince(1, [7], 'other', 0)).size).toBe(0);
  });

  it('a Redis failure answers "not looking": the person is notified', async () => {
    const state = new ConversationReadState({
      set: async () => {
        throw new Error('down');
      },
      mget: async () => {
        throw new Error('down');
      },
    } as never);
    await expect(state.markSeen(1, 7, CONV)).resolves.toBeUndefined();
    expect((await state.seenSince(1, [7], CONV, 0)).size).toBe(0);
  });
});

describe('NotificationPrefsResolver (decision D3)', () => {
  const resolver = (prefs: unknown) => {
    const db = {
      txAs: vi.fn(async () => ({ rows: [{ prefs }] })),
    };
    const r = new NotificationPrefsResolver(db as never);
    return { r, db };
  };

  it('with nothing saved, the defaults apply: the four conversation types are on', async () => {
    const { r } = resolver(null);
    for (const type of ['new_chat', 'new_message', 'conversation_assigned', 'mention'] as const) {
      expect(await r.inappAllowed(1, type)).toBe(true);
    }
  });

  it('turning the in-app toggle off stops exactly the types it governs', async () => {
    const off = { inapp: false, email: false, slack: false };
    const { r } = resolver({
      events: { new_customer_reply: off, mention_in_inbox: { ...off, inapp: true } },
      categories: {},
    });
    expect(await r.inappAllowed(1, 'new_chat')).toBe(false);
    expect(await r.inappAllowed(1, 'new_message')).toBe(false);
    expect(await r.inappAllowed(1, 'mention')).toBe(true);
    expect(await r.inappAllowed(1, 'conversation_assigned')).toBe(true);
  });

  it('never gates a type no toggle governs (tasks, leads, wallet keep working)', async () => {
    const off = { inapp: false, email: false, slack: false };
    const { r, db } = resolver({ events: { new_customer_reply: off }, categories: {} });
    expect(await r.inappAllowed(1, 'task_assigned')).toBe(true);
    expect(await r.inappAllowed(1, 'new_lead')).toBe(true);
    expect(db.txAs).not.toHaveBeenCalled();
  });

  it('reads once per window per workspace', async () => {
    const { r, db } = resolver(null);
    await r.inappAllowed(1, 'new_chat');
    await r.inappAllowed(1, 'mention');
    expect(db.txAs).toHaveBeenCalledTimes(1);
    await r.inappAllowed(2, 'mention');
    expect(db.txAs).toHaveBeenCalledTimes(2);
  });
});

describe('notifyConfig', () => {
  it('is on outside production and off in production until the operator turns it on', () => {
    expect(notifyConfig({ NODE_ENV: 'development' }).conversationsEnabled).toBe(true);
    expect(notifyConfig({ NODE_ENV: 'test' }).conversationsEnabled).toBe(true);
    expect(notifyConfig({ NODE_ENV: 'production' }).conversationsEnabled).toBe(false);
    expect(
      notifyConfig({ NODE_ENV: 'production', NOTIFY_CONVERSATIONS_ENABLED: 'true' })
        .conversationsEnabled,
    ).toBe(true);
    expect(
      notifyConfig({ NODE_ENV: 'development', NOTIFY_CONVERSATIONS_ENABLED: 'false' })
        .conversationsEnabled,
    ).toBe(false);
  });

  it('caps recipients at 50 and throttles at 5 seconds by default', () => {
    expect(notifyConfig({})).toMatchObject({ maxRecipients: 50, throttleSeconds: 5 });
    expect(notifyConfig({ NOTIFY_MAX_RECIPIENTS: '10' }).maxRecipients).toBe(10);
  });
});

describe('the bell row as the API shows it', () => {
  const base: NotificationRow = {
    id: 1,
    uuid: UUID,
    type: 'task_due',
    title: 't',
    body: null,
    link: null,
    data: null,
    readAt: null,
    createdAt: new Date('2026-10-07T10:00:00Z'),
    collapseKey: null,
    eventCount: 1,
    subjectKind: null,
    subjectUuid: null,
  };

  it('an old-style row keeps exactly the shape it always had', () => {
    expect(Object.keys(toNotificationResponse(base)).sort()).toEqual(
      ['body', 'createdAt', 'data', 'id', 'link', 'readAt', 'title', 'type'].sort(),
    );
  });

  it('a collapsing row carries its count and its subject', () => {
    const r = toNotificationResponse({
      ...base,
      type: 'new_message',
      collapseKey: `msg:${CONV}`,
      eventCount: 4,
      subjectKind: 'conversation',
      subjectUuid: CONV,
    });
    expect(r).toMatchObject({ count: 4, subject: { kind: 'conversation', id: CONV } });
  });
});
