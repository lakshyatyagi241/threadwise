import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNCONTACTED_DEFAULTS } from '@crm/contracts';
import { ContactTouchService } from '../../../src/modules/crm';
import { ContactsService } from '../../../src/modules/crm';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * Uncontacted leads (BL-290) end to end on real Postgres: the settings document (defaults, versions, permission, audit), what clears
 * the marker, what sets it, the manual and bulk actions, the list filter, record scopes and tenant isolation. With the default settings
 * nothing about a contact changes on its own.
 */
let h: Harness;
let api: Api;
let touch: ContactTouchService;
let db: DatabaseService;
let contactsSvc: ContactsService;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  touch = h.app.get(ContactTouchService);
  db = h.app.get(DatabaseService);
  contactsSvc = h.app.get(ContactsService);
}, 1_500_000);

afterAll(async () => {
  await h?.stop();
});

let n = 0;
const phone = () => `+9198${String(30_000_000 + n++)}`;

const settingsUrl = '/v2/lead-handling/settings/uncontacted';
const save = (t: Tenant, body: Record<string, unknown>) =>
  api.as(t.admin).put(settingsUrl).send(body);

const create = async (t: Tenant, body: Record<string, unknown> = {}, token = t.admin) => {
  const res = await api
    .as(token)
    .post('/v2/contacts')
    .send({ firstName: 'Lead', phone: phone(), ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; rowVersion: number; uncontactedSince: string | null };
};
const read = async (t: Tenant, id: string, token = t.admin) =>
  (await api.as(token).get(`/v2/contacts/${id}`)).body as {
    id: string;
    rowVersion: number;
    uncontactedSince: string | null;
  };
const internalId = async (uuid: string) =>
  Number((await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [uuid])).rows[0].id);
const since = async (uuid: string) =>
  (await h.owner.query(`SELECT uncontacted_since FROM contacts WHERE uuid = $1`, [uuid])).rows[0]
    .uncontacted_since as Date | null;
const mark = async (uuid: string) =>
  h.owner.query(`UPDATE contacts SET uncontacted_since = now() WHERE uuid = $1`, [uuid]);

/** A touch from a worker-like caller: no request context, the way a message dispatch or a campaign reaches the service. */
const touchAs = async (
  t: Tenant,
  uuid: string,
  source: 'contact_button' | 'message' | 'automation' | 'activity',
) => {
  const id = await internalId(uuid);
  const run = () => db.txAs({ orgId: t.orgId }, (tx) => touch.touch(tx, t.orgId, id, source));
  // A timeline entry only counts when a person wrote it, so that touch is made as one.
  if (source === 'activity') {
    await RequestContextStore.run(
      {
        requestId: 'e2e',
        orgId: t.orgId,
        actorType: 'user',
        actorId: t.adminUserId,
        userId: t.adminUserId,
      },
      run,
    );
  } else await run();
};

const uncontactedAudits = async (t: Tenant) =>
  Number(
    (
      await h.owner.query(
        `SELECT count(*) AS n FROM audit_log WHERE org_id = $1 AND module = 'contacts' AND delta ? 'uncontactedSince'`,
        [t.orgId],
      )
    ).rows[0].n,
  );

