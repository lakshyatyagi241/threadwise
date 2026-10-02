import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MailService } from '../../../src/modules/auth';
import {
  Api,
  PASSWORD,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Workspace members and teams end to end through HTTP (WD-WSP-015..022, 046, 047): the members list, the invite by single-use
 * link and its acceptance, role changes, removal, password reset, the role model and teams, with the audit row, the outbox
 * event and the tenant isolation each write must have. One app, one database; each block works in an organization of its own.
 * The role model is RBAC's: five preset roles (Owner = system_key admin, Admin = workspace_admin, Manager, Agent, Viewer) and the
 * keys org.member.invite, org.member.role_assign and inbox.team.manage; who may grant what is WorkspaceRoleRulesService.
 * Where the port deliberately differs from WaDesk the test says so (docs/wadesk-port/parity/workspaces-teams-tenancy.md).
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

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const code = (res: { body: { code?: string } }) => res.body.code;
let ipCounter = 40;
const ip = () => `10.77.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
const count = async (sql: string, params: unknown[]) =>
  Number((await h.owner.query(sql, params)).rows[0].n);

interface Member {
  id: string;
  fullName: string;
  email: string;
  tier: string;
  roles: Array<{ id: string; name: string; tier: string }>;
  isOwner: boolean;
  status: 'active' | 'pending' | 'inactive';
  presence: string;
  joinedAt: string | null;
  invitedAt: string | null;
  teamIds: string[];
  rowVersion: number;
}
interface Team {
  id: string;
  name: string;
  color: string;
  assignmentStrategy: string;
  deviceIds: string[];
  members: Array<{ id: string; fullName: string; isLead: boolean; capacity: number }>;
  rowVersion: number;
}

/** A signed-in member holding one of the organization's roles by name (Owner, Admin, Manager, Agent, Viewer, or a custom one). */
async function addMember(
  t: Tenant,
  name: string,
  roleName: string,
): Promise<{ token: string; userId: number; uuid: string; email: string }> {
  const email =
    `${name.toLowerCase().replace(/\W/g, '')}${Date.now()}${ipCounter}@example.test`.slice(0, 60);
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
  const token = await signIn(t.slug, email, PASSWORD);
  return { token, userId, uuid: user.rows[0].uuid as string, email };
}
async function signIn(slug: string, email: string, password: string): Promise<string> {
  const res = await api
    .http()
    .post('/v2/auth/login')
    .set('x-forwarded-for', ip())
    .send({ orgSlug: slug, email, password });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body.tokens.accessToken as string;
}
async function roleId(t: Tenant, name: string): Promise<string> {
  return (
    await h.owner.query(`SELECT uuid FROM roles WHERE org_id = $1 AND name = $2`, [t.orgId, name])
  ).rows[0].uuid;
}
async function ownerUuid(t: Tenant): Promise<string> {
  return (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [t.adminUserId])).rows[0]
    .uuid;
}
async function members(
  token: string,
  qs = '',
): Promise<{
  data: Member[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
}> {
  const res = await api.as(token).get(`/v2/workspace/members${qs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}
async function invite(token: string, body: Record<string, unknown>) {
  return api.as(token).post('/v2/workspace/members/invite').send(body);
}
/** The newest mail to an address, and the link inside it. */
function mailTo(email: string) {
  const m = [...h.mail].reverse().find((x) => x.to === email);
  return {
    mail: m,
    link: m?.text.match(/https?:\/\/\S+/)?.[0] ?? '',
    token: m?.text.match(/token=([^&\s]+)/)?.[1] ?? '',
  };
}
async function createTeam(token: string, body: Record<string, unknown>) {
  return api.as(token).post('/v2/workspace/teams').send(body);
}
async function permissionsOf(token: string): Promise<Record<string, string>> {
  const res = await api.http().get('/v2/auth/session').set(bearer(token));
  expect(res.status).toBe(200);
  return res.body.permissions as Record<string, string>;
}

describe('WD-WSP-015: the members list', () => {
  let t: Tenant;
  let agent: Awaited<ReturnType<typeof addMember>>;
  let manager: Awaited<ReturnType<typeof addMember>>;

  beforeAll(async () => {
    t = await api.signup('wsp15');
    agent = await addMember(t, 'Riya Agent', 'Agent');
    manager = await addMember(t, 'Mo Manager', 'Manager');
    await addMember(t, 'Vi Viewer', 'Viewer');
  });

  it('015 #1: an admin sees every member with tier, status and joined date, and the pill counts match', async () => {
    const list = await members(t.admin);
    const owner = list.data.find((m) => m.isOwner)!;
    expect(owner).toMatchObject({ tier: 'owner', status: 'active' });
    expect(list.data.map((m) => m.tier)).toEqual(
      expect.arrayContaining(['owner', 'agent', 'manager', 'viewer']),
    );
    for (const m of list.data) {
      expect(m.id).toMatch(uuidRe);
      expect(m).not.toHaveProperty('orgId');
      expect(['online', 'away', 'busy', 'offline']).toContain(m.presence);
    }
    const summary = (await api.as(t.admin).get('/v2/workspace/members/summary')).body;
    expect(summary.counts.all).toBe(list.data.length);
    for (const tier of ['owner', 'admin', 'manager', 'agent', 'viewer', 'custom']) {
      expect(summary.counts[tier], tier).toBe(list.data.filter((m) => m.tier === tier).length);
    }
  });

  it("015 #1: the list is sorted highest role first, then by name (not WaDesk's alphabetical role strings)", async () => {
    const list = await members(t.admin);
    const rank: Record<string, number> = {
      owner: 6,
      admin: 5,
      manager: 4,
      agent: 3,
      custom: 2,
      viewer: 1,
    };
    const ranks = list.data.map((m) => rank[m.tier]!);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    const agents = list.data.filter((m) => m.tier === 'agent').map((m) => m.fullName);
    expect([...agents].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))).toEqual(
      agents,
    );
  });

  it("015 #2: an agent can read the list and sees what they may not do (the web hides the actions; WaDesk's page redirect is a UI rule)", async () => {
    expect((await members(agent.token)).data.length).toBeGreaterThan(1);
    const summary = (await api.as(agent.token).get('/v2/workspace/members/summary')).body;
    expect(summary.me).toMatchObject({
      tier: 'agent',
      canInvite: false,
      canAssignRoles: false,
      canManageTeams: false,
    });
    expect(
      summary.roles.every(
        (r: { tier: string; grantable: boolean }) =>
          r.tier === 'agent' || r.tier === 'custom' || r.tier === 'viewer' || !r.grantable,
      ),
    ).toBe(true);
    const mgr = (await api.as(manager.token).get('/v2/workspace/members/summary')).body;
    expect(mgr.me.canInvite).toBe(false);
  });

  it('015 #2: with no token the list is 401', async () => {
    expect((await api.http().get('/v2/workspace/members')).status).toBe(401);
  });

  it('015 #3: a search "riya" keeps only members whose name or email contains it, case-insensitively', async () => {
    const hits = await members(t.admin, '?q=RIYA');
    expect(hits.data.map((m) => m.fullName)).toEqual(['Riya Agent']);
    const byEmail = await members(
      t.admin,
      `?q=${encodeURIComponent(agent.email.slice(0, 8).toUpperCase())}`,
    );
    expect(byEmail.data.some((m) => m.email === agent.email)).toBe(true);
    expect((await members(t.admin, '?q=%25')).data).toHaveLength(0);
  });

  it('015 #4: a member who has not accepted yet is pending with no joined date', async () => {
    const res = await invite(t.admin, {
      fullName: 'Pen Ding',
      email: 'pending15@example.test',
      roleId: await roleId(t, 'Agent'),
    });
    expect(res.status).toBe(201);
    const row = (await members(t.admin, '?q=pending15')).data[0]!;
    expect(row).toMatchObject({ status: 'pending', joinedAt: null });
    expect(row.invitedAt).not.toBeNull();
    expect((await api.as(t.admin).get('/v2/workspace/members/summary')).body.counts.pending).toBe(
      1,
    );
  });

  it('015: filters by tier and pages with a cursor, in order, without repeats', async () => {
    expect((await members(t.admin, '?tier=manager')).data.map((m) => m.fullName)).toEqual([
      'Mo Manager',
    ]);
    const seen: string[] = [];
    let cursor = '';
    for (let i = 0; i < 10; i++) {
      const page = await members(t.admin, `?limit=2${cursor}`);
      seen.push(...page.data.map((m) => m.id));
      if (!page.page.hasMore) break;
      cursor = `&cursor=${page.page.nextCursor}`;
    }
    const all = (await members(t.admin)).data.map((m) => m.id);
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("015 (isolation): another organization's members never appear, by list or search", async () => {
    const other = await api.signup('wsp15b');
    await addMember(other, 'Zorro Other', 'Agent');
    expect((await members(t.admin, '?q=zorro')).data).toHaveLength(0);
    expect((await members(other.admin, '?q=riya')).data).toHaveLength(0);
  });

  it('015 (fixed): removed members are not listed (WaDesk listed soft-deleted users)', async () => {
    const gone = await addMember(t, 'Gone Soon', 'Agent');
    const before = (await members(t.admin)).data.length;
    expect((await api.as(t.admin).delete(`/v2/workspace/members/${gone.uuid}`)).status).toBe(204);
    expect((await members(t.admin)).data.length).toBe(before - 1);
  });
});

describe('WD-WSP-016: invite a member', () => {
  let t: Tenant;
  let agentRole: string;
  let adminNotOwner: Awaited<ReturnType<typeof addMember>>;

  beforeAll(async () => {
    t = await api.signup('wsp16');
    agentRole = await roleId(t, 'Agent');
    adminNotOwner = await addMember(t, 'Second Admin', 'Admin');
  });

  it('016 #1: an owner inviting a new email as agent creates a pending member, shows no password, mails a link and leaves audit and outbox rows', async () => {
    const mailsBefore = h.mail.length;
    const res = await invite(t.admin, {
      fullName: 'Ana Agent',
      email: 'Ana@Example.test',
      roleId: agentRole,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.emailSent).toBe(true);
    expect(res.body.inviteLink).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect(res.body.member).toMatchObject({
      email: 'ana@example.test',
      tier: 'agent',
      status: 'pending',
      joinedAt: null,
    });
    expect(res.body.member.id).toMatch(uuidRe);

    const row = (
      await h.owner.query(
        `SELECT invited_at, joined_at, status FROM users WHERE org_id = $1 AND email = 'ana@example.test'`,
        [t.orgId],
      )
    ).rows[0];
    expect(row.invited_at).not.toBeNull();
    expect(row.joined_at).toBeNull();
    expect(row.status).toBe('active');

    expect(h.mail.length).toBe(mailsBefore + 1);
    const { mail, token, link } = mailTo('ana@example.test');
    expect(mail!.subject).toMatch(/invited you to/);
    expect(link).toContain('/accept-invite');
    expect(link).toContain(`org=${t.slug}`);
    // Only the hash of the token is stored.
    expect(
      await count(
        `SELECT count(*) n FROM user_tokens WHERE org_id = $1 AND kind = 'invite' AND token_hash = $2`,
        [t.orgId, token],
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*) n FROM user_tokens WHERE org_id = $1 AND kind = 'invite' AND consumed_at IS NULL AND expires_at > now() + interval '6 days'`,
        [t.orgId],
      ),
    ).toBe(1);

    expect(await api.auditCount(t.orgId, 'members', 'member.invited')).toBe(1);
    const events = await api.events(t.orgId, 'member.invited');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ email: 'ana@example.test', roleId: agentRole });
    expect(JSON.stringify(events[0])).not.toContain(token);
  });

  it('016 #2: the same person already in another workspace is a separate account here (one login per workspace in this design); the other account is untouched', async () => {
    const other = await api.signup('wsp16o');
    const email = `shared${Date.now()}@example.test`;
    await h.owner.query(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,$2,'Shared',$3)`,
      [other.orgId, email, await hash(PASSWORD)],
    );
    const res = await invite(t.admin, {
      fullName: 'Shared Person',
      email,
      roleId: await roleId(t, 'Manager'),
    });
    expect(res.status).toBe(201);
    expect(res.body.member).toMatchObject({ status: 'pending', tier: 'manager' });
    expect(await count(`SELECT count(*) n FROM users WHERE email = $1`, [email])).toBe(2);
    expect(
      await count(
        `SELECT count(*) n FROM users WHERE email = $1 AND org_id = $2 AND joined_at IS NULL AND invited_at IS NULL`,
        [email, other.orgId],
      ),
    ).toBe(1);
  });

  it('016 #3: an admin who is not the owner cannot invite as admin (403 RBAC_ROLE_GRANT_FORBIDDEN); the owner can', async () => {
    const adminRole = await roleId(t, 'Admin');
    const denied = await invite(adminNotOwner.token, {
      fullName: 'Nope',
      email: 'nope16@example.test',
      roleId: adminRole,
    });
    expect(denied.status).toBe(403);
    expect(code(denied)).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    expect(
      await count(`SELECT count(*) n FROM users WHERE email = 'nope16@example.test'`, []),
    ).toBe(0);
    const ok = await invite(t.admin, {
      fullName: 'New Admin',
      email: 'newadmin16@example.test',
      roleId: adminRole,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.member.tier).toBe('admin');
    // An admin may invite a manager.
    expect(
      (
        await invite(adminNotOwner.token, {
          fullName: 'Mgr',
          email: 'mgr16@example.test',
          roleId: await roleId(t, 'Manager'),
        })
      ).status,
    ).toBe(201);
  });

  it("016 #4: at the plan's seat limit the answer is 422 PLAN_LIMIT_REACHED, checked before the payload (so an invalid payload reports it too); pending invitations count", async () => {
    const lim = await api.signup('wsp16l');
    const used = await count(
      `SELECT count(*) n FROM users WHERE org_id = $1 AND status <> 'inactive'`,
      [lim.orgId],
    );
    await h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb) ON CONFLICT (org_id) DO UPDATE SET overrides = $2::jsonb`,
      [lim.orgId, JSON.stringify({ limits: { users: used + 1 } })],
    );
    const first = await invite(lim.admin, {
      fullName: 'Fits',
      email: 'fits@example.test',
      roleId: await roleId(lim, 'Agent'),
    });
    expect(first.status).toBe(201);
    const full = await invite(lim.admin, {
      fullName: 'Too many',
      email: 'toomany@example.test',
      roleId: await roleId(lim, 'Agent'),
    });
    expect(full.status).toBe(422);
    expect(code(full)).toBe('PLAN_LIMIT_REACHED');
    const invalid = await invite(lim.admin, { fullName: '', email: 'not-an-email' });
    expect(invalid.status).toBe(422);
    expect(code(invalid)).toBe('PLAN_LIMIT_REACHED');
    expect(
      await count(
        `SELECT count(*) n FROM users WHERE org_id = $1 AND email = 'toomany@example.test'`,
        [lim.orgId],
      ),
    ).toBe(0);
  });

  it('016 #5: an email that is already an active or a pending member answers 409 WSP_ALREADY_MEMBER and changes nothing', async () => {
    const pending = await invite(t.admin, {
      fullName: 'Dup',
      email: 'dup16@example.test',
      roleId: agentRole,
    });
    expect(pending.status).toBe(201);
    const again = await invite(t.admin, {
      fullName: 'Dup Again',
      email: 'DUP16@example.test',
      roleId: agentRole,
    });
    expect(again.status).toBe(409);
    expect(code(again)).toBe('WSP_ALREADY_MEMBER');
    const active = await invite(t.admin, {
      fullName: 'Admin again',
      email: adminNotOwner.email,
      roleId: agentRole,
    });
    expect(active.status).toBe(409);
    expect(code(active)).toBe('WSP_ALREADY_MEMBER');
    expect(
      await count(
        `SELECT count(*) n FROM users WHERE org_id = $1 AND email = 'dup16@example.test'`,
        [t.orgId],
      ),
    ).toBe(1);
  });

  it('016 #6: with no mail transport emailSent is false and the link comes back once, and it works', async () => {
    const mail = h.app.get(MailService);
    const spy = vi.spyOn(mail, 'sendWorkspaceInvite').mockResolvedValueOnce(false);
    const res = await invite(t.admin, {
      fullName: 'No Mail',
      email: 'nomail16@example.test',
      roleId: agentRole,
    });
    spy.mockRestore();
    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(false);
    expect(res.body.inviteLink).toMatch(/\/accept-invite\?token=/);
    const token = new URL(res.body.inviteLink).searchParams.get('token')!;
    const preview = await api
      .http()
      .get(`/v2/workspace/invitations/preview?token=${token}&orgSlug=${t.slug}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ email: 'nomail16@example.test', roleName: 'Agent' });
    // It is never retrievable later: the member list carries no link.
    expect(JSON.stringify((await members(t.admin, '?q=nomail16')).data)).not.toContain(token);
  });

  it('016 (fixed): no password exists for the new account until the invitee chooses one: signing in with anything fails', async () => {
    const res = await api
      .http()
      .post('/v2/auth/login')
      .set('x-forwarded-for', ip())
      .send({ orgSlug: t.slug, email: 'ana@example.test', password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('016: an agent (no org.member.invite) cannot invite; a bad payload and an unknown role are 422 with the fields named', async () => {
    const agent = await addMember(t, 'Plain Agent', 'Agent');
    const denied = await invite(agent.token, {
      fullName: 'X',
      email: 'x16@example.test',
      roleId: agentRole,
    });
    expect(denied.status).toBe(403);
    expect(code(denied)).toBe('FORBIDDEN');
    const bad = await invite(t.admin, { fullName: 'X', email: 'bad', roleId: agentRole });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: { path: string }) => e.path)).toContain('email');
    const unknown = await invite(t.admin, {
      fullName: 'X',
      email: 'x2-16@example.test',
      roleId: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body.errors[0].path).toBe('roleId');
    // A role of another workspace is unknown here.
    const other = await api.signup('wsp16r');
    const foreign = await invite(t.admin, {
      fullName: 'X',
      email: 'x3-16@example.test',
      roleId: await roleId(other, 'Agent'),
    });
    expect(foreign.status).toBe(422);
  });

  it('016: a retried request with the same Idempotency-Key replays the answer: one member, one mail', async () => {
    const key = `invite-${Date.now()}`;
    const send = () =>
      api
        .as(t.admin)
        .post('/v2/workspace/members/invite')
        .set('idempotency-key', key)
        .send({ fullName: 'Once', email: 'once16@example.test', roleId: agentRole });
    const mails = h.mail.length;
    const first = await send();
    const second = await send();
    expect(first.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(
      await count(
        `SELECT count(*) n FROM users WHERE org_id = $1 AND email = 'once16@example.test'`,
        [t.orgId],
      ),
    ).toBe(1);
    expect(h.mail.length).toBe(mails + 1);
  });

  it('016: resending gives a fresh link and the old one stops working; a member who already joined cannot be re-invited (409 WSP_INVITE_NOT_PENDING)', async () => {
    const res = await invite(t.admin, {
      fullName: 'Resend Me',
      email: 'resend16@example.test',
      roleId: agentRole,
    });
    const id = res.body.member.id as string;
    const oldToken = mailTo('resend16@example.test').token;
    const again = await api.as(t.admin).post(`/v2/workspace/members/${id}/resend-invite`).send();
    expect(again.status).toBe(200);
    expect(again.body.emailSent).toBe(true);
    const newToken = mailTo('resend16@example.test').token;
    expect(newToken).not.toBe(oldToken);
    expect(
      (
        await api
          .http()
          .get(`/v2/workspace/invitations/preview?token=${oldToken}&orgSlug=${t.slug}`)
      ).status,
    ).toBe(400);
    expect(
      (
        await api
          .http()
          .get(`/v2/workspace/invitations/preview?token=${newToken}&orgSlug=${t.slug}`)
      ).status,
    ).toBe(200);
    expect(await api.auditCount(t.orgId, 'members', 'member.invite_resent')).toBeGreaterThanOrEqual(
      1,
    );
    const joined = await api
      .as(t.admin)
      .post(`/v2/workspace/members/${adminNotOwner.uuid}/resend-invite`)
      .send();
    expect(joined.status).toBe(409);
    expect(code(joined)).toBe('WSP_INVITE_NOT_PENDING');
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/workspace/members/00000000-0000-4000-8000-000000000000/resend-invite`)
          .send()
      ).status,
    ).toBe(404);
  });
});

describe('WD-WSP-021: accepting an invitation is the activation (WaDesk activated pending members on login)', () => {
  let t: Tenant;
  const email = 'joiner21@example.test';
  let token: string;

  beforeAll(async () => {
    t = await api.signup('wsp21');
    const res = await invite(t.admin, {
      fullName: 'Join Er',
      email,
      roleId: await roleId(t, 'Manager'),
    });
    expect(res.status).toBe(201);
    token = mailTo(email).token;
  });

  it('021 #1: the preview names the workspace, the invitee, the role and the inviter without using the token up', async () => {
    const res = await api
      .http()
      .get(`/v2/workspace/invitations/preview?token=${token}&orgSlug=${t.slug}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email,
      fullName: 'Join Er',
      roleName: 'Manager',
      invitedBy: 'Admin Person',
    });
    expect(
      (await api.http().get(`/v2/workspace/invitations/preview?token=${token}&orgSlug=${t.slug}`))
        .status,
    ).toBe(200);
  });

  it('021 #2: a password the policy refuses does not burn the invitation', async () => {
    const res = await api
      .http()
      .post('/v2/workspace/invitations/accept')
      .set('x-forwarded-for', ip())
      .send({ token, orgSlug: t.slug, password: 'password' });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('AUTH_PASSWORD_POLICY');
    expect(
      (await api.http().get(`/v2/workspace/invitations/preview?token=${token}&orgSlug=${t.slug}`))
        .status,
    ).toBe(200);
  });

  it('021 #3: accepting sets the password, joins the member, verifies the address and answers with the signed-in session', async () => {
    const res = await api
      .http()
      .post('/v2/workspace/invitations/accept')
      .set('x-forwarded-for', ip())
      .send({ token, orgSlug: t.slug, password: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'authenticated', orgSlug: t.slug });
    expect(res.body.tokens.accessToken).toBeTruthy();
    const row = (
      await h.owner.query(
        `SELECT u.joined_at, s.email_verified_at FROM users u JOIN user_security s ON s.org_id = u.org_id AND s.user_id = u.id WHERE u.org_id = $1 AND u.email = $2`,
        [t.orgId, email],
      )
    ).rows[0];
    expect(row.joined_at).not.toBeNull();
    expect(row.email_verified_at).not.toBeNull();
    const session = await api
      .http()
      .get('/v2/auth/session')
      .set(bearer(res.body.tokens.accessToken));
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe(email);
    expect(session.body.roles.map((r: { name: string }) => r.name)).toEqual(['Manager']);
    expect(await api.auditCount(t.orgId, 'members', 'member.joined')).toBe(1);
    expect(await api.events(t.orgId, 'member.joined')).toHaveLength(1);
    // The same address and password now sign in normally, and the list shows the member active.
    await signIn(t.slug, email, PASSWORD);
    expect((await members(t.admin, '?q=joiner21')).data[0]).toMatchObject({ status: 'active' });
    expect((await members(t.admin, '?q=joiner21')).data[0]!.joinedAt).not.toBeNull();
  });

  it('021 #4: the link works once: a second use answers the same 400 as a wrong token', async () => {
    const again = await api
      .http()
      .post('/v2/workspace/invitations/accept')
      .set('x-forwarded-for', ip())
      .send({ token, orgSlug: t.slug, password: PASSWORD });
    expect(again.status).toBe(400);
    expect(code(again)).toBe('WSP_INVITE_INVALID');
    const wrong = await api
      .http()
      .post('/v2/workspace/invitations/accept')
      .set('x-forwarded-for', ip())
      .send({ token: `${token}zzzz`, orgSlug: t.slug, password: PASSWORD });
    expect(wrong.status).toBe(400);
    expect(wrong.body.detail).toBe(again.body.detail);
  });

  it("021: an expired link, another workspace's slug, an unknown workspace and a suspended workspace all answer the same WSP_INVITE_INVALID", async () => {
    const other = await api.signup('wsp21x');
    await invite(t.admin, {
      fullName: 'Late',
      email: 'late21@example.test',
      roleId: await roleId(t, 'Agent'),
    });
    const late = mailTo('late21@example.test').token;
    const get = (tok: string, slug: string) =>
      api.http().get(`/v2/workspace/invitations/preview?token=${tok}&orgSlug=${slug}`);
    const results = [await get(late, other.slug), await get(late, 'no-such-workspace')];
    await h.owner.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [t.orgId]);
    results.push(await get(late, t.slug));
    await h.owner.query(`UPDATE organizations SET status = 'active' WHERE id = $1`, [t.orgId]);
    await h.owner.query(
      `UPDATE user_tokens SET expires_at = now() - interval '1 minute' WHERE org_id = $1 AND consumed_at IS NULL AND kind = 'invite'`,
      [t.orgId],
    );
    results.push(await get(late, t.slug));
    for (const r of results) {
      expect(r.status).toBe(400);
      expect(code(r)).toBe('WSP_INVITE_INVALID');
    }
    expect(new Set(results.map((r) => r.body.detail)).size).toBe(1);
  });

  it("021: a removed member's open invitation stops working", async () => {
    const res = await invite(t.admin, {
      fullName: 'Changed Mind',
      email: 'changed21@example.test',
      roleId: await roleId(t, 'Agent'),
    });
    const tok = mailTo('changed21@example.test').token;
    expect(
      (await api.as(t.admin).delete(`/v2/workspace/members/${res.body.member.id}`)).status,
    ).toBe(204);
    const accept = await api
      .http()
      .post('/v2/workspace/invitations/accept')
      .set('x-forwarded-for', ip())
      .send({ token: tok, orgSlug: t.slug, password: PASSWORD });
    expect(accept.status).toBe(400);
    expect(code(accept)).toBe('WSP_INVITE_INVALID');
  });

  it('021: guests are rate limited per address (429) so tokens cannot be probed', async () => {
    const same = ip();
    let last = 0;
    for (let i = 0; i < 25; i++) {
      const res = await api
        .http()
        .get(`/v2/workspace/invitations/preview?token=${'a'.repeat(20)}${i}&orgSlug=${t.slug}`)
        .set('x-forwarded-for', same);
      last = res.status;
      if (last === 429) {
        expect(code(res)).toBe('RATE_LIMITED');
        break;
      }
    }
    expect(last).toBe(429);
  });
});

