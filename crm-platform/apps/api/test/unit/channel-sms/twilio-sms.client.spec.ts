import { describe, expect, it } from 'vitest';
import { TwilioSmsClient } from '../../../src/infra/providers/channel-sms/twilio-sms.client';
import type { SmsCredentials } from '../../../src/infra/providers/channel-sms/sms.port';
import { ENV, fakeFetch, type Answer } from './sms-fake-fetch';

const creds: SmsCredentials = {
  provider: 'twilio',
  from: '+17372508034',
  accountSid: 'ACabc123',
  authToken: 'token-secret-1',
  senderId: '',
  dltTemplateId: '',
};
const basic = `Basic ${Buffer.from('ACabc123:token-secret-1').toString('base64')}`;

describe('TW-SMS-003: Twilio credential check', () => {
  it('needs both values, the SID must start with AC, and no call is made for either', async () => {
    const f = fakeFetch();
    const c = new TwilioSmsClient(ENV, f.fn);
    expect(await c.verify({ ...creds, authToken: '' })).toEqual({
      ok: false,
      error: 'Account SID and Auth Token are both required.',
    });
    const sk = await c.verify({ ...creds, accountSid: 'SKxyz' });
    expect(sk.ok).toBe(false);
    expect((sk as { error: string }).error).toContain(
      'an API Key starting "SK" will not work here',
    );
    expect(f.calls).toHaveLength(0);
  });

  it('a 2xx passes: a GET of the account with basic auth', async () => {
    const f = fakeFetch([{ status: 200, json: { sid: 'ACabc123' } }]);
    expect(await new TwilioSmsClient(ENV, f.fn).verify(creds)).toEqual({ ok: true });
    expect(f.calls[0]).toMatchObject({
      url: 'https://api.twilio.test/2010-04-01/Accounts/ACabc123.json',
      method: 'GET',
      headers: { authorization: basic },
    });
  });

  it("a refusal carries Twilio's reason; an unreadable body falls back to the HTTP status", async () => {
    const a = await new TwilioSmsClient(
      ENV,
      fakeFetch([{ status: 401, json: { message: 'Authenticate' } }]).fn,
    ).verify(creds);
    expect(a).toEqual({ ok: false, error: 'Twilio rejected those credentials: Authenticate' });
    const b = await new TwilioSmsClient(ENV, fakeFetch([{ status: 500, text: 'oops' }]).fn).verify(
      creds,
    );
    expect(b).toEqual({ ok: false, error: 'Twilio rejected those credentials: HTTP 500' });
  });

  it('a network error says Twilio could not be reached and never leaks the token', async () => {
    const f = fakeFetch([new Error('connect ECONNREFUSED token-secret-1')]);
    const r = await new TwilioSmsClient(ENV, f.fn).verify(creds);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toBe('Could not reach Twilio: connect ECONNREFUSED ***');
  });
});

