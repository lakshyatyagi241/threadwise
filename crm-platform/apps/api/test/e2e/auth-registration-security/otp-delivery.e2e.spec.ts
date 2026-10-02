import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PlatformSettingsService } from '../../../src/modules/auth/platform/platform-settings.service';
import { ConfiguredOtpSender } from '../../../src/modules/auth/platform/configured-otp-sender';
import { OtpTemplateRefreshService } from '../../../src/modules/auth/maintenance/otp-template-refresh.service';
import { OtpTemplateService } from '../../../src/modules/auth/platform/otp-template.service';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD, startHarness, type Harness } from './harness';
import {
  BRIDGE_SENDER,
  BRIDGE_TOKEN,
  GRAPH_PHONE_NUMBER_ID,
  GRAPH_TOKEN,
  GRAPH_WABA_ID,
  TWILIO_FROM,
  TWILIO_SID,
  TWILIO_TOKEN,
} from './stubs';

/**
 * Sign-up code delivery end to end (TW-AUTH-006 sender side, TW-AUTH-007): the
 * REAL composite sender and adapters talk over real sockets to local stand-ins
 * for Meta's Graph API, Twilio and the Node bridge. No real provider is involved.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const PASSWORD = 'Str0ngPassw0rd#1';
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

let opAccess = '';
let supportAccess = '';
/** Everything the API said, to prove no secret or code ever travelled back. */
const seen: string[] = [];

async function call(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  body?: unknown,
  token = opAccess,
) {
  const req = api()[method](`/v2/platform/settings${path}`).set(bearer(token));
  const res = body === undefined ? await req : await req.send(body as object);
  seen.push(JSON.stringify(res.body));
  return res;
}

let n = 0;
const nextIp = () => `10.77.${Math.floor(n / 250)}.${n++ % 250}`;
const nextPhone = () => `+9199${String(100000 + n++).padStart(8, '0')}`;
const nextEmail = () => `otp${Date.now()}${n++}@example.test`;

async function signup(phone = nextPhone()) {
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', nextIp())
    .send({
      orgName: `Otp Org ${n}`,
      fullName: 'Otp Person',
      email: nextEmail(),
      password: PASSWORD,
      acceptTerms: true,
      phone,
    });
  seen.push(JSON.stringify(res.body));
  return { res, phone };
}

const graphSender = (over: Record<string, unknown> = {}) => ({
  kind: 'waba',
  label: 'Meta number',
  phoneNumberId: GRAPH_PHONE_NUMBER_ID,
  wabaId: GRAPH_WABA_ID,
  graphBaseUrl: `${h.stubs.graph.url}/v21.0`,
  secret: GRAPH_TOKEN,
  ...over,
});
const twilioSender = (over: Record<string, unknown> = {}) => ({
  kind: 'twilio',
  label: 'Twilio number',
  accountSid: TWILIO_SID,
  fromNumber: TWILIO_FROM,
  apiBaseUrl: h.stubs.twilio.url,
  secret: TWILIO_TOKEN,
  ...over,
});
const bridgeSender = (over: Record<string, unknown> = {}) => ({
  kind: 'device',
  label: 'Bridge session',
  bridgeUrl: h.stubs.bridge.url,
  senderNumber: BRIDGE_SENDER,
  secret: BRIDGE_TOKEN,
  ...over,
});

async function addSender(body: Record<string, unknown>): Promise<string> {
  const res = await call('post', '/senders', body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return `${res.body.kind}:${res.body.id}`;
}

const useSender = (sender: string | null, otp: Record<string, unknown> = {}) =>
  call('patch', '/registration', {
    otp: { enabled: true, sender, ttlMinutes: 5, length: 6, resendCooldownSec: 15, ...otp },
  });

async function clearAll() {
  const list = await call('get', '/senders');
  for (const s of list.body.senders) await call('delete', `/senders/${s.id}`);
  // Back to the defaults (no saved template, no sender, OTP off) so scenarios do not leak into each other.
  await h.owner.query(`DELETE FROM platform_settings WHERE key = 'registration'`);
  h.app.get(PlatformSettingsService).invalidate();
  await h.redis.eval(
    `for _,k in ipairs(redis.call('keys','auth:otp-test:*')) do redis.call('del',k) end`,
    0,
  );
  h.stubs.graph.reset();
  h.stubs.twilio.reset();
  h.stubs.bridge.reset();
}

const publicOtp = async () =>
  (await api().get('/v2/auth/registration-config')).body.otp.enabled as boolean;

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  opAccess = token;
  const support = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportAccess = support.body.tokens.accessToken as string;
}, 240_000);

