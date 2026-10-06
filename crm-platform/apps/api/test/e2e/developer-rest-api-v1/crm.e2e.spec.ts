import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, tenantWithKey, type Harness } from './support';

/** The CRM group of the customer API: account, contacts, contact groups, deals (WD-API-020 to 029, 048 to 054). */
describe('customer API v1: crm', () => {
  let h: Harness;
  let api: Api;

  beforeAll(async () => {
    h = await startHarness();
    api = new Api(h);
  }, 240_000);
  afterAll(async () => h.stop());

  const overrides = (orgId: number, json: object) =>
    h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb) ON CONFLICT (org_id) DO UPDATE SET overrides = $2::jsonb`,
      [orgId, JSON.stringify(json)],
    );

  describe('account', () => {
    it('GET /me answers the key owner, the workspace, the plan, the limits and the unlocked features (WD-API-020)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-me');
      const org = (
        await h.owner.query(`SELECT uuid, name, slug FROM organizations WHERE id = $1`, [
          tenant.orgId,
        ])
      ).rows[0];
      await h.owner.query(
        `UPDATE organizations SET settings = settings || '{"timezone":"Asia/Kolkata","currency":"INR"}'::jsonb WHERE id = $1`,
        [tenant.orgId],
      );
      await overrides(tenant.orgId, {
        limits: { monthly_messages: 1000 },
        features: { sales_pipeline: true },
      });

      const res = await call.get('/me');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.account.email).toEqual(expect.any(String));
      expect(d.workspace).toEqual({
        id: org.uuid,
        name: org.name,
        slug: org.slug,
        timezone: 'Asia/Kolkata',
        currency: 'INR',
      });
      expect(typeof d.plan.is_free).toBe('boolean');
      expect(d.plan.id).toEqual(expect.any(String));
      expect(d.limits.monthly_messages_limit).toBe(1000);
      expect(Object.keys(d.limits).sort()).toEqual([
        'contacts_limit',
        'device_limit',
        'flow_limit',
        'monthly_messages_limit',
        'user_seat_limit',
      ]);
      expect(d.features.sales_pipeline).toBe(true);
      for (const v of Object.values(d.features)) expect(v).toBe(true);
    });

    it('GET /me shows an uncapped meter as null and leaves a turned-off feature out (WD-API-020)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-me-null');
      await overrides(tenant.orgId, {
        limits: { monthly_messages: -1 },
        features: { sales_pipeline: false },
      });
      const res = await call.get('/me');
      expect(res.status).toBe(200);
      expect(res.body.data.limits.monthly_messages_limit).toBeNull();
      expect(res.body.data.features).not.toHaveProperty('sales_pipeline');
    });

    it('GET /me and /usage without a key answer 401 missing_api_key (WD-API-020, 021)', async () => {
      const { call } = await tenantWithKey(api, 'crm-me-401');
      for (const path of ['/me', '/usage']) {
        const res = await call.raw('get', path);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('missing_api_key');
      }
    });

    it('GET /usage counts the month, the remaining messages, the cycle, the plan validity, the wallet and the meters (WD-API-021)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-usage');
      await overrides(tenant.orgId, { limits: { monthly_messages: 100, contacts: 10 } });
      await api.seedContacts(tenant, [{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
      const cur = (
        await h.owner.query(
          `SELECT upper(coalesce(settings->>'currency','')) c FROM organizations WHERE id=$1`,
          [tenant.orgId],
        )
      ).rows[0];
      expect(cur).toBeDefined();
      const first = await call.get('/usage');
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const unit: string = first.body.data.currency;
      await h.owner.query(
        `INSERT INTO wallets (org_id, unit, balance) VALUES ($1, $2, 12.5) ON CONFLICT (org_id, unit) DO UPDATE SET balance = 12.5`,
        [tenant.orgId, unit],
      );

      const res = await call.get('/usage');
      const d = res.body.data;
      expect(res.status).toBe(200);
      expect(d.messages).toEqual({
        used: 0,
        limit: 100,
        unlimited: false,
        remaining: 100,
        percent: 0,
      });
      expect(d.period.label).toMatch(/^[A-Z][a-z]+ \d{4}$/);
      expect(Date.parse(d.period.resets_on)).toBeGreaterThan(Date.now());
      expect(d.period.days_left).toBeGreaterThanOrEqual(0);
      expect(d.plan).toHaveProperty('valid_until');
      expect(d.plan).toHaveProperty('valid_until_days');
      expect(d.credits).toBe('1250');
      expect(Object.keys(d.meters)).toEqual([
        'monthly_messages_limit',
        'contacts_limit',
        'device_limit',
        'user_seat_limit',
        'flow_limit',
      ]);
      expect(d.meters.device_limit.label).toBe('Connected numbers');
      expect(d.meters.contacts_limit).toEqual({
        label: 'Contacts',
        used: 3,
        limit: 10,
        unlimited: false,
        percent: 30,
      });
    });

    it('GET /usage reports an unlimited message cap as null (WD-API-021)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-usage-unl');
      await overrides(tenant.orgId, { limits: { monthly_messages: -1 } });
      const res = await call.get('/usage');
      expect(res.body.data.messages).toMatchObject({
        limit: null,
        unlimited: true,
        remaining: null,
      });
    });

    it('a key scoped to another resource cannot read /me; account:read can (WD-API-020)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-scope');
      await h.owner.query(`UPDATE api_keys SET scopes = ARRAY['contacts:read'] WHERE org_id = $1`, [
        tenant.orgId,
      ]);
      const denied = await call.get('/me');
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('forbidden');
      await h.owner.query(`UPDATE api_keys SET scopes = ARRAY['account:read'] WHERE org_id = $1`, [
        tenant.orgId,
      ]);
      expect((await call.get('/me')).status).toBe(200);
    });
  });

  // --- contacts -------------------------------------------------------------------------------------------------------------------

  describe('contacts', () => {
    const row = async (orgId: number, uuid: string) =>
      (await h.owner.query(`SELECT * FROM contacts WHERE org_id = $1 AND uuid = $2`, [orgId, uuid]))
        .rows[0];

    it('POST without a key answers 401 missing_api_key; a key scoped to messages cannot read contacts (WD-API-022)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-con-auth');
      const none = await call.raw('get', '/contacts');
      expect(none.status).toBe(401);
      expect(none.body.error.code).toBe('missing_api_key');
      await h.owner.query(`UPDATE api_keys SET scopes = ARRAY['messages:read'] WHERE org_id = $1`, [
        tenant.orgId,
      ]);
      const res = await call.get('/contacts');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('creates a contact: name and phone normalized, 201 envelope, key owner as owner (WD-API-024)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-con-create');
      const res = await call.post('/contacts', {
        name: 'Alice Ray',
        phone: '91 98123 45678',
        email: 'alice@example.test',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({
        name: 'Alice Ray',
        phone: '+919812345678',
        email: 'alice@example.test',
        tags: [],
        attributes: {},
      });
      expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(Date.parse(res.body.data.created_at)).not.toBeNaN();
      expect(res.body.meta).toEqual({ created: true });
      const r = await row(tenant.orgId, res.body.data.id);
      expect(Number(r.owner_id)).toBe(tenant.adminUserId);
      expect(r.source).toBe('api');
      const outbox = await h.owner.query(
        `SELECT event_type FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'contacts'`,
        [tenant.orgId],
      );
      expect(outbox.rows.map((x) => x.event_type)).toContain('contact.created');
    });

    it('rejects a body with neither name nor first_name, a missing phone and a long email with 422 (WD-API-024)', async () => {
      const { call } = await tenantWithKey(api, 'crm-con-422');
      const noName = await call.post('/contacts', { phone: '+919812345678' });
      expect(noName.status).toBe(422);
      expect(noName.body.error.code).toBe('validation_failed');
      expect(noName.body.error.details.name).toBeDefined();
      const noPhone = await call.post('/contacts', { name: 'X' });
      expect(noPhone.status).toBe(422);
      expect(noPhone.body.error.details.phone).toBeDefined();
      const longEmail = await call.post('/contacts', {
        name: 'X',
        phone: '+919812345678',
        email: `${'a'.repeat(185)}@x.test`,
      });
      expect(longEmail.status).toBe(422);
      expect(longEmail.body.error.details.email).toBeDefined();
    });

    it('joins title, first and last name when name is absent and keeps the fields the service has no column for (WD-API-024)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-con-parts');
      const res = await call.post('/contacts', {
        first_name: 'Ada',
        middle_name: 'M',
        last_name: 'Lovelace',
        title: 'Dr',
        phone: '+44 20 7946 0958',
        language: 'en',
        address: '1 Main St',
        note: 'vip',
        country_code: '+44',
        is_unsubscribed: true,
        attributes: { plan: 'gold' },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.name).toBe('Dr Ada M Lovelace');
      expect(res.body.data.attributes).toEqual({ plan: 'gold' });
      const r = await row(tenant.orgId, res.body.data.id);
      expect(r).toMatchObject({
        title: 'Dr',
        middle_name: 'M',
        first_name: 'Ada',
        last_name: 'Lovelace',
        language: 'en',
        address: '1 Main St',
        message: 'vip',
        country_code: '+44',
        is_unsubscribed: true,
      });
    });

    it('stores country_code + phone as one number (WD-API-024)', async () => {
      const { call } = await tenantWithKey(api, 'crm-con-cc');
      const res = await call.post('/contacts', {
        name: 'Cc',
        phone: '9812345678',
        country_code: '+91',
      });
      expect(res.status).toBe(201);
      expect(res.body.data.phone).toBe('+919812345678');
    });

    it('composes the country code like WaDesk: a national number that starts with the code digits keeps all its digits (WD-API-024)', async () => {
      const { call } = await tenantWithKey(api, 'crm-con-compose');
      const cases: Array<[Record<string, string>, string]> = [
        [{ phone: '9162915526', country_code: '+91' }, '+919162915526'],
        [{ phone: '+919162915527', country_code: '+91' }, '+919162915527'],
        [{ phone: '9162915528' }, '+9162915528'],
        [{ phone: '98123 45601', country_code: '91' }, '+919812345601'],
        [{ phone: '(98123) 45-602', country_code: '+91' }, '+919812345602'],
      ];
      for (const [i, [body, want]] of cases.entries()) {
        const res = await call.post('/contacts', { name: `Compose ${i}`, ...body });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data.phone).toBe(want);
      }
      const upd = await call.post('/contacts', {
        name: 'Compose upd',
        phone: '9812345603',
        country_code: '+91',
      });
      const put = await call.put(`/contacts/${upd.body.data.id}`, {
        phone: '9162915529',
        country_code: '+91',
      });
      expect(put.body.data.phone).toBe('+919162915529');
    });

    it('refuses a phone of non-digits only, one over 32 characters and one too long to be E.164 with 422 on phone (WD-API-024)', async () => {
      const { call } = await tenantWithKey(api, 'crm-con-badphone');
      for (const phone of ['abc', '---', '1'.repeat(33), '1'.repeat(20)]) {
        const res = await call.post('/contacts', { name: 'Bad', phone, country_code: '+91' });
        expect(res.status, phone).toBe(422);
        expect(res.body.error.code).toBe('validation_failed');
        expect(res.body.error.details.phone).toBeDefined();
      }
    });

    it('rejects a phone that is not a number with 422 (WD-API-024)', async () => {
      const { call } = await tenantWithKey(api, 'crm-con-badphone');
      const res = await call.post('/contacts', { name: 'Bad', phone: 'abc' });
      expect(res.status).toBe(422);
      expect(res.body.error.details.phone).toBeDefined();
    });

    it('returns the existing contact, untouched, when the phone already belongs to one: meta.created is false (WD-API-024)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-con-dup');
      const first = await call.post('/contacts', {
        name: 'First',
        phone: '+919812300001',
        title: 'Mr',
      });
      const second = await call.post('/contacts', {
        name: 'Second',
        phone: '+919812300001',
        title: 'Dr',
      });
      expect(second.status).toBe(201);
      expect(second.body.data.id).toBe(first.body.data.id);
      expect(second.body.data.name).toBe('First');
      expect(second.body.meta).toEqual({ created: false });
      expect((await row(tenant.orgId, first.body.data.id)).title).toBe('Mr');
    });

    it('refuses a group id of another workspace with 422 naming group_ids.0, and creates nothing (WD-API-024)', async () => {
      const a = await tenantWithKey(api, 'crm-con-grp-a');
      const b = await tenantWithKey(api, 'crm-con-grp-b');
      const foreign = await b.call.post('/contact-groups', { name: 'Theirs' });
      const res = await a.call.post('/contacts', {
        name: 'G',
        phone: '+919812300002',
        group_ids: [foreign.body.data.id],
      });
      expect(res.status).toBe(422);
      expect(res.body.error.details['group_ids.0']).toBeDefined();
      expect(
        (
          await h.owner.query(`SELECT count(*)::int n FROM contacts WHERE org_id = $1`, [
            a.tenant.orgId,
          ])
        ).rows[0].n,
      ).toBe(0);
    });

    it('puts a new contact in its groups and lists them as tags with id and name (WD-API-022, 024)', async () => {
      const { call } = await tenantWithKey(api, 'crm-con-tags');
      const g1 = await call.post('/contact-groups', { name: 'Leads' });
      const g2 = await call.post('/contact-groups', { name: 'VIP', color: '#112233' });
      const res = await call.post('/contacts', {
        name: 'T',
        phone: '+919812300003',
        group_ids: [g1.body.data.id, g2.body.data.id],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.tags).toEqual(
        expect.arrayContaining([
          { id: g1.body.data.id, name: 'Leads' },
          { id: g2.body.data.id, name: 'VIP' },
        ]),
      );
      expect(res.body.data.tags).toHaveLength(2);
      const list = await call.get('/contact-groups');
      expect(
        list.body.data.find((g: { id: string }) => g.id === g1.body.data.id).contacts_count,
      ).toBe(1);
    });

    it('lists newest first with a cursor, per_page as limit, search over name, phone and email, clamped to 100 (WD-API-022)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-con-list');
      await api.seedContacts(
        tenant,
        Array.from({ length: 30 }, (_, i) => ({
          name: i === 3 ? 'Alina Zed' : `Person ${i}`,
          phone: `+9198000${String(i).padStart(5, '0')}`,
          email: i === 4 ? 'ALI@corp.test' : null,
        })),
      );
      const p1 = await call.get('/contacts?per_page=10');
      expect(p1.status).toBe(200);
      expect(p1.body.data).toHaveLength(10);
      expect(p1.body.data[0].name).toBe('Person 29');
      expect(p1.body.meta).toMatchObject({ limit: 10, has_more: true });
      const p2 = await call.get(
        `/contacts?per_page=10&cursor=${encodeURIComponent(p1.body.meta.next_cursor)}`,
      );
      expect(p2.body.data[0].name).toBe('Person 19');
      const search = await call.get('/contacts?search=ali');
      expect(search.body.data.map((c: { name: string }) => c.name).sort()).toEqual([
        'Alina Zed',
        'Person 4',
      ]);
      const bySearchPhone = await call.get('/contacts?search=9800000007');
      expect(bySearchPhone.body.data.map((c: { name: string }) => c.name)).toEqual(['Person 7']);
      const big = await call.get('/contacts?per_page=1000');
      expect(big.status).toBe(200);
      expect(big.body.meta.limit).toBe(100);
      for (const [qs, want] of [
        ['per_page=abc', 1],
        ['per_page=1.5', 1],
        ['per_page=-3', 1],
        ['per_page=0', 1],
        ['limit=abc', 1],
        ['per_page=2abc', 2],
      ] as const) {
        const lenient = await call.get(`/contacts?${qs}`);
        expect(lenient.status, qs).toBe(200);
        expect(lenient.body.meta.limit, qs).toBe(want);
        expect(lenient.body.data.length, qs).toBeLessThanOrEqual(want);
      }
      const page = await call.get('/contacts?page=2');
      expect(page.status).toBe(422);
      expect(JSON.stringify(page.body)).toContain('cursor');
    });

    it('shows a contact by id; another workspace, an unknown uuid and a non-uuid id are 404 not_found (WD-API-023)', async () => {
      const a = await tenantWithKey(api, 'crm-con-show-a');
      const b = await tenantWithKey(api, 'crm-con-show-b');
      const made = await a.call.post('/contacts', { name: 'Mine', phone: '+919812300004' });
      const ok = await a.call.get(`/contacts/${made.body.data.id}`);
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({
        name: 'Mine',
        phone: '+919812300004',
        tags: [],
        attributes: {},
      });
      for (const id of [made.body.data.id, '00000000-0000-4000-8000-000000000000', '12345']) {
        const res = await b.call.get(`/contacts/${id}`);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('not_found');
      }
    });

    it("does not show another workspace's contacts in the list (WD-API-022)", async () => {
      const a = await tenantWithKey(api, 'crm-con-iso-a');
      const b = await tenantWithKey(api, 'crm-con-iso-b');
      await a.call.post('/contacts', { name: 'Only A', phone: '+919812300005' });
      const res = await b.call.get('/contacts');
      expect(res.body.data).toEqual([]);
    });

    it('updates only the fields sent; the name is untouched when only the email changes (WD-API-025)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-con-upd');
      const made = await call.post('/contacts', {
        name: 'Keep Me',
        phone: '+919812300006',
        title: 'Mr',
        note: 'n1',
      });
      const res = await call.put(`/contacts/${made.body.data.id}`, { email: 'new@example.test' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        name: 'Keep Me',
        email: 'new@example.test',
        phone: '+919812300006',
      });
      const r = await row(tenant.orgId, made.body.data.id);
      expect(r.title).toBe('Mr');
      expect(r.message).toBe('n1');
      const events = await h.owner.query(
        `SELECT event_type FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'contacts'`,
        [tenant.orgId],
      );
      expect(events.rows.map((x) => x.event_type)).toContain('contact.updated');
    });

    it('recomputes the name from the parts only when name or first_name is sent, keeping the old name when the result is empty (WD-API-025)', async () => {
      const { call } = await tenantWithKey(api, 'crm-con-upd-name');
      const made = await call.post('/contacts', {
        first_name: 'Ann',
        last_name: 'Lee',
        title: 'Ms',
        phone: '+919812300007',
      });
      expect(made.body.data.name).toBe('Ms Ann Lee');
      const lastOnly = await call.put(`/contacts/${made.body.data.id}`, { last_name: 'Kim' });
      expect(lastOnly.body.data.name).toBe('Ms Ann Lee');
      const first = await call.put(`/contacts/${made.body.data.id}`, { first_name: 'Anna' });
      expect(first.body.data.name).toBe('Ms Anna Kim');
      const named = await call.put(`/contacts/${made.body.data.id}`, { name: 'Boss' });
      expect(named.body.data.name).toBe('Boss');
    });

    it('replaces the groups with group_ids and clears them with []; a foreign group is 422 (WD-API-025)', async () => {
      const a = await tenantWithKey(api, 'crm-con-upd-grp-a');
      const b = await tenantWithKey(api, 'crm-con-upd-grp-b');
      const g1 = await a.call.post('/contact-groups', { name: 'One' });
      const g2 = await a.call.post('/contact-groups', { name: 'Two' });
      const foreign = await b.call.post('/contact-groups', { name: 'Foreign' });
      const made = await a.call.post('/contacts', {
        name: 'M',
        phone: '+919812300008',
        group_ids: [g1.body.data.id],
      });
      const swap = await a.call.put(`/contacts/${made.body.data.id}`, {
        group_ids: [g2.body.data.id],
      });
      expect(swap.body.data.tags).toEqual([{ id: g2.body.data.id, name: 'Two' }]);
      const bad = await a.call.put(`/contacts/${made.body.data.id}`, {
        group_ids: [foreign.body.data.id],
      });
      expect(bad.status).toBe(422);
      expect(bad.body.error.details['group_ids.0']).toBeDefined();
      const clear = await a.call.put(`/contacts/${made.body.data.id}`, { group_ids: [] });
      expect(clear.body.data.tags).toEqual([]);
    });

    it('replaces attributes as a whole and clears them with {} (WD-API-025)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-con-upd-attr');
      const made = await call.post('/contacts', {
        name: 'A',
        phone: '+919812300009',
        attributes: { a: 1, b: 'x' },
      });
      expect(made.body.data.attributes).toEqual({ a: 1, b: 'x' });
      const replaced = await call.put(`/contacts/${made.body.data.id}`, {
        attributes: { c: true },
      });
      expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
      expect(replaced.body.data.attributes).toEqual({ c: true });
      const cleared = await call.put(`/contacts/${made.body.data.id}`, { attributes: {} });
      expect(cleared.body.data.attributes).toEqual({});
      expect((await row(tenant.orgId, made.body.data.id)).data).toEqual({});
    });

    it('re-composes the phone with the sent country_code, else the stored one (WD-API-025)', async () => {
      const { call } = await tenantWithKey(api, 'crm-con-upd-phone');
      const made = await call.post('/contacts', {
        name: 'P',
        phone: '9812345678',
        country_code: '+91',
      });
      const stored = await call.put(`/contacts/${made.body.data.id}`, { phone: '9000000000' });
      expect(stored.body.data.phone).toBe('+919000000000');
      const moved = await call.put(`/contacts/${made.body.data.id}`, {
        phone: '7000000000',
        country_code: '+44',
      });
      expect(moved.body.data.phone).toBe('+447000000000');
    });

    it('answers 404 for an unknown or foreign contact on PUT and accepts PATCH as an alias (WD-API-025)', async () => {
      const a = await tenantWithKey(api, 'crm-con-upd404-a');
      const b = await tenantWithKey(api, 'crm-con-upd404-b');
      const made = await a.call.post('/contacts', { name: 'Z', phone: '+919812300010' });
      expect((await b.call.put(`/contacts/${made.body.data.id}`, { name: 'Hack' })).status).toBe(
        404,
      );
      expect((await a.call.put('/contacts/00000000-0000-4000-8000-000000000000', {})).status).toBe(
        404,
      );
      const viaPatch = await request(h.app.getHttpServer())
        .patch(`/api/v1/contacts/${made.body.data.id}`)
        .set('authorization', `Bearer ${a.key.secret}`)
        .send({ language: 'fr' });
      expect(viaPatch.status).toBe(200);
    });

    it('retries once when the row changed between the read and the write (WD-API-025)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-con-upd-race');
      const made = await call.post('/contacts', { name: 'Race', phone: '+919812300011' });
      const results = await Promise.all(
        ['a@x.test', 'b@x.test', 'c@x.test'].map((email) =>
          call.put(`/contacts/${made.body.data.id}`, { email }),
        ),
      );
      expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(2);
      expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
      expect((await row(tenant.orgId, made.body.data.id)).email).toMatch(/@x\.test$/);
    });

    it('deletes a contact with 200 {id, deleted}; a repeat, another workspace and an unknown id are 404 (WD-API-026)', async () => {
      const a = await tenantWithKey(api, 'crm-con-del-a');
      const b = await tenantWithKey(api, 'crm-con-del-b');
      const made = await a.call.post('/contacts', { name: 'Del', phone: '+919812300012' });
      const foreign = await b.call.delete(`/contacts/${made.body.data.id}`);
      expect(foreign.status).toBe(404);
      expect(await row(a.tenant.orgId, made.body.data.id)).toBeDefined();
      const res = await a.call.delete(`/contacts/${made.body.data.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { id: made.body.data.id, deleted: true } });
      expect((await a.call.get(`/contacts/${made.body.data.id}`)).status).toBe(404);
      expect((await a.call.delete(`/contacts/${made.body.data.id}`)).status).toBe(404);
    });
  });

  // --- contact groups -------------------------------------------------------------------------------------------------------------

  describe('contact groups', () => {
    it('creates a group (201, contacts_count 0), lists newest first with meta.count, and isolates workspaces (WD-API-027, 028)', async () => {
      const a = await tenantWithKey(api, 'crm-grp-a');
      const b = await tenantWithKey(api, 'crm-grp-b');
      const one = await a.call.post('/contact-groups', {
        name: 'First',
        note: 'n',
        color: '#AABBCC',
      });
      expect(one.status).toBe(201);
      expect(one.body.data).toMatchObject({
        name: 'First',
        note: 'n',
        color: '#AABBCC',
        contacts_count: 0,
      });
      expect(Date.parse(one.body.data.created_at)).not.toBeNaN();
      await a.call.post('/contact-groups', { name: 'Second' });
      await b.call.post('/contact-groups', { name: 'Not mine' });
      const list = await a.call.get('/contact-groups');
      expect(list.status).toBe(200);
      expect(list.body.data.map((g: { name: string }) => g.name)).toEqual(['Second', 'First']);
      expect(list.body.meta).toEqual({ count: 2 });
    });

    it('rejects a missing name, a 192 character name and a colour that is not hex with 422 (WD-API-028)', async () => {
      const { call } = await tenantWithKey(api, 'crm-grp-422');
      const none = await call.post('/contact-groups', {});
      expect(none.status).toBe(422);
      expect(none.body.error.details.name).toBeDefined();
      const long = await call.post('/contact-groups', { name: 'n'.repeat(192) });
      expect(long.status).toBe(422);
      const colour = await call.post('/contact-groups', { name: 'C', color: 'red' });
      expect(colour.status).toBe(422);
      expect(colour.body.error.details.color).toBeDefined();
    });

    it('refuses a colour the database check would refuse with a clean 422 validation_failed on color, never a 500 (WD-API-028)', async () => {
      const { call } = await tenantWithKey(api, 'crm-grp-color');
      for (const color of ['#FFF', '#GGGGGG', '7C3AED', '#7C3AED7', 'c'.repeat(33)]) {
        const res = await call.post('/contact-groups', { name: `C ${color}`, color });
        expect(res.status, color).toBe(422);
        expect(res.body.error.code).toBe('validation_failed');
        expect(res.body.error.details.color, color).toBeDefined();
      }
      const fine = await call.post('/contact-groups', { name: 'Fine', color: '#7c3aed' });
      expect(fine.status).toBe(201);
    });

    it('answers the existing group with 200 for a name already taken, ignoring case (WD-API-028)', async () => {
      const { call } = await tenantWithKey(api, 'crm-grp-dup');
      const one = await call.post('/contact-groups', { name: 'Same' });
      const two = await call.post('/contact-groups', { name: 'SAME' });
      expect(two.status).toBe(200);
      expect(two.body.data.id).toBe(one.body.data.id);
      expect((await call.get('/contact-groups')).body.meta.count).toBe(1);
    });

    it('counts the members of a group (WD-API-027)', async () => {
      const { call } = await tenantWithKey(api, 'crm-grp-count');
      const g = await call.post('/contact-groups', { name: 'Counted' });
      for (const n of [1, 2, 3])
        await call.post('/contacts', {
          name: `m${n}`,
          phone: `+9198123010${n}0`,
          group_ids: [g.body.data.id],
        });
      const list = await call.get('/contact-groups');
      expect(list.body.data[0].contacts_count).toBe(3);
    });

    it('deletes a group, detaches its contacts and keeps them; unknown, foreign and repeat are 404 (WD-API-029)', async () => {
      const a = await tenantWithKey(api, 'crm-grp-del-a');
      const b = await tenantWithKey(api, 'crm-grp-del-b');
      const g = await a.call.post('/contact-groups', { name: 'Doomed' });
      const c = await a.call.post('/contacts', {
        name: 'Stays',
        phone: '+919812301999',
        group_ids: [g.body.data.id],
      });
      expect((await b.call.delete(`/contact-groups/${g.body.data.id}`)).status).toBe(404);
      const res = await a.call.delete(`/contact-groups/${g.body.data.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { id: g.body.data.id, deleted: true } });
      const contact = await a.call.get(`/contacts/${c.body.data.id}`);
      expect(contact.status).toBe(200);
      expect(contact.body.data.tags).toEqual([]);
      const again = await a.call.delete(`/contact-groups/${g.body.data.id}`);
      expect(again.status).toBe(404);
      expect(again.body.error.code).toBe('not_found');
      expect((await a.call.delete('/contact-groups/42')).status).toBe(404);
    });

    it('needs the contact-groups scopes (WD-API-027)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-grp-scope');
      await h.owner.query(
        `UPDATE api_keys SET scopes = ARRAY['contact-groups:read'] WHERE org_id = $1`,
        [tenant.orgId],
      );
      expect((await call.get('/contact-groups')).status).toBe(200);
      const denied = await call.post('/contact-groups', { name: 'x' });
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('forbidden');
    });
  });

  // --- deals ----------------------------------------------------------------------------------------------------------------------

  describe('deals', () => {
    interface Stage {
      uuid: string;
      name: string;
      kind: string;
      pipeline: string;
    }
    const stagesOf = async (orgId: number): Promise<Record<string, Stage>> => {
      const res = await h.owner.query(
        `SELECT s.uuid, s.name, CASE WHEN s.is_won THEN 'won' WHEN s.is_lost THEN 'lost' ELSE 'open' END AS kind, p.uuid AS pipeline FROM pipeline_stages s JOIN pipelines p ON p.org_id = s.org_id AND p.id = s.pipeline_id
         WHERE s.org_id = $1 AND p.is_default ORDER BY s.sort_order`,
        [orgId],
      );
      return Object.fromEntries(res.rows.map((r) => [r.name, r as Stage]));
    };
    const deal = async (orgId: number, uuid: string) =>
      (await h.owner.query(`SELECT * FROM deals WHERE org_id = $1 AND uuid = $2`, [orgId, uuid]))
        .rows[0];

    it('every deals route is 403 plan_feature_disabled on a plan without the sales pipeline, even for a bad body or an unknown id (WD-API-053)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-deal-gate');
      await overrides(tenant.orgId, { features: { sales_pipeline: false } });
      const unknown = '00000000-0000-4000-8000-000000000000';
      const calls = [
        call.get('/deals'),
        call.post('/deals', {}),
        call.get(`/deals/${unknown}`),
        call.put(`/deals/${unknown}`, { value: -5 }),
        call.delete(`/deals/${unknown}`),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('plan_feature_disabled');
      }
      expect(
        (await h.owner.query(`SELECT count(*)::int n FROM deals WHERE org_id = $1`, [tenant.orgId]))
          .rows[0].n,
      ).toBe(0);
      await overrides(tenant.orgId, { features: { sales_pipeline: true } });
      expect((await call.get('/deals')).status).toBe(200);
    });

    it('needs a deals scope, and no key answers 401 (WD-API-048)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-deal-scope');
      expect((await call.raw('get', '/deals')).status).toBe(401);
      await h.owner.query(`UPDATE api_keys SET scopes = ARRAY['deals:read'] WHERE org_id = $1`, [
        tenant.orgId,
      ]);
      expect((await call.get('/deals')).status).toBe(200);
      expect((await call.post('/deals', { title: 'x' })).status).toBe(403);
    });

    it('creates a deal on the default pipeline in its first stage: open, source api, no owner, value in major and minor units (WD-API-049)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-deal-create');
      const stages = await stagesOf(tenant.orgId);
      const res = await call.post('/deals', {
        title: 'Big one',
        value: 12.5,
        currency: 'usd',
        expected_close_date: '2026-12-31',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.meta).toBeUndefined();
      expect(res.body.data).toMatchObject({
        title: 'Big one',
        stage: 'New Lead',
        stage_id: stages['New Lead']!.uuid,
        pipeline_id: stages['New Lead']!.pipeline,
        status: 'open',
        value: 12.5,
        value_minor: 1250,
        currency: 'USD',
        source: 'api',
        contact_id: null,
        owner_user_id: null,
        expected_close_date: '2026-12-31',
        lost_reason: null,
        won_at: null,
        lost_at: null,
      });
      expect(Date.parse(res.body.data.created_at)).not.toBeNaN();
      const whole = await call.post('/deals', { title: 'Whole', value: '100' });
      expect(whole.body.data).toMatchObject({ value: 100, value_minor: 10000 });
    });

    it('rounds a value with more than two decimals half up instead of refusing it, on create and update (WD-API-049, 051)', async () => {
      const { call } = await tenantWithKey(api, 'crm-deal-round');
      const cases: Array<[unknown, number, number]> = [
        [12.345, 12.35, 1235],
        ['12.345', 12.35, 1235],
        ['12.344', 12.34, 1234],
        ['0.005', 0.01, 1],
        ['0.004', 0, 0],
        ['1.005', 1.01, 101],
        ['99999999', 99999999, 9999999900],
      ];
      for (const [value, major, minor] of cases) {
        const res = await call.post('/deals', { title: `R ${String(value)}`, value });
        expect(res.status, `${String(value)} ${JSON.stringify(res.body)}`).toBe(201);
        expect(res.body.data.value, String(value)).toBe(major);
        expect(res.body.data.value_minor, String(value)).toBe(minor);
      }
      const made = await call.post('/deals', { title: 'R put', value: '1' });
      const put = await call.put(`/deals/${made.body.data.id}`, { value: '12.345' });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      expect(put.body.data).toMatchObject({ value: 12.35, value_minor: 1235 });
      const over = await call.post('/deals', { title: 'R', value: '99999999.004' });
      expect(over.status).toBe(422);
    });

    it('validates the body: a missing title and a negative value are 422; the plan gate runs first (WD-API-049)', async () => {
      const { call } = await tenantWithKey(api, 'crm-deal-422');
      const noTitle = await call.post('/deals', { value: 1 });
      expect(noTitle.status).toBe(422);
      expect(noTitle.body.error.details.title).toBeDefined();
      const neg = await call.post('/deals', { title: 'N', value: -1 });
      expect(neg.status).toBe(422);
      expect(neg.body.error.details.value).toBeDefined();
      const tooBig = await call.post('/deals', { title: 'N', value: 100000000 });
      expect(tooBig.status).toBe(422);
      const long = await call.post('/deals', { title: 't'.repeat(192) });
      expect(long.status).toBe(422);
    });

    it('falls back instead of failing for a foreign pipeline, an unknown stage and an unknown contact (WD-API-049)', async () => {
      const a = await tenantWithKey(api, 'crm-deal-lenient-a');
      const b = await tenantWithKey(api, 'crm-deal-lenient-b');
      const stagesA = await stagesOf(a.tenant.orgId);
      const stagesB = await stagesOf(b.tenant.orgId);
      const res = await a.call.post('/deals', {
        title: 'Lenient',
        pipeline_id: stagesB['Won']!.pipeline,
        stage_id: stagesB['Won']!.uuid,
        contact_id: 999999,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({
        pipeline_id: stagesA['New Lead']!.pipeline,
        stage_id: stagesA['New Lead']!.uuid,
        contact_id: null,
        status: 'open',
      });
    });

    it('creating straight into a won stage sets status won and won_at; a lost stage sets lost and lost_at (WD-API-049, 054)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-deal-create-won');
      const stages = await stagesOf(tenant.orgId);
      const won = await call.post('/deals', { title: 'Won', stage_id: stages['Won']!.uuid });
      expect(won.body.data.status).toBe('won');
      expect(Date.parse(won.body.data.won_at)).not.toBeNaN();
      expect(won.body.data.lost_at).toBeNull();
      const lost = await call.post('/deals', { title: 'Lost', stage_id: stages['Lost']!.uuid });
      expect(lost.body.data.status).toBe('lost');
      expect(lost.body.data.lost_at).not.toBeNull();
    });

    it('links an existing contact and a member owner; a foreign or malformed owner is 422 (WD-API-049)', async () => {
      const a = await tenantWithKey(api, 'crm-deal-link-a');
      const b = await tenantWithKey(api, 'crm-deal-link-b');
      const contact = await a.call.post('/contacts', { name: 'Linked', phone: '+919812302001' });
      const owner = (
        await h.owner.query(`SELECT uuid FROM users WHERE org_id = $1 AND id = $2`, [
          a.tenant.orgId,
          a.tenant.adminUserId,
        ])
      ).rows[0].uuid;
      const ok = await a.call.post('/deals', {
        title: 'L',
        contact_id: contact.body.data.id,
        owner_user_id: owner,
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.data).toMatchObject({
        contact_id: contact.body.data.id,
        owner_user_id: owner,
      });
      const foreignContact = await b.call.post('/deals', {
        title: 'F',
        contact_id: contact.body.data.id,
      });
      expect(foreignContact.body.data.contact_id).toBeNull();
      const foreignOwner = await b.call.post('/deals', { title: 'F', owner_user_id: owner });
      expect(foreignOwner.status).toBe(422);
      expect(foreignOwner.body.error.code).toBe('validation_failed');
      expect(Object.keys(foreignOwner.body.error.details)).toEqual(['owner_user_id']);
      const mine = await b.call.post('/deals', { title: 'M' });
      const foreignOwnerPut = await b.call.put(`/deals/${mine.body.data.id}`, {
        owner_user_id: owner,
      });
      expect(foreignOwnerPut.status).toBe(422);
      expect(Object.keys(foreignOwnerPut.body.error.details)).toEqual(['owner_user_id']);
      const malformed = await b.call.post('/deals', { title: 'F', owner_user_id: 7 });
      expect(malformed.status).toBe(422);
      expect(malformed.body.error.details.owner_user_id).toBeDefined();
    });

    it('lists newest first, filters by stage and status, ignores a bogus status, and shows nothing of another workspace (WD-API-048)', async () => {
      const a = await tenantWithKey(api, 'crm-deal-list-a');
      const b = await tenantWithKey(api, 'crm-deal-list-b');
      const stages = await stagesOf(a.tenant.orgId);
      for (let i = 0; i < 12; i += 1)
        await a.call.post('/deals', {
          title: `D${i}`,
          stage_id: i < 2 ? stages['Won']!.uuid : undefined,
        });
      await b.call.post('/deals', { title: 'Theirs' });
      const p1 = await a.call.get('/deals?per_page=5');
      expect(p1.status).toBe(200);
      expect(p1.body.data.map((d: { title: string }) => d.title)).toEqual([
        'D11',
        'D10',
        'D9',
        'D8',
        'D7',
      ]);
      expect(p1.body.meta).toMatchObject({ limit: 5, has_more: true });
      const p2 = await a.call.get(
        `/deals?per_page=5&cursor=${encodeURIComponent(p1.body.meta.next_cursor)}`,
      );
      expect(p2.body.data[0].title).toBe('D6');
      const won = await a.call.get('/deals?status=won');
      expect(won.body.data).toHaveLength(2);
      const byStage = await a.call.get(`/deals?stage_id=${stages['Won']!.uuid}`);
      expect(byStage.body.data).toHaveLength(2);
      const byPipeline = await a.call.get(`/deals?pipeline_id=${stages['Won']!.pipeline}`);
      expect(byPipeline.body.meta.has_more).toBe(false);
      const bogus = await a.call.get('/deals?status=bogus');
      expect(bogus.status).toBe(200);
      expect(bogus.body.data).toEqual([]);
      const notUuid = await a.call.get('/deals?stage_id=12');
      expect(notUuid.body.data).toEqual([]);
      expect((await b.call.get('/deals')).body.data.map((d: { title: string }) => d.title)).toEqual(
        ['Theirs'],
      );
    });

    it('shows a deal; another workspace, an unknown and a malformed id are 404 not_found (WD-API-050)', async () => {
      const a = await tenantWithKey(api, 'crm-deal-show-a');
      const b = await tenantWithKey(api, 'crm-deal-show-b');
      const stages = await stagesOf(a.tenant.orgId);
      const made = await a.call.post('/deals', { title: 'S', stage_id: stages['Won']!.uuid });
      const res = await a.call.get(`/deals/${made.body.data.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ stage: 'Won', status: 'won' });
      expect(Date.parse(res.body.data.won_at)).not.toBeNaN();
      expect(res.body.data.lost_at).toBeNull();
      for (const id of [made.body.data.id, '00000000-0000-4000-8000-000000000000', '5']) {
        const miss = await b.call.get(`/deals/${id}`);
        expect(miss.status).toBe(404);
        expect(miss.body.error.code).toBe('not_found');
      }
    });

    it('updates only the fields sent: no timeline row for a title change, value null becomes 0, an unknown contact unlinks (WD-API-051)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-deal-upd');
      const contact = await call.post('/contacts', { name: 'C', phone: '+919812302002' });
      const made = await call.post('/deals', {
        title: 'Old',
        value: 5,
        contact_id: contact.body.data.id,
      });
      const before = (
        await h.owner.query(`SELECT count(*)::int n FROM deal_activities WHERE org_id = $1`, [
          tenant.orgId,
        ])
      ).rows[0].n;
      const titled = await call.put(`/deals/${made.body.data.id}`, { title: 'New' });
      expect(titled.status, JSON.stringify(titled.body)).toBe(200);
      expect(titled.body.data).toMatchObject({
        title: 'New',
        value: 5,
        contact_id: contact.body.data.id,
      });
      expect(
        (
          await h.owner.query(`SELECT count(*)::int n FROM deal_activities WHERE org_id = $1`, [
            tenant.orgId,
          ])
        ).rows[0].n,
      ).toBe(before);
      const zero = await call.put(`/deals/${made.body.data.id}`, { value: null });
      expect(zero.body.data).toMatchObject({ value: 0, value_minor: 0 });
      const unlinked = await call.put(`/deals/${made.body.data.id}`, { contact_id: 999999 });
      expect(unlinked.body.data.contact_id).toBeNull();
      const relabel = await call.put(`/deals/${made.body.data.id}`, {
        value: 7.25,
        currency: 'eur',
        expected_close_date: null,
      });
      expect(relabel.body.data).toMatchObject({
        value: 7.25,
        value_minor: 725,
        currency: 'EUR',
        expected_close_date: null,
      });
      const events = await h.owner.query(
        `SELECT event_type FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'deals'`,
        [tenant.orgId],
      );
      expect(events.rows.map((e) => e.event_type)).toContain('deal.updated');
    });

    it('answers an unknown deal 404 before it looks at the body, and a bad value of a known deal 422 (WD-API-051)', async () => {
      const { call } = await tenantWithKey(api, 'crm-deal-upd-order');
      const unknown = await call.put('/deals/00000000-0000-4000-8000-000000000000', { value: -3 });
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('not_found');
      const made = await call.post('/deals', { title: 'K' });
      const bad = await call.put(`/deals/${made.body.data.id}`, { value: -3 });
      expect(bad.status).toBe(422);
      const empty = await call.put(`/deals/${made.body.data.id}`, { title: '' });
      expect(empty.status).toBe(422);
    });

    it('moves a deal to a stage of its pipeline: status follows, one timeline row with from and to, deal.stage_changed (WD-API-051, 054)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-deal-move');
      const stages = await stagesOf(tenant.orgId);
      const made = await call.post('/deals', { title: 'Move me' });
      const rowsBefore = (
        await h.owner.query(`SELECT count(*)::int n FROM deal_activities WHERE org_id = $1`, [
          tenant.orgId,
        ])
      ).rows[0].n;
      const toWon = await call.put(`/deals/${made.body.data.id}`, {
        stage_id: stages['Won']!.uuid,
      });
      expect(toWon.status, JSON.stringify(toWon.body)).toBe(200);
      expect(toWon.body.data).toMatchObject({
        status: 'won',
        stage: 'Won',
        stage_id: stages['Won']!.uuid,
      });
      expect(Date.parse(toWon.body.data.won_at)).not.toBeNaN();
      const acts = await h.owner.query(
        `SELECT user_id, type, meta FROM deal_activities WHERE org_id = $1 ORDER BY id DESC LIMIT 1`,
        [tenant.orgId],
      );
      expect(
        (
          await h.owner.query(`SELECT count(*)::int n FROM deal_activities WHERE org_id = $1`, [
            tenant.orgId,
          ])
        ).rows[0].n,
      ).toBe(rowsBefore + 1);
      expect(acts.rows[0]).toMatchObject({
        type: 'stage_change',
        meta: { from: { name: 'New Lead' }, to: { name: 'Won', id: stages['Won']!.uuid } },
      });
      expect(Number(acts.rows[0].user_id)).toBe(tenant.adminUserId);
      const events = await h.owner.query(
        `SELECT event_type FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'deals'`,
        [tenant.orgId],
      );
      expect(events.rows.map((e) => e.event_type)).toEqual(
        expect.arrayContaining(['deal.stage_changed']),
      );
      const back = await call.put(`/deals/${made.body.data.id}`, {
        stage_id: stages['Qualified']!.uuid,
        lost_reason: 'ignored',
      });
      expect(back.body.data).toMatchObject({
        status: 'open',
        won_at: null,
        lost_at: null,
        lost_reason: null,
      });
    });

    it('the same stage again is not a change: no timeline row (WD-API-054)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-deal-same-stage');
      const stages = await stagesOf(tenant.orgId);
      const made = await call.post('/deals', { title: 'Stay' });
      const before = (
        await h.owner.query(`SELECT count(*)::int n FROM deal_activities WHERE org_id = $1`, [
          tenant.orgId,
        ])
      ).rows[0].n;
      const res = await call.put(`/deals/${made.body.data.id}`, {
        stage_id: stages['New Lead']!.uuid,
      });
      expect(res.status).toBe(200);
      expect(
        (
          await h.owner.query(`SELECT count(*)::int n FROM deal_activities WHERE org_id = $1`, [
            tenant.orgId,
          ])
        ).rows[0].n,
      ).toBe(before);
    });

    it('moving to a lost stage keeps the reason sent with it; on a lost deal lost_reason alone replaces it; on an open deal it is not kept (WD-API-051, 054)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-deal-lost');
      const stages = await stagesOf(tenant.orgId);
      const made = await call.post('/deals', { title: 'Lose' });
      const open = await call.put(`/deals/${made.body.data.id}`, { lost_reason: 'budget' });
      expect(open.status).toBe(200);
      expect(open.body.data).toMatchObject({ status: 'open', lost_reason: null, lost_at: null });
      const lost = await call.put(`/deals/${made.body.data.id}`, {
        stage_id: stages['Lost']!.uuid,
        lost_reason: 'went with a rival',
      });
      expect(lost.status, JSON.stringify(lost.body)).toBe(200);
      expect(lost.body.data).toMatchObject({ status: 'lost', lost_reason: 'went with a rival' });
      expect(Date.parse(lost.body.data.lost_at)).not.toBeNaN();
      expect(lost.body.data.won_at).toBeNull();
      const replaced = await call.put(`/deals/${made.body.data.id}`, { lost_reason: 'price' });
      expect(replaced.body.data).toMatchObject({ status: 'lost', lost_reason: 'price' });
    });

    it('a stage of another pipeline is 422 and changes nothing (WD-API-051)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'crm-deal-stage-mismatch');
      const other = await h.owner.query(
        `INSERT INTO pipelines (org_id, name, is_default, currency, sort_order) VALUES ($1, 'Other', false, 'USD', 5) RETURNING id`,
        [tenant.orgId],
      );
      const st = await h.owner.query(
        `INSERT INTO pipeline_stages (org_id, pipeline_id, name, sort_order) VALUES ($1, $2, 'Elsewhere', 0) RETURNING uuid`,
        [tenant.orgId, other.rows[0].id],
      );
      const made = await call.post('/deals', { title: 'Home' });
      const res = await call.put(`/deals/${made.body.data.id}`, {
        title: 'Renamed',
        stage_id: st.rows[0].uuid,
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('unprocessable');
      expect(res.body.error.message).toContain('pipeline');
      expect((await deal(tenant.orgId, made.body.data.id)).title).toBe('Home');
      const junk = await call.put(`/deals/${made.body.data.id}`, { stage_id: 99999 });
      expect(junk.status).toBe(422);
      expect(junk.body.error.code).toBe('unprocessable');
    });

    it('deletes a deal and its timeline; a repeat, another workspace and an unknown id are 404 (WD-API-052)', async () => {
      const a = await tenantWithKey(api, 'crm-deal-del-a');
      const b = await tenantWithKey(api, 'crm-deal-del-b');
      const made = await a.call.post('/deals', { title: 'Bye' });
      expect((await b.call.delete(`/deals/${made.body.data.id}`)).status).toBe(404);
      expect(await deal(a.tenant.orgId, made.body.data.id)).toBeDefined();
      const res = await a.call.delete(`/deals/${made.body.data.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ deleted: true });
      expect(await deal(a.tenant.orgId, made.body.data.id)).toBeUndefined();
      expect(
        (
          await h.owner.query(`SELECT count(*)::int n FROM deal_activities WHERE org_id = $1`, [
            a.tenant.orgId,
          ])
        ).rows[0].n,
      ).toBe(0);
      expect((await a.call.delete(`/deals/${made.body.data.id}`)).status).toBe(404);
    });
  });
});
