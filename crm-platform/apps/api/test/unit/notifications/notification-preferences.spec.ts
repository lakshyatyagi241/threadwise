import { describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_GROUPS,
  NOTIFICATION_LEGACY_TYPES,
  NOTIFICATION_PREF_TYPES,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_PLAN_FEATURE,
  NOTIFICATION_TYPE_PREF_KEY,
  NOTIFICATION_EVENT_KEYS,
  realtimeEventSchemas,
  REALTIME_EVENT,
  resolveNotificationChannels,
  updateNotificationPreferencesRequestSchema,
} from '@crm/contracts';
import { NotificationFanout } from '../../../src/modules/notifications/notification-fanout';
import { NotificationPreferencesService } from '../../../src/modules/notifications/notification-preferences.service';
import { NotificationPublisher } from '../../../src/modules/notifications/notification.publisher';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository';
import { RequestContextStore } from '../../../src/common/context/request-context';

describe('the catalogue', () => {
  it('has an entry for every type a person can tune, and every group is used', () => {
    for (const type of NOTIFICATION_PREF_TYPES) {
      expect(NOTIFICATION_CATALOG[type], type).toBeDefined();
      expect(NOTIFICATION_GROUPS).toContain(NOTIFICATION_CATALOG[type].group);
    }
    expect(Object.keys(NOTIFICATION_CATALOG).sort()).toEqual([...NOTIFICATION_PREF_TYPES].sort());
    for (const g of NOTIFICATION_GROUPS) {
      expect(
        NOTIFICATION_PREF_TYPES.some((t) => NOTIFICATION_CATALOG[t].group === g),
        g,
      ).toBe(true);
    }
  });

  it('keeps legacy types out of the enum the web words and in the tunable list', () => {
    for (const t of NOTIFICATION_LEGACY_TYPES) {
      expect(NOTIFICATION_TYPES as readonly string[]).not.toContain(t);
      expect(NOTIFICATION_PREF_TYPES as readonly string[]).toContain(t);
    }
  });

  it('maps only to the 18 owner events and only for tunable types', () => {
    for (const [type, key] of Object.entries(NOTIFICATION_TYPE_PREF_KEY)) {
      expect(NOTIFICATION_PREF_TYPES as readonly string[], type).toContain(type);
      expect(NOTIFICATION_EVENT_KEYS as readonly string[], key).toContain(key);
    }
    // The spec's phase 2 mapping.
    expect(NOTIFICATION_TYPE_PREF_KEY.device_disconnected).toBe('device_disconnected');
    expect(NOTIFICATION_TYPE_PREF_KEY.device_logged_out).toBe('device_disconnected');
    expect(NOTIFICATION_TYPE_PREF_KEY.broadcast_completed).toBe('broadcast_completed');
    expect(NOTIFICATION_TYPE_PREF_KEY.campaign_failed).toBe('campaign_failed');
    expect(NOTIFICATION_TYPE_PREF_KEY.teamchat_mention).toBe('mention_in_inbox');
    // Tasks, leads, forms, sales docs stay ungated.
    expect(NOTIFICATION_TYPE_PREF_KEY.task_due).toBeUndefined();
    expect(NOTIFICATION_TYPE_PREF_KEY.new_lead).toBeUndefined();
  });

  it('the waiting nudge (BL-098): bell, pop-up and push on, sound off, gated by the new-customer-reply toggle', () => {
    expect(NOTIFICATION_CATALOG.chat_waiting).toEqual({
      group: 'conversations',
      toast: true,
      sound: false,
      push: true,
    });
    expect(NOTIFICATION_TYPE_PREF_KEY.chat_waiting).toBe('new_customer_reply');
    expect(resolveNotificationChannels('chat_waiting', null)).toEqual({
      bell: true,
      toast: true,
      sound: false,
      push: true,
    });
  });

  it('keeps the chat types loud and the housekeeping types quiet (the spec columns Toast and Sound)', () => {
    for (const t of [
      'new_chat',
      'new_message',
      'conversation_assigned',
      'mention',
      'teamchat_mention',
    ] as const) {
      expect(NOTIFICATION_CATALOG[t], t).toMatchObject({ toast: true, sound: true });
    }
    expect(NOTIFICATION_CATALOG.task_completed).toMatchObject({ toast: false, sound: false });
    expect(NOTIFICATION_CATALOG.device_disconnected).toMatchObject({ toast: true, sound: false });
  });
});

