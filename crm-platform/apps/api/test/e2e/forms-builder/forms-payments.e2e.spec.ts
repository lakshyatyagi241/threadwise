import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAIL_PORT,
  type MailPort,
} from '../../../src/infra/providers/auth-registration-security/mail.port';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
} from '../../../src/kernel/outbox/outbox-subscribers';
import { FormNotificationConsumer } from '../../../src/modules/forms-builder/form-notification.consumer';
import { FormPaymentSweepService } from '../../../src/modules/forms-builder/form-payment-sweep.service';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository';
import {
  FormsApi,
  contactDefinition,
  field,
  nextIp,
  startHarness,
  type CreatedForm,
  type Harness,
  type Tenant,
} from './support';

// The shared gateway talks to fixtures, never the network (the same switch the store and invoice specs use).
process.env.STORE_PROVIDER_MODE = 'fixture';

/**
 * Payment on a form against a real Postgres, Redis and the real app (docs/specs/forms-builder-app.md section 10): the publish check, the
 * server-computed amount, the pending attempt and hosted link, a verified gateway notification settling it once, the guards (wrong amount,
 * wrong signature, replay, double payment), staff actions, expiry, and the notification to the people the form lists.
 */
let h: Harness;
let api: FormsApi;
let t: Tenant;
let gatewayUuid = '';
const SECRET = 'whsec_forms';

