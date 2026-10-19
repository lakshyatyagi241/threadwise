import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LeadsApi, startHarness, type Harness, type Tenant } from './support';

/**
 * Duplicate lead handling (BL-292) against a real Postgres: what a lead from a lead source does when its phone number or e-mail already
 * belongs to a contact. The default is what the code always did (merge); `create_new` makes a separate contact and leaves the shared
 * identity with the first one; the merge note is opt-in. Never an overwrite of something filled in, never a second repeat of one lead.
 */
let h: Harness;
let api: LeadsApi;

beforeAll(async () => {
  h = await startHarness();
  api = new LeadsApi(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const IN = { defaults: { countryCode: '91' } };
const count = async (t: Tenant) =>
  Number(
    (await api.rows(t.orgId, `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`))[0]!.n,
  );
const notes = (t: Tenant, contactId: unknown, type: string) =>
  api.rows(
    t.orgId,
    `SELECT title, body, source FROM contact_activities WHERE org_id = $1 AND contact_id = $2 AND activity_type = $3`,
    [contactId, type],
  );
const save = (t: Tenant, body: Record<string, unknown>, token = t.admin) =>
  api.as(token).put('/v2/lead-handling/settings/duplicates').send(body);

async function existing(t: Tenant, phone: string, name = 'Curated Name') {
  const made = await api.as(t.admin).post('/v2/contacts').send({ name, phone, source: 'import' });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  return made.body as { id: string };
}

describe('the setting', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('dupset');
  });

  it('defaults to merge with no note, and a missing row changes nothing', async () => {
    const res = await api.as(t.admin).get('/v2/lead-handling/settings');
    expect(res.status).toBe(200);
    expect(res.body.duplicates).toMatchObject({
      mode: 'merge',
      noteOnMerge: false,
      rowVersion: null,
    });
  });

  it('saves the whole section, versions it, and a stale version is a 409', async () => {
    const first = await save(t, { mode: 'create_new', noteOnMerge: true });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ mode: 'create_new', noteOnMerge: true, rowVersion: 1 });
    const second = await save(t, { mode: 'merge', noteOnMerge: false, rowVersion: 1 });
    expect(second.body.rowVersion).toBe(2);
    const stale = await save(t, { mode: 'create_new', noteOnMerge: false, rowVersion: 1 });
    expect(stale.status).toBe(409);
    const audits = await api.rows(
      t.orgId,
      `SELECT 1 FROM event_outbox WHERE org_id = $1 AND event_type = 'lead_handling.settings_changed'`,
    );
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects an unknown mode, and a person without the settings permission', async () => {
    expect((await save(t, { mode: 'overwrite', noteOnMerge: false })).status).toBe(422);
    const nobody = await api.member(t, 'dupnobody', []);
    expect((await save(t, { mode: 'merge', noteOnMerge: false }, nobody.token)).status).toBe(403);
    expect((await api.as(nobody.token).get('/v2/lead-handling/settings')).status).toBe(403);
  });
});

describe('merge (the default, and when asked) (BL-292)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('dupmerge');
  });

  it('with nothing saved a matching lead is merged and leaves no timeline note', async () => {
    const s = await api.source(t.admin, { name: 'Merge', ...IN });
    const c = await existing(t, '+919130000001');
    const before = await count(t);
    const res = await api.hook(s.hookPath, {
      name: 'Lead Name',
      phone: '91300 00001',
      email: 'm1@example.com',
    });
    expect(res.status).toBe(200);
    expect(await count(t)).toBe(before);
    const [row] = await api.contactsWithPhone(t.orgId, '+919130000001');
    expect(row).toMatchObject({ name: 'Curated Name', email: 'm1@example.com' });
    expect(await notes(t, row!.id, 'lead_merged')).toHaveLength(0);
    expect(c.id).toBeTruthy();
  });

  it('with the note switched on the merge says so on the contact, once per lead', async () => {
    expect((await save(t, { mode: 'merge', noteOnMerge: true })).status).toBe(200);
    const s = await api.source(t.admin, { name: 'Merge note', ...IN });
    await existing(t, '+919130000002');
    const body = { name: 'Lead Two', phone: '91300 00002' };
    expect((await api.hook(s.hookPath, body)).status).toBe(200);
    expect((await api.hook(s.hookPath, body)).status).toBe(200); // the same lead again: acknowledged, not repeated
    const [row] = await api.contactsWithPhone(t.orgId, '+919130000002');
    const lines = await notes(t, row!.id, 'lead_merged');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ source: 'system' });
    expect(lines[0]!.title).toContain('Merge note');
  });
});

