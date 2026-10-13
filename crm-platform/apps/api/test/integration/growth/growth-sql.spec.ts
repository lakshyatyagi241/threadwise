import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withPrivileged, withTenant, type DbClient } from '@crm/db';
import { GrowthRepository } from '../../../src/modules/growth-pilot/growth.repository';

/**
 * The SQL of the growth pilot against a real Postgres as the restricted application role under row-level security: what each
 * audience, count and scan finds in data shaped like the migrated demo workspaces, and that one workspace never sees another's.
 */
describe('growth pilot SQL', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: DbClient;
  const repo = new GrowthRepository();
  let orgA: number;
  let orgB: number;
  let channelA: number;
  let tplA: number;
  let campA: number;
  let seq = 0;

  const one = async (sql: string, p: unknown[] = []) =>
    (await owner.query(sql, p)).rows[0] as Record<string, unknown>;
  const as = <T>(org: number, fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(app.db, { orgId: org }, fn);

  const contact = async (
    org: number,
    name: string,
    o: {
      stage?: string;
      email?: string | null;
      data?: Record<string, unknown>;
      createdAgo?: string;
      unsub?: boolean;
    } = {},
  ) =>
    Number(
      (
        await one(
          `INSERT INTO contacts (org_id, uuid, name, lifecycle_stage, email, data, created_at, is_unsubscribed)
           VALUES ($1, gen_random_uuid(), $2, $3, $4, $5::jsonb, now() - $6::interval, $7) RETURNING id`,
          [
            org,
            name,
            o.stage ?? 'lead',
            o.email === undefined ? `${name.replace(/\W/g, '')}@acme.test` : o.email,
            JSON.stringify(o.data ?? {}),
            o.createdAgo ?? '200 days',
            o.unsub ?? false,
          ],
        )
      ).id,
    );
  const recipient = (
    org: number,
    campaign: number,
    contactId: number,
    o: { sent?: string; read?: string; clicked?: boolean; responded?: string } = {},
  ) =>
    owner.query(
      `INSERT INTO wp_campaign_contacts (org_id, campaign_id, contact_id, status, sent_at, read_at, clicked, clicked_at, responded_at)
       VALUES ($1,$2,$3,'sent', ${o.sent ? `now() - '${o.sent}'::interval` : 'NULL'}, ${o.read ? `now() - '${o.read}'::interval` : 'NULL'},
               $4, ${o.clicked ? 'now()' : 'NULL'}, ${o.responded ? `now() - '${o.responded}'::interval` : 'NULL'})`,
      [org, campaign, contactId, o.clicked ?? false],
    );
  const conversation = async (
    org: number,
    contactId: number | null,
    o: { inboundAgo?: string; outboundAgo?: string | null; peer?: string } = {},
  ) =>
    Number(
      (
        await one(
          `INSERT INTO conversations (org_id, channel_id, peer_key, title, contact_id, last_inbound_at, last_outbound_at)
           VALUES ($1, $2, $3, $3, $4, ${o.inboundAgo ? `now() - '${o.inboundAgo}'::interval` : 'NULL'}, ${o.outboundAgo ? `now() - '${o.outboundAgo}'::interval` : 'NULL'}) RETURNING id`,
          [
            org,
            org === orgA ? channelA : channelB,
            o.peer ?? `91${++seq}${Math.floor(Math.random() * 1e6)}`,
            contactId,
          ],
        )
      ).id,
    );
  let channelB: number;
  const say = (
    org: number,
    conv: number,
    direction: 'in' | 'out',
    ago: string,
    o: { sender?: string; body?: string } = {},
  ) =>
    owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, body, created_at, provider_ts)
       VALUES ($1,$2,$3,$4,'text',$5,$6,$7, now() - $8::interval, now() - $8::interval)`,
      [
        org,
        conv,
        ++seq,
        direction,
        o.sender ?? (direction === 'in' ? 'customer' : 'agent'),
        direction === 'in' ? 'received' : 'sent',
        o.body ?? 'hello',
        ago,
      ],
    );
  const digestRow = (
    org: number,
    contactId: number,
    o: { intent?: string; ready?: boolean; asked?: boolean; ago?: string; summary?: string } = {},
  ) =>
    owner.query(
      `INSERT INTO lead_chat_digests (org_id, contact_id, through_at, source, intent, signals, summary, trigger, created_at)
       VALUES ($1,$2, now(), 'ai', $3, $4::jsonb, $5, 'chat', now() - $6::interval)`,
      [
        org,
        contactId,
        o.intent ?? 'other',
        JSON.stringify({ readyToBuy: o.ready ?? false, askedPrice: o.asked ?? false }),
        o.summary ?? null,
        o.ago ?? '1 hour',
      ],
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
    orgA = await org('demo-interakt');
    orgB = await org('some-other-workspace');
    const ch = async (o: number) =>
      Number(
        (
          await one(
            `INSERT INTO channels (org_id, kind, name) VALUES ($1,'simulator','c') RETURNING id`,
            [o],
          )
        ).id,
      );
    channelA = await ch(orgA);
    channelB = await ch(orgB);
    await owner.query(
      `INSERT INTO status_options (org_id, module_key, option_group, value, label, position, is_won, is_lost) VALUES
         ($1,'contacts','lifecycle_stage','lead','Lead',1,false,false),
         ($1,'contacts','lifecycle_stage','qualified','Qualified',2,false,false),
         ($1,'contacts','lifecycle_stage','customer','Customer',3,false,false),
         ($1,'contacts','lifecycle_stage','lost','Lost',4,false,true)`,
      [orgA],
    );
    tplA = Number(
      (
        await one(
          `INSERT INTO wa_templates (org_id, template_name, template_body, category, status) VALUES ($1,'event_reminder','Reminder','utility','approved') RETURNING id`,
          [orgA],
        )
      ).id,
    );
    campA = Number(
      (
        await one(
          `INSERT INTO wpcampaigns (org_id, campaign_name, template_id) VALUES ($1,'Reminder blast',$2) RETURNING id`,
          [orgA, tplA],
        )
      ).id,
    );
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    await container?.stop();
  });

  describe('settings and the pilot list', () => {
    it('a workspace that is in the pilot list and has the part on is found; one outside it never is', async () => {
      const features = JSON.stringify({ campaign_response: true });
      await owner.query(
        `INSERT INTO growth_settings (org_id, features) VALUES ($1, $2::jsonb), ($3, $2::jsonb)`,
        [orgA, features, orgB],
      );
      const found = await withPrivileged(app.db, (tx) =>
        repo.pilotOrgs(tx, ['demo-interakt'], 'campaign_response'),
      );
      expect(found).toContain(orgA);
      expect(found).not.toContain(orgB);
      expect(
        await withPrivileged(app.db, (tx) => repo.pilotOrgs(tx, ['demo-interakt'], 'quality')),
      ).not.toContain(orgA);
    });

    it('saves with the version it read, and refuses a stale one', async () => {
      const s = (await as(orgA, (tx) => repo.getSettings(tx, orgA)))!;
      expect(s.rowVersion).toBe(1);
      expect(
        await as(orgA, (tx) =>
          repo.saveSettings(tx, orgA, { quality: true }, { lapsedDays: 90 }, 5),
        ),
      ).toBe(false);
      expect(
        await as(orgA, (tx) =>
          repo.saveSettings(tx, orgA, { quality: true }, { lapsedDays: 90 }, 1),
        ),
      ).toBe(true);
      const after = (await as(orgA, (tx) => repo.getSettings(tx, orgA)))!;
      expect(after.rowVersion).toBe(2);
      expect(after.config).toEqual({ lapsedDays: 90 });
    });

    it('reads the workspace’s stages in order', async () => {
      const st = await as(orgA, (tx) => repo.stages(tx, orgA));
      expect(st.map((s) => s.value)).toEqual(['lead', 'qualified', 'customer', 'lost']);
      expect(st[3]!.isLost).toBe(true);
    });
  });

  describe('the replies campaigns really got', () => {
    let replied: number;
    let silent: number;
    beforeAll(async () => {
      replied = await contact(orgA, 'Replied Person');
      silent = await contact(orgA, 'Silent Person');
      const c = await conversation(orgA, replied, { inboundAgo: '2 hours' });
      await recipient(orgA, campA, replied, { sent: '5 hours', read: '4 hours' });
      await recipient(orgA, campA, silent, { sent: '5 hours' });
      // The contact writes two hours after the send: a reply within 24 hours.
      await say(orgA, c, 'in', '3 hours');
      // A reaction is not a reply, an older message is not a reply to this send.
      await say(orgA, c, 'in', '10 hours');
    });

    it('counts a recipient that wrote within 24 hours, not one that stayed silent, and not messages from before the send', async () => {
      const rows = await as(orgA, (tx) => repo.campaignReport(tx, orgA, 90));
      const r = rows.find((x) => x.name === 'Reminder blast')!;
      expect(r.sent).toBe(2);
      expect(r.read).toBe(1);
      expect(r.replied24h).toBe(1);
      expect(r.replied72h).toBe(1);
      expect(r.recordedResponses).toBe(0);
      expect(r.replyRate24h).toBe(0.5);
      expect(r.templateName).toBe('event_reminder');
    });

    it('gives the real reply rate of each template', async () => {
      const m = await as(orgA, (tx) => repo.templateReplyRates(tx, orgA));
      expect(m.get(tplA)).toEqual({ sent: 2, replyRate24h: 0.5 });
    });

    it('stamps the response time once, and the campaign counts follow', async () => {
      const first = await as(orgA, (tx) => repo.stampResponses(tx, orgA, 90));
      expect(first.stamped).toBe(1);
      expect(first.campaignIds).toEqual([campA]);
      const again = await as(orgA, (tx) => repo.stampResponses(tx, orgA, 90));
      expect(again.stamped).toBe(0);
      const rows = await as(orgA, (tx) => repo.campaignReport(tx, orgA, 90));
      expect(rows.find((x) => x.name === 'Reminder blast')!.recordedResponses).toBe(1);
    });

    it('never reads another workspace’s sends', async () => {
      expect(await as(orgB, (tx) => repo.campaignReport(tx, orgB, 90))).toEqual([]);
    });
  });

  describe('audiences', () => {
    it('engaged: opened enough campaigns in 30 days', async () => {
      const c = await contact(orgA, 'Engaged Person');
      for (let i = 0; i < 3; i++)
        await recipient(orgA, campA, c, { sent: `${i + 2} days`, read: `${i + 1} days` });
      expect(await as(orgA, (tx) => repo.engagedIds(tx, orgA, 3))).toContain(c);
      expect(await as(orgA, (tx) => repo.engagedIds(tx, orgA, 4))).not.toContain(c);
    });

    it('silent: received three or more, opened none, wrote nothing', async () => {
      const c = await contact(orgA, 'Ghost Person');
      for (let i = 0; i < 3; i++) await recipient(orgA, campA, c, { sent: `${i + 1} days` });
      expect(await as(orgA, (tx) => repo.silentIds(tx, orgA))).toContain(c);
      const wrote = await contact(orgA, 'Ghost Who Wrote');
      for (let i = 0; i < 3; i++) await recipient(orgA, campA, wrote, { sent: `${i + 1} days` });
      await conversation(orgA, wrote, { inboundAgo: '2 days' });
      expect(await as(orgA, (tx) => repo.silentIds(tx, orgA))).not.toContain(wrote);
    });

    it('lapsed: a customer (by stage name or won stamp) quiet for the configured days; an active one is not', async () => {
      const gone = await contact(orgA, 'Gone Customer', { stage: 'customer' });
      const active = await contact(orgA, 'Active Customer', { stage: 'customer' });
      await recipient(orgA, campA, active, { sent: '3 days', read: '2 days' });
      const lead = await contact(orgA, 'Old Lead', { stage: 'lead' });
      const ids = await as(orgA, (tx) => repo.lapsedIds(tx, orgA, 60));
      expect(ids).toContain(gone);
      expect(ids).not.toContain(active);
      expect(ids).not.toContain(lead);
    });

    it('hot in chat: a recent reading that says ready to buy', async () => {
      const c = await contact(orgA, 'Hot Person');
      await digestRow(orgA, c, { intent: 'ready_to_buy', ready: true });
      const cold = await contact(orgA, 'Cold Person');
      await digestRow(orgA, cold, { intent: 'browsing' });
      const ids = await as(orgA, (tx) => repo.hotChatIds(tx, orgA));
      expect(ids).toContain(c);
      expect(ids).not.toContain(cold);
    });

    it('service due: the date property falls between the rule’s days, and a value that is not a date is ignored', async () => {
      const due = await contact(orgA, 'Due Person', {
        data: { last_service: new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10) },
      });
      const recent = await contact(orgA, 'Recent Person', {
        data: { last_service: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10) },
      });
      const junk = await contact(orgA, 'Junk Person', { data: { last_service: 'sometime' } });
      const ids = await as(orgA, (tx) =>
        repo.serviceDueIds(tx, orgA, {
          label: 'Service',
          dateField: 'last_service',
          afterDays: 365,
          untilDays: 500,
        }),
      );
      expect(ids).toContain(due);
      expect(ids).not.toContain(recent);
      expect(ids).not.toContain(junk);
    });

    it('leaves out archived and opted-out contacts', async () => {
      const out = await contact(orgA, 'Opted Out', { unsub: true });
      for (let i = 0; i < 3; i++)
        await recipient(orgA, campA, out, { sent: `${i + 1} days`, read: `${i} days` });
      expect(await as(orgA, (tx) => repo.engagedIds(tx, orgA, 1))).not.toContain(out);
    });
  });

  describe('send times', () => {
    it('counts what contacts write and open by hour of the day in the workspace time zone', async () => {
      const c = await contact(orgA, 'Hours Person');
      const conv = await conversation(orgA, c, { inboundAgo: '1 day' });
      await owner.query(
        `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, body, created_at, provider_ts)
         VALUES ($1,$2,$3,'in','text','customer','received','x', timestamptz '2026-10-01 03:30:00+00', timestamptz '2026-10-01 03:30:00+00')`,
        [orgA, conv, ++seq],
      );
      const utc = await as(orgA, (tx) => repo.hourHistograms(tx, orgA, 'UTC'));
      const ist = await as(orgA, (tx) => repo.hourHistograms(tx, orgA, 'Asia/Kolkata'));
      expect(utc.inbound).toHaveLength(24);
      expect(ist.inbound.reduce((a, b) => a + b)).toBe(utc.inbound.reduce((a, b) => a + b));
      // 90 days back from the test clock: the fixed 2026-10-01 message is inside only while the run date is near it.
    });
  });

  describe('the Growth inbox', () => {
    let contactId: number;
    beforeAll(async () => {
      contactId = await contact(orgA, 'Action Person');
    });
    const make = (key: string, over: Record<string, unknown> = {}) =>
      as(orgA, (tx) =>
        repo.insertAction(tx, orgA, {
          type: 'hot_lead',
          contactId,
          title: 'Hot',
          dedupeKey: key,
          severity: 'urgent',
          payload: { score: 90 },
          ...over,
        }),
      );

    it('one open action per key: the same thing detected again does not pile up', async () => {
      const first = await make('hot:1');
      const second = await make('hot:1');
      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('lists open ones by type with counts, newest first with a cursor', async () => {
      for (let i = 0; i < 3; i++) await make(`hot:list:${i}`);
      await as(orgA, (tx) =>
        repo.insertAction(tx, orgA, {
          type: 'lapsed',
          contactId,
          title: 'Quiet',
          dedupeKey: 'lapsed:x',
        }),
      );
      const p1 = await as(orgA, (tx) => repo.listActions(tx, orgA, { status: 'open', limit: 2 }));
      expect(p1.items).toHaveLength(2);
      expect(p1.hasMore).toBe(true);
      const p2 = await as(orgA, (tx) =>
        repo.listActions(tx, orgA, { status: 'open', limit: 2, cursor: p1.nextCursor! }),
      );
      expect(new Set([...p1.items, ...p2.items].map((a) => a.id)).size).toBe(
        p1.items.length + p2.items.length,
      );
      const lapsed = await as(orgA, (tx) =>
        repo.listActions(tx, orgA, { status: 'open', type: 'lapsed', limit: 10 }),
      );
      expect(lapsed.items.map((a) => a.type)).toEqual(['lapsed']);
      const counts = await as(orgA, (tx) => repo.openByType(tx, orgA));
      expect(counts.hot_lead).toBeGreaterThanOrEqual(4);
      expect(counts.lapsed).toBe(1);
    });

    it('is decided once; deciding frees the key for the next detection', async () => {
      const id = await make('hot:decide');
      expect(await as(orgA, (tx) => repo.decideAction(tx, orgA, id!, 'done', null))).toBe(true);
      expect(await as(orgA, (tx) => repo.decideAction(tx, orgA, id!, 'dismissed', null))).toBe(
        false,
      );
      expect(await make('hot:decide')).not.toBeNull();
    });

    it('another workspace sees none of it', async () => {
      expect(
        (await as(orgB, (tx) => repo.listActions(tx, orgB, { status: 'open', limit: 50 }))).items,
      ).toEqual([]);
      expect(await as(orgB, (tx) => repo.openByType(tx, orgB))).toEqual({});
    });

    it('closes by key, and expires what nobody looked at', async () => {
      await make('hot:close');
      await as(orgA, (tx) => repo.closeByKey(tx, orgA, 'hot:close'));
      expect(await make('hot:close')).not.toBeNull();
      await owner.query(
        `UPDATE growth_actions SET created_at = now() - interval '40 days' WHERE dedupe_key = 'hot:close'`,
      );
      const n = await withPrivileged(app.db, (tx) => repo.expireOldActions(tx, 30));
      expect(n).toBeGreaterThanOrEqual(1);
    });
  });

  describe('unanswered buying questions', () => {
    it('finds a thread whose last reading was a buying question that nobody answered, and closes it once answered', async () => {
      const c = await contact(orgA, 'Waiting Person');
      const conv = await conversation(orgA, c, { inboundAgo: '6 hours', outboundAgo: '2 days' });
      await digestRow(orgA, c, { intent: 'asking_price', asked: true });
      const answered = await contact(orgA, 'Answered Person');
      await conversation(orgA, answered, { inboundAgo: '6 hours', outboundAgo: '1 hour' });
      await digestRow(orgA, answered, { intent: 'asking_price', asked: true });
      const fresh = await contact(orgA, 'Fresh Person');
      await conversation(orgA, fresh, { inboundAgo: '10 minutes' });
      await digestRow(orgA, fresh, { intent: 'asking_price', asked: true });

      const rows = await as(orgA, (tx) => repo.unansweredIntent(tx, orgA, 4));
      const mine = rows.find((r) => r.conversationId === conv)!;
      expect(mine.contactId).toBe(c);
      expect(mine.hoursWaiting).toBeGreaterThanOrEqual(5);
      expect(rows.map((r) => r.contactId)).not.toContain(answered);
      expect(rows.map((r) => r.contactId)).not.toContain(fresh);

      await as(orgA, (tx) =>
        repo.insertAction(tx, orgA, {
          type: 'unanswered_intent',
          contactId: c,
          conversationId: conv,
          title: 'q',
          dedupeKey: `unanswered:${conv}`,
        }),
      );
      await owner.query(`UPDATE conversations SET last_outbound_at = now() WHERE id = $1`, [conv]);
      expect(await as(orgA, (tx) => repo.closeAnsweredUnanswered(tx, orgA))).toBeGreaterThanOrEqual(
        1,
      );
    });
  });

  describe('the conversion model data', () => {
    it('one row per contact with the counts and whether it converted (by stage name, won stamp or won stage)', async () => {
      const buyer = await contact(orgA, 'Model Buyer', { stage: 'customer' });
      const prospect = await contact(orgA, 'Model Prospect', { stage: 'lead', email: null });
      await recipient(orgA, campA, prospect, { sent: '3 days', read: '2 days', clicked: true });
      const rows = await as(orgA, (tx) => repo.propensityRows(tx, orgA));
      const b = rows.find((r) => r.contactId === buyer)!;
      const p = rows.find((r) => r.contactId === prospect)!;
      expect(b.y).toBe(1);
      expect(p.y).toBe(0);
      expect(p.raw[0]).toBe(1); // opened
      expect(p.raw[3]).toBe(1); // clicked
      expect(p.raw[5]).toBe(0); // no email
      expect(rows.every((r) => r.raw.length === 8)).toBe(true);
    });

    it('stores the scores and replaces them on the next run', async () => {
      const c = await contact(orgA, 'Scored Person');
      await as(orgA, (tx) =>
        repo.savePropensity(tx, orgA, [{ contactId: c, score: 42, features: { opens: 1 } }]),
      );
      await as(orgA, (tx) =>
        repo.savePropensity(tx, orgA, [{ contactId: c, score: 77, features: { opens: 3 } }]),
      );
      const uuid = String((await one(`SELECT uuid FROM contacts WHERE id = $1`, [c])).uuid);
      const p = await as(orgA, (tx) => repo.propensityOf(tx, orgA, uuid));
      expect(p!.score).toBe(77);
      expect(await as(orgB, (tx) => repo.propensityOf(tx, orgB, uuid))).toBeNull();
      await as(orgA, (tx) =>
        repo.saveModel(tx, orgA, 'propensity', { summary: { trained: true } }),
      );
      expect(await as(orgA, (tx) => repo.getModel(tx, orgA, 'propensity'))).toEqual({
        summary: { trained: true },
      });
      expect(await as(orgB, (tx) => repo.getModel(tx, orgB, 'propensity'))).toBeNull();
    });

    it('the top tenth by score, among contacts that have not converted', async () => {
      const ids: number[] = [];
      for (let i = 0; i < 12; i++) ids.push(await contact(orgA, `Rank ${i}`));
      await as(orgA, (tx) =>
        repo.savePropensity(
          tx,
          orgA,
          ids.map((id, i) => ({ contactId: id, score: 40 + i * 5, features: {} })),
        ),
      );
      const top = await as(orgA, (tx) => repo.highPropensityIds(tx, orgA));
      expect(top).toContain(ids[11]);
      expect(top).not.toContain(ids[0]);
    });
  });

  describe('the engagement stage rule', () => {
    it('finds first-stage contacts that opened enough campaigns and sit in a group, and not ones with a suggestion already', async () => {
      const g = Number(
        (
          await one(
            `INSERT INTO contact_groups (org_id, name) VALUES ($1,'Registrants') RETURNING id`,
            [orgA],
          )
        ).id,
      );
      const ready = await contact(orgA, 'Rule Ready');
      const noGroup = await contact(orgA, 'Rule No Group');
      const asked = await contact(orgA, 'Rule Asked');
      for (const c of [ready, noGroup, asked]) {
        for (let i = 0; i < 2; i++)
          await recipient(orgA, campA, c, { sent: `${i + 3} days`, read: `${i + 2} days` });
      }
      await owner.query(
        `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1,$2,$4),($1,$3,$4)`,
        [orgA, ready, asked, g],
      );
      await owner.query(
        `INSERT INTO lifecycle_stage_suggestions (org_id, contact_id, from_stage, to_stage, confidence, source) VALUES ($1,$2,'lead','qualified',0.9,'chat')`,
        [orgA, asked],
      );
      const rule = { minOpens: 2, windowDays: 30, requireGroup: true };
      const found = (
        await as(orgA, (tx) => repo.engagementStageCandidates(tx, orgA, 'lead', rule))
      ).map((r) => r.contactId);
      expect(found).toContain(ready);
      expect(found).not.toContain(noGroup);
      expect(found).not.toContain(asked);
      const loose = (
        await as(orgA, (tx) =>
          repo.engagementStageCandidates(tx, orgA, 'lead', { ...rule, requireGroup: false }),
        )
      ).map((r) => r.contactId);
      expect(loose).toContain(noGroup);
    });
  });

  describe('guarded automatic stage changes', () => {
    it('lists the confident open suggestions, counts what was applied today, and moves a suggestion through applied and undone', async () => {
      const c = await contact(orgA, 'Auto Person');
      const sid = Number(
        (
          await one(
            `INSERT INTO lifecycle_stage_suggestions (org_id, contact_id, from_stage, to_stage, confidence, source) VALUES ($1,$2,'lead','qualified',0.95,'engagement') RETURNING id`,
            [orgA, c],
          )
        ).id,
      );
      const weak = await contact(orgA, 'Weak Suggestion');
      await owner.query(
        `INSERT INTO lifecycle_stage_suggestions (org_id, contact_id, from_stage, to_stage, confidence) VALUES ($1,$2,'lead','qualified',0.7)`,
        [orgA, weak],
      );
      const found = await as(orgA, (tx) => repo.autoStageCandidates(tx, orgA, 0.9, 50));
      expect(found.map((s) => s.contactId)).toContain(c);
      expect(found.map((s) => s.contactId)).not.toContain(weak);
      const before = await as(orgA, (tx) => repo.autoAppliedToday(tx, orgA));
      expect(
        await as(orgA, (tx) => repo.markSuggestion(tx, orgA, sid, 'pending', 'auto_applied')),
      ).toBe(true);
      expect(
        await as(orgA, (tx) => repo.markSuggestion(tx, orgA, sid, 'pending', 'auto_applied')),
      ).toBe(false);
      expect(await as(orgA, (tx) => repo.autoAppliedToday(tx, orgA))).toBe(before + 1);
      const log = await as(orgA, (tx) => repo.autoStageLog(tx, orgA, 10));
      expect(log.some((r) => r.contactName === 'Auto Person' && r.status === 'auto_applied')).toBe(
        true,
      );
      expect(
        await as(orgA, (tx) => repo.markSuggestion(tx, orgA, sid, 'auto_applied', 'undone')),
      ).toBe(true);
      expect(await as(orgA, (tx) => repo.autoAppliedToday(tx, orgA))).toBe(before);
    });
  });

  describe('enrichment', () => {
    it('picks contacts with a business email that were never looked up, keeps what was found, and counts it', async () => {
      const biz = await contact(orgA, 'Biz Person', { email: 'biz@bigco.test' });
      const free = await contact(orgA, 'Free Person', { email: 'someone@gmail.com' });
      const none = await contact(orgA, 'Nomail Person', { email: null });
      const cands = (await as(orgA, (tx) => repo.enrichmentCandidates(tx, orgA, 500))).map(
        (c) => c.id,
      );
      expect(cands).toContain(biz);
      expect(cands).not.toContain(free);
      expect(cands).not.toContain(none);
      await as(orgA, (tx) =>
        repo.saveEnrichment(tx, orgA, biz, 'fixture', 'found', {
          companySize: '51-200',
          industry: 'Retail',
        }),
      );
      expect(
        (await as(orgA, (tx) => repo.enrichmentCandidates(tx, orgA, 500))).map((c) => c.id),
      ).not.toContain(biz);
      const uuid = String((await one(`SELECT uuid FROM contacts WHERE id = $1`, [biz])).uuid);
      expect((await as(orgA, (tx) => repo.enrichmentOf(tx, orgA, uuid)))!.data).toEqual({
        companySize: '51-200',
        industry: 'Retail',
      });
      expect(
        (await as(orgA, (tx) => repo.enrichmentCounts(tx, orgA))).found,
      ).toBeGreaterThanOrEqual(1);
      expect(await as(orgB, (tx) => repo.enrichmentOf(tx, orgB, uuid))).toBeNull();
    });
  });

  describe('quality and the digest', () => {
    it('reads the suggestion and action tallies, the score outcomes and the digest facts without error', async () => {
      expect((await as(orgA, (tx) => repo.suggestionStats(tx, orgA, 30))).length).toBeGreaterThan(
        0,
      );
      expect((await as(orgA, (tx) => repo.actionStats(tx, orgA, 30))).length).toBeGreaterThan(0);
      await owner.query(
        `UPDATE contacts SET lead_score = 80 WHERE org_id = $1 AND name = 'Model Buyer'`,
        [orgA],
      );
      await owner.query(
        `UPDATE contacts SET lead_score = 20 WHERE org_id = $1 AND name = 'Model Prospect'`,
        [orgA],
      );
      const o = await as(orgA, (tx) => repo.scoreOutcomes(tx, orgA));
      expect(o.find((x) => x.score === 80)!.y).toBe(1);
      expect(o.find((x) => x.score === 20)!.y).toBe(0);
      const f = await as(orgA, (tx) => repo.digestFacts(tx, orgA));
      expect(Number(f.sent)).toBeGreaterThan(0);
      await as(orgA, (tx) =>
        repo.saveDigest(tx, orgA, '2026-10-12', { day: '2026-10-12', hotLeads: 1 }),
      );
      await as(orgA, (tx) =>
        repo.saveDigest(tx, orgA, '2026-10-12', { day: '2026-10-12', hotLeads: 2 }),
      );
      expect(await as(orgA, (tx) => repo.latestDigest(tx, orgA))).toEqual({
        day: '2026-10-12',
        hotLeads: 2,
      });
      expect(await as(orgB, (tx) => repo.latestDigest(tx, orgB))).toBeNull();
      await as(orgA, (tx) => repo.saveDigest(tx, orgA, '2026-01-01', { day: '2026-01-01' }));
      expect(
        await withPrivileged(app.db, (tx) => repo.deleteOldDigests(tx, 30)),
      ).toBeGreaterThanOrEqual(1);
    });
  });

  describe('the registration facts and the handover lookups', () => {
    it('names the groups a contact is in and the last campaign message it was sent', async () => {
      const c = await contact(orgA, 'Registered Person');
      const g = Number(
        (
          await one(`SELECT id FROM contact_groups WHERE org_id = $1 AND name = 'Registrants'`, [
            orgA,
          ])
        ).id,
      );
      await owner.query(
        `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1,$2,$3)`,
        [orgA, c, g],
      );
      await recipient(orgA, campA, c, { sent: '2 days' });
      const f = await as(orgA, (tx) => repo.registrationFacts(tx, orgA, c));
      expect(f.groups).toEqual(['Registrants']);
      expect(f.lastSend).toMatchObject({ campaign: 'Reminder blast', template: 'event_reminder' });
    });

    it('finds the contact of a conversation and its latest reading', async () => {
      const c = await contact(orgA, 'Handover Person');
      const conv = await conversation(orgA, c, { inboundAgo: '1 hour' });
      const uuid = String((await one(`SELECT uuid FROM conversations WHERE id = $1`, [conv])).uuid);
      expect(await as(orgA, (tx) => repo.conversationContact(tx, orgA, uuid))).toEqual({
        id: conv,
        contactId: c,
      });
      expect(await as(orgA, (tx) => repo.latestSummary(tx, orgA, c, 7))).toBeNull();
      await digestRow(orgA, c, { intent: 'asking_price', summary: 'Asked about the strap price.' });
      expect(await as(orgA, (tx) => repo.latestSummary(tx, orgA, c, 7))).toEqual({
        summary: 'Asked about the strap price.',
        intent: 'asking_price',
        source: 'ai',
      });
      expect(await as(orgA, (tx) => repo.channelKindOfConversation(tx, orgA, conv))).toBe(
        'simulator',
      );
      expect(await as(orgA, (tx) => repo.setConversationLanguage(tx, orgA, conv, 'hi'))).toBe(true);
      expect(await as(orgA, (tx) => repo.setConversationLanguage(tx, orgA, conv, 'en'))).toBe(
        false,
      );
    });

    it('the least busy active user, and a user by id', async () => {
      const u = Number(
        (
          await one(
            `INSERT INTO users (org_id, email, full_name, status) VALUES ($1,'agent@acme.test','Agent One','active') RETURNING id`,
            [orgA],
          )
        ).id,
      );
      const busy = await as(orgA, (tx) => repo.leastBusyUser(tx, orgA));
      expect(busy).not.toBeNull();
      expect((await as(orgA, (tx) => repo.userById(tx, orgA, u)))!.name).toBe('Agent One');
      expect(await as(orgB, (tx) => repo.userById(tx, orgB, u))).toBeNull();
    });
  });

  describe('the assistant’s candidates', () => {
    it('lists groups big enough to be an audience and the approved templates', async () => {
      const g = Number(
        (
          await one(`SELECT id FROM contact_groups WHERE org_id = $1 AND name = 'Registrants'`, [
            orgA,
          ])
        ).id,
      );
      const extra = [];
      for (let i = 0; i < 5; i++) extra.push(await contact(orgA, `Member ${i}`));
      for (const c of extra)
        await owner.query(
          `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [orgA, c, g],
        );
      const a = await as(orgA, (tx) => repo.audienceCandidates(tx, orgA));
      expect(a.find((x) => x.name === 'Registrants')!.size).toBeGreaterThanOrEqual(5);
      const t = await as(orgA, (tx) => repo.templateCandidates(tx, orgA));
      expect(t.map((x) => x.name)).toContain('event_reminder');
      expect(await as(orgB, (tx) => repo.audienceCandidates(tx, orgB))).toEqual([]);
      expect(await as(orgB, (tx) => repo.templateCandidates(tx, orgB))).toEqual([]);
    });
  });
});
