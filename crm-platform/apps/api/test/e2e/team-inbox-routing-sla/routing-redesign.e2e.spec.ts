import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tenant } from '../contacts-attributes-tags/support';
import {
  conversationOf,
  simChannel,
  simInbound,
  startPipeline,
  until,
  type Pipeline,
  type SimChannel,
} from '../chat-conversations/pipeline-support';

/**
 * The auto-assignment redesign (spec decisions H13 to H20): a rule that applies to every conversation, conditions kept but ignored when
 * that is on, the new/returning contact condition, "Everyone else: distribute evenly", NO silent change for a workspace that never set a
 * fallback, the contact kind and saved details at handoff time, and "Try it" (the dry run) writing nothing. Real Postgres (restricted role)
 * and Redis, the real ingest worker and the routing listener.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let p: Pipeline;
beforeAll(async () => {
  p = await startPipeline(async () => [
    (
      await import('../../../src/modules/team-inbox-routing-sla/team-inbox-routing-sla-worker.module')
    ).TeamInboxRoutingSlaWorkerModule,
  ]);
}, 600_000);
afterAll(async () => {
  await p?.stop();
});

const AGENT: Array<[string, 'all']> = [
  ['inbox.conversation.read', 'all'],
  ['inbox.conversation.reply', 'all'],
  ['inbox.conversation.assign_self', 'all'],
];

let phoneSeq = 0;
const phone = () => `9188${String(10_000_000 + phoneSeq++)}`;
const uuidOf = async (userId: number) =>
  (await p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;

interface Rule {
  id: string;
  rowVersion: number;
  [k: string]: unknown;
}
const rulesApi = (token: string) => ({
  list: () => p.api.as(token).get('/v2/inbox/routing/rules'),
  create: (body: Record<string, unknown>) =>
    p.api.as(token).post('/v2/inbox/routing/rules').set('idempotency-key', randomUUID()).send(body),
  update: (id: string, body: Record<string, unknown>) =>
    p.api.as(token).patch(`/v2/inbox/routing/rules/${id}`).send(body),
  test: (body: Record<string, unknown>) =>
    p.api.as(token).post('/v2/inbox/routing/test').send(body),
});
const live = async (t: Tenant, r: Rule) =>
  (await rulesApi(t.admin).update(r.id, { rowVersion: r.rowVersion, isActive: true })).body as Rule;
const reread = async (t: Tenant, id: string) =>
  (await p.api.as(t.admin).get(`/v2/inbox/routing/rules/${id}`)).body as Rule;
const ruleRow = async (id: string) =>
  (await p.h.owner.query(`SELECT * FROM routing_rules WHERE uuid = $1`, [id])).rows[0] as Record<
    string,
    unknown
  >;

async function customer(t: Tenant, ch: SimChannel, text: string, from = phone()) {
  await simInbound(p, t, ch, { from, text });
  const conv = await until(`routed ${from}`, async () => {
    const c = await conversationOf(p, t, ch, from);
    const meta = c.routing_meta as { routedMessage?: string } | null;
    return meta?.routedMessage ? c : null;
  });
  return {
    from,
    conv,
    contactId: Number(conv.contact_id),
    assignee: conv.assignee_user_id === null ? null : Number(conv.assignee_user_id),
  };
}

describe('a rule that applies to every conversation (H13)', () => {
  let t: Tenant;
  let ch: SimChannel;
  let a1: { token: string; userId: number };
  let u1: string;

  beforeAll(async () => {
    t = await p.api.signup('rdn1');
    ch = await simChannel(p, t);
    a1 = await p.api.member(t, 'rdn1a', AGENT);
    u1 = await uuidOf(a1.userId);
  });

  it('is valid with no condition, matches every chat, and keeps its stored conditions when the switch is turned off', async () => {
    const created = await rulesApi(t.admin).create({
      name: 'Everyone',
      appliesToAll: true,
      // kept, but ignored while the switch is on
      conditions: { keywords: { mode: 'any', words: ['zzz-never-said'] } },
      assign: { strategy: 'specific', userIds: [u1] },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.appliesToAll).toBe(true);
    const rule = await live(t, created.body as Rule);

    expect((await customer(t, ch, 'hello there')).assignee).toBe(a1.userId);
    expect(Number((await ruleRow(rule.id)).fired_count)).toBe(1);

    // switch off: the stored keyword condition applies again, so a plain hello no longer matches
    const off = await rulesApi(t.admin).update(rule.id, {
      rowVersion: (await reread(t, rule.id)).rowVersion,
      appliesToAll: false,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.conditions.keywords.words).toEqual(['zzz-never-said']);
    expect((await customer(t, ch, 'hello again')).assignee).toBeNull();
    expect((await customer(t, ch, 'zzz-never-said')).assignee).toBe(a1.userId);

    // and with no condition left and the switch off, the API still refuses it
    const bare = await rulesApi(t.admin).update(rule.id, {
      rowVersion: (await reread(t, rule.id)).rowVersion,
      conditions: {},
    });
    expect(bare.status).toBe(422);
  });

  it('a hand-edited rule with no condition that never matched still does not match (no inference from empty conditions)', async () => {
    await p.h.owner.query(
      `INSERT INTO routing_rules (org_id, name, conditions, actions, stop_on_match, is_active, is_fallback, sort)
       VALUES ($1, 'Hand edited', '{}'::jsonb, $2::jsonb, true, true, false, 99)`,
      [
        t.orgId,
        JSON.stringify([{ type: 'assign', strategy: 'specific', userIds: [u1], teamIds: [] }]),
      ],
    );
    const row = (
      await p.h.owner.query(`SELECT applies_to_all FROM routing_rules WHERE name = 'Hand edited'`)
    ).rows[0];
    expect(row.applies_to_all).toBe(false);
    expect((await customer(t, ch, 'plain hello')).assignee).toBeNull();
  });
});

describe('new and returning contacts, saved details (H16, H17)', () => {
  let t: Tenant;
  let ch: SimChannel;
  let a1: { token: string; userId: number };
  let a2: { token: string; userId: number };
  let u1: string;
  let u2: string;

  beforeAll(async () => {
    t = await p.api.signup('rdn2');
    ch = await simChannel(p, t);
    a1 = await p.api.member(t, 'rdn2a', AGENT);
    a2 = await p.api.member(t, 'rdn2b', AGENT);
    [u1, u2] = await Promise.all([uuidOf(a1.userId), uuidOf(a2.userId)]);
    const api = rulesApi(t.admin);
    await live(
      t,
      (
        await api.create({
          name: 'First timers',
          conditions: { contactKind: 'new' },
          assign: { strategy: 'specific', userIds: [u1] },
        })
      ).body,
    );
    await live(
      t,
      (
        await api.create({
          name: 'Customers',
          conditions: {
            contact: {
              type: 'group',
              combinator: 'and',
              children: [
                {
                  type: 'condition',
                  field: 'lifecycleStage',
                  operator: 'equals',
                  value: 'customer',
                },
              ],
            },
          },
          assign: { strategy: 'specific', userIds: [u2] },
        })
      ).body,
    );
  });

  it('a brand-new contact is new; its stage is "new", so a rule on stage "customer" does not match it', async () => {
    const got = await customer(t, ch, 'hi');
    expect(got.assignee).toBe(a1.userId);
    const contact = (
      await p.h.owner.query(`SELECT lifecycle_stage, owner_id FROM contacts WHERE id = $1`, [
        got.contactId,
      ])
    ).rows[0];
    expect(contact.lifecycle_stage).toBe('new');
    expect(contact.owner_id).toBeNull();
  });

  it('Try it explains it: new/returning, and that saved details only match what is already saved', async () => {
    const first = await customer(t, ch, 'hi again');
    const contactUuid = (
      await p.h.owner.query(`SELECT uuid FROM contacts WHERE id = $1`, [first.contactId])
    ).rows[0].uuid as string;
    // saved long before this chat, and already a customer: returning, stage matches
    await p.h.owner.query(
      `UPDATE contacts SET created_at = now() - interval '2 hours', lifecycle_stage = 'customer' WHERE id = $1`,
      [first.contactId],
    );
    const res = await rulesApi(t.admin).test({ contactId: contactUuid, channelKind: 'simulator' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.contact).toMatchObject({ found: true, kind: 'returning', stage: 'customer' });
    expect(res.body.outcome).toBe('rule');
    expect(res.body.ruleName).toBe('Customers');
    const timers = res.body.steps.find((s: { ruleName: string }) => s.ruleName === 'First timers');
    expect(timers).toMatchObject({ result: 'passed', why: 'conditions_failed' });
    expect(timers.conditions).toEqual([
      { part: 'contactKind', matched: false, why: 'not_same_kind' },
    ]);
    // a contact whose stage is not "customer": the details condition says it did not match what is saved
    await p.h.owner.query(`UPDATE contacts SET lifecycle_stage = 'lead' WHERE id = $1`, [
      first.contactId,
    ]);
    const lead = await rulesApi(t.admin).test({ contactId: contactUuid, channelKind: 'simulator' });
    const cust = lead.body.steps.find((s: { ruleName: string }) => s.ruleName === 'Customers');
    expect(cust.conditions).toEqual([{ part: 'contact', matched: false, why: 'no_saved_value' }]);
    expect(lead.body.outcome).toBe('queue');
  });
});

describe('Everyone else: distribute evenly, and no silent change (H15, H19)', () => {
  let t: Tenant;
  let ch: SimChannel;
  const agents: Array<{ token: string; userId: number }> = [];

  beforeAll(async () => {
    t = await p.api.signup('rdn3');
    ch = await simChannel(p, t);
    for (const n of ['rdn3a', 'rdn3b', 'rdn3c']) agents.push(await p.api.member(t, n, AGENT));
  });

  it('a workspace that never set a fallback keeps leaving conversations unassigned, and nothing creates a rule behind its back', async () => {
    expect((await customer(t, ch, 'hello')).assignee).toBeNull();
    expect((await customer(t, ch, 'hello 2')).assignee).toBeNull();
    const n = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM routing_rules WHERE org_id = $1`,
      [t.orgId],
    );
    expect(n.rows[0].n).toBe(0);
    const probe = await rulesApi(t.admin).test({ channelKind: 'simulator', messageText: 'hello' });
    expect(probe.body.outcome).toBe('queue');
    expect(probe.body.steps.at(-1)).toMatchObject({ kind: 'everyone_else', why: 'not_set' });
  });

  it('with the row on, it rotates over everyone available and skips an agent who is offline', async () => {
    const made = await rulesApi(t.admin).create({
      name: 'Everyone else',
      isFallback: true,
      assign: { strategy: 'round_robin', everyone: true },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.assign).toMatchObject({ everyone: true, userIds: [], teamIds: [] });
    await live(t, made.body as Rule);
    await p.h.owner.query(
      `INSERT INTO agent_statuses (org_id, user_id, status) VALUES ($1, $2, 'offline')
       ON CONFLICT (org_id, user_id) DO UPDATE SET status = 'offline'`,
      [t.orgId, agents[0]!.userId],
    );
    const got: number[] = [];
    for (let i = 0; i < 6; i += 1) got.push((await customer(t, ch, `hello ${i}`)).assignee!);
    expect(got.every((x) => x !== null)).toBe(true);
    expect(got).not.toContain(agents[0]!.userId);
    // more than one person took a turn
    expect(new Set(got).size).toBeGreaterThan(1);
  });

  it('a "refuses everyone plus a list" body is a 422', async () => {
    const bad = await rulesApi(t.admin).create({
      name: 'Bad',
      appliesToAll: true,
      assign: {
        strategy: 'round_robin',
        everyone: true,
        userIds: [await uuidOf(agents[0]!.userId)],
      },
    });
    expect(bad.status).toBe(422);
  });
});

describe('Try it writes nothing (H20)', () => {
  let t: Tenant;
  let ch: SimChannel;
  let a1: { token: string; userId: number };
  let a2: { token: string; userId: number };
  let u1: string;
  let u2: string;
  let contactUuid: string;
  let contactId: number;

  /** Everything a real run would touch for this workspace, as plain numbers and text to compare before and after. */
  const snapshot = async () => {
    const q = async (sql: string) => (await p.h.owner.query(sql, [t.orgId])).rows;
    return {
      rules: await q(
        `SELECT uuid, fired_count, last_fired_at, actions::text AS actions, row_version FROM routing_rules WHERE org_id = $1 ORDER BY id`,
      ),
      conversations: await q(
        `SELECT id, assignee_user_id, assignee_team_id, routing_meta::text AS meta, row_version FROM conversations WHERE org_id = $1 ORDER BY id`,
      ),
      events: await q(`SELECT count(*)::int AS n FROM conversation_events WHERE org_id = $1`),
      outbox: await q(`SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1`),
      audit: await q(`SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1`),
      contacts: await q(
        `SELECT id, owner_id, updated_at FROM contacts WHERE org_id = $1 ORDER BY id`,
      ),
    };
  };

  beforeAll(async () => {
    t = await p.api.signup('rdn4');
    ch = await simChannel(p, t);
    a1 = await p.api.member(t, 'rdn4a', AGENT);
    a2 = await p.api.member(t, 'rdn4b', AGENT);
    [u1, u2] = await Promise.all([uuidOf(a1.userId), uuidOf(a2.userId)]);
    const api = rulesApi(t.admin);
    await live(
      t,
      (
        await api.create({
          name: 'Refunds',
          conditions: { keywords: { mode: 'any', words: ['refund'] } },
          assign: { strategy: 'round_robin', userIds: [u1, u2] },
        })
      ).body,
    );
    await live(
      t,
      (
        await api.create({
          name: 'Everyone else',
          isFallback: true,
          assign: { strategy: 'round_robin', everyone: true },
        })
      ).body,
    );
    const first = await customer(t, ch, 'refund please');
    contactId = first.contactId;
    contactUuid = (await p.h.owner.query(`SELECT uuid FROM contacts WHERE id = $1`, [contactId]))
      .rows[0].uuid as string;
  });

  it('answers the right step for each outcome and leaves every table as it was', async () => {
    const before = await snapshot();
    const api = rulesApi(t.admin);

    const byRule = await api.test({ channelKind: 'simulator', messageText: 'I want a refund' });
    expect(byRule.status, JSON.stringify(byRule.body)).toBe(200);
    expect(byRule.body).toMatchObject({ outcome: 'rule', ruleName: 'Refunds' });
    expect([u1, u2]).toContain(byRule.body.assigneeUserId);
    expect(byRule.body.steps.map((s: { kind: string }) => s.kind)).toEqual(['sticky', 'rule']);

    const rest = await api.test({ channelKind: 'simulator', messageText: 'just hello' });
    expect(rest.body.outcome).toBe('everyone_else');
    expect(rest.body.assigneeUserId).not.toBeNull();
    const ruleStep = rest.body.steps.find((s: { kind: string }) => s.kind === 'rule');
    expect(ruleStep).toMatchObject({ result: 'passed', why: 'conditions_failed' });
    expect(ruleStep.conditions).toEqual([{ part: 'keywords', matched: false, why: 'no_word' }]);

    // the contact's agent, when the workspace keeps returning contacts with their agent
    await p.h.owner.query(
      `INSERT INTO workspace_settings (org_id, routing_keep_contact_agent) VALUES ($1, true)
       ON CONFLICT (org_id) DO UPDATE SET routing_keep_contact_agent = true`,
      [t.orgId],
    );
    await p.h.owner.query(`UPDATE contacts SET owner_id = $2 WHERE id = $1`, [
      contactId,
      a2.userId,
    ]);
    const afterSetup = await snapshot();
    const sticky = await api.test({
      contactId: contactUuid,
      channelKind: 'simulator',
      messageText: 'refund',
    });
    expect(sticky.body).toMatchObject({
      outcome: 'sticky',
      assigneeUserId: u2,
      how: 'contact_agent',
    });
    expect(sticky.body.steps[0]).toMatchObject({ kind: 'sticky', result: 'decided', why: 'owner' });
    // what the setup itself changed is not the dry run's doing: compare from here on
    expect(await snapshot()).toEqual(afterSetup);

    // everybody but the admin is offline: Refunds finds nobody and falls through to "Everyone else", which picks the admin
    for (const id of [a1.userId, a2.userId, t.adminUserId])
      await p.h.owner.query(
        `INSERT INTO agent_statuses (org_id, user_id, status) VALUES ($1, $2, $3)
         ON CONFLICT (org_id, user_id) DO UPDATE SET status = $3`,
        [t.orgId, id, id === t.adminUserId ? 'online' : 'offline'],
      );
    await p.h.owner.query(`UPDATE contacts SET owner_id = NULL WHERE id = $1`, [contactId]);
    await p.h.owner.query(
      `UPDATE workspace_settings SET routing_keep_contact_agent = false WHERE org_id = $1`,
      [t.orgId],
    );
    const afterOffline = await snapshot();
    const fell = await api.test({ channelKind: 'simulator', messageText: 'refund' });
    expect(fell.body.outcome).toBe('everyone_else');
    const refundsStep = fell.body.steps.find((s: { ruleName: string }) => s.ruleName === 'Refunds');
    expect(refundsStep).toMatchObject({ result: 'passed', why: 'nobody_available' });
    expect(fell.body.trace.map((l: { why?: string }) => l.why)).toContain(
      'offline_busy_or_at_capacity',
    );
    // nobody at all: the waiting queue
    await p.h.owner.query(
      `UPDATE agent_statuses SET status = 'offline' WHERE org_id = $1 AND user_id = $2`,
      [t.orgId, t.adminUserId],
    );
    const queue = await api.test({ channelKind: 'simulator', messageText: 'refund' });
    expect(queue.body).toMatchObject({
      outcome: 'queue',
      assigneeUserId: null,
      assigneeTeamId: null,
    });
    expect(await snapshot()).toEqual({
      ...afterOffline,
      // the admin's status row above is setup, not a dry-run effect; the tables compared here are untouched either way
    });

    // the switch off
    await p.h.owner.query(
      `UPDATE workspace_settings SET handoff_auto_assign = false WHERE org_id = $1`,
      [t.orgId],
    );
    const off = await api.test({ channelKind: 'simulator', messageText: 'refund' });
    expect(off.body.outcome).toBe('off');
    expect(off.body.steps[0]).toMatchObject({ kind: 'switch', why: 'auto_assign_off' });

    // and the very first snapshot against the end: no rule counter, cursor, event, outbox row or audit row moved because of any call
    const end = await snapshot();
    expect(end.rules).toEqual(before.rules);
    expect(end.events).toEqual(before.events);
    expect(end.outbox).toEqual(before.outbox);
    expect(end.audit).toEqual(before.audit);
    expect(end.conversations).toEqual(before.conversations);
  });

  it('needs inbox.settings.read, and an unknown contact is a 404', async () => {
    const nobody = await p.api.member(t, 'rdn4n', [['record.contacts.read', 'all']]);
    const denied = await rulesApi(nobody.token).test({ channelKind: 'simulator' });
    expect(denied.status).toBe(403);
    const missing = await rulesApi(t.admin).test({
      contactId: randomUUID(),
      channelKind: 'simulator',
    });
    expect(missing.status).toBe(404);
  });
});