afterEach(async () => {
  await clearAll();
});

afterAll(async () => {
  await h?.stop();
});

describe('OTP sender registry', () => {
  it('starts empty, and offers the dev sender outside production', async () => {
    const res = await call('get', '/senders');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ senders: [], devAllowed: true });
  });

  it('adds senders of every kind, reporting hasSecret and never the secret', async () => {
    const waba = await call('post', '/senders', graphSender());
    const twilio = await call('post', '/senders', twilioSender());
    const device = await call('post', '/senders', bridgeSender());
    const dev = await call('post', '/senders', { kind: 'dev', label: 'Log it' });
    for (const r of [waba, twilio, device, dev]) expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(waba.body).toMatchObject({
      kind: 'waba',
      phoneNumberId: GRAPH_PHONE_NUMBER_ID,
      wabaId: GRAPH_WABA_ID,
      hasSecret: true,
    });
    expect(twilio.body).toMatchObject({ kind: 'twilio', fromNumber: TWILIO_FROM, hasSecret: true });
    expect(device.body).toMatchObject({
      kind: 'device',
      senderNumber: BRIDGE_SENDER,
      hasSecret: true,
    });
    expect(dev.body).toMatchObject({ kind: 'dev', hasSecret: false });
    expect(waba.body.id).toMatch(/^[a-z0-9]{8}$/);

    const list = await call('get', '/senders');
    expect(list.body.senders).toHaveLength(4);
    const text = JSON.stringify(list.body);
    for (const secret of [GRAPH_TOKEN, TWILIO_TOKEN, BRIDGE_TOKEN])
      expect(text).not.toContain(secret);
    expect(text).not.toContain('"secret"');
  });

  it('defaults the Graph and Twilio addresses', async () => {
    const waba = await call('post', '/senders', { ...graphSender(), graphBaseUrl: undefined });
    expect(waba.body.graphBaseUrl).toBe('https://graph.facebook.com/v23.0');
    const twilio = await call('post', '/senders', { ...twilioSender(), apiBaseUrl: undefined });
    expect(twilio.body.apiBaseUrl).toBe('https://api.twilio.com');
  });

  it('validates each kind with field-level errors', async () => {
    const badUrl = await call(
      'post',
      '/senders',
      bridgeSender({ bridgeUrl: 'http://169.254.169.254/x' }),
    );
    expect(badUrl.status).toBe(422);
    expect(badUrl.body.errors[0].path).toBe('bridgeUrl');
    const badSid = await call('post', '/senders', twilioSender({ accountSid: 'nope' }));
    expect(badSid.status).toBe(422);
    expect(badSid.body.errors.map((e: { path: string }) => e.path)).toContain('accountSid');
    const noSecret = await call('post', '/senders', { ...graphSender(), secret: undefined });
    expect(noSecret.status).toBe(422);
    const badNumber = await call('post', '/senders', twilioSender({ fromNumber: '123' }));
    expect(badNumber.status).toBe(422);
    expect((await call('get', '/senders')).body.senders).toEqual([]);
  });

  it('edits a sender: a blank secret keeps the stored one, a new one replaces it, clearSecret removes it', async () => {
    const ref = await addSender(bridgeSender());
    const id = ref.split(':')[1];
    const blank = await call('patch', `/senders/${id}`, { label: 'Renamed', secret: '' });
    expect(blank.status).toBe(200);
    expect(blank.body).toMatchObject({ label: 'Renamed', hasSecret: true });
    // the stored secret still works: a test send reaches the bridge with the right token
    await useSender(ref);
    const ok = await call('post', '/registration/otp-test', { to: '+919876500001' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);

    const wrong = await call('patch', `/senders/${id}`, { secret: 'not-the-bridge-token' });
    expect(wrong.body.hasSecret).toBe(true);
    const failed = await call('post', '/registration/otp-test', { to: '+919876500001' });
    expect(failed.status).toBe(502);
    expect(failed.body.code).toBe('AUTH_OTP_SEND_FAILED');

    const cleared = await call('patch', `/senders/${id}`, { clearSecret: true });
    expect(cleared.body.hasSecret).toBe(false);
    const incomplete = await call('post', '/registration/otp-test', { to: '+919876500001' });
    expect(incomplete.status).toBe(422);
  });

  it("refuses a field that does not belong to the sender's kind, and an unknown sender", async () => {
    const ref = await addSender(bridgeSender());
    const wrongField = await call('patch', `/senders/${ref.split(':')[1]}`, { wabaId: '12345' });
    expect(wrongField.status).toBe(422);
    const missing = await call('patch', '/senders/deadbeef', { label: 'x' });
    expect(missing.status).toBe(404);
    expect((await call('delete', '/senders/deadbeef')).status).toBe(404);
  });

  it('lets support and auditors read senders but not change anything', async () => {
    const ref = await addSender(bridgeSender());
    expect((await call('get', '/senders', undefined, supportAccess)).status).toBe(200);
    for (const [method, path, body] of [
      ['post', '/senders', bridgeSender()],
      ['patch', `/senders/${ref.split(':')[1]}`, { label: 'x' }],
      ['delete', `/senders/${ref.split(':')[1]}`, undefined],
      ['post', '/registration/otp-template', { otp: {} }],
      ['post', '/registration/otp-template/refresh', undefined],
      ['post', '/registration/otp-test', { to: '+919876500001' }],
    ] as const) {
      const res = await call(method, path, body, supportAccess);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect((await call('get', '/senders')).body.senders).toHaveLength(1);
  });

  it('removes a sender with its secret; removing the selected one clears the selection', async () => {
    const ref = await addSender(twilioSender());
    await useSender(ref);
    expect((await call('post', '/registration/otp-template', { otp: {} })).status).toBe(201);
    const del = await call('delete', `/senders/${ref.split(':')[1]}`);
    expect(del.body).toEqual({ ok: true, selectionCleared: true });
    const reg = await call('get', '/registration');
    expect(reg.body.otp.sender).toBeNull();
    expect(reg.body.otp.template).toBeNull();
    expect(reg.body.otpStatus).toEqual({ active: false, reason: 'no_sender' });
    const secrets = await h.owner.query(
      `SELECT key FROM platform_settings WHERE key LIKE 'otp.sender.%'`,
    );
    expect(secrets.rowCount).toBe(0);

    const other = await addSender(bridgeSender());
    const del2 = await call('delete', `/senders/${other.split(':')[1]}`);
    expect(del2.body.selectionCleared).toBe(false);
  });

  it('only accepts a registered sender in the registration settings', async () => {
    const res = await call('patch', '/registration', { otp: { sender: 'device:zzzzzzzz' } });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].path).toBe('otp.sender');
    const malformed = await call('patch', '/registration', { otp: { sender: 'whatsapp:1' } });
    expect(malformed.status).toBe(422);
  });
});

