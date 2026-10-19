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
 * Member details end to end through HTTP: the phone number and the Concurrent Chat limit stored with the member (user_profiles),
 * the last login a real sign-in leaves (user_security.last_login_at), and the caller's own Available / Offline switch
 * (agent_statuses) that automatic assignment reads. The routing side is in team-inbox-routing-sla/routing-chat-limit.e2e.spec.ts.
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

let ipCounter = 120;
const ip = () => `10.88.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;

async function addMember(t: Tenant, name: string, roleName: string) {
  const email = `${name.toLowerCase().replace(/\W/g, '')}${Date.now()}${ipCounter}@example.test`;
  const role = await h.owner.query(`SELECT id FROM roles WHERE org_id = $1 AND name = $2`, [
    t.orgId,
    roleName,
  ]);
  const user = await h.owner.query(
    `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, uuid`,
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
const roleUuid = async (t: Tenant, name: string) =>
  (await h.owner.query(`SELECT uuid FROM roles WHERE org_id = $1 AND name = $2`, [t.orgId, name]))
    .rows[0].uuid as string;
const member = async (token: string, uuid: string) => {
  const res = await api.as(token).get('/v2/workspace/members?limit=100');
  expect(res.status).toBe(200);
  return (res.body.data as Array<Record<string, unknown>>).find((m) => m.id === uuid)!;
};

describe('phone and chat limit', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('mdet');
  });

  it('an invite carries the phone (E.164) and the chat limit, and the list returns them', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/workspace/members/invite')
      .send({
        fullName: 'Ashish Agent',
        email: 'ashish-det@example.test',
        roleId: await roleUuid(t, 'Agent'),
        phone: '+919876543210',
        chatLimit: 5,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.member).toMatchObject({ phone: '+919876543210', chatLimit: 5, lastLoginAt: null });
    const row = (
      await h.owner.query(
        `SELECT p.phone_e164, p.chat_limit FROM user_profiles p JOIN users u ON u.org_id = p.org_id AND u.id = p.user_id
         WHERE u.org_id = $1 AND u.email = $2`,
        [t.orgId, 'ashish-det@example.test'],
      )
    ).rows[0];
    expect(row).toMatchObject({ phone_e164: '+919876543210', chat_limit: 5 });
    expect(await member(t.admin, res.body.member.id)).toMatchObject({
      phone: '+919876543210',
      chatLimit: 5,
    });
  });

  it('an invite without them leaves both empty (no limit)', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/workspace/members/invite')
      .send({
        fullName: 'Plain Person',
        email: 'plain-det@example.test',
        roleId: await roleUuid(t, 'Agent'),
      });
    expect(res.status).toBe(201);
    expect(res.body.member).toMatchObject({ phone: null, chatLimit: null });
  });

  it('refuses a phone that is not E.164 and a limit outside 1 to 1000', async () => {
    const send = (extra: Record<string, unknown>) =>
      api
        .as(t.admin)
        .post('/v2/workspace/members/invite')
        .send({
          fullName: 'Bad Input',
          email: `bad${Math.random().toString(36).slice(2, 8)}@example.test`,
          roleId: undefined,
          ...extra,
        });
    const roleId = await roleUuid(t, 'Agent');
    for (const extra of [{ phone: '98765' }, { chatLimit: 0 }, { chatLimit: 1001 }, { chatLimit: 2.5 }]) {
      const res = await send({ roleId, ...extra });
      expect([400, 422], JSON.stringify(extra)).toContain(res.status);
    }
  });

  it('Change member sets and clears the phone and the limit, checks the version and writes an audit row', async () => {
    const target = await addMember(t, 'Tara Target', 'Agent');
    const before = await member(t.admin, target.uuid);
    expect(before).toMatchObject({ phone: null, chatLimit: null });

    const set = await api
      .as(t.admin)
      .patch(`/v2/workspace/members/${target.uuid}/details`)
      .send({ phone: '+14155550100', chatLimit: 3, rowVersion: before.rowVersion });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body).toMatchObject({ phone: '+14155550100', chatLimit: 3 });

    // the old version is stale now
    const stale = await api
      .as(t.admin)
      .patch(`/v2/workspace/members/${target.uuid}/details`)
      .send({ chatLimit: 9, rowVersion: before.rowVersion });
    expect(stale.status).toBe(409);

    const cleared = await api
      .as(t.admin)
      .patch(`/v2/workspace/members/${target.uuid}/details`)
      .send({ phone: '', chatLimit: null, rowVersion: set.body.rowVersion });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body).toMatchObject({ phone: null, chatLimit: null });

    const audits = await h.owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND record_id = $2 AND action = 'member.details_changed'`,
      [t.orgId, target.userId],
    );
    expect(audits.rows[0].n).toBe(2);
  });

  it('a body with nothing to change is refused, and the last login cannot be written', async () => {
    const target = await addMember(t, 'Nina Nochange', 'Agent');
    const m = await member(t.admin, target.uuid);
    const empty = await api
      .as(t.admin)
      .patch(`/v2/workspace/members/${target.uuid}/details`)
      .send({ rowVersion: m.rowVersion });
    expect([400, 422]).toContain(empty.status);
    const sneaky = await api
      .as(t.admin)
      .patch(`/v2/workspace/members/${target.uuid}/details`)
      .send({ chatLimit: 2, lastLoginAt: '2020-01-01T00:00:00.000Z', rowVersion: m.rowVersion });
    expect(sneaky.status).toBe(200);
    expect(sneaky.body.lastLoginAt).toBeNull();
  });

  it('needs the invite permission: an agent cannot change a colleague', async () => {
    const agent = await addMember(t, 'Alan Agent', 'Agent');
    const other = await addMember(t, 'Olga Other', 'Agent');
    const token = await signIn(t.slug, agent.email);
    const m = await member(t.admin, other.uuid);
    const res = await api
      .as(token)
      .patch(`/v2/workspace/members/${other.uuid}/details`)
      .send({ chatLimit: 1, rowVersion: m.rowVersion });
    expect(res.status).toBe(403);
  });

  it('a manager cannot change the Owner (nobody edits a member above them)', async () => {
    const mgr = await addMember(t, 'Mia Manager', 'Manager');
    const owner = (
      await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [t.adminUserId])
    ).rows[0].uuid as string;
    // The Manager preset does not hold the invite permission at all, so the key refuses first.
    const res = await api
      .as(await signIn(t.slug, mgr.email))
      .patch(`/v2/workspace/members/${owner}/details`)
      .send({ chatLimit: 1, rowVersion: 1 });
    expect(res.status).toBe(403);
  });

  it('another workspace cannot see or change the member (404)', async () => {
    const other = await api.signup('mdet2');
    const target = await addMember(t, 'Zed Foreign', 'Agent');
    const res = await api
      .as(other.admin)
      .patch(`/v2/workspace/members/${target.uuid}/details`)
      .send({ chatLimit: 1, rowVersion: 1 });
    expect(res.status).toBe(404);
  });
});