describe('the settings document', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ucs');
  });

  it('reads as the defaults before anything is saved, with no version', async () => {
    const res = await api.as(t.admin).get('/v2/lead-handling/settings');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.uncontacted).toMatchObject({ ...UNCONTACTED_DEFAULTS, rowVersion: null });
  });

  it('is saved with a version: first save has none, a stale or missing one is 409', async () => {
    const body = { ...UNCONTACTED_DEFAULTS, onReassign: 'mark' };
    const first = await save(t, body);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ onReassign: 'mark', rowVersion: 1 });

    expect((await save(t, body)).status).toBe(409);
    expect((await save(t, { ...body, rowVersion: 7 })).status).toBe(409);
    const second = await save(t, { ...body, onReassign: 'keep', rowVersion: 1 });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ onReassign: 'keep', rowVersion: 2 });
    const got = await api.as(t.admin).get('/v2/lead-handling/settings');
    expect(got.body.uncontacted).toMatchObject({ onReassign: 'keep', rowVersion: 2 });
  });

  it('writes an audit row with the changed fields and an outbox event for every save', async () => {
    const audits = await h.owner.query(
      `SELECT action, delta FROM audit_log WHERE org_id = $1 AND module = 'lead_followup_settings' ORDER BY id`,
      [t.orgId],
    );
    expect(audits.rows.map((r) => r.action)).toEqual(['insert', 'update']);
    expect(audits.rows[0].delta.onReassign).toEqual({ old: 'keep', new: 'mark' });
    expect(audits.rows[1].delta.onReassign).toEqual({ old: 'mark', new: 'keep' });
    expect(await api.events(t.orgId, 'lead_handling.settings_changed')).toHaveLength(2);
  });

  it('refuses a malformed document', async () => {
    expect((await save(t, { clearOn: {} })).status).toBe(422);
  });

  it('needs admin.settings.manage to read or write; a contacts editor cannot', async () => {
    const m = await api.member(t, 'ed', [['record.contacts.update']]);
    expect((await api.as(m.token).get('/v2/lead-handling/settings')).status).toBe(403);
    expect(
      (
        await api
          .as(m.token)
          .put(settingsUrl)
          .send({ ...UNCONTACTED_DEFAULTS, rowVersion: 2 })
      ).status,
    ).toBe(403);
  });

  it('is private to the workspace: another one still reads the defaults', async () => {
    const other = await api.signup('ucs2');
    const res = await api.as(other.admin).get('/v2/lead-handling/settings');
    expect(res.body.uncontacted).toMatchObject({ ...UNCONTACTED_DEFAULTS, rowVersion: null });
  });
});

describe('with the default settings nothing changes on its own', () => {
  it('creating, reassigning and adding to the timeline never touch the marker, and write no extra rows', async () => {
    const t = await api.signup('ucd');
    const a = await api.member(t, 'asha', [['record.contacts.update'], ['record.contacts.read']]);
    const c = await create(t);
    expect(c.uncontactedSince).toBeNull();
    const ashaUuid = (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [a.userId]))
      .rows[0].uuid;
    const moved = await api
      .as(t.admin)
      .post('/v2/contacts/assignee')
      .send({ ids: [c.id], ownerId: ashaUuid });
    expect(moved.status, JSON.stringify(moved.body)).toBeLessThan(300);
    const note = await api.as(t.admin).post(`/v2/contacts/${c.id}/notes`).send({ body: 'called' });
    expect(note.status, JSON.stringify(note.body)).toBeLessThan(300);
    await touchAs(t, c.id, 'message');
    expect(await since(c.id)).toBeNull();
    expect(await uncontactedAudits(t)).toBe(0);
    expect(await api.events(t.orgId, 'contact.uncontacted_changed')).toHaveLength(0);
  });
});

