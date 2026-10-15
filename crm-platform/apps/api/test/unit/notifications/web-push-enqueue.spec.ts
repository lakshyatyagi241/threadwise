import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_PREF_TYPES,
  resolveNotificationChannels,
  updateNotificationPreferencesRequestSchema,
} from '@crm/contracts';
import { NotificationPublisher } from '../../../src/modules/notifications/notification.publisher';
import type { WrittenNotification } from '../../../src/modules/notifications/notifications.repository';
import { webPushConfig } from '../../../src/config/domains/web-push.env';
import { VisibilityPresence } from '../../../src/realtime/visibility-presence.service';
import { useVapidEnv } from '../../support/web-push-fakes';

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

function harness(opts: { queueFails?: boolean; withQueue?: boolean } = {}) {
  const added: Array<{ name: string; data: unknown; opts: Record<string, unknown> }> = [];
  const queue = {
    add: vi.fn(async (name: string, data: unknown, o: Record<string, unknown>) => {
      if (opts.queueFails) throw new Error('redis down');
      added.push({ name, data, opts: o });
    }),
  };
  const keys = new Map<string, string>();
  const publisher = new NotificationPublisher(
    { txAs: vi.fn(async (_t: unknown, fn: (tx: unknown) => unknown) => fn({})) } as never,
    { countUnread: vi.fn(async () => 1) } as never,
    { emitToUsers: vi.fn(async () => undefined) } as never,
    {
      set: vi.fn(async (key: string) => {
        if (keys.has(key)) return null;
        keys.set(key, '1');
        return 'OK';
      }),
    } as never,
    opts.withQueue === false ? undefined : (queue as never),
  );
  return { publisher, added, queue };
}

describe('queueing a browser push when a bell row is announced', () => {
  let restore: () => void;
  beforeAll(() => {
    restore = useVapidEnv();
  });
  afterAll(() => restore());

  it('queues one job of ids only for a chat message, keyed by the row so a redelivery is the same job', async () => {
    const { publisher, added } = harness();
    await publisher.created(4, row());
    expect(added).toHaveLength(1);
    expect(added[0]!.name).toBe('push');
    expect(added[0]!.data).toEqual({ orgId: 4, userId: 7, notificationUuid: UUID });
    expect(added[0]!.opts).toMatchObject({ jobId: `push-4-${UUID}`, attempts: 4 });
    // Ids only: no title, body, endpoint or key travels through Redis.
    expect(Object.keys(added[0]!.data as object).sort()).toEqual([
      'notificationUuid',
      'orgId',
      'userId',
    ]);
  });

  it('follows the person own choice resolved when the row was written', async () => {
    const off = harness();
    await off.publisher.created(4, row({ push: false }));
    expect(off.added).toHaveLength(0);
    const on = harness();
    await on.publisher.created(4, row({ type: 'task_due', push: true }));
    expect(on.added).toHaveLength(1);
  });

  it('falls back to the catalogue default of the type when the row carries no choice', async () => {
    const quiet = harness();
    await quiet.publisher.created(
      4,
      row({ type: 'wallet_credited', subjectKind: null, subjectUuid: null }),
    );
    expect(quiet.added).toHaveLength(0);
    const chat = harness();
    await chat.publisher.created(4, row({ type: 'mention' }));
    expect(chat.added).toHaveLength(1);
    const unknownType = harness();
    await unknownType.publisher.created(4, row({ type: 'some_future_type' }));
    expect(unknownType.added).toHaveLength(0);
  });

  it('sends no push for a silent row, nor for the second message of a burst inside the throttle window', async () => {
    const h = harness();
    await h.publisher.created(4, row(), { silent: true });
    expect(h.added).toHaveLength(0);
    await h.publisher.created(4, row({ uuid: 'a' }), { throttleKey: CONV });
    await h.publisher.created(4, row({ uuid: 'b', collapsed: true }), { throttleKey: CONV });
    expect(h.added.map((a) => (a.data as { notificationUuid: string }).notificationUuid)).toEqual([
      'a',
    ]);
  });

  it('never fails the producer when the queue is down', async () => {
    const h = harness({ queueFails: true });
    await expect(h.publisher.created(4, row())).resolves.toBeUndefined();
    expect(h.queue.add).toHaveBeenCalled();
  });

  it('works with no queue at all (a unit test, an older wiring)', async () => {
    const h = harness({ withQueue: false });
    await expect(h.publisher.created(4, row())).resolves.toBeUndefined();
  });

  it('queues nothing, and does not even look at the queue, when the deployment has no VAPID keys', async () => {
    const keep = { ...process.env };
    delete process.env.VAPID_PUBLIC_KEY;
    try {
      const h = harness();
      await h.publisher.created(4, row());
      expect(h.queue.add).not.toHaveBeenCalled();
    } finally {
      Object.assign(process.env, keep);
    }
  });
});

