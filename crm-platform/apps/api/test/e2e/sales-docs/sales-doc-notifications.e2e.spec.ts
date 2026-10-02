import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
} from '../../../src/kernel/outbox/outbox-subscribers';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository';
import { SalesDocNotificationConsumer } from '../../../src/modules/notifications/salesdoc-notification.consumer';
import { DealsApi, startHarness, type Harness, type Tenant } from '../deals-pipelines/support';

/**
 * TW-PROP-017: the buyer's decision on a proposal or an estimate notifies the document's owner and creator (Reference wrote one in-app
 * row each). The HTTP app does not run the worker, so the consumer is wired to a registry here and fed the real outbox rows, the
 * same way the task notifications are tested.
 */
let h: Harness;
let api: DealsApi;
let registry: OutboxSubscriberRegistry;

beforeAll(async () => {
  h = await startHarness();
  api = new DealsApi(h);
  registry = new OutboxSubscriberRegistry();
  new SalesDocNotificationConsumer(
    h.app.get(DatabaseService),
    new NotificationsRepository(),
    registry,
  ).onModuleInit();
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

async function deliverEvents(orgId: number): Promise<void> {
  const res = await h.owner.query(
    `SELECT id, org_id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
     WHERE org_id = $1 AND event_type LIKE 'salesdoc.%' ORDER BY id`,
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
}

interface Notification {
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  data: Record<string, unknown> | null;
}
async function feed(token: string): Promise<Notification[]> {
  const res = await api.as(token).get('/v2/notifications');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as Notification[];
}

let ipN = 1;
const pub = (path: string, method: 'get' | 'post' = 'get') =>
  api
    .http()
    [method](`/v2/public/sales-docs/${path}`)
    .set('x-forwarded-for', `10.99.0.${ipN++ % 250}`);

const WORKER = [
  ['record.sales-docs.read', 'all'],
  ['record.sales-docs.create'],
  ['record.sales-docs.update', 'all'],
  ['record.sales-docs.send', 'all'],
] as Array<[string, ('all' | 'team' | 'own')?]>;

describe('quote decision notifications', () => {
  let t: Tenant;
  let ana: { token: string; userId: number };
  let anaUuid: string;

  beforeAll(async () => {
    t = await api.signup('sdn');
    ana = await api.member(t, 'Ana', WORKER);
    anaUuid = await api.userUuid(ana.userId);
  });

  async function openDoc(body: Record<string, unknown> = {}) {
    const created = await api
      .as(t.admin)
      .post('/v2/sales-docs')
      .send({
        kind: 'estimate',
        title: 'Kitchen fit-out',
        buyerName: 'Priya',
        lines: [{ description: 'Work', qty: '1', unitPrice: '100' }],
        ...body,
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    expect(
      (await api.as(t.admin).post(`/v2/sales-docs/${id}/send`).send({ channel: 'link' })).status,
    ).toBe(200);
    const link = await api.as(t.admin).get(`/v2/sales-docs/${id}/link`);
    return { id, token: link.body.token as string, number: created.body.number as string };
  }

  it('an accepted document notifies its owner and its creator, once each however often the events are delivered', async () => {
    const d = await openDoc({ ownerId: anaUuid });
    const res = await pub(`${d.token}/accept`, 'post').send({ signerName: 'Priya', consent: true });
    expect(res.status).toBe(200);
    await deliverEvents(t.orgId);
    await deliverEvents(t.orgId);

    const mine = (await feed(ana.token)).filter((n) => n.link?.endsWith(d.id));
    const theirs = (await feed(t.admin)).filter((n) => n.link?.endsWith(d.id));
    for (const rows of [mine, theirs]) {
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: 'sales_doc_decided',
        title: 'Estimate accepted',
        link: `/estimates/${d.id}`,
        data: { salesDocId: d.id, kind: 'estimate', number: d.number, status: 'accepted' },
      });
      expect(rows[0]!.body).toContain('Kitchen fit-out');
    }
  });

  it('a declined document notifies with its own wording; when the owner is the creator there is one notification', async () => {
    const d = await openDoc({ kind: 'proposal', title: 'Roof' });
    const res = await pub(`${d.token}/decline`, 'post').send({ reason: 'Too dear' });
    expect(res.status).toBe(200);
    await deliverEvents(t.orgId);
    const rows = (await feed(t.admin)).filter((n) => n.link?.endsWith(d.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Proposal declined',
      link: `/proposals/${d.id}`,
      data: { status: 'declined' },
    });
    expect((await feed(ana.token)).filter((n) => n.link?.endsWith(d.id))).toHaveLength(0);
  });

  it('a decision recorded by staff, or a document deleted before delivery, notifies nobody', async () => {
    const staff = await openDoc({ title: 'Recorded by staff' });
    expect((await api.as(t.admin).post(`/v2/sales-docs/${staff.id}/accept`).send({})).status).toBe(
      200,
    );
    const gone = await openDoc({ title: 'Deleted later' });
    expect((await pub(`${gone.token}/decline`, 'post').send({ signerName: 'Priya' })).status).toBe(
      200,
    );
    expect((await api.as(t.admin).delete(`/v2/sales-docs/${gone.id}`)).status).toBe(204);
    await deliverEvents(t.orgId);
    const all = await feed(t.admin);
    expect(all.filter((n) => n.link?.endsWith(staff.id))).toHaveLength(0);
    expect(all.filter((n) => n.link?.endsWith(gone.id))).toHaveLength(0);
  });

  it('another workspace sees none of it', async () => {
    const other = await api.signup('sdo');
    await deliverEvents(other.orgId);
    expect((await feed(other.admin)).filter((n) => n.type === 'sales_doc_decided')).toHaveLength(0);
  });
});