describe('rules at handoff time (H18)', () => {
  let t: Tenant;
  let ch: SimChannel;
  let a1: { token: string; userId: number };
  let u1: string;

  beforeAll(async () => {
    t = await p.api.signup('rdn5');
    ch = await simChannel(p, t);
    a1 = await p.api.member(t, 'rdn5a', AGENT);
    u1 = await uuidOf(a1.userId);
    const api = rulesApi(t.admin);
    await live(
      t,
      (
        await api.create({
          name: 'Customers asking about invoices',
          conditions: {
            keywords: { mode: 'any', words: ['invoice'] },
            contact: {
              type: 'group',
              combinator: 'and',
              children: [
                {
                  type: 'condition',
                  field: 'lifecycleStage',
                  operator: 'equals',
                  value: 'customer',
                },
              ],
            },
          },
          assign: { strategy: 'specific', userIds: [u1] },
        })
      ).body,
    );
  });

  const handoff = (id: string) =>
    p.api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${id}/handoff`)
      .set('idempotency-key', randomUUID())
      .send({ destination: { kind: 'rules' } });

  it('reads the LATEST customer message and the contact row as it is now (what a flow saved before the handoff counts)', async () => {
    const first = await customer(t, ch, 'hello');
    expect(first.assignee).toBeNull();
    // the customer then writes the word the rule is looking for, and a flow saves the stage to the contact
    await simInbound(p, t, ch, { from: first.from, text: 'about my invoice please' });
    await until('second message stored', async () => {
      const n = await p.h.owner.query(
        `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND direction = 'in'`,
        [first.conv.id],
      );
      return n.rows[0].n >= 2 ? true : null;
    });
    // not a customer yet: the rule's saved-details condition fails even though the word is there
    const early = await handoff(first.conv.uuid as string);
    expect(early.status, JSON.stringify(early.body)).toBe(200);
    expect(early.body.outcome).not.toBe('assigned');
    await p.h.owner.query(
      `UPDATE conversations SET assignee_user_id = NULL, assignee_team_id = NULL, handling = NULL WHERE id = $1`,
      [first.conv.id],
    );
    await p.h.owner.query(`UPDATE contacts SET lifecycle_stage = 'customer' WHERE id = $1`, [
      first.contactId,
    ]);
    const res = await handoff(first.conv.uuid as string);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.outcome).toBe('assigned');
    const row = (
      await p.h.owner.query(`SELECT assignee_user_id FROM conversations WHERE id = $1`, [
        first.conv.id,
      ])
    ).rows[0];
    expect(Number(row.assignee_user_id)).toBe(a1.userId);
  });
});
