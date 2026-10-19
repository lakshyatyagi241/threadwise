import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConsentGate } from '../../../src/modules/contact-consent/consent-gate.service';
import { startAiStub, WidgetApi, type AiStub } from '../chatbot-widget/support';
import {
  FormsApi,
  contactDefinition,
  startHarness,
  type Harness,
  type Tenant,
} from '../forms-builder/support';

/**
 * Contact-level privacy extras (BL-180) on a real Postgres (restricted role, forced RLS), Redis and the real app: the minor flag and
 * guardian evidence, the Do Not Sell or Share opt-out, the ConsentGate holding marketing to a flagged minor by the workspace's
 * children setting, and the Global Privacy Control signal on a public form and the chat widget.
 */
let h: Harness;
let api: FormsApi;
let widgets: WidgetApi;
let ai: AiStub;
let gate: ConsentGate;

beforeAll(async () => {
  ai = await startAiStub();
  process.env.WGT_AI_OPENAI_API_KEY = 'sk-test';
  process.env.WGT_AI_OPENAI_BASE_URL = ai.url;
  h = await startHarness();
  api = new FormsApi(h);
  widgets = new WidgetApi(h);
  gate = h.app.get(ConsentGate);
}, 300_000);

afterAll(async () => {
  await h?.stop();
  await ai?.stop();
  delete process.env.WGT_AI_OPENAI_API_KEY;
  delete process.env.WGT_AI_OPENAI_BASE_URL;
});

const q = async (sql: string, params: unknown[] = []) => (await h.owner.query(sql, params)).rows;

async function contact(t: Tenant, name: string, phone: string) {
  const [uuid] = await api.seedContacts(t, [{ name, phone }]);
  const id = Number(
    (await q(`SELECT id FROM contacts WHERE org_id = $1 AND uuid = $2`, [t.orgId, uuid]))[0].id,
  );
  return { uuid: uuid!, id };
}

const flag = (t: Tenant, uuid: string, body: Record<string, unknown>, token = t.admin) =>
  api
    .as(token)
    .post(`/v2/contact-consent/contacts/${uuid}/privacy-events`)
    .set('idempotency-key', `k-${Math.random().toString(36).slice(2)}`)
    .send(body);

