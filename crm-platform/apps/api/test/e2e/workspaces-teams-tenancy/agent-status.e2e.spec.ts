import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  PASSWORD,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * The personal status (Available / Away) and the working hours that can automate it, through HTTP against real Postgres
 * (docs/specs/agent-status-bar.md). The pure rule is unit tested (test/unit/workspaces-teams-tenancy/agent-status.spec.ts); this
 * covers what only the database and the guards can prove: the stored shape, the plan flag, the permission scopes, tenant isolation, and that
 * the lists and the assignee picker read the same effective status.
 */
let h: Harness;
let api: Api;
beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

let ipCounter = 40;
const ip = () => `10.77.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;

async function addMember(t: Tenant, name: string, roleName: string) {
  const email = `${name.toLowerCase().replace(/\W/g, '')}${Date.now()}${ipCounter}@example.test`;
  const role = await h.owner.query(`SELECT id FROM roles WHERE org_id = $1 AND name = $2`, [
    t.orgId,
    roleName,
  ]);
  const user = await h.owner.query(
    `INSERT INTO users (org_id, email, full_name, password_hash, joined_at) VALUES ($1,$2,$3,$4, now()) RETURNING id, uuid`,
    [t.orgId, email, name, await hash(PASSWORD)],
  );
  const userId = Number(user.rows[0].id);
  await h.owner.query(`INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1,$2,$3)`, [
    t.orgId,
    userId,
    role.rows[0].id,
  ]);
  await h.owner.query(
    `INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at) VALUES ($1,$2,now(),now())`,
    [t.orgId, userId],
  );
  return { userId, uuid: user.rows[0].uuid as string, email };
}
async function signIn(slug: string, email: string): Promise<string> {
  const res = await api
    .http()
    .post('/v2/auth/login')
    .set('x-forwarded-for', ip())
    .send({ orgSlug: slug, email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body.tokens.accessToken as string;
}

/** The two plan features for one workspace, through the operator override (it beats the plan and the catalogue default). */
const flags = (t: Tenant, f: { bar?: boolean; automation?: boolean }) =>
  h.owner.query(
    `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb)
     ON CONFLICT (org_id) DO UPDATE SET overrides = $2::jsonb`,
    [
      t.orgId,
      JSON.stringify({
        features: {
          agent_status_bar: f.bar ?? true,
          agent_status_automation: f.automation ?? true,
        },
      }),
    ],
  );

type Day = { enabled: boolean; from: string; to: string };
const hhmm = (h24: number) => `${String((h24 + 24) % 24).padStart(2, '0')}:00`;
const week = (d: Day) => ({ mon: d, tue: d, wed: d, thu: d, fri: d, sat: d, sun: d });
/** Open for one hour, starting two hours from now, every day of the week (UTC): now is never inside it. */
const closedNow = (automate = true) => {
  const hour = new Date().getUTCHours();
  return {
    automate,
    timezone: 'UTC',
    days: week({ enabled: true, from: hhmm(hour + 2), to: hhmm(hour + 3) }),
  };
};
/** Open all day, every day: now is always inside it. */
const openNow = (automate = true) => ({
  automate,
  timezone: 'UTC',
  days: week({ enabled: true, from: '00:00', to: '24:00' }),
});
const emptyWeek = () => ({
  automate: true,
  timezone: 'UTC',
  days: week({ enabled: false, from: '09:00', to: '17:00' }),
});

const status = (token: string) => api.as(token).get('/v2/workspace/members/me/availability');
const setStatus = (token: string, s: 'online' | 'offline') =>
  api.as(token).put('/v2/workspace/members/me/availability').send({ status: s });
const myHours = (token: string) => api.as(token).get('/v2/workspace/members/me/working-hours');
const saveMyHours = (token: string, body: unknown) =>
  api.as(token).put('/v2/workspace/members/me/working-hours').send(body as object);

describe('my status', () => {
  it('an agent with no status row is Available, and the answer keeps the old two-word status', async () => {
    const t = await api.signup('ast1');
    await flags(t, {});
    const a = await addMember(t, 'Ava Agent', 'Agent');
    const res = await status(await signIn(t.slug, a.email));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'online',
      state: 'available',
      reason: 'default',
      manual: false,
      hours: { configured: false, automate: false },
      features: { bar: true, automation: true },
    });
  });

  it('Set as away is a manual choice; Set as available is a manual choice that beats the schedule', async () => {
    const t = await api.signup('ast2');
    await flags(t, {});
    const a = await addMember(t, 'Ben Agent', 'Agent');
    const token = await signIn(t.slug, a.email);

    const away = await setStatus(token, 'offline');
    expect(away.status, JSON.stringify(away.body)).toBe(200);
    expect(away.body).toMatchObject({ status: 'offline', state: 'away', reason: 'manual', manual: true });

    // Working hours that make "now" outside, with automation on: the manual Away expires at the next boundary, and the person
    // chooses Available explicitly.
    expect((await saveMyHours(token, closedNow())).status).toBe(200);
    const stored = (
      await h.owner.query(`SELECT status, preferences FROM agent_statuses WHERE org_id = $1 AND user_id = $2`, [
        t.orgId,
        a.userId,
      ])
    ).rows[0];
    expect(stored.status).toBe('offline');
    expect(stored.preferences.availability.manual.status).toBe('offline');
    expect(stored.preferences.availability.manual.until).toBeTruthy();

    const on = await setStatus(token, 'online');
    expect(on.body).toMatchObject({ state: 'available', reason: 'manual', manual: true });
    expect(on.body.changesAt).toBeTruthy();
  });

  it('refuses a status other than online or offline, and needs a session', async () => {
    const t = await api.signup('ast3');
    const a = await addMember(t, 'Cy Agent', 'Agent');
    const token = await signIn(t.slug, a.email);
    expect([400, 422]).toContain((await api.as(token).put('/v2/workspace/members/me/availability').send({ status: 'busy' })).status);
    expect((await api.http().get('/v2/workspace/members/me/availability')).status).toBe(401);
  });
});

describe('working hours automate the status', () => {
  it('outside the hours the person is Away; the members list, the assignee picker and the status endpoint agree', async () => {
    const t = await api.signup('ast4');
    await flags(t, {});
    const a = await addMember(t, 'Dee Agent', 'Agent');
    const b = await addMember(t, 'Eli Agent', 'Agent');
    const ta = await signIn(t.slug, a.email);
    expect((await saveMyHours(ta, closedNow())).status).toBe(200);

    const mine = await status(ta);
    expect(mine.body).toMatchObject({ state: 'away', reason: 'schedule', status: 'offline', manual: false });
    expect(mine.body.changesAt).toBeTruthy();
    // Nothing was written to the stored status: the schedule is evaluated, not stored.
    const row = await h.owner.query(`SELECT status FROM agent_statuses WHERE org_id = $1 AND user_id = $2`, [t.orgId, a.userId]);
    expect(row.rows[0].status).toBe('online');

    const members = await api.as(t.admin).get('/v2/workspace/members?limit=100');
    const byId = new Map((members.body.data as Array<{ id: string; presence: string }>).map((m) => [m.id, m.presence]));
    expect(byId.get(a.uuid)).toBe('away');
    expect(byId.get(b.uuid)).toBe('online');

    const picker = await api.as(t.admin).get('/v2/inbox/assignees');
    expect(picker.status, JSON.stringify(picker.body)).toBe(200);
    const users = picker.body.users as Array<{ id: string; availability: string }>;
    expect(users.find((u) => u.id === a.uuid)?.availability).toBe('away');
    expect(users.find((u) => u.id === b.uuid)?.availability).toBe('online');
  });

  it('inside the hours the person is Available, and with Automate off the schedule is ignored', async () => {
    const t = await api.signup('ast5');
    await flags(t, {});
    const a = await addMember(t, 'Fay Agent', 'Agent');
    const ta = await signIn(t.slug, a.email);
    expect((await saveMyHours(ta, openNow())).status).toBe(200);
    expect((await status(ta)).body).toMatchObject({ state: 'available', reason: 'default' });
    expect((await saveMyHours(ta, closedNow(false))).status).toBe(200);
    expect((await status(ta)).body).toMatchObject({ state: 'available', hours: { automate: false } });
  });

  it('an empty schedule with Automate on is always Available and flagged', async () => {
    const t = await api.signup('ast6');
    await flags(t, {});
    const a = await addMember(t, 'Gus Agent', 'Agent');
    const ta = await signIn(t.slug, a.email);
    const saved = await saveMyHours(ta, emptyWeek());
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.emptySchedule).toBe(true);
    expect((await status(ta)).body).toMatchObject({ state: 'available', hours: { emptySchedule: true } });
  });

  it('a person on leave is Away by leave, and a manual Available set during the leave beats it', async () => {
    const t = await api.signup('ast7');
    await flags(t, {});
    const a = await addMember(t, 'Hal Agent', 'Agent');
    const ta = await signIn(t.slug, a.email);
    await h.owner.query(
      `INSERT INTO member_leaves (org_id, user_id, starts_on, ends_on, status)
       VALUES ($1, $2, (now() AT TIME ZONE 'UTC')::date - 1, (now() AT TIME ZONE 'UTC')::date + 5, 'active')`,
      [t.orgId, a.userId],
    );
    expect((await status(ta)).body).toMatchObject({ state: 'away', reason: 'leave' });
    expect((await setStatus(ta, 'online')).body).toMatchObject({ state: 'available', reason: 'manual' });
  });

  it('changing the hours revives nothing: a manual Away that already ended stays ended', async () => {
    const t = await api.signup('ast8');
    await flags(t, {});
    const a = await addMember(t, 'Ivy Agent', 'Agent');
    const ta = await signIn(t.slug, a.email);
    expect((await saveMyHours(ta, openNow())).status).toBe(200);
    expect((await setStatus(ta, 'offline')).status).toBe(200);
    // The choice ended a minute ago (a boundary passed).
    await h.owner.query(
      `UPDATE agent_statuses SET preferences = jsonb_set(preferences, '{availability,manual,until}', to_jsonb((now() - interval '1 minute')::text))
       WHERE org_id = $1 AND user_id = $2`,
      [t.orgId, a.userId],
    );
    expect((await status(ta)).body).toMatchObject({ state: 'available' });
    expect((await saveMyHours(ta, openNow())).status).toBe(200);
    expect((await status(ta)).body).toMatchObject({ state: 'available', manual: false });
    const after = await h.owner.query(`SELECT status FROM agent_statuses WHERE org_id = $1 AND user_id = $2`, [t.orgId, a.userId]);
    expect(after.rows[0].status).toBe('online');
  });
});

describe('the plan flags', () => {
  it('without agent_status_automation: saving is 422 PLAN_FEATURE_LOCKED, reading works, a stored schedule is ignored', async () => {
    const t = await api.signup('ast9');
    await flags(t, { automation: true });
    const a = await addMember(t, 'Jo Agent', 'Agent');
    const ta = await signIn(t.slug, a.email);
    expect((await saveMyHours(ta, closedNow())).status).toBe(200);
    expect((await status(ta)).body.state).toBe('away');

    await flags(t, { automation: false, bar: false });
    const locked = await saveMyHours(ta, closedNow());
    expect(locked.status).toBe(422);
    expect(locked.body.code ?? locked.body.error?.code).toBe('PLAN_FEATURE_LOCKED');
    const read = await myHours(ta);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ entitled: false, automate: true, configured: true });
    // Automation stops at the next evaluation; the stored data is kept; manual keeps working.
    expect((await status(ta)).body).toMatchObject({
      state: 'available',
      features: { bar: false, automation: false },
    });
    expect((await setStatus(ta, 'offline')).body).toMatchObject({ state: 'away', reason: 'manual' });
    await flags(t, { automation: true });
    expect((await myHours(ta)).body.automate).toBe(true);
  });
});

describe('who may change whose hours', () => {
  it('an agent changes their own, not a colleague; a manager changes anyone; the read needs team.leave.read only', async () => {
    const t = await api.signup('ast10');
    await flags(t, {});
    const agent = await addMember(t, 'Kim Agent', 'Agent');
    const other = await addMember(t, 'Lee Agent', 'Agent');
    const manager = await addMember(t, 'Mo Manager', 'Manager');
    const viewer = await addMember(t, 'Ned Viewer', 'Viewer');
    const tAgent = await signIn(t.slug, agent.email);
    const tManager = await signIn(t.slug, manager.email);
    const tViewer = await signIn(t.slug, viewer.email);

    expect((await saveMyHours(tAgent, openNow())).status).toBe(200);
    const denied = await api.as(tAgent).put(`/v2/workspace/members/${other.uuid}/working-hours`).send(openNow());
    expect(denied.status).toBe(403);
    const ok = await api.as(tManager).put(`/v2/workspace/members/${other.uuid}/working-hours`).send(closedNow());
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ memberId: other.uuid, canEdit: true });

    // Everyone with team.leave.read sees it, but canEdit tells the UI they cannot change it.
    const read = await api.as(tAgent).get(`/v2/workspace/members/${other.uuid}/working-hours`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ canEdit: false, automate: true });
    // A Viewer has Time off for themselves (scope own), so their own hours too.
    expect((await saveMyHours(tViewer, openNow())).status).toBe(200);
    // The write through :id with your own id works for an agent too.
    expect((await api.as(tAgent).put(`/v2/workspace/members/${agent.uuid}/working-hours`).send(openNow())).status).toBe(200);
  });

  it('validates the body: a bad zone, a window with equal times', async () => {
    const t = await api.signup('ast11');
    await flags(t, {});
    const a = await addMember(t, 'Pat Agent', 'Agent');
    const ta = await signIn(t.slug, a.email);
    expect([400, 422]).toContain((await saveMyHours(ta, { ...openNow(), timezone: 'Mars/Base' })).status);
    const equal = { ...openNow(), days: week({ enabled: true, from: '09:00', to: '09:00' }) };
    expect([400, 422]).toContain((await saveMyHours(ta, equal)).status);
  });
});

describe('tenant isolation', () => {
  it("another workspace cannot read or change a member's hours", async () => {
    const t1 = await api.signup('ast12');
    const t2 = await api.signup('ast13');
    await flags(t1, {});
    await flags(t2, {});
    const a = await addMember(t1, 'Quin Agent', 'Agent');
    const ta = await signIn(t1.slug, a.email);
    expect((await saveMyHours(ta, closedNow())).status).toBe(200);
    expect((await api.as(t2.admin).get(`/v2/workspace/members/${a.uuid}/working-hours`)).status).toBe(404);
    expect((await api.as(t2.admin).put(`/v2/workspace/members/${a.uuid}/working-hours`).send(openNow())).status).toBe(404);
  });
});
