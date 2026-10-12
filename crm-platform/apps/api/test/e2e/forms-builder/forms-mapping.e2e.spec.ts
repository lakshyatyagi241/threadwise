import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FormsApi, field, startHarness, type Harness, type Tenant } from './support';

/**
 * Mapping a form's fields to CRM properties, end to end through the real app: what the field picker offers (the contact's and the
 * company's built-ins, the address as parts), what publish accepts, and what lands on the contact and the company, including the rules
 * for a returning contact and a form with both the whole address and its parts.
 */
let h: Harness;
let api: FormsApi;
let t: Tenant;
let seq = 0;
const fresh = (label = 'map') => `${label}${Date.now().toString(36)}${seq++}@example.test`;

const bound = (
  id: string,
  kind: string,
  object: 'contact' | 'company',
  property: string,
  over = {},
) => field(id, kind, { bind: { object, property }, ...over });

const definition = (blocks: unknown[]) => ({
  title: 'Mapping',
  steps: [{ id: 'main', blocks }],
  mapping: { company: { match: 'name_or_domain' } },
});

beforeAll(async () => {
  h = await startHarness();
  api = new FormsApi(h);
  t = await api.workspace('mapping');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('the field picker (GET /v2/forms/meta/properties)', () => {
  it('offers the contact built-ins, the address parts and middle name, with their labels and kinds', async () => {
    const res = await api.as(t.admin).get('/v2/forms/meta/properties?object=contact');
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(
      res.body.data.map((p: { property: string }) => [p.property, p]),
    );
    for (const [key, label] of [
      ['name', 'Full name'],
      ['email', 'Email'],
      ['phone', 'Phone'],
      ['middle_name', 'Middle name'],
      ['address', 'Full address'],
      ['address_line', 'Street'],
      ['address_city', 'City'],
      ['address_state', 'State or region'],
      ['address_postal_code', 'Postal code'],
      ['address_country', 'Country'],
    ] as const) {
      expect(byKey[key], key).toMatchObject({ label, source: 'builtin', object: 'contact' });
    }
    expect(byKey.email.suggestedKind).toBe('email');
    expect(byKey.address_city.suggestedKind).toBe('short_text');
  });

  it("offers the company built-ins and the company address parts, labelled as the company's", async () => {
    const res = await api.as(t.admin).get('/v2/forms/meta/properties?object=company');
    const labels = res.body.data.map((p: { label: string }) => p.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Company name',
        'Website',
        'Company full address',
        'Company street',
        'Company city',
        'Company state or region',
        'Company postal code',
        'Company country',
      ]),
    );
  });
});

