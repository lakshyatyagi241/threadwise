import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import { PUSH_MAX_DEVICES_PER_USER, pushDeviceListResponseSchema } from '@crm/contracts';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { NotificationFanout } from '../../../src/modules/notifications/notification-fanout';
import { NotificationPublisher } from '../../../src/modules/notifications/notification.publisher';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository';
import { PushSubscriptionsPruneService } from '../../../src/modules/notifications/push-subscriptions-prune.service';
import { PushSubscriptionsRepository } from '../../../src/modules/notifications/push-subscriptions.repository';
import { PushSubscriptionsService } from '../../../src/modules/notifications/push-subscriptions.service';
import { WebPushDeliveryService } from '../../../src/modules/notifications/web-push-delivery.service';
import { WebPushSender } from '../../../src/modules/notifications/web-push.sender';
import { FakeWebPushProvider, fakeSubscription, useVapidEnv } from '../../support/web-push-fakes';

/**
 * Browser notification devices (BL-097) against a real Postgres, as the restricted application role (forced RLS): the device CRUD a
 * person has, the isolation between people and between workspaces, the cap, the secret never leaving the service, and the sender's
 * bookkeeping (accepted, gone, revoked). The push service is a fake: no test touches the network.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
const UA_CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

describe('push_subscriptions', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let clients: DbClientPair;
  let db: DatabaseService;
  let restoreEnv: () => void;
  const repo = new PushSubscriptionsRepository();
  const provider = new FakeWebPushProvider();
  let service: PushSubscriptionsService;
  let delivery: WebPushDeliveryService;
  const visible = { value: false };
  const announced: Array<{ orgId: number; users: number[]; type: string; payload: unknown }> = [];
  let orgA: number;
  let orgB: number;
  let ann: number; // orgA
  let bob: number; // orgA
  let carl: number; // orgB

  const ctx = (orgId: number, userId: number): RequestContext => ({
    requestId: 'push-it',
    orgId,
    actorType: 'user',
    actorId: userId,
    userId,
  });
  const as = <T>(orgId: number, userId: number, fn: () => Promise<T>): Promise<T> =>
    RequestContextStore.run(ctx(orgId, userId), fn);

  beforeAll(async () => {
    restoreEnv = useVapidEnv();
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });

    const one = async (sql: string, p: unknown[] = []) =>
      Number((await owner.query(sql, p)).rows[0].id);
    orgA = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('pa','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('pb','B','starter') RETURNING id`,
    );
    const user = (org: number, email: string) =>
      one(
        `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,$2::text,$2::text,'x') RETURNING id`,
        [org, email],
      );
    ann = await user(orgA, 'ann@p.test');
    bob = await user(orgA, 'bob@p.test');
    carl = await user(orgB, 'carl@p.test');

    clients = createDbClientPair({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 6,
    });
    db = new DatabaseService(clients);
    const sender = new WebPushSender(provider, db, repo);
    const redisKeys = new Set<string>();
    const redis = {
      set: vi.fn(async (key: string) => {
        if (redisKeys.has(key)) return null;
        redisKeys.add(key);
        return 'OK';
      }),
    };
    const notificationsRepo = new NotificationsRepository();
    const publisher = new NotificationPublisher(
      db,
      notificationsRepo,
      {
        emitToUsers: vi.fn(
          async (orgId: number, users: number[], type: string, payload: unknown) => {
            announced.push({ orgId, users, type, payload });
          },
        ),
      } as never,
      redis as never,
    );
    const fanout = new NotificationFanout(
      notificationsRepo,
      { inappAllowed: async () => true } as never,
      publisher,
    );
    service = new PushSubscriptionsService(db, repo, sender, redis as never, fanout);
    delivery = new WebPushDeliveryService(db, new NotificationsRepository(), repo, sender, {
      isVisible: async () => visible.value,
    } as never);
  }, 240_000);

  afterAll(async () => {
    restoreEnv?.();
    await clients?.close();
    await owner?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    visible.value = false;
    provider.sent.length = 0;
    announced.length = 0;
    await owner.query(`DELETE FROM push_subscriptions`);
    await owner.query(`DELETE FROM inbox_notifications`);
  });

  const stored_notifications = async () =>
    (await owner.query(`SELECT * FROM inbox_notifications ORDER BY id`)).rows;
  const stored = async (where = '') =>
    (await owner.query(`SELECT * FROM push_subscriptions ${where} ORDER BY id`)).rows;

  describe('a person managing their own devices', () => {
    it('adds a device, names it from the browser, and lists it without any secret', async () => {
      const sub = fakeSubscription(1);
      const added = await as(orgA, ann, () => service.subscribe(sub, UA_CHROME_WIN));
      expect(added.label).toBe('Chrome on Windows');
      expect(added.lastUsedAt).toBeNull();

      const list = await as(orgA, ann, () => service.list());
      expect(pushDeviceListResponseSchema.parse(list).items).toHaveLength(1);
      expect(Object.keys(list.items[0]!).sort()).toEqual([
        'createdAt',
        'id',
        'label',
        'lastUsedAt',
      ]);
      const text = JSON.stringify([added, list]);
      expect(text).not.toContain(sub.endpoint);
      expect(text).not.toContain(sub.keys.p256dh);
      expect(text).not.toContain(sub.keys.auth);

      // The endpoint is stored (the sender needs it), looked up by its hash.
      const rows = await stored();
      expect(rows).toHaveLength(1);
      expect(rows[0].endpoint).toBe(sub.endpoint);
      expect(rows[0].endpoint_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is idempotent per browser: subscribing again refreshes the keys and returns the same device', async () => {
      const sub = fakeSubscription(1);
      const first = await as(orgA, ann, () => service.subscribe(sub, UA_CHROME_WIN));
      const again = await as(orgA, ann, () =>
        service.subscribe({ ...sub, keys: { ...sub.keys, auth: 'c'.repeat(22) } }, UA_CHROME_WIN),
      );
      expect(again.id).toBe(first.id);
      const rows = await stored();
      expect(rows).toHaveLength(1);
      expect(rows[0].auth).toBe('c'.repeat(22));
    });

    it('brings a revoked device back to life when the browser subscribes again', async () => {
      const sub = fakeSubscription(1);
      await as(orgA, ann, () => service.subscribe(sub, UA_CHROME_WIN));
      await owner.query(
        `UPDATE push_subscriptions SET revoked_at = now(), failure_count = 5 WHERE user_id = $1`,
        [ann],
      );
      expect((await as(orgA, ann, () => service.list())).items).toHaveLength(0);
      await as(orgA, ann, () => service.subscribe(sub, UA_CHROME_WIN));
      expect((await as(orgA, ann, () => service.list())).items).toHaveLength(1);
      expect((await stored())[0].failure_count).toBe(0);
    });

    it('removes a device, and answers 404 for one that is not there', async () => {
      const added = await as(orgA, ann, () =>
        service.subscribe(fakeSubscription(1), UA_CHROME_WIN),
      );
      await as(orgA, ann, () => service.remove(added.id));
      expect(await stored()).toHaveLength(0);
      await expect(as(orgA, ann, () => service.remove(added.id))).rejects.toMatchObject({
        status: 404,
      });
    });

    it('keeps at most ten devices: the least recently used are dropped, the new one stays', async () => {
      const ids: string[] = [];
      for (let n = 1; n <= PUSH_MAX_DEVICES_PER_USER; n++) {
        ids.push(
          (await as(orgA, ann, () => service.subscribe(fakeSubscription(n), UA_CHROME_WIN))).id,
        );
      }
      // Device 1 was used most recently; device 2 is now the stalest.
      await owner.query(
        `UPDATE push_subscriptions SET last_used_at = now() + interval '1 hour' WHERE uuid = $1`,
        [ids[0]],
      );
      const eleventh = await as(orgA, ann, () =>
        service.subscribe(fakeSubscription(11), UA_CHROME_WIN),
      );
      const left = (await as(orgA, ann, () => service.list())).items.map((d) => d.id);
      expect(left).toHaveLength(PUSH_MAX_DEVICES_PER_USER);
      expect(left).toContain(eleventh.id);
      expect(left).toContain(ids[0]);
      expect(left).not.toContain(ids[1]);
    });

    it('rejects an endpoint that is not https', async () => {
      const { pushSubscriptionInputSchema } = await import('@crm/contracts');
      const sub = fakeSubscription(1);
      expect(
        pushSubscriptionInputSchema.safeParse({ ...sub, endpoint: 'http://push.example.test/x' })
          .success,
      ).toBe(false);
    });
  });

  describe('isolation', () => {
    it("never shows, removes or tests another person's device, in the same workspace", async () => {
      const anns = await as(orgA, ann, () => service.subscribe(fakeSubscription(1), UA_CHROME_WIN));
      expect((await as(orgA, bob, () => service.list())).items).toHaveLength(0);
      await expect(as(orgA, bob, () => service.remove(anns.id))).rejects.toMatchObject({
        status: 404,
      });
      expect(await stored()).toHaveLength(1);
      const test = await as(orgA, bob, () => service.test());
      expect(test).toEqual({ inApp: true, sent: 0, failed: 0 });
      expect(provider.sent).toHaveLength(0);
    });

    it('never crosses a workspace: the restricted role sees and changes only its own tenant rows', async () => {
      await as(orgA, ann, () => service.subscribe(fakeSubscription(1), UA_CHROME_WIN));
      const carls = await as(orgB, carl, () =>
        service.subscribe(fakeSubscription(2), UA_CHROME_WIN),
      );
      expect((await as(orgA, ann, () => service.list())).items.map((d) => d.id)).not.toContain(
        carls.id,
      );
      // Even asked for by its own id, by someone in the other workspace.
      await expect(as(orgA, ann, () => service.remove(carls.id))).rejects.toMatchObject({
        status: 404,
      });
      // Raw SQL as the application role, with the wrong tenant set: RLS hides the rows and refuses the write.
      const raw = new Client({
        host: container.getHost(),
        port: container.getPort(),
        database: 'crm',
        user: 'crm_app_user',
        password: 'test',
      });
      await raw.connect();
      try {
        await raw.query('BEGIN');
        await raw.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgA)]);
        const seen = await raw.query(`SELECT org_id FROM push_subscriptions`);
        expect(seen.rows.map((r) => Number(r.org_id))).toEqual([orgA]);
        await expect(
          raw.query(
            `INSERT INTO push_subscriptions (org_id, user_id, endpoint, endpoint_hash, p256dh, auth) VALUES ($1,$2,'https://x.test/e','h','p','a')`,
            [orgB, carl],
          ),
        ).rejects.toThrow(/row-level security/i);
        await raw.query('ROLLBACK');
        // A user of another workspace cannot be referenced by a composite foreign key either.
        await raw.query('BEGIN');
        await raw.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgA)]);
        await expect(
          raw.query(
            `INSERT INTO push_subscriptions (org_id, user_id, endpoint, endpoint_hash, p256dh, auth) VALUES ($1,$2,'https://x.test/e','h2','p','a')`,
            [orgA, carl],
          ),
        ).rejects.toThrow(/foreign key/i);
      } finally {
        await raw.query('ROLLBACK').catch(() => undefined);
        await raw.end();
      }
    });

    it('moves a browser to the new person of a shared computer, so the previous alerts stop there', async () => {
      const shared = fakeSubscription(1);
      await as(orgA, ann, () => service.subscribe(shared, UA_CHROME_WIN));
      await as(orgA, bob, () => service.subscribe(shared, UA_CHROME_WIN));
      const rows = await stored();
      expect(rows.map((r) => Number(r.user_id))).toEqual([bob]);
    });

    it('lets the same browser belong to one person in each of two workspaces', async () => {
      const shared = fakeSubscription(1);
      await as(orgA, ann, () => service.subscribe(shared, UA_CHROME_WIN));
      await as(orgB, carl, () => service.subscribe(shared, UA_CHROME_WIN));
      expect(await stored()).toHaveLength(2);
    });

    it('takes the devices of a removed user along', async () => {
      const temp = Number(
        (
          await owner.query(
            `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'temp@p.test','Temp','x') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      await as(orgA, temp, () => service.subscribe(fakeSubscription(1), UA_CHROME_WIN));
      expect(await stored()).toHaveLength(1);
      await owner.query(`DELETE FROM users WHERE id = $1`, [temp]);
      expect(await stored()).toHaveLength(0);
    });
  });

  describe('the test notification', () => {
    it('goes to every device of the caller, ignoring whether a tab is open, and is limited to one every ten seconds', async () => {
      await as(orgA, ann, () => service.subscribe(fakeSubscription(1), UA_CHROME_WIN));
      await as(orgA, ann, () => service.subscribe(fakeSubscription(2), UA_CHROME_WIN));
      visible.value = true;
      const result = await as(orgA, ann, () => service.test());
      expect(result).toEqual({ inApp: true, sent: 2, failed: 0 });
      expect(provider.sent.map((s) => s.payload.test)).toEqual([true, true]);
      // The in-app leg: one unread `test` bell row for the caller (and nobody else), announced to the caller's user room only.
      const rows = await stored_notifications();
      expect(rows).toEqual([
        expect.objectContaining({ user_id: ann, type: 'test', read_at: null }),
      ]);
      expect(announced).toEqual([
        expect.objectContaining({ orgId: orgA, users: [ann], type: 'notification.created' }),
      ]);
      expect(announced[0]!.payload).toMatchObject({ type: 'test', unread: 1, silent: false });
      expect((await as(orgA, ann, () => service.list())).items.every((d) => d.lastUsedAt)).toBe(
        true,
      );
      await expect(as(orgA, ann, () => service.test())).rejects.toMatchObject({ status: 429 });
    });
  });

  describe('delivery against the real tables', () => {
    const insertRow = async (userId: number, readAt: string | null = null) =>
      (
        await owner.query(
          `INSERT INTO inbox_notifications (org_id, user_id, type, title, body, link, data, dedupe_key, subject_kind, subject_uuid, read_at)
           VALUES ($1,$2,'new_message','New message from Asha','Is it shipped?','/inbox?c=33333333-3333-4333-8333-333333333333',
                   '{"contactName":"Asha Rao","preview":"Is it shipped?"}', $3, 'conversation', '33333333-3333-4333-8333-333333333333', $4)
           RETURNING uuid`,
          [orgA, userId, `k:${Math.random()}`, readAt],
        )
      ).rows[0].uuid as string;

    it('pushes to the live devices only, records last use, and revokes a device the push service says is gone', async () => {
      const live = fakeSubscription(1);
      const dead = fakeSubscription(2);
      await as(orgA, ann, () => service.subscribe(live, UA_CHROME_WIN));
      await as(orgA, ann, () => service.subscribe(dead, UA_CHROME_WIN));
      await as(orgA, bob, () => service.subscribe(fakeSubscription(3), UA_CHROME_WIN));
      provider.answer(dead.endpoint, { ok: false, gone: true, status: 410 });
      const notificationUuid = await insertRow(ann);

      const out = await delivery.deliver({ orgId: orgA, userId: ann, notificationUuid });
      expect(out).toMatchObject({ status: 'done', sent: 1, failed: 1, retry: [] });
      // Bob's device is not touched, and the row text is the contact name and the preview.
      expect(provider.sent.map((s) => s.target.endpoint).sort()).toEqual(
        [live.endpoint, dead.endpoint].sort(),
      );
      expect(provider.sent[0]!.payload).toMatchObject({
        title: 'Asha Rao',
        body: 'New message',
        tag: 'conversation:33333333-3333-4333-8333-333333333333',
      });
      const rows = await stored(`WHERE user_id = ${ann}`);
      const byEndpoint = new Map(rows.map((r) => [r.endpoint as string, r]));
      expect(byEndpoint.get(live.endpoint).last_used_at).not.toBeNull();
      expect(byEndpoint.get(live.endpoint).revoked_at).toBeNull();
      expect(byEndpoint.get(dead.endpoint).revoked_at).not.toBeNull();
      expect(byEndpoint.get(dead.endpoint).failure_count).toBe(1);

      // The revoked device is never sent to again and no longer listed.
      provider.sent.length = 0;
      await delivery.deliver({ orgId: orgA, userId: ann, notificationUuid });
      expect(provider.sent.map((s) => s.target.endpoint)).toEqual([live.endpoint]);
      expect((await as(orgA, ann, () => service.list())).items).toHaveLength(1);
    });

    it('sends nothing for a row already read, or while a tab is visible', async () => {
      await as(orgA, ann, () => service.subscribe(fakeSubscription(1), UA_CHROME_WIN));
      const read = await insertRow(ann, new Date().toISOString());
      expect(await delivery.deliver({ orgId: orgA, userId: ann, notificationUuid: read })).toEqual({
        status: 'skipped',
        reason: 'read',
      });
      const unread = await insertRow(ann);
      visible.value = true;
      expect(
        await delivery.deliver({ orgId: orgA, userId: ann, notificationUuid: unread }),
      ).toEqual({
        status: 'skipped',
        reason: 'visible',
      });
      expect(provider.sent).toHaveLength(0);
    });

    it("cannot be pointed at another person's bell row", async () => {
      await as(orgA, ann, () => service.subscribe(fakeSubscription(1), UA_CHROME_WIN));
      const bobsRow = await insertRow(bob);
      expect(
        await delivery.deliver({ orgId: orgA, userId: ann, notificationUuid: bobsRow }),
      ).toEqual({ status: 'skipped', reason: 'gone' });
      expect(provider.sent).toHaveLength(0);
    });
  });

  describe('the daily prune', () => {
    it('deletes devices revoked more than 30 days ago and nothing else', async () => {
      await as(orgA, ann, () => service.subscribe(fakeSubscription(1), UA_CHROME_WIN));
      await as(orgA, ann, () => service.subscribe(fakeSubscription(2), UA_CHROME_WIN));
      await as(orgB, carl, () => service.subscribe(fakeSubscription(3), UA_CHROME_WIN));
      await owner.query(
        `UPDATE push_subscriptions SET revoked_at = now() - interval '40 days' WHERE endpoint LIKE '%device-1-%' OR endpoint LIKE '%device-3-%'`,
      );
      await owner.query(
        `UPDATE push_subscriptions SET revoked_at = now() - interval '2 days' WHERE endpoint LIKE '%device-2-%'`,
      );
      const deleted = await new PushSubscriptionsPruneService(db, repo).runOnce();
      expect(deleted).toBe(2);
      expect((await stored()).map((r) => r.endpoint as string)).toEqual([
        expect.stringContaining('device-2-'),
      ]);
    });
  });

  describe('the person push preference', () => {
    it('is stored per type, reads back, and a row left with nothing set is removed', async () => {
      const prefs = new NotificationsRepository();
      await db.txAs({ orgId: orgA, userId: ann }, (tx) =>
        prefs.applyUserPref(tx, orgA, ann, 'task_due', { push: true }),
      );
      const after = await db.txAs({ orgId: orgA, userId: ann }, (tx) =>
        prefs.userPrefsOf(tx, orgA, ann),
      );
      expect(after.get('task_due')).toEqual({ bell: null, toast: null, sound: null, push: true });
      const channels = await db.txAs({ orgId: orgA, userId: ann }, (tx) =>
        prefs.channelsFor(tx, orgA, { userId: ann, type: 'task_due' }),
      );
      expect(channels.push).toBe(true);
      // Another person is unaffected: the default for task_due is off.
      const other = await db.txAs({ orgId: orgA, userId: bob }, (tx) =>
        prefs.channelsFor(tx, orgA, { userId: bob, type: 'task_due' }),
      );
      expect(other.push).toBe(false);
      await db.txAs({ orgId: orgA, userId: ann }, (tx) =>
        prefs.applyUserPref(tx, orgA, ann, 'task_due', { push: null }),
      );
      const rows = await owner.query(
        `SELECT 1 FROM notification_user_prefs WHERE org_id = $1 AND user_id = $2`,
        [orgA, ann],
      );
      expect(rows.rowCount).toBe(0);
    });
  });
});
