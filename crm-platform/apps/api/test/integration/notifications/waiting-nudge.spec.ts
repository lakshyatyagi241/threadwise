import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import type { WaitingConfig } from '../../../src/config/domains/notifications.env';
import { DatabaseService } from '../../../src/infra/db/database.service';
import type { ConversationReadState } from '../../../src/modules/notifications/conversation-read-state';
import { NotificationFanout } from '../../../src/modules/notifications/notification-fanout';
import { NotificationPrefsResolver } from '../../../src/modules/notifications/notification-prefs.resolver';
import type { NotificationPublisher } from '../../../src/modules/notifications/notification.publisher';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository';
import { WaitingNudgeService } from '../../../src/modules/notifications/waiting-nudge.service';
import type { MemberDirectory } from '../../../src/realtime';

/**
 * The "waiting for a reply" sweep (BL-098) against a real Postgres, as the restricted application role: the cross-tenant candidate
 * query finds exactly the chats that qualify, every exclusion holds, a nudge is written once per waiting episode (a second sweep writes
 * nothing, a new wait after an answer writes again), tenants never see each other's rows, a person's own bell choice is honoured, and the
 * cap per sweep is respected newest first. The partial indexes of migrations 20261110090000 and 20261110090100 exist and serve the query.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
const MIN = 60_000;
const CONFIG: WaitingConfig = { enabled: true, minutes: 5, lookbackHours: 24, batch: 100 };

describe('waiting-for-a-reply sweep', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let clients: DbClientPair;
  let db: DatabaseService;
  let orgA: number;
  let orgB: number;
  let a1: number;
  let a2: number;
  let a3ReadOnly: number;
  let b1: number;
  let chanA: number;
  let chanB: number;
  let teamA: number;
  let n = 0;
  /** Users the stub readState reports as looking at a given chat uuid. */
  const looking = new Map<string, Set<number>>();
  const published: Array<{ orgId: number; userId: number; type: string }> = [];
  let service: WaitingNudgeService;

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
      `INSERT INTO organizations (slug, name, plan) VALUES ('wa','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('wb','B','starter') RETURNING id`,
    );
    const user = (org: number, email: string) =>
      one(
        `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,$2::text,$2::text,'x') RETURNING id`,
        [org, email],
      );
    a1 = await user(orgA, 'a1@w.test');
    a2 = await user(orgA, 'a2@w.test');
    a3ReadOnly = await user(orgA, 'a3@w.test');
    b1 = await user(orgB, 'b1@w.test');
    chanA = await one(
      `INSERT INTO channels (org_id, kind, name) VALUES ($1,'simulator','c') RETURNING id`,
      [orgA],
    );
    chanB = await one(
      `INSERT INTO channels (org_id, kind, name) VALUES ($1,'simulator','c') RETURNING id`,
      [orgB],
    );
    teamA = await one(`INSERT INTO teams (org_id, name) VALUES ($1,'t') RETURNING id`, [orgA]);

    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
    clients = createDbClientPair({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 8,
    });
    db = new DatabaseService(clients);

    // The collaborators that are not the subject of this test: who may read and reply, who has a chat open, and the live announcement.
    const all = (userId: number) => ({ userId, scope: 'all' as const, teamIds: [] });
    const directory = {
      viewers: async (orgId: number, permission: string) => {
        const read = orgId === orgA ? [a1, a2, a3ReadOnly] : [b1];
        const reply = orgId === orgA ? [a1, a2] : [b1];
        return (permission.endsWith('.read') ? read : reply).map(all);
      },
    } as unknown as MemberDirectory;
    const readState = {
      seenSince: async (_org: number, userIds: number[], conversationUuid: string) =>
        new Set(userIds.filter((u) => looking.get(conversationUuid)?.has(u))),
    } as unknown as ConversationReadState;
    const publisher = {
      created: async (orgId: number, row: { userId: number; type: string }) => {
        published.push({ orgId, userId: row.userId, type: row.type });
      },
    } as unknown as NotificationPublisher;
    const fanout = new NotificationFanout(
      new NotificationsRepository(),
      new NotificationPrefsResolver(db),
      publisher,
    );
    service = new WaitingNudgeService(db, directory, readState, fanout);
  }, 240_000);

  afterAll(async () => {
    await clients?.close();
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  interface ChatOptions {
    org?: number;
    channel?: number;
    peerKey?: string;
    peerName?: string;
    status?: string;
    archived?: boolean;
    muted?: boolean;
    assigneeUserId?: number | null;
    assigneeTeamId?: number | null;
    /** Minutes since the customer's latest message. */
    inboundMinutesAgo?: number;
    answered?: boolean;
    unread?: number;
  }

  /** An unassigned, open chat whose customer wrote `inboundMinutesAgo` minutes ago and nobody answered, unless the options say otherwise. */
  async function chat(o: ChatOptions = {}) {
    const org = o.org ?? orgA;
    const channel = o.channel ?? (org === orgA ? chanA : chanB);
    const at = new Date(Date.now() - (o.inboundMinutesAgo ?? 10) * MIN).toISOString();
    n += 1;
    const res = await owner.query(
      `INSERT INTO conversations (org_id, channel_id, peer_key, peer_name, title, status, archived, muted_at, assignee_user_id,
                                  assignee_team_id, last_inbound_at, waiting_since, unread_count, last_message_at)
       VALUES ($1,$2,$3,$12,'t',$4,$5,$6,$7,$8,$9,$10,$11,$9) RETURNING id, uuid`,
      [
        org,
        channel,
        o.peerKey ?? `peer-${n}`,
        o.status ?? 'open',
        o.archived ?? false,
        o.muted ? new Date().toISOString() : null,
        o.assigneeUserId ?? null,
        o.assigneeTeamId ?? null,
        at,
        o.answered ? null : at,
        o.unread ?? 1,
        o.peerName ?? 'Asha',
      ],
    );
    const id = Number(res.rows[0].id);
    const uuid = res.rows[0].uuid as string;
    const message = await inbound(org, id, 1, at);
    return { id, uuid, org, message };
  }

  async function inbound(org: number, conversationId: number, seq: number, at: string) {
    const r = await owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, body, created_at)
       VALUES ($1,$2,$3,'in','customer','received','is anyone there?',$4) RETURNING uuid`,
      [org, conversationId, seq, at],
    );
    return r.rows[0].uuid as string;
  }

  const rowsFor = async (conversationUuid: string) =>
    (
      await owner.query(
        `SELECT org_id, user_id, type, title, body, link, dedupe_key, subject_kind, data
         FROM inbox_notifications WHERE subject_uuid = $1 AND type = 'chat_waiting' ORDER BY user_id`,
        [conversationUuid],
      )
    ).rows;

  async function reset() {
    await owner.query(`DELETE FROM inbox_notifications`);
    await owner.query(`DELETE FROM notification_user_prefs`);
    await owner.query(`DELETE FROM messages`);
    await owner.query(`DELETE FROM conversations`);
    looking.clear();
    published.length = 0;
  }

  it('has both partial indexes, and the planner can serve the candidate query from the first', async () => {
    const idx = await owner.query(
      `SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_conversations_waiting_nudge','idx_inbox_notifications_chat_waiting')`,
    );
    expect(idx.rows.map((r) => r.indexname).sort()).toEqual([
      'idx_conversations_waiting_nudge',
      'idx_inbox_notifications_chat_waiting',
    ]);
    await reset();
    await chat();
    await owner.query('BEGIN');
    try {
      // Tables this small are scanned sequentially on cost; forbidding that shows the index can answer the query.
      await owner.query('SET LOCAL enable_seqscan = off');
      const plan = await owner.query(
        `EXPLAIN SELECT c.org_id, c.id FROM conversations c
         WHERE c.status = 'open' AND NOT c.archived AND c.muted_at IS NULL
           AND c.assignee_user_id IS NULL AND c.assignee_team_id IS NULL AND c.assignee_agent_id IS NULL
           AND c.waiting_since IS NOT NULL AND c.unread_count > 0
           AND c.last_inbound_at <= now() AND c.last_inbound_at >= now() - interval '24 hours'
           AND c.peer_key NOT LIKE 'g:%'
         ORDER BY c.last_inbound_at DESC LIMIT 100`,
      );
      expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toContain(
        'idx_conversations_waiting_nudge',
      );
    } finally {
      await owner.query('ROLLBACK');
    }
  });

  it('nudges everyone who may read AND reply, once, through the shared fan-out (row, then live announcement)', async () => {
    await reset();
    const c = await chat();
    const r = await service.sweep(new Date(), CONFIG);

    expect(r).toMatchObject({ candidates: 1, nudged: 1, rows: 2 });
    const rows = await rowsFor(c.uuid);
    // a1 and a2 may reply; a3 can only read.
    expect(rows.map((x) => Number(x.user_id))).toEqual([a1, a2]);
    expect(rows[0]).toMatchObject({
      org_id: orgA,
      type: 'chat_waiting',
      title: 'No one has answered Asha yet',
      body: 'is anyone there?',
      link: `/inbox?c=${c.uuid}`,
      subject_kind: 'conversation',
      dedupe_key: `chat_waiting:${c.uuid}:${c.message}`,
    });
    expect(rows[0].data).toMatchObject({ conversationId: c.uuid, channelKind: 'simulator' });
    expect(published.map((p) => [p.orgId, p.userId, p.type])).toEqual([
      [orgA, a1, 'chat_waiting'],
      [orgA, a2, 'chat_waiting'],
    ]);
  });

  it('is idempotent: a second sweep, and a third, write and announce nothing more', async () => {
    await reset();
    const c = await chat();
    await service.sweep(new Date(), CONFIG);
    const announced = published.length;
    const again = await service.sweep(new Date(), CONFIG);
    await service.sweep(new Date(), CONFIG);

    expect(again.rows).toBe(0);
    // A chat already nudged in its wait is not even a candidate, so it never uses up the sweep's cap.
    expect(again.candidates).toBe(0);
    expect(await rowsFor(c.uuid)).toHaveLength(2);
    expect(published).toHaveLength(announced);
  });

  it('holds even when the episode check is bypassed: the dedupe key alone makes a repeat a no-op', async () => {
    await reset();
    const c = await chat();
    await service.sweep(new Date(), CONFIG);
    // Forget the nudge rows' age so the episode check cannot see them, as if two pods raced past it.
    await owner.query(
      `UPDATE inbox_notifications SET created_at = created_at - interval '2 days' WHERE type = 'chat_waiting'`,
    );
    published.length = 0;
    const r = await service.sweep(new Date(), CONFIG);
    expect(r.rows).toBe(0);
    expect(await rowsFor(c.uuid)).toHaveLength(2);
    expect(published).toHaveLength(0);
  });

  it('never nudges: assigned, muted, not open, archived, group, answered, read, too recent, too old', async () => {
    await reset();
    const excluded = [
      await chat({ assigneeUserId: a1 }),
      await chat({ assigneeTeamId: teamA }),
      await chat({ muted: true }),
      await chat({ status: 'resolved' }),
      await chat({ status: 'closed' }),
      await chat({ status: 'snoozed' }),
      await chat({ status: 'pending' }),
      await chat({ archived: true }),
      await chat({ peerKey: 'g:120363000000' }),
      await chat({ answered: true }),
      await chat({ unread: 0 }),
      await chat({ inboundMinutesAgo: 2 }),
      await chat({ inboundMinutesAgo: 30 * 60 }),
    ];
    const r = await service.sweep(new Date(), CONFIG);

    expect(r.rows).toBe(0);
    expect(r.nudged).toBe(0);
    for (const c of excluded) expect(await rowsFor(c.uuid)).toHaveLength(0);
    expect(
      (await owner.query(`SELECT count(*)::int AS n FROM inbox_notifications`)).rows[0].n,
    ).toBe(0);
  });

  it('nudges a chat that reaches the threshold on a later sweep, and respects a custom wait', async () => {
    await reset();
    const c = await chat({ inboundMinutesAgo: 8 });
    expect((await service.sweep(new Date(), { ...CONFIG, minutes: 10 })).rows).toBe(0);
    // Two minutes later the same chat has waited ten.
    const later = new Date(Date.now() + 2 * MIN);
    expect((await service.sweep(later, { ...CONFIG, minutes: 10 })).rows).toBe(2);
    expect(await rowsFor(c.uuid)).toHaveLength(2);
  });

  it('drops a chat that changed between the candidate query and the write (assigned or answered meanwhile)', async () => {
    await reset();
    const assigned = await chat();
    const answered = await chat();
    // The fresh read inside the workspace transaction is the second check: simulate the change landing right after step 1.
    const original = (service as unknown as { candidates: (...a: unknown[]) => Promise<unknown> })
      .candidates;
    (service as unknown as { candidates: unknown }).candidates = async (...a: unknown[]) => {
      const found = await original.apply(service, a);
      await owner.query(`UPDATE conversations SET assignee_user_id = $1 WHERE id = $2`, [
        a1,
        assigned.id,
      ]);
      await owner.query(
        `UPDATE conversations SET waiting_since = NULL, unread_count = 0 WHERE id = $1`,
        [answered.id],
      );
      return found;
    };
    try {
      const r = await service.sweep(new Date(), CONFIG);
      expect(r.candidates).toBe(2);
      expect(r.rows).toBe(0);
      expect(r.skipped).toMatchObject({ assigned: 1, answered: 1 });
    } finally {
      (service as unknown as { candidates: unknown }).candidates = original;
    }
  });

  it('one nudge per waiting episode: more customer messages in the same wait do not nudge again, a new wait after an answer does', async () => {
    await reset();
    const c = await chat({ inboundMinutesAgo: 20 });
    expect((await service.sweep(new Date(), CONFIG)).rows).toBe(2);

    // The customer writes again, six minutes ago, still unanswered: same episode.
    const at2 = new Date(Date.now() - 6 * MIN).toISOString();
    await inbound(orgA, c.id, 2, at2);
    await owner.query(
      `UPDATE conversations SET last_inbound_at = $1, unread_count = 2 WHERE id = $2`,
      [at2, c.id],
    );
    const same = await service.sweep(new Date(), CONFIG);
    expect(same.rows).toBe(0);
    expect(same.candidates).toBe(0);

    // An agent answers: the wait is cleared and the thread is read.
    await owner.query(
      `UPDATE conversations SET waiting_since = NULL, unread_count = 0, last_outbound_at = now() WHERE id = $1`,
      [c.id],
    );
    expect((await service.sweep(new Date(), CONFIG)).rows).toBe(0);

    // The customer writes anew and is again left waiting: a new episode, a new message id, a new nudge. (The first nudge is from
    // before this wait began; the test clock is compressed, so say so explicitly.)
    await owner.query(
      `UPDATE inbox_notifications SET created_at = now() - interval '1 hour' WHERE type = 'chat_waiting'`,
    );
    const at3 = new Date(Date.now() - 7 * MIN).toISOString();
    const third = await inbound(orgA, c.id, 3, at3);
    await owner.query(
      `UPDATE conversations SET last_inbound_at = $1, waiting_since = $1, unread_count = 1 WHERE id = $2`,
      [at3, c.id],
    );
    const fresh = await service.sweep(new Date(), CONFIG);
    expect(fresh.rows).toBe(2);
    const rows = await rowsFor(c.uuid);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((x) => x.dedupe_key))).toEqual(
      new Set([`chat_waiting:${c.uuid}:${c.message}`, `chat_waiting:${c.uuid}:${third}`]),
    );
  });

  it('skips a person who has the chat open right now, and everyone gets nothing when all are looking', async () => {
    await reset();
    const c = await chat();
    looking.set(c.uuid, new Set([a1]));
    expect((await service.sweep(new Date(), CONFIG)).rows).toBe(1);
    expect((await rowsFor(c.uuid)).map((x) => Number(x.user_id))).toEqual([a2]);

    const d = await chat();
    looking.set(d.uuid, new Set([a1, a2]));
    const r = await service.sweep(new Date(), CONFIG);
    expect(r.rows).toBe(0);
    expect(r.skipped.nobody).toBe(1);
    expect(await rowsFor(d.uuid)).toHaveLength(0);
  });

  it("honours a person's own bell choice: someone who turned the nudge off gets no row", async () => {
    await reset();
    await owner.query(
      `INSERT INTO notification_user_prefs (org_id, user_id, type, bell) VALUES ($1,$2,'chat_waiting',false)`,
      [orgA, a2],
    );
    const c = await chat();
    await service.sweep(new Date(), CONFIG);
    expect((await rowsFor(c.uuid)).map((x) => Number(x.user_id))).toEqual([a1]);
  });

  it('keeps workspaces apart: each is told about its own chats only, and RLS hides the rows from the other', async () => {
    await reset();
    const ca = await chat({ org: orgA });
    const cb = await chat({ org: orgB });
    const r = await service.sweep(new Date(), CONFIG);

    expect(r).toMatchObject({ candidates: 2, nudged: 2, rows: 3 });
    expect((await rowsFor(ca.uuid)).map((x) => Number(x.user_id))).toEqual([a1, a2]);
    expect((await rowsFor(cb.uuid)).map((x) => Number(x.user_id))).toEqual([b1]);

    // As the restricted role inside workspace B, workspace A's nudges do not exist.
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgB)]);
      const seen = await app.query(`SELECT org_id, user_id FROM inbox_notifications`);
      expect(seen.rows.map((x) => [Number(x.org_id), Number(x.user_id)])).toEqual([[orgB, b1]]);
    } finally {
      await app.query('ROLLBACK');
    }
  });

  it('is bounded: at most one batch per sweep, newest first, and the rest on the next sweep', async () => {
    await reset();
    const older = await chat({ inboundMinutesAgo: 30 });
    const newer = await chat({ inboundMinutesAgo: 10 });
    const small = { ...CONFIG, batch: 1 };

    const first = await service.sweep(new Date(), small);
    expect(first.candidates).toBe(1);
    expect(await rowsFor(newer.uuid)).toHaveLength(2);
    expect(await rowsFor(older.uuid)).toHaveLength(0);

    const second = await service.sweep(new Date(), small);
    expect(second.candidates).toBe(1);
    expect(await rowsFor(older.uuid)).toHaveLength(2);
  });

  it('does nothing when switched off', async () => {
    await reset();
    const c = await chat();
    const r = await service.sweep(new Date(), { ...CONFIG, enabled: false });
    expect(r).toMatchObject({ disabled: true, candidates: 0, rows: 0 });
    expect(await rowsFor(c.uuid)).toHaveLength(0);
  });

  it('a lookback keeps a freshly enabled feature from waking an old backlog', async () => {
    await reset();
    const c = await chat({ inboundMinutesAgo: 3 * 60 });
    const r = await service.sweep(new Date(), { ...CONFIG, lookbackHours: 2 });
    expect(r.candidates).toBe(0);
    expect(await rowsFor(c.uuid)).toHaveLength(0);
    // Whole hours past the wait are still inside a 24 hour lookback.
    expect((await service.sweep(new Date(), { ...CONFIG, lookbackHours: 24 })).rows).toBe(2);
  });
});
