import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AddonRedundancyService } from '../../../src/modules/platform-payment-gateways/addon-redundancy.service';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { WorkspaceAddonsService } from '../../../src/modules/addons-extension-registry/workspace-addons.service';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials';
import { RoutingEngine } from '../../../src/modules/team-inbox-routing-sla/routing-engine.service';
import { OwnerSyncConsumer } from '../../../src/modules/team-inbox-routing-sla/owner-sync.consumer';
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
 * Packaging gates of automatic assignment (docs/specs/packaging-teams-and-smart-routing.md): the entry plan has NO auto-assignment, the
 * "Smart routing" add-on (or a plan that includes it, or a workspace override) turns it on. Every entry point must honour the two flags
 * `inbox_routing` and `inbox_assignment_sticky`: the settings and rules API, the team method, the handoff, the escalation timer, the owner
 * sync and inbound routing. Real Postgres (restricted role), real Redis, the real ingest worker and routing listener.
 *
 * Plans are real catalogue rows here (not overrides), the add-on is the seeded draft `smart_routing` pack bought through `workspace_addons`,
 * so the merge in PlanEntitlementService.forOrg is what is under test.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let p: Pipeline;
beforeAll(async () => {
  p = await startPipeline(async () => [
    (
      await import('../../../src/modules/team-inbox-routing-sla/team-inbox-routing-sla-worker.module')
    ).TeamInboxRoutingSlaWorkerModule,
  ]);
  const q = (sql: string, args: unknown[] = []) => p.h.owner.query(sql, args);
  // A Basic plan (the flags off, and no Teams extras either) and a paid plan that has them; a free plan (both off) is what a lapsed paid plan falls back to.
  const mk = (
    slug: string,
    amount: number,
    free: boolean,
    features: Record<string, boolean>,
    sort: number,
  ) =>
    q(
      `INSERT INTO plans (slug, name, kind, amount, currency, billing_unit, billing_duration, is_free, is_active, sort_order, limits, features)
       VALUES ($1, $1, 'plan', $2, 'USD', 'months', 1, $3, true, $4, '{}'::jsonb, $5::jsonb) ON CONFLICT (slug) DO NOTHING`,
      [slug, amount, free, sort, JSON.stringify(features)],
    );
  await mk('sr_free', 0, true, BASE_OFF, 1);
  await mk('sr_basic', 10, false, BASE_OFF, 2);
  await mk('sr_pro', 50, false, { inbox_routing: true, inbox_assignment_sticky: true }, 3);
  packId = Number((await q(`SELECT id FROM plans WHERE slug = 'smart_routing'`)).rows[0].id);
  teamsPackId = Number(
    (await q(`SELECT id FROM plans WHERE slug = 'teams_permissions'`)).rows[0].id,
  );
}, 600_000);
afterAll(async () => {
  await p?.stop();
});

const BASE_OFF = {
  inbox_routing: false,
  inbox_assignment_sticky: false,
  team_hierarchy: false,
  custom_roles: false,
};
let packId = 0;
let teamsPackId = 0;
const q = (sql: string, args: unknown[] = []) => p.h.owner.query(sql, args);
const get = <T>(cls: new (...a: never[]) => T): T => p.h.app.get(cls as never, { strict: false });

let phoneSeq = 0;
const phone = () => `9188${String(20_000_000 + phoneSeq++)}`;

/** Puts the workspace on a catalogue plan, with an optional plan end (a past date = lapsed). */
async function onPlan(t: Tenant, slug: string, endsAt: string | null = null) {
  await q(`UPDATE organizations SET plan = $2 WHERE id = $1`, [t.orgId, slug]);
  await q(
    `INSERT INTO org_plan_state (org_id, plan_ends_at, billing_cycle) VALUES ($1, $2, 'monthly')
     ON CONFLICT (org_id) DO UPDATE SET plan_ends_at = EXCLUDED.plan_ends_at, billing_cycle = 'monthly', trial_ends_at = NULL`,
    [t.orgId, endsAt],
  );
}
const override = (t: Tenant, features: Record<string, boolean>) =>
  q(
    `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb)
     ON CONFLICT (org_id) DO UPDATE SET overrides = $2::jsonb`,
    [t.orgId, JSON.stringify({ features })],
  );
/** Buys an add-on pack for the workspace; `endsAt` null = open ended. Returns the purchase id. */
async function buy(t: Tenant, pack: number, endsAt: string | null = null) {
  const r = await q(
    `INSERT INTO workspace_addons (org_id, package_id, status, starts_at, ends_at) VALUES ($1, $2, 'active', now(), $3) RETURNING id`,
    [t.orgId, pack, endsAt],
  );
  return Number(r.rows[0].id);
}
const endPurchase = (t: Tenant, id: number) =>
  q(
    `UPDATE workspace_addons SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 minute' WHERE org_id = $1 AND id = $2`,
    [t.orgId, id],
  );