describe('what sets the marker', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ucn');
  });
  const turnOn = async (markNew: Record<string, boolean>, onReassign: 'keep' | 'mark' = 'keep') => {
    const cur = (await api.as(t.admin).get('/v2/lead-handling/settings')).body.uncontacted as {
      rowVersion: number | null;
    };
    const res = await save(t, {
      ...UNCONTACTED_DEFAULTS,
      markNew: { ...UNCONTACTED_DEFAULTS.markNew, ...markNew },
      onReassign,
      ...(cur.rowVersion ? { rowVersion: cur.rowVersion } : {}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };

  it('a contact a person creates is uncontacted only when "created manually" is on', async () => {
    await turnOn({ manual: false });
    expect((await create(t)).uncontactedSince).toBeNull();
    await turnOn({ manual: true });
    const c = await create(t);
    expect(c.uncontactedSince).not.toBeNull();
    expect(await since(c.id)).not.toBeNull();
  });

  it('a person-created contact that already exists (matched by phone) is not flipped', async () => {
    const existing = await create(t);
    await h.owner.query(`UPDATE contacts SET uncontacted_since = NULL WHERE uuid = $1`, [
      existing.id,
    ]);
    const again = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({
        firstName: 'Lead',
        phone: (await h.owner.query(`SELECT phone FROM contacts WHERE uuid = $1`, [existing.id]))
          .rows[0].phone,
      });
    expect(again.body.id).toBe(existing.id);
    expect(await since(existing.id)).toBeNull();
  });

  it('a lead source or a form creating a contact marks it under "external lead sources"; a test lead and an inbound message never', async () => {
    await turnOn({ manual: false, leadSource: false });
    const resolve = async (origin: string | undefined, quiet = false) => {
      const value = phone();
      const res = await RequestContextStore.run(
        { requestId: 'e2e', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
        () =>
          db.txAs({ orgId: t.orgId }, (tx) =>
            contactsSvc.resolveOrCreateByIdentity(tx, t.orgId, {
              kind: 'phone',
              value,
              name: 'Inbound',
              quiet,
              ...(origin ? { eventPayload: { origin } } : {}),
            }),
          ),
      );
      expect(res.outcome).toBe('created');
      return (res as { uuid: string }).uuid;
    };
    expect(await since(await resolve('lead'))).toBeNull();
    await turnOn({ leadSource: true });
    expect(await since(await resolve('lead'))).not.toBeNull();
    expect(await since(await resolve('form'))).not.toBeNull();
    expect(await since(await resolve('lead', true))).toBeNull();
    expect(await since(await resolve(undefined))).toBeNull();
  });

  it('an owner change marks the contact only when "mark on reassign" is on, and only for a real new owner', async () => {
    const asha = await api.member(t, 'asha', [
      ['record.contacts.read'],
      ['record.contacts.update'],
    ]);
    const ashaUuid = (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [asha.userId]))
      .rows[0].uuid as string;
    await turnOn({ manual: false, leadSource: false }, 'keep');
    const a = await create(t);
    await api
      .as(t.admin)
      .post('/v2/contacts/assignee')
      .send({ ids: [a.id], ownerId: ashaUuid });
    expect(await since(a.id)).toBeNull();

    await turnOn({ manual: false, leadSource: false }, 'mark');
    const b = await create(t);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/contacts/assignee')
          .send({ ids: [b.id], ownerId: ashaUuid })
      ).status,
    ).toBeLessThan(300);
    expect(await since(b.id)).not.toBeNull();

    // unassigning is not an assignment
    const c = await create(t);
    await api
      .as(t.admin)
      .post('/v2/contacts/assignee')
      .send({ ids: [c.id], ownerId: null });
    expect(await since(c.id)).toBeNull();

    // the bulk route and the edit form do the same
    const d = await create(t);
    const bulk = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/owner')
      .send({ ids: [d.id], ownerId: ashaUuid });
    expect(bulk.status, JSON.stringify(bulk.body)).toBe(200);
    expect(await since(d.id)).not.toBeNull();
    const e = await create(t);
    const edit = await api
      .as(t.admin)
      .patch(`/v2/contacts/${e.id}`)
      .send({ ownerId: ashaUuid, rowVersion: e.rowVersion });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(await since(e.id)).not.toBeNull();
  });
});

