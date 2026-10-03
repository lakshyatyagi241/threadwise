import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agentsResponseSchema,
  customerDetailResponseSchema,
  customersResponseSchema,
  inboxAuditResponseSchema,
  inboxBootstrapSchema,
  inboxConversationSchema,
  inboxQueueResponseSchema,
  operatorTicketDetailSchema,
  playbooksResponseSchema,
  reportsResponseSchema,
  slaBoardResponseSchema,
  suppBoardResponseSchema,
  type OperatorTicketDetail,
} from '@crm/contracts';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { SlaService } from '../../../src/modules/platform-support-desk/sla.service';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * The rest of the operator helpdesk through HTTP: SLA (TW-SUPP-014, 026..030), kanban (015, 016), agents (017, 018), customers
 * (020, 021), playbooks (022..024), reports and CSV (031, 032), helpdesk audit (033) and the platform inbox (037..046).
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const PASSWORD = 'Str0ngPassw0rd#1';
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));
let ipCounter = 40;
const nextIp = () => `10.8.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
let counter = 0;

let superToken = '';
let supportToken = '';
let auditorToken = '';
let supportUuid = '';

type Method = 'get' | 'post' | 'patch' | 'delete';
const call = (token: string, method: Method, path: string) =>
  api()[method](`/v2/platform/${path}`).set(bearer(token));
const sup = (method: Method, path: string) => call(superToken, method, `support/${path}`);
const inbox = (token: string, method: Method, path: string) => call(token, method, `inbox/${path}`);

interface Account {
  access: string;
  orgId: number;
  orgUuid: string;
}

async function signup(): Promise<Account> {
  const email = `desk${Date.now()}${counter++}@example.test`;
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', nextIp())
    .send({
      orgName: `Desk Org ${counter}`,
      fullName: 'Desk Person',
      email,
      password: PASSWORD,
      acceptTerms: true,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = await h.owner.query(
    `SELECT u.org_id, o.uuid FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.email = $1`,
    [email],
  );
  return {
    access: res.body.tokens.accessToken as string,
    orgId: Number(row.rows[0].org_id),
    orgUuid: row.rows[0].uuid as string,
  };
}

async function fileTicket(a: Account, subject = 'Help me', message = 'It is broken') {
  const res = await api()
    .post('/v2/support/tickets')
    .set(bearer(a.access))
    .send({ reason: 'bug', name: 'Desk Person', email: 'reply@example.test', subject, message });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string };
}

const detail = async (uuid: string): Promise<OperatorTicketDetail> => {
  const res = await sup('get', `tickets/${uuid}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return operatorTicketDetailSchema.parse(res.body);
};
const trow = async (uuid: string) =>
  (await h.owner.query(`SELECT * FROM support_tickets WHERE uuid = $1`, [uuid])).rows[0];
const ago = (uuid: string, minutes: number) =>
  h.owner.query(
    `UPDATE support_tickets SET created_at = now() - make_interval(mins => $2) WHERE uuid = $1`,
    [uuid, minutes],
  );