describe('resolveNotificationChannels: person, then owner, then default', () => {
  it('uses the defaults when nobody chose anything', () => {
    expect(resolveNotificationChannels('new_chat', null)).toEqual({
      bell: true,
      toast: true,
      sound: true,
      push: true,
    });
    expect(resolveNotificationChannels('task_due', undefined)).toEqual({
      bell: true,
      toast: true,
      sound: false,
      push: false,
    });
  });

  it("lets the owner's toggle set the bell when the person never chose", () => {
    expect(resolveNotificationChannels('mention', null, false).bell).toBe(false);
    expect(
      resolveNotificationChannels(
        'mention',
        { bell: null, toast: null, sound: null, push: null },
        false,
      ).bell,
    ).toBe(false);
  });

  it("lets the person's own choice beat the owner either way", () => {
    expect(
      resolveNotificationChannels(
        'mention',
        { bell: true, toast: null, sound: null, push: null },
        false,
      ).bell,
    ).toBe(true);
    expect(
      resolveNotificationChannels(
        'mention',
        { bell: false, toast: null, sound: null, push: null },
        true,
      ).bell,
    ).toBe(false);
  });

  it('resolves toast and sound independently of the bell and of each other', () => {
    expect(
      resolveNotificationChannels('new_message', {
        bell: null,
        toast: false,
        sound: null,
        push: null,
      }),
    ).toEqual({ bell: true, toast: false, sound: true, push: true });
    expect(
      resolveNotificationChannels('task_due', { bell: null, toast: null, sound: true, push: null }),
    ).toEqual({ bell: true, toast: true, sound: true, push: false });
  });
});

describe('the update request', () => {
  it('accepts booleans and null, a partial item, and rejects an unknown type or a duplicate', () => {
    expect(
      updateNotificationPreferencesRequestSchema.safeParse({
        items: [
          { type: 'new_message', toast: false },
          { type: 'mention', bell: null, sound: true },
        ],
      }).success,
    ).toBe(true);
    expect(updateNotificationPreferencesRequestSchema.safeParse({ items: [] }).success).toBe(false);
    expect(
      updateNotificationPreferencesRequestSchema.safeParse({
        items: [{ type: 'nonsense', bell: true }],
      }).success,
    ).toBe(false);
    expect(
      updateNotificationPreferencesRequestSchema.safeParse({
        items: [
          { type: 'mention', bell: true },
          { type: 'mention', bell: false },
        ],
      }).success,
    ).toBe(false);
    expect(
      updateNotificationPreferencesRequestSchema.safeParse({
        items: [{ type: 'mention', bell: 'yes' }],
      }).success,
    ).toBe(false);
  });
});

describe("notification.created carries the person's toast and sound", () => {
  const schema = realtimeEventSchemas[REALTIME_EVENT.notificationCreated];
  const base = {
    notificationId: '11111111-1111-4111-8111-111111111111',
    type: 'new_chat',
    unread: 1,
    subjectKind: null,
    subjectId: null,
    collapsed: false,
    silent: false,
  };
  it('still parses a payload from a server that predates the flags (backward compatible)', () => {
    expect(schema.parse(base)).toMatchObject({ silent: false });
  });
  it('parses the flags', () => {
    expect(schema.parse({ ...base, toast: false, sound: true })).toMatchObject({
      toast: false,
      sound: true,
    });
  });
});

describe('NotificationPublisher puts the resolved flags on the event', () => {
  function publisherWith() {
    const emitted: Array<Record<string, unknown>> = [];
    const publisher = new NotificationPublisher(
      { txAs: async (_t: unknown, fn: (tx: unknown) => unknown) => fn({}) } as never,
      { countUnread: async () => 2 } as never,
      {
        emitToUsers: async (
          _o: number,
          _u: number[],
          _t: string,
          payload: Record<string, unknown>,
        ) => {
          emitted.push(payload);
        },
      } as never,
      { set: async () => 'OK' } as never,
    );
    return { publisher, emitted };
  }
  const row = (over: Record<string, unknown> = {}) => ({
    id: 1,
    uuid: '11111111-1111-4111-8111-111111111111',
    userId: 7,
    type: 'new_message',
    subjectKind: null,
    subjectUuid: null,
    collapsed: false,
    ...over,
  });

  it("uses the row's resolved flags", async () => {
    const { publisher, emitted } = publisherWith();
    await publisher.created(1, row({ toast: false, sound: false }) as never);
    expect(emitted[0]).toMatchObject({ toast: false, sound: false, silent: false });
  });

  it("falls back to the type's catalogue default for a row built by hand", async () => {
    const { publisher, emitted } = publisherWith();
    await publisher.created(1, row({ type: 'task_due' }) as never);
    await publisher.created(1, row({ type: 'new_chat' }) as never);
    await publisher.created(1, row({ type: 'some_future_type' }) as never);
    expect(emitted.map((e) => [e.toast, e.sound])).toEqual([
      [true, false],
      [true, true],
      [true, false],
    ]);
  });
});

