import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withPrivileged, withTenant, type DbClient } from '@crm/db';
import { LeadChatDigestRepository } from '../../../src/modules/lead-scoring/lead-chat-digest.repository';

/**
 * The SQL of reading a conversation for lead scoring, against a real Postgres as the restricted application role under row-level
 * security: which messages the model is shown, which contacts the idle sweeper picks, the one-open-suggestion rule, the decision, the
 * retention sweep and tenant isolation.
 */
describe('chat digest SQL', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: DbClient;
  const repo = new LeadChatDigestRepository();
  let orgA: number;
  let orgB: number;
  let chanA: number;
  let seq = 0;

  const one = async (sql: string, p: unknown[] = []) =>
    (await owner.query(sql, p)).rows[0] as Record<string, unknown>;
  const as = <T>(org: number, fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(app.db, { orgId: org }, fn);

  const contact = async (org: number, name: string, stage = 'lead') =>
    Number(
      (
        await one(
          `INSERT INTO contacts (org_id, uuid, name, lifecycle_stage) VALUES ($1, gen_random_uuid(), $2, $3) RETURNING id`,
          [org, name, stage],
        )
      ).id,
    );
  const conversation = async (
    org: number,
    channel: number,
    contactId: number | null,
    peer: string,
    lastInboundAgo: string | null = null,
  ) =>
    Number(
      (
        await one(
          `INSERT INTO conversations (org_id, channel_id, peer_key, title, contact_id, last_inbound_at)
           VALUES ($1,$2,$3,$3,$4, ${lastInboundAgo ? `now() - $5::interval` : 'NULL'}) RETURNING id`,
          lastInboundAgo
            ? [org, channel, peer, contactId, lastInboundAgo]
            : [org, channel, peer, contactId],
        )
      ).id,
    );
  const say = async (
    org: number,
    conv: number,
    m: {
      direction: 'in' | 'out';
      sender: string;
      ago: string;
      body: string;
      kind?: string;
      meta?: Record<string, unknown>;
      deleted?: boolean;
      said?: string;
    },
  ) =>
    owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, body, created_at, provider_ts, meta, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,'${m.direction === 'in' ? 'received' : 'sent'}',$7, now() - $8::interval, now() - $9::interval, $10::jsonb, ${m.deleted ? 'now()' : 'NULL'})`,
      [
        org,
        conv,
        ++seq,
        m.direction,
        m.kind ?? 'text',
        m.sender,
        m.body,
        m.ago,
        m.said ?? m.ago,
        JSON.stringify(m.meta ?? {}),
      ],
    );
  const digestRow = (contactId: number, throughAgo: string) =>
    owner.query(
      `INSERT INTO lead_chat_digests (org_id, contact_id, through_at, source, intent, trigger)
       VALUES ((SELECT org_id FROM contacts WHERE id=$1), $1, now() - $2::interval, 'ai', 'other', 'chat')`,
      [contactId, throughAgo],
    );
  const settings = (org: number, on: boolean, digest: boolean) =>
    owner.query(
      `INSERT INTO lead_scoring_settings (org_id, enabled, chat_digest, stage_suggestions) VALUES ($1,$2,$3,$3)
       ON CONFLICT (org_id) DO UPDATE SET enabled = EXCLUDED.enabled, chat_digest = EXCLUDED.chat_digest, stage_suggestions = EXCLUDED.stage_suggestions`,
      [org, on, digest],
    );

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
    orgA = await org('digest-a');
    orgB = await org('digest-b');
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

  describe('which messages the model is shown', () => {
    it('recent text of the contact threads, oldest first, by when it was said', async () => {
      const c = await contact(orgA, 'Asha');
      const conv = await conversation(orgA, chanA, c, '919200000001');
      await say(orgA, conv, { direction: 'out', sender: 'bot', ago: '3 hours', body: 'Welcome' });
      await say(orgA, conv, {
        direction: 'in',
        sender: 'customer',
        ago: '2 hours',
        body: 'price of the strap?',
      });
      // Migrated: flagged as history but dated truly.
      await say(orgA, conv, {
        direction: 'in',
        sender: 'customer',
        ago: '1 hour',
        body: 'ok please quote',
        meta: { historySync: true, legacy: true },
      });
      const chat = await as(orgA, (tx) => repo.chatFor(tx, orgA, c));
      expect(chat.map((m) => m.body)).toEqual([
        'Welcome',
        'price of the strap?',
        'ok please quote',
      ]);
      expect(chat.map((m) => m.direction)).toEqual(['out', 'in', 'in']);
    });

    it('leaves out reactions, deleted messages, old ones, group chatter and group threads', async () => {
      const c = await contact(orgA, 'Bala');
      const conv = await conversation(orgA, chanA, c, '919200000002');
      await say(orgA, conv, {
        direction: 'in',
        sender: 'customer',
        ago: '1 hour',
        body: 'keep me',
      });
      await say(orgA, conv, {
        direction: 'in',
        sender: 'customer',
        ago: '50 minutes',
        body: '👍',
        kind: 'reaction',
      });
      await say(orgA, conv, {
        direction: 'in',
        sender: 'customer',
        ago: '40 minutes',
        body: 'deleted',
        deleted: true,
      });
      await say(orgA, conv, {
        direction: 'in',
        sender: 'customer',
        ago: '30 days',
        body: 'too old',
      });
      await say(orgA, conv, {
        direction: 'in',
        sender: 'customer',
        ago: '20 minutes',
        body: 'imported today, said long ago',
        said: '30 days',
        meta: { historySync: true },
      });
      await say(orgA, conv, {
        direction: 'in',
        sender: 'customer',
        ago: '10 minutes',
        body: 'a group member talking',
        meta: { group: { id: 'x@g.us' } },
      });
      const grp = await conversation(orgA, chanA, c, '120363000000000009@g.us');
      await say(orgA, grp, {
        direction: 'in',
        sender: 'customer',
        ago: '5 minutes',
        body: 'in a group thread',
      });
      const chat = await as(orgA, (tx) => repo.chatFor(tx, orgA, c));
      expect(chat.map((m) => m.body)).toEqual(['keep me']);
    });

    it('is capped at the newest 30 messages', async () => {
      const c = await contact(orgA, 'Chandra');
      const conv = await conversation(orgA, chanA, c, '919200000003');
      for (let i = 0; i < 40; i++) {
        await say(orgA, conv, {
          direction: 'in',
          sender: 'customer',
          ago: `${400 - i} minutes`,
          body: `m${i}`,
        });
      }
      const chat = await as(orgA, (tx) => repo.chatFor(tx, orgA, c));
      expect(chat).toHaveLength(30);
      expect(chat[0]!.body).toBe('m10');
      expect(chat[29]!.body).toBe('m39');
    });

    it("never shows another workspace's chat, and reads the workspace's own stages in order", async () => {
      const foreign = await contact(orgB, 'Jay');
      expect(await as(orgA, (tx) => repo.chatFor(tx, orgA, foreign))).toEqual([]);
      await owner.query(
        `INSERT INTO status_options (org_id, module_key, option_group, value, label, position, is_won, is_lost) VALUES
           ($1,'contacts','lifecycle_stage','customer','Customer',3,true,false),
           ($1,'contacts','lifecycle_stage','lead','Lead',1,false,false),
           ($1,'contacts','lifecycle_stage','sql','Qualified',2,false,false)`,
        [orgA],
      );
      const stages = await as(orgA, (tx) => repo.stages(tx, orgA));
      expect(stages.map((s) => s.value)).toEqual(['lead', 'sql', 'customer']);
      expect(stages[2]).toMatchObject({ isWon: true, isLost: false });
      expect(await as(orgB, (tx) => repo.stages(tx, orgB))).toEqual([]);
    });
  });

  describe('the idle sweeper', () => {
    const picked = async () =>
      (await withPrivileged(app.db, (tx) => repo.idleCandidates(tx, 12, 14, 500)))
        .filter((c) => c.orgId === orgB)
        .map((c) => c.contactId);

    it('picks a quiet chat that was not read since, and only in workspaces that switched it on', async () => {
      const quiet = await contact(orgB, 'Quiet');
      const busy = await contact(orgB, 'Busy');
      const stale = await contact(orgB, 'Stale');
      const read = await contact(orgB, 'AlreadyRead');
      const group = await contact(orgB, 'GroupOnly');
      const chanB = Number(
        (
          await one(
            `INSERT INTO channels (org_id, kind, name) VALUES ($1,'simulator','c') RETURNING id`,
            [orgB],
          )
        ).id,
      );
      await conversation(orgB, chanB, quiet, 'q1', '30 minutes');
      await conversation(orgB, chanB, busy, 'q2', '3 minutes');
      await conversation(orgB, chanB, stale, 'q3', '20 days');
      await conversation(orgB, chanB, read, 'q4', '1 hour');
      await conversation(orgB, chanB, group, '120363000000000001@g.us', '1 hour');
      await digestRow(read, '30 minutes');

      // Off: nothing, whatever the chats look like.
      await settings(orgB, true, false);
      expect(await picked()).toEqual([]);
      await settings(orgB, false, true);
      expect(await picked()).toEqual([]);

      await settings(orgB, true, true);
      expect(await picked()).toEqual([quiet]);

      // New words after the last reading bring the contact back.
      await owner.query(
        `UPDATE conversations SET last_inbound_at = now() - interval '15 minutes' WHERE contact_id = $1`,
        [read],
      );
      expect((await picked()).sort()).toEqual([quiet, read].sort());
    });
  });

  describe('suggestions', () => {
    it('a contact has one open suggestion: a new one replaces it', async () => {
      const c = await contact(orgA, 'Devi');
      await digestRow(c, '1 minute');
      const digestId = Number(
        (await one(`SELECT id FROM lead_chat_digests WHERE contact_id = $1`, [c])).id,
      );
      const a = await as(orgA, (tx) =>
        repo.replacePending(tx, orgA, {
          contactId: c,
          digestId,
          fromStage: 'lead',
          toStage: 'sql',
          confidence: 0.7,
          reasons: ['first'],
        }),
      );
      const b = await as(orgA, (tx) =>
        repo.replacePending(tx, orgA, {
          contactId: c,
          digestId,
          fromStage: 'lead',
          toStage: 'customer',
          confidence: 0.9,
          reasons: ['second'],
        }),
      );
      const rows = (
        await owner.query(
          `SELECT id, status FROM lifecycle_stage_suggestions WHERE contact_id = $1 ORDER BY id`,
          [c],
        )
      ).rows;
      expect(rows.map((r) => [Number(r.id), r.status])).toEqual([
        [a, 'superseded'],
        [b, 'pending'],
      ]);
      // The database itself refuses a second open one.
      await expect(
        owner.query(
          `INSERT INTO lifecycle_stage_suggestions (org_id, contact_id, from_stage, to_stage, confidence) VALUES ($1,$2,'lead','sql',0.8)`,
          [orgA, c],
        ),
      ).rejects.toThrow(/uq_lifecycle_stage_suggestions_pending|duplicate key/);
    });

    it('is decided once, by the person who decided; a stale one is superseded when the contact moved', async () => {
      const c = await contact(orgA, 'Esha');
      const id = await as(orgA, (tx) =>
        repo.replacePending(tx, orgA, {
          contactId: c,
          digestId: null,
          fromStage: 'lead',
          toStage: 'sql',
          confidence: 0.8,
          reasons: [],
        }),
      );
      expect(await as(orgA, (tx) => repo.decide(tx, orgA, id, 'accepted', null))).toBe(true);
      expect(await as(orgA, (tx) => repo.decide(tx, orgA, id, 'dismissed', null))).toBe(false);
      const row = await one(
        `SELECT status, decided_at FROM lifecycle_stage_suggestions WHERE id = $1`,
        [id],
      );
      expect(row.status).toBe('accepted');
      expect(row.decided_at).not.toBeNull();

      const id2 = await as(orgA, (tx) =>
        repo.replacePending(tx, orgA, {
          contactId: c,
          digestId: null,
          fromStage: 'lead',
          toStage: 'sql',
          confidence: 0.8,
          reasons: [],
        }),
      );
      await as(orgA, (tx) => repo.supersedeStale(tx, orgA, c, 'lead'));
      expect(
        (await one(`SELECT status FROM lifecycle_stage_suggestions WHERE id = $1`, [id2])).status,
      ).toBe('pending');
      await as(orgA, (tx) => repo.supersedeStale(tx, orgA, c, 'sql'));
      expect(
        (await one(`SELECT status FROM lifecycle_stage_suggestions WHERE id = $1`, [id2])).status,
      ).toBe('superseded');
    });

    it('lists by status newest first with a cursor, and counts the open ones, per workspace', async () => {
      const ids: number[] = [];
      for (let i = 0; i < 3; i++) {
        const c = await contact(orgA, `List ${i}`);
        ids.push(
          await as(orgA, (tx) =>
            repo.replacePending(tx, orgA, {
              contactId: c,
              digestId: null,
              fromStage: 'lead',
              toStage: 'sql',
              confidence: 0.7,
              reasons: [],
            }),
          ),
        );
      }
      const page1 = await as(orgA, (tx) =>
        repo.listSuggestions(tx, orgA, { status: 'pending', limit: 2 }),
      );
      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      const page2 = await as(orgA, (tx) =>
        repo.listSuggestions(tx, orgA, { status: 'pending', limit: 2, cursor: page1.nextCursor! }),
      );
      const seen = [...page1.items, ...page2.items].map((s) => s.id);
      expect(new Set(seen).size).toBe(seen.length);
      expect(ids.every((i) => seen.includes(i))).toBe(true);
      expect(await as(orgA, (tx) => repo.pendingCount(tx, orgA))).toBeGreaterThanOrEqual(3);
      expect(await as(orgB, (tx) => repo.pendingCount(tx, orgB))).toBe(0);
      expect(
        (await as(orgB, (tx) => repo.listSuggestions(tx, orgB, { status: 'pending', limit: 50 })))
          .items,
      ).toEqual([]);
    });
  });

  describe('retention', () => {
    it('old digests and decided suggestions go; an open suggestion nobody decided expires; recent rows stay', async () => {
      const c = await contact(orgA, 'Farid');
      await digestRow(c, '200 days');
      // A reading is as old as the day it was made, not the day of the messages it read.
      await owner.query(
        `UPDATE lead_chat_digests SET created_at = through_at WHERE contact_id = $1`,
        [c],
      );
      await digestRow(c, '1 day');
      const open = await as(orgA, (tx) =>
        repo.replacePending(tx, orgA, {
          contactId: c,
          digestId: null,
          fromStage: 'lead',
          toStage: 'sql',
          confidence: 0.7,
          reasons: [],
        }),
      );
      await owner.query(
        `UPDATE lifecycle_stage_suggestions SET created_at = now() - interval '40 days' WHERE id = $1`,
        [open],
      );
      const decided = await contact(orgA, 'Gita');
      const old = await as(orgA, (tx) =>
        repo.replacePending(tx, orgA, {
          contactId: decided,
          digestId: null,
          fromStage: 'lead',
          toStage: 'sql',
          confidence: 0.7,
          reasons: [],
        }),
      );
      await as(orgA, (tx) => repo.decide(tx, orgA, old, 'dismissed', null));
      await owner.query(
        `UPDATE lifecycle_stage_suggestions SET created_at = now() - interval '200 days' WHERE id = $1`,
        [old],
      );

      const out = await withPrivileged(app.db, (tx) => repo.sweepOld(tx, 90, 30));
      expect(out.digests).toBeGreaterThanOrEqual(1);
      expect(out.expired).toBeGreaterThanOrEqual(1);
      expect(out.suggestions).toBeGreaterThanOrEqual(1);
      expect(
        Number(
          (await one(`SELECT count(*)::int n FROM lead_chat_digests WHERE contact_id = $1`, [c])).n,
        ),
      ).toBe(1);
      expect(
        (await one(`SELECT status FROM lifecycle_stage_suggestions WHERE id = $1`, [open])).status,
      ).toBe('expired');
      expect(
        (await owner.query(`SELECT 1 FROM lifecycle_stage_suggestions WHERE id = $1`, [old])).rows,
      ).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    it("a workspace cannot read another's digests or suggestions below the API", async () => {
      const c = await contact(orgA, 'Hari');
      await digestRow(c, '1 minute');
      const seenByB = await as(orgB, (tx) =>
        tx.execute(sql`SELECT count(*)::int AS n FROM lead_chat_digests WHERE org_id = ${orgA}`),
      );
      expect(Number((seenByB.rows[0] as { n: number }).n)).toBe(0);
      await expect(
        as(orgB, (tx) =>
          tx.execute(
            sql`INSERT INTO lead_chat_digests (org_id, contact_id, through_at, source, intent, trigger) VALUES (${orgA}, ${c}, now(), 'ai', 'other', 'chat')`,
          ),
        ),
      ).rejects.toThrow();
    });
  });
});