describe('sign-up with the code delivered through each sender kind', () => {
  it('Node bridge: posts to /api/send-message/<number> with X-Node-Token, then verifies', async () => {
    const ref = await addSender(bridgeSender());
    expect((await useSender(ref)).status).toBe(200);
    expect(await publicOtp()).toBe(true);

    const { res, phone } = await signup();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('otp_required');
    const sent = h.stubs.bridge.requests.at(-1)!;
    expect(sent.path).toBe(`/api/send-message/${BRIDGE_SENDER}`);
    expect(sent.headers['x-node-token']).toBe(BRIDGE_TOKEN);
    const body = sent.body as { targetPhoneNumber: string; message: string };
    expect(body.targetPhoneNumber).toBe(phone.replace('+', ''));
    expect(body.message).toContain(h.otps.at(-1)!.code);
    expect(body.message.toLowerCase()).toContain('do not share');

    const ok = await api()
      .post('/v2/auth/signup/verify-otp')
      .send({ challengeId: res.body.challengeId, code: h.otps.at(-1)!.code });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.status).toBe('authenticated');
  });

  it('Twilio: posts a WhatsApp message with Basic auth, From and To as whatsapp: addresses', async () => {
    const ref = await addSender(twilioSender());
    await useSender(ref);
    const { res, phone } = await signup();
    expect(res.body.status).toBe('otp_required');
    const sent = h.stubs.twilio.requests.at(-1)!;
    expect(sent.path).toBe(`/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`);
    expect(sent.headers.authorization).toBe(
      `Basic ${Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64')}`,
    );
    const form = sent.body as { From: string; To: string; Body: string };
    expect(form.From).toBe(`whatsapp:${TWILIO_FROM}`);
    expect(form.To).toBe(`whatsapp:${phone}`);
    expect(form.Body).toContain(h.otps.at(-1)!.code);

    const ok = await api()
      .post('/v2/auth/signup/verify-otp')
      .send({ challengeId: res.body.challengeId, code: h.otps.at(-1)!.code });
    expect(ok.body.status).toBe('authenticated');
  });

  it('Meta Cloud API: sends the approved template once Meta has approved it', async () => {
    const ref = await addSender(graphSender());
    const created = await call('post', '/registration/otp-template', {
      otp: { sender: ref, enabled: true, ttlMinutes: 5, length: 6, resendCooldownSec: 15 },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    h.stubs.graph.templateStatus = 'APPROVED';
    expect(
      (await call('post', '/registration/otp-template/refresh')).body.registration.otpStatus,
    ).toEqual({ active: true, reason: 'active' });

    const { res, phone } = await signup();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('otp_required');
    const sent = h.stubs.graph.requests.filter((r) => r.path.endsWith('/messages')).at(-1)!;
    expect(sent.path).toBe(`/v21.0/${GRAPH_PHONE_NUMBER_ID}/messages`);
    expect(sent.headers.authorization).toBe(`Bearer ${GRAPH_TOKEN}`);
    const body = sent.body as {
      to: string;
      type: string;
      template: { name: string; language: { code: string } };
    };
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      to: phone.replace('+', ''),
      type: 'template',
      template: { name: 'crm_signup_otp', language: { code: 'en_US' } },
    });

    const ok = await api()
      .post('/v2/auth/signup/verify-otp')
      .send({ challengeId: res.body.challengeId, code: h.otps.at(-1)!.code });
    expect(ok.body.status).toBe('authenticated');
  });

  it('dev sender: the code step runs and no provider is called', async () => {
    const ref = await addSender({ kind: 'dev', label: 'Log' });
    await useSender(ref);
    expect(await publicOtp()).toBe(true);
    const { res } = await signup();
    expect(res.body.status).toBe('otp_required');
    expect(h.otps).toHaveLength(0);
  });
});