describe('what clears the marker', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ucc');
  });

  it('each kind of touch is governed by its own toggle', async () => {
    for (const [source, key] of [
      ['contact_button', 'contactButton'],
      ['message', 'message'],
      ['automation', 'automation'],
      ['activity', 'activity'],
    ] as const) {
      const c = await create(t);
      await mark(c.id);
      // all four off: nothing clears
      const cur = (await api.as(t.admin).get('/v2/lead-handling/settings')).body.uncontacted as {
        rowVersion: number | null;
      };
      const off = { contactButton: false, message: false, automation: false, activity: false };
      await save(t, {
        ...UNCONTACTED_DEFAULTS,
        clearOn: off,
        ...(cur.rowVersion ? { rowVersion: cur.rowVersion } : {}),
      });
      await touchAs(t, c.id, source);
      expect(await since(c.id), `${source} with its toggle off`).not.toBeNull();

      const v = (await api.as(t.admin).get('/v2/lead-handling/settings')).body.uncontacted
        .rowVersion as number;
      await save(t, { ...UNCONTACTED_DEFAULTS, clearOn: { ...off, [key]: true }, rowVersion: v });
      await touchAs(t, c.id, source);
      expect(await since(c.id), `${source} with its toggle on`).toBeNull();
      const v2 = (await api.as(t.admin).get('/v2/lead-handling/settings')).body.uncontacted
        .rowVersion as number;
      await save(t, { ...UNCONTACTED_DEFAULTS, rowVersion: v2 });
    }
  });

  it('is idempotent: a second touch changes nothing and writes no second audit row or event', async () => {
    const c = await create(t);
    await mark(c.id);
    const before = await uncontactedAudits(t);
    const events = (await api.events(t.orgId, 'contact.uncontacted_changed')).length;
    await touchAs(t, c.id, 'message');
    await touchAs(t, c.id, 'message');
    expect(await since(c.id)).toBeNull();
    expect(await uncontactedAudits(t)).toBe(before + 1);
    expect(await api.events(t.orgId, 'contact.uncontacted_changed')).toHaveLength(events + 1);
    const last = (await api.events(t.orgId, 'contact.uncontacted_changed')).at(-1)!;
    expect(last).toMatchObject({ uuid: c.id, uncontacted: false, cause: 'message' });
  });

  it('does not move the contact version, so an open edit form is not 409ed by a colleague reply', async () => {
    const c = await create(t);
    await mark(c.id);
    const before = await read(t, c.id);
    await touchAs(t, c.id, 'message');
    const after = await read(t, c.id);
    expect(after.uncontactedSince).toBeNull();
    expect(after.rowVersion).toBe(before.rowVersion);
  });

  it('a note or timeline activity a person adds clears it; the "contact button" endpoint clears it', async () => {
    const a = await create(t);
    await mark(a.id);
    const note = await api
      .as(t.admin)
      .post(`/v2/contacts/${a.id}/notes`)
      .send({ body: 'spoke to them' });
    expect(note.status, JSON.stringify(note.body)).toBeLessThan(300);
    expect(await since(a.id)).toBeNull();

    const b = await create(t);
    await mark(b.id);
    const act = await api
      .as(t.admin)
      .post(`/v2/contacts/${b.id}/activities`)
      .send({ activityType: 'call', title: 'Called' });
    expect(act.status, JSON.stringify(act.body)).toBeLessThan(300);
    expect(await since(b.id)).toBeNull();

    const c = await create(t);
    await mark(c.id);
    const pressed = await api
      .as(t.admin)
      .post(`/v2/contacts/${c.id}/touch`)
      .send({ channel: 'whatsapp' });
    expect(pressed.status, JSON.stringify(pressed.body)).toBe(200);
    expect(pressed.body).toEqual({ uncontacted: false });
    expect(await since(c.id)).toBeNull();
  });

  it('an activity written by a system actor is not a person reaching out', async () => {
    const c = await create(t);
    await mark(c.id);
    const id = await internalId(c.id);
    await RequestContextStore.run(
      { requestId: 'e2e', orgId: t.orgId, actorType: 'api_key', actorId: null, userId: null },
      () => db.txAs({ orgId: t.orgId }, (tx) => touch.touch(tx, t.orgId, id, 'activity')),
    );
    expect(await since(c.id)).not.toBeNull();
  });

  it('a hook failure never fails the action it belongs to', async () => {
    const id = await internalId((await create(t)).id);
    await expect(
      db.txAs({ orgId: t.orgId }, async (tx) => {
        await touch.touch(tx, t.orgId, id + 9_999_999, 'message');
        await touch.markNew(tx, t.orgId, id + 9_999_999, 'manual');
        await touch.afterReassign(tx, t.orgId, [id + 9_999_999]);
      }),
    ).resolves.toBeUndefined();
  });
});

