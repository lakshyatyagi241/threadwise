import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeOtpSender } from '../../../src/infra/providers/auth-registration-security/bridge-otp-sender.adapter';
import { MetaTemplateClient } from '../../../src/infra/providers/auth-registration-security/meta-template.client';
import {
  OtpSendError,
  type BridgeOtpConfig,
  type TwilioOtpConfig,
  type WabaOtpConfig,
} from '../../../src/infra/providers/auth-registration-security/otp-sender.port';
import { TwilioOtpSender } from '../../../src/infra/providers/auth-registration-security/twilio-otp-sender.adapter';
import { WabaOtpSender } from '../../../src/infra/providers/auth-registration-security/waba-otp-sender.adapter';

const TOKEN = 'EAAG-secret-token-123';
const INPUT = { to: '+919876543221', code: '482915', ttlMinutes: 5 };

const waba: WabaOtpConfig = {
  kind: 'waba',
  id: 'a1',
  phoneNumberId: '100200300',
  wabaId: '555666777',
  graphBaseUrl: 'https://graph.example.test/v21.0/',
  accessToken: TOKEN,
};
const twilio: TwilioOtpConfig = {
  kind: 'twilio',
  id: 'b2',
  accountSid: 'AC' + 'a'.repeat(32),
  fromNumber: '+14155238886',
  apiBaseUrl: 'https://twilio.example.test',
  authToken: 'twilio-auth-token-xyz',
};
const bridge: BridgeOtpConfig = {
  kind: 'device',
  id: 'c3',
  bridgeUrl: 'https://bridge.example.test/',
  senderNumber: '919000000001',
  token: 'bridge-node-token-789',
};

interface Call {
  url: string;
  init: RequestInit;
}
function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const headerOf = (c: Call, name: string) => new Headers(c.init.headers).get(name);

describe('WabaOtpSender', () => {
  it('posts the approved template to the phone number with a bearer token', async () => {
    const { calls, fetchImpl } = fakeFetch(200, { messages: [{ id: 'wamid.1' }] });
    await new WabaOtpSender(
      waba,
      { name: 'crm_signup_otp', language: 'en_US' },
      { fetchImpl },
    ).send(INPUT);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://graph.example.test/v21.0/100200300/messages');
    expect(headerOf(calls[0]!, 'authorization')).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.template.name).toBe('crm_signup_otp');
    expect(body.to).toBe('919876543221');
    expect(body.template.components[0].parameters[0].text).toBe('482915');
  });

  it('turns a Meta error into a readable failure that never carries the token', async () => {
    const { fetchImpl } = fakeFetch(400, {
      error: {
        message: `Invalid parameter ${TOKEN}`,
        error_user_msg: `Template is paused (${TOKEN})`,
      },
    });
    const err = await new WabaOtpSender(waba, { name: 'n', language: 'en_US' }, { fetchImpl })
      .send(INPUT)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OtpSendError);
    expect((err as OtpSendError).reason).toBe('rejected');
    expect((err as OtpSendError).message).toContain('Template is paused');
    expect((err as OtpSendError).message).not.toContain(TOKEN);
  });

  it('maps 401 to auth_failed and 5xx to provider_error', async () => {
    const run = (status: number) =>
      new WabaOtpSender(
        waba,
        { name: 'n', language: 'en_US' },
        { fetchImpl: fakeFetch(status, {}).fetchImpl },
      )
        .send(INPUT)
        .catch((e: unknown) => e as OtpSendError);
    expect((await run(401)).reason).toBe('auth_failed');
    expect((await run(403)).reason).toBe('auth_failed');
    expect((await run(500)).reason).toBe('provider_error');
    expect((await run(429)).reason).toBe('rejected');
  });

  it('refuses an obviously invalid number before calling anyone', async () => {
    const { calls, fetchImpl } = fakeFetch(200, {});
    const err = await new WabaOtpSender(waba, { name: 'n', language: 'en_US' }, { fetchImpl })
      .send({ ...INPUT, to: '+12' })
      .catch((e: unknown) => e as OtpSendError);
    expect(err.reason).toBe('invalid_number');
    expect(calls).toHaveLength(0);
  });
});

