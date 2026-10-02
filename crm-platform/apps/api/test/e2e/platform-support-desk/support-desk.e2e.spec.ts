import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as rules from '../../../src/modules/platform-support-desk/ticket-rules';
import {
  customerTicketDetailSchema,
  customerTicketListResponseSchema,
  operatorTicketDetailSchema,
  operatorTicketListResponseSchema,
  SUPP_TICKET_NUMBER_PATTERN,
  type CustomerTicketDetail,
  type OperatorTicketDetail,
} from '@crm/contracts';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

// Passthrough spy: only the collision test overrides the generated candidate.
vi.mock('../../../src/modules/platform-support-desk/ticket-rules', async (orig) => {
  const m = await orig<typeof import('../../../src/modules/platform-support-desk/ticket-rules')>();
  return { ...m, ticketNumber: vi.fn(m.ticketNumber) };
});

/**
 * The platform support desk end to end through HTTP (WD-SUPP-001..005, 007..013): the customer ticket form and
 * thread, the operator inbox, panel, reply, assignment, status and priority. One app, one database; each test makes
 * its own accounts and tickets so none depends on another.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const PASSWORD = 'Str0ngPassw0rd#1';
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

let ipCounter = 10;
const nextIp = () => `10.9.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
let counter = 0;

let superToken = '';
let supportToken = '';
let auditorToken = '';
let supportOperatorUuid = '';

interface Account {
  access: string;
  orgId: number;
  userId: number;
  email: string;
}

async function signup(): Promise<Account> {
  const email = `supp${Date.now()}${counter++}@example.test`;
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', nextIp())
    .send({
      orgName: `Support Org ${counter}`,
      fullName: 'Ticket Person',
      email,
      password: PASSWORD,
      acceptTerms: true,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const access = res.body.tokens.accessToken as string;
  const row = await h.owner.query(`SELECT id, org_id FROM users WHERE email = $1`, [email]);
  return { access, orgId: Number(row.rows[0].org_id), userId: Number(row.rows[0].id), email };
}

const cust = (a: Account) => ({
  post: (path: string) => api().post(`/v2/support/tickets${path}`).set(bearer(a.access)),
  get: (path: string) => api().get(`/v2/support/tickets${path}`).set(bearer(a.access)),
});

type Method = 'get' | 'post' | 'patch';
const asOp = (token: string, method: Method, path: string) =>
  api()[method](`/v2/platform/support/tickets${path}`).set(bearer(token));
const ops = (method: Method, path: string) => asOp(superToken, method, path);

const form = (over: Record<string, unknown> = {}) => ({
  reason: 'billing',
  name: 'Ticket Person',
  email: 'reply@example.test',
  subject: 'Invoice question',
  message: 'Why was I charged twice?',
  ...over,
});

async function fileTicket(a: Account, over: Record<string, unknown> = {}) {
  const res = await cust(a).post('').send(form(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; ticketNumber: string; status: string };
}

const row = async (uuid: string) =>
  (await h.owner.query(`SELECT * FROM support_tickets WHERE uuid = $1`, [uuid])).rows[0];

async function detail(uuid: string): Promise<OperatorTicketDetail> {
  const res = await ops('get', `/${uuid}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return operatorTicketDetailSchema.parse(res.body);
}

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  superToken = token;

  const sup = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = sup.body.tokens.accessToken as string;
  supportOperatorUuid = (
    await h.owner.query(`SELECT uuid FROM platform_operators WHERE email = 'support@platform.test'`)
  ).rows[0].uuid;

  await h.owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash, role)
     SELECT 'auditor@platform.test', 'Auditor', password_hash, 'auditor' FROM platform_operators WHERE email = $1`,
    [OPERATOR_EMAIL],
  );
  const aud = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'auditor@platform.test', password: OPERATOR_PASSWORD });
  auditorToken = aud.body.tokens.accessToken as string;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('customer files a ticket (WD-SUPP-001, 002)', () => {
  it('creates an open, normal-priority ticket stamped with the user and workspace', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    expect(t.ticketNumber).toMatch(SUPP_TICKET_NUMBER_PATTERN);
    expect(t.status).toBe('open');
    const r = await row(t.id);
    expect(r).toMatchObject({
      status: 'open',
      priority: 'normal',
      reason: 'billing',
      email: 'reply@example.test',
      subject: 'Invoice question',
    });
    expect(Number(r.org_id)).toBe(a.orgId);
    expect(Number(r.user_id)).toBe(a.userId);
    expect(r.assigned_agent_id).toBeNull();
    expect(r.first_response_at).toBeNull();
    // audit + outbox in the same transaction
    const ev = await h.owner.query(
      `SELECT 1 FROM event_outbox WHERE org_id = $1 AND event_type = 'support.ticket.created'`,
      [a.orgId],
    );
    expect(ev.rowCount).toBe(1);
    const au = await h.owner.query(
      `SELECT 1 FROM audit_log WHERE org_id = $1 AND module = 'support_tickets' AND action = 'insert'`,
      [a.orgId],
    );
    expect(au.rowCount).toBe(1);
  });

  it('stores the chosen reason (delivery)', async () => {
    const a = await signup();
    const t = await fileTicket(a, { reason: 'delivery' });
    expect((await row(t.id)).reason).toBe('delivery');
  });

  it('rejects a 20001-character message and an invalid email, creating nothing', async () => {
    const a = await signup();
    const long = await cust(a)
      .post('')
      .send(form({ message: 'x'.repeat(20001) }));
    expect(long.status).toBe(422);
    const bad = await cust(a)
      .post('')
      .send(form({ email: 'not-an-email' }));
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: { path: string }) => e.path)).toContain('email');
    const n = await h.owner.query(
      `SELECT count(*)::int AS n FROM support_tickets WHERE org_id = $1`,
      [a.orgId],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it('refuses an unauthenticated visitor', async () => {
    const res = await api().post('/v2/support/tickets').send(form());
    expect(res.status).toBe(401);
  });

  it('a number that is already taken is skipped and the next candidate is used (WD-SUPP-002)', async () => {
    const a = await signup();
    const first = await fileTicket(a);
    vi.mocked(rules.ticketNumber).mockReturnValueOnce(first.ticketNumber);
    const second = await fileTicket(a);
    expect(second.ticketNumber).not.toBe(first.ticketNumber);
    expect(second.ticketNumber).toMatch(SUPP_TICKET_NUMBER_PATTERN);
    const n = await h.owner.query(
      `SELECT count(*)::int AS n FROM support_tickets WHERE org_id = $1`,
      [a.orgId],
    );
    expect(n.rows[0].n).toBe(2);
  });

  it('two quick tickets from one user get distinct numbers (no dedupe)', async () => {
    const a = await signup();
    const [x, y] = await Promise.all([fileTicket(a), fileTicket(a)]);
    expect(x.ticketNumber).not.toBe(y.ticketNumber);
  });
});

describe('customer history and thread (WD-SUPP-003, 004)', () => {
  it('lists the 10 newest of 12 and the counts, never a colleague’s ticket', async () => {
    const a = await signup();
    for (let i = 0; i < 12; i++) await fileTicket(a, { subject: `T${i}` });
    // a colleague in the same workspace
    const colleague = await h.owner.query(
      `INSERT INTO users (org_id, email, full_name, password_hash)
       VALUES ($1, $2, 'Colleague', 'x') RETURNING id`,
      [a.orgId, `colleague${counter++}@example.test`],
    );
    await h.owner.query(
      `INSERT INTO support_tickets (org_id, user_id, ticket_number, name, email, subject, message)
       VALUES ($1, $2, $3, 'C', 'c@example.test', 'Colleague ticket', 'hi')`,
      [a.orgId, colleague.rows[0].id, `TKT-C${counter}ZZZZ`.slice(0, 10)],
    );
    // one resolved, one closed: closed is NOT open on the customer side
    await h.owner.query(
      `UPDATE support_tickets SET status = 'resolved', resolved_at = now() WHERE org_id = $1 AND subject = 'T0'`,
      [a.orgId],
    );
    await h.owner.query(
      `UPDATE support_tickets SET status = 'closed' WHERE org_id = $1 AND subject = 'T1'`,
      [a.orgId],
    );
    const res = await cust(a).get('');
    expect(res.status).toBe(200);
    const body = customerTicketListResponseSchema.parse(res.body);
    expect(body.data).toHaveLength(10);
    expect(body.data[0]!.subject).toBe('T11');
    expect(body.data.map((t) => t.subject)).not.toContain('Colleague ticket');
    expect(body.summary).toEqual({ total: 12, open: 10, resolved: 1 });
  });

  it('answers 404 for another user’s ticket, and shows only public messages with the right labels', async () => {
    const a = await signup();
    const b = await signup();
    const t = await fileTicket(a);
    expect((await cust(b).get(`/${t.id}`)).status).toBe(404);
    expect((await cust(b).post(`/${t.id}/reply`).send({ body: 'hi' })).status).toBe(404);
    const stored = await h.owner.query(
      `SELECT count(*)::int AS n FROM support_messages WHERE org_id = $1`,
      [a.orgId],
    );
    expect(stored.rows[0].n).toBe(0);

    await ops('post', `/${t.id}/reply`).send({ body: 'Internal only', isInternalNote: true });
    await ops('post', `/${t.id}/reply`).send({ body: 'We are on it' });
    const res = await cust(a).get(`/${t.id}`);
    expect(res.status).toBe(200);
    const d: CustomerTicketDetail = customerTicketDetailSchema.parse(res.body);
    expect(d.messages.map((m) => [m.role, m.body])).toEqual([
      ['initial', 'Why was I charged twice?'],
      ['support', 'We are on it'],
    ]);
    expect(JSON.stringify(res.body)).not.toContain('Internal only');
  });

  it('404s a malformed id', async () => {
    const a = await signup();
    expect((await cust(a).get('/123')).status).toBe(422);
  });
});

describe('customer follow-up (WD-SUPP-005)', () => {
  it('reopens a resolved ticket as in_progress and clears resolved_at', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    await h.owner.query(
      `UPDATE support_tickets SET status = 'resolved', resolved_at = now() WHERE uuid = $1`,
      [t.id],
    );
    const res = await cust(a).post(`/${t.id}/reply`).send({ body: 'Still broken' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('in_progress');
    const r = await row(t.id);
    expect(r.status).toBe('in_progress');
    expect(r.resolved_at).toBeNull();
    expect(r.last_reply_at).not.toBeNull();
    expect(r.first_response_at).toBeNull();
    const ev = await h.owner.query(
      `SELECT 1 FROM event_outbox WHERE org_id = $1 AND event_type = 'support.ticket.customer_replied'`,
      [a.orgId],
    );
    expect(ev.rowCount).toBe(1);
  });

  it('leaves a pending ticket pending', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    await h.owner.query(`UPDATE support_tickets SET status = 'pending' WHERE uuid = $1`, [t.id]);
    const res = await cust(a).post(`/${t.id}/reply`).send({ body: 'Here is the info' });
    expect(res.status).toBe(201);
    expect((await row(t.id)).status).toBe('pending');
  });

  it('refuses a reply on a closed ticket and an over-long body', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    await h.owner.query(`UPDATE support_tickets SET status = 'closed' WHERE uuid = $1`, [t.id]);
    expect((await cust(a).post(`/${t.id}/reply`).send({ body: 'hello?' })).status).toBe(409);
    const t2 = await fileTicket(a);
    expect(
      (
        await cust(a)
          .post(`/${t2.id}/reply`)
          .send({ body: 'y'.repeat(8001) })
      ).status,
    ).toBe(422);
    const n = await h.owner.query(
      `SELECT count(*)::int AS n FROM support_messages WHERE org_id = $1`,
      [a.orgId],
    );
    expect(n.rows[0].n).toBe(0);
  });
});

describe('operator inbox (WD-SUPP-007)', () => {
  it('lists newest first 12 per page with a working cursor, and global KPIs', async () => {
    const a = await signup();
    await h.owner.query(
      `INSERT INTO support_tickets (org_id, user_id, ticket_number, name, email, subject, message, created_at)
       SELECT $1, $2, 'TKT-P' || lpad(g::text, 5, '0'), 'Bulk', 'bulk@example.test', 'Bulk ' || g, 'm',
              now() - (g || ' minutes')::interval
       FROM generate_series(1, 30) g`,
      [a.orgId, a.userId],
    );
    const p1 = await ops('get', '?q=Bulk');
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    const b1 = operatorTicketListResponseSchema.parse(p1.body);
    expect(b1.data).toHaveLength(12);
    expect(b1.data[0]!.subject).toBe('Bulk 1');
    expect(b1.page.hasMore).toBe(true);
    const p2 = operatorTicketListResponseSchema.parse(
      (await ops('get', `?q=Bulk&cursor=${b1.page.nextCursor}`)).body,
    );
    expect(p2.data[0]!.subject).toBe('Bulk 13');
    const p3 = operatorTicketListResponseSchema.parse(
      (await ops('get', `?q=Bulk&cursor=${p2.page.nextCursor}`)).body,
    );
    expect(p3.data).toHaveLength(6);
    expect(p3.page.hasMore).toBe(false);
    expect(b1.kpis.total).toBeGreaterThanOrEqual(30);
    // KPIs ignore the filter
    const none = operatorTicketListResponseSchema.parse((await ops('get', '?q=zzzznothing')).body);
    expect(none.data).toEqual([]);
    expect(none.kpis.total).toBe(b1.kpis.total);
  });

  it('searches number, email and subject; filters status, priority and agent', async () => {
    const a = await signup();
    const t = await fileTicket(a, { subject: 'Zebra stripes', email: 'zebra.owner@example.test' });
    const byNum = operatorTicketListResponseSchema.parse(
      (await ops('get', `?q=${t.ticketNumber.toLowerCase().slice(0, 7)}`)).body,
    );
    expect(byNum.data.map((r) => r.id)).toContain(t.id);
    const byMail = operatorTicketListResponseSchema.parse(
      (await ops('get', '?q=zebra.owner')).body,
    );
    expect(byMail.data.map((r) => r.id)).toEqual([t.id]);

    const d = await detail(t.id);
    await ops('patch', `/${t.id}/priority`).send({ priority: 'urgent', rowVersion: d.rowVersion });
    const urgent = operatorTicketListResponseSchema.parse(
      (await ops('get', '?priority=urgent&q=Zebra')).body,
    );
    expect(urgent.data.map((r) => r.id)).toEqual([t.id]);
    const low = operatorTicketListResponseSchema.parse(
      (await ops('get', '?priority=low&q=Zebra')).body,
    );
    expect(low.data).toEqual([]);

    const unassigned = operatorTicketListResponseSchema.parse(
      (await ops('get', '?agent=unassigned&q=Zebra')).body,
    );
    expect(unassigned.data).toHaveLength(1);
    const mine = operatorTicketListResponseSchema.parse(
      (await ops('get', '?agent=me&q=Zebra')).body,
    );
    expect(mine.data).toEqual([]);
  });

  it('is closed to tenant users and anonymous callers', async () => {
    const a = await signup();
    expect([401, 403]).toContain(
      (await api().get('/v2/platform/support/tickets').set(bearer(a.access))).status,
    );
    expect((await api().get('/v2/platform/support/tickets')).status).toBe(401);
  });

  it('lets a read-only auditor look but not write', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    expect((await asOp(auditorToken, 'get', `/${t.id}`)).status).toBe(200);
    const d = await detail(t.id);
    const res = await asOp(auditorToken, 'patch', `/${t.id}/status`).send({
      status: 'closed',
      rowVersion: d.rowVersion,
    });
    expect(res.status).toBe(403);
    expect((await row(t.id)).status).toBe('open');
  });
});

describe('ticket panel (WD-SUPP-008)', () => {
  it('shows the workspace, the thread in order with the note flagged', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    await ops('post', `/${t.id}/reply`).send({ body: 'Public answer' });
    await cust(a).post(`/${t.id}/reply`).send({ body: 'Customer follow-up' });
    await ops('post', `/${t.id}/reply`).send({ body: 'Private', isInternalNote: true });
    const d = await detail(t.id);
    expect(d.message).toBe('Why was I charged twice?');
    expect(d.workspace.name).toMatch(/^Support Org/);
    expect(d.messages.map((m) => [m.role, m.isInternalNote, m.authorName])).toEqual([
      ['admin', false, 'Ops'],
      ['customer', false, 'Ticket Person'],
      ['admin', true, 'Ops'],
    ]);
  });

  it('answers 404 for an unknown ticket', async () => {
    expect((await ops('get', '/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});

describe('operator reply and note (WD-SUPP-009, 010)', () => {
  it('a reply stamps first response, moves open to in_progress and emails the customer', async () => {
    const a = await signup();
    const t = await fileTicket(a, { email: 'to.me@example.test', subject: 'Cannot send' });
    const before = h.mail.length;
    const res = await ops('post', `/${t.id}/reply`).send({ body: 'Try again now' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const d = operatorTicketDetailSchema.parse(res.body);
    expect(d.status).toBe('in_progress');
    expect(d.firstResponseAt).not.toBeNull();
    expect(d.lastReplyAt).not.toBeNull();
    expect(d.messages[0]).toMatchObject({ emailStatus: 'sent', isInternalNote: false });

    expect(h.mail.length).toBe(before + 1);
    const mail = h.mail[h.mail.length - 1]!;
    expect(mail.to).toBe('to.me@example.test');
    expect(mail.subject).toBe('Re: Cannot send');
    expect(mail.text).toContain('Try again now');
    expect(mail.text).toContain(t.ticketNumber);
    expect(mail.text).toContain(`/support/${t.id}`);

    // first_response_at is stamped once
    const stamped = (await row(t.id)).first_response_at;
    await ops('post', `/${t.id}/reply`).send({ body: 'Second reply' });
    expect((await row(t.id)).first_response_at).toEqual(stamped);
  });

  it('an internal note sends no email and changes nothing on the ticket', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    const before = h.mail.length;
    const res = await ops('post', `/${t.id}/reply`).send({
      body: 'Careful with this one',
      isInternalNote: true,
    });
    expect(res.status).toBe(201);
    expect(h.mail.length).toBe(before);
    const r = await row(t.id);
    expect(r.status).toBe('open');
    expect(r.first_response_at).toBeNull();
    expect(r.last_reply_at).toBeNull();
  });

  it('rejects an 8001-character body and an empty one', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    expect((await ops('post', `/${t.id}/reply`).send({ body: 'z'.repeat(8001) })).status).toBe(422);
    expect((await ops('post', `/${t.id}/reply`).send({ body: '   ' })).status).toBe(422);
    const n = await h.owner.query(
      `SELECT count(*)::int AS n FROM support_messages WHERE org_id = $1`,
      [a.orgId],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it('records the operator as the audit actor in the ticket’s organization', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    await ops('post', `/${t.id}/reply`).send({ body: 'Audit me' });
    const au = await h.owner.query(
      `SELECT actor_type FROM audit_log WHERE org_id = $1 AND module = 'support_tickets' AND action = 'update'`,
      [a.orgId],
    );
    expect(au.rows.map((r) => r.actor_type)).toEqual(['platform_operator']);
    const ev = await h.owner.query(
      `SELECT 1 FROM event_outbox WHERE org_id = $1 AND event_type = 'support.ticket.replied'`,
      [a.orgId],
    );
    expect(ev.rowCount).toBe(1);
  });
});

describe('assign (WD-SUPP-011)', () => {
  it('assigns an operator, shows in agent=me for that operator, and unassigns', async () => {
    const a = await signup();
    const t = await fileTicket(a, { subject: 'Assign me please' });
    let d = await detail(t.id);
    const assignees = await ops('get', '/assignees');
    expect(assignees.body.data.map((x: { email: string }) => x.email)).toContain(
      'support@platform.test',
    );
    expect(assignees.body.data.map((x: { email: string }) => x.email)).not.toContain(
      'auditor@platform.test',
    );

    const res = await ops('patch', `/${t.id}/assignee`).send({
      agentId: supportOperatorUuid,
      rowVersion: d.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    d = operatorTicketDetailSchema.parse(res.body);
    expect(d.assignee).toMatchObject({ id: supportOperatorUuid, email: 'support@platform.test' });
    const mine = operatorTicketListResponseSchema.parse(
      (await asOp(supportToken, 'get', '?agent=me&q=Assign me please')).body,
    );
    expect(mine.data.map((r) => r.id)).toEqual([t.id]);

    const un = await ops('patch', `/${t.id}/assignee`).send({
      agentId: null,
      rowVersion: d.rowVersion,
    });
    expect(un.status).toBe(200);
    expect(un.body.assignee).toBeNull();
  });

  it('refuses a stale row version (409), an unknown operator and an auditor (422)', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    const d = await detail(t.id);
    await ops('patch', `/${t.id}/priority`).send({ priority: 'high', rowVersion: d.rowVersion });
    const stale = await ops('patch', `/${t.id}/assignee`).send({
      agentId: supportOperatorUuid,
      rowVersion: d.rowVersion,
    });
    expect(stale.status).toBe(409);

    const fresh = await detail(t.id);
    const unknown = await ops('patch', `/${t.id}/assignee`).send({
      agentId: '00000000-0000-4000-8000-000000000000',
      rowVersion: fresh.rowVersion,
    });
    expect(unknown.status).toBe(422);
    const auditor = (
      await h.owner.query(
        `SELECT uuid FROM platform_operators WHERE email = 'auditor@platform.test'`,
      )
    ).rows[0].uuid;
    const aud = await ops('patch', `/${t.id}/assignee`).send({
      agentId: auditor,
      rowVersion: fresh.rowVersion,
    });
    expect(aud.status).toBe(422);
    expect((await row(t.id)).assigned_agent_id).toBeNull();
  });
});

describe('status (WD-SUPP-012)', () => {
  const setStatus = async (uuid: string, status: string) => {
    const d = await detail(uuid);
    return ops('patch', `/${uuid}/status`).send({ status, rowVersion: d.rowVersion });
  };

  it('resolving stamps resolved_at once; resolved -> closed keeps it; reopening clears it', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    const res = await setStatus(t.id, 'resolved');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const stamped = (await row(t.id)).resolved_at;
    expect(stamped).not.toBeNull();
    const kpi = operatorTicketListResponseSchema.parse((await ops('get', '?q=x')).body).kpis;
    expect(kpi.resolved24h).toBeGreaterThanOrEqual(1);

    await setStatus(t.id, 'closed');
    expect((await row(t.id)).resolved_at).toEqual(stamped);

    // WaDesk kept a stale resolved_at on closed -> open; this port clears it
    await setStatus(t.id, 'open');
    expect((await row(t.id)).resolved_at).toBeNull();

    await setStatus(t.id, 'resolved');
    await setStatus(t.id, 'in_progress');
    expect((await row(t.id)).resolved_at).toBeNull();
  });

  it('closing straight from open leaves resolved_at empty', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    await setStatus(t.id, 'closed');
    expect((await row(t.id)).resolved_at).toBeNull();
  });

  it('rejects an invalid status and a stale row version', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    const d = await detail(t.id);
    expect(
      (await ops('patch', `/${t.id}/status`).send({ status: 'done', rowVersion: d.rowVersion }))
        .status,
    ).toBe(422);
    await setStatus(t.id, 'pending');
    const stale = await ops('patch', `/${t.id}/status`).send({
      status: 'closed',
      rowVersion: d.rowVersion,
    });
    expect(stale.status).toBe(409);
    expect((await row(t.id)).status).toBe('pending');
  });

  it('writes an audit row and an outbox event', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    await setStatus(t.id, 'pending');
    const au = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND actor_type = 'platform_operator'`,
      [a.orgId],
    );
    expect(au.rows[0].delta).toEqual({ status: { old: 'open', new: 'pending' } });
    const ev = await h.owner.query(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'support.ticket.status_changed'`,
      [a.orgId],
    );
    expect(ev.rows[0].payload).toMatchObject({ from: 'open', to: 'pending' });
  });
});

describe('priority (WD-SUPP-013)', () => {
  it('sets a priority, rejects an unknown one, 404s an unknown ticket', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    const d = await detail(t.id);
    const ok = await ops('patch', `/${t.id}/priority`).send({
      priority: 'urgent',
      rowVersion: d.rowVersion,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.priority).toBe('urgent');
    expect(
      (await ops('patch', `/${t.id}/priority`).send({ priority: 'critical', rowVersion: 1 }))
        .status,
    ).toBe(422);
    expect(
      (
        await ops('patch', '/00000000-0000-4000-8000-000000000000/priority').send({
          priority: 'low',
          rowVersion: 1,
        })
      ).status,
    ).toBe(404);
  });
});

describe('tenant isolation', () => {
  it('a customer cannot reach another organization’s tickets even by uuid', async () => {
    const a = await signup();
    const b = await signup();
    const t = await fileTicket(a);
    expect((await cust(b).get(`/${t.id}`)).status).toBe(404);
    const list = customerTicketListResponseSchema.parse((await cust(b).get('')).body);
    expect(list.data).toEqual([]);
  });
});