/** The whole Compliance center document with edits on top (the screen sends it back whole). */
async function compliance(t: Tenant, edit: Record<string, unknown>) {
  const cur = (await api.as(t.admin).get('/v2/compliance/settings')).body;
  const {
    suggestion: _s,
    workspaceTimezone: _w,
    regimesConfirmedAt: _c,
    updatedAt: _u,
    ...doc
  } = cur;
  if (doc.rowVersion === null) delete doc.rowVersion;
  const res = await api
    .as(t.admin)
    .patch('/v2/compliance/settings')
    .send({ ...doc, ...edit });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const marketing = (t: Tenant, id: number) =>
  gate.check(t.orgId, { type: 'contact', id }, 'whatsapp', 'marketing_messaging');

describe('the flags through the API', () => {
  it('marks a minor, records guardian evidence without a grant, and clearing the minor clears the guardian', async () => {
    const t = await api.signup('cpx-flags');
    const c = await contact(t, 'Kid One', '+919700000001');

    const none = await api.as(t.admin).get(`/v2/contact-consent/contacts/${c.uuid}`);
    expect(none.body.privacy).toMatchObject({
      isMinor: false,
      guardianConsent: false,
      doNotSellShare: false,
      ccpaUs: false,
      minorRule: 'off',
      events: [],
    });

    // Guardian consent for someone who is not a minor is refused.
    const early = await flag(t, c.uuid, { kind: 'guardian_consent', value: true, note: 'signed' });
    expect(early.status, JSON.stringify(early.body)).toBe(422);
    expect(early.body.code).toBe('CONSENT_PRIVACY_NOT_MINOR');

    const minor = await flag(t, c.uuid, { kind: 'minor', value: true });
    expect(minor.status, JSON.stringify(minor.body)).toBe(201);
    expect(minor.body.privacy).toMatchObject({ isMinor: true, minorSource: 'manual' });

    // Guardian consent needs a note.
    const bare = await flag(t, c.uuid, { kind: 'guardian_consent', value: true });
    expect(bare.status).toBe(422);
    expect(bare.body.code).toBe('CONSENT_NOTE_REQUIRED');

    const guardian = await flag(t, c.uuid, {
      kind: 'guardian_consent',
      value: true,
      note: 'Mother signed the paper form at the counter',
      evidence: { guardianConsentRef: 'FORM-2231' },
    });
    expect(guardian.status, JSON.stringify(guardian.body)).toBe(201);
    expect(guardian.body.privacy).toMatchObject({ isMinor: true, guardianConsent: true });
    expect(guardian.body.privacy.events[0]).toMatchObject({
      kind: 'guardian_consent',
      value: true,
      evidence: { guardianConsentRef: 'FORM-2231' },
    });
    // Evidence only: the consent ledger has NO event for this contact (no marketing grant was created).
    expect(
      await q(`SELECT 1 FROM contact_consent_events WHERE org_id = $1 AND contact_id = $2`, [
        t.orgId,
        c.id,
      ]),
    ).toHaveLength(0);
    expect(guardian.body.states).toEqual([]);

    // The person comes of age: the minor flag goes, the guardian flag goes with it, both in the history.
    const adult = await flag(t, c.uuid, { kind: 'minor', value: false, note: 'Turned 18' });
    expect(adult.body.privacy).toMatchObject({ isMinor: false, guardianConsent: false });
    const kinds = (adult.body.privacy.events as Array<{ kind: string; value: boolean }>).map(
      (e) => `${e.kind}:${e.value}`,
    );
    expect(kinds).toEqual([
      'guardian_consent:false',
      'minor:false',
      'guardian_consent:true',
      'minor:true',
    ]);
  });

  it('is append-only in the database, idempotent per key, and tenant isolated', async () => {
    const a = await api.signup('cpx-iso-a');
    const b = await api.signup('cpx-iso-b');
    const c = await contact(a, 'Iso Kid', '+919700000002');

    const key = 'same-key-1';
    const first = await api
      .as(a.admin)
      .post(`/v2/contact-consent/contacts/${c.uuid}/privacy-events`)
      .set('idempotency-key', key)
      .send({ kind: 'sale_share_opt_out', value: true, source: 'contact_request' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.privacy).toMatchObject({
      doNotSellShare: true,
      doNotSellShareSource: 'contact_request',
    });
    // The same key again records nothing; the same key for another change is a conflict.
    const repeat = await api
      .as(a.admin)
      .post(`/v2/contact-consent/contacts/${c.uuid}/privacy-events`)
      .set('idempotency-key', key)
      .send({ kind: 'sale_share_opt_out', value: true, source: 'contact_request' });
    expect(repeat.status, JSON.stringify(repeat.body)).toBe(201);
    const clash = await api
      .as(a.admin)
      .post(`/v2/contact-consent/contacts/${c.uuid}/privacy-events`)
      .set('idempotency-key', key)
      .send({ kind: 'minor', value: true, source: 'contact_request' });
    expect(clash.status, JSON.stringify(clash.body)).toBe(409);
    expect(
      await q(`SELECT 1 FROM contact_privacy_events WHERE org_id = $1`, [a.orgId]),
    ).toHaveLength(1);

    // History cannot be edited or deleted, even by the owner connection (the trigger), while the tenant cannot see it across orgs.
    await expect(
      h.owner.query(`UPDATE contact_privacy_events SET value = false WHERE org_id = $1`, [a.orgId]),
    ).rejects.toThrow(/append-only/);
    await expect(
      h.owner.query(`DELETE FROM contact_privacy_events WHERE org_id = $1`, [a.orgId]),
    ).rejects.toThrow(/append-only/);
    expect((await api.as(b.admin).get(`/v2/contact-consent/contacts/${c.uuid}`)).status).toBe(404);
    expect((await flag(b, c.uuid, { kind: 'minor', value: true })).status).toBe(404);
  });

  it('needs contacts.consent.manage to change a flag and contacts.consent.read to see them', async () => {
    const t = await api.signup('cpx-perm');
    const c = await contact(t, 'Perm Kid', '+919700000003');
    const reader = await api.member(t, 'rdr', [['contacts.consent.read']]);
    const none = await api.member(t, 'nop', [['record.contacts.read']]);
    expect((await flag(t, c.uuid, { kind: 'minor', value: true }, reader.token)).status).toBe(403);
    expect((await api.as(reader.token).get(`/v2/contact-consent/contacts/${c.uuid}`)).status).toBe(
      200,
    );
    expect((await api.as(none.token).get(`/v2/contact-consent/contacts/${c.uuid}`)).status).toBe(
      403,
    );
  });
});

describe('the ConsentGate and the workspace children setting', () => {
  it('holds marketing to a flagged minor only when the setting says so, and never holds service messages', async () => {
    const t = await api.signup('cpx-gate');
    const kid = await contact(t, 'Gate Kid', '+919700000010');
    const adult = await contact(t, 'Gate Adult', '+919700000011');
    await flag(t, kid.uuid, { kind: 'minor', value: true });

    // Setting not answered: the flag is recorded and nothing changes (today's behaviour).
    expect(await marketing(t, kid.id)).toEqual({ decision: 'allow', reason: 'policy_off' });

    // "We do not knowingly process minors": held, and guardian evidence does not lift it.
    await compliance(t, { childrenPolicy: 'no_minors' });
    expect(await marketing(t, kid.id)).toEqual({ decision: 'deny', reason: 'subject_minor' });
    expect(await marketing(t, adult.id)).toEqual({ decision: 'allow', reason: 'policy_off' });
    await flag(t, kid.uuid, { kind: 'guardian_consent', value: true, note: 'Signed form' });
    expect(await marketing(t, kid.id)).toEqual({ decision: 'deny', reason: 'subject_minor' });
    // Service messages (an order notice, a reply) are not marketing and are never held by the flag.
    expect(
      (await gate.check(t.orgId, { type: 'contact', id: kid.id }, 'whatsapp', 'service_messaging'))
        .decision,
    ).toBe('allow');

    // "Minors may be included": held until the guardian consent is on record; the flag clearing lifts it too.
    await compliance(t, { childrenPolicy: 'may_include_minors' });
    expect(await marketing(t, kid.id)).toEqual({ decision: 'allow', reason: 'policy_off' });
    const other = await contact(t, 'Gate Kid Two', '+919700000012');
    await flag(t, other.uuid, { kind: 'minor', value: true });
    expect(await marketing(t, other.id)).toEqual({ decision: 'deny', reason: 'subject_minor' });

    // An audience in one pass: the same answers per contact, counted by reason.
    const many = await gate.checkMany(
      t.orgId,
      [kid.id, other.id, adult.id],
      'whatsapp',
      'marketing_messaging',
    );
    expect([...many.allowed].sort()).toEqual([kid.id, adult.id].sort());
    expect(many.counts).toEqual({ policy_off: 2, subject_minor: 1 });

    // The parental-consent flag alone (DPDP) asks for guardian evidence even with the children question unanswered.
    await compliance(t, { childrenPolicy: 'unset', parentalConsentRequired: true });
    expect(await marketing(t, other.id)).toEqual({ decision: 'deny', reason: 'subject_minor' });
    await compliance(t, { childrenPolicy: 'unset', parentalConsentRequired: false });
    expect(await marketing(t, other.id)).toEqual({ decision: 'allow', reason: 'policy_off' });

    // An opt-out is still an opt-out, reported as such before the minor hold.
    await compliance(t, { childrenPolicy: 'no_minors' });
    await api
      .as(t.admin)
      .post(`/v2/contact-consent/contacts/${other.uuid}/events`)
      .set('idempotency-key', 'opt-out-other')
      .send({ action: 'withdrawn', channel: 'whatsapp', purpose: 'marketing' });
    expect(await marketing(t, other.id)).toEqual({ decision: 'deny', reason: 'withdrawn' });
  });

  it('a contact who opted out of sale or sharing is denied third-party sharing, and nobody else is helped by it', async () => {
    const t = await api.signup('cpx-dns');
    const out = await contact(t, 'Opted Out', '+919700000020');
    const other = await contact(t, 'Not Opted', '+919700000021');
    const share = (id: number) =>
      gate.check(t.orgId, { type: 'contact', id }, 'whatsapp', 'third_party_sharing');
    expect(await share(out.id)).toEqual({ decision: 'deny', reason: 'no_consent_recorded' });
    const res = await flag(t, out.uuid, { kind: 'sale_share_opt_out', value: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await share(out.id)).toEqual({ decision: 'deny', reason: 'sale_share_opted_out' });
    expect(await share(other.id)).toEqual({ decision: 'deny', reason: 'no_consent_recorded' });
    // Clearing the opt-out is also a recorded change.
    await flag(t, out.uuid, {
      kind: 'sale_share_opt_out',
      value: false,
      source: 'contact_request',
    });
    expect(await share(out.id)).toEqual({ decision: 'deny', reason: 'no_consent_recorded' });
    const history = await q(
      `SELECT value FROM contact_privacy_events WHERE org_id = $1 AND kind = 'sale_share_opt_out' ORDER BY id`,
      [t.orgId],
    );
    expect(history.map((r) => r.value)).toEqual([true, false]);
  });
});

describe('the Global Privacy Control signal', () => {
  const optOuts = (t: Tenant) =>
    q(
      `SELECT e.source, e.value, e.evidence, e.actor_user_id, c.email FROM contact_privacy_events e
         JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id
        WHERE e.org_id = $1 AND e.kind = 'sale_share_opt_out' ORDER BY e.id`,
      [t.orgId],
    );

  it('a public form submission with Sec-GPC: 1 opts the contact out when the workspace has ccpa_us on', async () => {
    const t = await api.workspace('cpx-gpc');
    const form = await api.liveForm(t.admin, { definition: contactDefinition() });
    const submit = (email: string, headers: Record<string, string> = {}) =>
      api.submit(form.publicKey, { answers: { name: 'Gina Privacy', email } }, { headers });

    // Workspace without the profile: the signal is not recorded.
    expect((await submit('off@example.test', { 'sec-gpc': '1' })).status).toBe(201);
    expect(await optOuts(t)).toHaveLength(0);

    await compliance(t, { regimes: ['ccpa_us'] });
    // Not a signal: absent, 0, or anything but "1".
    expect((await submit('none@example.test')).status).toBe(201);
    expect((await submit('zero@example.test', { 'sec-gpc': '0' })).status).toBe(201);
    expect((await submit('yes@example.test', { 'sec-gpc': 'true' })).status).toBe(201);
    expect(await optOuts(t)).toHaveLength(0);

    expect((await submit('gina@example.test', { 'sec-gpc': '1' })).status).toBe(201);
    const rows = await optOuts(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'gpc',
      value: true,
      actor_user_id: null,
      email: 'gina@example.test',
    });
    expect(Object.keys(rows[0]!.evidence as object).sort()).toEqual(['formId', 'submissionId']);
    expect((rows[0]!.evidence as Record<string, string>).formId).toBe(form.id);

    // The same person again: already opted out, nothing more is written; and no marketing grant ever came with it.
    expect((await submit('gina@example.test', { 'sec-gpc': '1' })).status).toBe(201);
    expect(await optOuts(t)).toHaveLength(1);
    expect(
      await q(`SELECT 1 FROM contact_consent_events WHERE org_id = $1`, [t.orgId]),
    ).toHaveLength(0);
    const contactRow = (
      await q(`SELECT uuid FROM contacts WHERE org_id = $1 AND normalized_email = $2`, [
        t.orgId,
        'gina@example.test',
      ])
    )[0];
    const view = await api.as(t.admin).get(`/v2/contact-consent/contacts/${contactRow.uuid}`);
    expect(view.body.privacy).toMatchObject({
      doNotSellShare: true,
      doNotSellShareSource: 'gpc',
      ccpaUs: true,
    });
  });

  it('a chat widget message with Sec-GPC: 1 opts the visitor contact out, once, when it has a phone or an email', async () => {
    const t = await widgets.signup('cpx-wgt');
    const assistant = await widgets.assistant(t);
    const w = await widgets.widget(t.admin, {
      name: 'GPC widget',
      mode: 'ai',
      assistantId: assistant.uuid,
      collectName: true,
      collectEmail: true,
      collectPhone: true,
    });
    const uuid = (await widgets.pub(w.embedToken).config()).body.visitor.uuid as string;
    const send = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
      widgets.pub(w.embedToken).message({ visitor_uuid: uuid, ...body }, headers);

    // Without the profile: nothing.
    const off = await send(
      { body: 'hi', name: 'Wes', email: 'wes@example.test' },
      { 'sec-gpc': '1' },
    );
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(await optOuts(t)).toHaveLength(0);

    await compliance(t, { regimes: ['ccpa_us'] });
    // No contact point yet for this visitor is fine here (an email was already given above), so a plain message records it.
    const on = await send({ body: 'again' }, { 'sec-gpc': '1' });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    const rows = await optOuts(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'gpc', value: true, email: 'wes@example.test' });
    expect(rows[0]!.evidence).toEqual({ widgetId: w.id });

    await send({ body: 'third' }, { 'sec-gpc': '1' });
    expect(await optOuts(t)).toHaveLength(1);
    expect(
      await q(`SELECT 1 FROM contact_consent_events WHERE org_id = $1`, [t.orgId]),
    ).toHaveLength(0);
  });
});