describe('by hand: one contact and a selection', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ucm');
  });

  it('marks and unmarks one contact; the same state twice is a no-op with one audit row', async () => {
    const c = await create(t);
    const on = await api
      .as(t.admin)
      .put(`/v2/contacts/${c.id}/uncontacted`)
      .send({ uncontacted: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body).toEqual({ uncontacted: true });
    await api.as(t.admin).put(`/v2/contacts/${c.id}/uncontacted`).send({ uncontacted: true });
    expect(await uncontactedAudits(t)).toBe(1);
    expect((await read(t, c.id)).uncontactedSince).not.toBeNull();
    const off = await api
      .as(t.admin)
      .put(`/v2/contacts/${c.id}/uncontacted`)
      .send({ uncontacted: false });
    expect(off.body).toEqual({ uncontacted: false });
    expect((await read(t, c.id)).uncontactedSince).toBeNull();
  });

  it('an unknown contact is 404', async () => {
    const res = await api
      .as(t.admin)
      .put(`/v2/contacts/00000000-0000-4000-8000-000000000009/uncontacted`)
      .send({ uncontacted: true });
    expect(res.status).toBe(404);
  });

  it('the list filter and the bulk action work on ids and on a filter, and report what changed', async () => {
    const ids = [(await create(t)).id, (await create(t)).id, (await create(t)).id];
    const marked = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/uncontacted')
      .send({ ids: ids.slice(0, 2), uncontacted: true });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    expect(marked.body).toMatchObject({ matched: 2, changed: 2 });
    const again = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/uncontacted')
      .send({ ids: ids.slice(0, 2), uncontacted: true });
    expect(again.body).toMatchObject({ matched: 2, changed: 0 });

    const list = await api.as(t.admin).get('/v2/contacts?uncontacted=true&limit=100');
    const got = (list.body.data as Array<{ id: string }>).map((c) => c.id);
    expect(got.sort()).toEqual(ids.slice(0, 2).sort());
    const rest = await api.as(t.admin).get('/v2/contacts?uncontacted=false&limit=100');
    expect((rest.body.data as Array<{ id: string }>).map((c) => c.id)).toContain(ids[2]);

    const cleared = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/uncontacted')
      .send({ filter: { uncontacted: true }, uncontacted: false });
    expect(cleared.body).toMatchObject({ matched: 2, changed: 2 });
    expect(
      ((await api.as(t.admin).get('/v2/contacts?uncontacted=true')).body.data as unknown[]).length,
    ).toBe(0);
    expect(await uncontactedAudits(t)).toBeGreaterThanOrEqual(4);
  });
});

describe('scopes and tenants', () => {
  it("a member limited to their own contacts cannot touch, mark or bulk-mark someone else's contact", async () => {
    const t = await api.signup('ucsc');
    const asha = await api.member(t, 'asha', [
      ['record.contacts.read', 'own'],
      ['record.contacts.update', 'own'],
    ]);
    const ashaUuid = (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [asha.userId]))
      .rows[0].uuid as string;
    const mine = await create(t, { ownerId: ashaUuid });
    const theirs = await create(t);
    await mark(theirs.id);

    expect(
      (await api.as(asha.token).post(`/v2/contacts/${theirs.id}/touch`).send({ channel: 'call' }))
        .status,
    ).toBe(404);
    expect(
      (
        await api
          .as(asha.token)
          .put(`/v2/contacts/${theirs.id}/uncontacted`)
          .send({ uncontacted: false })
      ).status,
    ).toBe(404);
    expect(await since(theirs.id)).not.toBeNull();

    const bulk = await api
      .as(asha.token)
      .post('/v2/contacts/bulk/uncontacted')
      .send({ ids: [mine.id, theirs.id], uncontacted: false });
    expect(bulk.status, JSON.stringify(bulk.body)).toBe(200);
    expect(bulk.body.failedCount).toBe(1);
    expect(await since(theirs.id)).not.toBeNull();

    expect(
      (
        await api
          .as(asha.token)
          .put(`/v2/contacts/${mine.id}/uncontacted`)
          .send({ uncontacted: true })
      ).status,
    ).toBe(200);
  });

  it("another workspace cannot reach a contact, and one workspace's settings never act on another's contacts", async () => {
    const a = await api.signup('uct1');
    const b = await api.signup('uct2');
    await save(a, {
      ...UNCONTACTED_DEFAULTS,
      markNew: { manual: true, import: true, leadSource: true },
    });
    const ca = await create(a);
    const cb = await create(b);
    expect(ca.uncontactedSince).not.toBeNull();
    expect(cb.uncontactedSince).toBeNull();
    expect(
      (await api.as(b.admin).put(`/v2/contacts/${ca.id}/uncontacted`).send({ uncontacted: false }))
        .status,
    ).toBe(404);
    expect(
      (await api.as(b.admin).post(`/v2/contacts/${ca.id}/touch`).send({ channel: 'sms' })).status,
    ).toBe(404);
    const bulk = await api
      .as(b.admin)
      .post('/v2/contacts/bulk/uncontacted')
      .send({ ids: [ca.id], uncontacted: false });
    expect(bulk.body.matched).toBe(0);
    expect(await since(ca.id)).not.toBeNull();
  });
});
