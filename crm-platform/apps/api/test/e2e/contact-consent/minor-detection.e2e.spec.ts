import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConsentGate } from '../../../src/modules/contact-consent/consent-gate.service';
import { MinorDetectionService } from '../../../src/modules/contact-consent/minor-detection.service';
import { startAiStub, WidgetApi, type AiStub } from '../chatbot-widget/support';
import { tenantWithKey } from '../developer-rest-api-v1/support';
import {
  FormsApi,
  field,
  startHarness,
  type Harness,
  type Tenant,
} from '../forms-builder/support';

/**
 * How a minor is detected (BL-211, BL-212, BL-190) and the Do-Not-Call list (BL-181), on a real Postgres (restricted role, forced RLS), Redis
 * and the real app: the date of birth on the contact, the automatic flag and the birthday sweep, the age gate of a form and of a chat
 * widget, the minor filter and segment fields, the CSV import columns, the customer API, and the DNC list read by the ConsentGate.
 */
let h: Harness;
let api: FormsApi;
let widgets: WidgetApi;
let ai: AiStub;
let gate: ConsentGate;
let minors: MinorDetectionService;

beforeAll(async () => {
  ai = await startAiStub();
  process.env.WGT_AI_OPENAI_API_KEY = 'sk-test';
  process.env.WGT_AI_OPENAI_BASE_URL = ai.url;
  h = await startHarness();
  api = new FormsApi(h);
  widgets = new WidgetApi(h);
  gate = h.app.get(ConsentGate);
  minors = h.app.get(MinorDetectionService);
}, 300_000);

afterAll(async () => {
  await h?.stop();
  await ai?.stop();
  delete process.env.WGT_AI_OPENAI_API_KEY;
  delete process.env.WGT_AI_OPENAI_BASE_URL;
});

const q = async (sql: string, params: unknown[] = []) => (await h.owner.query(sql, params)).rows;
const day = (years: number, extraDays = 0): string =>
  new Date(Date.now() - (years * 365.25 + extraDays) * 86_400_000).toISOString().slice(0, 10);
const MINOR = day(10);
const ADULT = day(30);
let n = 0;
const phone = () => `+9197${String(60_000_000 + n++).padStart(8, '0')}`;
const email = (label: string) => `${label}${Date.now().toString(36)}${n++}@example.test`;

const flagsOf = async (t: Tenant, uuid: string) =>
  (
    await q(
      `SELECT f.* FROM contact_privacy_flags f JOIN contacts c ON c.org_id = f.org_id AND c.id = f.contact_id
       WHERE f.org_id = $1 AND c.uuid = $2`,
      [t.orgId, uuid],
    )
  )[0] as
    | { is_minor: boolean; minor_source: string | null; minor_until: string | null; dob_override_for: string | null }
    | undefined;

