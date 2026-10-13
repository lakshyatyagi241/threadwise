import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withTenant, type DbClient } from '@crm/db';
import { ConversationsRepository } from '../../../src/modules/chat-conversations/conversations.repository';
import { MessagesRepository } from '../../../src/modules/chat-conversations/messages.repository';
import { LeadScoringRepository } from '../../../src/modules/lead-scoring/lead-scoring.repository';

/**
 * Two properties that belong to the database, against a real Postgres as the restricted application role under row-level security:
 *
 *  1. the chat stamps `contacts.last_activity_at` (a customer message, a staff reply) as a bookkeeping write: it moves forward at most
 *     once a minute, and it does not move `row_version` or `updated_at` (an open edit form must not 409 while the customer types);
 *  2. the engagement facts the lead scorer sends to the model are counted from the right rows (broadcasts, tracked links, the contact's
 *     own messages) and from nothing else (bots, history imports, reactions, deleted messages, group threads, other workspaces).
 */
describe('contact activity stamp and the lead scorer engagement facts', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: DbClient;
  const conversations = new ConversationsRepository();
  const messages = new MessagesRepository();
  const scoring = new LeadScoringRepository();
  let orgA: number;
  let orgB: number;
  let chanA: number;
  let seqCounter = 0;

  const one = async (sql: string, p: unknown[] = []) =>
    (await owner.query(sql, p)).rows[0] as Record<string, unknown>;
  const as = <T>(org: number, fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(app.db, { orgId: org }, fn);

  const newContact = async (org: number, name: string): Promise<number> =>
    Number(
      (
        await one(
          `INSERT INTO contacts (org_id, uuid, name) VALUES ($1, gen_random_uuid(), $2) RETURNING id`,
          [org, name],
        )
      ).id,
    );
  const newConversation = async (
    org: number,
    channel: number,
    contactId: number | null,
    peer: string,
  ): Promise<number> =>
    Number(
      (
        await one(
          `INSERT INTO conversations (org_id, channel_id, peer_key, title, contact_id) VALUES ($1,$2,$3,$3,$4) RETURNING id`,
          [org, channel, peer, contactId],
        )
      ).id,
    );
  const contactRow = async (id: number) =>
    one(`SELECT last_activity_at, row_version, updated_at, title FROM contacts WHERE id = $1`, [
      id,
    ]);

  /** One message, written by hand with a chosen age so a window can be tested. `ago` is a Postgres interval. */
  const say = async (
    org: number,
    conversationId: number,
    m: {
      direction: 'in' | 'out';
      sender: 'customer' | 'agent' | 'bot' | 'broadcast';
      ago: string;
      kind?: string;
      meta?: Record<string, unknown>;
      deleted?: boolean;
      /** When it was really said, if that differs from when the row was written (a history import). Default: same as `ago`. */
      said?: string;
    },
  ) => {
    await owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, created_at, provider_ts, meta, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, '${m.direction === 'in' ? 'received' : 'sent'}', now() - $7::interval, now() - $9::interval, $8::jsonb, ${m.deleted ? 'now()' : 'NULL'})`,
      [
        org,
        conversationId,
        ++seqCounter,
        m.direction,
        m.kind ?? 'text',
        m.sender,
        m.ago,
        JSON.stringify(m.meta ?? {}),
        m.said ?? m.ago,
      ],
    );
  };

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
    app = createDbClient({ url: url.toString(), poolMax: 20 });

    const org = async (slug: string) =>
      Number(
        (
          await one(
            `INSERT INTO organizations (slug, name, plan) VALUES ($1,$1,'starter') RETURNING id`,
            [slug],
          )
        ).id,
      );
    orgA = await org('eng-a');
    orgB = await org('eng-b');
    chanA = Number(
      (
        await one(
          `INSERT INTO channels (org_id, kind, name) VALUES ($1,'simulator','c') RETURNING id`,
          [orgA],
        )
      ).id,
    );
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    await container?.stop();
  });

  describe('last_activity_at is stamped by the chat', () => {
    const inbound = (org: number, conversationId: number) =>
      as(org, async (tx) => {
        const alloc = await messages.allocate(tx);
        return conversations.applyInbound(tx, org, conversationId, {
          messageId: alloc.id,
          arrivedAt: alloc.createdAt,
          customerAt: new Date(),
          preview: 'x',
          windowHours: 24,
          active: true,
        });
      });

    it('a customer message moves it without touching row_version or updated_at; a burst is one write', async () => {
      const contact = await newContact(orgA, 'Asha');
      const conv = await newConversation(orgA, chanA, contact, '919100000001');
      const before = await contactRow(contact);
      expect(before.last_activity_at).toBeNull();

      await inbound(orgA, conv);
      const first = await contactRow(contact);
      expect(first.last_activity_at).not.toBeNull();
      expect(first.row_version).toBe(before.row_version);
      expect(first.updated_at).toEqual(before.updated_at);

      // A second message inside the minute leaves the stamp where it was.
      await inbound(orgA, conv);
      expect((await contactRow(contact)).last_activity_at).toEqual(first.last_activity_at);

      // Past the minute it moves forward again, still as a bookkeeping write.
      await owner.query(
        `UPDATE contacts SET last_activity_at = now() - interval '5 minutes' WHERE id = $1`,
        [contact],
      );
      await inbound(orgA, conv);
      const later = await contactRow(contact);
      expect(new Date(later.last_activity_at as string).getTime()).toBeGreaterThan(
        Date.now() - 60_000,
      );
      expect(later.row_version).toBe(before.row_version);
      expect(later.updated_at).toEqual(before.updated_at);
    }, 60_000);

    it('an ordinary edit still moves row_version, also when it is written together with the stamp', async () => {
      const contact = await newContact(orgA, 'Bala');
      const before = await contactRow(contact);
      await owner.query(`UPDATE contacts SET title = 'CTO' WHERE id = $1`, [contact]);
      expect((await contactRow(contact)).row_version).toBe(Number(before.row_version) + 1);
      await owner.query(
        `UPDATE contacts SET title = 'CEO', last_activity_at = now() WHERE id = $1`,
        [contact],
      );
      expect((await contactRow(contact)).row_version).toBe(Number(before.row_version) + 2);
    });

    it('a thread without a contact (a group) stamps nobody', async () => {
      const stranger = await newContact(orgA, 'Chandra');
      const group = await newConversation(orgA, chanA, null, '120363000000000001@g.us');
      await inbound(orgA, group);
      expect((await contactRow(stranger)).last_activity_at).toBeNull();
    });

    it('a staff reply stamps the contact, a bot reply and an imported history message do not', async () => {
      const contact = await newContact(orgA, 'Deepa');
      const conv = await newConversation(orgA, chanA, contact, '919100000004');

      await as(orgA, (tx) =>
        conversations.applyOutboundSent(tx, orgA, conv, { at: new Date(), humanReply: false }),
      );
      expect((await contactRow(contact)).last_activity_at).toBeNull();

      await as(orgA, async (tx) => {
        const alloc = await messages.allocate(tx);
        await conversations.applyHistory(tx, orgA, conv, {
          messageId: alloc.id,
          at: alloc.createdAt,
          inbound: true,
          windowHours: 24,
          preview: 'old',
        });
      });
      expect((await contactRow(contact)).last_activity_at).toBeNull();

      await as(orgA, (tx) =>
        conversations.applyOutboundSent(tx, orgA, conv, { at: new Date(), humanReply: true }),
      );
      expect((await contactRow(contact)).last_activity_at).not.toBeNull();
    }, 60_000);
  });

  describe('engagement facts', () => {
    const factsOf = async (org: number, contactId: number) => {
      const c = await as(org, (tx) => scoring.contactForScoring(tx, org, contactId));
      if (!c) throw new Error('contact missing');
      return c.facts;
    };

    it('a contact nobody has talked to reads as no engagement, not as an error', async () => {
      const contact = await newContact(orgA, 'Esha');
      const f = await factsOf(orgA, contact);
      expect(f.engagement).toEqual({
        broadcastsReceived30d: 0,
        broadcastsRead30d: 0,
        linksClicked30d: 0,
        messagesFromContact7d: 0,
        hoursSinceLastInbound: null,
        avgReplyMinutes30d: null,
      });
      expect(f.daysInStage).toBe(0);
    });

    it('days in stage counts from the stage date, else from creation', async () => {
      const contact = await newContact(orgA, 'Farid');
      await owner.query(
        `UPDATE contacts SET lifecycle_stage_date = now() - interval '12 days 3 hours' WHERE id = $1`,
        [contact],
      );
      expect((await factsOf(orgA, contact)).daysInStage).toBe(12);
    });

    it('broadcasts and tracked links are counted inside 30 days, by the receipts they carry', async () => {
      const contact = await newContact(orgA, 'Gita');
      const other = await newContact(orgA, 'Hari');
      const b = Number(
        (await one(`INSERT INTO broadcasts (org_id, name) VALUES ($1,'b') RETURNING id`, [orgA]))
          .id,
      );
      await owner.query(
        `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status, sent_at, read_at) VALUES
           ($1,$2,$3,'delivered', now() - interval '2 days', NULL),
           ($1,$2,$3,'read',      now() - interval '1 day',  now() - interval '20 hours'),
           ($1,$2,$3,'failed',    NULL,                      NULL),
           ($1,$2,$3,'read',      now() - interval '40 days', now() - interval '40 days'),
           ($1,$2,$4,'read',      now() - interval '1 day',  now() - interval '1 day')`,
        [orgA, b, contact, other],
      );
      await owner.query(
        `INSERT INTO wa_link_clicks (org_id, token, original_url, contact_id, clicks, last_click_at) VALUES
           ($1,'t-recent-1','https://x.test/a',$2, 3, now() - interval '2 days'),
           ($1,'t-never',   'https://x.test/b',$2, 0, NULL),
           ($1,'t-old',     'https://x.test/c',$2, 5, now() - interval '45 days'),
           ($1,'t-other',   'https://x.test/d',$3, 2, now() - interval '1 day')`,
        [orgA, contact, other],
      );
      const f = (await factsOf(orgA, contact)).engagement;
      expect(f.broadcastsReceived30d).toBe(2);
      expect(f.broadcastsRead30d).toBe(1);
      expect(f.linksClicked30d).toBe(1);
    });

    it('campaign receipts (what migrated workspaces use) count like broadcasts, with their clicks', async () => {
      const contact = await newContact(orgA, 'Kavi');
      const other = await newContact(orgA, 'Lata');
      const camp = Number(
        (
          await one(
            `INSERT INTO wpcampaigns (org_id, campaign_name) VALUES ($1,'c') RETURNING id`,
            [orgA],
          )
        ).id,
      );
      await owner.query(
        `INSERT INTO wp_campaign_contacts (org_id, campaign_id, contact_id, status, sent_at, read_at, clicked, clicked_at) VALUES
           ($1,$2,$3,'delivered', now() - interval '3 days',  NULL,                     false, NULL),
           ($1,$2,$3,'read',      now() - interval '2 days',  now() - interval '1 day',  true,  now() - interval '1 day'),
           ($1,$2,$3,'failed',    NULL,                       NULL,                     false, NULL),
           ($1,$2,$3,'read',      now() - interval '50 days', now() - interval '49 days', true,  now() - interval '49 days'),
           ($1,$2,$4,'read',      now() - interval '1 day',   now() - interval '1 day',   true,  now() - interval '1 day')`,
        [orgA, camp, contact, other],
      );
      const f = (await factsOf(orgA, contact)).engagement;
      expect(f.broadcastsReceived30d).toBe(2);
      expect(f.broadcastsRead30d).toBe(1);
      expect(f.linksClicked30d).toBe(1);
    });

    it('the contact’s own messages, hours since the last one and the reply time', async () => {
      const contact = await newContact(orgA, 'Indu');
      const conv = await newConversation(orgA, chanA, contact, '919100000009');
      await owner.query(
        `UPDATE conversations SET last_inbound_at = now() - interval '5 hours 10 minutes' WHERE id = $1`,
        [conv],
      );
      // 40 days ago: outside both windows.
      await say(orgA, conv, { direction: 'in', sender: 'customer', ago: '40 days' });
      // We write, the contact answers 30 minutes later; we write again, it answers 60 minutes later; then it writes twice more.
      await say(orgA, conv, { direction: 'out', sender: 'agent', ago: '3 hours' });
      await say(orgA, conv, { direction: 'in', sender: 'customer', ago: '2 hours 30 minutes' });
      await say(orgA, conv, { direction: 'out', sender: 'broadcast', ago: '2 hours' });
      await say(orgA, conv, { direction: 'in', sender: 'customer', ago: '1 hour' });
      await say(orgA, conv, { direction: 'in', sender: 'customer', ago: '30 minutes' });
      // A migrated message: flagged as history (a whole migrated workspace is) but dated truly, so it is just a recent message.
      await say(orgA, conv, {
        direction: 'in',
        sender: 'customer',
        ago: '10 minutes',
        meta: { historySync: true, legacy: true },
      });
      // None of these is the contact speaking: a reaction, an old line imported just now, a deleted message, our own bot.
      await say(orgA, conv, {
        direction: 'in',
        sender: 'customer',
        ago: '20 minutes',
        kind: 'reaction',
      });
      await say(orgA, conv, {
        direction: 'in',
        sender: 'customer',
        ago: '15 minutes',
        said: '40 days',
        meta: { historySync: true },
      });
      await say(orgA, conv, {
        direction: 'in',
        sender: 'customer',
        ago: '5 minutes',
        deleted: true,
      });
      await say(orgA, conv, { direction: 'out', sender: 'bot', ago: '1 minute' });

      // The same words in a group thread (no contact) and in another workspace must not count for this contact.
      const group = await newConversation(orgA, chanA, null, '120363000000000002@g.us');
      await say(orgA, group, { direction: 'in', sender: 'customer', ago: '1 hour' });
      const foreign = await newContact(orgB, 'Jay');
      const chanB = Number(
        (
          await one(
            `INSERT INTO channels (org_id, kind, name) VALUES ($1,'simulator','c') RETURNING id`,
            [orgB],
          )
        ).id,
      );
      const foreignConv = await newConversation(orgB, chanB, foreign, '919100000010');
      await say(orgB, foreignConv, { direction: 'in', sender: 'customer', ago: '1 hour' });

      const f = (await factsOf(orgA, contact)).engagement;
      // 2.5h, 1h and 30 min ago, plus the migrated one 10 min ago; the old import, the reaction and the deleted one do not count.
      expect(f.messagesFromContact7d).toBe(4);
      expect(f.hoursSinceLastInbound).toBe(5);
      // 30 min after the agent, 60 min after the broadcast: the mean is 45. The 2 later messages follow the contact's own, and the
      // 40 day old one is out of the window.
      expect(f.avgReplyMinutes30d).toBe(45);

      const theirs = (await factsOf(orgB, foreign)).engagement;
      expect(theirs.messagesFromContact7d).toBe(1);
    }, 60_000);
  });
});
