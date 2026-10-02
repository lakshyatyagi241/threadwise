import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withTenant, type DbClient } from '@crm/db';
import { ConversationsRepository } from '../../../src/modules/chat-conversations/conversations.repository';
import { MessagesRepository } from '../../../src/modules/chat-conversations/messages.repository';

/**
 * The SQL of the message pipelines (the two repositories) against a real Postgres, as the restricted application role under row-level
 * security: the properties that are the database's, not the code's. The services around them are covered end to end in
 * test/e2e/chat-conversations; this is the part that cannot be faked with a mock.
 */
describe('message pipeline SQL: sequence allocation, ledger, receipts, isolation', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: DbClient;
  const conversations = new ConversationsRepository();
  const messages = new MessagesRepository();
  let orgA: number;
  let orgB: number;
  let chanA: number;
  let chanB: number;

  const one = async (sql: string, p: unknown[] = []) =>
    (await owner.query(sql, p)).rows[0] as Record<string, unknown>;
  const as = <T>(org: number, fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(app.db, { orgId: org }, fn);

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
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    const url = new URL(container.getConnectionUri());
    url.username = 'crm_app_user';
    url.password = 'test';
    app = createDbClient({ url: url.toString(), poolMax: 60 });

    orgA = Number(
      (
        await one(
          `INSERT INTO organizations (slug, name, plan) VALUES ('mp-a','A','starter') RETURNING id`,
        )
      ).id,
    );
    orgB = Number(
      (
        await one(
          `INSERT INTO organizations (slug, name, plan) VALUES ('mp-b','B','starter') RETURNING id`,
        )
      ).id,
    );
    const channel = async (org: number) =>
      Number(
        (
          await one(
            `INSERT INTO channels (org_id, kind, name) VALUES ($1,'simulator','c') RETURNING id`,
            [org],
          )
        ).id,
      );
    chanA = await channel(orgA);
    chanB = await channel(orgB);
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    await container?.stop();
  });

  /** What the inbound pipeline does to a thread and the stream for one message (the statements, in the order the service runs them). */
  const ingestOne = (org: number, channel: number, peer: string, providerId: string) =>
    as(org, async (tx) => {
      await conversations.lockPeer(tx, org, channel, peer);
      let conv = await conversations.findForUpdate(tx, org, channel, peer);
      if (!conv) {
        conv = await conversations.insert(tx, org, {
          channelId: channel,
          peerKey: peer,
          peerName: null,
          title: peer,
          contactId: null,
          needsContact: false,
        });
      }
      const alloc = await messages.allocate(tx);
      const fresh = await messages.ledgerInsert(tx, org, channel, 'provider_id', providerId, {
        messageId: alloc.id,
        messageCreatedAt: alloc.createdAt,
        conversationId: conv.id,
      });
      if (!fresh) return { stored: false as const };
      const { row } = await conversations.applyInbound(tx, org, conv.id, {
        messageId: alloc.id,
        arrivedAt: alloc.createdAt,
        customerAt: new Date(),
        preview: 'x',
        windowHours: 24,
        active: true,
      });
      await messages.insert(tx, org, {
        id: alloc.id,
        createdAt: alloc.createdAt,
        conversationId: conv.id,
        seq: row.msgSeq,
        direction: 'in',
        kind: 'text',
        senderKind: 'customer',
        body: 'x',
        status: 'received',
        providerMessageId: providerId,
      });
      return {
        stored: true as const,
        seq: row.msgSeq,
        id: alloc.id,
        createdAt: alloc.createdAt,
        convId: conv.id,
      };
    });

  it('50 messages at once on one thread, which does not exist yet: one thread, 50 distinct gap-free sequence numbers, 50 unread', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        ingestOne(orgA, chanA, '919000000001', `wamid.seq.${i}`),
      ),
    );
    expect(results.every((r) => r.stored)).toBe(true);
    const seqs = results.map((r) => (r.stored ? r.seq : 0)).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));

    const conv = await one(
      `SELECT * FROM conversations WHERE org_id = $1 AND peer_key = '919000000001'`,
      [orgA],
    );
    expect(conv).toMatchObject({ msg_seq: 50, unread_count: 50 });
    expect(
      Number(
        (
          await one(
            `SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND peer_key = '919000000001'`,
            [orgA],
          )
        ).n,
      ),
    ).toBe(1);
    const stored = (
      await owner.query(`SELECT seq FROM messages WHERE conversation_id = $1 ORDER BY seq`, [
        conv.id,
      ])
    ).rows;
    expect(stored.map((r) => Number(r.seq))).toEqual(seqs);
  }, 60_000);

  it('the same provider id delivered 20 times at once stores one message; the ledger names it exactly (partition key to the microsecond)', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => ingestOne(orgA, chanA, '919000000002', 'wamid.same')),
    );
    expect(results.filter((r) => r.stored)).toHaveLength(1);
    const first = results.find((r) => r.stored)!;
    if (!first.stored) throw new Error('unreachable');
    expect(
      Number(
        (
          await one(
            `SELECT count(*)::int AS n FROM messages WHERE provider_message_id = 'wamid.same' AND org_id = $1`,
            [orgA],
          )
        ).n,
      ),
    ).toBe(1);

    // Through the ledger a receipt finds the row by (id, created_at) without scanning partitions.
    const entry = await as(orgA, (tx) =>
      messages.ledgerFind(tx, orgA, chanA, 'provider_id', 'wamid.same'),
    );
    expect(entry).toEqual({
      messageId: first.id,
      messageCreatedAt: first.createdAt,
      conversationId: first.convId,
    });
    const row = await as(orgA, (tx) => messages.byLedger(tx, orgA, entry!));
    expect(row).toMatchObject({ id: first.id, status: 'received', seq: 1 });
  });

  describe('receipts: the status only moves forward, in one conditional UPDATE', () => {
    /** An outbound message in `queued` with its provider id in the ledger, the way the dispatch worker leaves a sent one. */
    const outbound = async (providerId: string, status = 'sent') => {
      const conv = await one(
        `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,$3,'t') RETURNING id`,
        [orgA, chanA, `r${providerId}`],
      );
      const made = await as(orgA, async (tx) => {
        const alloc = await messages.allocate(tx);
        await messages.insert(tx, orgA, {
          id: alloc.id,
          createdAt: alloc.createdAt,
          conversationId: Number(conv.id),
          seq: 1,
          direction: 'out',
          kind: 'text',
          senderKind: 'agent',
          body: 'hi',
          status: 'queued',
        });
        await messages.ledgerInsert(tx, orgA, chanA, 'provider_id', providerId, {
          messageId: alloc.id,
          messageCreatedAt: alloc.createdAt,
          conversationId: Number(conv.id),
        });
        if (status !== 'queued') {
          await messages.markSent(
            tx,
            orgA,
            { id: alloc.id, createdAt: alloc.createdAt },
            {
              providerMessageId: providerId,
              acceptedAt: new Date(),
            },
          );
        }
        return { id: alloc.id, createdAt: alloc.createdAt };
      });
      return made;
    };
    const receipt = (
      ref: { id: number; createdAt: string },
      status: 'sent' | 'delivered' | 'read' | 'failed',
      at = new Date(),
    ) => as(orgA, (tx) => messages.applyReceipt(tx, orgA, ref, { status, at }));
    const state = async (ref: { id: number }) =>
      one(
        `SELECT status, sent_at, delivered_at, read_at, failure_code FROM messages WHERE id = $1`,
        [ref.id],
      );

    it('every order of the three steps ends at read, and a refused step still leaves its time', async () => {
      const orders: Array<Array<'sent' | 'delivered' | 'read'>> = [
        ['sent', 'delivered', 'read'],
        ['read', 'delivered', 'sent'],
        ['delivered', 'read', 'sent'],
        ['read', 'sent', 'delivered'],
      ];
      for (const [i, order] of orders.entries()) {
        const ref = await outbound(`wamid.order.${i}`);
        const outcomes: string[] = [];
        for (const step of order) outcomes.push(await receipt(ref, step));
        const s = await state(ref);
        expect(s.status, order.join(' > ')).toBe('read');
        expect(s.sent_at).not.toBeNull();
        expect(s.delivered_at).not.toBeNull();
        expect(s.read_at).not.toBeNull();
        // The first step of a descending order advances; a repeat of the final state never does.
        expect(await receipt(ref, 'read')).toBe('ignored');
      }
    });

    it('failed only from queued or sent, never over a delivery, and nothing leaves failed', async () => {
      const sent = await outbound('wamid.f.sent');
      expect(await receipt(sent, 'failed')).toBe('advanced');
      expect(await receipt(sent, 'read')).toBe('ignored');
      expect(await receipt(sent, 'sent')).toBe('ignored');
      expect((await state(sent)).status).toBe('failed');

      const delivered = await outbound('wamid.f.delivered');
      await receipt(delivered, 'delivered');
      expect(await receipt(delivered, 'failed')).toBe('ignored');
      expect((await state(delivered)).status).toBe('delivered');

      const queued = await outbound('wamid.f.queued', 'queued');
      expect(await receipt(queued, 'failed')).toBe('advanced');
    });

    it('a receipt for a message that is not there (or is not outbound) is missing, and changes nothing', async () => {
      expect(await receipt({ id: 999_999_999, createdAt: '2026-10-02 10:00:00+00' }, 'read')).toBe(
        'missing',
      );
      const inbound = await as(orgA, async (tx) => {
        const conv = await conversations.findForUpdate(tx, orgA, chanA, '919000000001');
        const [m] = (await messages.thread(tx, orgA, conv!.id, { limit: 1 })).rows;
        return { id: m!.id, createdAt: m!.createdAtText };
      });
      expect(await receipt(inbound, 'read')).toBe('missing');
      expect((await state(inbound)).status).toBe('received');
    });

    it('sending a message twice (a retried job) changes nothing the second time', async () => {
      const ref = await outbound('wamid.twice', 'queued');
      const send = () =>
        as(orgA, (tx) =>
          messages.markSent(tx, orgA, ref, {
            providerMessageId: 'wamid.twice',
            acceptedAt: new Date(),
          }),
        );
      expect(await send()).toBe(true);
      expect(await send()).toBe(false);
    });
  });

  it('unread is the customer messages after the seq, and never goes up', async () => {
    const conv = await one(
      `SELECT id FROM conversations WHERE org_id = $1 AND peer_key = '919000000001'`,
      [orgA],
    );
    const after = (seq: number) =>
      as(orgA, (tx) => conversations.setUnreadAfter(tx, orgA, Number(conv.id), seq));
    expect(await after(30)).toBe(20);
    expect(await after(10)).toBe(20);
    expect(await after(50)).toBe(0);
    expect(await after(0)).toBe(0);
  });

  describe('isolation, as the restricted role', () => {
    it('another workspace sees none of the thread, the stream, the ledger or the events, and cannot touch them', async () => {
      const conv = await one(
        `SELECT id, uuid FROM conversations WHERE org_id = $1 AND peer_key = '919000000001'`,
        [orgA],
      );
      const entry = await as(orgA, (tx) =>
        messages.ledgerFind(tx, orgA, chanA, 'provider_id', 'wamid.same'),
      );
      expect(entry).not.toBeNull();

      await as(orgB, async (tx) => {
        expect(await conversations.byUuid(tx, orgB, conv.uuid as string)).toBeNull();
        expect(await conversations.byId(tx, orgB, Number(conv.id))).toBeNull();
        // Even naming the other workspace's id: RLS answers for its own.
        expect(await conversations.byId(tx, orgA, Number(conv.id))).toBeNull();
        expect(await messages.ledgerFind(tx, orgB, chanB, 'provider_id', 'wamid.same')).toBeNull();
        expect(await messages.ledgerFind(tx, orgA, chanA, 'provider_id', 'wamid.same')).toBeNull();
        expect(await messages.byLedger(tx, orgA, entry!)).toBeNull();
        expect((await messages.thread(tx, orgA, Number(conv.id), { limit: 10 })).rows).toEqual([]);
        expect(
          await messages.applyReceipt(
            tx,
            orgA,
            { id: entry!.messageId, createdAt: entry!.messageCreatedAt },
            { status: 'failed', at: new Date() },
          ),
        ).toBe('missing');
        expect(await conversations.setUnreadAfter(tx, orgA, Number(conv.id), 0)).toBe(0);
      });
      // Nothing of A moved.
      expect(
        Number(
          (await one(`SELECT unread_count FROM conversations WHERE id = $1`, [conv.id]))
            .unread_count,
        ),
      ).toBe(0);
      expect(
        (await one(`SELECT status FROM messages WHERE id = $1`, [entry!.messageId])).status,
      ).toBe('received');
    });

    it('a write that names another workspace is refused by the policy, not silently accepted', async () => {
      const alloc = await as(orgB, (tx) => messages.allocate(tx));
      await expect(
        as(orgB, (tx) =>
          messages.ledgerInsert(tx, orgA, chanA, 'provider_id', 'wamid.smuggled', {
            messageId: alloc.id,
            messageCreatedAt: alloc.createdAt,
            conversationId: 1,
          }),
        ),
      ).rejects.toThrow(/row-level security|violates/i);
      await expect(
        as(orgB, (tx) =>
          messages.insertEvent(
            tx,
            orgA,
            { id: alloc.id, createdAt: alloc.createdAt },
            'queued',
            {},
          ),
        ),
      ).rejects.toThrow(/row-level security|violates/i);
    });

    it('the monthly count covers one workspace only: sends of another never count against it', async () => {
      const monthStart = new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
      );
      const expected = Number(
        (
          await one(
            `SELECT count(*)::int AS n FROM messages WHERE org_id = $1 AND direction = 'out' AND status <> 'failed'`,
            [orgA],
          )
        ).n,
      );
      expect(expected).toBeGreaterThan(0);
      expect(await as(orgA, (tx) => messages.monthlyMeteredOutbound(tx, orgA, monthStart))).toBe(
        expected,
      );
      expect(await as(orgB, (tx) => messages.monthlyMeteredOutbound(tx, orgB, monthStart))).toBe(0);
      // Last month's messages are not this month's: a window that starts after every row counts none.
      expect(
        await as(orgA, (tx) =>
          messages.monthlyMeteredOutbound(tx, orgA, new Date(Date.now() + 86_400_000)),
        ),
      ).toBe(0);
    });
  });
});