describe("WD-WSP-017: change a member's role", () => {
  let t: Tenant;
  let agent: Awaited<ReturnType<typeof addMember>>;
  let adminNotOwner: Awaited<ReturnType<typeof addMember>>;
  let manager: Awaited<ReturnType<typeof addMember>>;
  let viewer: Awaited<ReturnType<typeof addMember>>;

  const rowOf = async (token: string, uuid: string) =>
    (await members(token)).data.find((m) => m.id === uuid)!;
  const change = (token: string, uuid: string, roleUuid: string, rowVersion: number) =>
    api
      .as(token)
      .patch(`/v2/workspace/members/${uuid}/role`)
      .send({ roleId: roleUuid, rowVersion });

  beforeAll(async () => {
    t = await api.signup('wsp17');
    agent = await addMember(t, 'Ava Agent', 'Agent');
    adminNotOwner = await addMember(t, 'Second Admin', 'Admin');
    manager = await addMember(t, 'Mia Manager', 'Manager');
    viewer = await addMember(t, 'Vic Viewer', 'Viewer');
  });

  it("017 #1: an owner sets an agent to manager: the role set is replaced, the answer carries the new tier and version, audit and outbox rows exist, and the grants apply on the member's next request", async () => {
    expect((await permissionsOf(agent.token))['record.contacts.read']).toBe('own');
    const before = await rowOf(t.admin, agent.uuid);
    const res = await change(t.admin, agent.uuid, await roleId(t, 'Manager'), before.rowVersion);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ tier: 'manager', rowVersion: before.rowVersion + 1 });
    expect(res.body.roles.map((r: { name: string }) => r.name)).toEqual(['Manager']);
    expect(
      await count(`SELECT count(*) n FROM user_roles WHERE org_id = $1 AND user_id = $2`, [
        t.orgId,
        agent.userId,
      ]),
    ).toBe(1);
    expect(await api.auditCount(t.orgId, 'members', 'member.role_changed')).toBe(1);
    const events = await api.events(t.orgId, 'member.role_changed');
    expect(events[0]).toMatchObject({ uuid: agent.uuid, roleId: await roleId(t, 'Manager') });
    expect((await permissionsOf(agent.token))['record.contacts.read']).toBe('all');
  });

  it('017 #2: changing your own role is 422 RBAC_SELF_ROLE_CHANGE', async () => {
    const me = (await members(adminNotOwner.token)).data.find((m) => m.id === adminNotOwner.uuid)!;
    const res = await change(
      adminNotOwner.token,
      adminNotOwner.uuid,
      await roleId(t, 'Viewer'),
      me.rowVersion,
    );
    expect(res.status).toBe(422);
    expect(code(res)).toBe('RBAC_SELF_ROLE_CHANGE');
  });

  it('017 #3: an admin who is not the owner cannot set a member to admin (403 RBAC_ROLE_GRANT_FORBIDDEN)', async () => {
    const v = await rowOf(t.admin, viewer.uuid);
    const res = await change(
      adminNotOwner.token,
      viewer.uuid,
      await roleId(t, 'Admin'),
      v.rowVersion,
    );
    expect(res.status).toBe(403);
    expect(code(res)).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    expect((await rowOf(t.admin, viewer.uuid)).tier).toBe('viewer');
    // The owner can.
    expect(
      (await change(t.admin, viewer.uuid, await roleId(t, 'Admin'), v.rowVersion)).body.tier,
    ).toBe('admin');
  });

  it('017 #4 (intended difference): an admin demoting the owner is refused (WaDesk allowed it): 403 RBAC_ROLE_GRANT_FORBIDDEN, the owner keeps their role', async () => {
    const owner = await rowOf(t.admin, await ownerUuid(t));
    const res = await change(
      adminNotOwner.token,
      owner.id,
      await roleId(t, 'Viewer'),
      owner.rowVersion,
    );
    expect(res.status).toBe(403);
    expect(code(res)).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    expect((await rowOf(t.admin, owner.id)).tier).toBe('owner');
    expect(
      await count(
        `SELECT count(*) n FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id WHERE ur.org_id = $1 AND ur.user_id = $2 AND r.system_key = 'admin'`,
        [t.orgId, t.adminUserId],
      ),
    ).toBe(1);
  });

  it('017 (intended difference): Owner is a role an Owner can hand to someone, and take away again; the organization never has none', async () => {
    const second = await addMember(t, 'Second Owner', 'Agent');
    const row = await rowOf(t.admin, second.uuid);
    const promoted = await change(t.admin, second.uuid, await roleId(t, 'Owner'), row.rowVersion);
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
    expect(promoted.body).toMatchObject({ tier: 'owner', isOwner: true });
    expect((await members(t.admin)).data.filter((m) => m.isOwner)).toHaveLength(2);
    // An Admin cannot hand it out (owner-only grant), and the new Owner cannot demote themselves.
    expect(
      code(
        await change(
          adminNotOwner.token,
          agent.uuid,
          await roleId(t, 'Owner'),
          (await rowOf(t.admin, agent.uuid)).rowVersion,
        ),
      ),
    ).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    expect(
      code(
        await change(second.token, second.uuid, await roleId(t, 'Agent'), promoted.body.rowVersion),
      ),
    ).toBe('RBAC_SELF_ROLE_CHANGE');
    // The original Owner demotes them again; one Owner is left and stays.
    const demoted = await change(
      t.admin,
      second.uuid,
      await roleId(t, 'Agent'),
      promoted.body.rowVersion,
    );
    expect(demoted.status, JSON.stringify(demoted.body)).toBe(200);
    expect(demoted.body).toMatchObject({ tier: 'agent', isOwner: false });
    expect((await members(t.admin)).data.filter((m) => m.isOwner)).toHaveLength(1);
  });

  it('017 (fixed): nobody acts on a member who outranks them (403 WSP_CANNOT_ACT_ON_HIGHER_RANK on remove and reset, RBAC_ROLE_GRANT_FORBIDDEN on a role change); equal rank is fine', async () => {
    // A custom role holding both keys ranks below every preset (RBAC's ladder), so it may act on custom-role members only.
    const lowAdmin = await api.member(t, 'rolemgr', [
      ['org.member.role_assign'],
      ['org.member.invite'],
      ['record.contacts.read'],
    ]);
    const m = await rowOf(t.admin, manager.uuid);
    const res = await change(lowAdmin.token, manager.uuid, await roleId(t, 'Agent'), m.rowVersion);
    expect(res.status).toBe(403);
    expect(code(res)).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    const removal = await api.as(lowAdmin.token).delete(`/v2/workspace/members/${manager.uuid}`);
    expect(removal.status).toBe(403);
    expect(code(removal)).toBe('WSP_CANNOT_ACT_ON_HIGHER_RANK');
    const reset = await api
      .as(lowAdmin.token)
      .post(`/v2/workspace/members/${manager.uuid}/reset-password`)
      .send();
    expect(reset.status).toBe(403);
    expect(code(reset)).toBe('WSP_CANNOT_ACT_ON_HIGHER_RANK');
    // Even an Agent outranks it.
    const peerAgent = await addMember(t, 'Peer Agent', 'Agent');
    const pa = await rowOf(t.admin, peerAgent.uuid);
    expect(
      code(await change(lowAdmin.token, peerAgent.uuid, await roleId(t, 'Viewer'), pa.rowVersion)),
    ).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    // A member holding a custom role is its equal: it may change them to a custom role it fully holds, and remove them.
    const peer = await api.member(t, 'peercustom', [['record.contacts.read']]);
    const peerUuid = (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [peer.userId]))
      .rows[0].uuid as string;
    const held = (
      await h.owner.query(
        `INSERT INTO roles (org_id, name) VALUES ($1,'Observer') RETURNING uuid, id`,
        [t.orgId],
      )
    ).rows[0];
    await h.owner.query(
      `INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope) VALUES ($1,$2,'record.contacts.read','allow','all')`,
      [t.orgId, held.id],
    );
    const p = await rowOf(t.admin, peerUuid);
    expect((await change(lowAdmin.token, peerUuid, held.uuid, p.rowVersion)).status).toBe(200);
    // It may not hand out a role above its own.
    const up = await change(
      lowAdmin.token,
      peerUuid,
      await roleId(t, 'Viewer'),
      (await rowOf(t.admin, peerUuid)).rowVersion,
    );
    expect(up.status).toBe(403);
    expect(code(up)).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    expect((await api.as(lowAdmin.token).delete(`/v2/workspace/members/${peerUuid}`)).status).toBe(
      204,
    );
  });

  it('017: a stale rowVersion is 409 ROW_VERSION_CONFLICT and changes nothing', async () => {
    const m = await rowOf(t.admin, manager.uuid);
    const res = await change(t.admin, manager.uuid, await roleId(t, 'Agent'), m.rowVersion + 10);
    expect(res.status).toBe(409);
    expect(code(res)).toBe('ROW_VERSION_CONFLICT');
    expect((await rowOf(t.admin, manager.uuid)).tier).toBe('manager');
  });

  it('017: without org.member.role_assign it is 403; an unknown member, a member of another workspace and an unknown role are 404 / 404 / 422', async () => {
    const m = await rowOf(t.admin, manager.uuid);
    const denied = await change(
      manager.token,
      manager.uuid,
      await roleId(t, 'Agent'),
      m.rowVersion,
    );
    expect(denied.status).toBe(403);
    const other = await api.signup('wsp17o');
    const foreign = await addMember(other, 'Foreign', 'Agent');
    expect((await change(t.admin, foreign.uuid, await roleId(t, 'Agent'), 1)).status).toBe(404);
    expect(
      (await change(t.admin, '00000000-0000-4000-8000-000000000000', await roleId(t, 'Agent'), 1))
        .status,
    ).toBe(404);
    expect(
      (await change(t.admin, manager.uuid, '00000000-0000-4000-8000-000000000000', m.rowVersion))
        .status,
    ).toBe(422);
    expect(
      (await change(t.admin, manager.uuid, await roleId(other, 'Agent'), m.rowVersion)).status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .patch(`/v2/workspace/members/${manager.uuid}/role`)
          .send({ roleId: await roleId(t, 'Agent') })
      ).status,
    ).toBe(422);
  });
});

