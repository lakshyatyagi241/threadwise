import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SendWindowService } from '../../../src/modules/compliance-center';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * A contact time zone you can see (BL-193): set on the contact form, a bulk edit, a CSV import or the API; shown with who set it; filtered;
 * exported; read by the quiet hours first of all; and explained on the contact (`GET /v2/contacts/:id/send-window`). A zone read from the
 * number's country or the workspace is never stored, so it can never replace one a person chose. Real app and Postgres.
 */
let h: Harness;
let api: Api;
let window: SendWindowService;

/** 2030-10-15 16:00 UTC: 21:30 in India (quiet 21:00 to 09:00), 12:00 in New York (open). */
const EVENING = new Date('2030-10-15T16:00:00Z');
const OPENS = '2030-10-16T03:30:00.000Z';

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  window = h.app.get(SendWindowService);
  window.now = () => EVENING;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

let n = 0;
const phone = () => `+91977${String(n++).padStart(7, '0')}`;

const create = (t: Tenant, body: Record<string, unknown>) =>
  api
    .as(t.admin)
    .post('/v2/contacts')
    .send({ phone: phone(), ...body });
const read = async (t: Tenant, id: string) =>
  (await api.as(t.admin).get(`/v2/contacts/${id}`)).body as {
    id: string;
    timezone: string | null;
    timezoneSource: string | null;
    rowVersion: number;
  };
const stored = async (id: string) =>
  (await h.owner.query(`SELECT timezone, timezone_source FROM contacts WHERE uuid = $1`, [id]))
    .rows[0] as { timezone: string | null; timezone_source: string | null };

describe('setting the zone: who set it is recorded with it', () => {
  it('a person creating a contact in the app is "staff"; the zone is stored the way the runtime spells it', async () => {
    const t = await api.signup('tz1');
    const res = await create(t, { name: 'Asha', timezone: 'asia/kolkata' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ timezone: 'Asia/Kolkata', timezoneSource: 'staff' });
    expect(await stored(res.body.id)).toEqual({
      timezone: 'Asia/Kolkata',
      timezone_source: 'staff',
    });
  });

  it('refuses a name that is not an IANA zone, and a contact without a zone has neither field', async () => {
    const t = await api.signup('tz2');
    const bad = await create(t, { name: 'Bad', timezone: 'Mars/Olympus' });
    expect(bad.status).toBe(422);
    const plain = await create(t, { name: 'Plain' });
    expect(plain.body).toMatchObject({ timezone: null, timezoneSource: null });
  });

  it('changing it records "staff"; an unrelated save leaves it alone; null clears both', async () => {
    const t = await api.signup('tz3');
    const made = (await create(t, { name: 'Ned' })).body;
    const set = await api
      .as(t.admin)
      .patch(`/v2/contacts/${made.id}`)
      .send({ timezone: 'America/New_York', rowVersion: made.rowVersion });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body).toMatchObject({ timezone: 'America/New_York', timezoneSource: 'staff' });

    // Same zone written by an import first: the source follows the writer, and an unrelated edit keeps it.
    await h.owner.query(`UPDATE contacts SET timezone_source = 'import' WHERE uuid = $1`, [
      made.id,
    ]);
    const fresh = await read(t, made.id);
    const renamed = await api
      .as(t.admin)
      .patch(`/v2/contacts/${made.id}`)
      .send({ name: 'Ned Hill', rowVersion: fresh.rowVersion });
    expect(renamed.body).toMatchObject({ timezone: 'America/New_York', timezoneSource: 'import' });

    const cleared = await api
      .as(t.admin)
      .patch(`/v2/contacts/${made.id}`)
      .send({ timezone: null, rowVersion: renamed.body.rowVersion });
    expect(cleared.body).toMatchObject({ timezone: null, timezoneSource: null });
    expect(await stored(made.id)).toEqual({ timezone: null, timezone_source: null });
  });

  it('the audit trail of the contact shows the zone change', async () => {
    const t = await api.signup('tz4');
    const made = (await create(t, { name: 'Audit' })).body;
    await api
      .as(t.admin)
      .patch(`/v2/contacts/${made.id}`)
      .send({ timezone: 'Europe/London', rowVersion: made.rowVersion });
    const history = await api.as(t.admin).get(`/v2/contacts/${made.id}/field-history`);
    expect(history.status).toBe(200);
    expect(JSON.stringify(history.body)).toContain('timezone');
  });
});