describe('last login', () => {
  it('is empty until the member signs in, then is the sign-in time', async () => {
    const t = await api.signup('mlog');
    const person = await addMember(t, 'Lena Login', 'Agent');
    expect((await member(t.admin, person.uuid)).lastLoginAt).toBeNull();

    const t0 = Date.now();
    await signIn(t.slug, person.email);
    const stamped = (await member(t.admin, person.uuid)).lastLoginAt as string;
    expect(stamped).toBeTruthy();
    expect(Math.abs(new Date(stamped).getTime() - t0)).toBeLessThan(60_000);
    const db = await h.owner.query(
      `SELECT last_login_at FROM user_security WHERE org_id = $1 AND user_id = $2`,
      [t.orgId, person.userId],
    );
    expect(new Date(db.rows[0].last_login_at).toISOString()).toBe(stamped);
  });
});

describe('my availability', () => {
  it('starts Available, goes Offline for the caller only, and the members list shows it', async () => {
    const t = await api.signup('mav');
    const a = await addMember(t, 'Ava Agent', 'Agent');
    const b = await addMember(t, 'Ben Agent', 'Agent');
    const ta = await signIn(t.slug, a.email);

    const first = await api.as(ta).get('/v2/workspace/members/me/availability');
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ status: 'online' });

    const off = await api.as(ta).put('/v2/workspace/members/me/availability').send({ status: 'offline' });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body).toEqual({ status: 'offline' });
    expect((await api.as(ta).get('/v2/workspace/members/me/availability')).body.status).toBe('offline');

    const stored = await h.owner.query(
      `SELECT user_id, status FROM agent_statuses WHERE org_id = $1 ORDER BY user_id`,
      [t.orgId],
    );
    // Only the caller's own row exists: nobody else was touched.
    expect(stored.rows).toEqual([{ user_id: String(a.userId), status: 'offline' }]);
    expect((await member(t.admin, a.uuid)).presence).toBe('offline');
    expect(b.userId).not.toBe(a.userId);

    const on = await api.as(ta).put('/v2/workspace/members/me/availability').send({ status: 'online' });
    expect(on.body).toEqual({ status: 'online' });
    expect((await member(t.admin, a.uuid)).presence).toBe('online');
  });

  it('refuses a status other than online or offline, and needs a session', async () => {
    const t = await api.signup('mav2');
    const a = await addMember(t, 'Cy Agent', 'Agent');
    const ta = await signIn(t.slug, a.email);
    const bad = await api.as(ta).put('/v2/workspace/members/me/availability').send({ status: 'busy' });
    expect([400, 422]).toContain(bad.status);
    expect((await api.http().get('/v2/workspace/members/me/availability')).status).toBe(401);
  });
});