describe('TW-SMS-011: send through Twilio', () => {
  it("posts From, To, Body and the status callback, and returns the sid and Twilio's segment count", async () => {
    const f = fakeFetch([{ status: 201, json: { sid: 'SM123', num_segments: '2' } }]);
    const r = await new TwilioSmsClient(ENV, f.fn).send(creds, '(415) 555-1234', '  Hello  ', {
      statusCallbackUrl: 'https://app.test/v2/sms/status',
    });
    expect(r).toEqual({ ok: true, messageId: 'SM123', segments: 2 });
    const call = f.calls[0]!;
    expect(call.url).toBe('https://api.twilio.test/2010-04-01/Accounts/ACabc123/Messages.json');
    expect(call.method).toBe('POST');
    expect(call.headers.authorization).toBe(basic);
    const form = new URLSearchParams(call.body!);
    expect(Object.fromEntries(form)).toEqual({
      From: '+17372508034',
      To: '+4155551234',
      Body: 'Hello',
      StatusCallback: 'https://app.test/v2/sms/status',
    });
  });

  it('falls back to our own segment count when Twilio gives none or 0', async () => {
    const long = 'x'.repeat(161);
    const a = await new TwilioSmsClient(
      ENV,
      fakeFetch([{ status: 201, json: { sid: 'SM1' } }]).fn,
    ).send(creds, '+1415', long);
    expect(a).toMatchObject({ ok: true, segments: 2 });
    const b = await new TwilioSmsClient(
      ENV,
      fakeFetch([{ status: 201, json: { sid: 'SM1', num_segments: '0' } }]).fn,
    ).send(creds, '+1415', 'hi');
    expect(b).toMatchObject({ ok: true, segments: 1 });
  });

  it('an alphanumeric From is sent verbatim', async () => {
    const f = fakeFetch([{ status: 201, json: { sid: 'SM9' } }]);
    await new TwilioSmsClient(ENV, f.fn).send({ ...creds, from: 'ACMEIN' }, '+919876543210', 'Hi');
    expect(new URLSearchParams(f.calls[0]!.body!).get('From')).toBe('ACMEIN');
  });

  it('no credentials, an empty body or an unreadable recipient: no HTTP call is made', async () => {
    const f = fakeFetch();
    const c = new TwilioSmsClient(ENV, f.fn);
    expect(await c.send({ ...creds, authToken: '' }, '+1415', 'hi')).toEqual({
      ok: false,
      error: 'This SMS number has no credentials — reconnect it on the SMS page.',
    });
    expect(await c.send(creds, '+1415', '   \n ')).toEqual({
      ok: false,
      error: 'Nothing to send — the message is empty.',
    });
    expect(await c.send(creds, 'none', 'hi')).toEqual({
      ok: false,
      error: 'That recipient number could not be read as a phone number.',
    });
    expect(f.calls).toHaveLength(0);
  });

  it("translates Twilio's error codes and flags a refused key", async () => {
    const r = await new TwilioSmsClient(
      ENV,
      fakeFetch([{ status: 400, json: { code: 21211, message: 'Invalid To' } }]).fn,
    ).send(creds, '+1415', 'hi');
    expect(r).toEqual({
      ok: false,
      code: '21211',
      badCredentials: false,
      error:
        'Twilio could not read the recipient number; it must be full international format, e.g. +919876543210.',
    });
    const bad = await new TwilioSmsClient(
      ENV,
      fakeFetch([{ status: 401, json: { code: 20003, message: 'Authenticate' } }]).fn,
    ).send(creds, '+1415', 'hi');
    expect(bad).toMatchObject({ ok: false, badCredentials: true, error: 'Authenticate' });
    const stop = await new TwilioSmsClient(
      ENV,
      fakeFetch([{ status: 400, json: { code: 21610, message: 'x' } }]).fn,
    ).send(creds, '+1415', 'hi');
    expect(stop).toMatchObject({ code: '21610', error: expect.stringContaining('replied STOP') });
  });

  it('a network exception is a result, never a throw', async () => {
    const r = await new TwilioSmsClient(ENV, fakeFetch([new Error('timeout')]).fn).send(
      creds,
      '+1415',
      'hi',
    );
    expect(r).toEqual({ ok: false, error: 'Could not reach the SMS provider: timeout' });
  });
});

describe('TW-SMS-008: Twilio Lookup', () => {
  const lookup = (answer: Answer, number = '+1 415 555 1234') => {
    const f = fakeFetch([answer]);
    return new TwilioSmsClient(ENV, f.fn).lookup(creds, number).then((r) => ({ r, f }));
  };

  it('a mobile number is textable and shows the carrier', async () => {
    const { r, f } = await lookup({
      status: 200,
      json: { valid: true, line_type_intelligence: { type: 'mobile', carrier_name: 'T-Mobile' } },
    });
    expect(r).toEqual({
      ok: true,
      digits: '14155551234',
      kind: 'mobile',
      carrier: 'T-Mobile',
      message: 'Mobile — can receive SMS. Carrier: T-Mobile.',
    });
    expect(f.calls[0]!.url).toBe(
      'https://lookups.twilio.test/v2/PhoneNumbers/+14155551234?Fields=line_type_intelligence',
    );
  });

  it('a landline and VoIP are named; an unknown or missing type is still a valid number', async () => {
    expect(
      (
        await lookup({
          status: 200,
          json: { valid: true, line_type_intelligence: { type: 'landline' } },
        })
      ).r.kind,
    ).toBe('landline');
    expect(
      (
        await lookup({
          status: 200,
          json: { valid: true, line_type_intelligence: { type: 'nonFixedVoip' } },
        })
      ).r.kind,
    ).toBe('voip');
    const none = (await lookup({ status: 200, json: { valid: true } })).r;
    expect(none).toMatchObject({
      ok: true,
      kind: 'unknown',
      message: 'Valid number. Twilio did not report a line type.',
    });
  });

  it('404 and valid:false are a verdict (invalid); any other failure is not', async () => {
    expect((await lookup({ status: 404, json: {} })).r).toMatchObject({
      ok: true,
      kind: 'invalid',
    });
    expect((await lookup({ status: 200, json: { valid: false } })).r).toMatchObject({
      ok: true,
      kind: 'invalid',
    });
    expect((await lookup({ status: 500, json: { message: 'Boom' } })).r).toMatchObject({
      ok: false,
      message: 'Boom',
    });
    expect((await lookup({ status: 503, text: '' })).r).toMatchObject({
      ok: false,
      message: 'HTTP 503',
    });
  });

  it('non-digit input and a network failure answer with a sentence', async () => {
    expect((await lookup({ status: 200 }, 'abc')).r).toMatchObject({
      ok: false,
      message: 'That is not a phone number.',
    });
    const net = await new TwilioSmsClient(ENV, fakeFetch([new Error('down')]).fn).lookup(
      creds,
      '+14155551234',
    );
    expect(net).toMatchObject({ ok: false, message: 'Could not reach the lookup service.' });
  });
});
