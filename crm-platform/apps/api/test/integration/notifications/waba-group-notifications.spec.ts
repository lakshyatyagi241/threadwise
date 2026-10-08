import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { NotificationFanout } from '../../../src/modules/notifications/notification-fanout';
import { NotificationPrefsResolver } from '../../../src/modules/notifications/notification-prefs.resolver';
import type { NotificationPublisher } from '../../../src/modules/notifications/notification.publisher';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository';
import { WabaGroupNotificationConsumer } from '../../../src/modules/notifications/waba-group-notification.consumer';
import type { MemberDirectory } from '../../../src/realtime';

/**
 * The WhatsApp Groups notification consumer (BL-099) against a real Postgres, as the restricted application role: only people holding
 * `waba.groups.manage` are told, a plan without `waba_groups` hears nothing, ten join requests are ONE row with a count, a re-delivered
 * event writes nothing twice, the rows hold no member number and no invite link, a person's own bell choice is honoured, handled
 * requests close the row, and a suspension that was already cleared (or a group that is gone) is dropped. Tenants never see each other.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
const INVITE = 'https://chat.whatsapp.com/SECRETINVITECODE';
const PHONES = ['+919800000001', '+919800000002', '+919800000003'];

describe('WhatsApp group notifications', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let clients: DbClientPair;
  let db: DatabaseService;
  const repo = new NotificationsRepository();
  let orgA: number;
  let orgB: number;
  let manager1: number;
  let manager2: number;
  let readOnly: number;
  let managerB: number;
  let groupA: string;
  let groupB: string;
  let connA: string;
  let nextEvent = 1000;
  const plan = new Map<number, boolean>();
  const askedPermissions: string[] = [];
  const created: Array<{ orgId: number; userId: number; type: string }> = [];
  const readSignals: Array<{ orgId: number; userId: number; ids: string[] | 'all' }> = [];
  let consumer: WabaGroupNotificationConsumer;

  const one = async (sql: string, p: unknown[] = []) =>
    Number((await owner.query(sql, p)).rows[0].id);

  beforeAll(async () => {
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

    orgA = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('ga','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('gb','B','starter') RETURNING id`,
    );
    const user = (org: number, email: string) =>
      one(
        `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,$2::text,$2::text,'x') RETURNING id`,
        [org, email],
      );
    manager1 = await user(orgA, 'm1@g.test');
    manager2 = await user(orgA, 'm2@g.test');
    readOnly = await user(orgA, 'ro@g.test');
    managerB = await user(orgB, 'mb@g.test');

    const connection = async (org: number) =>
      (
        await owner.query(
          `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label)
           VALUES ($1,'waba','connected','+911100000000','Main') RETURNING id, uuid`,
          [org],
        )
      ).rows[0] as { id: string; uuid: string };
    const cA = await connection(orgA);
    const cB = await connection(orgB);
    connA = cA.uuid;
    const group = async (org: number, cfg: string, gid: string, subject: string) =>
      (
        await owner.query(
          `INSERT INTO waba_groups (org_id, provider_config_id, group_id, subject, invite_link, meta_json)
           VALUES ($1,$2,$3,$4,$5,'{}'::jsonb) RETURNING uuid`,
          [org, cfg, gid, subject, INVITE],
        )
      ).rows[0].uuid as string;
    groupA = await group(orgA, cA.id, '1203630000000001@g.us', 'Sales club');
    groupB = await group(orgB, cB.id, '1203630000000002@g.us', 'Other tenant group');

    clients = createDbClientPair({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 8,
    });
    db = new DatabaseService(clients);

    const directory = {
      viewers: async (orgId: number, permission: string) => {
        askedPermissions.push(permission);
        const all = (userId: number) => ({ userId, scope: 'all' as const, teamIds: [] });
        if (orgId === orgB) return [all(managerB)];
        // A person without the permission is in the list with no scope, as MemberDirectory reports them.
        return [all(manager1), all(manager2), { userId: readOnly, scope: null, teamIds: [] }];
      },
    } as unknown as MemberDirectory;
    const publisher = {
      created: async (orgId: number, row: { userId: number; type: string }) => {
        created.push({ orgId, userId: row.userId, type: row.type });
      },
      read: async (orgId: number, userId: number, ids: string[] | 'all') => {
        readSignals.push({ orgId, userId, ids });
      },
    } as unknown as NotificationPublisher;
    const fanout = new NotificationFanout(repo, new NotificationPrefsResolver(db), publisher);
    const entitlements = {
      featureEnabled: async (orgId: number, key: string) =>
        key === 'waba_groups' && (plan.get(orgId) ?? true),
    };
    consumer = new WabaGroupNotificationConsumer(
      db,
      new OutboxSubscriberRegistry(),
      directory,
      entitlements as never,
      fanout,
      publisher,
    );
  }, 240_000);

  afterAll(async () => {
    await clients?.close();
    await owner?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    plan.clear();
    askedPermissions.length = 0;
    created.length = 0;
    readSignals.length = 0;
    await owner.query(`DELETE FROM inbox_notifications`);
    await owner.query(`DELETE FROM notification_user_prefs`);
    await owner.query(`UPDATE waba_groups SET suspended = false, meta_json = '{}'::jsonb`);
  });

  /** The state the group is in when the worker gets to the event: n people waiting, suspended or not. */
  const setGroup = (uuid: string, state: { pending?: number; suspended?: boolean }) => {
    const pending = Object.fromEntries(
      Array.from({ length: state.pending ?? 0 }, (_, i) => [
        `req-${i}`,
        { wa_id: PHONES[i % PHONES.length], at: 1 },
      ]),
    );
    return owner.query(
      `UPDATE waba_groups SET suspended = $2, meta_json = jsonb_build_object('join_requests', $3::jsonb) WHERE uuid = $1`,
      [uuid, state.suspended ?? false, JSON.stringify(pending)],
    );
  };

  const event = (
    org: number,
    eventType: string,
    group: string,
    extra: Record<string, unknown>,
    id = String(nextEvent++),
  ) => ({
    id,
    orgId: org,
    aggregateModule: 'waba_groups',
    aggregateId: '1',
    eventType,
    payload: {
      groupUuid: group,
      connectionId: connA,
      groupId: 'x@g.us',
      subject: 'Sales club',
      ...extra,
    },
  });
  const requested = (group: string, count = 1, id?: string, org = orgA) =>
    event(org, 'whatsapp.group.join_request', group, { handled: null, count, pending: count }, id);

  const rows = async (org: number, type?: string) =>
    (
      await owner.query(
        `SELECT user_id, type, title, body, link, data, event_count, read_at, collapse_key, subject_kind, subject_uuid
         FROM inbox_notifications WHERE org_id = $1 ${type ? 'AND type = $2' : ''} ORDER BY user_id, id`,
        type ? [org, type] : [org],
      )
    ).rows as Array<{
      user_id: string;
      type: string;
      title: string;
      body: string;
      link: string;
      data: Record<string, unknown>;
      event_count: number;
      read_at: Date | null;
      subject_kind: string;
      subject_uuid: string;
    }>;

  it('tells only the people who hold waba.groups.manage, in the event workspace only', async () => {
    await setGroup(groupA, { pending: 1 });
    await consumer.handle(requested(groupA));
    const got = await rows(orgA);
    expect(askedPermissions).toEqual(['waba.groups.manage']);
    expect(got.map((r) => Number(r.user_id)).sort()).toEqual([manager1, manager2].sort());
    expect(got.every((r) => r.type === 'waba_group_join_request')).toBe(true);
    expect(got.every((r) => r.subject_kind === 'waba_group' && r.subject_uuid === groupA)).toBe(
      true,
    );
    expect(got[0]!.link).toBe(`/waba-groups?account=${connA}`);
    expect(await rows(orgB)).toEqual([]);
    expect(created.map((c) => c.userId).sort()).toEqual([manager1, manager2].sort());
  });

  it('drops an event whose group is in another workspace or gone', async () => {
    await setGroup(groupB, { pending: 1 });
    await consumer.handle(requested(groupB, 1, undefined, orgA));
    await consumer.handle(requested('99999999-9999-4999-8999-999999999999', 1));
    expect(await rows(orgA)).toEqual([]);
    expect(await rows(orgB)).toEqual([]);
  });

  it('writes nothing, and asks nothing, for a workspace whose plan lacks waba_groups', async () => {
    plan.set(orgA, false);
    await setGroup(groupA, { pending: 1 });
    await consumer.handle(requested(groupA));
    await consumer.handle(event(orgA, 'whatsapp.group.suspended', groupA, { suspended: true }));
    expect(await rows(orgA)).toEqual([]);
    expect(created).toEqual([]);
    expect(askedPermissions).toEqual([]);
    // Back on the plan: the next event notifies again.
    plan.set(orgA, true);
    await consumer.handle(requested(groupA));
    expect((await rows(orgA)).length).toBe(2);
  });

  it('collapses ten requests into ONE unread row per person with a count', async () => {
    await setGroup(groupA, { pending: 10 });
    for (let i = 0; i < 10; i += 1) await consumer.handle(requested(groupA, 1, String(2000 + i)));
    const got = await rows(orgA);
    expect(got.length).toBe(2);
    for (const r of got) {
      expect(r.event_count).toBe(10);
      expect(r.title).toBe('10 people want to join Sales club');
      expect(r.data).toMatchObject({ groupId: groupA, groupName: 'Sales club', count: 10 });
      expect(r.read_at).toBeNull();
    }
    // A request that arrives as a batch of three raises the same row.
    await consumer.handle(requested(groupA, 3, '2100'));
    const after = await rows(orgA);
    expect(after.length).toBe(2);
    expect(after.every((r) => r.event_count === 13)).toBe(true);
  });

  it('collapses per group: another group has its own row', async () => {
    const other = (
      await owner.query(
        `INSERT INTO waba_groups (org_id, provider_config_id, group_id, subject, meta_json)
         SELECT org_id, provider_config_id, '1203630000000009@g.us', 'Support', '{}'::jsonb FROM waba_groups WHERE uuid = $1
         RETURNING uuid`,
        [groupA],
      )
    ).rows[0].uuid as string;
    await setGroup(groupA, { pending: 1 });
    await setGroup(other, { pending: 1 });
    await consumer.handle(requested(groupA));
    await consumer.handle(requested(other));
    const got = await rows(orgA);
    expect(got.length).toBe(4);
    expect(new Set(got.map((r) => r.subject_uuid))).toEqual(new Set([groupA, other]));
    await owner.query(`DELETE FROM waba_groups WHERE uuid = $1`, [other]);
  });

  it('is idempotent: re-delivering events changes neither rows nor counts', async () => {
    await setGroup(groupA, { pending: 3 });
    for (const id of ['3000', '3001', '3002']) await consumer.handle(requested(groupA, 1, id));
    const before = await rows(orgA);
    expect(before.every((r) => r.event_count === 3)).toBe(true);
    // The drain claims a crashed batch again, newest and oldest alike.
    for (const id of ['3002', '3000', '3001', '3002'])
      await consumer.handle(requested(groupA, 1, id));
    const again = await rows(orgA);
    expect(again.length).toBe(2);
    expect(again.every((r) => r.event_count === 3)).toBe(true);

    await setGroup(groupA, { suspended: true });
    const sus = event(orgA, 'whatsapp.group.suspended', groupA, { suspended: true }, '3100');
    await consumer.handle(sus);
    await consumer.handle(sus);
    expect((await rows(orgA, 'waba_group_suspended')).length).toBe(2);
  });

  it('puts no member number and no invite link in a row', async () => {
    await setGroup(groupA, { pending: 3 });
    await consumer.handle(requested(groupA, 3));
    await setGroup(groupA, { pending: 3, suspended: true });
    await consumer.handle(event(orgA, 'whatsapp.group.suspended', groupA, { suspended: true }));
    const got = await rows(orgA);
    expect(got.length).toBe(4);
    for (const r of got) {
      // Ids are uuids; take them out before looking for number-like runs.
      const text = JSON.stringify([r.title, r.body, r.link, r.data]).replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        'ID',
      );
      expect(text).not.toContain('SECRETINVITECODE');
      expect(text).not.toContain('chat.whatsapp.com');
      expect(text).not.toContain('@g.us');
      expect(text).not.toMatch(/\d{8,}/);
      for (const p of PHONES) expect(text).not.toContain(p.slice(1));
    }
  });

  it("honours a person's own preference: bell off writes no row for them, the others still get theirs", async () => {
    await setGroup(groupA, { pending: 1 });
    await db.txAs({ orgId: orgA, userId: manager2 }, (tx) =>
      repo.applyUserPref(tx, orgA, manager2, 'waba_group_join_request', { bell: false }),
    );
    await consumer.handle(requested(groupA));
    const got = await rows(orgA);
    expect(got.map((r) => Number(r.user_id))).toEqual([manager1]);
    expect(created.map((c) => c.userId)).toEqual([manager1]);
  });

  it('closes the join-request rows once the queue is empty, and leaves them while requests wait', async () => {
    await setGroup(groupA, { pending: 2 });
    await consumer.handle(requested(groupA, 2));
    // One approved, one still waiting: the row stays unread.
    await consumer.handle(
      event(orgA, 'whatsapp.group.join_request', groupA, { handled: 'approved', count: 1 }),
    );
    expect((await rows(orgA)).every((r) => r.read_at === null)).toBe(true);
    expect(readSignals).toEqual([]);
    // The rest is rejected: nothing is waiting, the rows are done with and every tab hears it.
    await setGroup(groupA, { pending: 0 });
    await consumer.handle(
      event(orgA, 'whatsapp.group.join_request', groupA, { handled: 'rejected', count: 1 }),
    );
    expect((await rows(orgA)).every((r) => r.read_at !== null)).toBe(true);
    expect(readSignals.map((s) => s.userId).sort()).toEqual([manager1, manager2].sort());
    expect((await rows(orgA)).length).toBe(2);
  });

  it('drops a request event whose queue was already emptied', async () => {
    await setGroup(groupA, { pending: 0 });
    await consumer.handle(requested(groupA, 2));
    expect(await rows(orgA)).toEqual([]);
  });

  it('tells the managers a group was suspended, once each, and drops a suspension already lifted', async () => {
    await setGroup(groupA, { suspended: true });
    await consumer.handle(event(orgA, 'whatsapp.group.suspended', groupA, { suspended: true }));
    const got = await rows(orgA, 'waba_group_suspended');
    expect(got.map((r) => Number(r.user_id)).sort()).toEqual([manager1, manager2].sort());
    expect(got[0]!.title).toBe('Sales club was suspended');

    await owner.query(`DELETE FROM inbox_notifications`);
    await setGroup(groupA, { suspended: false });
    await consumer.handle(event(orgA, 'whatsapp.group.suspended', groupA, { suspended: true }));
    expect(await rows(orgA)).toEqual([]);
  });

  it('says "active again" only to people who were told of the suspension, and closes their suspension rows', async () => {
    await setGroup(groupA, { suspended: true });
    // Only manager1 heard about it (manager2 had the bell off at the time).
    await db.txAs({ orgId: orgA, userId: manager2 }, (tx) =>
      repo.applyUserPref(tx, orgA, manager2, 'waba_group_suspended', { bell: false }),
    );
    await consumer.handle(event(orgA, 'whatsapp.group.suspended', groupA, { suspended: true }));
    expect((await rows(orgA, 'waba_group_suspended')).map((r) => Number(r.user_id))).toEqual([
      manager1,
    ]);

    await setGroup(groupA, { suspended: false });
    readSignals.length = 0;
    await consumer.handle(event(orgA, 'whatsapp.group.suspended', groupA, { suspended: false }));
    const cleared = await rows(orgA, 'waba_group_suspension_cleared');
    expect(cleared.map((r) => Number(r.user_id))).toEqual([manager1]);
    expect(cleared[0]!.title).toBe('Sales club is active again');
    const suspended = await rows(orgA, 'waba_group_suspended');
    expect(suspended.every((r) => r.read_at !== null)).toBe(true);
    expect(readSignals.map((s) => s.userId)).toEqual([manager1]);

    // Suspended again before the worker read the "cleared" event: that event is overtaken.
    await owner.query(`DELETE FROM inbox_notifications`);
    await setGroup(groupA, { suspended: true });
    await consumer.handle(event(orgA, 'whatsapp.group.suspended', groupA, { suspended: false }));
    expect(await rows(orgA)).toEqual([]);
  });

  it('ignores the events that do not notify', async () => {
    for (const t of ['created', 'updated', 'deleted']) {
      await consumer.handle(event(orgA, `whatsapp.group.${t}`, groupA, { suspended: true }));
    }
    expect(await rows(orgA)).toEqual([]);
  });

  it('keeps tenants apart: the other workspace gets its own row from its own event', async () => {
    await setGroup(groupB, { pending: 1 });
    await consumer.handle(requested(groupB, 1, undefined, orgB));
    expect((await rows(orgB)).map((r) => Number(r.user_id))).toEqual([managerB]);
    expect(await rows(orgA)).toEqual([]);
  });
});
