import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ownersAvailable } from '../../../src/common/leave-owner-pool';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { ContactAssignmentConsumer } from '../../../src/modules/crm/contact-assignment/contact-assignment.consumer';
import { AssignmentRunSweepService } from '../../../src/modules/crm/contact-assignment/assignment-run-sweep.service';
import { ContactAssignmentRepository } from '../../../src/modules/crm/contact-assignment/contact-assignment.repository';
import { ContactAssignmentEngine } from '../../../src/modules/crm/contact-assignment/contact-assignment.engine';
import { DealsApi, startHarness, type Harness } from '../deals-pipelines/support';
import type { Tenant } from '../contacts-attributes-tags/support';

/**
 * Auto-assignment of contacts and deals (BL-013, BL-112 phase 3): the settings (default OFF) and rules API with its permissions and
 * validation; the engine (priority, conditions, fixed / round robin / least busy, fairness, people on leave and their delegates,
 * offline, nobody available falls to the next rule, never replacing an owner, idempotent, loop guard, imports only when asked);
 * the test box; the same leave rule for form and lead-source owner pools; tenant isolation. Real Postgres (restricted role).
 */
let h: Harness;
let api: DealsApi;
beforeAll(async () => {
  h = await startHarness();
  api = new DealsApi(h);
}, 600_000);
afterAll(async () => {
  await h?.stop();
});

const get = <T>(cls: new (...a: never[]) => T): T => h.app.get(cls as never, { strict: false });
const engine = () => get(ContactAssignmentEngine);
const consumer = () => new ContactAssignmentConsumer(get(OutboxSubscriberRegistry), engine());

/** The plan feature the whole area needs (higher plans only): a test workspace gets it as a per-workspace override. */
const grant = async (t: Tenant) => {
  await h.owner.query(
    `UPDATE org_plan_state SET overrides = jsonb_set(overrides, '{features}', '{"record_assignment": true}'::jsonb, true) WHERE org_id = $1`,
    [t.orgId],
  );
  return t;
};
const tenant = async (name: string) => grant(await api.signup(name));

/** A rule tree with the conditions all required, the way the screen's builder saves one. */
const cond = (field: string, operator: string, value?: unknown) => ({
  type: 'condition',
  field,
  operator,
  ...(value === undefined ? {} : { value }),
});
const all = (...children: unknown[]) => ({ type: 'group', combinator: 'and', children });
const any = (...children: unknown[]) => ({ type: 'group', combinator: 'or', children });

const MANAGE: Array<[string, 'all']> = [
  ['crm.assignment.read', 'all'],
  ['crm.assignment.manage', 'all'],
];

interface Person {
  token: string;
  userId: number;
  uuid: string;
}
const person = async (
  t: Tenant,
  name: string,
  grants: Array<[string, 'all']> = [],
): Promise<Person> => {
  const m = await api.member(t, name, grants);
  const uuid = (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [m.userId])).rows[0]
    .uuid as string;
  return { ...m, uuid };
};

const rules = (token: string) => ({
  list: () => api.as(token).get('/v2/assignment/rules'),
  create: (body: Record<string, unknown>) =>
    api.as(token).post('/v2/assignment/rules').set('idempotency-key', randomUUID()).send(body),
  update: (id: string, body: Record<string, unknown>) =>
    api.as(token).patch(`/v2/assignment/rules/${id}`).send(body),
  remove: (id: string) => api.as(token).delete(`/v2/assignment/rules/${id}`),
  reorder: (subject: string, ids: string[]) =>
    api.as(token).post('/v2/assignment/rules/reorder').send({ subject, ids }),
  settings: () => api.as(token).get('/v2/assignment/settings'),
  setSettings: (body: Record<string, unknown>) =>
    api.as(token).put('/v2/assignment/settings').send(body),
  test: (body: Record<string, unknown>) => api.as(token).post('/v2/assignment/test').send(body),
});

const away = (t: Tenant, userId: number) =>
  h.owner.query(
    `INSERT INTO member_leaves (org_id, user_id, starts_on, ends_on, status)
     VALUES ($1,$2,(now() AT TIME ZONE 'UTC')::date - 1,(now() AT TIME ZONE 'UTC')::date + 5,'active')`,
    [t.orgId, userId],
  );
const back = (t: Tenant) => h.owner.query(`DELETE FROM member_leaves WHERE org_id = $1`, [t.orgId]);
const ownerOf = async (uuid: string) =>
  (await h.owner.query(`SELECT owner_id FROM contacts WHERE uuid = $1`, [uuid])).rows[0]
    .owner_id as number | null;
const newContact = async (
  t: Tenant,
  source: string | null = 'Website',
  extra: Record<string, unknown> = {},
) => {
  const [uuid] = await api.seedContacts(t, [{ name: `c${Math.random()}`, source, ...extra }]);
  return uuid!;
};
const assignTo = (t: Tenant, uuid: string, origin = 'manual') =>
  engine().assign(t.orgId, 'contact', uuid, origin);
const firedOf = async (id: string) =>
  Number(
    (await h.owner.query(`SELECT fired_count FROM assignment_rules WHERE uuid = $1`, [id])).rows[0]
      .fired_count,
  );