describe('WD-WSP-018 and WD-WSP-047: remove a member (soft), and invite the address again', () => {
  let t: Tenant;

  beforeAll(async () => {
    t = await api.signup('wsp18');
  });

  it('018 #1: removing an agent who is in two teams deletes the roles and both team places, ends their sessions at once, and leaves audit and outbox rows', async () => {
    const agent = await addMember(t, 'Team Agent', 'Agent');
    const teamA = await createTeam(t.admin, { name: 'Sales18', memberIds: [agent.uuid] });
    const teamB = await createTeam(t.admin, { name: 'Support18', memberIds: [agent.uuid] });
    expect(teamA.status).toBe(201);
    expect(teamB.status).toBe(201);
    expect((await api.as(agent.token).get('/v2/workspace/members')).status).toBe(200);

    const res = await api.as(t.admin).delete(`/v2/workspace/members/${agent.uuid}`);
    expect(res.status).toBe(204);
    expect(
      await count(`SELECT count(*) n FROM team_members WHERE org_id = $1 AND user_id = $2`, [
        t.orgId,
        agent.userId,
      ]),
    ).toBe(0);
    expect(
      await count(`SELECT count(*) n FROM user_roles WHERE org_id = $1 AND user_id = $2`, [
        t.orgId,
        agent.userId,
      ]),
    ).toBe(0);
    expect(
      (await h.owner.query(`SELECT status FROM users WHERE id = $1`, [agent.userId])).rows[0]
        .status,
    ).toBe('inactive');
    expect(await api.auditCount(t.orgId, 'members', 'member.removed')).toBeGreaterThanOrEqual(1);
    const events = await api.events(t.orgId, 'member.removed');
    expect(events.some((e) => e.uuid === agent.uuid)).toBe(true);
    // Access ends now: the token that was valid a moment ago is refused, and signing in again is too.
    expect((await api.as(agent.token).get('/v2/workspace/members')).status).toBe(401);
    const login = await api
      .http()
      .post('/v2/auth/login')
      .set('x-forwarded-for', ip())
      .send({ orgSlug: t.slug, email: agent.email, password: PASSWORD });
    expect(login.status).toBeGreaterThanOrEqual(400);
    // The teams keep working without them.
    const teams = (await api.as(t.admin).get('/v2/workspace/teams')).body.data as Team[];
    expect(teams.every((x) => x.members.every((m) => m.id !== agent.uuid))).toBe(true);
    // The account itself is kept (history and references stay).
    expect(await count(`SELECT count(*) n FROM users WHERE id = $1`, [agent.userId])).toBe(1);
  });

  it('018 #2: removing yourself is 422 WSP_CANNOT_REMOVE_SELF and removing the owner is 422 WSP_CANNOT_REMOVE_OWNER; nothing changes', async () => {
    const admin2 = await addMember(t, 'Other Admin', 'Admin');
    const self = await api.as(admin2.token).delete(`/v2/workspace/members/${admin2.uuid}`);
    expect(self.status).toBe(422);
    expect(code(self)).toBe('WSP_CANNOT_REMOVE_SELF');
    const ownerRes = await api
      .as(admin2.token)
      .delete(`/v2/workspace/members/${await ownerUuid(t)}`);
    expect(ownerRes.status).toBe(422);
    expect(code(ownerRes)).toBe('WSP_CANNOT_REMOVE_OWNER');
    const meRes = await api.as(t.admin).delete(`/v2/workspace/members/${await ownerUuid(t)}`);
    expect(code(meRes)).toBe('WSP_CANNOT_REMOVE_SELF');
    expect((await members(t.admin)).data.some((m) => m.isOwner)).toBe(true);
  });

  it('018 #3: a manager (no org.member.invite) cannot remove: 403', async () => {
    const manager = await addMember(t, 'Mgr18', 'Manager');
    const target = await addMember(t, 'Target18', 'Agent');
    const res = await api.as(manager.token).delete(`/v2/workspace/members/${target.uuid}`);
    expect(res.status).toBe(403);
    expect((await members(t.admin, '?q=Target18')).data).toHaveLength(1);
  });

  it('018 (fixed): removing someone who is not a member, a member of another workspace or someone already removed is 404 (WaDesk answered ok)', async () => {
    const other = await api.signup('wsp18o');
    const foreign = await addMember(other, 'Foreign18', 'Agent');
    expect((await api.as(t.admin).delete(`/v2/workspace/members/${foreign.uuid}`)).status).toBe(
      404,
    );
    expect(
      (await api.as(t.admin).delete(`/v2/workspace/members/00000000-0000-4000-8000-000000000000`))
        .status,
    ).toBe(404);
    const gone = await addMember(t, 'Twice18', 'Agent');
    expect((await api.as(t.admin).delete(`/v2/workspace/members/${gone.uuid}`)).status).toBe(204);
    expect((await api.as(t.admin).delete(`/v2/workspace/members/${gone.uuid}`)).status).toBe(404);
    expect(
      await count(`SELECT count(*) n FROM users WHERE id = $1 AND status = 'active'`, [
        foreign.userId,
      ]),
    ).toBe(1);
  });

  it('018 #4 / 047 #2: the same person can be invited again: the removed account is reactivated as a fresh pending invitation (no duplicate email row), with no old password, roles or second factor', async () => {
    const back = await addMember(t, 'Comes Back', 'Admin');
    await h.owner.query(
      `UPDATE user_security SET mfa_enabled = true, mfa_secret_enc = 'x' WHERE org_id = $1 AND user_id = $2`,
      [t.orgId, back.userId],
    );
    expect((await api.as(t.admin).delete(`/v2/workspace/members/${back.uuid}`)).status).toBe(204);
    const res = await invite(t.admin, {
      fullName: 'Comes Back Again',
      email: back.email,
      roleId: await roleId(t, 'Viewer'),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.member).toMatchObject({
      id: back.uuid,
      status: 'pending',
      tier: 'viewer',
      fullName: 'Comes Back Again',
    });
    expect(
      await count(`SELECT count(*) n FROM users WHERE org_id = $1 AND email = $2`, [
        t.orgId,
        back.email,
      ]),
    ).toBe(1);
    const login = await api
      .http()
      .post('/v2/auth/login')
      .set('x-forwarded-for', ip())
      .send({ orgSlug: t.slug, email: back.email, password: PASSWORD });
    expect(login.status).toBe(401);
    expect(
      (
        await h.owner.query(`SELECT mfa_enabled FROM user_security WHERE user_id = $1`, [
          back.userId,
        ])
      ).rows[0].mfa_enabled,
    ).toBe(false);
    const tok = mailTo(back.email).token;
    const accepted = await api
      .http()
      .post('/v2/workspace/invitations/accept')
      .set('x-forwarded-for', ip())
      .send({ token: tok, orgSlug: t.slug, password: 'An0ther#Passw0rd' });
    expect(accepted.status).toBe(201);
  });

  it('018: a member removed while an access token is still unexpired cannot use it, even for reads', async () => {
    const m = await addMember(t, 'Token18', 'Viewer');
    expect((await api.as(m.token).get('/v2/workspace/teams')).status).toBe(200);
    await api.as(t.admin).delete(`/v2/workspace/members/${m.uuid}`);
    expect((await api.as(m.token).get('/v2/workspace/teams')).status).toBe(401);
  });
});

describe("WD-WSP-019: reset a member's password", () => {
  let t: Tenant;
  let adminNotOwner: Awaited<ReturnType<typeof addMember>>;

  beforeAll(async () => {
    t = await api.signup('wsp19');
    adminNotOwner = await addMember(t, 'Admin19', 'Admin');
  });

  it('019 #1: an admin resets an agent: a set-password link is emailed, no password is shown anywhere, the link works once and the old password stops working only then; audit and outbox rows exist', async () => {
    const agent = await addMember(t, 'Agent19', 'Agent');
    const res = await api
      .as(adminNotOwner.token)
      .post(`/v2/workspace/members/${agent.uuid}/reset-password`)
      .send();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ emailSent: true, inviteLink: null });
    expect(res.body.member.id).toBe(agent.uuid);
    expect(JSON.stringify(res.body)).not.toMatch(/temp|password"/i);
    const { link, token, mail } = mailTo(agent.email);
    expect(mail!.subject).toMatch(/password/i);
    expect(link).toContain('/reset-password');
    expect(link).toContain(`org=${t.slug}`);
    expect(await api.auditCount(t.orgId, 'members', 'member.password_reset')).toBe(1);
    expect((await api.events(t.orgId, 'member.password_reset'))[0]).toMatchObject({
      uuid: agent.uuid,
    });

    // WaDesk replaced the password on the spot; here it changes when the member uses the link.
    await signIn(t.slug, agent.email, PASSWORD);
    const set = await api
      .http()
      .post('/v2/auth/reset-password')
      .send({ orgSlug: t.slug, token, password: 'Fresh#Passw0rd9' });
    expect(set.status, JSON.stringify(set.body)).toBeLessThan(300);
    const old = await api
      .http()
      .post('/v2/auth/login')
      .set('x-forwarded-for', ip())
      .send({ orgSlug: t.slug, email: agent.email, password: PASSWORD });
    expect(old.status).toBe(401);
    await signIn(t.slug, agent.email, 'Fresh#Passw0rd9');
    const reuse = await api
      .http()
      .post('/v2/auth/reset-password')
      .send({ orgSlug: t.slug, token, password: 'Fresh#Passw0rd9x' });
    expect(reuse.status).toBe(400);
  });

  it('019 #2: when the target is the owner and the caller is an admin it is 403; the owner may reset their own password link', async () => {
    const res = await api
      .as(adminNotOwner.token)
      .post(`/v2/workspace/members/${await ownerUuid(t)}/reset-password`)
      .send();
    expect(res.status).toBe(403);
    expect(code(res)).toBe('WSP_CANNOT_ACT_ON_HIGHER_RANK');
    const own = await api
      .as(t.admin)
      .post(`/v2/workspace/members/${await ownerUuid(t)}/reset-password`)
      .send();
    expect(own.status).toBe(200);
  });

  it('019 #3: a user who is not in this workspace is 404 (and a manager without org.member.invite is 403)', async () => {
    const other = await api.signup('wsp19o');
    const foreign = await addMember(other, 'Foreign19', 'Agent');
    expect(
      (await api.as(t.admin).post(`/v2/workspace/members/${foreign.uuid}/reset-password`).send())
        .status,
    ).toBe(404);
    const manager = await addMember(t, 'Mgr19', 'Manager');
    expect(
      (
        await api
          .as(manager.token)
          .post(`/v2/workspace/members/${adminNotOwner.uuid}/reset-password`)
          .send()
      ).status,
    ).toBe(403);
  });

  it('019: with no mail transport the link comes back once instead; a member who never accepted gets a fresh invitation instead of a reset', async () => {
    const agent = await addMember(t, 'Agent19b', 'Agent');
    const mail = h.app.get(MailService);
    const spy = vi.spyOn(mail, 'sendPasswordReset').mockResolvedValueOnce(false);
    const res = await api
      .as(t.admin)
      .post(`/v2/workspace/members/${agent.uuid}/reset-password`)
      .send();
    spy.mockRestore();
    expect(res.body.emailSent).toBe(false);
    expect(res.body.inviteLink).toContain('/reset-password?');

    const invited = await invite(t.admin, {
      fullName: 'Never Joined',
      email: 'neverjoined19@example.test',
      roleId: await roleId(t, 'Agent'),
    });
    const old = mailTo('neverjoined19@example.test').token;
    const reset = await api
      .as(t.admin)
      .post(`/v2/workspace/members/${invited.body.member.id}/reset-password`)
      .send();
    expect(reset.status).toBe(200);
    const fresh = mailTo('neverjoined19@example.test');
    expect(fresh.link).toContain('/accept-invite');
    expect(fresh.token).not.toBe(old);
  });
});