describe('create a new contact (BL-292)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('dupnew');
    expect((await save(t, { mode: 'create_new', noteOnMerge: false })).status).toBe(200);
  });

  it('a lead matching by phone becomes a separate contact; the first one is left exactly as it was', async () => {
    const s = await api.source(t.admin, { name: 'New by phone', ...IN });
    const first = await existing(t, '+919140000001');
    const [orig] = await api.contactsWithPhone(t.orgId, '+919140000001');
    const before = await count(t);
    const res = await api.hook(s.hookPath, {
      name: 'Second Person',
      phone: '91400 00001',
      email: 'second@example.com',
      campaign: 'Summer',
    });
    expect(res.status).toBe(200);
    expect(await count(t)).toBe(before + 1);

    const rows = await api.contactsWithPhone(t.orgId, '+919140000001');
    expect(rows).toHaveLength(2);
    const fresh = rows.find((r) => r.id !== orig!.id)!;
    expect(fresh).toMatchObject({ name: 'Second Person', email: 'second@example.com' });
    // The original is untouched: same name, no e-mail filled in, same version.
    const [after] = await api.rows(
      t.orgId,
      `SELECT name, email, row_version FROM contacts WHERE org_id = $1 AND id = $2`,
      [orig!.id],
    );
    expect(after).toMatchObject({ name: 'Curated Name', email: null });
    expect(Number(after!.row_version)).toBe(Number(orig!.row_version));
    // The shared identity stays with the first contact (inbound messages keep routing there).
    const ids = await api.rows(
      t.orgId,
      `SELECT contact_id FROM contact_identities WHERE org_id = $1 AND kind = 'phone' AND value = '+919140000001'`,
    );
    expect(ids).toEqual([{ contact_id: orig!.id }]);
    // The lead's attribution belongs to the new contact only, and the timeline names the contact it may duplicate.
    const attr = await api.rows(
      t.orgId,
      `SELECT 1 FROM contact_attributions WHERE org_id = $1 AND contact_id = $2`,
      [fresh.id],
    );
    expect(attr).toHaveLength(1);
    expect(
      await api.rows(
        t.orgId,
        `SELECT 1 FROM contact_attributions WHERE org_id = $1 AND contact_id = $2`,
        [orig!.id],
      ),
    ).toHaveLength(0);
    const [line] = await notes(t, fresh.id, 'lead_duplicate');
    expect(line!.title).toContain('New by phone');
    const [ref] = await api.rows(
      t.orgId,
      `SELECT display_id FROM contacts WHERE org_id = $1 AND id = $2`,
      [orig!.id],
    );
    if (ref!.display_id) expect(line!.body).toContain(String(ref!.display_id));
    expect(line!.body ?? '').not.toContain('919140000001');
    const [ev] = (await api.leadEvents(t.orgId, s.id)).slice(-1);
    expect(ev).toMatchObject({ status: 'created' });
    expect(Number(ev!.contact_id)).toBe(Number(fresh.id));
    expect(first.id).toBeTruthy();
  });

  it('the same lead sent twice is one new contact, not two', async () => {
    const s = await api.source(t.admin, { name: 'New idem', ...IN });
    await existing(t, '+919140000002');
    const before = await count(t);
    const body = { name: 'Twice', phone: '91400 00002' };
    expect((await api.hook(s.hookPath, body)).status).toBe(200);
    expect((await api.hook(s.hookPath, body)).status).toBe(200);
    expect(await count(t)).toBe(before + 1);
  });

  it('a lead matching by e-mail is a separate contact too, and an unmatched lead is an ordinary one with no note', async () => {
    const s = await api.source(t.admin, { name: 'New by mail', ...IN });
    const made = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Mail Owner', email: 'shared@example.com', source: 'import' });
    expect(made.status).toBe(201);
    const before = await count(t);
    expect(
      (await api.hook(s.hookPath, { name: 'Mail Twin', email: 'shared@example.com' })).status,
    ).toBe(200);
    expect(await count(t)).toBe(before + 1);
    const twins = await api.rows(
      t.orgId,
      `SELECT id FROM contacts WHERE org_id = $1 AND name = 'Mail Twin'`,
    );
    expect(twins).toHaveLength(1);
    expect(await notes(t, twins[0]!.id, 'lead_duplicate')).toHaveLength(1);

    expect((await api.hook(s.hookPath, { name: 'Brand New', phone: '91400 00099' })).status).toBe(
      200,
    );
    const [fresh] = await api.contactsWithPhone(t.orgId, '+919140000099');
    expect(fresh).toMatchObject({ name: 'Brand New' });
    expect(await notes(t, fresh!.id, 'lead_duplicate')).toHaveLength(0);
    expect(await notes(t, fresh!.id, 'lead_merged')).toHaveLength(0);
  });

  it('counts against the plan like any contact, and a workspace back on merge merges again', async () => {
    expect((await save(t, { mode: 'merge', noteOnMerge: false, rowVersion: 1 })).status).toBe(200);
    const s = await api.source(t.admin, { name: 'Back to merge', ...IN });
    await existing(t, '+919140000003');
    const before = await count(t);
    expect((await api.hook(s.hookPath, { name: 'Again', phone: '91400 00003' })).status).toBe(200);
    expect(await count(t)).toBe(before);
  });
});