describe('the list: filter, condition, bulk edit, export', () => {
  it('filters by zone and by "no zone set"', async () => {
    const t = await api.signup('tz5');
    await create(t, { name: 'In1', timezone: 'Asia/Kolkata' });
    await create(t, { name: 'In2', timezone: 'Asia/Kolkata' });
    await create(t, { name: 'Ny', timezone: 'America/New_York' });
    await create(t, { name: 'None' });
    const names = async (q: string) =>
      ((await api.as(t.admin).get(`/v2/contacts?${q}`)).body.data as Array<{ name: string }>)
        .map((c) => c.name)
        .sort();
    expect(await names('timezone=Asia/Kolkata')).toEqual(['In1', 'In2']);
    expect(await names('noTimezone=true')).toEqual(['None']);
    expect(await names('timezone=Europe/Paris')).toEqual([]);
  });

  it('is a condition of a segment rule (the "Add condition" of the list)', async () => {
    const t = await api.signup('tz6');
    await create(t, { name: 'In1', timezone: 'Asia/Kolkata' });
    await create(t, { name: 'Ny', timezone: 'America/New_York' });
    const rules = JSON.stringify({
      type: 'group',
      combinator: 'and',
      children: [
        { type: 'condition', field: 'timezone', operator: 'equals', value: 'Asia/Kolkata' },
      ],
    });
    const res = await api.as(t.admin).get(`/v2/contacts?rules=${encodeURIComponent(rules)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data as Array<{ name: string }>).map((c) => c.name)).toEqual(['In1']);
  });

  it('a bulk edit sets the zone as "staff" on every contact and null clears it', async () => {
    const t = await api.signup('tz7');
    const ids = (await Promise.all([create(t, { name: 'B1' }), create(t, { name: 'B2' })])).map(
      (r) => r.body.id as string,
    );
    const set = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/update')
      .send({ ids, values: { timezone: 'Asia/Tokyo' } });
    expect(set.status, JSON.stringify(set.body)).toBe(201);
    expect(set.body.succeeded).toHaveLength(2);
    for (const id of ids)
      expect(await stored(id)).toEqual({ timezone: 'Asia/Tokyo', timezone_source: 'staff' });
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/update')
      .send({ ids, values: { timezone: null } });
    for (const id of ids)
      expect(await stored(id)).toEqual({ timezone: null, timezone_source: null });
    const bad = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/update')
      .send({ ids, values: { timezone: 'Nowhere/Land' } });
    expect(bad.status).toBe(422);
  });

  it('the CSV export has a timezone column', async () => {
    const t = await api.signup('tz8');
    const made = (await create(t, { name: 'Exp', timezone: 'Asia/Dubai' })).body;
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/export')
      .send({ ids: [made.id], bom: false })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
      });
    const lines = (res.body as unknown as string).trimEnd().split('\n');
    const header = lines[0]!.split(',');
    const col = header.indexOf('timezone');
    expect(col).toBeGreaterThan(-1);
    expect(lines[1]!.split(',')[col]).toBe('Asia/Dubai');
  });
});

describe('the CSV import', () => {
  const upload = (t: Tenant, csv: string) =>
    api.as(t.admin).post('/v2/contacts/import').attach('file', Buffer.from(csv), 'zones.csv');

  it('reads a time zone column, records "import", rejects a row with an invalid zone', async () => {
    const t = await api.signup('tz9');
    const res = await upload(
      t,
      'name,mobile,timezone\n' +
        'Zone One,+919876500001,asia/kolkata\n' +
        'Zone Two,+919876500002,\n' +
        'Zone Bad,+919876500003,Mars/Olympus\n',
    );
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const rows = (
      await h.owner.query(
        `SELECT name, timezone, timezone_source FROM contacts WHERE org_id = $1 ORDER BY name`,
        [t.orgId],
      )
    ).rows;
    expect(rows).toEqual([
      { name: 'Zone One', timezone: 'Asia/Kolkata', timezone_source: 'import' },
      { name: 'Zone Two', timezone: null, timezone_source: null },
    ]);
    const rejects = (await api.as(t.admin).get(`/v2/contacts/import/jobs/${res.body.id}/rejects`))
      .text;
    expect(rejects).toContain('invalid_timezone');
  });

  it('fills a contact that has no zone but never replaces one a person chose', async () => {
    const t = await api.signup('tz10');
    const chosen = (
      await create(t, { name: 'Chosen', phone: '+919876500011', timezone: 'Asia/Tokyo' })
    ).body;
    await create(t, { name: 'Empty', phone: '+919876500012' });
    const res = await upload(
      t,
      'name,mobile,timezone\nChosen,+919876500011,Europe/Paris\nEmpty,+919876500012,Europe/Paris\n',
    );
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(await stored(chosen.id)).toEqual({ timezone: 'Asia/Tokyo', timezone_source: 'staff' });
    const empty = (
      await h.owner.query(
        `SELECT timezone, timezone_source FROM contacts WHERE org_id = $1 AND name = 'Empty'`,
        [t.orgId],
      )
    ).rows[0];
    expect(empty).toEqual({ timezone: 'Europe/Paris', timezone_source: 'import' });
  });
});

describe('the clock a contact is read on: GET /v2/contacts/:id/send-window', () => {
  async function arrange(label: string, quiet = true) {
    const t = await api.signup(label);
    if (quiet) {
      await h.owner.query(
        `INSERT INTO compliance_settings (org_id, quiet_hours_enabled, quiet_start, quiet_end) VALUES ($1, true, '21:00', '09:00')`,
        [t.orgId],
      );
    }
    return t;
  }
  const windowOf = async (t: Tenant, id: string) => {
    const res = await api.as(t.admin).get(`/v2/contacts/${id}/send-window`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  };

  it('a stored zone is the clock; inside the quiet hours it says when the next message may go', async () => {
    const t = await arrange('tz11');
    const made = (await create(t, { name: 'Asha', timezone: 'Asia/Kolkata' })).body;
    expect(await windowOf(t, made.id)).toMatchObject({
      timezone: 'Asia/Kolkata',
      timezoneSource: 'staff',
      clock: {
        zones: ['Asia/Kolkata'],
        zone: 'Asia/Kolkata',
        source: 'contact_field',
        localTime: '21:30',
      },
      quietHours: 'held',
      nextSendAt: OPENS,
      heldCount: 0,
      heldUntil: null,
    });
  });

  it('outside the quiet hours a message can go; with the hours off nothing is restricted', async () => {
    const t = await arrange('tz12');
    const made = (await create(t, { name: 'Ned', timezone: 'America/New_York' })).body;
    expect(await windowOf(t, made.id)).toMatchObject({ quietHours: 'open', nextSendAt: null });
    const off = await arrange('tz13', false);
    const other = (await create(off, { name: 'Off', timezone: 'Asia/Kolkata' })).body;
    expect(await windowOf(off, other.id)).toMatchObject({ quietHours: 'off', nextSendAt: null });
  });

  it("with no stored zone the clock is the number's country, and says so", async () => {
    const t = await arrange('tz14');
    const made = (await create(t, { name: 'Ravi' })).body; // +91 number
    expect(await windowOf(t, made.id)).toMatchObject({
      timezone: null,
      timezoneSource: null,
      clock: { zone: 'Asia/Kolkata', source: 'phone_country' },
      quietHours: 'held',
    });
  });

  it('a country that spans several zones is several zones', async () => {
    const t = await arrange('tz15');
    const made = (await create(t, { name: 'Sam', phone: '+14155550123' })).body;
    const w = await windowOf(t, made.id);
    expect(w.clock.zone).toBeNull();
    expect(w.clock.localTime).toBeNull();
    expect(w.clock.zones.length).toBeGreaterThan(1);
    expect(w.clock.source).toBe('phone_country');
  });

  it('the older time zone property still counts, and the stored zone wins over it', async () => {
    const t = await arrange('tz16');
    const [legacy] = await api.seedContacts(t, [
      { name: 'Legacy', phone: phone(), data: { timezone: 'Asia/Kolkata' } },
    ]);
    expect(await windowOf(t, legacy!)).toMatchObject({
      timezone: null,
      clock: { zone: 'Asia/Kolkata', source: 'contact_field' },
    });
    const both = (await create(t, { name: 'Both', timezone: 'America/New_York' })).body;
    await h.owner.query(
      `UPDATE contacts SET data = jsonb_build_object('timezone', 'Asia/Kolkata') WHERE uuid = $1`,
      [both.id],
    );
    expect((await windowOf(t, both.id)).clock.zone).toBe('America/New_York');
  });

  it('counts what already waits for the quiet hours for this contact', async () => {
    const t = await arrange('tz17');
    const made = (await create(t, { name: 'Waiting', timezone: 'Asia/Kolkata' })).body;
    const contactId = Number(
      (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [made.id])).rows[0].id,
    );
    const campaign = (
      await h.owner.query(
        `INSERT INTO wpcampaigns (org_id, campaign_name, campaign_type, status) VALUES ($1, 'Offer', 'text', 'scheduled') RETURNING id`,
        [t.orgId],
      )
    ).rows[0].id;
    await h.owner.query(
      `INSERT INTO wp_campaign_contacts (org_id, campaign_id, contact_id, status, held_until, held_reason)
       VALUES ($1, $2, $3, 'queued', $4, 'quiet_hours')`,
      [t.orgId, campaign, contactId, OPENS],
    );
    expect(await windowOf(t, made.id)).toMatchObject({ heldCount: 1, heldUntil: OPENS });
  });

  it("is limited to contacts the caller may read, and a stranger's workspace is a 404", async () => {
    const a = await arrange('tz18');
    const b = await arrange('tz19');
    const made = (await create(a, { name: 'Mine' })).body;
    expect((await api.as(b.admin).get(`/v2/contacts/${made.id}/send-window`)).status).toBe(404);
    const noRead = await api.member(a, 'noread', [['record.tags.read']]);
    expect((await api.as(noRead.token).get(`/v2/contacts/${made.id}/send-window`)).status).toBe(
      403,
    );
  });
});