async function thread(t: Tenant, ch: SimChannel) {
  const from = phone();
  await simInbound(p, t, ch, { from, text: 'hello' });
  const conv = await until(`thread ${from}`, async () => {
    const c = await conversationOf(p, t, ch, from);
    return c.last_message_at ? c : null;
  });
  return { uuid: conv.uuid as string, id: Number(conv.id) };
}
const row = async (id: number) =>
  (await q(`SELECT * FROM conversations WHERE id = $1`, [id])).rows[0] as Record<string, unknown>;

const settings = (token: string) => p.api.as(token).get('/v2/inbox/handoff-settings');
const putSettings = (token: string, body: Record<string, unknown>) =>
  p.api.as(token).put('/v2/inbox/handoff-settings').set('idempotency-key', randomUUID()).send(body);
const rules = (token: string) => p.api.as(token).get('/v2/inbox/routing/rules');
const handoff = (token: string, id: string, body: Record<string, unknown>) =>
  p.api
    .as(token)
    .post(`/v2/inbox/conversations/${id}/handoff`)
    .set('idempotency-key', randomUUID())
    .send(body);
const mkTeam = (token: string, body: Record<string, unknown>) =>
  p.api.as(token).post('/v2/workspace/teams').send(body);

const ALL_OFF = {
  autoAssign: false,
  ownerFirst: false,
  keepInSync: false,
  continuityWindow: false,
  promptOwnerOnReassign: false,
};
const ALL_ON = {
  autoAssign: true,
  ownerFirst: true,
  keepInSync: true,
  continuityWindow: true,
  promptOwnerOnReassign: true,
};
const AGENT: Array<[string, 'all']> = [
  ['inbox.conversation.read', 'all'],
  ['inbox.conversation.reply', 'all'],
  ['inbox.conversation.assign_self', 'all'],
];