describe('the API', () => {
  let t: Tenant;
  let other: Tenant;
  let mgr: Person;
  let reader: Person;
  let agent: Person;
  let a: Person;

  beforeAll(async () => {
    t = await tenant('ca');
    other = await tenant('cao');
    mgr = await person(t, 'camgr', MANAGE);
    reader = await person(t, 'cardr', [['crm.assignment.read', 'all']]);
    agent = await person(t, 'caagent', [['record.contacts.read', 'all']]);
    a = await person(t, 'caa');
  });

  it('is OFF by default; the switch is for managers, audited, and per workspace', async () => {
    expect((await rules(mgr.token).settings()).body).toEqual({
      enabled: false,
      applyToImports: false,
    });
    expect((await rules(reader.token).setSettings({ enabled: true })).status).toBe(403);
    expect((await rules(agent.token).settings()).status).toBe(403);
    const on = await rules(mgr.token).setSettings({ enabled: true });
    expect(on.body).toEqual({ enabled: true, applyToImports: false });
    expect(
      (
        await h.owner.query(
          `SELECT 1 FROM audit_log WHERE org_id = $1 AND action = 'assignment.settings.updated'`,
          [t.orgId],
        )
      ).rows.length,
    ).toBe(1);
    expect((await rules(other.admin).settings()).body.enabled).toBe(false);
    await rules(mgr.token).setSettings({ enabled: false });
  });

  it('rules: permissions, validation, edit with row version, reorder, delete', async () => {
    const body = {
      name: 'Web leads',
      subject: 'contact',
      strategy: 'fixed',
      userIds: [a.uuid],
      rules: all(cond('source', 'equals', 'Website')),
    };
    expect((await rules(reader.token).create(body)).status).toBe(403);
    expect((await rules(agent.token).list()).status).toBe(403);
    const made = await rules(mgr.token).create(body);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({
      name: 'Web leads',
      strategy: 'fixed',
      isActive: true,
      position: 1,
      firedCount: 0,
    });
    expect((await rules(reader.token).list()).body.data.length).toBe(1);

    // a fixed rule names one person; a rule needs somebody; strangers are refused
    expect((await rules(mgr.token).create({ ...body, userIds: [a.uuid, mgr.uuid] })).status).toBe(
      422,
    );
    expect((await rules(mgr.token).create({ ...body, userIds: [] })).status).toBe(422);
    const stranger = await person(other, 'castranger');
    expect((await rules(mgr.token).create({ ...body, userIds: [stranger.uuid] })).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (
        await rules(mgr.token).create({
          ...body,
          strategy: 'round_robin',
          userIds: [a.uuid],
          teamIds: [randomUUID()],
        })
      ).status,
    ).toBe(422);
    await h.owner.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [stranger.userId]);

    const second = (
      await rules(mgr.token).create({
        ...body,
        name: 'Second',
        strategy: 'round_robin',
        userIds: [a.uuid, mgr.uuid],
      })
    ).body;
    expect((await rules(mgr.token).update(second.id, { rowVersion: 99, name: 'x' })).status).toBe(
      409,
    );
    const edited = await rules(mgr.token).update(second.id, {
      rowVersion: second.rowVersion,
      name: 'Renamed',
      isActive: false,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({ name: 'Renamed', isActive: false });
    // fixed must stay one person when edited
    expect(
      (
        await rules(mgr.token).update(made.body.id, {
          rowVersion: made.body.rowVersion,
          userIds: [a.uuid, mgr.uuid],
        })
      ).status,
    ).toBe(422);

    const re = await rules(mgr.token).reorder('contact', [second.id, made.body.id]);
    expect(re.body.data.map((r: { id: string }) => r.id)).toEqual([second.id, made.body.id]);
    expect((await rules(mgr.token).reorder('contact', [randomUUID()])).status).toBe(422);

    // tenants never see or touch each other's rules
    expect((await rules(other.admin).list()).body.data).toEqual([]);
    expect((await rules(other.admin).update(second.id, { rowVersion: 1, name: 'x' })).status).toBe(
      404,
    );
    expect((await rules(other.admin).remove(second.id)).status).toBe(404);
    expect((await rules(mgr.token).remove(second.id)).status).toBe(204);
    expect((await rules(mgr.token).remove(made.body.id)).status).toBe(204);
  });
});

describe('the engine', () => {
  let t: Tenant;
  let mgr: Person;
  let a: Person;
  let b: Person;
  let c: Person;

  beforeAll(async () => {
    t = await tenant('ce');
    mgr = await person(t, 'cemgr', MANAGE);
    a = await person(t, 'cea');
    b = await person(t, 'ceb');
    c = await person(t, 'cec');
  });
  const clean = async () => {
    await h.owner.query(`DELETE FROM assignment_rules WHERE org_id = $1`, [t.orgId]);
    await h.owner.query(`DELETE FROM member_leaves WHERE org_id = $1`, [t.orgId]);
    await h.owner.query(`DELETE FROM member_delegates WHERE org_id = $1`, [t.orgId]);
    await h.owner.query(`DELETE FROM agent_statuses WHERE org_id = $1`, [t.orgId]);
    await h.owner.query(`UPDATE contacts SET owner_id = NULL WHERE org_id = $1`, [t.orgId]);
  };
  afterEach(clean);
  const makeRule = async (body: Record<string, unknown>) => {
    const r = await rules(mgr.token).create({ subject: 'contact', ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string };
  };
  const enable = async (applyToImports = false) =>
    expect((await rules(mgr.token).setSettings({ enabled: true, applyToImports })).status).toBe(
      200,
    );

  it('does nothing while the switch is off', async () => {
    await makeRule({ name: 'W', strategy: 'fixed', userIds: [a.uuid] });
    const id = await newContact(t);
    expect((await assignTo(t, id)).outcome).toBe('disabled');
    expect(await ownerOf(id)).toBeNull();
    await clean();
  });

  it('a fixed rule: owner set, audit row with the rule id, both events, counters; idempotent', async () => {
    await enable();
    const rule = await makeRule({
      name: 'Website to A',
      strategy: 'fixed',
      userIds: [a.uuid],
      rules: all(cond('source', 'equals', 'website')),
    });
    const id = await newContact(t, 'Website');
    const r = await assignTo(t, id);
    expect(r).toMatchObject({ outcome: 'assigned', ownerUuid: a.uuid, ruleId: rule.id });
    expect(Number(await ownerOf(id))).toBe(a.userId);
    const audit = (
      await h.owner.query(
        `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'contacts' AND action = 'contact.auto_assigned'`,
        [t.orgId],
      )
    ).rows;
    expect(audit.length).toBe(1);
    expect(audit[0].delta).toMatchObject({ ownerId: { new: a.uuid }, ruleId: { new: rule.id } });
    const types = (
      await h.owner.query(
        `SELECT event_type, payload FROM event_outbox WHERE org_id = $1 AND payload ->> 'ruleId' = $2 ORDER BY id`,
        [t.orgId, rule.id],
      )
    ).rows;
    expect(types.map((x) => x.event_type)).toEqual(['contact.updated', 'contact.auto_assigned']);
    expect(types[0].payload.autoAssigned).toBe(true);
    expect(await firedOf(rule.id)).toBe(1);
    // a redelivery finds an owner and does nothing
    expect((await assignTo(t, id)).outcome).toBe('has_owner');
    expect(await firedOf(rule.id)).toBe(1);
    await clean();
  });

  it('priority: the first rule that matches and finds somebody wins; a rule that matches but finds nobody is passed over', async () => {
    const r1 = await makeRule({
      name: 'India',
      strategy: 'fixed',
      userIds: [a.uuid],
      rules: all(cond('phone', 'starts_with', '91')),
    });
    const r2 = await makeRule({ name: 'Everyone else', strategy: 'fixed', userIds: [b.uuid] });
    const india = await newContact(t, 'x', { phone: '+919812345678' });
    const other = await newContact(t, 'x', { phone: '+14155550123' });
    expect(await assignTo(t, india)).toMatchObject({ ruleId: r1.id, ownerUuid: a.uuid });
    expect(await assignTo(t, other)).toMatchObject({ ruleId: r2.id, ownerUuid: b.uuid });

    // A is offline: rule 1 matches, finds nobody, and the next one takes it
    await h.owner.query(
      `INSERT INTO agent_statuses (org_id, user_id, status) VALUES ($1,$2,'offline')`,
      [t.orgId, a.userId],
    );
    const india2 = await newContact(t, 'x', { phone: '+919800000000' });
    expect(await assignTo(t, india2)).toMatchObject({ ruleId: r2.id, ownerUuid: b.uuid });
    // ...unless the rule does not skip offline people
    // (a firing bumps the row's version: read the current one)
    const current = (await rules(mgr.token).list()).body.data.find(
      (r: { id: string }) => r.id === r1.id,
    );
    expect(
      (await rules(mgr.token).update(r1.id, { rowVersion: current.rowVersion, skipOffline: false }))
        .status,
    ).toBe(200);
    const india3 = await newContact(t, 'x', { phone: '+919811111111' });
    expect(await assignTo(t, india3)).toMatchObject({ ruleId: r1.id, ownerUuid: a.uuid });
    await clean();
  });

  it('nothing matches, or the matching rules find nobody: no owner and the reason is told', async () => {
    await makeRule({
      name: 'Only ads',
      strategy: 'fixed',
      userIds: [a.uuid],
      rules: all(cond('source', 'equals', 'ads')),
    });
    const id = await newContact(t, 'Website');
    expect((await assignTo(t, id)).outcome).toBe('no_rule');
    await away(t, a.userId);
    const ads = await newContact(t, 'ads');
    expect((await assignTo(t, ads)).outcome).toBe('nobody_available');
    expect(await ownerOf(ads)).toBeNull();
    await clean();
  });

  it('round robin is fair and continues after the last person whoever joins or is away; never picks somebody on leave', async () => {
    const rule = await makeRule({
      name: 'Rotation',
      strategy: 'round_robin',
      userIds: [a.uuid, b.uuid, c.uuid],
    });
    const got: number[] = [];
    for (let i = 0; i < 9; i += 1)
      got.push(
        Number(
          await ownerOf(
            await (async () => {
              const id = await newContact(t);
              await assignTo(t, id);
              return id;
            })(),
          ),
        ),
      );
    const count = (u: number) => got.filter((x) => x === u).length;
    expect([count(a.userId), count(b.userId), count(c.userId)]).toEqual([3, 3, 3]);
    expect(got.slice(0, 3)).toEqual([a.userId, b.userId, c.userId]);
    expect(await firedOf(rule.id)).toBe(9);

    await away(t, b.userId);
    const during: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const id = await newContact(t);
      await assignTo(t, id);
      during.push(Number(await ownerOf(id)));
    }
    expect(during).not.toContain(b.userId);
    expect(during.filter((x) => x === a.userId).length).toBe(3);
    expect(during.filter((x) => x === c.userId).length).toBe(3);
    await clean();
  });

  it('least busy gives the record to whoever holds the fewest, ties by rotation', async () => {
    await makeRule({
      name: 'Light load',
      strategy: 'least_busy',
      userIds: [a.uuid, b.uuid, c.uuid],
    });
    await h.owner.query(
      `INSERT INTO contacts (org_id, name, owner_id) SELECT $1, 'x' || g, $2 FROM generate_series(1, 3) g`,
      [t.orgId, a.userId],
    );
    await h.owner.query(
      `INSERT INTO contacts (org_id, name, owner_id) SELECT $1, 'y' || g, $2 FROM generate_series(1, 1) g`,
      [t.orgId, b.userId],
    );
    const first = await newContact(t);
    expect((await assignTo(t, first)).outcome).toBe('assigned');
    expect(Number(await ownerOf(first))).toBe(c.userId); // c holds none
    const second = await newContact(t);
    await assignTo(t, second);
    // c and b now hold one each: the tie goes to the next after c in the rotation
    expect([b.userId, c.userId]).toContain(Number(await ownerOf(second)));
    await h.owner.query(`DELETE FROM contacts WHERE org_id = $1 AND name ~ '^(x|y)'`, [t.orgId]);
    await clean();
  });

  it('a fixed person on leave is replaced by their delegate; with none, or a delegate who is away too, the rule finds nobody', async () => {
    const rule = await makeRule({ name: 'A only', strategy: 'fixed', userIds: [a.uuid] });
    await away(t, a.userId);
    const none = await newContact(t);
    expect((await assignTo(t, none)).outcome).toBe('nobody_available');
    await h.owner.query(
      `INSERT INTO member_delegates (org_id, user_id, delegate_user_id) VALUES ($1,$2,$3)`,
      [t.orgId, a.userId, b.userId],
    );
    const viaDelegate = await newContact(t);
    expect(await assignTo(t, viaDelegate)).toMatchObject({
      outcome: 'assigned',
      ownerUuid: b.uuid,
      ruleId: rule.id,
    });
    await away(t, b.userId).catch(() => undefined);
    const chain = await newContact(t);
    expect((await assignTo(t, chain)).outcome).toBe('nobody_available');
    await back(t);
    const present = await newContact(t);
    expect(await assignTo(t, present)).toMatchObject({ ownerUuid: a.uuid });
    await clean();
  });

  it('never replaces an owner somebody set, not even a deliberate "nobody" afterwards', async () => {
    await makeRule({ name: 'All', strategy: 'fixed', userIds: [a.uuid] });
    const owned = await newContact(t, 'Website', { ownerId: b.userId });
    expect((await assignTo(t, owned)).outcome).toBe('has_owner');
    expect(Number(await ownerOf(owned))).toBe(b.userId);

    // somebody clears the owner right after the contact was created: the stamp says a person touched it
    const cleared = await newContact(t, 'Website', { ownerId: b.userId });
    await h.owner.query(`UPDATE contacts SET owner_id = NULL WHERE uuid = $1`, [cleared]);
    expect((await assignTo(t, cleared)).outcome).toBe('has_owner');
    expect(await ownerOf(cleared)).toBeNull();
    await clean();
  });

  it('imports are assigned only when the workspace asks; the consumer maps events and ignores its own writes', async () => {
    await makeRule({ name: 'All', strategy: 'fixed', userIds: [a.uuid] });
    const imp = await newContact(t);
    await consumer().handle({
      id: '1',
      orgId: t.orgId,
      aggregateModule: 'contacts',
      aggregateId: '1',
      eventType: 'contact.created',
      payload: { uuid: imp, via: 'import' },
    });
    expect(await ownerOf(imp)).toBeNull();
    await enable(true);
    await consumer().handle({
      id: '2',
      orgId: t.orgId,
      aggregateModule: 'contacts',
      aggregateId: '1',
      eventType: 'contact.created',
      payload: { uuid: imp, via: 'import' },
    });
    expect(Number(await ownerOf(imp))).toBe(a.userId);

    // the loop guard: the engine's own contact.updated is flagged and a created event with the flag is ignored
    const flagged = await newContact(t);
    await consumer().handle({
      id: '3',
      orgId: t.orgId,
      aggregateModule: 'contacts',
      aggregateId: '1',
      eventType: 'contact.created',
      payload: { uuid: flagged, autoAssigned: true },
    });
    expect(await ownerOf(flagged)).toBeNull();
    // the engine's own update event is flagged, so it never starts another assignment
    await consumer().handle({
      id: '3b',
      orgId: t.orgId,
      aggregateModule: 'contacts',
      aggregateId: '1',
      eventType: 'contact.updated',
      payload: { uuid: flagged, autoAssigned: true },
    });
    expect(await ownerOf(flagged)).toBeNull();

    // a form that created a contact, and a lead source, name the contact in their own events
    const form = await newContact(t);
    await consumer().handle({
      id: '4',
      orgId: t.orgId,
      aggregateModule: 'forms',
      aggregateId: '1',
      eventType: 'form.submitted',
      payload: { contactId: form, created: true },
    });
    expect(Number(await ownerOf(form))).toBe(a.userId);
    const existing = await newContact(t);
    await consumer().handle({
      id: '5',
      orgId: t.orgId,
      aggregateModule: 'forms',
      aggregateId: '1',
      eventType: 'form.submitted',
      payload: { contactId: existing, created: false },
    });
    expect(await ownerOf(existing)).toBeNull();
    const lead = await newContact(t);
    await consumer().handle({
      id: '6',
      orgId: t.orgId,
      aggregateModule: 'leads',
      aggregateId: '1',
      eventType: 'lead.created',
      payload: { contactId: lead },
    });
    expect(Number(await ownerOf(lead))).toBe(a.userId);
    await clean();
  });

  it('deals: pipeline and value conditions; a deal created with no owner is assigned, one with an owner is not', async () => {
    const { pipeline } = await api.defaultPipeline(t.admin);
    const rule = await makeRule({
      name: 'Big deals',
      subject: 'deal',
      strategy: 'fixed',
      userIds: [c.uuid],
      rules: all(cond('pipeline', 'in', [pipeline.id]), cond('value', 'gte', 1000)),
    });
    const big = await api.deal(t.admin, { title: 'big', value: '5000', ownerId: null });
    const small = await api.deal(t.admin, { title: 'small', value: '10', ownerId: null });
    const owned = await api.deal(t.admin, { title: 'owned', value: '5000', ownerId: b.uuid });
    const ownerOfDeal = async (id: string) =>
      (await h.owner.query(`SELECT owner_user_id FROM deals WHERE uuid = $1`, [id])).rows[0]
        .owner_user_id as number | null;
    expect(await engine().assign(t.orgId, 'deal', big.id, 'manual')).toMatchObject({
      outcome: 'assigned',
      ruleId: rule.id,
    });
    expect(Number(await ownerOfDeal(big.id))).toBe(c.userId);
    expect((await engine().assign(t.orgId, 'deal', small.id, 'manual')).outcome).toBe('no_rule');
    expect((await engine().assign(t.orgId, 'deal', owned.id, 'manual')).outcome).toBe('has_owner');
    expect(
      (
        await h.owner.query(
          `SELECT 1 FROM event_outbox WHERE org_id = $1 AND event_type = 'deal.auto_assigned'`,
          [t.orgId],
        )
      ).rows.length,
    ).toBe(1);
    await clean();
  });

  it('the test box says what would happen without changing anything', async () => {
    await rules(mgr.token).setSettings({ enabled: false });
    const rule = await makeRule({
      name: 'Rot',
      strategy: 'round_robin',
      userIds: [a.uuid, b.uuid],
      rules: all(cond('source', 'equals', 'website')),
    });
    const id = await newContact(t, 'Website');
    const t1 = await rules(mgr.token).test({ subject: 'contact', recordId: id });
    expect(t1.body).toMatchObject({
      enabled: false,
      outcome: 'would_assign',
      rule: { id: rule.id },
    });
    const t2 = await rules(mgr.token).test({ subject: 'contact', recordId: id });
    expect(t2.body.owner.id).toBe(t1.body.owner.id); // the rotation did not move
    expect(await ownerOf(id)).toBeNull();
    expect(await firedOf(rule.id)).toBe(0);
    const ads = await newContact(t, 'ads');
    expect((await rules(mgr.token).test({ subject: 'contact', recordId: ads })).body).toMatchObject(
      {
        outcome: 'no_rule',
        trace: [{ ruleId: rule.id, matched: false }],
      },
    );
    const web = await newContact(t, 'WEBSITE');
    expect((await rules(mgr.token).test({ subject: 'contact', recordId: web })).body.outcome).toBe(
      'would_assign',
    );
    await away(t, a.userId);
    await away(t, b.userId);
    const none = await rules(mgr.token).test({ subject: 'contact', recordId: web });
    expect(none.body).toMatchObject({
      outcome: 'nobody_available',
      skipped: [{ id: rule.id }],
      trace: [{ ruleId: rule.id, matched: true, nobody: true }],
    });
    await back(t);
    const owned = await newContact(t, 'Website', { ownerId: c.userId });
    expect(
      (await rules(mgr.token).test({ subject: 'contact', recordId: owned })).body.outcome,
    ).toBe('has_owner');
    expect((await rules(mgr.token).test({ subject: 'contact' })).status).toBe(422);
    expect(
      (await rules(mgr.token).test({ subject: 'contact', recordId: randomUUID() })).body.outcome,
    ).toBe('not_found');
    await clean();
  });

  it("another workspace's rules and switch never touch this workspace's records", async () => {
    await enable();
    const other = await tenant('ceo');
    const op = await person(other, 'ceop');
    await rules(other.admin).setSettings({ enabled: true });
    expect(
      (
        await rules(other.admin).create({
          name: 'O',
          subject: 'contact',
          strategy: 'fixed',
          userIds: [op.uuid],
        })
      ).status,
    ).toBe(201);
    const mine = await newContact(t);
    expect((await assignTo(t, mine)).outcome).toBe('no_rule');
    const theirs = await newContact(other);
    expect(await assignTo(other, theirs)).toMatchObject({
      outcome: 'assigned',
      ownerUuid: op.uuid,
    });
    // asking this workspace's engine about the other's record is "not found"
    expect((await engine().assign(t.orgId, 'contact', theirs, 'manual')).outcome).toBe('not_found');
    await clean();
  });
});

describe('form and lead-source owner pools skip people on leave', () => {
  it('a rotation skips them; a fixed person is replaced by their delegate; nobody on leave is left untouched', async () => {
    const t = await tenant('cp');
    const a = await person(t, 'cpa');
    const b = await person(t, 'cpb');
    const c = await person(t, 'cpc');
    const pool = [a, b, c].map((p) => ({ id: p.userId, uuid: p.uuid }));
    const db = get(DatabaseService);
    const run = (mode: 'fixed' | 'round_robin', users = pool) =>
      db.txAs({ orgId: t.orgId }, (tx) => ownersAvailable(tx, t.orgId, users, mode));

    expect((await run('round_robin')).map((u) => u.id)).toEqual([a.userId, b.userId, c.userId]);
    await away(t, b.userId);
    expect((await run('round_robin')).map((u) => u.id)).toEqual([a.userId, c.userId]);
    expect((await run('fixed', [pool[1]!])).map((u) => u.id)).toEqual([]);
    await h.owner.query(
      `INSERT INTO member_delegates (org_id, user_id, delegate_user_id) VALUES ($1,$2,$3)`,
      [t.orgId, b.userId, c.userId],
    );
    expect(await run('fixed', [pool[1]!])).toEqual([{ id: c.userId, uuid: c.uuid }]);
    // a rotation does not add the delegate a second share
    expect((await run('round_robin')).map((u) => u.id)).toEqual([a.userId, c.userId]);
    expect(
      await db.txAs({ orgId: t.orgId }, (tx) => ownersAvailable(tx, t.orgId, [], 'fixed')),
    ).toEqual([]);
    expect(
      (await db.txAs({ orgId: t.orgId }, (tx) => ownersAvailable(tx, t.orgId, pool, 'unassigned')))
        .length,
    ).toBe(3);
  });
});

describe('record assignment rules (BL-340..BL-345)', () => {
  let t: Tenant;
  let mgr: Person;
  let a: Person;
  let b: Person;
  let c: Person;

  beforeAll(async () => {
    t = await tenant('cr');
    mgr = await person(t, 'crmgr', MANAGE);
    a = await person(t, 'cra');
    b = await person(t, 'crb');
    c = await person(t, 'crc');
    expect((await rules(mgr.token).setSettings({ enabled: true })).status).toBe(200);
  });
  const clean = async () => {
    await h.owner.query(`DELETE FROM assignment_rules WHERE org_id = $1`, [t.orgId]);
    await h.owner.query(`DELETE FROM assignment_runs WHERE org_id = $1`, [t.orgId]);
  };
  afterEach(clean);
  const make = async (body: Record<string, unknown>) => {
    const r = await rules(mgr.token).create({ subject: 'contact', ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string; rowVersion: number };
  };
  const company = async (
    name: string,
    industry: string | null,
    data: Record<string, unknown> = {},
  ) =>
    (
      await h.owner.query(
        `INSERT INTO companies (org_id, name, industry, data) VALUES ($1,$2,$3,$4::jsonb) RETURNING uuid`,
        [t.orgId, name, industry, JSON.stringify(data)],
      )
    ).rows[0].uuid as string;
  const runs = async (query = '') =>
    (await api.as(mgr.token).get(`/v2/assignment/runs${query}`)).body;

  it('the whole area is a plan feature: a workspace without record_assignment is refused and its engine does nothing', async () => {
    const free = await api.signup('crfree');
    // the test harness has no plan catalogue, so a workspace without the feature is a per-workspace override
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = jsonb_set(overrides, '{features}', '{"record_assignment": false}'::jsonb, true) WHERE org_id = $1`,
      [free.orgId],
    );
    const m = await person(free, 'crfreemgr', MANAGE);
    for (const res of [
      await rules(m.token).list(),
      await rules(m.token).settings(),
      await api.as(m.token).get('/v2/assignment/runs'),
    ]) {
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
    }
    await h.owner.query(`INSERT INTO assignment_settings (org_id, enabled) VALUES ($1, true)`, [
      free.orgId,
    ]);
    const id = await newContact(free);
    expect((await engine().assign(free.orgId, 'contact', id, 'manual')).outcome).toBe('plan');
  });

  it('the migration grants the feature to the plans that carry SLA policies and to no other', async () => {
    const rows = (
      await h.owner.query(
        `SELECT features -> 'inbox_sla' AS sla, features -> 'record_assignment' AS ra FROM plans WHERE kind = 'plan'`,
      )
    ).rows;
    for (const r of rows) expect(r.ra === true).toBe(r.sla === true);
  });

  it('companies: a rule on a built-in field and one on a custom property; the owner is set, audited and announced', async () => {
    const sec = await api
      .as(t.admin)
      .post('/v2/field-sections')
      .send({ moduleKey: 'companies', name: 'Billing' });
    expect(sec.status, JSON.stringify(sec.body)).toBe(201);
    const prop = await api
      .as(t.admin)
      .post('/v2/fields')
      .send({
        moduleKey: 'companies',
        sectionId: sec.body.id,
        label: 'Tier',
        key: 'tier',
        fieldType: 'text',
      });
    expect(prop.status, JSON.stringify(prop.body)).toBe(201);
    const key = prop.body.key as string;

    const byIndustry = await make({
      name: 'Retail',
      subject: 'company',
      strategy: 'fixed',
      userIds: [a.uuid],
      rules: all(cond('industry', 'equals', 'Retail')),
    });
    const byTier = await make({
      name: 'Gold',
      subject: 'company',
      strategy: 'fixed',
      userIds: [b.uuid],
      rules: all(cond(`custom.${key}`, 'equals', 'gold')),
    });
    const retail = await company('R', 'Retail');
    const gold = await company('G', 'Banking', { [key]: 'gold' });
    const none = await company('N', 'Banking');
    expect(await engine().assign(t.orgId, 'company', retail, 'manual')).toMatchObject({
      outcome: 'assigned',
      ruleId: byIndustry.id,
      ownerUuid: a.uuid,
    });
    expect(await engine().assign(t.orgId, 'company', gold, 'manual')).toMatchObject({
      outcome: 'assigned',
      ruleId: byTier.id,
      ownerUuid: b.uuid,
    });
    expect((await engine().assign(t.orgId, 'company', none, 'manual')).outcome).toBe('no_rule');
    expect(
      Number(
        (await h.owner.query(`SELECT owner_id FROM companies WHERE uuid = $1`, [retail])).rows[0]
          .owner_id,
      ),
    ).toBe(a.userId);
    expect(
      (
        await h.owner.query(
          `SELECT 1 FROM audit_log WHERE org_id = $1 AND module = 'companies' AND action = 'company.auto_assigned'`,
          [t.orgId],
        )
      ).rows.length,
    ).toBe(2);
    // a person's choice is final, even for a company left without an owner on purpose
    await h.owner.query(`UPDATE companies SET owner_id = $2 WHERE uuid = $1`, [none, c.userId]);
    await h.owner.query(`UPDATE companies SET owner_id = NULL WHERE uuid = $1`, [none]);
    expect((await engine().assign(t.orgId, 'company', none, 'manual')).outcome).toBe('has_owner');
    // the consumer routes company events
    const viaEvent = await company('E', 'Retail');
    await consumer().handle({
      id: 'c1',
      orgId: t.orgId,
      aggregateModule: 'companies',
      aggregateId: '1',
      eventType: 'company.created',
      payload: { uuid: viaEvent },
    });
    expect(
      Number(
        (await h.owner.query(`SELECT owner_id FROM companies WHERE uuid = $1`, [viaEvent])).rows[0]
          .owner_id,
      ),
    ).toBe(a.userId);
  });

  it('conditions are a tree: AND / OR groups over the module fields, and a field of another module is refused', async () => {
    const r = await make({
      name: 'US with a phone, or Newsletter',
      strategy: 'fixed',
      userIds: [a.uuid],
      rules: all(
        cond('countryCode', 'equals', '+1'),
        any(cond('phone', 'is_not_empty'), cond('source', 'equals', 'Newsletter')),
      ),
    });
    const us = await newContact(t, 'x', { countryCode: '+1', phone: '+14155550123' });
    const usNewsletter = await newContact(t, 'Newsletter', { countryCode: '+1' });
    const usNothing = await newContact(t, 'other', { countryCode: '+1' });
    const india = await newContact(t, 'Newsletter', { countryCode: '+91', phone: '+919812345678' });
    expect((await assignTo(t, us)).outcome).toBe('assigned');
    expect((await assignTo(t, usNewsletter)).outcome).toBe('assigned');
    expect((await assignTo(t, usNothing)).outcome).toBe('no_rule');
    expect((await assignTo(t, india)).outcome).toBe('no_rule');
    const bad = await rules(mgr.token).create({
      name: 'bad',
      subject: 'contact',
      strategy: 'fixed',
      userIds: [a.uuid],
      rules: all(cond('value', 'gte', 5)),
    });
    expect(bad.status).toBe(422);
    const ghost = await rules(mgr.token).update(r.id, {
      rowVersion: r.rowVersion,
      rules: all(cond('custom.does_not_exist', 'equals', 'x')),
    });
    expect(ghost.status).toBe(422);
  });

  it('a rule without conditions is the fallback: it runs after every rule that has some, wherever it sits in the list', async () => {
    const fallback = await make({ name: 'Everyone else', strategy: 'fixed', userIds: [c.uuid] });
    const web = await make({
      name: 'Website',
      strategy: 'fixed',
      userIds: [a.uuid],
      rules: all(cond('source', 'equals', 'Website')),
    });
    const list = (await rules(mgr.token).list()).body.data as Array<{
      id: string;
      priority: number | null;
      isFallback: boolean;
    }>;
    expect(list.find((r) => r.id === fallback.id)).toMatchObject({ isFallback: true, priority: 2 });
    expect(list.find((r) => r.id === web.id)).toMatchObject({ isFallback: false, priority: 1 });
    expect(await assignTo(t, await newContact(t, 'Website'))).toMatchObject({ ruleId: web.id });
    expect(await assignTo(t, await newContact(t, 'elsewhere'))).toMatchObject({
      ruleId: fallback.id,
    });
  });

  it('pause, activate and clone: a paused rule is not prioritised and never runs; a clone is paused and last', async () => {
    const r = await make({ name: 'W', strategy: 'fixed', userIds: [a.uuid] });
    const paused = await api.as(mgr.token).post(`/v2/assignment/rules/${r.id}/pause`);
    expect(paused.body).toMatchObject({ isActive: false, priority: null });
    expect((await assignTo(t, await newContact(t))).outcome).toBe('no_rule');
    const active = await api.as(mgr.token).post(`/v2/assignment/rules/${r.id}/activate`);
    expect(active.body).toMatchObject({ isActive: true, priority: 1 });
    expect(active.body.lastModifiedBy).toMatchObject({ id: mgr.uuid });
    const copy = await api
      .as(mgr.token)
      .post(`/v2/assignment/rules/${r.id}/clone`)
      .set('idempotency-key', randomUUID());
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    expect(copy.body).toMatchObject({
      name: 'W (copy)',
      isActive: false,
      position: 2,
      priority: null,
    });
    expect(await assignTo(t, await newContact(t))).toMatchObject({ ruleId: r.id });
  });

  it('least busy counts the module: companies owned here', async () => {
    const rule = await make({
      name: 'LB',
      subject: 'company',
      strategy: 'least_busy',
      userIds: [a.uuid, b.uuid],
    });
    // a already holds two companies, b none: the next company goes to b
    for (const n of ['L1', 'L2']) {
      const id = await company(n, null);
      await h.owner.query(`UPDATE companies SET owner_id = $2 WHERE uuid = $1`, [id, a.userId]);
    }
    const next = await company('L3', null);
    expect(await engine().assign(t.orgId, 'company', next, 'manual')).toMatchObject({
      ruleId: rule.id,
      ownerUuid: b.uuid,
    });
  });

  it('the run log tells why: assigned with the trace, owner already set, nobody available, no rule; filters, paging, retention', async () => {
    const miss = await make({
      name: 'Ads',
      strategy: 'fixed',
      userIds: [a.uuid],
      rules: all(cond('source', 'equals', 'ads')),
    });
    const web = await make({
      name: 'Web',
      strategy: 'fixed',
      userIds: [b.uuid],
      rules: all(cond('source', 'equals', 'web')),
    });
    const id = await newContact(t, 'web');
    await assignTo(t, id);
    const owned = await newContact(t, 'web', { ownerId: c.userId });
    await assignTo(t, owned);
    await assignTo(t, await newContact(t, 'zzz'));
    await away(t, b.userId);
    await assignTo(t, await newContact(t, 'web'));
    await back(t);

    const log = (await runs('?limit=10')).data as Array<Record<string, any>>;
    expect(log.map((x) => x.reason)).toEqual([
      'nobody_available',
      'no_rule',
      'has_owner',
      'matched',
    ]);
    const matched = log[3]!;
    expect(matched).toMatchObject({
      outcome: 'assigned',
      ruleId: web.id,
      ruleName: 'Web',
      method: 'fixed',
      trigger: 'created',
      owner: { id: b.uuid },
    });
    expect(matched.record).toMatchObject({ id });
    expect(
      matched.trace.map((x: { ruleId: string; matched: boolean }) => [x.ruleId, x.matched]),
    ).toEqual([
      [miss.id, false],
      [web.id, true],
    ]);
    expect(log[0]!.trace.find((x: { ruleId: string }) => x.ruleId === web.id)).toMatchObject({
      matched: true,
      nobody: true,
    });
    expect((await runs('?outcome=assigned')).data).toHaveLength(1);
    expect((await runs(`?subject=contact&recordId=${id}`)).data).toHaveLength(1);
    const first = await runs('?limit=2');
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect((await runs(`?limit=2&cursor=${first.nextCursor}`)).data).toHaveLength(2);
    expect((await runs(`?ruleId=${web.id}`)).data.length).toBeGreaterThan(0);

    // retention: older than 90 days goes, nothing else
    await h.owner.query(
      `UPDATE assignment_runs SET created_at = now() - interval '91 days'
       WHERE org_id = $1 AND id = (SELECT min(id) FROM assignment_runs WHERE org_id = $1)`,
      [t.orgId],
    );
    const count = async () =>
      Number(
        (
          await h.owner.query(`SELECT count(*) AS n FROM assignment_runs WHERE org_id = $1`, [
            t.orgId,
          ])
        ).rows[0].n,
      );
    const before = await count();
    await new AssignmentRunSweepService(
      get(DatabaseService),
      new ContactAssignmentRepository(),
    ).sweep();
    expect(await count()).toBe(before - 1);
  });

  it('reassign on update (default off): a record the engine assigned moves when an edit makes a higher rule match, never one a person took over', async () => {
    const low = await make({ name: 'Everyone', strategy: 'fixed', userIds: [a.uuid] });
    const id = await newContact(t, 'plain');
    expect(await assignTo(t, id)).toMatchObject({ ruleId: low.id });
    const vip = await make({
      name: 'VIP',
      strategy: 'fixed',
      userIds: [b.uuid],
      rules: all(cond('source', 'equals', 'vip')),
    });
    await h.owner.query(`UPDATE contacts SET source = 'vip' WHERE uuid = $1`, [id]);
    // off by default: the owner stays
    expect((await engine().assign(t.orgId, 'contact', id, 'manual', 'updated')).outcome).toBe(
      'has_owner',
    );
    const cur = (await rules(mgr.token).list()).body.data.find(
      (r: { id: string }) => r.id === vip.id,
    );
    expect(
      (
        await rules(mgr.token).update(vip.id, {
          rowVersion: cur.rowVersion,
          reassignOnUpdate: true,
        })
      ).status,
    ).toBe(200);
    expect(await engine().assign(t.orgId, 'contact', id, 'manual', 'updated')).toMatchObject({
      outcome: 'reassigned',
      ruleId: vip.id,
      ownerUuid: b.uuid,
    });
    expect(Number(await ownerOf(id))).toBe(b.userId);
    // the same rule matching again changes nothing
    expect((await engine().assign(t.orgId, 'contact', id, 'manual', 'updated')).outcome).toBe(
      'unchanged',
    );
    // a person takes over: the engine never touches it again
    await h.owner.query(`UPDATE contacts SET owner_id = $2 WHERE uuid = $1`, [id, c.userId]);
    expect((await engine().assign(t.orgId, 'contact', id, 'manual', 'updated')).outcome).toBe(
      'has_owner',
    );
    expect(Number(await ownerOf(id))).toBe(c.userId);
    // an edit also assigns a record that never had an owner
    const late = await newContact(t, 'vip');
    expect(await engine().assign(t.orgId, 'contact', late, 'manual', 'updated')).toMatchObject({
      outcome: 'assigned',
    });
    expect(((await runs('?outcome=reassigned')).data as unknown[]).length).toBe(1);
  });
});