describe('TwilioOtpSender', () => {
  it('posts a form to the Messages API with Basic auth, From and To as WhatsApp addresses', async () => {
    const { calls, fetchImpl } = fakeFetch(201, { sid: 'SM1' });
    await new TwilioOtpSender(twilio, { templateBody: null, appName: 'Acme' }, { fetchImpl }).send(
      INPUT,
    );
    const call = calls[0]!;
    expect(call.url).toBe(
      `https://twilio.example.test/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`,
    );
    expect(headerOf(call, 'authorization')).toBe(
      `Basic ${Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString('base64')}`,
    );
    expect(headerOf(call, 'content-type')).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(String(call.init.body));
    expect(form.get('From')).toBe('whatsapp:+14155238886');
    expect(form.get('To')).toBe('whatsapp:+919876543221');
    expect(form.get('Body')).toContain('482915');
    expect(form.get('Body')).toContain('Acme');
  });

  it('uses the local template text with the code substituted', async () => {
    const { calls, fetchImpl } = fakeFetch(201, {});
    await new TwilioOtpSender(
      twilio,
      { templateBody: '{{1}} is your verification code. It expires in 5 minutes.', appName: 'x' },
      { fetchImpl },
    ).send(INPUT);
    expect(new URLSearchParams(String(calls[0]!.init.body)).get('Body')).toBe(
      '482915 is your verification code. It expires in 5 minutes.',
    );
  });

  it("reports Twilio's error code and message, without the auth token", async () => {
    const { fetchImpl } = fakeFetch(400, {
      code: 63007,
      message: `Channel not found for ${twilio.authToken}`,
    });
    const err = await new TwilioOtpSender(
      twilio,
      { templateBody: null, appName: 'a' },
      { fetchImpl },
    )
      .send(INPUT)
      .catch((e: unknown) => e as OtpSendError);
    expect(err.message).toContain('63007');
    expect(err.message).not.toContain(twilio.authToken);
  });
});

describe('BridgeOtpSender', () => {
  it('posts to /api/send-message/<sender> with X-Node-Token and {targetPhoneNumber, message}', async () => {
    const { calls, fetchImpl } = fakeFetch(200, { success: true });
    await new BridgeOtpSender(bridge, { templateBody: null, appName: 'Acme' }, { fetchImpl }).send(
      INPUT,
    );
    const call = calls[0]!;
    expect(call.url).toBe('https://bridge.example.test/api/send-message/919000000001');
    expect(headerOf(call, 'x-node-token')).toBe(bridge.token);
    const body = JSON.parse(String(call.init.body));
    expect(body.targetPhoneNumber).toBe('919876543221');
    expect(body.message).toContain('482915');
  });

  it('fails when the bridge answers 200 with success:false', async () => {
    const { fetchImpl } = fakeFetch(200, { success: false, message: 'session offline' });
    const err = await new BridgeOtpSender(
      bridge,
      { templateBody: null, appName: 'a' },
      { fetchImpl },
    )
      .send(INPUT)
      .catch((e: unknown) => e as OtpSendError);
    expect(err.reason).toBe('rejected');
    expect(err.message).toContain('session offline');
  });

  it('never echoes the code even if the bridge does', async () => {
    const { fetchImpl } = fakeFetch(500, { error: 'could not send 482915 to the user' });
    const err = await new BridgeOtpSender(
      bridge,
      { templateBody: null, appName: 'a' },
      { fetchImpl },
    )
      .send(INPUT)
      .catch((e: unknown) => e as OtpSendError);
    expect(err.reason).toBe('provider_error');
    expect(err.message).not.toContain('482915');
  });
});