describe('the entry plan (both flags off): every control is refused out loud, the base stays open', () => {
  let t: Tenant;
  let ch: SimChannel;
  let a1: { token: string; userId: number };
  let team: { id: number; uuid: string };

  beforeAll(async () => {
    t = await p.api.signup('srb');
    await onPlan(t, 'sr_basic');
    ch = await simChannel(p, t);
    a1 = await p.api.member(t, 'srb1', AGENT);
    team = (
      await q(`INSERT INTO teams (org_id, name) VALUES ($1, 'Desk') RETURNING id, uuid`, [t.orgId])
    ).rows[0];
    await q(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
      t.orgId,
      team.id,
      a1.userId,
    ]);
  });

  it('the settings API says what the plan lacks; the master switch, owner modes, window and prompt are 422 PLAN_FEATURE_LOCKED', async () => {
    const s = await settings(t.admin);
    expect(s.status).toBe(200);
    expect(s.body.available).toEqual(ALL_OFF);
    for (const body of [
      { autoAssign: true },
      { ownerMode: 'owner_first' },
      { ownerMode: 'keep_in_sync' },
      { continuityDays: 14 },
      { promptOwnerOnReassign: true },
    ]) {
      const res = await putSettings(t.admin, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
    }
    // base: claim sets the owner and the queue alert work on every plan
    expect((await putSettings(t.admin, { claimSetsOwner: true })).status).toBe(200);
    expect((await putSettings(t.admin, { notifyQueue: false })).status).toBe(200);
    expect((await putSettings(t.admin, { notifyQueue: true })).status).toBe(200);
  });

  it('every routing-rules route is locked: list, create, test, settings, business hours', async () => {
    for (const res of [
      await rules(t.admin),
      await p.api.as(t.admin).post('/v2/inbox/routing/rules').send({}),
      await p.api.as(t.admin).post('/v2/inbox/routing/test').send({}),
      await p.api.as(t.admin).get('/v2/inbox/routing/settings'),
      await p.api.as(t.admin).get('/v2/inbox/routing/business-hours'),
    ]) {
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
    }
  });

  it('a team can be made with the Manual method; round robin and least loaded are refused (create and change), keeping the stored one is fine', async () => {
    for (const method of ['round_robin', 'least_loaded']) {
      const res = await mkTeam(t.admin, { name: `T ${method}`, assignmentStrategy: method });
      expect(res.status, method).toBe(422);
      expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
    }
    const ok = await mkTeam(t.admin, { name: 'Manual team' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const locked = await p.api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${ok.body.id}`)
      .send({ assignmentStrategy: 'round_robin', rowVersion: ok.body.rowVersion });
    expect(locked.status).toBe(422);
    expect(locked.body.code).toBe('PLAN_FEATURE_LOCKED');
    // saving with the stored method (a form resubmit) and choosing Manual are never blocked
    const same = await p.api.as(t.admin).patch(`/v2/workspace/teams/${ok.body.id}`).send({
      assignmentStrategy: 'manual',
      name: 'Manual team 2',
      rowVersion: ok.body.rowVersion,
    });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
  });

  it('a new chat is not assigned automatically; a handoff to a team waits in its queue, to the rules waits with a plan trace, to a person is assigned', async () => {
    const c = await thread(t, ch);
    expect((await row(c.id)).assignee_user_id).toBeNull();

    const toRules = await handoff(t.admin, c.uuid, { destination: { kind: 'rules' } });
    expect(toRules.status, JSON.stringify(toRules.body)).toBe(200);
    expect(toRules.body.outcome).not.toBe('assigned');
    const card = await p.api.as(a1.token).get(`/v2/inbox/conversations/${c.uuid}/handoff`);
    expect(JSON.stringify(card.body)).toContain('rules_not_in_plan');

    const c2 = await thread(t, ch);
    const toTeam = await handoff(t.admin, c2.uuid, {
      destination: { kind: 'team', teamId: team.uuid },
    });
    expect(toTeam.body.outcome).toBe('waiting');
    expect((await row(c2.id)).handling).toBe('waiting');

    const c3 = await thread(t, ch);
    const who = (await q(`SELECT uuid FROM users WHERE id = $1`, [a1.userId])).rows[0].uuid;
    const toPerson = await handoff(t.admin, c3.uuid, {
      destination: { kind: 'person', userId: who },
    });
    expect(toPerson.body.outcome).toBe('assigned');
    expect(Number((await row(c3.id)).assignee_user_id)).toBe(a1.userId);
  });

  it('a team method stored from before is ignored by the handoff, with a trace, and the chat waits (never a silent assignment)', async () => {
    const stored = (
      await q(
        `INSERT INTO teams (org_id, name, assignment_strategy) VALUES ($1, 'Old RR', 'round_robin') RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    await q(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
      t.orgId,
      stored.id,
      a1.userId,
    ]);
    const c = await thread(t, ch);
    const res = await handoff(t.admin, c.uuid, {
      destination: { kind: 'team', teamId: stored.uuid },
    });
    expect(res.body.outcome).toBe('waiting');
    const card = await p.api.as(a1.token).get(`/v2/inbox/conversations/${c.uuid}/handoff`);
    expect(JSON.stringify(card.body)).toContain('not_in_plan');
  });

  it('the escalation timer stops: a due escalation is dropped, not re-picked every 30 seconds, and the chat keeps what it has', async () => {
    const c = await thread(t, ch);
    await q(
      `UPDATE conversations SET escalation_due_at = now() - interval '5 minutes',
              escalation_action = '{"ruleId":"r1","priority":"high"}'::jsonb WHERE id = $1`,
      [c.id],
    );
    const applied = await get(RoutingEngine).runDueEscalation(t.orgId, c.uuid);
    expect(applied).toBe(false);
    const after = await row(c.id);
    expect(after.escalation_due_at).toBeNull();
    expect(after.escalation_action).toBeNull();
    expect(after.assignee_user_id).toBeNull();
  });

  it('keep-in-sync does nothing even when the stored mode says so', async () => {
    await q(`UPDATE workspace_settings SET handoff_owner_mode = 'keep_in_sync' WHERE org_id = $1`, [
      t.orgId,
    ]);
    const contactUuid = (await q(`SELECT uuid FROM contacts WHERE org_id = $1 LIMIT 1`, [t.orgId]))
      .rows[0]?.uuid as string | undefined;
    expect(contactUuid).toBeDefined();
    expect(await get(OwnerSyncConsumer).sync(t.orgId, contactUuid!)).toBe(0);
  });

  it('claim, the waiting tab and Return to bot need no plan flag', async () => {
    const c = await thread(t, ch);
    await handoff(t.admin, c.uuid, { destination: { kind: 'team', teamId: team.uuid } });
    const list = await p.api.as(a1.token).get('/v2/inbox/conversations?tab=waiting');
    expect((list.body.data as Array<{ id: string }>).map((x) => x.id)).toContain(c.uuid);
    const sum = (await p.api.as(a1.token).get(`/v2/inbox/conversations/${c.uuid}`)).body;
    const version = (sum.conversation ?? sum).rowVersion as number;
    const claim = await p.api
      .as(a1.token)
      .post(`/v2/inbox/conversations/${c.uuid}/claim`)
      .set('idempotency-key', randomUUID())
      .send({ rowVersion: version });
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);
  });
});