describe('the Web Push settings', () => {
  const env = (over: Record<string, string>) => ({ ...over }) as NodeJS.ProcessEnv;
  const good = () => {
    const restore = useVapidEnv();
    const e = {
      VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
      VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    } as Record<string, string>;
    restore();
    return e;
  };

  it('is on only with a well-formed public key, private key and contact', () => {
    expect(webPushConfig(env(good())).enabled).toBe(true);
    expect(webPushConfig(env({})).enabled).toBe(false);
    for (const k of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
      const e = good();
      e[k] = '';
      expect(webPushConfig(env(e)).enabled, k).toBe(false);
    }
    expect(webPushConfig(env({ ...good(), VAPID_PUBLIC_KEY: 'not-a-key' })).enabled).toBe(false);
    expect(webPushConfig(env({ ...good(), VAPID_SUBJECT: 'ops' })).enabled).toBe(false);
    expect(webPushConfig(env({ ...good(), VAPID_SUBJECT: 'https://example.test/c' })).enabled).toBe(
      true,
    );
  });

  it('keeps the offline time to a sane range', () => {
    expect(webPushConfig(env({ ...good(), WEB_PUSH_TTL_SECONDS: '30' })).ttlSeconds).toBe(14_400);
    expect(webPushConfig(env({ ...good(), WEB_PUSH_TTL_SECONDS: '600' })).ttlSeconds).toBe(600);
    expect(webPushConfig(env(good())).ttlSeconds).toBe(14_400);
  });
});

describe('the push preference', () => {
  const ON = [
    'new_chat',
    'new_message',
    'chat_waiting',
    'conversation_assigned',
    'mention',
    'task_assigned',
    'teamchat_mention',
    'teamchat_message',
    // A failed subscription payment needs action, so it is the one billing event that also reaches devices.
    'billing_payment_failed',
    // BL-112: a chat nobody could take because the people it wanted are on leave; the push stays on because a customer is waiting.
    'assignment_blocked_by_leave',
  ];

  it('is on by default only for chat events, assignments, mentions and failed payments, and off for everything noisy', () => {
    for (const type of NOTIFICATION_PREF_TYPES) {
      expect(NOTIFICATION_CATALOG[type].push, type).toBe(ON.includes(type));
    }
  });

  it('resolves the person own choice first, then the default', () => {
    expect(resolveNotificationChannels('new_message', null).push).toBe(true);
    expect(resolveNotificationChannels('wallet_credited', null).push).toBe(false);
    expect(
      resolveNotificationChannels('new_message', {
        bell: null,
        toast: null,
        sound: null,
        push: false,
      }).push,
    ).toBe(false);
    expect(
      resolveNotificationChannels('wallet_credited', {
        bell: null,
        toast: null,
        sound: null,
        push: true,
      }).push,
    ).toBe(true);
    // A workspace that turned the event off does not turn the person own push off.
    expect(
      resolveNotificationChannels(
        'new_message',
        { bell: true, toast: null, sound: null, push: null },
        false,
      ).push,
    ).toBe(true);
  });

  it('accepts push in the update request, true, false or null', () => {
    for (const push of [true, false, null]) {
      expect(
        updateNotificationPreferencesRequestSchema.safeParse({ items: [{ type: 'mention', push }] })
          .success,
      ).toBe(true);
    }
    expect(
      updateNotificationPreferencesRequestSchema.safeParse({
        items: [{ type: 'mention', push: 'yes' }],
      }).success,
    ).toBe(false);
  });
});

