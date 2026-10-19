import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, type SQL } from 'drizzle-orm';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, schema, type Tx } from '@crm/db';
import type { ConversationViewer } from '../../../src/realtime';
import {
  countsSql,
  firstResponseSql,
  topConversationsSql,
  type HistoryContext,
  type HistorySelection,
} from '../../../src/modules/chat-conversations/message-history.query';
import {
  visibleToJoinedSql,
  visibleToSql,
} from '../../../src/modules/team-inbox-conversations/visibility-sql';
import { MessageHistoryRepository } from '../../../src/modules/chat-conversations/message-history.repository';
import { DashRepository } from '../../../src/modules/dashboards-analytics-charts/dash.repository';

/**
 * The speed-ups of the message history and the dashboard (QA timing report) rewrote SQL. This keeps each rewrite equal to the statement it
 * replaced, on messy data: conversations that only receive, only send, send first, answer, with reactions, deleted rows, mirrored broadcast
 * bubbles, a shared and a personal mailbox, equal timestamps. The "old" statements are copied below as they were.
 *
 * Rerun: pnpm --filter @crm/api exec vitest run test/integration/team-inbox-conversations/history-query-rewrites.spec.ts --testTimeout=240000
 */
describe('rewritten history and dashboard queries equal the statements they replaced', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let tx: Tx;
  let orgId: number;
  let me: number;
  let other: number;
  const now = Date.now();
  const window = { from: new Date(now - 15 * 86_400_000), to: new Date(now - 60_000) };

  // a small seeded generator: the same data on every run
  let seed = 12345;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed >> 8) % n; // the low bits of this generator cycle, the high ones do not
  };

  // a spread of milliseconds: rnd() alone reaches only about 2.3 hours, far less than the windows
  const rndMs = (n: number) => rnd(Math.floor(n / 1000)) * 1000 + rnd(1000);

  const q = async (text: string, params: unknown[] = []) => (await owner.query(text, params)).rows;
  const scalar = async (text: string, params: unknown[] = []) =>
    Number((await q(text, params))[0].id);

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    tx = drizzle(owner, { schema }) as unknown as Tx;
    orgId = await scalar(
      `INSERT INTO organizations (slug,name,plan) VALUES ('hq','hq','starter') RETURNING id`,
    );
    me = await scalar(
      `INSERT INTO users (org_id,email,full_name,password_hash) VALUES ($1,'me@t.test','Me','x') RETURNING id`,
      [orgId],
    );
    other = await scalar(
      `INSERT INTO users (org_id,email,full_name,password_hash) VALUES ($1,'o@t.test','O','x') RETURNING id`,
      [orgId],
    );

    const wa = await scalar(
      `INSERT INTO channels (org_id,kind,name) VALUES ($1,'whatsapp','wa') RETURNING id`,
      [orgId],
    );
    const mailbox = async (name: string, scope: string, ownerId: number | null) => {
      const uuid = (await q(`SELECT gen_random_uuid() AS u`))[0].u as string;
      await q(
        `INSERT INTO mail_mailboxes (org_id, uuid, provider, address, display_name, scope, owner_user_id) VALUES ($1,$2,'imap',$3::citext,$3::text,$4,$5)`,
        [orgId, uuid, `${name}@t.test`, scope, ownerId],
      );
      return scalar(
        `INSERT INTO channels (org_id,kind,name,external_id) VALUES ($1,'email',$2,$3) RETURNING id`,
        [orgId, name, uuid],
      );
    };
    const channels = [
      wa,
      await mailbox('shared', 'shared', null),
      await mailbox('mine', 'personal', me),
      await mailbox('theirs', 'personal', other),
    ];

    const contacts: number[] = [];
    for (let i = 0; i < 12; i++) {
      contacts.push(
        await scalar(`INSERT INTO contacts (org_id,name) VALUES ($1,$2) RETURNING id`, [
          orgId,
          `C${i}`,
        ]),
      );
    }

    for (let i = 0; i < 40; i++) {
      const conv = await scalar(
        `INSERT INTO conversations (org_id, channel_id, contact_id, peer_key, title, assignee_user_id) VALUES ($1,$2,$3,$4,'t',$5) RETURNING id`,
        [
          orgId,
          channels[rnd(channels.length)],
          rnd(3) === 0 ? null : contacts[rnd(contacts.length)],
          `p${i}`,
          rnd(3) === 0 ? me : rnd(2) === 0 ? other : null,
        ],
      );
      const style = rnd(4); // 0 only in, 1 only out, 2 customer first, 3 agent first
      const count = 1 + rnd(12);
      for (let s = 1; s <= count; s++) {
        const inbound =
          style === 0 ? true : style === 1 ? false : style === 2 ? s % 2 === 1 : s % 2 === 0;
        const at = new Date(now - rndMs(28 * 86_400_000) - 120_000);
        const kind = rnd(15) === 0 ? 'reaction' : rnd(25) === 0 ? 'system' : 'text';
        const meta = rnd(12) === 0 ? { source: 'broadcast', broadcast_id: '1' } : {};
        const status = inbound
          ? 'received'
          : ['sent', 'delivered', 'read', 'failed', 'queued'][rnd(5)];
        await q(
          `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, created_at, deleted_at, meta, delivered_at, read_at, failure_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)`,
          [
            orgId,
            conv,
            s,
            inbound ? 'in' : 'out',
            kind,
            inbound ? 'customer' : 'agent',
            status,
            at,
            rnd(20) === 0 ? at : null,
            JSON.stringify(meta),
            status === 'delivered' || status === 'read' ? at : null,
            status === 'read' ? at : null,
            status === 'failed' ? 'boom' : null,
          ],
        );
      }
    }
    // messages exactly on the edges of the windows: the current window is [from, to) and the previous one [from - span, from)
    const edge = await scalar(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,'edge','t') RETURNING id`,
      [orgId, wa],
    );
    const span = window.to.getTime() - window.from.getTime();
    for (const [s, at] of [
      [1, window.from],
      [2, new Date(window.from.getTime() - span)],
      [3, window.to],
    ] as const) {
      await q(
        `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, created_at) VALUES ($1,$2,$3,'in','text','customer','received',$4)`,
        [orgId, edge, s, at],
      );
    }
    // recipients of one broadcast: they belong to no conversation, so the history adds them to the messages' numbers
    const bx = await scalar(`INSERT INTO broadcasts (org_id, name) VALUES ($1,'b1') RETURNING id`, [
      orgId,
    ]);
    for (let i = 0; i < 30; i++) {
      const at = new Date(now - rndMs(28 * 86_400_000) - 120_000);
      await q(
        `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status, created_at, sent_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          orgId,
          bx,
          contacts[rnd(contacts.length)],
          ['pending', 'sent', 'delivered', 'read', 'failed'][rnd(5)],
          at,
          rnd(2) === 0 ? at : null,
        ],
      );
    }
    // two messages at exactly the same instant in one conversation: the strict "after" must still hold
    const same = await scalar(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,'same','t') RETURNING id`,
      [orgId, wa],
    );
    const t = new Date(now - 3 * 86_400_000);
    for (const [s, dir] of [
      [1, 'in'],
      [2, 'out'],
    ] as const) {
      await q(
        `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, created_at) VALUES ($1,$2,$3,$4,'text',$5,$6,$7)`,
        [
          orgId,
          same,
          s,
          dir,
          dir === 'in' ? 'customer' : 'agent',
          dir === 'in' ? 'received' : 'sent',
          t,
        ],
      );
    }
  }, 300_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  const viewers = (): ConversationViewer[] => [
    { userId: me, scope: 'all', teamIds: [], readsPersonalMail: false },
    { userId: me, scope: 'all', teamIds: [], readsPersonalMail: true },
    { userId: me, scope: 'own', teamIds: [], readsPersonalMail: false },
    { userId: other, scope: 'team', teamIds: [], readsPersonalMail: false },
  ];
  const ctxOf = (viewer: ConversationViewer, joined: boolean): HistoryContext => {
    const v = joined
      ? visibleToJoinedSql(viewer, 'c')
      : { joins: sql``, where: visibleToSql(viewer, 'c') };
    return {
      orgId,
      conversationJoins: v.joins,
      conversationVisible: v.where,
      bulk: false,
      contacts: { scope: 'all', userId: viewer.userId },
      cost: false,
    };
  };
  const sel: HistorySelection = { window, scoping: {}, narrow: {} };
  const rows = async (s: SQL) => (await tx.execute(s)).rows as Array<Record<string, unknown>>;

  const feed = (a: string) =>
    sql.raw(`${a}.kind NOT IN ('system', 'reaction') AND ${a}.deleted_at IS NULL
    AND NOT (COALESCE(${a}.meta ->> 'source', '') = 'broadcast' AND ${a}.meta ->> 'broadcast_id' IS NOT NULL)
    AND NOT (COALESCE(${a}.meta ->> 'source', '') = 'campaign' AND (${a}.meta ->> 'campaign_id' IS NOT NULL OR COALESCE(${a}.provider_message_id, '') LIKE 'campaign:%'))`);

  // the statements as they were before the rewrite
  const oldFirstResponse = (ctx: HistoryContext): SQL => sql`
    WITH first_in AS (
      SELECT m.conversation_id, min(m.created_at) AS at
      FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
      WHERE m.org_id = ${ctx.orgId} AND m.direction = 'in' AND ${feed('m')}
        AND m.created_at >= ${window.from} AND m.created_at < ${window.to}
        AND (${ctx.conversationVisible})
      GROUP BY m.conversation_id)
    SELECT avg(EXTRACT(EPOCH FROM (o.at - f.at)))::int AS seconds
    FROM first_in f
    CROSS JOIN LATERAL (
      SELECT min(m2.created_at) AS at FROM messages m2
      WHERE m2.org_id = ${ctx.orgId} AND m2.conversation_id = f.conversation_id AND m2.direction = 'out'
        AND ${feed('m2')}
        AND m2.created_at > f.at AND m2.created_at < ${window.to}) o
    WHERE o.at IS NOT NULL`;
  const oldTop = (ctx: HistoryContext, limit: number): SQL => sql`
    SELECT c.uuid AS conversation_uuid, count(*)::int AS n, max(m.created_at) AS last_at
    FROM messages m
    JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
    WHERE m.org_id = ${ctx.orgId} AND ${feed('m')}
      AND m.created_at >= ${window.from} AND m.created_at < ${window.to}
      AND (${ctx.conversationVisible})
    GROUP BY c.org_id, c.id
    ORDER BY n DESC, last_at DESC, c.id DESC
    LIMIT ${limit}`;

  it('first response time: same average for every viewer', async () => {
    let compared = 0;
    for (const v of viewers()) {
      const before = (await rows(oldFirstResponse(ctxOf(v, false))))[0]!.seconds;
      const after = (await rows(firstResponseSql(ctxOf(v, true), sel)))[0]!.seconds;
      expect(after, JSON.stringify(v)).toEqual(before);
      if (before !== null) compared++;
    }
    expect(compared, 'the data must give at least one real average').toBeGreaterThan(0);
  });

  it('most active conversations: same conversations, counts and order', async () => {
    for (const v of viewers()) {
      const pick = (r: Array<Record<string, unknown>>) =>
        r.map((x) => [x.conversation_uuid, x.n, new Date(x.last_at as string).getTime()]);
      const before = pick(await rows(oldTop(ctxOf(v, false), 6)));
      const after = pick(await rows(topConversationsSql(ctxOf(v, true), sel, 6)));
      expect(after, JSON.stringify(v)).toEqual(before);
      expect(before.length).toBeGreaterThan(0);
    }
  });

  it('the KPI counts do not change with the join form of the visibility rule', async () => {
    for (const v of viewers()) {
      const before = (await rows(countsSql(ctxOf(v, false), sel)))[0];
      const after = (await rows(countsSql(ctxOf(v, true), sel)))[0];
      expect(after, JSON.stringify(v)).toEqual(before);
    }
  });

  it('dashboard counts: the per-conversation form gives the old numbers', async () => {
    const f = window.from.toISOString();
    const t = window.to.toISOString();
    const DELIVERED = `(status IN ('delivered','read') OR delivered_at IS NOT NULL OR read_at IS NOT NULL)`;
    const FAILED = `(status IN ('failed','undelivered') OR (failure_reason IS NOT NULL AND delivered_at IS NULL AND read_at IS NULL AND status NOT IN ('delivered','read')))`;
    const READ = `(read_at IS NOT NULL OR status = 'read')`;
    const old = (
      await rows(
        sql.raw(`
      WITH s AS (SELECT * FROM (SELECT created_at, direction, status, delivered_at, read_at, failure_reason, template_id, kind, conversation_id
        FROM messages WHERE org_id = ${orgId} AND kind <> 'reaction' AND created_at >= '${f}'::timestamptz AND created_at < '${t}'::timestamptz) m)
      SELECT count(*) FILTER (WHERE direction = 'out')::int AS sent,
        count(*) FILTER (WHERE direction = 'out' AND ${DELIVERED})::int AS delivered,
        count(*) FILTER (WHERE direction = 'out' AND ${FAILED})::int AS failed,
        count(*) FILTER (WHERE direction = 'out' AND ${READ})::int AS read,
        count(*) FILTER (WHERE direction = 'in')::int AS replies,
        count(DISTINCT conversation_id) FILTER (WHERE direction = 'in')::int AS repliers,
        count(DISTINCT conversation_id) FILTER (WHERE direction = 'out')::int AS contacts_messaged,
        count(DISTINCT conversation_id) FILTER (WHERE direction = 'out' AND ${DELIVERED})::int AS contacts_delivered,
        count(DISTINCT conversation_id) FILTER (WHERE direction = 'in' AND conversation_id IN (SELECT conversation_id FROM s WHERE direction = 'out'))::int AS contacts_replied
      FROM s`),
      )
    )[0]!;
    const got = await new DashRepository().counts(tx, orgId, window.from, window.to);
    expect(got).toMatchObject({
      sent: old.sent,
      delivered: old.delivered,
      failed: old.failed,
      read: old.read,
      replies: old.replies,
      repliers: old.repliers,
      contactsMessaged: old.contacts_messaged,
      contactsDelivered: old.contacts_delivered,
      contactsReplied: old.contacts_replied,
    });
    expect(
      Number(old.contacts_replied),
      'some conversation must be both messaged and replied to',
    ).toBeGreaterThan(0);
  });

  // --- the shared scan of the charts against the statement-per-chart it replaced (insightsLegacy) -----------------------------
  const repo = new MessageHistoryRepository();
  const narrows: Array<[string, HistorySelection['narrow']]> = [
    ['no filter', {}],
    ['outgoing only', { dir: 'out' }],
    ['failed only', { dir: 'fail' }],
    ['status read', { status: 'read' }],
    ['type text', { type: 'text' }],
    ['source inbox', { source: ['inbox'] }],
    ['search by contact name', { q: 'C1' }],
  ];

  it('insights: the shared scan equals one statement per chart, for every viewer, filter and bucket', async () => {
    let withTop = 0;
    for (const v of viewers()) {
      for (const [label, narrow] of narrows) {
        for (const [bucket, tz] of [
          ['daily', 'Asia/Kolkata'],
          ['hourly', 'UTC'],
          ['weekly', 'America/New_York'],
        ] as const) {
          const ctx = { ...ctxOf(v, true), bulk: label === 'no filter' };
          const s: HistorySelection = { window, scoping: {}, narrow };
          const seriesFrom =
            bucket === 'hourly'
              ? new Date(Math.max(window.from.getTime(), window.to.getTime() - 86_400_000))
              : window.from;
          const fast = await repo.insights(tx, ctx, s, { bucket, tz, seriesFrom });
          const slow = await repo.insightsLegacy(tx, ctx, s, { bucket, tz, seriesFrom });
          expect(fast, JSON.stringify([v.scope, label, bucket])).toEqual(slow);
          if (slow.topConversations.length > 0) withTop++;
        }
      }
    }
    expect(withTop, 'the data must give top conversations').toBeGreaterThan(0);
  });
});