describe('the Smart routing add-on: bought, ended, cancelled and overridden mid-queue', () => {
  let t: Tenant;
  let ch: SimChannel;
  let a1: { token: string; userId: number };
  let team: { id: number; uuid: string };
  let waiting: { uuid: string; id: number };

  beforeAll(async () => {
    t = await p.api.signup('sra');
    await onPlan(t, 'sr_basic');
    ch = await simChannel(p, t);
    a1 = await p.api.member(t, 'sra1', AGENT);
    team = (
      await q(`INSERT INTO teams (org_id, name) VALUES ($1, 'Desk') RETURNING id, uuid`, [t.orgId])
    ).rows[0];
    await q(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
      t.orgId,
      team.id,
      a1.userId,
    ]);
  });

  it('a chat already Waiting before the purchase stays Waiting; buying the add-on opens every control at once', async () => {
    waiting = await thread(t, ch);
    await handoff(t.admin, waiting.uuid, { destination: { kind: 'team', teamId: team.uuid } });
    expect((await settings(t.admin)).body.available).toEqual(ALL_OFF);

    await buy(t, packId);
    expect((await settings(t.admin)).body.available).toEqual(ALL_ON);
    expect((await row(waiting.id)).handling).toBe('waiting');
    expect((await putSettings(t.admin, { autoAssign: true })).status).toBe(200);
    expect((await putSettings(t.admin, { ownerMode: 'owner_first' })).status).toBe(200);
    expect((await rules(t.admin)).status).toBe(200);
    const rr = await mkTeam(t.admin, { name: 'RR', assignmentStrategy: 'round_robin' });
    expect(rr.status, JSON.stringify(rr.body)).toBe(201);
  });

  it('when the add-on ends mid-queue: the controls lock again, the stored choices are kept but not in effect, chats stay where they are, timers stop', async () => {
    // a second purchase row is not needed: end the one bought above
    const bought = Number(
      (
        await q(`SELECT id FROM workspace_addons WHERE org_id = $1 AND package_id = $2`, [
          t.orgId,
          packId,
        ])
      ).rows[0].id,
    );
    const scheduled = await thread(t, ch);
    await q(
      `UPDATE conversations SET escalation_due_at = now() - interval '1 minute',
              escalation_action = '{"ruleId":"r1","priority":"high"}'::jsonb WHERE id = $1`,
      [scheduled.id],
    );
    await endPurchase(t, bought);

    const s = await settings(t.admin);
    expect(s.body.available).toEqual(ALL_OFF);
    // stored, not erased...
    const stored = (
      await q(
        `SELECT handoff_auto_assign AS auto_assign, handoff_owner_mode AS owner_mode FROM workspace_settings WHERE org_id = $1`,
        [t.orgId],
      )
    ).rows[0];
    expect(stored).toMatchObject({ auto_assign: true, owner_mode: 'owner_first' });
    // ...but not in effect
    expect(s.body).toMatchObject({ autoAssign: false, ownerMode: 'independent' });
    expect((await rules(t.admin)).status).toBe(422);
    expect((await putSettings(t.admin, { autoAssign: true })).status).toBe(422);
    // the chat that waited keeps waiting, the new round robin team keeps existing but is not applied
    expect((await row(waiting.id)).handling).toBe('waiting');
    expect(await get(RoutingEngine).runDueEscalation(t.orgId, scheduled.uuid)).toBe(false);
    expect((await row(scheduled.id)).escalation_due_at).toBeNull();
    const rrTeams = await q(
      `SELECT count(*)::int AS n FROM teams WHERE org_id = $1 AND assignment_strategy = 'round_robin'`,
      [t.orgId],
    );
    expect(rrTeams.rows[0].n).toBe(1);
  });

  it('a cancelled (status) purchase gives nothing; a workspace override beats the add-on in both directions', async () => {
    const id = await buy(t, packId);
    expect((await settings(t.admin)).body.available).toEqual(ALL_ON);
    await q(`UPDATE workspace_addons SET status = 'cancelled' WHERE org_id = $1 AND id = $2`, [
      t.orgId,
      id,
    ]);
    expect((await settings(t.admin)).body.available).toEqual(ALL_OFF);

    const again = await buy(t, packId);
    await override(t, BASE_OFF);
    expect((await settings(t.admin)).body.available).toEqual(ALL_OFF); // override off wins over the live add-on
    await endPurchase(t, again);
    await override(t, { inbox_routing: true, inbox_assignment_sticky: true });
    expect((await settings(t.admin)).body.available).toEqual(ALL_ON); // override on wins without any add-on
    await override(t, {});
  });

  it('a plan that includes the flags needs no add-on; a lapsed paid plan falls back to the free plan, an add-on the workspace bought still applies', async () => {
    await onPlan(t, 'sr_pro');
    expect((await settings(t.admin)).body.available).toEqual(ALL_ON);
    await onPlan(t, 'sr_pro', new Date(Date.now() - 3_600_000).toISOString());
    expect((await settings(t.admin)).body.available).toEqual(ALL_OFF);
    const own = await buy(t, packId);
    expect((await settings(t.admin)).body.available).toEqual(ALL_ON); // the purchase is the workspace's own, not part of the plan
    await endPurchase(t, own);
    await onPlan(t, 'sr_basic');
  });
});