describe('a sender that cannot deliver', () => {
  it('answers AUTH_OTP_SEND_FAILED and creates nothing when the provider refuses the credentials', async () => {
    const ref = await addSender(bridgeSender({ secret: 'wrong-bridge-token' }));
    await useSender(ref);
    const { res } = await signup();
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('AUTH_OTP_SEND_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('wrong-bridge-token');
    const count = async () =>
      Number((await h.owner.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n);
    const before = await count();
    const again = await signup();
    expect(again.res.status).toBe(502);
    expect(await count()).toBe(before);
  });

  it('answers AUTH_OTP_SEND_FAILED when the provider is unreachable', async () => {
    const ref = await addSender(bridgeSender({ bridgeUrl: 'http://127.0.0.1:1' }));
    await useSender(ref);
    const { res } = await signup();
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('AUTH_OTP_SEND_FAILED');
  });

  it('gives up after the timeout instead of hanging the sign-up', async () => {
    const ref = await addSender(bridgeSender());
    await useSender(ref);
    const sender = h.app.get(ConfiguredOtpSender);
    sender.transport = { timeoutMs: 250 };
    h.stubs.bridge.delayMs = 1500;
    try {
      const started = Date.now();
      const { res } = await signup();
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('AUTH_OTP_SEND_FAILED');
      expect(Date.now() - started).toBeLessThan(1400);
    } finally {
      sender.transport = {};
    }
  });

  it('keeps the staged sign-up when a resend fails, so the first code still works', async () => {
    const ref = await addSender(bridgeSender());
    const id = ref.split(':')[1];
    await useSender(ref, { resendCooldownSec: 15 });
    const { res } = await signup();
    expect(res.body.status).toBe('otp_required');
    const firstCode = h.otps.at(-1)!.code;

    await call('patch', `/senders/${id}`, { secret: 'now-broken' });
    // wait out the resend cooldown by moving the staged timestamp back
    const key = `auth:signup:${res.body.challengeId}`;
    const staged = JSON.parse((await h.redis.get(key))!);
    staged.lastSentAt -= 60_000;
    await h.redis.setex(key, 1800, JSON.stringify(staged));

    const resend = await api()
      .post('/v2/auth/signup/resend-otp')
      .send({ challengeId: res.body.challengeId });
    expect(resend.status).toBe(502);
    expect(resend.body.code).toBe('AUTH_OTP_SEND_FAILED');

    const ok = await api()
      .post('/v2/auth/signup/verify-otp')
      .send({ challengeId: res.body.challengeId, code: firstCode });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.status).toBe('authenticated');
  });
});

describe('the activation rule', () => {
  it('skips the code silently while a WhatsApp Business template is not approved', async () => {
    const ref = await addSender(graphSender());
    expect((await useSender(ref)).body.otpStatus).toEqual({
      active: false,
      reason: 'template_missing',
    });
    expect(await publicOtp()).toBe(false);
    const { res } = await signup();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('authenticated');
    expect(h.stubs.graph.requests).toHaveLength(0);
  });

  it('is off when the switch is off, whatever the sender', async () => {
    const ref = await addSender(bridgeSender());
    const res = await useSender(ref, { enabled: false });
    expect(res.body.otpStatus).toEqual({ active: false, reason: 'disabled' });
    expect(await publicOtp()).toBe(false);
  });

  it('is off while the sender is missing its secret', async () => {
    const ref = await addSender(bridgeSender());
    await useSender(ref);
    expect(await publicOtp()).toBe(true);
    await call('patch', `/senders/${ref.split(':')[1]}`, { clearSecret: true });
    expect((await call('get', '/registration')).body.otpStatus.reason).toBe('sender_incomplete');
    expect(await publicOtp()).toBe(false);
  });
});

describe('create & submit template', () => {
  it('asks for a sender first and saves nothing', async () => {
    await addSender(bridgeSender());
    const before = (await call('get', '/registration')).body;
    const res = await call('post', '/registration/otp-template', {
      otp: { enabled: true, ttlMinutes: 30 },
    });
    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({ path: 'otp.sender' });
    expect(JSON.stringify(res.body)).toContain('Pick a sender channel first');
    const after = (await call('get', '/registration')).body;
    expect(after.otp).toEqual(before.otp);
  });

  it('WhatsApp Business: saves the knobs, submits an AUTHENTICATION template to Meta and waits for approval', async () => {
    const ref = await addSender(graphSender());
    const res = await call('post', '/registration/otp-template', {
      otp: {
        sender: ref,
        enabled: true,
        ttlMinutes: 7,
        length: 5,
        resendCooldownSec: 30,
        maxAttempts: 4,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.outcome).toBe('submitted');
    const { otp, otpStatus } = res.body.registration;
    expect(otp).toMatchObject({
      enabled: true,
      sender: ref,
      ttlMinutes: 7,
      length: 5,
      resendCooldownSec: 30,
      maxAttempts: 4,
    });
    expect(otp.template).toMatchObject({
      name: 'crm_signup_otp',
      kind: 'waba',
      sender: ref,
      language: 'en_US',
      metaTemplateId: 'tpl_90001',
      status: 'pending',
      codeExpirationMinutes: 7,
    });
    expect(otp.template.submittedAt).toBeTruthy();
    expect(otpStatus).toEqual({ active: false, reason: 'template_pending' });
    expect(await publicOtp()).toBe(false);

    const submit = h.stubs.graph.requests.find((r) => r.path.endsWith('/message_templates'))!;
    expect(submit.path).toBe(`/v21.0/${GRAPH_WABA_ID}/message_templates`);
    expect(submit.headers.authorization).toBe(`Bearer ${GRAPH_TOKEN}`);
    expect(submit.body).toEqual({
      name: 'crm_signup_otp',
      language: 'en_US',
      category: 'AUTHENTICATION',
      components: [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: 7 },
        { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
      ],
    });

    // Pressing the button again while Meta is still reviewing does not submit a duplicate.
    const again = await call('post', '/registration/otp-template', { otp: { sender: ref } });
    expect(again.body.outcome).toBe('already_pending');
    expect(
      h.stubs.graph.requests.filter((r) => r.path.endsWith('/message_templates')),
    ).toHaveLength(1);
  });

  it('refresh: pending until Meta approves, then the code step switches on by itself', async () => {
    const ref = await addSender(graphSender());
    await call('post', '/registration/otp-template', { otp: { sender: ref, enabled: true } });
    expect(await publicOtp()).toBe(false);

    const stillPending = await call('post', '/registration/otp-template/refresh');
    expect(stillPending.status).toBe(201);
    expect(stillPending.body.outcome).toBe('refreshed');
    expect(stillPending.body.registration.otp.template.status).toBe('pending');
    expect(stillPending.body.registration.otp.template.checkedAt).toBeTruthy();
    const poll = h.stubs.graph.requests.filter((r) => r.method === 'GET').at(-1)!;
    expect(poll.path).toBe('/v21.0/tpl_90001');
    expect(poll.headers.authorization).toBe(`Bearer ${GRAPH_TOKEN}`);

    h.stubs.graph.templateStatus = 'APPROVED';
    const approved = await call('post', '/registration/otp-template/refresh');
    expect(approved.body.registration.otp.template.status).toBe('approved');
    expect(approved.body.registration.otpStatus).toEqual({ active: true, reason: 'active' });
    expect(await publicOtp()).toBe(true);
  });

  it('refresh: a rejection keeps the code step off and says why', async () => {
    const ref = await addSender(graphSender());
    await call('post', '/registration/otp-template', { otp: { sender: ref, enabled: true } });
    h.stubs.graph.templateStatus = 'REJECTED';
    h.stubs.graph.templateRejectedReason = 'INCORRECT_CATEGORY';
    const res = await call('post', '/registration/otp-template/refresh');
    expect(res.body.registration.otp.template).toMatchObject({
      status: 'rejected',
      rejectedReason: 'INCORRECT_CATEGORY',
    });
    expect(res.body.registration.otpStatus).toEqual({ active: false, reason: 'template_rejected' });

    // Fix and resubmit: the existing Meta template is edited, not duplicated.
    const resubmit = await call('post', '/registration/otp-template', { otp: { sender: ref } });
    expect(resubmit.body.outcome).toBe('resubmitted');
    expect(resubmit.body.registration.otp.template).toMatchObject({
      status: 'pending',
      rejectedReason: null,
    });
    const edit = h.stubs.graph.requests.filter((r) => r.method === 'POST').at(-1)!;
    expect(edit.path).toBe('/v21.0/tpl_90001');
    expect(
      h.stubs.graph.requests.filter((r) => r.path.endsWith('/message_templates')),
    ).toHaveLength(1);
  });

  it('changing the validity of an approved template sends it back for review', async () => {
    const ref = await addSender(graphSender());
    await call('post', '/registration/otp-template', {
      otp: { sender: ref, enabled: true, ttlMinutes: 5 },
    });
    h.stubs.graph.templateStatus = 'APPROVED';
    await call('post', '/registration/otp-template/refresh');
    const same = await call('post', '/registration/otp-template', { otp: { sender: ref } });
    expect(same.body.outcome).toBe('already_approved');
    const changed = await call('post', '/registration/otp-template', {
      otp: { sender: ref, ttlMinutes: 12 },
    });
    expect(changed.body.outcome).toBe('resubmitted');
    expect(changed.body.registration.otp.template).toMatchObject({
      status: 'pending',
      codeExpirationMinutes: 12,
    });
    const edit = h.stubs.graph.requests.filter((r) => r.method === 'POST').at(-1)!;
    expect(JSON.stringify(edit.body)).toContain('"code_expiration_minutes":12');
  });

  it("turns Meta's refusal into a readable error, keeps the saved knobs, and never echoes the token", async () => {
    const ref = await addSender(graphSender({ secret: 'EAAG-wrong-token-999' }));
    const res = await call('post', '/registration/otp-template', {
      otp: { sender: ref, enabled: true, ttlMinutes: 20 },
    });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('AUTH_OTP_TEMPLATE_FAILED');
    expect(JSON.stringify(res.body)).toContain('Meta');
    expect(JSON.stringify(res.body)).not.toContain('EAAG-wrong-token-999');
    const reg = (await call('get', '/registration')).body;
    expect(reg.otp).toMatchObject({ sender: ref, ttlMinutes: 20, template: null });
  });

  it('reports an error when Meta answers without a template id', async () => {
    const ref = await addSender(graphSender());
    h.stubs.graph.createdTemplateId = '';
    const res = await call('post', '/registration/otp-template', { otp: { sender: ref } });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('AUTH_OTP_TEMPLATE_FAILED');
    expect(res.body.detail).toMatch(/no template id/i);
    expect((await call('get', '/registration')).body.otp.template).toBeNull();
  });

  it('Twilio and the bridge need no review: the template is created ready, and its text is what gets sent', async () => {
    const ref = await addSender(twilioSender());
    const res = await call('post', '/registration/otp-template', {
      otp: { sender: ref, enabled: true, ttlMinutes: 9 },
    });
    expect(res.body.outcome).toBe('local_ready');
    expect(res.body.registration.otp.template).toMatchObject({
      name: 'crm_signup_otp_local',
      kind: 'local',
      status: 'local',
      metaTemplateId: null,
      body: '{{1}} is your verification code. It expires in 9 minutes.',
    });
    expect(res.body.registration.otpStatus).toEqual({ active: true, reason: 'active' });
    expect(h.stubs.graph.requests).toHaveLength(0);

    const { res: signupRes } = await signup();
    expect(signupRes.body.status).toBe('otp_required');
    const code = h.otps.at(-1)!.code;
    const form = h.stubs.twilio.requests.at(-1)!.body as { Body: string };
    expect(form.Body).toBe(`${code} is your verification code. It expires in 9 minutes.`);
  });

  it('refuses an out-of-range knob and keeps the saved ones', async () => {
    const ref = await addSender(bridgeSender());
    await call('post', '/registration/otp-template', {
      otp: { sender: ref, ttlMinutes: 20, length: 8, resendCooldownSec: 120, maxAttempts: 9 },
    });
    const clamped = await call('post', '/registration/otp-template', { otp: { ttlMinutes: 0 } });
    expect(clamped.status).toBe(422);
    const reg = (await call('get', '/registration')).body;
    expect(reg.otp).toMatchObject({
      ttlMinutes: 20,
      length: 8,
      resendCooldownSec: 120,
      maxAttempts: 9,
    });
  });

  it('refresh with nothing submitted to Meta is a conflict', async () => {
    const res = await call('post', '/registration/otp-template/refresh');
    expect(res.status).toBe(409);
    const ref = await addSender(bridgeSender());
    await call('post', '/registration/otp-template', { otp: { sender: ref } });
    expect((await call('post', '/registration/otp-template/refresh')).status).toBe(409);
  });
});

describe('the worker poll', () => {
  it('asks Meta only while the template is pending, and a lock keeps workers from doubling up', async () => {
    const templates = h.app.get(OtpTemplateService);
    expect(await templates.refreshPending()).toBe('skipped');

    const ref = await addSender(graphSender());
    await call('post', '/registration/otp-template', { otp: { sender: ref, enabled: true } });
    const gets = () => h.stubs.graph.requests.filter((r) => r.method === 'GET').length;

    h.stubs.graph.templateStatus = 'APPROVED';
    const job = new OtpTemplateRefreshService(templates, h.redis);
    await h.redis.del('auth:otp-template-refresh');
    await job.run();
    expect(gets()).toBe(1);
    expect((await call('get', '/registration')).body.otp.template.status).toBe('approved');

    // a second worker in the same window does nothing, and an approved template is not polled
    await job.run();
    expect(gets()).toBe(1);
    await h.redis.del('auth:otp-template-refresh');
    await job.run();
    expect(gets()).toBe(1);
  });

  it('survives Meta being down', async () => {
    const templates = h.app.get(OtpTemplateService);
    const ref = await addSender(graphSender());
    await call('post', '/registration/otp-template', { otp: { sender: ref, enabled: true } });
    h.stubs.graph.queue.push({ status: 500, body: { error: { message: 'boom' } } });
    expect(await templates.refreshPending()).toBe('failed');
    expect((await call('get', '/registration')).body.otp.template.status).toBe('pending');
  });
});

describe('send a test code', () => {
  it('delivers through the saved sender, returns only a masked number and never the code', async () => {
    const ref = await addSender(bridgeSender());
    await useSender(ref);
    const res = await call('post', '/registration/otp-test', { to: '+919876543221' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({
      ok: true,
      sender: ref,
      sentTo: '+91 •••• ••21',
      remainingThisHour: 4,
    });
    const delivered = h.otps.at(-1)!;
    expect(delivered.to).toBe('919876543221');
    expect(JSON.stringify(res.body)).not.toContain(delivered.code);
  });

  it('can test a sender that is not the saved one', async () => {
    const bridge = await addSender(bridgeSender());
    const twilio = await addSender(twilioSender());
    await useSender(bridge);
    const res = await call('post', '/registration/otp-test', {
      to: '+919876543221',
      sender: twilio,
    });
    expect(res.status).toBe(201);
    expect(res.body.sender).toBe(twilio);
    expect(h.stubs.twilio.requests).toHaveLength(1);
    expect(h.stubs.bridge.requests).toHaveLength(0);
  });

  it('is limited to 5 per hour per operator, failed attempts included', async () => {
    const ref = await addSender(bridgeSender());
    await useSender(ref);
    for (let i = 0; i < 5; i++) {
      const ok = await call('post', '/registration/otp-test', { to: '+919876543221' });
      expect(ok.status, `send ${i + 1}`).toBe(201);
      expect(ok.body.remainingThisHour).toBe(4 - i);
    }
    const sixth = await call('post', '/registration/otp-test', { to: '+919876543221' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('RATE_LIMITED');
    expect(Number(sixth.body.errors[0].message)).toBeGreaterThan(0);
    expect(h.stubs.bridge.requests).toHaveLength(5);
  });

  it('explains why a test failed, without the token', async () => {
    const ref = await addSender(bridgeSender({ secret: 'wrong-token-for-bridge' }));
    await useSender(ref);
    const res = await call('post', '/registration/otp-test', { to: '+919876543221' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('AUTH_OTP_SEND_FAILED');
    expect(res.body.errors[0]).toEqual({ path: 'reason', message: 'auth_failed' });
    expect(JSON.stringify(res.body)).not.toContain('wrong-token-for-bridge');
  });

  it('needs a sender, a valid number and (for Meta) an approved template', async () => {
    expect((await call('post', '/registration/otp-test', { to: '+919876543221' })).status).toBe(
      422,
    );
    const ref = await addSender(graphSender());
    await useSender(ref);
    const noTemplate = await call('post', '/registration/otp-test', { to: '+919876543221' });
    expect(noTemplate.status).toBe(502);
    expect(noTemplate.body.errors[0].message).toBe('template_not_approved');
    expect((await call('post', '/registration/otp-test', { to: '12345' })).status).toBe(422);
  });
});

describe('secrets and codes never leave the server', () => {
  it('does not appear in any response, audit event or stored setting', async () => {
    // A full pass over every kind, so something would show if it leaked.
    const waba = await addSender(graphSender());
    const twilio = await addSender(twilioSender());
    const bridge = await addSender(bridgeSender());
    await call('patch', `/senders/${bridge.split(':')[1]}`, { secret: BRIDGE_TOKEN });
    await call('post', '/registration/otp-template', { otp: { sender: waba, enabled: true } });
    h.stubs.graph.templateStatus = 'APPROVED';
    await call('post', '/registration/otp-template/refresh');
    for (const ref of [waba, twilio, bridge]) {
      await useSender(ref);
      await call('post', '/registration/otp-test', { to: '+919876543221' });
      const { res } = await signup();
      expect(res.body.status).toBe('otp_required');
    }
    await call('get', '/senders');
    await call('get', '/registration');
    await call('get', '/senders', undefined, supportAccess);

    const codes = h.otps.map((o) => o.code);
    expect(codes.length).toBeGreaterThanOrEqual(6);
    const everything = seen.join('\n');
    for (const secret of [GRAPH_TOKEN, TWILIO_TOKEN, BRIDGE_TOKEN]) {
      expect(everything).not.toContain(secret);
    }
    // a code is 6 digits: none of the codes sent may appear in a response body
    for (const code of codes) expect(everything).not.toContain(`"${code}"`);

    const events = await h.owner.query(
      `SELECT event, payload::text AS payload FROM security_events WHERE event LIKE 'platform.settings.otp%' OR event = 'platform.settings.registration_updated'`,
    );
    expect(events.rowCount).toBeGreaterThan(5);
    const audit = events.rows.map((r) => `${r.event} ${r.payload}`).join('\n');
    for (const secret of [GRAPH_TOKEN, TWILIO_TOKEN, BRIDGE_TOKEN])
      expect(audit).not.toContain(secret);
    for (const code of codes) expect(audit).not.toMatch(new RegExp(`\\b${code}\\b`));
    expect(audit).toContain('platform.settings.otp_test_sent');
    expect(audit).toContain('platform.settings.otp_sender_created');
    expect(audit).toContain('platform.settings.otp_template_submitted');
    expect(audit).toContain('platform.settings.otp_template_status_changed');

    const rows = await h.owner.query(
      `SELECT key, is_secret, value::text AS value FROM platform_settings`,
    );
    for (const row of rows.rows) {
      for (const secret of [GRAPH_TOKEN, TWILIO_TOKEN, BRIDGE_TOKEN]) {
        expect(row.value, row.key).not.toContain(secret);
      }
      if (row.is_secret) expect(row.value).toMatch(/^"v1:/);
    }
    expect(rows.rows.filter((r) => r.is_secret && r.key.startsWith('otp.sender.')).length).toBe(3);
  });
});