describe('WD-WSP-020: the role model, the permission matrix and the role gates', () => {
  let t: Tenant;

  beforeAll(async () => {
    t = await api.signup('wsp20');
  });

  it('020: a new organization gets the five RBAC presets: Owner (locked, system_key admin), Admin, Manager, Agent and Viewer', async () => {
    const roles = (
      await h.owner.query(
        `SELECT name, system_key, is_locked FROM roles WHERE org_id = $1 AND system_key IS NOT NULL ORDER BY name`,
        [t.orgId],
      )
    ).rows;
    expect(roles).toEqual([
      { name: 'Admin', system_key: 'workspace_admin', is_locked: false },
      { name: 'Agent', system_key: 'agent', is_locked: false },
      { name: 'Manager', system_key: 'manager', is_locked: false },
      { name: 'Owner', system_key: 'admin', is_locked: true },
      { name: 'Viewer', system_key: 'viewer', is_locked: false },
    ]);
    const holders = async (key: string) =>
      (
        await h.owner.query(
          `SELECT r.name FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id WHERE g.org_id = $1 AND g.permission_key = $2 ORDER BY r.name`,
          [t.orgId, key],
        )
      ).rows.map((x) => x.name);
    for (const key of ['org.member.invite', 'org.member.role_assign', 'inbox.team.manage']) {
      expect(await holders(key), key).toEqual(['Admin', 'Owner']);
    }
  });

  it('020 #1: an agent can reply to conversations but not assign them, and holds none of the member or team keys', async () => {
    const agent = await addMember(t, 'Agent20', 'Agent');
    const perms = await permissionsOf(agent.token);
    expect(perms['inbox.conversation.reply']).toBe('all');
    for (const k of [
      'org.member.invite',
      'org.member.role_assign',
      'inbox.team.manage',
      'inbox.conversation.assign',
    ]) {
      expect(perms[k], k).toBeUndefined();
    }
  });

  it('020 #2: an admin holds the member and team keys; a manager holds none of them but sees every record', async () => {
    const admin = await addMember(t, 'Admin20', 'Admin');
    const manager = await addMember(t, 'Manager20', 'Manager');
    const adminPerms = await permissionsOf(admin.token);
    const keys = ['org.member.invite', 'org.member.role_assign', 'inbox.team.manage'];
    for (const k of keys) expect(adminPerms[k], k).toBe('all');
    // The owner-only keys stay with the Owner.
    expect(adminPerms['org.delete']).toBeUndefined();
    const mgrPerms = await permissionsOf(manager.token);
    for (const k of keys) expect(mgrPerms[k], k).toBeUndefined();
    expect(mgrPerms['record.contacts.read']).toBe('all');
    expect(mgrPerms['record.contacts.delete']).toBe('all');
    expect(mgrPerms['inbox.conversation.assign']).toBe('all');
  });

  it('020 #3: a viewer can only read: every key they hold is a read key', async () => {
    const viewer = await addMember(t, 'Viewer20', 'Viewer');
    const perms = await permissionsOf(viewer.token);
    expect(Object.keys(perms).length).toBeGreaterThan(0);
    for (const k of Object.keys(perms)) expect(k.endsWith('.read'), k).toBe(true);
    expect((await createTeam(viewer.token, { name: 'Nope20' })).status).toBe(403);
    expect(
      (
        await invite(viewer.token, {
          fullName: 'X',
          email: 'x20@example.test',
          roleId: await roleId(t, 'Agent'),
        })
      ).status,
    ).toBe(403);
  });

  it('020 #5: the roles a caller may grant (RBAC ladder): an Owner every role, an Admin all but Owner and Admin, nobody without org.member.role_assign', async () => {
    const grantable = (summary: { roles: Array<{ name: string; grantable: boolean }> }) =>
      summary.roles
        .filter((r) => r.grantable)
        .map((r) => r.name)
        .sort();
    const ownerSummary = (await api.as(t.admin).get('/v2/workspace/members/summary')).body;
    expect(grantable(ownerSummary)).toEqual(['Admin', 'Agent', 'Manager', 'Owner', 'Viewer']);
    expect(ownerSummary.me).toMatchObject({
      tier: 'owner',
      canInvite: true,
      canAssignRoles: true,
      canManageTeams: true,
    });
    const admin = await addMember(t, 'Admin20b', 'Admin');
    const adminSummary = (await api.as(admin.token).get('/v2/workspace/members/summary')).body;
    expect(grantable(adminSummary)).toEqual(['Agent', 'Manager', 'Viewer']);
    expect(adminSummary.me).toMatchObject({
      tier: 'admin',
      canInvite: true,
      canAssignRoles: true,
      canManageTeams: true,
    });
    const agent = await addMember(t, 'Agent20b', 'Agent');
    const agentSummary = (await api.as(agent.token).get('/v2/workspace/members/summary')).body;
    expect(grantable(agentSummary)).toEqual([]);
    expect(agentSummary.me).toMatchObject({
      tier: 'agent',
      canInvite: false,
      canAssignRoles: false,
      canManageTeams: false,
    });
    expect(adminSummary.seats.used).toBeGreaterThan(1);
    // The roles come highest first, the Owner preset on top.
    expect(ownerSummary.roles[0]).toMatchObject({ name: 'Owner', tier: 'owner' });
    expect(ownerSummary.roles.map((r: { tier: string }) => r.tier).slice(0, 5)).toEqual([
      'owner',
      'admin',
      'manager',
      'agent',
      'viewer',
    ]);
  });
});