describe('Teams and Smart routing are separate packs', () => {
  let t: Tenant;
  let a: { token: string; userId: number };
  beforeAll(async () => {
    t = await p.api.signup('srt');
    await onPlan(t, 'sr_basic');
    a = await p.api.member(t, 'srt1', AGENT);
  });
  const uuidOf = async (id: number) =>
    (await q(`SELECT uuid FROM users WHERE id = $1`, [id])).rows[0].uuid as string;

  it('Teams without Smart routing: parent teams work, round robin does not; and the other way round', async () => {
    const teamsPack = await buy(t, teamsPackId);
    const parent = await mkTeam(t.admin, { name: 'HQ' });
    expect(parent.status, JSON.stringify(parent.body)).toBe(201);
    const child = await mkTeam(t.admin, { name: 'Child', parentId: parent.body.id });
    expect(child.status, JSON.stringify(child.body)).toBe(201);
    expect((await mkTeam(t.admin, { name: 'RR1', assignmentStrategy: 'round_robin' })).status).toBe(
      422,
    );
    await endPurchase(t, teamsPack);

    // Teams ended: the existing child keeps its parent and can be edited with the same parent (nothing is stripped)
    const resave = await p.api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${child.body.id}`)
      .send({ parentId: parent.body.id, name: 'Child 2', rowVersion: child.body.rowVersion });
    expect(resave.status, JSON.stringify(resave.body)).toBe(200);
    // ...but a NEW parent link is refused
    const other = await mkTeam(t.admin, { name: 'Other' });
    const relink = await p.api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${other.body.id}`)
      .send({ parentId: parent.body.id, rowVersion: other.body.rowVersion });
    expect(relink.status).toBe(422);
    expect(relink.body.code).toBe('PLAN_FEATURE_LOCKED');

    await buy(t, packId);
    expect((await mkTeam(t.admin, { name: 'RR2', assignmentStrategy: 'round_robin' })).status).toBe(
      201,
    );
    expect((await mkTeam(t.admin, { name: 'Kid', parentId: parent.body.id })).status).toBe(422);
    void a;
  });

  it('the teams cap lowered below the existing teams keeps them and refuses new ones; the Teams pack adds room', async () => {
    const t2 = await p.api.signup('srcap');
    await onPlan(t2, 'sr_basic');
    await mkTeam(t2.admin, { name: 'One' });
    await mkTeam(t2.admin, { name: 'Two' });
    await q(`UPDATE plans SET limits = '{"teams": 1}'::jsonb WHERE slug = 'sr_basic'`);
    try {
      const refused = await mkTeam(t2.admin, { name: 'Three' });
      expect(refused.status).toBe(422);
      const list = await p.api.as(t2.admin).get('/v2/workspace/teams');
      expect((list.body.data as unknown[]).length).toBeGreaterThanOrEqual(2); // existing teams kept
      await buy(t2, teamsPackId); // +10 on top of the plan's cap
      expect((await mkTeam(t2.admin, { name: 'Three' })).status).toBe(201);
    } finally {
      await q(`UPDATE plans SET limits = '{}'::jsonb WHERE slug = 'sr_basic'`);
    }
    void uuidOf;
  });
});

describe('permission and plan are independent gates', () => {
  let t: Tenant;
  let ch: SimChannel;
  let viewer: { token: string; userId: number };
  let readerOnly: { token: string; userId: number };
  let manager: { token: string; userId: number };
  let noSettings: { token: string; userId: number };
  let a1: { token: string; userId: number };
  let a2: { token: string; userId: number };
  let teamA: { id: number; uuid: string };

  beforeAll(async () => {
    t = await p.api.signup('srp');
    await onPlan(t, 'sr_basic');
    ch = await simChannel(p, t);
    viewer = await p.api.member(t, 'srpv', [['inbox.conversation.read', 'all']]);
    // a custom role: may read the inbox but has neither inbox.settings.read nor inbox.routing.manage
    noSettings = await p.api.member(t, 'srpn', [
      ['inbox.conversation.read', 'all'],
      ['inbox.conversation.assign_self', 'all'],
    ]);
    readerOnly = await p.api.member(t, 'srpr', [['inbox.settings.read', 'all']]);
    manager = await p.api.member(t, 'srpm', [
      ['inbox.settings.read', 'all'],
      ['inbox.routing.manage', 'all'],
    ]);
    a1 = await p.api.member(t, 'srp1', AGENT);
    a2 = await p.api.member(t, 'srp2', [
      ['inbox.conversation.read', 'team'],
      ['inbox.conversation.reply', 'team'],
      ['inbox.conversation.assign_self', 'team'],
    ]);
    teamA = (
      await q(`INSERT INTO teams (org_id, name) VALUES ($1, 'A') RETURNING id, uuid`, [t.orgId])
    ).rows[0];
    await q(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
      t.orgId,
      teamA.id,
      a1.userId,
    ]);
  });

  it('a role without inbox.settings.read cannot read the settings, with or without the plan; a viewer cannot change them', async () => {
    expect((await settings(noSettings.token)).status).toBe(403);
    expect((await settings(viewer.token)).status).toBe(403);
    expect((await putSettings(viewer.token, { notifyQueue: false })).status).toBe(403);
    expect((await settings(readerOnly.token)).status).toBe(200);
    expect((await putSettings(readerOnly.token, { notifyQueue: false })).status).toBe(403);
  });

  it('permission without the plan: the manager is refused by the plan (422) on a locked setting but may change a base one', async () => {
    const res = await putSettings(manager.token, { autoAssign: true });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
    expect((await putSettings(manager.token, { claimSetsOwner: true })).status).toBe(200);
  });

  it('plan without the permission: with Smart routing on, a reader still cannot switch auto-assignment or touch rules', async () => {
    const id = await buy(t, packId);
    expect((await putSettings(readerOnly.token, { autoAssign: true })).status).toBe(403);
    expect((await p.api.as(readerOnly.token).post('/v2/inbox/routing/rules').send({})).status).toBe(
      403,
    );
    expect((await rules(readerOnly.token)).status).toBe(200);
    expect((await putSettings(manager.token, { autoAssign: true })).status).toBe(200);
    expect((await putSettings(noSettings.token, { autoAssign: false })).status).toBe(403);
    await endPurchase(t, id);
  });

  it("an agent scoped to another team cannot claim a chat in a team's queue; one in the team can", async () => {
    const c = await thread(t, ch);
    await handoff(t.admin, c.uuid, { destination: { kind: 'team', teamId: teamA.uuid } });
    const claim = (token: string, version: number) =>
      p.api
        .as(token)
        .post(`/v2/inbox/conversations/${c.uuid}/claim`)
        .set('idempotency-key', randomUUID())
        .send({ rowVersion: version });
    const sum = (await p.api.as(a1.token).get(`/v2/inbox/conversations/${c.uuid}`)).body;
    const version = (sum.conversation ?? sum).rowVersion as number;
    const other = await claim(a2.token, version);
    expect([403, 404]).toContain(other.status);
    expect((await row(c.id)).assignee_user_id).toBeNull();
    const mine = await claim(a1.token, version);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
  });
});