describe('network failures (real sockets)', () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
    server = null;
  });

  it('gives up after the timeout', async () => {
    server = createServer(() => {
      /* never answers */
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const err = await new BridgeOtpSender(
      { ...bridge, bridgeUrl: `http://127.0.0.1:${port}` },
      { templateBody: null, appName: 'a' },
      { timeoutMs: 150 },
    )
      .send(INPUT)
      .catch((e: unknown) => e as OtpSendError);
    expect(err).toBeInstanceOf(OtpSendError);
    expect(err.reason).toBe('timeout');
  });

  it('reports a refused connection', async () => {
    server = createServer();
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>((r) => server!.close(() => r()));
    const err = await new TwilioOtpSender(
      { ...twilio, apiBaseUrl: `http://127.0.0.1:${port}` },
      { templateBody: null, appName: 'a' },
      { timeoutMs: 2000 },
    )
      .send(INPUT)
      .catch((e: unknown) => e as OtpSendError);
    expect(err.reason).toBe('connection_refused');
  });

  it('does not follow a redirect (a token must not travel to another host)', async () => {
    server = createServer((_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' });
      res.end();
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const err = await new BridgeOtpSender(
      { ...bridge, bridgeUrl: `http://127.0.0.1:${port}` },
      { templateBody: null, appName: 'a' },
      { timeoutMs: 2000 },
    )
      .send(INPUT)
      .catch((e: unknown) => e as OtpSendError);
    expect(err).toBeInstanceOf(OtpSendError);
  });
});

describe('MetaTemplateClient', () => {
  const access = { wabaId: waba.wabaId, graphBaseUrl: waba.graphBaseUrl, accessToken: TOKEN };
  const clientWith = (status: number, body: unknown) => {
    const f = fakeFetch(status, body);
    const client = new MetaTemplateClient();
    client.transport = { fetchImpl: f.fetchImpl };
    return { client, calls: f.calls };
  };

  it('submits the template to the WABA and returns Meta id and status', async () => {
    const { client, calls } = clientWith(200, {
      id: '99887766',
      status: 'PENDING',
      category: 'AUTHENTICATION',
    });
    const result = await client.create(access, {
      name: 'crm_signup_otp',
      language: 'en_US',
      ttlMinutes: 5,
    });
    expect(result).toEqual({ id: '99887766', status: 'pending', rejectedReason: null });
    expect(calls[0]!.url).toBe('https://graph.example.test/v21.0/555666777/message_templates');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body)).category).toBe('AUTHENTICATION');
    expect(headerOf(calls[0]!, 'authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('treats a missing status as PENDING and a numeric id as a string', async () => {
    const { client } = clientWith(200, { id: 4242 });
    expect(
      await client.create(access, { name: 'n', language: 'en_US', ttlMinutes: 5 }),
    ).toMatchObject({
      id: '4242',
      status: 'pending',
    });
  });

  it('fails when Meta accepts the call but returns no id', async () => {
    const { client } = clientWith(200, { status: 'PENDING' });
    const err = await client
      .create(access, { name: 'n', language: 'en_US', ttlMinutes: 5 })
      .catch((e: unknown) => e as OtpSendError);
    expect(err).toBeInstanceOf(OtpSendError);
    expect(err.message).toMatch(/no template id/i);
  });

  it("surfaces Meta's own explanation of a refusal, scrubbed of the token", async () => {
    const { client } = clientWith(400, {
      error: { message: 'Invalid parameter', error_user_msg: `Name already used ${TOKEN}` },
    });
    const err = await client
      .create(access, { name: 'n', language: 'en_US', ttlMinutes: 5 })
      .catch((e: unknown) => e as OtpSendError);
    expect(err.message).toContain('Name already used');
    expect(err.message).not.toContain(TOKEN);
  });

  it('reads the review status back', async () => {
    const approved = clientWith(200, { id: '1', status: 'APPROVED' });
    expect(await approved.client.status(access, '1')).toEqual({
      status: 'approved',
      rejectedReason: null,
    });
    expect(approved.calls[0]!.url).toBe(
      'https://graph.example.test/v21.0/1?fields=id,name,status,rejected_reason',
    );
    const rejected = clientWith(200, {
      id: '1',
      status: 'REJECTED',
      rejected_reason: 'INCORRECT_CATEGORY',
    });
    expect(await rejected.client.status(access, '1')).toEqual({
      status: 'rejected',
      rejectedReason: 'INCORRECT_CATEGORY',
    });
  });

  it('edits an existing template', async () => {
    const { client, calls } = clientWith(200, { success: true });
    await client.update(access, '99887766', { ttlMinutes: 15 });
    expect(calls[0]!.url).toBe('https://graph.example.test/v21.0/99887766');
    expect(JSON.parse(String(calls[0]!.init.body)).components[1].code_expiration_minutes).toBe(15);
  });
});
