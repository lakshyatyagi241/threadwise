import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, Pool } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The folded message stream, the conversation reshape, the ledger and the event log against a real Postgres (migrations
 * 20261014100000 .. 100500). Isolation is asserted as the restricted application role (a superuser bypasses every policy and would make
 * the assertions vacuous, see rls.spec.ts); constraint checks use the owner connection, which skips RLS but never CHECK, UNIQUE or FK.
 */
describe('conversations, messages, ledger and events: schema, constraints and isolation', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let pool: Pool;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let chanA: number;
  let chanA2: number;
  let chanB: number;
  let convA: number;
  let convB: number;

  const one = async (sql: string, p: unknown[] = []) =>
    (await owner.query(sql, p)).rows[0] as Record<string, unknown>;
  const fails = async (sql: string, p: unknown[] = []) => {
    try {
      await owner.query(sql, p);
    } catch (e) {
      return e as { code?: string; constraint?: string; message: string };
    }
    return null;
  };
  const asTenant = async <T>(org: number, fn: () => Promise<T>) => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  };
  const channel = async (org: number, kind: string, external: string | null) =>
    Number(
      (
        await one(
          `INSERT INTO channels (org_id, kind, name, external_id) VALUES ($1,$2,'c',$3) RETURNING id`,
          [org, kind, external],
        )
      ).id,
    );
  const conversation = async (org: number, ch: number, peer: string) =>
    Number(
      (
        await one(
          `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,$3,'t') RETURNING id`,
          [org, ch, peer],
        )
      ).id,
    );
  const MSG = `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, body)
               VALUES ($1,$2,$3,$4,$5,$6,'hi') RETURNING id, created_at`;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    pool = new Pool({ connectionString: container.getConnectionUri(), max: 10 });
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    orgA = Number(
      (
        await one(
          `INSERT INTO organizations (slug, name, plan) VALUES ('cm-a','A','starter') RETURNING id`,
        )
      ).id,
    );
    orgB = Number(
      (
        await one(
          `INSERT INTO organizations (slug, name, plan) VALUES ('cm-b','B','starter') RETURNING id`,
        )
      ).id,
    );
    userA = Number(
      (
        await one(
          `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a@cm.test','A','x') RETURNING id`,
          [orgA],
        )
      ).id,
    );
    chanA = await channel(orgA, 'simulator', null);
    chanA2 = await channel(orgA, 'whatsapp_cloud', '111');
    chanB = await channel(orgB, 'simulator', null);
    convA = await conversation(orgA, chanA, '15550001');
    convB = await conversation(orgB, chanB, '15550001');
    const url = new URL(container.getConnectionUri());
    url.username = 'crm_app_user';
    url.password = 'test';
    app = new Client({ connectionString: url.toString() });
    await app.connect();
  }, 240_000);

  afterAll(async () => {
    await app?.end();
    await pool?.end();
    await owner?.end();
    await container?.stop();
  });

  describe('row-level security', () => {
    it('is enabled and forced, with a tenant policy, on every new table and every partition', async () => {
      const rows = (
        await owner.query(
          `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                  (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS policies
           FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
             AND (c.relname IN ('conversations', 'messages', 'message_ledger', 'message_events')
                  OR c.relname ~ '^(messages|message_events)_(default|[0-9]{6})$')`,
        )
      ).rows;
      expect(rows.length).toBeGreaterThanOrEqual(4 + 4);
      for (const r of rows) {
        expect(r.relrowsecurity, r.relname).toBe(true);
        expect(r.relforcerowsecurity, r.relname).toBe(true);
        expect(Number(r.policies), r.relname).toBe(1);
      }
    });

    it('a workspace reads only its own rows and cannot write into another', async () => {
      const m = await one(MSG, [orgA, convA, 1, 'in', 'customer', 'received']);
      await one(
        `INSERT INTO message_ledger (org_id, channel_id, kind, key, message_id, message_created_at, conversation_id)
                 VALUES ($1,$2,'provider_id','wamid.A',$3,$4,$5) RETURNING id`,
        [orgA, chanA, m.id, m.created_at, convA],
      );
      await owner.query(
        `INSERT INTO message_events (org_id, message_id, message_created_at, event) VALUES ($1,$2,$3,'sent')`,
        [orgA, m.id, m.created_at],
      );
      await one(MSG, [orgB, convB, 1, 'in', 'customer', 'received']);

      await asTenant(orgA, async () => {
        for (const table of ['conversations', 'messages', 'message_ledger', 'message_events']) {
          const r = await app.query(`SELECT DISTINCT org_id FROM ${table}`);
          expect(
            r.rows.map((x) => Number(x.org_id)),
            table,
          ).toEqual([orgA]);
        }
      });
      await asTenant(orgA, async () => {
        await app.query('SAVEPOINT s');
        await expect(
          app.query(
            `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status) VALUES ($1,$2,9,'in','customer','received')`,
            [orgB, convB],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await app.query('ROLLBACK TO s');
        await expect(
          app.query(
            `INSERT INTO message_events (org_id, message_id, message_created_at, event) VALUES ($1,1,now(),'sent')`,
            [orgB],
          ),
        ).rejects.toMatchObject({ code: '42501' });
      });
    });

    it('querying a partition by name is filtered like the parent', async () => {
      await asTenant(orgB, async () => {
        const r = await app.query(
          `SELECT DISTINCT m.org_id FROM messages m WHERE m.tableoid::regclass::text LIKE 'messages\\_%'`,
        );
        expect(r.rows.map((x) => Number(x.org_id))).toEqual([orgB]);
      });
    });
  });

  describe('conversations', () => {
    it('one thread per (channel, peer); the same peer on another channel or workspace is a different thread', async () => {
      const dup = await fails(
        `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,'15550001','t')`,
        [orgA, chanA],
      );
      expect(dup?.constraint).toBe('uq_conversations_channel_peer');
      await conversation(orgA, chanA2, '15550001');
    });

    it('a thread can only sit on a channel of its own workspace', async () => {
      const e = await fails(
        `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,'x1','t')`,
        [orgA, chanB],
      );
      expect(e?.constraint).toBe('fk_conversations_channel_id');
    });

    it('rejects values outside the lifecycle, priority and counters', async () => {
      const bad = (set: string) =>
        fails(`UPDATE conversations SET ${set} WHERE org_id = $1 AND id = $2`, [orgA, convA]);
      expect((await bad(`status = 'archived'`))?.constraint).toBe('chk_conversations_status');
      expect((await bad(`priority = 'asap'`))?.constraint).toBe('chk_conversations_priority');
      expect((await bad(`unread_count = -1`))?.constraint).toBe('chk_conversations_unread_count');
      expect(await bad(`status = 'closed'`)).toBeNull();
      expect(await bad(`status = 'open'`)).toBeNull();
    });

    it('a channel that still has threads cannot be deleted', async () => {
      const e = await fails(`DELETE FROM channels WHERE org_id = $1 AND id = $2`, [orgA, chanA]);
      expect(e?.constraint).toBe('fk_conversations_channel_id');
    });

    it('a new thread starts open, normal priority, with an empty sequence', async () => {
      const r = await one(
        `SELECT status, priority, msg_seq, unread_count, needs_contact, window_expires_at FROM conversations WHERE org_id = $1 AND id = $2`,
        [orgA, convA],
      );
      expect(r).toMatchObject({
        status: 'open',
        priority: 'normal',
        unread_count: 0,
        needs_contact: false,
        window_expires_at: null,
      });
      expect(Number(r.msg_seq)).toBe(0);
    });
  });

  describe('messages', () => {
    it('lands in the monthly partition of its created_at, not the default one', async () => {
      const m = await one(MSG, [orgA, convA, 50, 'in', 'customer', 'received']);
      const where = await one(
        `SELECT tableoid::regclass::text AS part FROM messages WHERE id = $1`,
        [m.id],
      );
      expect(where.part).toMatch(/^messages_\d{6}$/);
      expect(Number((await one(`SELECT count(*)::int AS n FROM messages_default`)).n)).toBe(0);
    });

    it('inbound is received and only received; outbound starts anywhere forward but is never received', async () => {
      expect((await fails(MSG, [orgA, convA, 60, 'in', 'customer', 'sent']))?.constraint).toBe(
        'chk_messages_direction_status',
      );
      expect((await fails(MSG, [orgA, convA, 61, 'out', 'agent', 'received']))?.constraint).toBe(
        'chk_messages_direction_status',
      );
      expect(await fails(MSG, [orgA, convA, 62, 'out', 'agent', 'queued'])).toBeNull();
    });

    it('rejects an unknown kind, sender kind, status and a non-positive seq', async () => {
      const base = (kind: string, sender: string, status: string, seq: number) =>
        fails(
          `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status) VALUES ($1,$2,$3,'out',$4,$5,$6)`,
          [orgA, convA, seq, kind, sender, status],
        );
      expect((await base('gif', 'agent', 'queued', 70))?.constraint).toBe('chk_messages_kind');
      expect((await base('text', 'robot', 'queued', 71))?.constraint).toBe(
        'chk_messages_sender_kind',
      );
      expect((await base('text', 'agent', 'pending', 72))?.constraint).toBe('chk_messages_status');
      expect((await base('text', 'agent', 'queued', 0))?.constraint).toBe('chk_messages_seq');
    });

    it('the wire id (uuid) is generated and the translation columns keep their Reference names', async () => {
      const r = await one(
        `SELECT uuid, is_translated, translated_body, detected_language, meta FROM messages WHERE org_id = $1 AND seq = 50`,
        [orgA],
      );
      expect(r.uuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(r).toMatchObject({
        is_translated: false,
        translated_body: null,
        detected_language: null,
        meta: {},
      });
    });

    it('allocates gap-free, distinct seq numbers for 50 parallel writers on one thread (row lock)', async () => {
      const conv = await conversation(orgA, chanA2, 'parallel');
      const writer = async () => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const s = await c.query(
            `UPDATE conversations SET msg_seq = msg_seq + 1 WHERE org_id = $1 AND id = $2 RETURNING msg_seq`,
            [orgA, conv],
          );
          await c.query(
            `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status) VALUES ($1,$2,$3,'in','customer','received')`,
            [orgA, conv, s.rows[0].msg_seq],
          );
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      };
      await Promise.all(Array.from({ length: 50 }, writer));
      const seqs = (
        await owner.query(
          `SELECT seq FROM messages WHERE org_id = $1 AND conversation_id = $2 ORDER BY seq`,
          [orgA, conv],
        )
      ).rows.map((r) => Number(r.seq));
      expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    });

    it('deleting a thread takes its messages (a trigger: a stream has no foreign keys) and ledger rows with it', async () => {
      const conv = await conversation(orgA, chanA2, 'to-delete');
      const m = await one(MSG, [orgA, conv, 1, 'in', 'customer', 'received']);
      await owner.query(
        `INSERT INTO message_ledger (org_id, channel_id, kind, key, message_id, message_created_at, conversation_id)
         VALUES ($1,$2,'provider_id','wamid.del',$3,$4,$5)`,
        [orgA, chanA2, m.id, m.created_at, conv],
      );
      await owner.query(`DELETE FROM conversations WHERE org_id = $1 AND id = $2`, [orgA, conv]);
      expect(
        Number(
          (
            await one(
              `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND org_id = $2`,
              [conv, orgA],
            )
          ).n,
        ),
      ).toBe(0);
      expect(
        Number(
          (
            await one(
              `SELECT count(*)::int AS n FROM message_ledger WHERE conversation_id = $1 AND org_id = $2`,
              [conv, orgA],
            )
          ).n,
        ),
      ).toBe(0);
    });

    it('a trigram index serves message search', async () => {
      const r = await one(
        `SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'idx_messages_body_trgm'`,
      );
      expect(Number(r.n)).toBe(1);
    });
  });

  describe('message ledger', () => {
    const ledger = (org: number, ch: number, kind: string, key: string, conv: number) =>
      owner.query(
        `INSERT INTO message_ledger (org_id, channel_id, kind, key, message_id, message_created_at, conversation_id)
         VALUES ($1,$2,$3,$4,1,now(),$5) ON CONFLICT (org_id, channel_id, kind, key) DO NOTHING RETURNING id`,
        [org, ch, kind, key, conv],
      );

    it('stores a provider id once: a second delivery returns no row (the duplicate signal)', async () => {
      expect((await ledger(orgA, chanA, 'provider_id', 'wamid.dup', convA)).rows).toHaveLength(1);
      expect((await ledger(orgA, chanA, 'provider_id', 'wamid.dup', convA)).rows).toHaveLength(0);
    });

    it('twenty concurrent deliveries of one message produce one ledger row', async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, async () => {
          const c = await pool.connect();
          try {
            const r = await c.query(
              `INSERT INTO message_ledger (org_id, channel_id, kind, key, message_id, message_created_at, conversation_id)
               VALUES ($1,$2,'provider_id','wamid.race',1,now(),$3) ON CONFLICT (org_id, channel_id, kind, key) DO NOTHING RETURNING id`,
              [orgA, chanA, convA],
            );
            return r.rows.length;
          } finally {
            c.release();
          }
        }),
      );
      expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    });

    it('the same key is distinct per channel, per kind and per workspace', async () => {
      expect((await ledger(orgA, chanA2, 'provider_id', 'wamid.dup', convA)).rows).toHaveLength(1);
      expect((await ledger(orgA, chanA, 'client_id', 'wamid.dup', convA)).rows).toHaveLength(1);
      expect((await ledger(orgB, chanB, 'provider_id', 'wamid.dup', convB)).rows).toHaveLength(1);
    });

    it('a ledger row names a channel and a thread of its own workspace only', async () => {
      const bad = await fails(
        `INSERT INTO message_ledger (org_id, channel_id, kind, key, message_id, message_created_at, conversation_id) VALUES ($1,$2,'client_id','k1',1,now(),$3)`,
        [orgA, chanB, convA],
      );
      expect(bad?.constraint).toBe('fk_message_ledger_channel_id');
      const bad2 = await fails(
        `INSERT INTO message_ledger (org_id, channel_id, kind, key, message_id, message_created_at, conversation_id) VALUES ($1,$2,'client_id','k2',1,now(),$3)`,
        [orgA, chanA, convB],
      );
      expect(bad2?.constraint).toBe('fk_message_ledger_conversation_id');
      expect(
        (
          await fails(
            `INSERT INTO message_ledger (org_id, channel_id, kind, key, message_id, message_created_at, conversation_id) VALUES ($1,$2,'other','k3',1,now(),$3)`,
            [orgA, chanA, convA],
          )
        )?.constraint,
      ).toBe('chk_message_ledger_kind');
    });
  });

  describe('message events', () => {
    it('lands in a monthly partition and accepts only the known events', async () => {
      const m = await one(MSG, [orgA, convA, 100, 'out', 'agent', 'queued']);
      await owner.query(
        `INSERT INTO message_events (org_id, message_id, message_created_at, event, detail) VALUES ($1,$2,$3,'attempt','{"n":1}')`,
        [orgA, m.id, m.created_at],
      );
      const where = await one(
        `SELECT tableoid::regclass::text AS part FROM message_events WHERE org_id = $1 AND message_id = $2`,
        [orgA, m.id],
      );
      expect(where.part).toMatch(/^message_events_\d{6}$/);
      const e = await fails(
        `INSERT INTO message_events (org_id, message_id, message_created_at, event) VALUES ($1,$2,$3,'exploded')`,
        [orgA, m.id, m.created_at],
      );
      expect(e?.constraint).toBe('chk_message_events_event');
    });
  });

  describe('additions to the inbox tables', () => {
    it('the pre-fold inbox_messages table is gone and the old message columns with it', async () => {
      expect((await one(`SELECT to_regclass('public.inbox_messages') AS t`)).t).toBeNull();
      const cols = (
        await owner.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'messages'`,
        )
      ).rows.map((r) => r.column_name as string);
      for (const gone of [
        'from_number',
        'to_number',
        'media_path',
        'media_type',
        'agent_id',
        'provider',
        'scheduled_at',
      ]) {
        expect(cols, gone).not.toContain(gone);
      }
      for (const kept of [
        'seq',
        'direction',
        'sender_kind',
        'client_message_id',
        'provider_message_id',
        'translated_body',
        'media_key',
      ]) {
        expect(cols, kept).toContain(kept);
      }
    });

    it('the conversation lost the Quick Send and polymorphic-sender columns', async () => {
      const cols = (
        await owner.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'conversations'`,
        )
      ).rows.map((r) => r.column_name as string);
      for (const gone of [
        'device_id',
        'provider',
        'platform',
        'origin',
        'channel',
        'raw_jid',
        'contact_digits',
        'inbox_status',
        'is_spam',
        'recipients_count',
      ]) {
        expect(cols, gone).not.toContain(gone);
      }
      for (const kept of [
        'channel_id',
        'peer_key',
        'msg_seq',
        'window_expires_at',
        'waiting_since',
        'assignee_user_id',
        'first_response_at',
        'last_inbound_at',
        'last_outbound_at',
        'unread_count',
      ]) {
        expect(cols, kept).toContain(kept);
      }
    });

    it('a saved reply shortcut is unique per owner, and one shared reply per shortcut', async () => {
      const ins = (user: number | null, shortcut: string) =>
        fails(
          `INSERT INTO saved_replies (org_id, user_id, shortcut, title, body) VALUES ($1,$2,$3,'t','b')`,
          [orgA, user, shortcut],
        );
      expect(await ins(null, '/hello')).toBeNull();
      expect((await ins(null, '/hello'))?.constraint).toBe('uq_saved_replies_owner_shortcut');
      expect(await ins(userA, '/hello')).toBeNull();
      expect((await ins(userA, '/hello'))?.constraint).toBe('uq_saved_replies_owner_shortcut');
    });

    it('agent_statuses carries the round-robin clock', async () => {
      const r = await one(
        `INSERT INTO agent_statuses (org_id, user_id) VALUES ($1,$2) RETURNING last_assigned_at`,
        [orgA, userA],
      );
      expect(r.last_assigned_at).toBeNull();
    });
  });
});