async function operatorToken(email: string, role: 'support' | 'auditor'): Promise<string> {
  await h.owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash, role)
     SELECT $1, $2, password_hash, $3 FROM platform_operators WHERE email = $4 ON CONFLICT DO NOTHING`,
    [email, `${role} operator`, role, OPERATOR_EMAIL],
  );
  const res = await api()
    .post('/v2/platform/auth/login')
    .send({ email, password: OPERATOR_PASSWORD });
  return res.body.tokens.accessToken as string;
}

const clearPolicies = () => h.owner.query(`DELETE FROM support_sla_policies`);
const policy = (over: Record<string, unknown> = {}) => ({
  name: 'Standard',
  firstResponseMinutes: 60,
  resolutionMinutes: 1440,
  respectBusinessHours: false,
  ...over,
});

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  superToken = token;
  supportToken = await operatorToken('support@platform.test', 'support');
  auditorToken = await operatorToken('auditor@platform.test', 'auditor');
  supportUuid = (
    await h.owner.query(`SELECT uuid FROM platform_operators WHERE email = 'support@platform.test'`)
  ).rows[0].uuid;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('SLA policies (TW-SUPP-026, 027, 028)', () => {
  it('creates a policy, keeps one default, validates ranges and the defaults of the toggles', async () => {
    await clearPolicies();
    const bad = await sup('post', 'sla/policies').send(policy({ firstResponseMinutes: 10081 }));
    expect(bad.status).toBe(422);
    const first = await sup('post', 'sla/policies').send(policy({ isDefault: true }));
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({
      pauseWhenWaitingOnCustomer: false,
      respectBusinessHours: false,
      isDefault: true,
    });
    const plain = await sup('post', 'sla/policies').send({
      name: 'Defaults',
      firstResponseMinutes: 30,
      resolutionMinutes: 600,
    });
    expect(plain.body).toMatchObject({ respectBusinessHours: true, isDefault: false });
    const second = await sup('post', 'sla/policies').send(
      policy({ name: 'Premium', isDefault: true }),
    );
    const board = slaBoardResponseSchema.parse((await sup('get', 'sla')).body);
    expect(board.policies.filter((p) => p.isDefault).map((p) => p.name)).toEqual(['Premium']);
    expect(board.kpis.policies).toBe(3);
    expect(second.status).toBe(201);
  });

  it('updates with the row version (409 when stale), and deleting the default switches the SLA off', async () => {
    await clearPolicies();
    const p = (await sup('post', 'sla/policies').send(policy({ isDefault: true }))).body;
    const upd = await sup('patch', `sla/policies/${p.id}`).send({
      ...policy({ name: 'Renamed', isDefault: true }),
      rowVersion: p.rowVersion,
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.name).toBe('Renamed');
    const stale = await sup('patch', `sla/policies/${p.id}`).send({
      ...policy(),
      rowVersion: p.rowVersion,
    });
    expect(stale.status).toBe(409);
    const a = await signup();
    const t = await fileTicket(a);
    expect((await detail(t.id)).sla.policy?.name).toBe('Renamed');
    expect((await sup('delete', `sla/policies/${p.id}`)).status).toBe(204);
    const d = await detail(t.id);
    expect(d.sla).toEqual({ policy: null, firstResponse: null, resolution: null });
    expect((await sup('delete', `sla/policies/${p.id}`)).status).toBe(404);
  });

  it('auditors read the board but cannot change a policy; every change is audited', async () => {
    await clearPolicies();
    expect((await call(auditorToken, 'get', 'support/sla')).status).toBe(200);
    expect((await call(auditorToken, 'post', 'support/sla/policies').send(policy())).status).toBe(
      403,
    );
    await sup('post', 'sla/policies').send(policy());
    const n = await h.owner.query(
      `SELECT count(*)::int AS n FROM security_events WHERE event = 'platform.support.sla_policy_created'`,
    );
    expect(n.rows[0].n).toBeGreaterThanOrEqual(1);
  });
});

describe('SLA snapshot, breaches and the scanner (TW-SUPP-014, 029, 030)', () => {
  it('shows the running clocks: about 40 minutes left on a 60 minute policy after 20', async () => {
    await clearPolicies();
    await sup('post', 'sla/policies').send(policy({ isDefault: true }));
    const a = await signup();
    const t = await fileTicket(a);
    await ago(t.id, 20);
    const d = await detail(t.id);
    expect(d.sla.firstResponse).toMatchObject({ breached: false, severity: 'ok' });
    expect(d.sla.firstResponse?.minutesRemaining).toBeGreaterThanOrEqual(39);
    expect(d.sla.firstResponse?.minutesRemaining).toBeLessThanOrEqual(40);
    await ago(t.id, 50);
    expect((await detail(t.id)).sla.firstResponse?.severity).toBe('warn');
  });

  it('the scan records one first_response breach for an unanswered ticket and nothing the second time', async () => {
    await clearPolicies();
    await sup('post', 'sla/policies').send(policy({ isDefault: true }));
    const a = await signup();
    const t = await fileTicket(a, 'Breach me');
    await ago(t.id, 90);
    const slaService = h.app.get(SlaService);
    expect(await slaService.scan()).toBeGreaterThanOrEqual(1);
    const rows = await h.owner.query(
      `SELECT b.breach_type, b.over_by_minutes, b.severity FROM support_sla_breaches b
       JOIN support_tickets t ON t.org_id = b.org_id AND t.id = b.ticket_id WHERE t.uuid = $1`,
      [t.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ breach_type: 'first_response', severity: 'breach' });
    expect(rows.rows[0].over_by_minutes).toBeGreaterThanOrEqual(29);
    await slaService.scan();
    const again = await h.owner.query(
      `SELECT count(*)::int AS n FROM support_sla_breaches b JOIN support_tickets t
       ON t.org_id = b.org_id AND t.id = b.ticket_id WHERE t.uuid = $1`,
      [t.id],
    );
    expect(again.rows[0].n).toBe(1);
    const board = slaBoardResponseSchema.parse((await sup('get', 'sla')).body);
    expect(board.breaches.map((b) => b.ticketId)).toContain(t.id);
    expect(board.kpis.atRisk).toBeGreaterThanOrEqual(1);
  });

  it('writes nothing without a policy, and records a late first reply and a late resolution without a scan', async () => {
    await clearPolicies();
    const a = await signup();
    const none = await fileTicket(a, 'No policy');
    await ago(none.id, 500);
    await h.app.get(SlaService).scan();
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM support_sla_breaches b JOIN support_tickets t
           ON t.org_id = b.org_id AND t.id = b.ticket_id WHERE t.uuid = $1`,
          [none.id],
        )
      ).rows[0].n,
    ).toBe(0);

    await sup('post', 'sla/policies').send(policy({ isDefault: true }));
    const late = await fileTicket(a, 'Late answer');
    await ago(late.id, 120);
    const reply = await sup('post', `tickets/${late.id}/reply`).send({
      body: 'Sorry for the wait',
    });
    expect(reply.status).toBe(201);
    const types = await h.owner.query(
      `SELECT b.breach_type FROM support_sla_breaches b JOIN support_tickets t
       ON t.org_id = b.org_id AND t.id = b.ticket_id WHERE t.uuid = $1`,
      [late.id],
    );
    expect(types.rows.map((r) => r.breach_type)).toEqual(['first_response']);

    // A resolution that lands after its window counts as a breach and lowers the 7-day compliance.
    await h.owner.query(`DELETE FROM support_sla_policies`);
    await sup('post', 'sla/policies').send(policy({ isDefault: true, resolutionMinutes: 100 }));
    const slow = await fileTicket(a, 'Slow fix');
    await sup('post', `tickets/${slow.id}/reply`).send({ body: 'on it' });
    await ago(slow.id, 300);
    const d = await detail(slow.id);
    const res = await sup('patch', `tickets/${slow.id}/status`).send({
      status: 'resolved',
      rowVersion: d.rowVersion,
    });
    expect(res.status).toBe(200);
    const kinds = await h.owner.query(
      `SELECT b.breach_type FROM support_sla_breaches b JOIN support_tickets t
       ON t.org_id = b.org_id AND t.id = b.ticket_id WHERE t.uuid = $1`,
      [slow.id],
    );
    expect(kinds.rows.map((r) => r.breach_type)).toContain('resolution');
    const board = slaBoardResponseSchema.parse((await sup('get', 'sla')).body);
    expect(board.kpis.compliance7d).toBeLessThan(100);
  });
});