beforeAll(async () => {
  h = await startHarness();
  api = new FormsApi(h);
  t = await api.workspace('pay');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const fresh = (() => {
  let n = 0;
  return () => `pay${Date.now().toString(36)}${n++}@example.test`;
})();

const sign = (raw: string) => {
  const ts = Math.floor(Date.now() / 1000);
  return `t=${ts},v1=${createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex')}`;
};
const stripePaid = (reference: string, amount: number, currency = 'inr', id = 'cs_1') =>
  JSON.stringify({
    id: `evt_${reference}_${amount}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id,
        client_reference_id: reference,
        payment_status: 'paid',
        payment_intent: `pi_${id}`,
        amount_total: amount,
        currency,
      },
    },
  });
const hook = (raw: string, signature = sign(raw)) =>
  api
    .http()
    .post(`/v2/store-public/webhooks/gateway/${gatewayUuid}`)
    .set('x-forwarded-for', nextIp())
    .set('content-type', 'application/json')
    .set('stripe-signature', signature)
    .send(raw);

const payment = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  amountType: 'fixed',
  amountMinor: 50_000,
  currency: 'INR',
  ...over,
});
const paidForm = (over: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) =>
  api.liveForm(t.admin, {
    definition: contactDefinition({ payment: payment(over) }),
    ...(Object.keys(settings).length > 0 ? { settings } : {}),
  });
const attempts = (formUuid: string) =>
  api.rows(
    t.orgId,
    `SELECT p.* FROM web_form_payments p JOIN web_form_submissions s ON s.org_id = p.org_id AND s.id = p.submission_id
     JOIN web_forms f ON f.org_id = s.org_id AND f.id = s.form_id WHERE p.org_id = $1 AND f.uuid = $2::uuid ORDER BY p.id`,
    [formUuid],
  );
const submitPaid = async (form: CreatedForm, answers: Record<string, unknown> = {}) => {
  const res = await api.submit(form.publicKey, {
    answers: { name: 'Ada Lovelace', email: fresh(), ...answers },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { submissionToken: string; next: { type: string; url?: string } };
};

describe('turning payment on', () => {
  it('refuses to publish a paid form while the workspace has no gateway that can make a link', async () => {
    const draft = await api.createForm(t.admin, {
      definition: contactDefinition({ payment: payment() }),
    });
    const res = await api
      .as(t.admin)
      .post(`/v2/forms/${draft.id}/publish`)
      .send({ rowVersion: draft.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(JSON.stringify(res.body)).toContain('payment_no_gateway');
    const meta = await api.as(t.admin).get('/v2/forms/meta/payment-gateway');
    expect(meta.body).toMatchObject({ ready: false, reason: 'none_connected' });
  });

  it('the definition refuses a payment block that cannot work', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/forms')
      .send({
        name: 'Bad payment',
        definition: contactDefinition({ payment: { enabled: true } }),
      });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('payment_amount_required');
  });

  it('connects a gateway and then publishes', async () => {
    const saved = await api
      .as(t.admin)
      .put('/v2/store/gateways/stripe')
      .send({ credentials: { secret_key: 'sk_test_1', webhook_secret: SECRET } });
    expect(saved.status, JSON.stringify(saved.body)).toBeLessThan(300);
    gatewayUuid = saved.body.id as string;
    const meta = await api.as(t.admin).get('/v2/forms/meta/payment-gateway');
    expect(meta.body).toMatchObject({ ready: true, slug: 'stripe' });
    const form = await paidForm();
    expect(form.status).toBe('published');
  });
});

describe('a visitor pays', () => {
  it('stores the answers, opens a pending attempt of the server-computed amount and sends the visitor to the hosted link', async () => {
    const form = await paidForm();
    const email = fresh();
    const body = await submitPaid(form, { email, amount: 1, amountMinor: 1 });
    expect(body.next).toEqual({ type: 'pay', url: 'https://stripe.fixture.test/pay/cs_fixture' });

    const subs = await api.submissions(t.orgId, form.id);
    expect(subs[0]).toMatchObject({ status: 'awaiting_payment' });
    const [a] = await attempts(form.id);
    expect(a).toMatchObject({
      status: 'pending',
      gateway_slug: 'stripe',
      currency: 'INR',
      link_url: 'https://stripe.fixture.test/pay/cs_fixture',
    });
    expect(Number(a!.amount_minor)).toBe(50_000);
    expect(String(a!.reference)).toMatch(/^FRM-[0-9a-f-]{36}$/);
    expect(await api.contactByEmail(t.orgId, email)).toBeTruthy();
    expect(await api.eventsOfType(t.orgId, 'form.payment_pending')).not.toHaveLength(0);
  });

  it('the same page load again gets the same open link and no second attempt', async () => {
    const form = await paidForm();
    const key = 'repeat-pay-0001';
    const answers = { name: 'Rae', email: fresh() };
    const first = await api.submit(form.publicKey, { idempotencyKey: key, answers });
    const again = await api.submit(form.publicKey, { idempotencyKey: key, answers });
    expect(again.body.next).toEqual(first.body.next);
    expect(await attempts(form.id)).toHaveLength(1);
  });

  it('a verified notification of the right amount settles the attempt and the submission once, and a replay changes nothing', async () => {
    const form = await paidForm();
    const email = fresh();
    const out = await submitPaid(form, { email });
    const [a] = await attempts(form.id);
    const raw = stripePaid(a!.reference as string, 50_000);

    const done = await hook(raw);
    expect(done.body).toEqual({ ok: true, outcome: 'applied' });
    expect((await attempts(form.id))[0]).toMatchObject({ status: 'paid', settled_via: 'gateway' });
    expect((await api.submissions(t.orgId, form.id))[0]).toMatchObject({ status: 'paid' });
    expect((await hook(raw)).body.outcome).toBe('duplicate');
    expect(await api.eventsOfType(t.orgId, 'form.payment_succeeded')).not.toHaveLength(0);

    // What the visitor's return page reads: paid, with the form's thank-you.
    const status = await api
      .http()
      .get(`/v2/public/forms/${form.publicKey}/submissions/${out.submissionToken}`)
      .set('x-forwarded-for', nextIp());
    expect(status.status).toBe(200);
    expect(status.body.payment).toBe('paid');
    expect(status.body.next.type).toBe('message');
  });

  it('refuses a wrong signature, a wrong amount and a notification for another workspace attempt', async () => {
    const form = await paidForm();
    await submitPaid(form);
    const [a] = await attempts(form.id);
    const raw = stripePaid(a!.reference as string, 50_000);
    expect((await hook(raw, 'bad')).status).toBe(400);
    expect((await hook(stripePaid(a!.reference as string, 100))).body.outcome).toBe(
      'rejected:amount_mismatch',
    );
    expect(
      (await hook(stripePaid('FRM-123e4567-e89b-42d3-a456-426614174000', 50_000))).body.outcome,
    ).toBe('rejected:attempt_unknown');
    expect((await attempts(form.id))[0]).toMatchObject({ status: 'pending' });
    expect((await api.submissions(t.orgId, form.id))[0]).toMatchObject({
      status: 'awaiting_payment',
    });
    expect(await api.eventsOfType(t.orgId, 'form.payment_rejected')).not.toHaveLength(0);
  });

  it('the redirect back is not proof: the status stays awaiting until the notification', async () => {
    const form = await paidForm();
    const out = await submitPaid(form);
    const status = await api
      .http()
      .get(`/v2/public/forms/${form.publicKey}/submissions/${out.submissionToken}`)
      .set('x-forwarded-for', nextIp());
    expect(status.body).toMatchObject({ payment: 'awaiting_payment', next: null });
    const wrong = await api
      .http()
      .get(`/v2/public/forms/${form.publicKey}/submissions/${'x'.repeat(40)}`)
      .set('x-forwarded-for', nextIp());
    expect(wrong.status).toBe(404);
  });
});

describe('amount types', () => {
  it('from a choice field: the chosen option sets the price; an unknown option is refused', async () => {
    const plan = field('plan', 'dropdown', {
      required: true,
      options: [
        { value: 'basic', label: 'Basic', amountMinor: 50_000 },
        { value: 'pro', label: 'Pro', amountMinor: 90_000 },
      ],
    });
    const def = contactDefinition({
      payment: payment({ amountType: 'from_field', fieldId: 'plan' }),
    });
    def.steps[0]!.blocks.push(plan);
    const form = await api.liveForm(t.admin, { definition: def });
    await submitPaid(form, { plan: 'pro' });
    expect(Number((await attempts(form.id))[0]!.amount_minor)).toBe(90_000);
    const bad = await api.submit(form.publicKey, {
      answers: { name: 'Z', email: fresh(), plan: 'nope' },
    });
    expect(bad.status).toBe(422);
    expect(await attempts(form.id)).toHaveLength(1);
  });

  it('pay what you want: inside the limits only', async () => {
    const gift = field('gift', 'currency', { required: true });
    const def = contactDefinition({
      payment: payment({
        amountType: 'pay_what_you_want',
        fieldId: 'gift',
        minMinor: 10_000,
        maxMinor: 100_000,
      }),
    });
    def.steps[0]!.blocks.push(gift);
    const form = await api.liveForm(t.admin, { definition: def });
    await submitPaid(form, { gift: 250.5 });
    expect(Number((await attempts(form.id))[0]!.amount_minor)).toBe(25_050);
    for (const bad of [5, 5000]) {
      const res = await api.submit(form.publicKey, {
        answers: { name: 'Z', email: fresh(), gift: bad },
      });
      expect(res.status, String(bad)).toBe(422);
    }
  });
});

describe('staff', () => {
  const staffSubmission = async (form: CreatedForm) => {
    await submitPaid(form);
    const list = await api.as(t.admin).get(`/v2/forms/${form.id}/submissions`);
    return list.body.data[0] as { id: string };
  };

  it('gets a fresh link (the old attempt expires) and sees the attempts in the submission', async () => {
    const form = await paidForm();
    const sub = await staffSubmission(form);
    const res = await api
      .as(t.admin)
      .post(`/v2/forms/${form.id}/submissions/${sub.id}/payment-link`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.url).toBe('https://stripe.fixture.test/pay/cs_fixture');
    const rows = await attempts(form.id);
    expect(rows.map((r) => r.status).sort()).toEqual(['expired', 'pending']);
    const detail = await api.as(t.admin).get(`/v2/forms/${form.id}/submissions/${sub.id}`);
    expect(detail.body.payments).toHaveLength(2);
  });

  it('marks a submission paid by hand once, audited, and refuses it again', async () => {
    const form = await paidForm();
    const sub = await staffSubmission(form);
    const res = await api
      .as(t.admin)
      .post(`/v2/forms/${form.id}/submissions/${sub.id}/mark-paid`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('paid');
    expect((await attempts(form.id))[0]).toMatchObject({ status: 'paid', settled_via: 'manual' });
    const again = await api
      .as(t.admin)
      .post(`/v2/forms/${form.id}/submissions/${sub.id}/mark-paid`)
      .send({});
    expect(again.status).toBe(409);
    expect(await api.auditCount(t.orgId, 'web_form_payments', 'update')).toBeGreaterThan(0);
  });

  it('needs the update permission', async () => {
    const form = await paidForm();
    const sub = await staffSubmission(form);
    const reader = await api.member(t, 'pay-reader', [['record.form-submissions.read']]);
    const res = await api
      .as(reader.token)
      .post(`/v2/forms/${form.id}/submissions/${sub.id}/mark-paid`)
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('a second payment, and expiry', () => {
  it('records a second paid attempt, flags the submission and does not take the first away', async () => {
    const form = await paidForm();
    await submitPaid(form);
    const list = await api.as(t.admin).get(`/v2/forms/${form.id}/submissions`);
    const sid = list.body.data[0].id as string;
    const [first] = await attempts(form.id);
    await hook(stripePaid(first!.reference as string, 50_000, 'inr', 'cs_a'));
    // Staff opens another attempt after the first paid is impossible; the visitor paying an older link is what happens, so open one directly.
    await h.owner.query(
      `INSERT INTO web_form_payments (org_id, uuid, submission_id, reference, gateway_slug, amount_minor, currency, expires_at)
       VALUES ($1, '123e4567-e89b-42d3-a456-426614174111', $2, 'FRM-123e4567-e89b-42d3-a456-426614174111', 'stripe', 50000, 'INR', now() + interval '1 day')`,
      [t.orgId, first!.submission_id],
    );
    const dup = await hook(
      stripePaid('FRM-123e4567-e89b-42d3-a456-426614174111', 50_000, 'inr', 'cs_b'),
    );
    expect(dup.body.outcome).toBe('applied');
    expect((await attempts(form.id)).filter((r) => r.status === 'paid')).toHaveLength(2);
    const detail = await api.as(t.admin).get(`/v2/forms/${form.id}/submissions/${sid}`);
    expect(detail.body).toMatchObject({ status: 'paid', duplicatePayment: true });
    expect(await api.eventsOfType(t.orgId, 'form.payment_duplicate')).not.toHaveLength(0);
  });

  it('the sweep expires lapsed attempts and leaves the submission awaiting payment', async () => {
    const form = await paidForm();
    await submitPaid(form);
    await h.owner.query(
      `UPDATE web_form_payments SET expires_at = now() - interval '1 hour' WHERE org_id = $1 AND status = 'pending'`,
      [t.orgId],
    );
    const sweep = new FormPaymentSweepService(
      h.app.get(DatabaseService),
      h.app.get(
        (await import('../../../src/modules/forms-builder/form-payments.repository'))
          .FormPaymentsRepository,
      ),
    );
    expect(await sweep.run()).toBeGreaterThan(0);
    expect((await attempts(form.id))[0]).toMatchObject({ status: 'expired' });
    expect((await api.submissions(t.orgId, form.id))[0]).toMatchObject({
      status: 'awaiting_payment',
    });
  });

  it('a disconnected gateway closes the form: 422 and nothing stored', async () => {
    const w = await api.workspace('paygone');
    await api
      .as(w.admin)
      .put('/v2/store/gateways/stripe')
      .send({
        credentials: { secret_key: 'sk_test_2', webhook_secret: 'x' },
      });
    const form = await api.liveForm(w.admin, {
      definition: contactDefinition({ payment: payment() }),
    });
    await api.as(w.admin).delete('/v2/store/gateways/stripe');
    const res = await api.submit(form.publicKey, { answers: { name: 'A', email: fresh() } });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('FORMS_PAYMENT_UNAVAILABLE');
    expect(await api.submissions(w.orgId, form.id)).toHaveLength(0);
  });
});

describe('notifications', () => {
  it('tells the owner and listed users once per payment and emails the listed addresses; a double payment is its own note', async () => {
    const registry = new OutboxSubscriberRegistry();
    const consumer = new FormNotificationConsumer(
      h.app.get(DatabaseService),
      new NotificationsRepository(),
      registry,
      h.redis,
      h.app.get(ConfigService),
      h.app.get<MailPort>(MAIL_PORT, { strict: false }),
    );
    consumer.onModuleInit();
    const watcher = await api.member(t, 'pay-watcher', [['record.contacts.read']]);
    const form = await paidForm(
      {},
      {
        notify: {
          owner: false,
          userIds: [await api.userUuid(watcher.userId)],
          emails: ['finance@example.com'],
        },
      },
    );
    await submitPaid(form, { name: 'Grace Hopper' });
    const [a] = await attempts(form.id);
    await hook(stripePaid(a!.reference as string, 50_000, 'inr', 'cs_n'));

    const deliver = async () => {
      const res = await h.owner.query(
        `SELECT id, org_id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
         WHERE org_id = $1 AND event_type IN ('form.payment_succeeded', 'form.payment_duplicate') ORDER BY id`,
        [t.orgId],
      );
      for (const r of res.rows) {
        const event: OutboxEvent = {
          id: String(r.id),
          orgId: Number(r.org_id),
          aggregateModule: r.aggregate_module,
          aggregateId: String(r.aggregate_id),
          eventType: r.event_type,
          payload: r.payload,
        };
        await registry.dispatch(event);
      }
    };
    await deliver();
    await deliver(); // redelivery: nothing doubles
    const notes = await api.rows(
      t.orgId,
      `SELECT * FROM inbox_notifications WHERE org_id = $1 AND user_id = $2 AND type = 'form_payment' ORDER BY id`,
      [watcher.userId],
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe('Payment received on a form');
    expect(String(notes[0]!.body)).toContain('Grace Hopper');
    expect(String(notes[0]!.body)).toContain('500.00 INR');
    const mails = h.mail.filter(
      (m) => m.to === 'finance@example.com' && /Payment received/.test(m.subject),
    );
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).not.toContain('@');
  });
});
