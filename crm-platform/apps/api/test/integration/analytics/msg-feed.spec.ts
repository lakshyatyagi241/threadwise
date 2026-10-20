import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MESSAGE_KIND_CLASS,
  MESSAGE_STATUS_CODE,
  SOURCE_KIND,
  feedType,
  messageKindClass,
  packFeedClass,
} from '@crm/contracts';
import { runMigrations, schema, type Tx } from '@crm/db';
import {
  MessageFeedService,
  orgTimezone,
} from '../../../src/modules/analytics/query/message-feed.service';
import {
  MessageHistoryRepository,
  type HistoryContext,
  type HistorySelection,
} from '../../../src/modules/chat-conversations';
import {
  feedRollup,
  hiddenChannelIds,
} from '../../../src/modules/team-inbox-conversations/message-history-rollup';
import { visibleToJoinedSql } from '../../../src/modules/team-inbox-conversations/visibility-sql';
import { figuresFromRollup } from '../../../src/modules/admin-console-shell/overview-stats.service';
import { RollupService } from '../../../src/modules/analytics/rollup/rollup.service';

/**
 * The message-count rollup end to end on a real Postgres (docs/superpowers/specs/2026-10-19-message-count-rollup-design.md): the trigger that
 * writes MSG_STATE and first-reply events, the base rebuild for messages older than the cut-over, the worker, and the stitched reads. The
 * reference for every read is a count of `messages` itself, so a read is right when it equals what the live scan gives for the same window.
 *
 * Rerun: pnpm --filter @crm/api exec vitest run test/integration/analytics/msg-feed.spec.ts --testTimeout=300000
 */
