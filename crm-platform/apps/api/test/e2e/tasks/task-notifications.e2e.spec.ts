import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
} from '../../../src/kernel/outbox/outbox-subscribers';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { TaskDueSweepService } from '../../../src/modules/crm/tasks/task-due-sweep.service';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository';
import { TaskNotificationConsumer } from '../../../src/modules/notifications/task-notification.consumer';
import { DealsApi, startHarness, type Harness, type Tenant } from '../deals-pipelines/support';

/**
 * The in-app notification feed (the header bell) and the consumer that fills it from task events: assigned, due and
 * completed, with the properties a consumer of an at-least-once outbox must have (idempotent, tenant- and person-scoped).
 * The HTTP app does not run the worker, so the consumer is wired to a registry here and fed the real outbox rows.
 */
let h: Harness;
let api: DealsApi;
let registry: OutboxSubscriberRegistry;
let sweep: TaskDueSweepService;

beforeAll(async () => {
  h = await startHarness();
  api = new DealsApi(h);
  registry = new OutboxSubscriberRegistry();
  const consumer = new TaskNotificationConsumer(
    h.app.get(DatabaseService),
    new NotificationsRepository(),
    registry,
  );
  consumer.onModuleInit();
  sweep = new TaskDueSweepService(h.app.get(DatabaseService), h.app.get(OutboxService));
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

/** What the worker's drain loop does, for one workspace: every task event in the outbox goes to the registry. */
async function deliverEvents(orgId: number): Promise<number> {
  const res = await h.owner.query(
    `SELECT id, org_id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
     WHERE org_id = $1 AND event_type LIKE 'task.%' ORDER BY id`,
    [orgId],
  );
  for (const r of res.rows) {
    const event: OutboxEvent = {
      id: String(r.id),
      orgId: Number(r.org_id),
      aggregateModule: r.aggregate_module,
      aggregateId: String(r.aggregate_id),
      eventType: r.event_type,
      payload: r.payload,
    };
    await registry.dispatch(event);
  }
  return res.rows.length;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}
interface Feed {
  data: Notification[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
  meta: { unread: number };
}

async function feed(token: string, qs = ''): Promise<Feed> {
  const res = await api.as(token).get(`/v2/notifications${qs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Feed;
}

const WORKER = [
  ['record.tasks.read', 'all'],
  ['record.tasks.create'],
  ['record.tasks.update', 'all'],
] as Array<[string, ('all' | 'team' | 'own')?]>;

async function task(token: string, body: Record<string, unknown>) {
  const res = await api.as(token).post('/v2/tasks').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; title: string };
}

describe('task notifications', () => {
  let t: Tenant;
  let ana: { token: string; userId: number };
  let anaUuid: string;
  let adminUuid: string;

  beforeAll(async () => {
    t = await api.signup('ntf');
    ana = await api.member(t, 'Ana', WORKER);
    anaUuid = await api.userUuid(ana.userId);
    adminUuid = await api.userUuid(t.adminUserId);
  });

  it('assigning a task notifies the assignee, once however often the event is delivered', async () => {
    const x = await task(t.admin, { title: 'Call the supplier', assigneeId: anaUuid });
    await deliverEvents(t.orgId);
    await deliverEvents(t.orgId);
    await deliverEvents(t.orgId);

    const mine = await feed(ana.token);
    expect(mine.data).toHaveLength(1);
    expect(mine.meta.unread).toBe(1);
    expect(mine.data[0]).toMatchObject({
      type: 'task_assigned',
      title: 'Task assigned to you',
      readAt: null,
      link: `/tasks?task=${x.id}`,
      data: { taskId: x.id, taskTitle: 'Call the supplier', actorName: 'Admin Person' },
    });
    expect(mine.data[0]!.body).toContain('Admin Person assigned you: Call the supplier');
    // The creator assigned it to someone else: nothing for them.
    expect((await feed(t.admin)).data).toHaveLength(0);
  });

  it('assigning to yourself notifies nobody', async () => {
    const before = (await feed(t.admin)).meta.unread;
    await task(t.admin, { title: 'My own errand', assigneeId: adminUuid });
    await deliverEvents(t.orgId);
    expect((await feed(t.admin)).meta.unread).toBe(before);
  });

  it('reassigning notifies the new assignee, and assigning back later notifies again (each real event counts)', async () => {
    const x = await task(t.admin, { title: 'Ping pong', assigneeId: adminUuid });
    await deliverEvents(t.orgId);
    const base = (await feed(ana.token)).meta.unread;
    const patch = async (assigneeId: string, rowVersion: number) =>
      (await api.as(t.admin).patch(`/v2/tasks/${x.id}`).send({ assigneeId, rowVersion })).body;
    const first = await patch(anaUuid, 1);
    await deliverEvents(t.orgId);
    expect((await feed(ana.token)).meta.unread).toBe(base + 1);
    const second = await patch(adminUuid, first.rowVersion);
    await patch(anaUuid, second.rowVersion);
    await deliverEvents(t.orgId);
    expect((await feed(ana.token)).meta.unread).toBe(base + 2);
  });

  it('the creator is told when someone else completes the task, and not when they do it themselves', async () => {
    const x = await task(t.admin, { title: 'Send the quote', assigneeId: anaUuid });
    const done = await api.as(ana.token).post(`/v2/tasks/${x.id}/complete`).send({});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    await deliverEvents(t.orgId);
    const got = (await feed(t.admin)).data.filter((n) => n.type === 'task_completed');
    expect(got).toHaveLength(1);
    expect(got[0]!.body).toBe('Ana completed: Send the quote');

    const mine = await task(t.admin, { title: 'Self done', assigneeId: adminUuid });
    await api.as(t.admin).post(`/v2/tasks/${mine.id}/complete`).send({});
    await deliverEvents(t.orgId);
    expect((await feed(t.admin)).data.filter((n) => n.type === 'task_completed')).toHaveLength(1);
  });

  it('the due sweep notifies the assignee (else the creator) once, and a task completed meanwhile is dropped', async () => {
    const overdue = new Date(Date.now() - 3_600_000).toISOString();
    const assigned = await task(t.admin, {
      title: 'Overdue for Ana',
      assigneeId: anaUuid,
      dueAt: overdue,
    });
    const orphan = await task(t.admin, {
      title: 'Nobody has it',
      assigneeId: null,
      dueAt: overdue,
    });
    const finished = await task(t.admin, {
      title: 'Done in time',
      assigneeId: anaUuid,
      dueAt: overdue,
    });
    await sweep.sweep();
    // Completed after the sweep stamped it but before the consumer ran.
    await api.as(ana.token).post(`/v2/tasks/${finished.id}/complete`).send({});
    await deliverEvents(t.orgId);
    await deliverEvents(t.orgId);

    const ana1 = (await feed(ana.token)).data.filter((n) => n.type === 'task_due');
    expect(ana1.map((n) => (n.data as { taskId: string }).taskId)).toEqual([assigned.id]);
    const admin1 = (await feed(t.admin)).data.filter((n) => n.type === 'task_due');
    expect(admin1.map((n) => (n.data as { taskId: string }).taskId)).toEqual([orphan.id]);
  });

  it('a notification about a task that has since moved to someone else is not sent late', async () => {
    const x = await task(t.admin, { title: 'Quick change', assigneeId: anaUuid });
    const moved = await api
      .as(t.admin)
      .patch(`/v2/tasks/${x.id}`)
      .send({ assigneeId: adminUuid, rowVersion: 1 });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    await deliverEvents(t.orgId);
    const forTask = (await feed(ana.token, '?limit=50')).data.filter(
      (n) => (n.data as { taskId?: string } | null)?.taskId === x.id,
    );
    expect(forTask).toHaveLength(0);
  });

  it('GET /notifications pages newest first with the true unread total, and unreadOnly narrows', async () => {
    const all = await feed(ana.token, '?limit=2');
    expect(all.data).toHaveLength(2);
    expect(all.page.hasMore).toBe(true);
    const next = await feed(ana.token, `?limit=50&cursor=${all.page.nextCursor}`);
    const ids = [...all.data, ...next.data].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const times = [...all.data, ...next.data].map((n) => n.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(all.meta.unread).toBe(next.meta.unread);

    const count = await api.as(ana.token).get('/v2/notifications/unread-count');
    expect(count.body).toEqual({ unread: all.meta.unread });

    await api.as(ana.token).post(`/v2/notifications/${all.data[0]!.id}/read`).send({});
    const unread = await feed(ana.token, '?unreadOnly=true&limit=50');
    expect(unread.data.every((n) => n.readAt === null)).toBe(true);
    expect(unread.data).toHaveLength(all.meta.unread - 1);
    const bad = await api.as(ana.token).get('/v2/notifications?cursor=%%%');
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });

  it('marking read is idempotent, and read-all clears the badge', async () => {
    const list = await feed(ana.token, '?limit=50');
    const target = list.data[0]!;
    const a = await api.as(ana.token).post(`/v2/notifications/${target.id}/read`).send({});
    const b = await api.as(ana.token).post(`/v2/notifications/${target.id}/read`).send({});
    expect(a.status).toBe(200);
    expect(b.body.readAt).toBe(a.body.readAt);

    const all = await api.as(ana.token).post('/v2/notifications/read-all').send({});
    expect(all.status).toBe(200);
    expect(all.body.updated).toBeGreaterThanOrEqual(0);
    expect((await feed(ana.token)).meta.unread).toBe(0);
    expect((await api.as(ana.token).post('/v2/notifications/read-all').send({})).body).toEqual({
      updated: 0,
    });
  });

  it('a person cannot read or mark another person’s notification, nor another workspace’s', async () => {
    const x = await task(t.admin, { title: 'Private to Ana', assigneeId: anaUuid });
    await deliverEvents(t.orgId);
    const hers = (await feed(ana.token, '?unreadOnly=true')).data.find(
      (n) => (n.data as { taskId?: string } | null)?.taskId === x.id,
    )!;
    expect(hers).toBeTruthy();

    const adminTries = await api.as(t.admin).post(`/v2/notifications/${hers.id}/read`).send({});
    expect(adminTries.status).toBe(404);
    expect((await feed(t.admin)).data.map((n) => n.id)).not.toContain(hers.id);

    const other = await api.signup('ntf2');
    const cross = await api.as(other.admin).post(`/v2/notifications/${hers.id}/read`).send({});
    expect(cross.status).toBe(404);
    expect((await feed(other.admin)).data).toHaveLength(0);
    const stillUnread = (await feed(ana.token, '?unreadOnly=true')).data.map((n) => n.id);
    expect(stillUnread).toContain(hers.id);
  });

  it('inbox_notifications has forced row level security and the idempotency index', async () => {
    const rls = await h.owner.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'inbox_notifications'`,
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const idx = await h.owner.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = 'inbox_notifications' AND indexname = 'uq_inbox_notifications_dedupe'`,
    );
    expect(idx.rowCount).toBe(1);
  });
});