describe("NotificationFanout honours each recipient's preferences", () => {
  const stored = new Map<
    number,
    { bell: boolean | null; toast: boolean | null; sound: boolean | null; push: boolean | null }
  >();
  function build(workspaceInapp = true) {
    stored.clear();
    const repo = new NotificationsRepository();
    // The tx is never touched: preferences are handed in by the fanout, the owner's toggle by the resolver.
    const inserted: Array<Record<string, unknown>> = [];
    const tx = {
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              inserted.push(v);
              return [
                {
                  id: inserted.length,
                  uuid: `00000000-0000-4000-8000-${String(inserted.length).padStart(12, '0')}`,
                },
              ];
            },
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            groupBy: async () => [],
          }),
        }),
      }),
    };
    vi.spyOn(repo, 'userPrefsFor').mockImplementation(async () => new Map(stored));
    vi.spyOn(repo, 'countUnreadFor').mockImplementation(
      async (_t, _o, ids) => new Map(ids.map((i) => [i, 1])),
    );
    const prefs = { inappAllowed: async () => workspaceInapp } as never;
    const published: Array<{ userId: number; silent?: boolean }> = [];
    const publisher = {
      created: async (_o: number, row: { userId: number }, opts: { silent?: boolean }) => {
        published.push({ userId: row.userId, silent: opts.silent });
      },
    } as unknown as NotificationPublisher;
    return {
      fanout: new NotificationFanout(repo, prefs, publisher),
      tx: tx as never,
      inserted,
      published,
    };
  }
  const draft = (id: number) => ({
    title: 't',
    body: null,
    link: null,
    data: null,
    dedupeKey: `k${id}`,
  });

  it('writes a row for everyone by default and carries the catalogue flags', async () => {
    const { fanout, tx, inserted } = build();
    const out = await fanout.write(tx, 1, 'device_disconnected', [1, 2], draft);
    expect(out.map((p) => [p.row.userId, p.row.toast, p.row.sound, p.unread])).toEqual([
      [1, true, false, 1],
      [2, true, false, 1],
    ]);
    expect(inserted).toHaveLength(2);
  });

  it('writes no row for a person whose bell is off, but still one for the others', async () => {
    const { fanout, tx, inserted } = build();
    stored.set(2, { bell: false, toast: null, sound: null, push: null });
    const out = await fanout.write(tx, 1, 'device_disconnected', [1, 2, 3], draft);
    expect(out.map((p) => p.row.userId)).toEqual([1, 3]);
    expect(inserted).toHaveLength(2);
  });

  it('writes the row but with toast off when only the toast is off', async () => {
    const { fanout, tx } = build();
    stored.set(1, { bell: null, toast: false, sound: null, push: null });
    const out = await fanout.write(tx, 1, 'broadcast_completed', [1, 2], draft);
    expect(out.map((p) => [p.row.userId, p.row.toast])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("the owner's toggle off removes the row for everyone except a person who turned it on themselves", async () => {
    const { fanout, tx } = build(false);
    stored.set(2, { bell: true, toast: null, sound: null, push: null });
    const out = await fanout.write(tx, 1, 'broadcast_completed', [1, 2], draft);
    expect(out.map((p) => p.row.userId)).toEqual([2]);
  });

  it('skips a person the draft returns null for, and does nothing for an empty audience', async () => {
    const { fanout, tx, inserted } = build();
    expect(await fanout.write(tx, 1, 'mention', [], draft)).toEqual([]);
    const out = await fanout.write(tx, 1, 'mention', [1, 2], (id) => (id === 1 ? null : draft(id)));
    expect(out.map((p) => p.row.userId)).toEqual([2]);
    expect(inserted).toHaveLength(1);
  });

  it('announces after the commit with the silent flag and the throttle key it was given', async () => {
    const { fanout, tx, published } = build();
    const out = await fanout.write(tx, 1, 'conversation_assigned', [4], draft, { silent: true });
    await fanout.publish(1, out);
    expect(published).toEqual([{ userId: 4, silent: true }]);
  });
});

describe('NotificationPreferencesService', () => {
  const ctx = { requestId: 'r', orgId: 1, actorType: 'user' as const, actorId: 9, userId: 9 };

  function service(
    stored: Map<
      string,
      { bell: boolean | null; toast: boolean | null; sound: boolean | null; push: boolean | null }
    >,
    ws = true,
    features: Record<string, boolean> = { waba_groups: true },
  ) {
    const applied: Array<[string, unknown]> = [];
    const audits: unknown[] = [];
    const repo = {
      userPrefsOf: async () => new Map(stored),
      applyUserPref: async (
        _tx: unknown,
        _o: number,
        _u: number,
        type: string,
        patch: Record<string, unknown>,
      ) => {
        applied.push([type, patch]);
      },
    };
    const svc = new NotificationPreferencesService(
      { tx: async (fn: (tx: unknown) => unknown) => fn({}) } as never,
      repo as never,
      { inappAllowed: async () => ws, forget: () => undefined } as never,
      { record: async (_tx: unknown, input: unknown) => void audits.push(input) } as never,
      { featureEnabled: async (_org: number, key: string) => features[key] === true } as never,
    );
    return { svc, applied, audits };
  }

  it('lists every tunable type in catalogue order with the values in force', async () => {
    const stored = new Map([
      ['new_message', { bell: null, toast: false, sound: null, push: null }],
    ]);
    const { svc } = service(stored);
    const res = await RequestContextStore.run(ctx as never, () => svc.get());
    expect(res.items.map((i) => i.type)).toEqual([...NOTIFICATION_PREF_TYPES]);
    const msg = res.items.find((i) => i.type === 'new_message')!;
    expect(msg).toMatchObject({
      group: 'conversations',
      bell: true,
      toast: false,
      sound: true,
      push: true,
      defaults: { bell: true, toast: true, sound: true, push: true },
      overrides: { bell: null, toast: false, sound: null, push: null },
      workspaceInapp: true,
    });
  });

  it('leaves the WhatsApp Groups types out of the list when the plan lacks waba_groups (BL-099)', async () => {
    const off = service(new Map(), true, { waba_groups: false });
    const without = await RequestContextStore.run(ctx as never, () => off.svc.get());
    const gated = Object.keys(NOTIFICATION_TYPE_PLAN_FEATURE);
    expect(gated.length).toBe(3);
    for (const type of gated) expect(without.items.map((i) => i.type)).not.toContain(type);
    expect(without.items.length).toBe(NOTIFICATION_PREF_TYPES.length - gated.length);

    const on = service(new Map());
    const withIt = await RequestContextStore.run(ctx as never, () => on.svc.get());
    for (const type of gated) {
      expect(withIt.items.find((i) => i.type === type)).toMatchObject({
        group: 'whatsapp_groups',
        bell: true,
        toast: true,
        sound: false,
        push: false,
      });
    }
  });

  it("shows the owner's toggle as the bell the person inherits", async () => {
    const { svc } = service(new Map(), false);
    const res = await RequestContextStore.run(ctx as never, () => svc.get());
    expect(res.items[0]).toMatchObject({
      bell: false,
      workspaceInapp: false,
      overrides: { bell: null },
    });
  });

  it('applies each named item, audits only real changes, and sends nothing for an unchanged value', async () => {
    const stored = new Map([['mention', { bell: null, toast: false, sound: null, push: null }]]);
    const { svc, applied, audits } = service(stored);
    await RequestContextStore.run(ctx as never, () =>
      svc.update({
        items: [
          { type: 'mention', toast: false },
          { type: 'new_chat', sound: false },
        ],
      }),
    );
    expect(applied).toEqual([
      ['mention', { toast: false }],
      ['new_chat', { sound: false }],
    ]);
    expect(audits).toEqual([
      {
        module: 'notifications',
        recordId: 9,
        action: 'update',
        delta: { 'new_chat.sound': { old: null, new: false } },
      },
    ]);
  });

  it('writes no audit row when nothing changes', async () => {
    const stored = new Map([['mention', { bell: false, toast: null, sound: null, push: null }]]);
    const { svc, audits } = service(stored);
    await RequestContextStore.run(ctx as never, () =>
      svc.update({ items: [{ type: 'mention', bell: false }] }),
    );
    expect(audits).toEqual([]);
  });

  it('refuses a non-staff caller', async () => {
    const { svc } = service(new Map());
    await expect(
      RequestContextStore.run({ ...ctx, actorType: 'api_key', userId: null } as never, () =>
        svc.get(),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
