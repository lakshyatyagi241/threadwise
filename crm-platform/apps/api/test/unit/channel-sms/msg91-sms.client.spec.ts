import { describe, expect, it } from 'vitest';
import { Msg91SmsClient } from '../../../src/infra/providers/channel-sms/msg91-sms.client';
import type { SmsCredentials } from '../../../src/infra/providers/channel-sms/sms.port';
import { ENV, fakeFetch } from './sms-fake-fetch';

const creds: SmsCredentials = {
  provider: 'msg91',
  from: 'THREAD',
  accountSid: '',
  authToken: 'authkey-secret',
  senderId: 'THRDWS',
  dltTemplateId: '',
};

describe('TW-SMS-004: MSG91 auth key check', () => {
  it('a blank key is refused without a call', async () => {
    const f = fakeFetch();
    expect(await new Msg91SmsClient(ENV, f.fn).verify({ ...creds, authToken: ' ' })).toEqual({
      ok: false,
      error: 'An MSG91 auth key is required.',
    });
    expect(f.calls).toHaveLength(0);
  });

  it('a 2xx without an error body passes: the cheapest authenticated read with the authkey header', async () => {
    const f = fakeFetch([{ status: 200, text: '1200.50' }]);
    expect(await new Msg91SmsClient(ENV, f.fn).verify(creds)).toEqual({ ok: true });
    expect(f.calls[0]).toMatchObject({
      url: 'https://control.msg91.test/api/balance.php?type=4',
      method: 'GET',
      headers: { authkey: 'authkey-secret', accept: 'application/json' },
    });
  });

  it('HTTP 200 with an error or invalid body is a rejection; so is a non-2xx', async () => {
    const a = await new Msg91SmsClient(
      ENV,
      fakeFetch([{ status: 200, text: '{"type":"error","message":"Authentication failure"}' }]).fn,
    ).verify(creds);
    expect(a).toEqual({ ok: false, error: 'MSG91 rejected that auth key.' });
    const b = await new Msg91SmsClient(
      ENV,
      fakeFetch([{ status: 200, text: 'Invalid Key' }]).fn,
    ).verify(creds);
    expect(b).toEqual({ ok: false, error: 'MSG91 rejected that auth key.' });
    const c = await new Msg91SmsClient(ENV, fakeFetch([{ status: 401, text: '' }]).fn).verify(
      creds,
    );
    expect(c).toEqual({ ok: false, error: 'MSG91 rejected that auth key (HTTP 401).' });
  });

  it('a network error says MSG91 could not be reached and hides the key', async () => {
    const r = await new Msg91SmsClient(ENV, fakeFetch([new Error('dns authkey-secret')]).fn).verify(
      creds,
    );
    expect(r).toEqual({ ok: false, error: 'Could not reach MSG91: dns ***' });
  });
});

describe('TW-SMS-012: send through MSG91', () => {
  it('with a DLT template: the flow route, the whole text in VAR1 and body, the sender id, no plus on the number', async () => {
    const f = fakeFetch([
      { status: 200, json: { type: 'success', message: 'req-1', request_id: 'abc123' } },
    ]);
    const r = await new Msg91SmsClient(ENV, f.fn).send(
      { ...creds, dltTemplateId: 'TPL-9' },
      '+91 98765 43210',
      ' Hi Asha ',
    );
    expect(r).toEqual({ ok: true, messageId: 'abc123', segments: 1 });
    const call = f.calls[0]!;
    expect(call.url).toBe('https://control.msg91.test/api/v5/flow/');
    expect(call.method).toBe('POST');
    expect(call.headers).toMatchObject({
      authkey: 'authkey-secret',
      'content-type': 'application/json',
    });
    expect(JSON.parse(call.body!)).toEqual({
      template_id: 'TPL-9',
      short_url: '0',
      recipients: [{ mobiles: '919876543210', VAR1: 'Hi Asha', body: 'Hi Asha' }],
      sender: 'THRDWS',
    });
  });

  it('flow route without a sender id sends no sender key', async () => {
    const f = fakeFetch([{ status: 200, json: { type: 'success', request_id: 'r' } }]);
    await new Msg91SmsClient(ENV, f.fn).send(
      { ...creds, senderId: '', dltTemplateId: 'T' },
      '919876543210',
      'x',
    );
    expect(JSON.parse(f.calls[0]!.body!)).not.toHaveProperty('sender');
  });

  it('without a DLT template: the plain route, MSGIND when there is no sender id, transactional route 4', async () => {
    const f = fakeFetch([{ status: 200, json: { type: 'success', message: 'msg-77' } }]);
    const r = await new Msg91SmsClient(ENV, f.fn).send(
      { ...creds, senderId: '' },
      '919876543210',
      'Hello',
    );
    expect(r).toEqual({ ok: true, messageId: 'msg-77', segments: 1 });
    expect(f.calls[0]!.url).toBe('https://control.msg91.test/api/v2/sendsms');
    expect(JSON.parse(f.calls[0]!.body!)).toEqual({
      sender: 'MSGIND',
      route: '4',
      country: '0',
      sms: [{ message: 'Hello', to: ['919876543210'] }],
    });
  });

  it('HTTP 200 with type error is a failure with the translated reason', async () => {
    const f = fakeFetch([
      { status: 200, json: { type: 'error', message: 'Invalid sender ID', code: '311' } },
    ]);
    const r = await new Msg91SmsClient(ENV, f.fn).send(creds, '919876543210', 'x');
    expect(r).toMatchObject({ ok: false, code: '311', badCredentials: false });
    expect((r as { error: string }).error).toContain('exactly 6 letters and DLT-registered');
  });

  it('flags a refused key and counts segments locally', async () => {
    const bad = await new Msg91SmsClient(
      ENV,
      fakeFetch([{ status: 401, json: { message: 'Invalid authkey' } }]).fn,
    ).send(creds, '919876543210', 'x');
    expect(bad).toMatchObject({ ok: false, badCredentials: true, code: '401' });
    const long = await new Msg91SmsClient(
      ENV,
      fakeFetch([{ status: 200, json: { type: 'success', request_id: 'r' } }]).fn,
    ).send(creds, '919876543210', 'y'.repeat(200));
    expect(long).toMatchObject({ ok: true, segments: 2 });
  });

  it('never calls without a key, a readable number or text, and never throws', async () => {
    const f = fakeFetch([new Error('network')]);
    const c = new Msg91SmsClient(ENV, f.fn);
    expect(await c.send({ ...creds, authToken: '' }, '919876543210', 'x')).toMatchObject({
      ok: false,
    });
    expect(await c.send(creds, 'abc', 'x')).toEqual({
      ok: false,
      error: 'That recipient number could not be read as a phone number.',
    });
    expect(await c.send(creds, '919876543210', '  ')).toEqual({
      ok: false,
      error: 'Nothing to send — the message is empty.',
    });
    expect(f.calls).toHaveLength(0);
    expect(await c.send(creds, '919876543210', 'x')).toEqual({
      ok: false,
      error: 'Could not reach MSG91: network',
    });
  });
});