async function create(t: Tenant, body: Record<string, unknown>) {
  const res = await api
    .as(t.admin)
    .post('/v2/contacts')
    .send({ phone: phone(), ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; dateOfBirth: string | null; isMinor: boolean };
}

const flag = (t: Tenant, uuid: string, body: Record<string, unknown>) =>
  api
    .as(t.admin)
    .post(`/v2/contact-consent/contacts/${uuid}/privacy-events`)
    .set('idempotency-key', `k-${Math.random().toString(36).slice(2)}`)
    .send(body);

describe('the date of birth on a contact', () => {
  it('flags a contact that is under the workspace age (18 by default) and not an adult; keeps the date', async () => {
    const t = await api.workspace('md-create');
    const kid = await create(t, { name: 'Kid', dateOfBirth: MINOR });
    expect(kid).toMatchObject({ dateOfBirth: MINOR, isMinor: true });
    const f = await flagsOf(t, kid.id);
    expect(f).toMatchObject({ is_minor: true, minor_source: 'dob' });
    expect(f!.minor_until).not.toBeNull();
    const adult = await create(t, { name: 'Adult', dateOfBirth: ADULT });
    expect(adult).toMatchObject({ dateOfBirth: ADULT, isMinor: false });
    expect(await flagsOf(t, adult.id)).toBeUndefined();
    const none = await create(t, { name: 'Nobody' });
    expect(none).toMatchObject({ dateOfBirth: null, isMinor: false });
  });

  it('refuses a date in the future and one that is not a date', async () => {
    const t = await api.workspace('md-bad');
    for (const dateOfBirth of ['2999-01-01', 'yesterday', '2010-02-30']) {
      const res = await api.as(t.admin).post('/v2/contacts').send({ name: 'X', phone: phone(), dateOfBirth });
      expect(res.status, dateOfBirth).toBe(422);
    }
  });

  it('uses the age of the profiles switched on: 16 under gdpr_eu', async () => {
    const t = await api.workspace('md-gdpr');
    const cur = (await api.as(t.admin).get('/v2/compliance/settings')).body;
    const { suggestion: _s, workspaceTimezone: _w, regimesConfirmedAt: _c, updatedAt: _u, ...doc } = cur;
    if (doc.rowVersion === null) delete doc.rowVersion;
    const saved = await api.as(t.admin).patch('/v2/compliance/settings').send({ ...doc, regimes: ['gdpr_eu'] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const seventeen = await create(t, { name: 'Seventeen', dateOfBirth: day(17, 30) });
    expect(seventeen.isMinor).toBe(false);
    const fifteen = await create(t, { name: 'Fifteen', dateOfBirth: day(15, 30) });
    expect(fifteen.isMinor).toBe(true);
  });

  it('lifts its own flag when a corrected date says adult, and never touches a flag a person set', async () => {
    const t = await api.workspace('md-fix');
    const kid = await create(t, { name: 'Kid', dateOfBirth: MINOR });
    const row = (await api.as(t.admin).get(`/v2/contacts/${kid.id}`)).body;
    const fixed = await api
      .as(t.admin)
      .patch(`/v2/contacts/${kid.id}`)
      .send({ dateOfBirth: ADULT, rowVersion: row.rowVersion });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    expect(fixed.body).toMatchObject({ dateOfBirth: ADULT, isMinor: false });

    // A person flags a contact whose date says adult: the date never clears it.
    const adult = await create(t, { name: 'Flagged by hand', dateOfBirth: ADULT });
    expect((await flag(t, adult.id, { kind: 'minor', value: true })).status).toBe(201);
    const row2 = (await api.as(t.admin).get(`/v2/contacts/${adult.id}`)).body;
    await api.as(t.admin).patch(`/v2/contacts/${adult.id}`).send({ dateOfBirth: day(40), rowVersion: row2.rowVersion });
    expect((await flagsOf(t, adult.id))!).toMatchObject({ is_minor: true, minor_source: 'manual', minor_until: null });
  });
});

describe('the birthday sweep', () => {
  it('lifts a dob flag whose day has come, flags an unevaluated young contact, and leaves a person alone', async () => {
    const t = await api.workspace('md-sweep');
    // 1. A dob flag that has lapsed (the day was yesterday).
    const lapsed = await create(t, { name: 'Lapsed', dateOfBirth: MINOR });
    await q(
      `UPDATE contact_privacy_flags SET minor_until = CURRENT_DATE - 2 WHERE org_id = $1 AND contact_id = (SELECT id FROM contacts WHERE org_id = $1 AND uuid = $2)`,
      [t.orgId, lapsed.id],
    );
    await q(`UPDATE contacts SET date_of_birth = $3::date WHERE org_id = $1 AND uuid = $2`, [t.orgId, lapsed.id, ADULT]);
    // 2. A manual flag with a lapsed-looking date must not be touched.
    const manual = await create(t, { name: 'Manual', dateOfBirth: ADULT });
    await flag(t, manual.id, { kind: 'minor', value: true });
    // 3. A contact written with a date and no evaluation (a path that skipped the service).
    const [raw] = await api.seedContacts(t, [{ name: 'Raw young', phone: phone() }]);
    await q(`UPDATE contacts SET date_of_birth = $3::date WHERE org_id = $1 AND uuid = $2`, [t.orgId, raw, MINOR]);
    // 4. A person cleared the flag while the date still said minor: not flagged again.
    const reviewed = await create(t, { name: 'Reviewed', dateOfBirth: MINOR });
    expect((await flag(t, reviewed.id, { kind: 'minor', value: false })).status).toBe(201);
    expect((await flagsOf(t, reviewed.id))!.dob_override_for).toBe(MINOR);

    const out = await minors.sweep();
    expect(out.lifted).toBeGreaterThanOrEqual(1);
    expect(out.flagged).toBeGreaterThanOrEqual(1);
    expect((await flagsOf(t, lapsed.id))!.is_minor).toBe(false);
    expect((await flagsOf(t, manual.id))!).toMatchObject({ is_minor: true, minor_source: 'manual' });
    expect((await flagsOf(t, raw!))!).toMatchObject({ is_minor: true, minor_source: 'dob' });
    expect((await flagsOf(t, reviewed.id))!.is_minor).toBe(false);

    // The next night changes nothing.
    const again = await minors.sweep();
    expect(again).toEqual({ lifted: 0, flagged: 0 });
  });

  it('keeps an age-answer flag until the latest day the person can turn of age, then lifts it', async () => {
    const t = await api.workspace('md-age');
    const c = await create(t, { name: 'Age only' });
    const id = Number((await q(`SELECT id FROM contacts WHERE org_id = $1 AND uuid = $2`, [t.orgId, c.id]))[0].id);
    await q(
      `INSERT INTO contact_privacy_flags (org_id, contact_id, is_minor, minor_since, minor_source, minor_until)
       VALUES ($1, $2, true, now(), 'dob', CURRENT_DATE - 1)
       ON CONFLICT (org_id, contact_id) DO UPDATE SET is_minor = true, minor_source = 'dob', minor_until = CURRENT_DATE - 1`,
      [t.orgId, id],
    );
    const out = await minors.sweep();
    expect(out.lifted).toBeGreaterThanOrEqual(1);
    expect((await flagsOf(t, c.id))!.is_minor).toBe(false);
  });
});

describe('the age gate on a form', () => {
  const ageBlocks = (kind: 'date_of_birth' | 'age' | null) => [
    field('email', 'email', { required: true, bind: { object: 'contact', property: 'email' } }),
    ...(kind ? [field('how_old', kind, { required: true })] : []),
  ];
  const def = (gate: Record<string, unknown>, kind: 'date_of_birth' | 'age' | null, extra: Record<string, unknown> = {}) => ({
    title: 'Age gated',
    steps: [{ id: 'main', blocks: ageBlocks(kind) }],
    ageGate: { enabled: true, ...gate },
    ...extra,
  });

  it('block: an under-age date of birth is refused before anything is stored; an adult goes through and the date is kept', async () => {
    const t = await api.workspace('fg-block');
    const form = await api.liveForm(t.admin, { definition: def({ mode: 'dob', whenUnder: 'block' }, 'date_of_birth') });
    const who = email('kid');
    const refused = await api.submit(form.publicKey, { answers: { email: who, how_old: MINOR } });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(refused.body.code).toBe('FORMS_AGE_BLOCKED');
    // Neutral: it does not say why or what would pass.
    expect(JSON.stringify(refused.body).toLowerCase()).not.toMatch(/18|age|old|minor|year/);
    expect(await api.submissions(t.orgId, form.id)).toHaveLength(0);
    expect(await api.contactByEmail(t.orgId, who)).toBeUndefined();

    const okMail = email('adult');
    const ok = await api.submit(form.publicKey, { answers: { email: okMail, how_old: ADULT } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const c = await api.contactByEmail(t.orgId, okMail);
    expect(String(c.date_of_birth).slice(0, 10)).toBe(ADULT);
  });

  it('the public form never carries the action or the minimum of a date of birth question, but the box names its age', async () => {
    const t = await api.workspace('fg-public');
    const dob = await api.liveForm(t.admin, { definition: def({ mode: 'dob', whenUnder: 'guardian', minAge: 16 }, 'date_of_birth') });
    const a = (await api.publicGet(dob.publicKey)).body;
    expect(a.ageGate).toEqual({ mode: 'dob', declarationAge: null });
    const box = await api.liveForm(t.admin, { definition: def({ mode: 'declaration', whenUnder: 'flag', minAge: 16 }, null) });
    const b = (await api.publicGet(box.publicKey)).body;
    expect(b.ageGate).toEqual({ mode: 'declaration', declarationAge: 16 });
    const off = await api.liveForm(t.admin, {});
    expect((await api.publicGet(off.publicKey)).body.ageGate).toBeNull();
  });

  it('flag: accepts the under-age visitor, flags the contact, and records no marketing consent', async () => {
    const t = await api.workspace('fg-flag');
    const form = await api.liveForm(t.admin, {
      definition: def({ mode: 'dob', whenUnder: 'flag' }, 'date_of_birth', {
        consent: { enabled: true, text: 'Send me offers', required: false, marketing: true, channels: ['email'] },
      }),
    });
    const who = email('flag');
    const res = await api.submit(form.publicKey, {
      answers: { email: who, how_old: MINOR },
      consent: { given: true, textVersion: 1 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const c = await api.contactByEmail(t.orgId, who);
    const f = await q(`SELECT * FROM contact_privacy_flags WHERE org_id = $1 AND contact_id = $2`, [t.orgId, c.id]);
    expect(f[0]).toMatchObject({ is_minor: true, minor_source: 'dob' });
    expect(await q(`SELECT 1 FROM contact_consent_events WHERE org_id = $1 AND contact_id = $2 AND action = 'granted'`, [t.orgId, c.id])).toHaveLength(0);
    const subs = await api.submissions(t.orgId, form.id);
    expect(subs[0].answers._age_gate).toBe('under');
  });

  it('guardian: asks for a parent before it accepts, keeps their details on the submission and the timeline', async () => {
    const t = await api.workspace('fg-guard');
    const form = await api.liveForm(t.admin, { definition: def({ mode: 'age', whenUnder: 'guardian', minAge: 16 }, 'age') });
    const who = email('guard');
    const first = await api.submit(form.publicKey, { answers: { email: who, how_old: 12 } });
    expect(first.status).toBe(422);
    expect(first.body.code).toBe('FORMS_GUARDIAN_REQUIRED');
    expect(await api.submissions(t.orgId, form.id)).toHaveLength(0);

    const second = await api.submit(form.publicKey, {
      answers: { email: who, how_old: 12 },
      guardian: { name: 'Asha Rao', email: 'asha@example.test' },
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const c = await api.contactByEmail(t.orgId, who);
    expect((await q(`SELECT is_minor FROM contact_privacy_flags WHERE org_id = $1 AND contact_id = $2`, [t.orgId, c.id]))[0].is_minor).toBe(true);
    // The guardian consent is NOT recorded until a person records it.
    expect((await q(`SELECT guardian_consent FROM contact_privacy_flags WHERE org_id = $1 AND contact_id = $2`, [t.orgId, c.id]))[0].guardian_consent).toBe(false);
    const subs = await api.submissions(t.orgId, form.id);
    const detail = await api.as(t.admin).get(`/v2/forms/${form.id}/submissions/${subs[0].uuid}`);
    expect(detail.body).toMatchObject({ ageGate: 'under', guardian: { name: 'Asha Rao', email: 'asha@example.test', phone: null } });
    const timeline = await q(`SELECT title FROM contact_activities WHERE org_id = $1 AND contact_id = $2 AND activity_type = 'guardian_details'`, [t.orgId, c.id]);
    expect(timeline).toHaveLength(1);
  });

  it('the box: with block the box only has to be ticked; with flag an unticked box flags the contact', async () => {
    const t = await api.workspace('fg-box');
    const blockForm = await api.liveForm(t.admin, { definition: def({ mode: 'declaration', whenUnder: 'block', minAge: 16 }, null) });
    const unticked = await api.submit(blockForm.publicKey, { answers: { email: email('b1') } });
    expect(unticked.status).toBe(422);
    expect(unticked.body.code).toBe('FORMS_VALIDATION');
    const ticked = await api.submit(blockForm.publicKey, { answers: { email: email('b2') }, ageConfirmed: true });
    expect(ticked.status, JSON.stringify(ticked.body)).toBe(201);

    const flagForm = await api.liveForm(t.admin, { definition: def({ mode: 'declaration', whenUnder: 'flag', minAge: 16 }, null) });
    const who = email('b3');
    expect((await api.submit(flagForm.publicKey, { answers: { email: who } })).status).toBe(201);
    const c = await api.contactByEmail(t.orgId, who);
    expect((await q(`SELECT minor_source, minor_until FROM contact_privacy_flags WHERE org_id = $1 AND contact_id = $2`, [t.orgId, c.id]))[0]).toEqual({ minor_source: 'declaration', minor_until: null });
  });

  it('publish wants the question for a date-of-birth gate, and wants it required', async () => {
    const t = await api.workspace('fg-pub');
    const missing = await api.createForm(t.admin, { definition: def({ mode: 'dob' }, null) });
    const res = await api.as(t.admin).post(`/v2/forms/${missing.id}/publish`).send({ rowVersion: missing.rowVersion });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('age_gate_field_missing');
  });
});

describe('the age question of a chat widget', () => {
  it('block refuses the chat and stores nothing; an adult passes once and is not asked again', async () => {
    const t = await widgets.signup('wg-block');
    const assistant = await widgets.assistant(t);
    const w = await widgets.widget(t.admin, {
      name: 'Gated chat',
      mode: 'ai',
      assistantId: assistant.uuid,
      collectName: true,
      collectEmail: true,
      ageGate: { enabled: true, mode: 'dob', whenUnder: 'block' },
    });
    const cfg = (await widgets.pub(w.embedToken).config()).body;
    expect(cfg.widget.age_gate).toEqual({ mode: 'dob', declaration_age: null, pending: true });
    const uuid = cfg.visitor.uuid as string;

    const noAnswer = await widgets.pub(w.embedToken).message({ visitor_uuid: uuid, body: 'hi', name: 'Kim', email: email('k') });
    expect(noAnswer.status).toBe(422);
    const under = await widgets.pub(w.embedToken).message({ visitor_uuid: uuid, body: 'hi', name: 'Kim', email: email('k'), date_of_birth: MINOR });
    expect(under.status).toBe(403);
    expect(under.body.code).toBe('age_blocked');
    expect(await widgets.count(`SELECT count(*) AS n FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id WHERE m.org_id = $1`, [t.orgId])).toBe(0);
    // The refused visitor's profile was not kept.
    expect((await q(`SELECT name, email FROM chatbot_widget_visitors WHERE org_id = $1 AND visitor_uuid = $2`, [t.orgId, uuid]))[0]).toEqual({ name: null, email: null });

    const who = email('adult');
    const ok = await widgets.pub(w.embedToken).message({ visitor_uuid: uuid, body: 'hello', name: 'Ada', email: who, date_of_birth: ADULT });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const again = await widgets.pub(w.embedToken).message({ visitor_uuid: uuid, body: 'and again' });
    expect(again.status).toBe(200);
    const cfg2 = (await widgets.pub(w.embedToken).config(uuid)).body;
    expect(cfg2.widget.age_gate.pending).toBe(false);
    const c = (await q(`SELECT date_of_birth FROM contacts WHERE org_id = $1 AND normalized_email = $2`, [t.orgId, who]))[0];
    expect(String(c.date_of_birth).slice(0, 10)).toBe(ADULT);
  });

  it('flag lets the chat go on and flags the contact once there is one', async () => {
    const t = await widgets.signup('wg-flag');
    const assistant = await widgets.assistant(t);
    const w = await widgets.widget(t.admin, {
      name: 'Flag chat',
      mode: 'ai',
      assistantId: assistant.uuid,
      collectEmail: true,
      ageGate: { enabled: true, mode: 'age', whenUnder: 'flag', minAge: 16 },
    });
    const uuid = (await widgets.pub(w.embedToken).config()).body.visitor.uuid as string;
    const who = email('young');
    const res = await widgets.pub(w.embedToken).message({ visitor_uuid: uuid, body: 'hi', email: who, age: '13' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const c = (await q(`SELECT id FROM contacts WHERE org_id = $1 AND normalized_email = $2`, [t.orgId, who]))[0];
    const f = (await q(`SELECT is_minor, minor_source FROM contact_privacy_flags WHERE org_id = $1 AND contact_id = $2`, [t.orgId, c.id]))[0];
    expect(f).toEqual({ is_minor: true, minor_source: 'dob' });
  });

  it('the widget refuses a guardian action (a chat has no second screen)', async () => {
    const t = await widgets.signup('wg-guard');
    const res = await widgets.as(t.admin).post('/v2/widgets').send({
      name: 'Bad',
      mode: 'whatsapp',
      position: 'bottom_right',
      buttonColor: '#075E54',
      headerTitle: 'x',
      headerBg: '#075E54',
      headerTextColor: '#FFFFFF',
      messageBubbleColor: '#FFFFFF',
      messageTextColor: '#222222',
      bodyBgKind: 'color',
      bodyBgColor: '#ECE5DD',
      buttonLabel: 'x',
      actionButtonBg: '#075E54',
      actionButtonTextColor: '#FFFFFF',
      targetWhatsappCc: '+91',
      targetWhatsappNumber: '9876543210',
      ageGate: { enabled: true, mode: 'dob', whenUnder: 'guardian' },
    });
    expect(res.status).toBe(422);
  });
});

describe('minors in lists, segments and the customer API (BL-190)', () => {
  it('filters the contact list by the minor flag, in both directions', async () => {
    const t = await api.workspace('ls-filter');
    const kid = await create(t, { name: 'Young one', dateOfBirth: MINOR });
    const adult = await create(t, { name: 'Old one', dateOfBirth: ADULT });
    const minorsOnly = (await api.as(t.admin).get('/v2/contacts?minor=true')).body;
    expect(minorsOnly.data.map((c: { id: string }) => c.id)).toEqual([kid.id]);
    expect(minorsOnly.data[0].isMinor).toBe(true);
    const rest = (await api.as(t.admin).get('/v2/contacts?minor=false')).body;
    expect(rest.data.map((c: { id: string }) => c.id)).toEqual([adult.id]);
  });

  it('segment rules read minor, dateOfBirth and age', async () => {
    const t = await api.workspace('ls-seg');
    const kid = await create(t, { name: 'Ten', dateOfBirth: MINOR });
    const adult = await create(t, { name: 'Thirty', dateOfBirth: ADULT });
    await create(t, { name: 'No date' });
    const rules = (r: unknown) => encodeURIComponent(JSON.stringify({ type: 'group', combinator: 'and', children: [r] }));
    const ids = async (r: unknown) =>
      ((await api.as(t.admin).get(`/v2/contacts?rules=${rules(r)}`)).body.data as Array<{ id: string }>).map((c) => c.id).sort();
    expect(await ids({ type: 'condition', field: 'minor', operator: 'is_true' })).toEqual([kid.id]);
    expect(await ids({ type: 'condition', field: 'age', operator: 'lt', value: 18 })).toEqual([kid.id]);
    expect(await ids({ type: 'condition', field: 'age', operator: 'gte', value: 18 })).toEqual([adult.id]);
    expect(await ids({ type: 'condition', field: 'dateOfBirth', operator: 'before', value: day(20) })).toEqual([adult.id]);
  });

  it('imports a date of birth and a minor column, and refuses a day-first date', async () => {
    const t = await api.workspace('ls-import');
    const csv = [
      'name,mobile,dob,minor',
      `Imp Kid,${phone().slice(1)},${MINOR},`,
      `Imp Adult,${phone().slice(1)},${ADULT},`,
      `Imp Yes,${phone().slice(1)},,yes`,
      `Imp Bad,${phone().slice(1)},31/12/2010,`,
    ].join('\n');
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/import')
      .attach('file', Buffer.from(csv), 'people.csv')
      .field('defaultCountryCode', '+91');
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const byName = async (name: string) => (await q(`SELECT id, uuid, date_of_birth FROM contacts WHERE org_id = $1 AND name = $2`, [t.orgId, name]))[0];
    const kid = await byName('Imp Kid');
    expect(String(kid.date_of_birth).slice(0, 10)).toBe(MINOR);
    expect((await flagsOf(t, kid.uuid))!).toMatchObject({ is_minor: true, minor_source: 'dob' });
    expect(await flagsOf(t, (await byName('Imp Adult')).uuid)).toBeUndefined();
    expect((await flagsOf(t, (await byName('Imp Yes')).uuid))!).toMatchObject({ is_minor: true, minor_source: 'import' });
    expect(await byName('Imp Bad')).toBeUndefined();
  });

  it('the customer API reads date_of_birth and is_minor, writes the date, and records a flag over /privacy', async () => {
    const { tenant, call } = await tenantWithKey(api, 'ls-v1');
    const made = await call.post('/contacts').send({ name: 'V1 Kid', phone: phone(), date_of_birth: MINOR });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    expect(made.body.data).toMatchObject({ date_of_birth: MINOR, is_minor: true });
    const id = made.body.data.id as string;

    const adult = await call.post('/contacts').send({ name: 'V1 Adult', phone: phone(), date_of_birth: ADULT });
    expect(adult.body.data).toMatchObject({ date_of_birth: ADULT, is_minor: false });
    const adultId = adult.body.data.id as string;
    const flagged = await call.post(`/contacts/${adultId}/privacy`).set('idempotency-key', 'v1-k1').send({ kind: 'minor', value: true });
    expect(flagged.status, JSON.stringify(flagged.body)).toBe(201);
    expect(flagged.body.data).toMatchObject({ isMinor: true, minorSource: 'api' });
    const shown = await call.get(`/contacts/${adultId}`);
    expect(shown.body.data.is_minor).toBe(true);
    const list = await call.get('/contacts');
    expect(list.body.data.find((c: { id: string }) => c.id === id).is_minor).toBe(true);
    const cleared = await call.put(`/contacts/${id}`).send({ date_of_birth: null });
    expect(cleared.body.data.date_of_birth).toBeNull();
    expect(tenant.orgId).toBeGreaterThan(0);
  });
});

describe('the Do-Not-Call list (BL-181)', () => {
  const dnc = (t: Tenant) => api.as(t.admin);
  const check = (t: Tenant, contactId: number, channel: string) =>
    gate.check(t.orgId, { type: 'contact', id: contactId }, channel, 'marketing_messaging');
  const idOf = async (t: Tenant, uuid: string) =>
    Number((await q(`SELECT id FROM contacts WHERE org_id = $1 AND uuid = $2`, [t.orgId, uuid]))[0].id);

  it('adds numbers (local ones with the default country), ignores repeats, and counts what is not a number', async () => {
    const t = await api.workspace('dnc-add');
    const res = await dnc(t).post('/v2/compliance/dnc').send({
      numbers: ['+91 98765 43210', '098765 43210', '+14155550123', 'hello', '12'],
      defaultCountryCode: '+91',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ added: 2, alreadyListed: 0, invalid: 2 });
    expect(res.body.invalidSamples).toEqual(['hello', '12']);
    const again = await dnc(t).post('/v2/compliance/dnc').send({ numbers: ['919876543210'], defaultCountryCode: '91' });
    expect(again.body).toMatchObject({ added: 0, alreadyListed: 1 });
    const list = (await dnc(t).get('/v2/compliance/dnc')).body;
    expect(list.total).toBe(2);
    expect(list.data.map((e: { phone: string }) => e.phone).sort()).toEqual(['+14155550123', '+919876543210']);
    const found = (await dnc(t).get('/v2/compliance/dnc?q=4155')).body;
    expect(found.data).toHaveLength(1);
  });

  it('imports a CSV by its phone column and refuses a file with no numbers', async () => {
    const t = await api.workspace('dnc-csv');
    const ok = await dnc(t).post('/v2/compliance/dnc/import').send({
      csv: 'name,Mobile\nA,+919811111111\nB,"+91 98222 22222"\nC,nope',
      source: 'registry_export',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ added: 2, invalid: 1 });
    expect((await dnc(t).get('/v2/compliance/dnc')).body.data[0].source).toBe('registry_export');
    const headerless = await dnc(t).post('/v2/compliance/dnc/import').send({ csv: '+919833333333\n+919844444444', defaultCountryCode: '91' });
    expect(headerless.body.added).toBe(2);
    const empty = await dnc(t).post('/v2/compliance/dnc/import').send({ csv: '   \n  ' });
    expect(empty.status).toBe(422);
    expect(empty.body.code).toBe('COMPLIANCE_DNC_INVALID');
  });

  it('the gate holds marketing by voice and SMS to a listed number, and nothing else', async () => {
    const t = await api.workspace('dnc-gate');
    const [uuid] = await api.seedContacts(t, [{ name: 'Listed', phone: '+919855555555' }]);
    const id = await idOf(t, uuid!);
    expect((await check(t, id, 'sms')).decision).toBe('allow');
    await dnc(t).post('/v2/compliance/dnc').send({ numbers: ['+91 98555 55555'] });
    expect(await check(t, id, 'sms')).toMatchObject({ decision: 'deny', reason: 'on_dnc_list' });
    expect(await check(t, id, 'voice')).toMatchObject({ decision: 'deny', reason: 'on_dnc_list' });
    // WhatsApp, email and service messages are not held by it.
    expect((await check(t, id, 'whatsapp_cloud')).decision).toBe('allow');
    expect((await check(t, id, 'email')).decision).toBe('allow');
    expect((await gate.check(t.orgId, { type: 'contact', id }, 'sms', 'service_messaging')).decision).toBe('allow');
    // A number with no contact is still held.
    expect(await gate.check(t.orgId, { type: 'phone', phone: '919855555555' }, 'voice', 'marketing_messaging')).toMatchObject({ reason: 'on_dnc_list' });
    // checkMany agrees.
    const many = await gate.checkMany(t.orgId, [id], 'sms', 'marketing_messaging');
    expect(many.counts.on_dnc_list).toBe(1);
    // Removing the number lifts the hold.
    const entry = (await dnc(t).get('/v2/compliance/dnc')).body.data[0];
    expect((await dnc(t).delete(`/v2/compliance/dnc/${entry.id}`)).status).toBe(204);
    expect((await check(t, id, 'sms')).decision).toBe('allow');
    expect((await dnc(t).delete(`/v2/compliance/dnc/${entry.id}`)).status).toBe(404);
  });

  it('is one workspace\'s own: another workspace sees nothing and is not held by it', async () => {
    const a = await api.workspace('dnc-a');
    const b = await api.workspace('dnc-b');
    await dnc(a).post('/v2/compliance/dnc').send({ numbers: ['+919866666666'] });
    expect((await dnc(b).get('/v2/compliance/dnc')).body.total).toBe(0);
    const [uuid] = await api.seedContacts(b, [{ name: 'Same number', phone: '+919866666666' }]);
    expect((await check(b, await idOf(b, uuid!), 'sms')).decision).toBe('allow');
  });

  it('needs the compliance keys: a member without them can neither read nor change the list', async () => {
    const t = await api.workspace('dnc-perm');
    const nobody = await api.member(t, 'plain', [['record.contacts.read']]);
    expect((await api.as(nobody.token).get('/v2/compliance/dnc')).status).toBe(403);
    expect((await api.as(nobody.token).post('/v2/compliance/dnc').send({ numbers: ['+919877777777'] })).status).toBe(403);
    const reader = await api.member(t, 'reader', [['settings.compliance.read']]);
    expect((await api.as(reader.token).get('/v2/compliance/dnc')).status).toBe(200);
    expect((await api.as(reader.token).post('/v2/compliance/dnc').send({ numbers: ['+919877777777'] })).status).toBe(403);
  });

  it('keeps the consent manager registration number with the other consent manager notes', async () => {
    const t = await api.workspace('dnc-cm');
    const cur = (await api.as(t.admin).get('/v2/compliance/settings')).body;
    const { suggestion: _s, workspaceTimezone: _w, regimesConfirmedAt: _c, updatedAt: _u, ...doc } = cur;
    if (doc.rowVersion === null) delete doc.rowVersion;
    const saved = await api.as(t.admin).patch('/v2/compliance/settings').send({
      ...doc,
      consentManager: { name: 'ConsentCo', url: 'https://consent.example', registrationId: 'DPB-1234' },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.consentManager).toEqual({ name: 'ConsentCo', url: 'https://consent.example', registrationId: 'DPB-1234' });
  });
});
