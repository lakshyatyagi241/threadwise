import { expect } from 'vitest';
import {
  Api,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

export { Api, startHarness, type Grant, type Harness, type Tenant };

let ipCounter = 1;
/** A different client address per call: the public door's per-IP budgets are not what most tests are about. */
export const nextIp = (): string => `10.66.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows and bodies are read by name in assertions; a type per query would be noise
export type Row = Record<string, any>;

export const FORMS_READ: Grant[] = [['record.forms.read']];
export const FORMS_WRITE: Grant[] = [
  ['record.forms.read'],
  ['record.forms.create'],
  ['record.forms.update'],
  ['record.forms.delete'],
];
export const SUBMISSIONS_READ: Grant[] = [['record.form-submissions.read']];

/** A field block as the builder sends it. */
export const field = (id: string, kind: string, over: Record<string, unknown> = {}) => ({
  id,
  type: 'field',
  kind,
  label: id.replace(/_/g, ' '),
  ...over,
});

/** The definition most tests publish: a name, an email, a phone, a company and a free message. */
export const contactDefinition = (over: Record<string, unknown> = {}) => ({
  title: 'Get in touch',
  steps: [
    {
      id: 'main',
      blocks: [
        field('name', 'short_text', {
          required: true,
          bind: { object: 'contact', property: 'name' },
        }),
        field('email', 'email', { required: true, bind: { object: 'contact', property: 'email' } }),
        field('phone', 'phone', { bind: { object: 'contact', property: 'phone' } }),
        field('company', 'short_text', { bind: { object: 'company', property: 'name' } }),
        field('website', 'short_text', { bind: { object: 'company', property: 'domain' } }),
        field('note', 'long_text'),
      ],
    },
  ],
  settings: { phoneCountryCode: '91', successMessage: '<p>Thanks, <b>we got it</b>.</p>' },
  mapping: { company: { match: 'name_or_domain' } },
  after: { tags: ['Website'] },
  ...over,
});

export interface CreatedForm {
  id: string;
  name: string;
  status: string;
  publicKey: string;
  rowVersion: number;
  publishedVersion: number | null;
  hasUnpublishedChanges: boolean;
  draft: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  settings: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  share: {
    hostedUrl: string;
    embedScriptUrl: string;
    scriptSnippet: string;
    iframeSnippet: string;
  };
}

/** Forms-specific helpers on top of the contacts harness (same app, same database, organizations of their own). */
export class FormsApi extends Api {
  /** Gives the workspace the Forms add-on, the way owning the Marketplace app does (a plan feature override). */
  async enable(orgId: number, limits: Record<string, number> = {}): Promise<void> {
    await this.setOverrides(orgId, {
      features: { form_builder: true },
      ...(Object.keys(limits).length > 0 ? { limits } : {}),
    });
  }

  /** A workspace that does NOT own the add-on. A database with no plan rows treats every feature as granted, so the lock is explicit. */
  async locked(label = 'lck'): Promise<Tenant> {
    const t = await this.signup(label);
    await this.setOverrides(t.orgId, { features: { form_builder: false } });
    return t;
  }

  async userUuid(userId: number): Promise<string> {
    return (await this.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0]
      .uuid as string;
  }

  async setOverrides(orgId: number, overrides: Record<string, unknown>): Promise<void> {
    await this.h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      orgId,
      JSON.stringify(overrides),
    ]);
  }

  /** A new workspace that owns the add-on. */
  async workspace(label = 'frm', limits: Record<string, number> = {}): Promise<Tenant> {
    const t = await this.signup(label);
    await this.enable(t.orgId, limits);
    return t;
  }

  async createForm(token: string, body: Record<string, unknown> = {}): Promise<CreatedForm> {
    const name =
      (body.name as string | undefined) ?? `Form ${Math.random().toString(36).slice(2, 8)}`;
    const res = await this.as(token)
      .post('/v2/forms')
      .send({ definition: contactDefinition(), ...body, name });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as CreatedForm;
  }

  async publish(token: string, form: { id: string; rowVersion: number }): Promise<CreatedForm> {
    const res = await this.as(token)
      .post(`/v2/forms/${form.id}/publish`)
      .send({ rowVersion: form.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as CreatedForm;
  }

  /** A published form, ready for the public door. */
  async liveForm(token: string, body: Record<string, unknown> = {}): Promise<CreatedForm> {
    return this.publish(token, await this.createForm(token, body));
  }

  async patchForm(
    token: string,
    form: { id: string; rowVersion: number },
    body: Record<string, unknown>,
  ): Promise<CreatedForm> {
    const res = await this.as(token)
      .patch(`/v2/forms/${form.id}`)
      .send({ rowVersion: form.rowVersion, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as CreatedForm;
  }

  /** One submission to the public door, JSON, from a fresh address unless told otherwise. */
  submit(
    key: string,
    body: Record<string, unknown> = {},
    opts: { ip?: string; origin?: string; headers?: Record<string, string> } = {},
  ) {
    let req = this.http()
      .post(`/v2/public/forms/${key}/submit`)
      .set('x-forwarded-for', opts.ip ?? nextIp());
    if (opts.origin) req = req.set('origin', opts.origin);
    for (const [k, v] of Object.entries(opts.headers ?? {})) req = req.set(k, v);
    return req.send({
      idempotencyKey: `idem-${Math.random().toString(36).slice(2, 12)}`,
      answers: {},
      ...body,
    });
  }

  publicGet(
    key: string,
    opts: { ip?: string; origin?: string; headers?: Record<string, string> } = {},
  ) {
    let req = this.http()
      .get(`/v2/public/forms/${key}`)
      .set('x-forwarded-for', opts.ip ?? nextIp());
    if (opts.origin) req = req.set('origin', opts.origin);
    for (const [k, v] of Object.entries(opts.headers ?? {})) req = req.set(k, v);
    return req;
  }

  /** Rows of a table of this org, straight from the database (the owner connection; asserting only). */
  async rows(orgId: number, sqlText: string, params: unknown[] = []): Promise<Row[]> {
    return (await this.h.owner.query(sqlText, [orgId, ...params])).rows;
  }

  async submissions(orgId: number, formUuid?: string) {
    return this.rows(
      orgId,
      `SELECT x.*, f.uuid AS form_uuid FROM web_form_submissions x JOIN web_forms f ON f.org_id = x.org_id AND f.id = x.form_id
       WHERE x.org_id = $1 ${formUuid ? `AND f.uuid = $2::uuid` : ''} ORDER BY x.id`,
      formUuid ? [formUuid] : [],
    );
  }

  async contactByEmail(orgId: number, email: string) {
    return (
      await this.rows(orgId, `SELECT * FROM contacts WHERE org_id = $1 AND normalized_email = $2`, [
        email,
      ])
    )[0];
  }

  async contactCount(orgId: number): Promise<number> {
    return Number(
      (await this.rows(orgId, `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`))[0]!.n,
    );
  }

  async companyCount(orgId: number): Promise<number> {
    return Number(
      (await this.rows(orgId, `SELECT count(*)::int AS n FROM companies WHERE org_id = $1`))[0]!.n,
    );
  }

  async eventsOfType(orgId: number, type: string) {
    return this.rows(
      orgId,
      `SELECT aggregate_id, payload FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
      [type],
    );
  }

  /** A contact through the API (so it has its identities, like a contact a person made). */
  async contact(token: string, body: Record<string, unknown>): Promise<Row> {
    const res = await this.as(token).post('/v2/contacts').send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as Row;
  }

  /** A custom contact or company property in the registry (the owner connection; arranging only). */
  async property(
    orgId: number,
    moduleKey: 'contacts' | 'companies',
    key: string,
    type: string,
    extra: { required?: boolean; options?: string[] } = {},
  ) {
    const res = await this.h.owner.query(
      `INSERT INTO fields (org_id, module_key, key, label, field_type, is_required) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [orgId, moduleKey, key, key.replace(/_/g, ' '), type, extra.required === true],
    );
    const id = Number(res.rows[0].id);
    for (const [i, o] of (extra.options ?? []).entries()) {
      await this.h.owner.query(
        `INSERT INTO field_options (org_id, field_id, value, label, position) VALUES ($1,$2,$3,$3,$4)`,
        [orgId, id, o, i],
      );
    }
  }
}