describe('what lands in the CRM', () => {
  const addressForm = (extra: unknown[] = []) =>
    api.liveForm(t.admin, {
      definition: definition([
        bound('name', 'short_text', 'contact', 'name', { required: true }),
        bound('email', 'email', 'contact', 'email', { required: true }),
        bound('middle', 'short_text', 'contact', 'middle_name'),
        bound('street', 'short_text', 'contact', 'address_line'),
        bound('city', 'short_text', 'contact', 'address_city'),
        bound('state', 'short_text', 'contact', 'address_state'),
        bound('zip', 'short_text', 'contact', 'address_postal_code'),
        bound('country', 'short_text', 'contact', 'address_country'),
        ...extra,
      ]),
    });

  it('publishes a form mapped to the address parts and writes the contact: name, email, middle name and ONE composed address', async () => {
    const form = await addressForm();
    const email = fresh();
    const res = await api.submit(form.publicKey, {
      answers: {
        name: 'Chandra Bose',
        email,
        middle: 'Kumar',
        street: '12 Park Street',
        city: 'Kolkata',
        state: 'West Bengal',
        zip: '700016',
        country: 'India',
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const contact = await api.contactByEmail(t.orgId, email);
    expect(contact).toMatchObject({
      name: 'Chandra Bose',
      middle_name: 'Kumar',
      address: '12 Park Street, Kolkata, West Bengal 700016, India',
    });
    const sub = (await api.submissions(t.orgId, form.id))[0]!;
    expect(sub.answers).toMatchObject({ city: 'Kolkata', zip: '700016' });
  });

  it('only the parts that were filled make the address; none filled leaves it empty', async () => {
    const form = await addressForm();
    const some = fresh('some');
    await api.submit(form.publicKey, {
      answers: { name: 'A', email: some, city: 'Pune', country: 'India' },
    });
    expect((await api.contactByEmail(t.orgId, some))!.address).toBe('Pune, India');
    const none = fresh('none');
    await api.submit(form.publicKey, { answers: { name: 'B', email: none } });
    expect((await api.contactByEmail(t.orgId, none))!.address ?? null).toBeNull();
  });

  it('a returning contact keeps the address and middle name a person curated; blanks are filled', async () => {
    const form = await addressForm();
    const email = fresh('ret');
    await api.submit(form.publicKey, {
      answers: { name: 'Rita', email, middle: 'Ann', city: 'Delhi' },
    });
    await h.owner.query(
      `UPDATE contacts SET address = 'Curated, Mumbai', middle_name = NULL WHERE org_id = $1 AND normalized_email = $2`,
      [t.orgId, email],
    );
    await api.submit(form.publicKey, {
      idempotencyKey: 'returning-0001',
      answers: { name: 'Rita', email, middle: 'Anne', city: 'Chennai' },
    });
    const c = await api.contactByEmail(t.orgId, email);
    expect(c!.address).toBe('Curated, Mumbai'); // never overwritten
    expect(c!.middle_name).toBe('Anne'); // a blank is filled
  });

  it('a field bound to the whole address wins over the parts', async () => {
    const form = await api.liveForm(t.admin, {
      definition: definition([
        bound('name', 'short_text', 'contact', 'name', { required: true }),
        bound('email', 'email', 'contact', 'email', { required: true }),
        bound('all', 'long_text', 'contact', 'address'),
        bound('city', 'short_text', 'contact', 'address_city'),
      ]),
    });
    const email = fresh('win');
    await api.submit(form.publicKey, {
      answers: { name: 'W', email, all: '1 Main Rd, Delhi', city: 'Mumbai' },
    });
    expect((await api.contactByEmail(t.orgId, email))!.address).toBe('1 Main Rd, Delhi');
  });

  it('the company gets its own composed address and is linked to the contact', async () => {
    const form = await api.liveForm(t.admin, {
      definition: definition([
        bound('name', 'short_text', 'contact', 'name', { required: true }),
        bound('email', 'email', 'contact', 'email', { required: true }),
        bound('co', 'short_text', 'company', 'name'),
        bound('co_city', 'short_text', 'company', 'address_city'),
        bound('co_country', 'short_text', 'company', 'address_country'),
        bound('city', 'short_text', 'contact', 'address_city'),
      ]),
    });
    const email = fresh('co');
    const co = `Acme ${Date.now().toString(36)}`;
    await api.submit(form.publicKey, {
      answers: { name: 'C', email, co, co_city: 'Mumbai', co_country: 'India', city: 'Pune' },
    });
    const company = (
      await api.rows(t.orgId, `SELECT * FROM companies WHERE org_id = $1 AND name = $2`, [co])
    )[0];
    expect(company!.address).toBe('Mumbai, India');
    const contact = await api.contactByEmail(t.orgId, email);
    expect(contact!.address).toBe('Pune');
    expect(contact!.company_id).toBe(company!.id);
  });

  it('a company address part is refused on a contact-only property name and an unknown built-in is a publish problem', async () => {
    const draft = await api.createForm(t.admin, {
      definition: definition([
        bound('name', 'short_text', 'contact', 'name', { required: true }),
        bound('email', 'email', 'contact', 'email', { required: true }),
        bound('x', 'short_text', 'company', 'middle_name'),
      ]),
    });
    const res = await api
      .as(t.admin)
      .post(`/v2/forms/${draft.id}/publish`)
      .send({ rowVersion: draft.rowVersion });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('bind_unknown_property');
  });
});