describe('tab visibility presence', () => {
  /** An in-memory stand-in for the few sorted-set commands the service uses. */
  class FakeZRedis {
    sets = new Map<string, Map<string, number>>();
    down = false;
    multi() {
      const steps: Array<() => unknown> = [];
      const chain = {
        zadd: (key: string, score: number, member: string) => {
          steps.push(() => {
            const set = this.sets.get(key) ?? new Map<string, number>();
            set.set(member, score);
            this.sets.set(key, set);
            return 1;
          });
          return chain;
        },
        expire: () => chain,
        zremrangebyscore: (key: string, _min: string, max: number) => {
          steps.push(() => {
            for (const [m, sc] of this.sets.get(key) ?? [])
              if (sc <= max) this.sets.get(key)!.delete(m);
            return 0;
          });
          return chain;
        },
        zcard: (key: string) => {
          steps.push(() => this.sets.get(key)?.size ?? 0);
          return chain;
        },
        exec: async () => {
          if (this.down) throw new Error('redis down');
          return steps.map((step) => [null, step()]);
        },
      };
      return chain;
    }
    async zrem(key: string, member: string) {
      if (this.down) throw new Error('redis down');
      this.sets.get(key)?.delete(member);
    }
  }

  afterEach(() => vi.useRealTimers());

  it('sees a tab that reported visible, and stops seeing it when it hides or closes', async () => {
    const redis = new FakeZRedis();
    const presence = new VisibilityPresence(redis as never);
    expect(await presence.isVisible(4, 7)).toBe(false);
    await presence.report(4, 7, 's1', true);
    expect(await presence.isVisible(4, 7)).toBe(true);
    // Another person, another workspace: not affected.
    expect(await presence.isVisible(4, 8)).toBe(false);
    expect(await presence.isVisible(5, 7)).toBe(false);
    await presence.report(4, 7, 's1', false);
    expect(await presence.isVisible(4, 7)).toBe(false);
    await presence.report(4, 7, 's2', true);
    await presence.clear(4, 7, 's2');
    expect(await presence.isVisible(4, 7)).toBe(false);
  });

  it('forgets a tab that stops reporting after 35 seconds (a frozen or crashed tab)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    const presence = new VisibilityPresence(new FakeZRedis() as never);
    await presence.report(4, 7, 's1', true);
    vi.setSystemTime(new Date('2026-10-07T10:00:30Z'));
    expect(await presence.isVisible(4, 7)).toBe(true);
    vi.setSystemTime(new Date('2026-10-07T10:00:36Z'));
    expect(await presence.isVisible(4, 7)).toBe(false);
  });

  it('keeps one tab visible while another hides', async () => {
    const presence = new VisibilityPresence(new FakeZRedis() as never);
    await presence.report(4, 7, 's1', true);
    await presence.report(4, 7, 's2', true);
    await presence.report(4, 7, 's1', false);
    expect(await presence.isVisible(4, 7)).toBe(true);
  });

  it('never claims a visible tab, and never throws, when Redis is down: a push is not lost to a hiccup', async () => {
    const redis = new FakeZRedis();
    redis.down = true;
    const presence = new VisibilityPresence(redis as never);
    expect(await presence.isVisible(4, 7)).toBe(false);
    await expect(presence.report(4, 7, 's1', true)).resolves.toBeUndefined();
    await expect(presence.report(4, 7, 's1', false)).resolves.toBeUndefined();
    await expect(presence.clear(4, 7, 's1')).resolves.toBeUndefined();
  });
});