describe('message feed rollup', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let tx: Tx;
  let cutover: Date;
  const feed = new MessageFeedService();

  const min = (n: number) => n * 60_000;
  const after = (ms: number) => new Date(cutover.getTime() + ms); // a message created at or after the cut-over has events
  const before = (ms: number) => new Date(cutover.getTime() - ms); // an older one is in the base rollup

  // a small seeded generator: the same data on every run. The low bits of this generator cycle, so the high ones are used.
  let seed = 424242;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed >> 8) % n;
  };
  const rndMs = (n: number) => rnd(Math.floor(n / 1000)) * 1000 + rnd(1000);

  const q = async (text: string, params: unknown[] = []) => (await owner.query(text, params)).rows;
  const scalar = async (text: string, params: unknown[] = []) =>
    Number((await q(text, params))[0].id);

  // the worker, driven with the owner connection in one transaction per call
  const rollup = new RollupService({
    privileged: async <T>(fn: (t: Tx) => Promise<T>): Promise<T> => {
      await owner.query('BEGIN');
      try {
        const r = await fn(drizzle(owner, { schema }) as unknown as Tx);
        await owner.query('COMMIT');
        return r;
      } catch (e) {
        await owner.query('ROLLBACK');
        throw e;
      }
    },
  });
  // folds everything recorded so far; the watermark stops at the database clock, so later events stay in the tail
  const fold = async () =>
    rollup.runOnce({ upTo: new Date((await q(`SELECT clock_timestamp() AS t`))[0].t) });

  interface Org {
    id: number;
    tz: string;
    wa: number;
    shared: number;
    personal: number;
    convs: number[];
    user: number;
  }
  const orgs: Org[] = [];

  async function makeOrg(slug: string, tz: string): Promise<Org> {
    const id = await scalar(
      `INSERT INTO organizations (slug, name, plan) VALUES ($1, $1, 'starter') RETURNING id`,
      [slug],
    );
    await q(
      `INSERT INTO workspace_settings (org_id, timezone) VALUES ($1, $2) ON CONFLICT (org_id) DO UPDATE SET timezone = excluded.timezone`,
      [id, tz],
    );
    const user = await scalar(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1, $2, 'U', 'x') RETURNING id`,
      [id, `${slug}@t.test`],
    );
    const wa = await scalar(
      `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'whatsapp', 'wa') RETURNING id`,
      [id],
    );
    const mailbox = async (name: string, scope: string, ownerId: number | null) => {
      const uuid = (await q(`SELECT gen_random_uuid() AS u`))[0].u as string;
      await q(
        `INSERT INTO mail_mailboxes (org_id, uuid, provider, address, display_name, scope, owner_user_id) VALUES ($1,$2,'imap',$3::citext,$3::text,$4,$5)`,
        [id, uuid, `${slug}-${name}@t.test`, scope, ownerId],
      );
      return scalar(
        `INSERT INTO channels (org_id, kind, name, external_id) VALUES ($1,'email',$2,$3) RETURNING id`,
        [id, name, uuid],
      );
    };
    const shared = await mailbox('shared', 'shared', null);
    const personal = await mailbox('personal', 'personal', user);
    const convs: number[] = [];
    for (const ch of [wa, wa, shared, personal]) {
      convs.push(
        await scalar(
          `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,$3,'t') RETURNING id`,
          [id, ch, `p${convs.length}-${slug}`],
        ),
      );
    }
    return { id, tz, wa, shared, personal, convs, user };
  }

  let seq = 1;
  interface Msg {
    org: number;
    conv: number;
    dir?: 'in' | 'out';
    kind?: string;
    status?: string;
    at: Date;
    meta?: Record<string, unknown>;
    provider?: string | null;
    agent?: number | null;
    user?: number | null;
    senderKind?: string;
  }
  async function insert(m: Msg): Promise<number> {
    const dir = m.dir ?? 'out';
    return scalar(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, sender_agent_id, sender_user_id, status, created_at, meta, provider_message_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) RETURNING id`,
      [
        m.org,
        m.conv,
        (seq += 1),
        dir,
        m.kind ?? 'text',
        m.senderKind ?? (dir === 'in' ? 'customer' : 'agent'),
        m.agent ?? null,
        m.user ?? null,
        m.status ?? (dir === 'in' ? 'received' : 'queued'),
        m.at.toISOString(),
        JSON.stringify(m.meta ?? {}),
        m.provider ?? null,
      ],
    );
  }
  const setStatus = (id: number, status: string) =>
    q(`UPDATE messages SET status = $2 WHERE id = $1`, [id, status]);
  const events = (conv: number) =>
    q(
      `SELECT type, status, k2, direction, source_kind, k1, channel_id, conversation_id, qty, occurred_at, duration_ms, agent_id FROM an_events WHERE conversation_id = $1 ORDER BY id`,
      [conv],
    );

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
    tx = drizzle(owner, { schema }) as unknown as Tx;
    cutover = new Date((await q(`SELECT an_msg_feed_cutover() AS c`))[0].c);
    orgs.push(
      await makeOrg('mf-utc', 'UTC'),
      await makeOrg('mf-kolkata', 'Asia/Kolkata'),
      await makeOrg('mf-ny', 'America/New_York'),
    );
  }, 300_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  describe('the writer', () => {
    it('a created message writes one state event with its dimensions, stamped with its creation time', async () => {
      const o = orgs[0]!;
      const at = after(min(5));
      await insert({ org: o.id, conv: o.convs[0]!, dir: 'in', kind: 'image', at });
      const [e, ...rest] = await events(o.convs[0]!);
      expect(rest).toHaveLength(0);
      expect(e).toMatchObject({
        type: 7,
        status: MESSAGE_STATUS_CODE.received,
        k2: null,
        direction: 1,
        source_kind: SOURCE_KIND.inbox,
        k1: MESSAGE_KIND_CLASS.image,
        qty: 1,
      });
      expect([Number(e.channel_id), Number(e.conversation_id)]).toEqual([o.wa, o.convs[0]]);
      expect(new Date(e.occurred_at).getTime()).toBe(at.getTime());
    });

    it('a status change writes one event that enters the new status and leaves the old, still stamped with the creation time', async () => {
      const o = orgs[0]!;
      const conv = o.convs[1]!;
      const at = after(min(10));
      const id = await insert({ org: o.id, conv, at });
      await setStatus(id, 'sent');
      await setStatus(id, 'delivered');
      const ev = await events(conv);
      expect(ev.map((e) => [e.status, e.k2, e.direction])).toEqual([
        [MESSAGE_STATUS_CODE.queued, null, 2],
        [MESSAGE_STATUS_CODE.sent, MESSAGE_STATUS_CODE.queued, 2],
        [MESSAGE_STATUS_CODE.delivered, MESSAGE_STATUS_CODE.sent, 2],
      ]);
      for (const e of ev) expect(new Date(e.occurred_at).getTime()).toBe(at.getTime());
    });

    it('writes nothing for a system line, a reaction, a mirrored broadcast or campaign bubble, a message older than the cut-over, or a status update that changes nothing', async () => {
      const o = orgs[0]!;
      const conv = o.convs[2]!;
      await insert({ org: o.id, conv, kind: 'system', at: after(min(20)) });
      await insert({ org: o.id, conv, kind: 'reaction', at: after(min(21)) });
      await insert({
        org: o.id,
        conv,
        at: after(min(22)),
        meta: { source: 'broadcast', broadcast_id: '1' },
      });
      await insert({
        org: o.id,
        conv,
        at: after(min(23)),
        meta: { source: 'campaign' },
        provider: 'campaign:1:2',
      });
      const old = await insert({ org: o.id, conv, at: before(min(30)) });
      await setStatus(old, 'sent'); // an old message's change is the base rollup's business
      const live = await insert({ org: o.id, conv, at: after(min(24)) });
      await q(`UPDATE messages SET status = status WHERE id = $1`, [live]);
      await q(`UPDATE messages SET deleted_at = now() WHERE id = $1`, [live]); // deleting is not a status change (decision D10)
      expect(await events(conv)).toHaveLength(1); // only the one live message's creation
      // the History's scan leaves a deleted message out and the rollup keeps it (D10): undo it so the parity tests compare like with like
      await q(`UPDATE messages SET deleted_at = NULL WHERE id = $1`, [live]);
    });

    it('never fails the message when the event cannot be written', async () => {
      const o = orgs[0]!;
      await q(`ALTER TABLE an_events ADD CONSTRAINT zz_fail CHECK (false) NOT VALID`);
      try {
        const id = await insert({ org: o.id, conv: o.convs[3]!, at: after(min(40)) });
        await setStatus(id, 'sent');
        expect(
          Number((await q(`SELECT count(*) AS id FROM messages WHERE id = $1`, [id]))[0].id),
        ).toBe(1);
        expect(await events(o.convs[3]!)).toHaveLength(0);
      } finally {
        await q(`ALTER TABLE an_events DROP CONSTRAINT zz_fail`);
        // that message has no event by design (the writer fails open); drop it so the parity tests below compare like with like
        await q(`DELETE FROM messages WHERE conversation_id = $1 AND created_at = $2`, [
          o.convs[3],
          after(min(40)).toISOString(),
        ]);
      }
    });

    it('the first reply is one event with the time from the first customer message, and later replies write none', async () => {
      const o = orgs[1]!;
      const conv = await scalar(
        `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,'fr1','t') RETURNING id`,
        [o.id, o.wa],
      );
      await insert({ org: o.id, conv, dir: 'out', at: after(min(50)) }); // an agent writing first is not a reply
      await insert({ org: o.id, conv, dir: 'in', at: after(min(52)) });
      await insert({ org: o.id, conv, dir: 'in', at: after(min(53)) });
      await insert({ org: o.id, conv, dir: 'out', at: after(min(55)), user: o.user });
      await insert({ org: o.id, conv, dir: 'out', at: after(min(56)) });
      const replies = (await events(conv)).filter((e) => e.type === 42);
      expect(replies).toHaveLength(1);
      expect(Number(replies[0].duration_ms)).toBe(min(3)); // 52 -> 55
      expect(String(replies[0].agent_id)).toBe(String(o.user));
      expect(String(replies[0].channel_id)).toBe(String(o.wa));
    });

    it('a conversation that was already replied to before the cut-over gets no second first reply', async () => {
      const o = orgs[1]!;
      const conv = await scalar(
        `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,'fr2','t') RETURNING id`,
        [o.id, o.wa],
      );
      await insert({ org: o.id, conv, dir: 'in', at: before(min(120)) });
      await insert({ org: o.id, conv, dir: 'out', at: before(min(100)) }); // the base rollup counts this reply
      await insert({ org: o.id, conv, dir: 'out', at: after(min(60)) });
      expect((await events(conv)).filter((e) => e.type === 42)).toHaveLength(0);
      const st = (await q(`SELECT first_replied_at FROM conversations WHERE id = $1`, [conv]))[0];
      expect(new Date(st.first_replied_at).getTime()).toBe(before(min(100)).getTime()); // the state is healed to the real first reply
    });
  });

  describe('the codes the SQL uses equal the contracts', () => {
    it('status, kind class and the feed type for every combination', async () => {
      for (const [name, code] of Object.entries(MESSAGE_STATUS_CODE)) {
        expect(Number((await q(`SELECT an_msg_status_code($1) AS id`, [name]))[0].id), name).toBe(
          code,
        );
      }
      for (const kind of [
        'text',
        'template',
        'image',
        'video',
        'audio',
        'voice',
        'document',
        'sticker',
        'location',
        'contact',
        'interactive',
        'reaction',
        'system',
        'new-kind',
      ]) {
        expect(Number((await q(`SELECT an_msg_kind_class($1) AS id`, [kind]))[0].id), kind).toBe(
          messageKindClass(kind),
        );
      }
    });

    it('the source of a message, for every shape the history distinguishes', async () => {
      const ref = (
        dir: string,
        source: string | null,
        agent: number | null,
        senderKind: string,
      ): number => {
        if (dir === 'in') return SOURCE_KIND.inbox;
        const bySource: Record<string, number> = {
          auto_reply: SOURCE_KIND.auto_reply,
          flow: SOURCE_KIND.flow,
          ai: SOURCE_KIND.ai,
          api: SOURCE_KIND.api,
          broadcast: SOURCE_KIND.broadcast,
          campaign: SOURCE_KIND.campaign,
          scheduled: SOURCE_KIND.scheduled,
        };
        if (source && bySource[source]) return bySource[source]!;
        if (agent !== null) return SOURCE_KIND.ai;
        if (senderKind === 'agent' || source === 'inbox') return SOURCE_KIND.inbox;
        return SOURCE_KIND.other;
      };
      for (const dir of ['in', 'out']) {
        for (const source of [
          null,
          'inbox',
          'auto_reply',
          'flow',
          'ai',
          'api',
          'broadcast',
          'campaign',
          'scheduled',
          'weird',
        ]) {
          for (const agent of [null, 7]) {
            for (const senderKind of ['agent', 'bot', 'system']) {
              const meta = source ? JSON.stringify({ source }) : '{}';
              const got = Number(
                (
                  await q(`SELECT an_msg_source_kind($1, $2::jsonb, $3, $4) AS id`, [
                    dir,
                    meta,
                    agent,
                    senderKind,
                  ])
                )[0].id,
              );
              expect(got, JSON.stringify([dir, source, agent, senderKind])).toBe(
                ref(dir, source, agent, senderKind),
              );
            }
          }
        }
      }
    });
  });

  describe('the stitched read equals a count of messages', () => {
    const STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed'];
    const KINDS = [
      'text',
      'text',
      'template',
      'image',
      'voice',
      'document',
      'location',
      'system',
      'reaction',
    ];
    const SOURCES: Array<Record<string, unknown>> = [
      {},
      {},
      { source: 'flow' },
      { source: 'auto_reply' },
      { source: 'ai' },
      { source: 'api' },
      { source: 'broadcast' },
      { source: 'inbox' },
    ];
    const progressed: Array<{ id: number; status: string }> = [];

    async function populate(o: Org): Promise<void> {
      // older than the cut-over: their rollup is the base, rebuilt from messages, and they are not changed afterwards
      for (let i = 0; i < 160; i++) {
        const dir = rnd(3) === 0 ? 'in' : 'out';
        await insert({
          org: o.id,
          conv: o.convs[rnd(o.convs.length)]!,
          dir,
          kind: KINDS[rnd(KINDS.length)],
          at: before(rndMs(24 * 86_400_000) + 1000),
          status: dir === 'in' ? 'received' : STATUSES[rnd(STATUSES.length)],
          meta: dir === 'out' ? SOURCES[rnd(SOURCES.length)] : {},
        });
      }
      // newer than the cut-over: events. Created queued or received, then moved on by status updates (some before the worker runs, some after)
      for (let i = 0; i < 220; i++) {
        const dir = rnd(3) === 0 ? 'in' : 'out';
        const id = await insert({
          org: o.id,
          conv: o.convs[rnd(o.convs.length)]!,
          dir,
          kind: KINDS[rnd(KINDS.length)],
          at: after(rndMs(9 * 86_400_000) + 2000),
          meta: dir === 'out' ? SOURCES[rnd(SOURCES.length)] : {},
        });
        if (dir === 'out') progressed.push({ id, status: 'queued' });
      }
    }
    async function advance(share: number): Promise<void> {
      const order = ['queued', 'sent', 'delivered', 'read'];
      for (const m of progressed) {
        if (rnd(100) >= share) continue;
        const i = order.indexOf(m.status);
        if (rnd(8) === 0) {
          await setStatus(m.id, 'failed');
          m.status = 'failed';
        } else if (i >= 0 && i < order.length - 1) {
          const next = order[i + 1 + rnd(order.length - i - 1)]!;
          await setStatus(m.id, next);
          m.status = next;
        }
      }
    }

    beforeAll(async () => {
      for (const o of orgs) await populate(o);
      await advance(60);
      for (const o of orgs)
        await q(`SELECT an_msg_feed_rebuild_base($1, $2, $3)`, [
          o.id,
          before(40 * 86_400_000),
          cutover,
        ]);
      await fold();
      await advance(40); // these changes are events the worker has not folded yet: the read must add them from the tail
    }, 600_000);

    const live = async (
      o: Org,
      from: Date,
      to: Date,
      hidden: number[],
    ): Promise<Map<number, number>> => {
      const rows = await q(
        `SELECT an_msg_status_code(m.status) AS s, count(*) AS n FROM messages m LEFT JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
          WHERE m.org_id = $1 AND an_msg_feed_counted(m.kind, m.meta, m.provider_message_id) AND m.created_at >= $2 AND m.created_at < $3
            AND coalesce(c.channel_id, 0) <> ALL($4::bigint[]) GROUP BY 1`,
        [o.id, from.toISOString(), to.toISOString(), hidden],
      );
      return new Map(rows.map((r) => [Number(r.s), Number(r.n)]));
    };

    // a window boundary inside the repeated hour of a daylight-saving change is the one known case the hour buckets cannot answer exactly
    const inRepeatedHour = (d: Date) =>
      d.getTime() >= Date.parse('2026-11-01T05:00:00Z') &&
      d.getTime() <= Date.parse('2026-11-01T07:00:00Z');

    const windows = (o: Org): Array<[Date, Date]> => {
      const out: Array<[Date, Date]> = [];
      const lo = -23 * 86_400_000;
      const hi = 8 * 86_400_000;
      while (out.length < 40) {
        const f = after(lo + rndMs(hi - lo - 86_400_000));
        const t = new Date(f.getTime() + min(20) + rndMs(14 * 86_400_000));
        if (o.tz === 'America/New_York' && (inRepeatedHour(f) || inRepeatedHour(t))) continue;
        out.push([f, t]);
      }
      return out;
    };

    it('the counts by status equal the live count for random windows, in three time zones, with and without a hidden channel', async () => {
      for (const o of orgs) {
        const tz = await orgTimezone(tx, o.id);
        expect(tz).toBe(o.tz);
        for (const [from, to] of windows(o)) {
          for (const hidden of [[], [o.personal]]) {
            const got = (
              await feed.counts(tx, { orgId: o.id, from, to, tz }, { hiddenChannelIds: hidden })
            ).byStatus;
            const want = await live(o, from, to, hidden);
            for (const s of Object.values(MESSAGE_STATUS_CODE)) {
              expect(
                got.get(s) ?? 0,
                `${o.tz} ${s} ${from.toISOString()} ${to.toISOString()} hidden=${hidden}`,
              ).toBe(want.get(s) ?? 0);
            }
          }
        }
      }
    });

    it('windows that start and end exactly on an hour, and on a local day, equal the live count', async () => {
      for (const o of orgs) {
        const day = async (d: number) =>
          new Date(
            (
              await q(
                `SELECT (date_trunc('day', $1::timestamptz AT TIME ZONE $2) AT TIME ZONE $2) AS d`,
                [after(d * 86_400_000), o.tz],
              )
            )[0].d,
          );
        const cases: Array<[Date, Date]> = [
          [await day(-9), await day(-2)],
          [await day(-9), await day(4)],
          [
            new Date(Math.ceil(after(-5 * 86_400_000).getTime() / 3_600_000) * 3_600_000),
            new Date(Math.floor(after(3 * 86_400_000).getTime() / 3_600_000) * 3_600_000),
          ],
          [await day(-3), new Date((await day(-3)).getTime() + min(30))], // inside one hour: only the edge piece
          [await day(-1), await day(0)], // one local day, which may be 23 or 25 hours long
        ];
        for (const [from, to] of cases) {
          if (o.tz === 'America/New_York' && (inRepeatedHour(from) || inRepeatedHour(to))) continue;
          const got = (await feed.counts(tx, { orgId: o.id, from, to, tz: o.tz })).byStatus;
          const want = await live(o, from, to, []);
          for (const s of Object.values(MESSAGE_STATUS_CODE))
            expect(got.get(s) ?? 0, `${o.tz} ${s} ${from.toISOString()}`).toBe(want.get(s) ?? 0);
        }
      }
    });

    it('the answer does not change when the worker folds the tail', async () => {
      const o = orgs[1]!;
      const w = { orgId: o.id, from: after(-12 * 86_400_000), to: after(8 * 86_400_000), tz: o.tz };
      const beforeFold = (await feed.counts(tx, w)).byStatus;
      await fold();
      const afterFold = (await feed.counts(tx, w)).byStatus;
      for (const s of Object.values(MESSAGE_STATUS_CODE))
        expect(afterFold.get(s) ?? 0, String(s)).toBe(beforeFold.get(s) ?? 0);
    });

    it('the volume per day, the type mix and the filters equal the live count', async () => {
      for (const o of orgs) {
        const from = after(-10 * 86_400_000);
        const to = after(7 * 86_400_000);
        if (o.tz === 'America/New_York' && (inRepeatedHour(from) || inRepeatedHour(to))) continue;
        const w = { orgId: o.id, from, to, tz: o.tz };
        const volume = await feed.volume(tx, w, 'day');
        const want = await q(
          `SELECT to_char((date_trunc('day', m.created_at AT TIME ZONE $4) AT TIME ZONE $4) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at,
                  count(*) FILTER (WHERE m.status IN ('queued','sent','delivered','read')) AS sent, count(*) FILTER (WHERE m.status = 'received') AS received, count(*) FILTER (WHERE m.status = 'failed') AS failed
             FROM messages m WHERE m.org_id = $1 AND an_msg_feed_counted(m.kind, m.meta, m.provider_message_id) AND m.created_at >= $2 AND m.created_at < $3 GROUP BY 1`,
          [o.id, from.toISOString(), to.toISOString(), o.tz],
        );
        const byAt = new Map(want.map((r) => [String(r.at), r]));
        let busy = 0;
        for (const v of volume) {
          const r = byAt.get(v.at);
          expect([v.sent, v.received, v.failed], `${o.tz} ${v.at}`).toEqual([
            Number(r?.sent ?? 0),
            Number(r?.received ?? 0),
            Number(r?.failed ?? 0),
          ]);
          if (v.sent + v.received + v.failed > 0) busy++;
        }
        expect(busy).toBeGreaterThan(5);

        // the type mix, and the dimension filters: source, direction, status, channel
        const mixWant = new Map<string, number>();
        for (const r of await q(
          `SELECT an_msg_source_kind(m.direction, m.meta, m.sender_agent_id, m.sender_kind) AS s, an_msg_kind_class(m.kind) AS k, count(*) AS n
             FROM messages m WHERE m.org_id = $1 AND an_msg_feed_counted(m.kind, m.meta, m.provider_message_id) AND m.created_at >= $2 AND m.created_at < $3 GROUP BY 1, 2`,
          [o.id, from.toISOString(), to.toISOString()],
        )) {
          const type = feedType(packFeedClass(Number(r.s), Number(r.k)));
          mixWant.set(type, (mixWant.get(type) ?? 0) + Number(r.n));
        }
        const mix = await feed.byType(tx, w);
        expect([...mix.entries()].sort()).toEqual([...mixWant.entries()].sort());

        const outFailed =
          (await feed.counts(tx, w, { dir: 'fail' })).byStatus.get(MESSAGE_STATUS_CODE.failed) ?? 0;
        expect(outFailed).toBe(
          Number(
            (
              await q(
                `SELECT count(*) AS n FROM messages m WHERE m.org_id = $1 AND an_msg_feed_counted(m.kind, m.meta, m.provider_message_id) AND m.created_at >= $2 AND m.created_at < $3 AND m.status = 'failed'`,
                [o.id, from.toISOString(), to.toISOString()],
              )
            )[0].n,
          ),
        );
        const fromFlow = (await feed.counts(tx, w, { sources: [SOURCE_KIND.flow, SOURCE_KIND.ai] }))
          .byStatus;
        const flowWant = Number(
          (
            await q(
              `SELECT count(*) AS n FROM messages m WHERE m.org_id = $1 AND an_msg_feed_counted(m.kind, m.meta, m.provider_message_id) AND m.created_at >= $2 AND m.created_at < $3 AND an_msg_source_kind(m.direction, m.meta, m.sender_agent_id, m.sender_kind) IN (5, 9)`,
              [o.id, from.toISOString(), to.toISOString()],
            )
          )[0].n,
        );
        expect([...fromFlow.values()].reduce((a, b) => a + b, 0)).toBe(flowWant);
        expect(flowWant).toBeGreaterThan(0);
        const oneChannel = (await feed.counts(tx, w, { channelId: o.shared })).byStatus;
        const chWant = Number(
          (
            await q(
              `SELECT count(*) AS n FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id WHERE m.org_id = $1 AND an_msg_feed_counted(m.kind, m.meta, m.provider_message_id) AND m.created_at >= $2 AND m.created_at < $3 AND c.channel_id = $4`,
              [o.id, from.toISOString(), to.toISOString(), o.shared],
            )
          )[0].n,
        );
        expect([...oneChannel.values()].reduce((a, b) => a + b, 0)).toBe(chWant);
      }
    });

    it('the base rebuild can run again and gives the same rows', async () => {
      const o = orgs[0]!;
      const rows = () =>
        q(
          `SELECT metric, bucket, d1, d2, d3, n, s1 FROM an_rollup_day WHERE org_id = $1 AND metric IN (6, 7) ORDER BY 1, 2, 3, 4, 5`,
          [o.id],
        );
      const first = await rows();
      await q(`SELECT an_msg_feed_rebuild_base($1, $2, $3)`, [
        o.id,
        before(40 * 86_400_000),
        cutover,
      ]);
      expect(await rows()).toEqual(first);
      expect(first.length).toBeGreaterThan(0);
      // the nightly job's rebuild of the last days (every workspace) leaves the rows as they are, and refuses a bad range
      expect(await rollup.rebuildMessageBase(40)).toBe(0);
      expect(await rows()).toEqual(first);
      await expect(rollup.rebuildMessageBase(0)).rejects.toThrow('bad days');
    });
  });

  describe('the average first reply', () => {
    it('averages the replies made in the whole hours of the window, from the base rows and the events together', async () => {
      const o = await makeOrg('mf-reply', 'UTC');
      const replied = async (inAt: Date, outAt: Date) => {
        const conv = await scalar(
          `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,$3,'t') RETURNING id`,
          [o.id, o.wa, `r${seq++}`],
        );
        await insert({ org: o.id, conv, dir: 'in', at: inAt });
        await insert({ org: o.id, conv, dir: 'out', at: outAt });
      };
      const hour = (h: number) =>
        new Date(Math.floor(cutover.getTime() / 3_600_000) * 3_600_000 + h * 3_600_000);
      await replied(
        new Date(hour(-30).getTime() + min(5)),
        new Date(hour(-30).getTime() + min(15)),
      ); // base: 10 minutes
      await replied(
        new Date(hour(-29).getTime() + min(5)),
        new Date(hour(-29).getTime() + min(35)),
      ); // base: 30 minutes
      await replied(new Date(hour(2).getTime() + min(1)), new Date(hour(2).getTime() + min(21))); // events: 20 minutes
      await q(`SELECT an_msg_feed_rebuild_base($1, $2, $3)`, [o.id, hour(-48), cutover]);
      const w = { orgId: o.id, from: hour(-40), to: hour(10), tz: 'UTC' };
      const avg = await feed.averageFirstReplySeconds(tx, w);
      expect(avg).toBe(Math.round((600 + 1800 + 1200) / 3));
      await fold();
      expect(await feed.averageFirstReplySeconds(tx, w)).toBe(avg);
      expect(await feed.averageFirstReplySeconds(tx, { ...w, from: hour(5) })).toBeNull();
      expect(await feed.averageFirstReplySeconds(tx, w, { hidden: [o.wa] })).toBeNull();
    });
  });

  describe('the History on the rollup equals the History on the scan', () => {
    const repo = new MessageHistoryRepository();

    // a second member in each workspace, who owns nothing: another person's personal mailbox is hidden from them
    const members = new Map<number, number>();
    const viewers = async (o: Org) => {
      let other = members.get(o.id);
      if (other === undefined) {
        other = await scalar(
          `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1, $2, 'V', 'x') RETURNING id`,
          [o.id, `v-${o.id}@t.test`],
        );
        members.set(o.id, other);
      }
      return [
        {
          userId: other,
          scope: 'all' as const,
          teamIds: [],
          readsUnassigned: true,
          readsPersonalMail: false,
        },
        {
          userId: o.user,
          scope: 'all' as const,
          teamIds: [],
          readsUnassigned: true,
          readsPersonalMail: false,
        },
        {
          userId: other,
          scope: 'all' as const,
          teamIds: [],
          readsUnassigned: true,
          readsPersonalMail: true,
        },
      ];
    };

    it('the hidden channels are exactly the channels whose conversations the visibility rule hides', async () => {
      for (const o of orgs) {
        for (const v of await viewers(o)) {
          const joined = visibleToJoinedSql(v, 'c');
          const byRule = (
            await tx.execute(sql`
              SELECT DISTINCT c.channel_id AS id FROM conversations c ${joined.joins}
               WHERE c.org_id = ${o.id} AND NOT (${joined.where})`)
          ).rows.map((r) => Number((r as { id: string }).id));
          const hidden = await hiddenChannelIds(tx, o.id, v);
          expect(hidden.sort(), `${o.tz} ${JSON.stringify(v)}`).toEqual(byRule.sort());
        }
      }
      expect((await hiddenChannelIds(tx, orgs[0]!.id, (await viewers(orgs[0]!))[0]!)).length).toBe(
        1,
      );
    });

    it('summary and charts from the rollup equal the scan for the cards, the volume, the type mix and the top conversations', async () => {
      for (const o of orgs) {
        for (const v of await viewers(o)) {
          const joined = visibleToJoinedSql(v, 'c');
          const hc: HistoryContext = {
            orgId: o.id,
            conversationJoins: joined.joins,
            conversationVisible: joined.where,
            bulk: true,
            contacts: { scope: 'all', userId: v.userId },
            cost: false,
            hiddenChannelIds: await hiddenChannelIds(tx, o.id, v),
          };
          const window = { from: after(-9 * 86_400_000), to: after(6 * 86_400_000) };
          const sel: HistorySelection = { window, scoping: {}, narrow: {} };
          const prev: HistorySelection = {
            ...sel,
            window: { from: after(-24 * 86_400_000), to: window.from },
          };
          const rollup = feedRollup(tx, feed, hc, sel, o.tz);
          const slow = await repo.summary(tx, hc, sel, prev);
          const fast = await repo.summary(tx, hc, sel, prev, rollup);
          // the average first reply is defined differently on the rollup (decision D9) and is compared in its own test
          expect({ ...fast, avgFirstResponseSeconds: null }, `${o.tz} summary`).toEqual({
            ...slow,
            avgFirstResponseSeconds: null,
          });
          for (const [bucket, unit] of [
            ['daily', 'day'],
            ['hourly', 'hour'],
            ['weekly', 'week'],
          ] as const) {
            const seriesFrom =
              bucket === 'hourly' ? new Date(window.to.getTime() - 86_400_000) : window.from;
            const opts = { bucket, tz: o.tz, seriesFrom };
            const a = await repo.insightsLegacy(tx, hc, sel, opts);
            const b = await repo.insights(tx, hc, sel, opts, rollup);
            expect(b, `${o.tz} ${unit} ${JSON.stringify(v)}`).toEqual(a);
            expect(a.topConversations.length).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  describe('the More hub figures on the rollup', () => {
    it('equal a count of the messages the feed counts, at several clocks, in two zones', async () => {
      for (const o of [orgs[0]!, orgs[1]!]) {
        for (const days of [-2, 1, 4, 8]) {
          const now = after(days * 86_400_000);
          const iso = now.toISOString();
          const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
          const got = await figuresFromRollup(tx, feed, o.id, now, monthStart);
          const n = async (cond: string) =>
            Number(
              (
                await q(
                  `SELECT count(*) AS n FROM messages m WHERE m.org_id = $1 AND an_msg_feed_counted(m.kind, m.meta, m.provider_message_id) AND m.created_at < $2 ${cond}`,
                  [o.id, iso],
                )
              )[0].n,
            );
          const out = `AND m.direction = 'out'`;
          const d30 = await n(`${out} AND m.created_at >= $2::timestamptz - interval '30 days'`);
          const del = await n(
            `${out} AND m.status IN ('delivered','read') AND m.created_at >= $2::timestamptz - interval '30 days'`,
          );
          expect(got.outbound7d, `${o.tz} ${days} 7d`).toBe(
            await n(`${out} AND m.created_at >= $2::timestamptz - interval '7 days'`),
          );
          expect(got.messagesThisMonth).toBe(
            await n(
              `${out} AND m.created_at >= date_trunc('month', $2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
            ),
          );
          expect(got.deliveredPct).toBe(d30 === 0 ? null : Math.round((100 * del) / d30));
          expect(got.messageHistory).toBe(await n(''));
          expect(d30).toBeGreaterThan(0);
        }
      }
    });
  });
});