describe('WD-WSP-022: teams', () => {
  let t: Tenant;
  let ava: Awaited<ReturnType<typeof addMember>>;
  let ben: Awaited<ReturnType<typeof addMember>>;

  beforeAll(async () => {
    t = await api.signup('wsp22');
    ava = await addMember(t, 'Ava Team', 'Agent');
    ben = await addMember(t, 'Ben Team', 'Agent');
  });

  it('022 #1: an admin creates a team with a name, a colour and two members: a unique slug, two member places, defaults, audit and outbox rows', async () => {
    const res = await createTeam(t.admin, {
      name: 'Sales',
      color: '#ff0000',
      memberIds: [ava.uuid, ben.uuid],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const team = res.body as Team;
    expect(team).toMatchObject({
      name: 'Sales',
      color: '#ff0000',
      assignmentStrategy: 'manual',
      deviceIds: [],
      rowVersion: 1,
    });
    expect(team.id).toMatch(uuidRe);
    expect(team.members.map((m) => m.fullName).sort()).toEqual(['Ava Team', 'Ben Team']);
    expect(team.members.every((m) => m.isLead === false && m.capacity === 20)).toBe(true);
    expect(
      await count(
        `SELECT count(*) n FROM team_members tm JOIN teams t ON t.org_id = tm.org_id AND t.id = tm.team_id WHERE tm.org_id = $1 AND t.uuid = $2`,
        [t.orgId, team.id],
      ),
    ).toBe(2);
    const slug = (
      await h.owner.query(`SELECT slug FROM teams WHERE org_id = $1 AND uuid = $2`, [
        t.orgId,
        team.id,
      ])
    ).rows[0].slug as string;
    expect(slug).toMatch(/^sales-[a-z0-9]{4}$/);
    expect(await api.auditCount(t.orgId, 'teams', 'team.created')).toBe(1);
    expect((await api.events(t.orgId, 'team.created'))[0]).toMatchObject({
      uuid: team.id,
      name: 'Sales',
      memberCount: 2,
    });
    // Members now report the team, and the default colour applies when none is given.
    expect((await members(t.admin, '?q=ava')).data[0]!.teamIds).toEqual([team.id]);
    const plain = await createTeam(t.admin, { name: 'Plain' });
    expect(plain.body.color).toBe('#075E54');
  });

  it('022 #2: a manager (no inbox.team.manage) cannot create, edit or delete a team: 403; any signed-in member can list', async () => {
    const manager = await addMember(t, 'Mgr22', 'Manager');
    expect((await createTeam(manager.token, { name: 'Denied' })).status).toBe(403);
    const list = await api.as(t.admin).get('/v2/workspace/teams');
    const id = (list.body.data as Team[])[0]!.id;
    const rv = (list.body.data as Team[])[0]!.rowVersion;
    expect(
      (
        await api
          .as(manager.token)
          .patch(`/v2/workspace/teams/${id}`)
          .send({ name: 'x', rowVersion: rv })
      ).status,
    ).toBe(403);
    expect((await api.as(manager.token).delete(`/v2/workspace/teams/${id}`)).status).toBe(403);
    expect((await api.as(ava.token).get('/v2/workspace/teams')).status).toBe(200);
    expect(
      await count(`SELECT count(*) n FROM teams WHERE org_id = $1 AND name = 'Denied'`, [t.orgId]),
    ).toBe(0);
  });

  it('022 #3: deviceIds of another workspace, or that do not exist, are dropped from the saved list; none left means every device', async () => {
    const other = await api.signup('wsp22o');
    const mine = (
      await h.owner.query(
        `INSERT INTO devices (org_id, device_name, phone_number) VALUES ($1,'Line 1','+9111') RETURNING uuid`,
        [t.orgId],
      )
    ).rows[0].uuid as string;
    const theirs = (
      await h.owner.query(
        `INSERT INTO devices (org_id, device_name, phone_number) VALUES ($1,'Their line','+9122') RETURNING uuid`,
        [other.orgId],
      )
    ).rows[0].uuid as string;
    const res = await createTeam(t.admin, {
      name: 'Devices',
      deviceIds: [mine, theirs, '00000000-0000-4000-8000-000000000000'],
    });
    expect(res.status).toBe(201);
    expect(res.body.deviceIds).toEqual([mine]);
    expect(
      (
        await h.owner.query(`SELECT device_ids FROM teams WHERE org_id = $1 AND uuid = $2`, [
          t.orgId,
          res.body.id,
        ])
      ).rows[0].device_ids,
    ).toEqual([mine]);
    const only = await createTeam(t.admin, { name: 'Foreign devices', deviceIds: [theirs] });
    expect(only.body.deviceIds).toEqual([]);
    expect(
      (
        await h.owner.query(`SELECT device_ids FROM teams WHERE org_id = $1 AND uuid = $2`, [
          t.orgId,
          only.body.id,
        ])
      ).rows[0].device_ids,
    ).toBeNull();
    const cleared = await api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${res.body.id}`)
      .send({ deviceIds: [], rowVersion: res.body.rowVersion });
    expect(cleared.body.deviceIds).toEqual([]);
  });

  it('022 #4: PATCH with memberIds replaces the list, and an empty list removes everyone; kept members keep their lead flag and capacity', async () => {
    const created = (
      await createTeam(t.admin, { name: 'Replace', memberIds: [ava.uuid, ben.uuid] })
    ).body as Team;
    await h.owner.query(
      `UPDATE team_members SET is_lead = true, capacity = 5 WHERE org_id = $1 AND user_id = $2 AND team_id = (SELECT id FROM teams WHERE org_id = $1 AND uuid = $3)`,
      [t.orgId, ava.userId, created.id],
    );
    const one = await api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${created.id}`)
      .send({ memberIds: [ava.uuid], rowVersion: created.rowVersion });
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(one.body.members).toHaveLength(1);
    expect(one.body.members[0]).toMatchObject({ id: ava.uuid, isLead: true, capacity: 5 });
    expect(one.body.rowVersion).toBe(created.rowVersion + 1);
    const none = await api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${created.id}`)
      .send({ memberIds: [], rowVersion: one.body.rowVersion });
    expect(none.body.members).toEqual([]);
    expect(
      await count(
        `SELECT count(*) n FROM team_members tm JOIN teams t ON t.org_id = tm.org_id AND t.id = tm.team_id WHERE tm.org_id = $1 AND t.uuid = $2`,
        [t.orgId, created.id],
      ),
    ).toBe(0);
    expect(await api.auditCount(t.orgId, 'teams', 'team.updated')).toBeGreaterThanOrEqual(2);
    // Fields not in the body are left alone.
    const renamed = await api.as(t.admin).patch(`/v2/workspace/teams/${created.id}`).send({
      name: 'Replace 2',
      description: 'Second line',
      assignmentStrategy: 'round_robin',
      rowVersion: none.body.rowVersion,
    });
    expect(renamed.body).toMatchObject({
      name: 'Replace 2',
      color: '#075E54',
      assignmentStrategy: 'round_robin',
      description: 'Second line',
    });
  });

  it('022 #5: a team of another workspace is 404 for edit and delete (never 403 with data), and never shows in the list', async () => {
    const other = await api.signup('wsp22x');
    const theirs = (await createTeam(other.admin, { name: 'Theirs' })).body as Team;
    expect(
      (
        await api
          .as(t.admin)
          .patch(`/v2/workspace/teams/${theirs.id}`)
          .send({ name: 'Mine now', rowVersion: 1 })
      ).status,
    ).toBe(404);
    expect((await api.as(t.admin).delete(`/v2/workspace/teams/${theirs.id}`)).status).toBe(404);
    const names = (
      (await api.as(t.admin).get('/v2/workspace/teams?limit=200')).body.data as Team[]
    ).map((x) => x.name);
    expect(names).not.toContain('Theirs');
    expect(
      await count(`SELECT count(*) n FROM teams WHERE org_id = $1 AND name = 'Theirs'`, [
        other.orgId,
      ]),
    ).toBe(1);
  });

  it("022 (fixed): memberIds must be active members of this workspace: another workspace's user, a removed member or an unknown id is 422 WSP_TEAM_MEMBER_UNKNOWN and nothing is created", async () => {
    const other = await api.signup('wsp22m');
    const foreign = await addMember(other, 'Foreign22', 'Agent');
    const gone = await addMember(t, 'Gone22', 'Agent');
    await api.as(t.admin).delete(`/v2/workspace/members/${gone.uuid}`);
    for (const bad of [foreign.uuid, gone.uuid, '00000000-0000-4000-8000-000000000000']) {
      const res = await createTeam(t.admin, { name: 'Smuggle', memberIds: [ava.uuid, bad] });
      expect(res.status).toBe(422);
      expect(code(res)).toBe('WSP_TEAM_MEMBER_UNKNOWN');
    }
    expect(
      await count(`SELECT count(*) n FROM teams WHERE org_id = $1 AND name = 'Smuggle'`, [t.orgId]),
    ).toBe(0);
    const team = (await createTeam(t.admin, { name: 'Clean' })).body as Team;
    const patch = await api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${team.id}`)
      .send({ memberIds: [foreign.uuid], rowVersion: team.rowVersion });
    expect(code(patch)).toBe('WSP_TEAM_MEMBER_UNKNOWN');
  });

  it('022: a team name is unique per workspace (409 WSP_TEAM_NAME_TAKEN), also on rename; another workspace may reuse it', async () => {
    expect(code(await createTeam(t.admin, { name: 'Sales' }))).toBe('WSP_TEAM_NAME_TAKEN');
    const clean = (
      (await api.as(t.admin).get('/v2/workspace/teams?limit=200')).body.data as Team[]
    ).find((x) => x.name === 'Clean')!;
    const rename = await api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${clean.id}`)
      .send({ name: 'Sales', rowVersion: clean.rowVersion });
    expect(rename.status).toBe(409);
    expect(code(rename)).toBe('WSP_TEAM_NAME_TAKEN');
    const other = await api.signup('wsp22n');
    expect((await createTeam(other.admin, { name: 'Sales' })).status).toBe(201);
    // Saving a team under its own name is not a clash.
    const same = await api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${clean.id}`)
      .send({ name: 'Clean', color: '#123456', rowVersion: clean.rowVersion });
    expect(same.status).toBe(200);
  });

  it('022: validation: name 1..64, colour pattern, strategy enum, a stale rowVersion is 409', async () => {
    expect((await createTeam(t.admin, { name: '' })).status).toBe(422);
    expect((await createTeam(t.admin, { name: 'x'.repeat(65) })).status).toBe(422);
    expect((await createTeam(t.admin, { name: 'Colour', color: 'not a colour!' })).status).toBe(
      422,
    );
    expect(
      (await createTeam(t.admin, { name: 'Strategy', assignmentStrategy: 'random' })).status,
    ).toBe(422);
    expect(
      (
        await createTeam(t.admin, {
          name: 'Ok64',
          assignmentStrategy: 'least_loaded',
          color: 'teal',
        })
      ).status,
    ).toBe(201);
    const team = (await createTeam(t.admin, { name: 'Stale' })).body as Team;
    const res = await api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${team.id}`)
      .send({ name: 'Stale 2', rowVersion: team.rowVersion + 3 });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('ROW_VERSION_CONFLICT');
  });

  it('022: deleting a team removes its member places, unassigns its conversations, and leaves audit and outbox rows', async () => {
    const team = (await createTeam(t.admin, { name: 'Delete me', memberIds: [ava.uuid] }))
      .body as Team;
    const teamId = Number(
      (
        await h.owner.query(`SELECT id FROM teams WHERE org_id = $1 AND uuid = $2`, [
          t.orgId,
          team.id,
        ])
      ).rows[0].id,
    );
    const conv = await h.owner.query(
      `INSERT INTO conversations (org_id, title, assignee_team_id) VALUES ($1,'Routed chat',$2) RETURNING id`,
      [t.orgId, teamId],
    );
    const res = await api.as(t.admin).delete(`/v2/workspace/teams/${team.id}`);
    expect(res.status).toBe(204);
    expect(await count(`SELECT count(*) n FROM teams WHERE id = $1`, [teamId])).toBe(0);
    expect(await count(`SELECT count(*) n FROM team_members WHERE team_id = $1`, [teamId])).toBe(0);
    expect(
      (
        await h.owner.query(`SELECT assignee_team_id FROM conversations WHERE id = $1`, [
          conv.rows[0].id,
        ])
      ).rows[0].assignee_team_id,
    ).toBeNull();
    expect(await api.auditCount(t.orgId, 'teams', 'team.deleted')).toBeGreaterThanOrEqual(1);
    expect((await api.events(t.orgId, 'team.deleted')).some((e) => e.uuid === team.id)).toBe(true);
    expect((await api.as(t.admin).delete(`/v2/workspace/teams/${team.id}`)).status).toBe(404);
  });

  it("022: the list pages with a cursor (asc is creation order), searches by name and carries each team's members", async () => {
    const o = await api.signup('wsp22p');
    for (const n of ['Alpha', 'Beta', 'Gamma']) await createTeam(o.admin, { name: n });
    const first = await api.as(o.admin).get('/v2/workspace/teams?limit=2&order=asc');
    expect((first.body.data as Team[]).map((x) => x.name)).toEqual(['Alpha', 'Beta']);
    expect(first.body.page.hasMore).toBe(true);
    const next = await api
      .as(o.admin)
      .get(`/v2/workspace/teams?limit=2&order=asc&cursor=${first.body.page.nextCursor}`);
    expect((next.body.data as Team[]).map((x) => x.name)).toEqual(['Gamma']);
    expect(next.body.page.hasMore).toBe(false);
    expect(
      ((await api.as(o.admin).get('/v2/workspace/teams?q=amm')).body.data as Team[]).map(
        (x) => x.name,
      ),
    ).toEqual(['Gamma']);
    expect(
      (await api.as(t.admin).get('/v2/workspace/teams?q=Alpha')).body.data as Team[],
    ).toHaveLength(0);
  });
});

describe('WD-WSP-046: nobody acts on a higher rank, and only an Owner hands out Admin', () => {
  it('046: the rank rules hold on every member action at once (invite, role, remove, reset) for a caller who holds the keys but ranks lower', async () => {
    const t = await api.signup('wsp46');
    const caller = await api.member(t, 'keys-only', [
      ['org.member.invite'],
      ['org.member.role_assign'],
    ]);
    const admin = await addMember(t, 'Admin46', 'Admin');
    const adminRow = (await members(t.admin)).data.find((m) => m.id === admin.uuid)!;
    const removal = await api.as(caller.token).delete(`/v2/workspace/members/${admin.uuid}`);
    const reset = await api
      .as(caller.token)
      .post(`/v2/workspace/members/${admin.uuid}/reset-password`)
      .send();
    for (const a of [removal, reset]) {
      expect(a.status).toBe(403);
      expect(code(a)).toBe('WSP_CANNOT_ACT_ON_HIGHER_RANK');
    }
    // Handing out a role, or changing one, is RBAC's rule and answers with its code.
    const roleChange = await api
      .as(caller.token)
      .patch(`/v2/workspace/members/${admin.uuid}/role`)
      .send({ roleId: await roleId(t, 'Viewer'), rowVersion: adminRow.rowVersion });
    expect(roleChange.status).toBe(403);
    expect(code(roleChange)).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    for (const role of ['Admin', 'Manager']) {
      const res = await invite(caller.token, {
        fullName: 'X',
        email: 'x46@example.test',
        roleId: await roleId(t, role),
      });
      expect(res.status, role).toBe(403);
      expect(code(res), role).toBe('RBAC_ROLE_GRANT_FORBIDDEN');
    }
    expect((await members(t.admin)).data.find((m) => m.id === admin.uuid)!.tier).toBe('admin');
  });
});