describe('kanban (TW-SUPP-015, 016)', () => {
  it('lists the four columns, filters mine, and a move updates status and resolved_at', async () => {
    const a = await signup();
    const t = await fileTicket(a, 'Kanban card');
    const board = suppBoardResponseSchema.parse((await sup('get', 'board')).body);
    expect(board.columns.open.map((c) => c.id)).toContain(t.id);
    const mine = suppBoardResponseSchema.parse((await sup('get', 'board?mine=1')).body);
    expect(mine.mineOnly).toBe(true);
    expect(mine.columns.open.map((c) => c.id)).not.toContain(t.id);

    const card = board.columns.open.find((c) => c.id === t.id)!;
    const moved = await sup('post', `board/${t.id}/move`).send({
      status: 'resolved',
      rowVersion: card.rowVersion,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((await trow(t.id)).resolved_at).not.toBeNull();
    const after = suppBoardResponseSchema.parse((await sup('get', 'board')).body);
    expect(after.columns.resolved.map((c) => c.id)).toContain(t.id);
    // moving it back clears the stamp (Reference's kanban kept it)
    const back = await sup('post', `board/${t.id}/move`).send({
      status: 'in_progress',
      rowVersion: moved.body.rowVersion,
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect((await trow(t.id)).resolved_at).toBeNull();
  });

  it('refuses a column that is not on the board, a stale card, and an auditor', async () => {
    const a = await signup();
    const t = await fileTicket(a);
    const d = await detail(t.id);
    expect(
      (await sup('post', `board/${t.id}/move`).send({ status: 'closed', rowVersion: d.rowVersion }))
        .status,
    ).toBe(422);
    await sup('patch', `tickets/${t.id}/priority`).send({
      priority: 'high',
      rowVersion: d.rowVersion,
    });
    expect(
      (
        await sup('post', `board/${t.id}/move`).send({
          status: 'pending',
          rowVersion: d.rowVersion,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(auditorToken, 'post', `support/board/${t.id}/move`).send({
          status: 'pending',
          rowVersion: 1,
        })
      ).status,
    ).toBe(403);
  });
});

describe('agents (TW-SUPP-017, 018)', () => {
  it('adds, toggles and removes an agent; only roster agents are assignable', async () => {
    await h.owner.query(`DELETE FROM support_agent_roster`);
    const empty = agentsResponseSchema.parse((await sup('get', 'agents')).body);
    expect(empty.data).toHaveLength(0);
    expect(empty.candidates.map((c) => c.id)).toContain(supportUuid);
    expect(empty.candidates.map((c) => c.email)).not.toContain('auditor@platform.test');

    const a = await signup();
    const t = await fileTicket(a);
    const d0 = await detail(t.id);
    const refused = await sup('patch', `tickets/${t.id}/assignee`).send({
      agentId: supportUuid,
      rowVersion: d0.rowVersion,
    });
    expect(refused.status).toBe(422);

    const added = await sup('post', 'agents').send({
      operatorId: supportUuid,
      specialty: 'billing',
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const dup = await sup('post', 'agents').send({ operatorId: supportUuid });
    expect(dup.body.id).toBe(added.body.id);
    const list = agentsResponseSchema.parse((await sup('get', 'agents')).body);
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ specialty: 'billing', isActive: true });
    expect(list.kpis).toMatchObject({ total: 1, active: 1 });

    const ok = await sup('patch', `tickets/${t.id}/assignee`).send({
      agentId: supportUuid,
      rowVersion: d0.rowVersion,
    });
    expect(ok.status).toBe(200);
    const after = agentsResponseSchema.parse((await sup('get', 'agents')).body);
    expect(after.data[0]?.openCount).toBe(1);

    const off = await sup('patch', `agents/${added.body.id}`).send({
      isActive: false,
      rowVersion: added.body.rowVersion,
    });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    const staleToggle = await sup('patch', `agents/${added.body.id}`).send({
      isActive: true,
      rowVersion: added.body.rowVersion,
    });
    expect(staleToggle.status).toBe(409);
    const assignees = await sup('get', 'tickets/assignees');
    expect(assignees.body.data.map((x: { id: string }) => x.id)).not.toContain(supportUuid);

    expect((await sup('delete', `agents/${added.body.id}`)).status).toBe(204);
    expect((await sup('delete', `agents/${added.body.id}`)).status).toBe(404);
    expect(
      (await call(auditorToken, 'post', 'support/agents').send({ operatorId: supportUuid })).status,
    ).toBe(403);
    await h.owner.query(
      `INSERT INTO support_agent_roster (operator_id) SELECT id FROM platform_operators WHERE email = 'support@platform.test'`,
    );
  });

  it('refuses an operator who cannot take tickets', async () => {
    const aud = (
      await h.owner.query(
        `SELECT uuid FROM platform_operators WHERE email = 'auditor@platform.test'`,
      )
    ).rows[0].uuid;
    expect((await sup('post', 'agents').send({ operatorId: aud })).status).toBe(422);
    expect((await sup('post', 'agents').send({ operatorId: 'nope' })).status).toBe(422);
  });
});

describe('customers (TW-SUPP-020, 021)', () => {
  it('ranks workspaces by open tickets and shows one workspace history with stats', async () => {
    const busy = await signup();
    const calm = await signup();
    const t1 = await fileTicket(busy, 'one');
    await fileTicket(busy, 'two');
    const t3 = await fileTicket(calm, 'solo');
    const d = await detail(t3.id);
    await sup('patch', `tickets/${t3.id}/status`).send({
      status: 'resolved',
      rowVersion: d.rowVersion,
    });
    void t1;

    const list = customersResponseSchema.parse((await sup('get', 'customers')).body);
    const iBusy = list.data.findIndex((r) => r.workspaceId === busy.orgUuid);
    const iCalm = list.data.findIndex((r) => r.workspaceId === calm.orgUuid);
    expect(iBusy).toBeGreaterThanOrEqual(0);
    expect(iBusy).toBeLessThan(iCalm);
    expect(list.data[iBusy]).toMatchObject({ openTickets: 2, totalTickets: 2 });
    expect(list.data[iCalm]).toMatchObject({ openTickets: 0, totalTickets: 1 });
    expect(list.data[iCalm]?.avgResolutionMinutes).not.toBeNull();
    const filtered = customersResponseSchema.parse(
      (await sup('get', `customers?q=${encodeURIComponent('Desk Org')}`)).body,
    );
    expect(filtered.kpis.customers).toBeGreaterThanOrEqual(2);
    expect(
      customersResponseSchema.parse((await sup('get', 'customers?q=zzzzzzzz')).body).data,
    ).toEqual([]);

    const one = customerDetailResponseSchema.parse(
      (await sup('get', `customers/${busy.orgUuid}`)).body,
    );
    expect(one.stats).toMatchObject({ total: 2, open: 2, resolved: 0 });
    expect(one.tickets.map((x) => x.subject)).toEqual(['two', 'one']);
    expect((await sup('get', `customers/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
  });
});

describe('playbooks (TW-SUPP-022, 023, 024)', () => {
  const create = (over: Record<string, unknown> = {}) =>
    sup('post', 'playbooks').send({
      name: 'Escalate',
      triggerType: 'manual',
      steps: [
        { action: 'set_priority', value: 'urgent' },
        { action: 'note', value: 'escalated' },
      ],
      ...over,
    });

  it('creates with a unique slug, validates the steps, lists active and most used first', async () => {
    await h.owner.query(`DELETE FROM support_playbooks`);
    const a = await create();
    const b = await create();
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body).toMatchObject({ isActive: true, useCount: 0 });
    expect(a.body.slug).not.toBe(b.body.slug);
    expect((await create({ steps: [{ action: 'launch_missiles', value: 'x' }] })).status).toBe(422);
    expect((await create({ name: '' })).status).toBe(422);
    const none = await create({ name: 'Empty', steps: [] });
    expect(none.status).toBe(201);
    const paused = await sup('patch', `playbooks/${b.body.id}`).send({
      isActive: false,
      rowVersion: b.body.rowVersion,
    });
    expect(paused.body.isActive).toBe(false);
    const list = playbooksResponseSchema.parse((await sup('get', 'playbooks')).body);
    expect(list.data.at(-1)?.id).toBe(b.body.id);
    expect(list.kpis).toMatchObject({ total: 3, active: 2, uses: 0 });
    const runnable = await sup('get', 'playbooks/runnable');
    expect(runnable.body.data.map((p: { id: string }) => p.id)).not.toContain(b.body.id);
  });

  it('runs steps in order through the shared actions: priority, note, status with resolved_at, tag, reply with email', async () => {
    await h.owner.query(`DELETE FROM support_playbooks`);
    const pb = await create({
      name: 'Everything',
      steps: [
        { action: 'set_priority', value: 'urgent' },
        { action: 'set_status', value: 'bogus' },
        { action: 'add_tag', value: 'refund' },
        { action: 'note', value: 'escalated' },
        { action: 'reply', value: 'We refunded you.' },
        { action: 'set_status', value: 'resolved' },
      ],
    });
    const a = await signup();
    const t = await fileTicket(a, 'Refund please');
    const before = h.mail.length;
    const run = await sup('post', `tickets/${t.id}/playbooks/${pb.body.id}/run`);
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    const d = operatorTicketDetailSchema.parse(run.body);
    expect(d.priority).toBe('urgent');
    expect(d.status).toBe('resolved');
    expect(d.resolvedAt).not.toBeNull();
    expect(d.firstResponseAt).not.toBeNull();
    expect(d.messages.map((m) => [m.isInternalNote, m.body])).toEqual([
      [true, 'escalated'],
      [false, 'We refunded you.'],
    ]);
    expect((await trow(t.id)).tags).toEqual(['refund']);
    expect(h.mail.length).toBe(before + 1);
    const list = playbooksResponseSchema.parse((await sup('get', 'playbooks')).body);
    expect(list.data[0]?.useCount).toBe(1);

    // running it again does not duplicate the tag
    await sup('post', `tickets/${t.id}/playbooks/${pb.body.id}/run`);
    expect((await trow(t.id)).tags).toEqual(['refund']);
  });

  it('assigns a roster agent, refuses a paused playbook (409), 404s unknown ids, deletes, audits', async () => {
    await h.owner.query(`DELETE FROM support_playbooks`);
    const pb = await create({
      name: 'Hand over',
      steps: [{ action: 'assign', value: supportUuid }],
    });
    const a = await signup();
    const t = await fileTicket(a);
    const run = await sup('post', `tickets/${t.id}/playbooks/${pb.body.id}/run`);
    expect(run.body.assignee?.id).toBe(supportUuid);

    // the run raised use_count, so the row version moved on: the stale toggle is refused, a fresh one works
    const stalePause = await sup('patch', `playbooks/${pb.body.id}`).send({
      isActive: false,
      rowVersion: pb.body.rowVersion,
    });
    expect(stalePause.status).toBe(409);
    const fresh = playbooksResponseSchema.parse((await sup('get', 'playbooks')).body).data[0]!;
    await sup('patch', `playbooks/${pb.body.id}`).send({
      isActive: false,
      rowVersion: fresh.rowVersion,
    });
    expect((await sup('post', `tickets/${t.id}/playbooks/${pb.body.id}/run`)).status).toBe(409);
    expect(
      (await sup('post', `tickets/${t.id}/playbooks/00000000-0000-4000-8000-000000000000/run`))
        .status,
    ).toBe(404);
    expect(
      (
        await sup(
          'post',
          `tickets/00000000-0000-4000-8000-000000000000/playbooks/${pb.body.id}/run`,
        )
      ).status,
    ).toBe(404);
    expect((await sup('delete', `playbooks/${pb.body.id}`)).status).toBe(204);
    expect(
      (await call(auditorToken, 'post', 'support/playbooks').send({ name: 'x', steps: [] })).status,
    ).toBe(403);
    const ev = await h.owner.query(
      `SELECT event FROM security_events WHERE event LIKE 'platform.support.playbook_%'`,
    );
    expect(ev.rows.map((r) => r.event)).toEqual(
      expect.arrayContaining([
        'platform.support.playbook_created',
        'platform.support.playbook_run',
        'platform.support.playbook_toggled',
        'platform.support.playbook_deleted',
      ]),
    );
  });
});

describe('reports and CSV (TW-SUPP-031, 032)', () => {
  it('clamps the window, zero-fills the volume and reports status mix and top agents', async () => {
    const a = await signup();
    const t = await fileTicket(a, 'Report me');
    const d = await detail(t.id);
    await sup('patch', `tickets/${t.id}/assignee`).send({
      agentId: supportUuid,
      rowVersion: d.rowVersion,
    });
    await sup('post', `tickets/${t.id}/reply`).send({ body: 'answer' });
    const d2 = await detail(t.id);
    await sup('patch', `tickets/${t.id}/status`).send({
      status: 'resolved',
      rowVersion: d2.rowVersion,
    });

    const seven = reportsResponseSchema.parse((await sup('get', 'reports?days=7')).body);
    expect(seven.days).toBe(7);
    expect(seven.volume).toHaveLength(7);
    expect(seven.volume.at(-1)?.count).toBeGreaterThanOrEqual(1);
    expect(seven.kpis.resolved).toBeGreaterThanOrEqual(1);
    expect(seven.byStatus.map((s) => s.status)).toContain('resolved');
    expect(seven.topAgents.length).toBeLessThanOrEqual(8);
    expect(seven.topAgents.map((x) => x.id)).toContain(supportUuid);
    expect(reportsResponseSchema.parse((await sup('get', 'reports?days=9999')).body).days).toBe(
      365,
    );
    expect(reportsResponseSchema.parse((await sup('get', 'reports')).body).days).toBe(30);
    expect(
      reportsResponseSchema.parse((await call(auditorToken, 'get', 'support/reports')).body).days,
    ).toBe(30);
  });

  it('exports every ticket newest first with a dated filename, defuses formulas and audits the export', async () => {
    const a = await signup();
    await fileTicket(a, '=HYPERLINK("http://evil")', 'x');
    await fileTicket(a, 'Comma, "quoted"', 'y');
    const res = await sup('get', 'reports/export.csv')
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (c: string) => (data += c));
        r.on('end', () => cb(null, data));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="support-tickets-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const text = res.body as string;
    const lines = text.trimEnd().split('\n');
    expect(lines[0]).toBe(
      'ticket_number,subject,status,priority,workspace_id,assigned_agent_id,created_at,first_response_at,resolved_at',
    );
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text).toContain('"Comma, ""quoted"""');
    const total = (await h.owner.query(`SELECT count(*)::int AS n FROM support_tickets`)).rows[0].n;
    expect(lines.length - 1).toBe(total);
    expect(lines[1]).toContain('Comma');
    const ev = await h.owner.query(
      `SELECT count(*)::int AS n FROM security_events WHERE event = 'platform.support.tickets_exported'`,
    );
    expect(ev.rows[0].n).toBeGreaterThanOrEqual(1);
  });
});

describe('platform inbox (TW-SUPP-037..046)', () => {
  let a: Account;
  let b: Account;
  let breached: string;
  let spamConv: string;

  async function conversation(acc: Account, over: Record<string, unknown> = {}): Promise<string> {
    const ch = await h.owner.query(
      `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'whatsapp', 'WA') RETURNING id`,
      [acc.orgId],
    );
    const v = { title: 'Where is my order', status: 'open', sla_breached: false, ...over };
    const res = await h.owner.query(
      `INSERT INTO conversations (org_id, title, preview, channel_id, peer_key, status, sla_breached, last_message_at)
       VALUES ($1, $2, 'preview text', $3, $4, $5, $6, now()) RETURNING id, uuid`,
      [acc.orgId, v.title, ch.rows[0].id, `peer${counter++}`, v.status, v.sla_breached],
    );
    await h.owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, body, kind)
       VALUES ($1, $2, 1, 'in', 'customer', 'received', 'hello there', 'text')`,
      [acc.orgId, res.rows[0].id],
    );
    return res.rows[0].uuid as string;
  }

  beforeAll(async () => {
    a = await signup();
    b = await signup();
    breached = await conversation(a, { title: 'Breached chat', sla_breached: true });
    await conversation(b, { title: 'Quiet chat' });
    spamConv = await conversation(b, { title: 'Spammy', status: 'spam' });
    await h.owner.query(
      `INSERT INTO workspace_settings (org_id, last_active_at) VALUES ($1, now()) ON CONFLICT (org_id) DO UPDATE SET last_active_at = now()`,
      [a.orgId],
    );
  });

  it('bootstrap lists workspaces with real counts and reports the caller permissions (auditor: no write keys)', async () => {
    const res = inboxBootstrapSchema.parse((await inbox(superToken, 'get', 'bootstrap')).body);
    const wa = res.workspaces.find((w) => w.id === a.orgUuid)!;
    expect(wa).toMatchObject({ openCount: 1, breachCount: 1 });
    expect(res.workspaces[0]?.id).toBe(a.orgUuid);
    expect(res.kpis.breachTotal).toBeGreaterThanOrEqual(1);
    expect(res.permissions['platform.workspace.suspend']).toBe(true);
    const aud = inboxBootstrapSchema.parse((await inbox(auditorToken, 'get', 'bootstrap')).body);
    expect(aud.permissions).toMatchObject({
      'platform.conversation.view_all': true,
      'platform.audit.view': true,
      'platform.note.write': false,
      'platform.conversation.flag_spam': false,
      'platform.workspace.suspend': false,
    });
  });

  it('queue tabs: sla_breach, unassigned, all, spam (which honours the workspace filter); paged with a true total', async () => {
    const q = async (qs: string) =>
      inboxQueueResponseSchema.parse((await inbox(superToken, 'get', `queue?${qs}`)).body);
    const sla = await q('tab=sla_breach');
    expect(sla.data.map((c) => c.id)).toContain(breached);
    expect(sla.data.every((c) => c.slaBreached)).toBe(true);
    const un = await q(`tab=unassigned&workspaceId=${b.orgUuid}`);
    expect(un.data.map((c) => c.title)).toEqual(['Quiet chat']);
    const all = await q('tab=all');
    expect(all.data.map((c) => c.id)).not.toContain(spamConv);
    const spam = await q('tab=spam');
    expect(spam.data.map((c) => c.id)).toContain(spamConv);
    expect(spam.data[0]?.isSpam).toBe(true);
    expect((await q(`tab=spam&workspaceId=${a.orgUuid}`)).data).toEqual([]);
    const page1 = await q('tab=all&limit=1');
    expect(page1.data).toHaveLength(1);
    expect(page1.page.hasMore).toBe(true);
    expect(page1.total).toBeGreaterThanOrEqual(2);
    const page2 = await q(`tab=all&limit=1&cursor=${encodeURIComponent(page1.page.nextCursor!)}`);
    expect(page2.data[0]?.id).not.toBe(page1.data[0]?.id);
    // an unknown tab falls back to sla_breach (as in Reference)
    expect((await q('tab=bogus')).data.every((c) => c.slaBreached)).toBe(true);
  });

  it('the drawer shows thread, notes, events, platform notes, and audits the view once', async () => {
    const res = await inbox(superToken, 'get', `conversations/${breached}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = inboxConversationSchema.parse(res.body);
    expect(d.conversation.workspaceName).toContain('Desk Org');
    expect(d.messages.map((m) => m.body)).toEqual(['hello there']);
    await inbox(superToken, 'get', `conversations/${breached}`);
    const views = await h.owner.query(
      `SELECT count(*)::int AS n FROM security_events WHERE event = 'platform.inbox.conversation_viewed' AND payload->>'conversation' = $1`,
      [breached],
    );
    expect(views.rows[0].n).toBe(1);
    expect(
      (await inbox(superToken, 'get', `conversations/00000000-0000-4000-8000-000000000000`)).status,
    ).toBe(404);
    expect((await inbox(auditorToken, 'get', `conversations/${breached}`)).status).toBe(200);
  });

  it('platform notes need platform.note.write, validate length and severity, and never reach the workspace', async () => {
    const ok = await inbox(superToken, 'post', `conversations/${breached}/notes`).send({
      body: 'Watch this customer',
      severity: 'warn',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const d = inboxConversationSchema.parse(
      (await inbox(superToken, 'get', `conversations/${breached}`)).body,
    );
    expect(d.platformNotes[0]).toMatchObject({ body: 'Watch this customer', severity: 'warn' });
    expect(d.notes).toEqual([]);
    expect(
      (
        await inbox(superToken, 'post', `conversations/${breached}/notes`).send({
          body: 'x'.repeat(8001),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await inbox(superToken, 'post', `conversations/${breached}/notes`).send({
          body: 'x',
          severity: 'loud',
        })
      ).status,
    ).toBe(422);
    expect(
      (await inbox(auditorToken, 'post', `conversations/${breached}/notes`).send({ body: 'nope' }))
        .status,
    ).toBe(403);
    expect(
      (
        await inbox(supportToken, 'post', `conversations/${breached}/notes`).send({
          body: 'support note',
        })
      ).status,
    ).toBe(201);
  });

  it('marks spam once (event keeps the previous status), then it leaves the open queue; auditor is refused', async () => {
    const c = await conversation(a, { title: 'Buy cheap pills' });
    expect((await inbox(auditorToken, 'post', `conversations/${c}/spam`)).status).toBe(403);
    expect((await inbox(superToken, 'post', `conversations/${c}/spam`)).status).toBe(200);
    expect((await inbox(superToken, 'post', `conversations/${c}/spam`)).status).toBe(200);
    const st = await h.owner.query(`SELECT status FROM conversations WHERE uuid = $1`, [c]);
    expect(st.rows[0].status).toBe('spam');
    const ev = await h.owner.query(
      `SELECT payload FROM conversation_events e JOIN conversations c ON c.org_id = e.org_id AND c.id = e.conversation_id
       WHERE c.uuid = $1 AND e.type = 'spam_flagged'`,
      [c],
    );
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].payload).toMatchObject({ from: 'open' });
    const spam = inboxQueueResponseSchema.parse(
      (await inbox(superToken, 'get', 'queue?tab=spam')).body,
    );
    expect(spam.data.map((x) => x.id)).toContain(c);
    expect(
      (await inbox(superToken, 'post', `conversations/00000000-0000-4000-8000-000000000000/spam`))
        .status,
    ).toBe(404);
  });

  it('flags and clears a workspace; fraud blocks it like a suspension; duplicates collapse; unknown workspace is 404', async () => {
    const w = await signup();
    const flag = await inbox(supportToken, 'post', `workspaces/${w.orgUuid}/flags`).send({
      flag: 'fraud',
      reason: 'chargebacks',
    });
    expect(flag.status, JSON.stringify(flag.body)).toBe(201);
    const org = async () =>
      (await h.owner.query(`SELECT status FROM organizations WHERE id = $1`, [w.orgId])).rows[0]
        .status;
    expect(await org()).toBe('suspended');
    const again = await inbox(supportToken, 'post', `workspaces/${w.orgUuid}/flags`).send({
      flag: 'fraud',
    });
    expect(again.body.id).toBe(flag.body.id);
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM workspace_flags WHERE org_id = $1 AND cleared_at IS NULL`,
          [w.orgId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (await inbox(supportToken, 'post', `workspaces/${w.orgUuid}/flags`).send({ flag: 'weird' }))
        .status,
    ).toBe(422);
    expect(
      (
        await inbox(
          supportToken,
          'post',
          `workspaces/00000000-0000-4000-8000-000000000000/flags`,
        ).send({ flag: 'spam' })
      ).status,
    ).toBe(404);
    expect((await inbox(auditorToken, 'delete', `flags/${flag.body.id}`)).status).toBe(403);
    expect((await inbox(supportToken, 'delete', `flags/${flag.body.id}`)).status).toBe(200);
    expect(await org()).toBe('active');
    expect((await inbox(supportToken, 'delete', `flags/${flag.body.id}`)).status).toBe(200);
    expect(
      (await inbox(supportToken, 'delete', `flags/00000000-0000-4000-8000-000000000000`)).status,
    ).toBe(404);
    // an informational flag does not block
    await inbox(supportToken, 'post', `workspaces/${w.orgUuid}/flags`).send({
      flag: 'billing_overdue',
    });
    expect(await org()).toBe('active');
  });

  it('suspends with a reason and unsuspends; a remaining fraud flag keeps it blocked; support cannot suspend', async () => {
    const w = await signup();
    expect(
      (await inbox(supportToken, 'post', `workspaces/${w.orgUuid}/suspend`).send({ reason: 'x' }))
        .status,
    ).toBe(403);
    expect(
      (
        await inbox(superToken, 'post', `workspaces/${w.orgUuid}/suspend`).send({
          reason: 'chargeback',
        })
      ).status,
    ).toBe(200);
    const flags = await h.owner.query(
      `SELECT flag, reason FROM workspace_flags WHERE org_id = $1 AND cleared_at IS NULL`,
      [w.orgId],
    );
    expect(flags.rows).toEqual([{ flag: 'frozen', reason: 'chargeback' }]);
    const status = async () =>
      (await h.owner.query(`SELECT status FROM organizations WHERE id = $1`, [w.orgId])).rows[0]
        .status;
    expect(await status()).toBe('suspended');
    await inbox(superToken, 'post', `workspaces/${w.orgUuid}/flags`).send({ flag: 'fraud' });
    expect((await inbox(superToken, 'post', `workspaces/${w.orgUuid}/unsuspend`)).status).toBe(200);
    expect(await status()).toBe('suspended');
    const fraud = (
      await h.owner.query(
        `SELECT uuid FROM workspace_flags WHERE org_id = $1 AND flag = 'fraud' AND cleared_at IS NULL`,
        [w.orgId],
      )
    ).rows[0].uuid;
    await inbox(superToken, 'delete', `flags/${fraud}`);
    expect(await status()).toBe('active');
    expect(
      (
        await inbox(
          superToken,
          'post',
          `workspaces/00000000-0000-4000-8000-000000000000/suspend`,
        ).send({})
      ).status,
    ).toBe(404);
    expect(
      (
        await inbox(superToken, 'post', `workspaces/${w.orgUuid}/suspend`).send({
          reason: 'y'.repeat(501),
        })
      ).status,
    ).toBe(422);
  });

  it('a suspended workspace cannot sign in again', async () => {
    const w = await signup();
    await inbox(superToken, 'post', `workspaces/${w.orgUuid}/suspend`).send({});
    const slug = (await h.owner.query(`SELECT slug FROM organizations WHERE id = $1`, [w.orgId]))
      .rows[0].slug;
    const email = (
      await h.owner.query(`SELECT email FROM users WHERE org_id = $1 LIMIT 1`, [w.orgId])
    ).rows[0].email;
    const login = await api()
      .post('/v2/auth/login')
      .set('x-forwarded-for', nextIp())
      .send({ email, password: PASSWORD, orgSlug: slug });
    expect(login.status).toBeGreaterThanOrEqual(400);
    expect(login.body.tokens).toBeUndefined();
  });

  it('the audit feed lists platform actions newest first, filters by workspace and needs platform.audit.view', async () => {
    const feed = inboxAuditResponseSchema.parse((await inbox(superToken, 'get', 'audit')).body);
    expect(feed.data.length).toBeGreaterThan(0);
    expect(feed.data[0]?.action).toMatch(/^(inbox|support)\./);
    const mine = inboxAuditResponseSchema.parse(
      (await inbox(superToken, 'get', `audit?workspaceId=${a.orgUuid}`)).body,
    );
    expect(mine.data.every((e) => e.workspaceId === a.orgUuid)).toBe(true);
    expect(mine.data.map((e) => e.action)).toContain('inbox.note_added');
    expect((await inbox(auditorToken, 'get', 'audit')).status).toBe(200);
    await h.owner.query(
      `INSERT INTO platform_operators (email, full_name, password_hash, role)
       SELECT 'nobody@platform.test', 'Nobody', password_hash, 'auditor' FROM platform_operators WHERE email = $1`,
      [OPERATOR_EMAIL],
    );
    await h.owner.query(
      `DELETE FROM platform_operator_roles WHERE operator_id = (SELECT id FROM platform_operators WHERE email = 'nobody@platform.test')`,
    );
    const nobody = await api()
      .post('/v2/platform/auth/login')
      .send({ email: 'nobody@platform.test', password: OPERATOR_PASSWORD });
    const t = nobody.body.tokens.accessToken as string;
    expect((await inbox(t, 'get', 'audit')).status).toBe(403);
    expect((await inbox(t, 'get', 'queue')).status).toBe(403);
    expect((await inbox(t, 'get', 'bootstrap')).status).toBe(200);
  });

  it('impersonation: reason of 8+ characters is enforced, the target must exist, and the session start waits for WSP (501)', async () => {
    expect(
      (
        await inbox(superToken, 'post', `workspaces/${a.orgUuid}/impersonate`).send({
          reason: 'short',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await inbox(
          superToken,
          'post',
          `workspaces/00000000-0000-4000-8000-000000000000/impersonate`,
        ).send({ reason: 'long enough reason' })
      ).status,
    ).toBe(404);
    expect(
      (
        await inbox(superToken, 'post', `workspaces/${a.orgUuid}/impersonate`).send({
          reason: 'long enough reason',
        })
      ).status,
    ).toBe(501);
    expect(
      (
        await inbox(auditorToken, 'post', `workspaces/${a.orgUuid}/impersonate`).send({
          reason: 'long enough reason',
        })
      ).status,
    ).toBe(403);
  });
});
