import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import { DatabaseService } from '../../src/infra/db/database.service';
import { WabaOrderAckConsumer } from '../../src/modules/whatsapp-cloud-api-waba/waba-order-ack.consumer';

/**
 * The order acknowledgement is claimed once per order, durably, on the order row (ASYNC-022/025), against a real Postgres as the
 * application role. The outbox reruns every subscriber of an event when any one fails, for hours, so the same event reaches this
 * consumer again and again; the customer must get one message.
 */
describe('order acknowledgement claim', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let clients: DbClientPair;
  let svc: WabaOrderAckConsumer;
  const ack = { acknowledge: vi.fn() };
  let orgA = 0;
  let orgB = 0;
  const ORDER = '6f1c5b8e-0000-4000-8000-000000000001';

  const event = (orgId: number, orderId = ORDER) => ({
    id: '1',
    orgId,
    aggregateModule: 'wa_orders',
    aggregateId: '1',
    eventType: 'whatsapp.order.received',
    payload: { orderId },
  });
  const newOrder = async (orgId: number, uuid = ORDER) =>
    owner.query(
      `INSERT INTO wa_orders (org_id, uuid, source, customer_phone, items_json, total_minor)
       VALUES ($1, $2, 'whatsapp', '+911234567890', '[]', 1000)`,
      [orgId, uuid],
    );
  const claim = async (orgId: number) =>
    (
      await owner.query<{ ack_claimed_at: Date | null; ack_sent_at: Date | null }>(
        `SELECT ack_claimed_at, ack_sent_at FROM wa_orders WHERE org_id = $1 AND uuid = $2`,
        [orgId, ORDER],
      )
    ).rows[0]!;

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
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../packages/db/migrations'),
      log: () => undefined,
    });
    const org = async (slug: string) =>
      (
        await owner.query<{ id: number }>(
          `INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`,
          [slug],
        )
      ).rows[0]!.id;
    orgA = await org('a');
    orgB = await org('b');
    clients = createDbClientPair({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 4,
    });
    svc = new WabaOrderAckConsumer(
      { register: vi.fn() } as never,
      new DatabaseService(clients),
      ack as never,
    );
  }, 180_000);

  afterAll(async () => {
    await clients?.close();
    await owner?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await owner.query(`DELETE FROM wa_orders`);
    ack.acknowledge.mockReset().mockResolvedValue(true);
    await newOrder(orgA);
  });

  it('sends once however many times the event is redelivered, and records when', async () => {
    await svc.handle(event(orgA));
    await svc.handle(event(orgA));
    await svc.handle(event(orgA));
    expect(ack.acknowledge).toHaveBeenCalledTimes(1);
    const c = await claim(orgA);
    expect(c.ack_sent_at).not.toBeNull();
  });

  it('two redeliveries at the same time still send once', async () => {
    ack.acknowledge.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 200));
      return true;
    });
    await Promise.all([svc.handle(event(orgA)), svc.handle(event(orgA))]);
    expect(ack.acknowledge).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when nothing was sent, so a later redelivery can try again', async () => {
    ack.acknowledge.mockResolvedValueOnce(false).mockResolvedValue(true);
    await svc.handle(event(orgA));
    expect((await claim(orgA)).ack_claimed_at).toBeNull();
    await svc.handle(event(orgA));
    expect(ack.acknowledge).toHaveBeenCalledTimes(2);
    expect((await claim(orgA)).ack_sent_at).not.toBeNull();
  });

  it('does not re-claim a fresh claim, but takes over one whose worker died mid-send', async () => {
    await owner.query(`UPDATE wa_orders SET ack_claimed_at = now() WHERE uuid = $1`, [ORDER]);
    await svc.handle(event(orgA));
    expect(ack.acknowledge).not.toHaveBeenCalled();

    await owner.query(
      `UPDATE wa_orders SET ack_claimed_at = now() - interval '11 minutes' WHERE uuid = $1`,
      [ORDER],
    );
    await svc.handle(event(orgA));
    expect(ack.acknowledge).toHaveBeenCalledTimes(1);
  });

  it('never sends for an order that is already acknowledged', async () => {
    await owner.query(`UPDATE wa_orders SET ack_sent_at = now() WHERE uuid = $1`, [ORDER]);
    await svc.handle(event(orgA));
    expect(ack.acknowledge).not.toHaveBeenCalled();
  });

  it("an event of one workspace cannot claim another workspace's order", async () => {
    await svc.handle(event(orgB));
    expect(ack.acknowledge).not.toHaveBeenCalled();
    expect((await claim(orgA)).ack_claimed_at).toBeNull();
  });
});