describe('workspace business hours are read by the rules and by SLA clocks', () => {
  it('locked with neither feature; editable with either one', async () => {
    const t = await p.api.signup('srh');
    await onPlan(t, 'sr_basic');
    const hours = { days: {} as Record<string, unknown> };
    const get = () => p.api.as(t.admin).get('/v2/inbox/routing/business-hours');
    expect((await get()).status).toBe(422);
    expect((await get()).body.code).toBe('PLAN_FEATURE_LOCKED');

    // SLA policies on the plan, no Smart routing: the hours can be read and saved
    await override(t, { inbox_sla: true });
    const read = await get();
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    const save = await p.api
      .as(t.admin)
      .put('/v2/inbox/routing/business-hours')
      .set('idempotency-key', randomUUID())
      .send({ days: read.body.days });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    // ...but the routing rules stay locked
    expect((await rules(t.admin)).status).toBe(422);
    void hours;

    // Smart routing alone is enough too
    await override(t, { inbox_routing: true });
    expect((await get()).status).toBe(200);
  });
});

describe('an add-on the plan already includes is not offered, and cannot be bought', () => {
  const packs = async () => {
    // put the draft packs on sale with a price; add one that is only partly covered by a Pro plan
    await q(
      `UPDATE plans SET is_active = true, is_free = false, amount = 9 WHERE slug IN ('smart_routing', 'teams_permissions')`,
    );
    await q(
      `INSERT INTO plans (slug, name, kind, amount, currency, billing_unit, billing_duration, is_free, is_active, sort_order, limits, features)
       VALUES ('sr_partial', 'Partial', 'addon', 5, 'USD', 'months', 1, false, true, 920, '{}'::jsonb,
               '{"inbox_routing": true, "calling": true}'::jsonb) ON CONFLICT (slug) DO NOTHING`,
    );
  };
  const catalog = async (t: Tenant) => {
    const res = await p.api.as(t.admin).get('/v2/addons');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as {
      eligible: boolean;
      owned: unknown[];
      catalog: Array<{
        slug: string;
        state: string;
        ownedCount: number;
        grantBullets: Array<{ key: string }>;
      }>;
    };
  };
  const card = (c: Awaited<ReturnType<typeof catalog>>, slug: string) =>
    c.catalog.find((x) => x.slug === slug)!;
  const quote = (t: Tenant, slug: string) =>
    p.api.as(t.admin).get(`/v2/billing/checkout/plans/${slug}/quote`);

  it('included: every feature granted by the plan, no cap: state included, nothing listed, checkout refuses', async () => {
    await packs();
    const t = await p.api.signup('sri');
    await onPlan(t, 'sr_pro');
    const c = await catalog(t);
    expect(c.eligible).toBe(true);
    expect(card(c, 'smart_routing')).toMatchObject({ state: 'included', grantBullets: [] });
    const q1 = await quote(t, 'smart_routing');
    expect(q1.status).toBe(422);
    expect(q1.body.code).toBe('PAYGW_ADDON_INCLUDED');
    // the order path runs the same `assertPurchasable` as the quote (see CheckoutService), so a crafted order is refused identically
  });

  it('partial: stays buyable and lists only what is still missing; a cap-only boost stays buyable', async () => {
    const t = await p.api.signup('srp2');
    await onPlan(t, 'sr_pro');
    const c = await catalog(t);
    const partial = card(c, 'sr_partial');
    expect(partial.state).toBe('buy');
    expect(partial.grantBullets.map((b) => b.key)).toEqual(['calling']);
    // Teams: the features are on the plan by default, but +10 teams is still something to sell
    expect(card(c, 'teams_permissions').state).toBe('buy');
    expect((await quote(t, 'sr_partial')).body.code).not.toBe('PAYGW_ADDON_INCLUDED');
  });

  it('on a plan without the feature the pack is a plain buy, and an owner of it reads active', async () => {
    const t = await p.api.signup('srb2');
    await onPlan(t, 'sr_basic');
    expect(card(await catalog(t), 'smart_routing').state).toBe('buy');
    await buy(t, packId);
    const c = await catalog(t);
    expect(card(c, 'smart_routing')).toMatchObject({ state: 'active', ownedCount: 1 });
  });

  it('owned, then the plan starts including it: the card reads included and still shows it is owned', async () => {
    const t = await p.api.signup('sro');
    await onPlan(t, 'sr_basic');
    await buy(t, packId);
    await onPlan(t, 'sr_pro');
    const c = await catalog(t);
    expect(card(c, 'smart_routing')).toMatchObject({ state: 'included', ownedCount: 1 });
  });

  it('a platform-owned workspace and a workspace override ON read included; override OFF does not', async () => {
    const t = await p.api.signup('srpo');
    await onPlan(t, 'sr_basic');
    await q(
      `INSERT INTO org_plan_state (org_id, platform_owned) VALUES ($1, true)
       ON CONFLICT (org_id) DO UPDATE SET platform_owned = true`,
      [t.orgId],
    );
    expect(card(await catalog(t), 'smart_routing').state).toBe('included');
    await q(`UPDATE org_plan_state SET platform_owned = false WHERE org_id = $1`, [t.orgId]);
    await override(t, { inbox_routing: true, inbox_assignment_sticky: true });
    expect(card(await catalog(t), 'smart_routing').state).toBe('included');
    await override(t, { inbox_routing: false, inbox_assignment_sticky: false });
    expect(card(await catalog(t), 'smart_routing').state).toBe('buy');
  });

  it('a lapsed paid plan falls back to the free plan: the plan grants nothing, and (lapsed) no add-ons are offered', async () => {
    const t = await p.api.signup('srl');
    await onPlan(t, 'sr_pro', new Date(Date.now() - 3_600_000).toISOString());
    const inc = await get(PlanEntitlementService).includedByPlan(t.orgId, ['inbox_routing']);
    expect(inc.size).toBe(0);
    expect((await catalog(t)).eligible).toBe(false);
  });

  it('owner decision: a FREE plan sees no add-ons at all (an add-on needs an active paid plan)', async () => {
    const t = await p.api.signup('srf');
    await onPlan(t, 'sr_free');
    expect(await catalog(t)).toEqual({ eligible: false, owned: [], catalog: [] });
    const q2 = await quote(t, 'sr_partial');
    expect(q2.status).toBe(422);
    expect(q2.body.code).toBe('PAYGW_PLAN_NOT_PURCHASABLE');
  });

  it('the operator view of a workspace is the same function, so the same states', async () => {
    const t = await p.api.signup('sro2');
    await onPlan(t, 'sr_pro');
    const viaHttp = await catalog(t);
    const viaService = await RequestContextStore.run(
      { requestId: 'op-view', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
      () => get(WorkspaceAddonsService).forWorkspace(t.orgId),
    );
    expect(viaService.catalog.map((c) => [c.slug, c.state])).toEqual(
      viaHttp.catalog.map((c) => [c.slug, c.state]),
    );
  });
});

describe('an add-on the plan starts to include stops renewing at the end of its term', () => {
  const svc = () => get(AddonRedundancyService);
  /** Buys the pack for a term of 20 days and, unless `oneTime`, gives it a renewing subscription row with no provider id (nothing to call). */
  async function owned(t: Tenant, pack: number, status = 'active', oneTime = false) {
    const wa = await q(
      `INSERT INTO workspace_addons (org_id, package_id, status, starts_at, ends_at) VALUES ($1, $2, 'active', now(), now() + interval '20 days') RETURNING id`,
      [t.orgId, pack],
    );
    const waId = Number(wa.rows[0].id);
    if (oneTime) return { waId, subId: null as number | null };
    const sub = await q(
      `INSERT INTO subscriptions (org_id, plan_id, kind, workspace_addon_id, gateway, gateway_subscription_id, billing_cycle, status, amount, currency)
       VALUES ($1, 'smart_routing', 'addon', $2, 'razorpay', NULL, 'monthly', $3, 9, 'USD') RETURNING id`,
      [t.orgId, waId, status],
    );
    return { waId, subId: Number(sub.rows[0].id) };
  }
  const statusOf = async (id: number) =>
    (await q(`SELECT status, meta FROM subscriptions WHERE id = $1`, [id])).rows[0] as {
      status: string;
      meta: { cancel?: { reason_code?: string; at_cycle_end?: boolean } };
    };
  const endsAt = async (waId: number) =>
    new Date(
      (await q(`SELECT ends_at FROM workspace_addons WHERE id = $1`, [waId])).rows[0].ends_at,
    );
  const stoppedEvents = async (orgId: number) =>
    q(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'paygw.addon.renewal_stopped'`,
      [orgId],
    );
  const smartCard = async (t: Tenant) =>
    (await p.api.as(t.admin).get('/v2/addons')).body.catalog.find(
      (c: { slug: string }) => c.slug === 'smart_routing',
    );

  it('upgrade to a plan that includes it: the renewal stops, the term keeps running, one notification, an audit row; a second pass changes nothing', async () => {
    const t = await p.api.signup('rd1');
    await onPlan(t, 'sr_basic');
    const { waId, subId } = await owned(t, packId);
    expect(await svc().stopForWorkspace(t.orgId)).toBe(0); // the plan does not cover it yet
    const before = await endsAt(waId);

    await onPlan(t, 'sr_pro');
    expect(await svc().stopForWorkspace(t.orgId)).toBe(1);
    const s = await statusOf(subId!);
    expect(s.status).toBe('canceled');
    expect(s.meta.cancel).toMatchObject({ reason_code: 'plan_includes', at_cycle_end: true });
    expect(await endsAt(waId)).toEqual(before); // no early removal
    const live = await q(
      `SELECT 1 FROM workspace_addons WHERE id = $1 AND status = 'active' AND ends_at > now()`,
      [waId],
    );
    expect(live.rowCount).toBe(1);
    const ev = await stoppedEvents(t.orgId);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].payload).toMatchObject({ pack: 'smart_routing', plan: 'sr_pro' });
    const audit = await q(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'subscriptions' AND record_id = $2`,
      [t.orgId, subId],
    );
    expect(JSON.stringify(audit.rows)).toContain('plan_includes');

    expect(await svc().stopForWorkspace(t.orgId)).toBe(0); // idempotent
    expect((await stoppedEvents(t.orgId)).rowCount).toBe(1);

    const card = await smartCard(t);
    expect(card).toMatchObject({ state: 'included', ownedCount: 1, ownedRenews: false });
    expect(card.ownedEndsAt).not.toBeNull();
  });

  it('switching back to a plan that no longer covers it does not re-enable the renewal', async () => {
    const t = await p.api.signup('rd2');
    await onPlan(t, 'sr_pro');
    const { subId } = await owned(t, packId);
    await svc().stopForWorkspace(t.orgId);
    await onPlan(t, 'sr_basic');
    await svc().stopForWorkspace(t.orgId);
    expect((await statusOf(subId!)).status).toBe('canceled');
    const card = await smartCard(t);
    expect(card.state).toBe('active'); // inside the paid term, and never renewing again by itself
    expect(card.ownedRenews).toBe(false);
  });

  it('past due, stacked purchases and one-time packs', async () => {
    const t = await p.api.signup('rd3');
    await onPlan(t, 'sr_pro');
    const a = await owned(t, packId, 'past_due');
    const b = await owned(t, packId, 'active');
    const c = await owned(t, packId, 'active', true); // one-time: no subscription, nothing to stop
    expect(c.subId).toBeNull();
    expect(await svc().stopForWorkspace(t.orgId)).toBe(2);
    expect((await statusOf(a.subId!)).status).toBe('canceled');
    expect((await statusOf(b.subId!)).status).toBe('canceled');
    expect(await endsAt(c.waId)).toBeInstanceOf(Date);
  });

  it('a lifetime pack has no subscription: nothing happens', async () => {
    const t = await p.api.signup('rd4');
    await onPlan(t, 'sr_pro');
    await q(
      `INSERT INTO workspace_addons (org_id, package_id, status, starts_at, ends_at) VALUES ($1, $2, 'active', now(), NULL)`,
      [t.orgId, packId],
    );
    expect(await svc().stopForWorkspace(t.orgId)).toBe(0);
  });

  it('an override or platform-owned status that covers it stops too; a pack with a cap (Teams +10) is never stopped', async () => {
    const t = await p.api.signup('rd5');
    await onPlan(t, 'sr_basic');
    const { subId } = await owned(t, packId);
    await override(t, { inbox_routing: true, inbox_assignment_sticky: true });
    expect(await svc().stopForWorkspace(t.orgId)).toBe(1);
    expect((await statusOf(subId!)).status).toBe('canceled');

    const t2 = await p.api.signup('rd6');
    await onPlan(t2, 'sr_pro');
    const wa = await q(
      `INSERT INTO workspace_addons (org_id, package_id, status, starts_at, ends_at) VALUES ($1, $2, 'active', now(), now() + interval '20 days') RETURNING id`,
      [t2.orgId, teamsPackId],
    );
    await q(
      `INSERT INTO subscriptions (org_id, plan_id, kind, workspace_addon_id, gateway, billing_cycle, status, amount, currency)
       VALUES ($1, 'teams_permissions', 'addon', $2, 'razorpay', 'monthly', 'active', 9, 'USD')`,
      [t2.orgId, wa.rows[0].id],
    );
    expect(await svc().stopForWorkspace(t2.orgId)).toBe(0);

    const t3 = await p.api.signup('rd7');
    await onPlan(t3, 'sr_basic');
    const own3 = await owned(t3, packId);
    await q(
      `INSERT INTO org_plan_state (org_id, platform_owned) VALUES ($1, true) ON CONFLICT (org_id) DO UPDATE SET platform_owned = true`,
      [t3.orgId],
    );
    expect(await svc().stopForWorkspace(t3.orgId)).toBe(1);
    expect((await statusOf(own3.subId!)).status).toBe('canceled');
  });

  it('the sweep finds the workspaces by itself (an operator switched the plan)', async () => {
    const t = await p.api.signup('rd8');
    await onPlan(t, 'sr_basic');
    const { subId } = await owned(t, packId);
    await onPlan(t, 'sr_pro');
    expect(await svc().sweep()).toBeGreaterThanOrEqual(1);
    expect((await statusOf(subId!)).status).toBe('canceled');
  });
});
