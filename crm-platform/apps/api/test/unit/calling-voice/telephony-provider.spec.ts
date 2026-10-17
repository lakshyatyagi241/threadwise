import { describe, expect, it } from 'vitest';
import {
  TELEPHONY_REPLAY_WINDOW_SECONDS,
  TELEPHONY_SIGNATURE_HEADER,
  TELEPHONY_TIMESTAMP_HEADER,
} from '@crm/contracts';
import {
  FakeTelephonyProvider,
  GenericTelephonyProvider,
  signTelephonyCallback,
  verifyTelephonyCallback,
} from '../../../src/infra/providers/telephony';

const SECRET = 'tws_0123456789abcdef';
const NOW = new Date('2026-10-17T10:00:00Z');
const ts = (d: Date) => String(Math.floor(d.getTime() / 1000));

const body = (over: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      id: 'evt-1',
      type: 'call.completed',
      call: {
        id: 'CA1',
        direction: 'inbound',
        status: 'completed',
        from: '+919876543210',
        to: '+918012345678',
        startedAt: '2026-10-17T09:50:00Z',
        durationSec: 125,
        recordingRef: 'rec-1',
        ...over,
      },
    }),
  );

const signed = (raw: Buffer, secret = SECRET, at = NOW) => ({
  [TELEPHONY_TIMESTAMP_HEADER]: ts(at),
  [TELEPHONY_SIGNATURE_HEADER]: signTelephonyCallback(secret, ts(at), raw),
});

describe('the signed callback', () => {
  const raw = body();

  it('accepts a callback signed over the raw bytes with the connection secret', () => {
    const h = signed(raw);
    expect(
      verifyTelephonyCallback(
        SECRET,
        h[TELEPHONY_TIMESTAMP_HEADER],
        h[TELEPHONY_SIGNATURE_HEADER],
        raw,
        NOW,
      ),
    ).toBe(true);
  });

  it('refuses the wrong secret, a changed byte, a missing header and a malformed signature', () => {
    const h = signed(raw);
    const t = h[TELEPHONY_TIMESTAMP_HEADER];
    const sig = h[TELEPHONY_SIGNATURE_HEADER];
    expect(verifyTelephonyCallback('another-secret', t, sig, raw, NOW)).toBe(false);
    expect(
      verifyTelephonyCallback(SECRET, t, sig, Buffer.concat([raw, Buffer.from(' ')]), NOW),
    ).toBe(false);
    expect(verifyTelephonyCallback(SECRET, undefined, sig, raw, NOW)).toBe(false);
    expect(verifyTelephonyCallback(SECRET, t, undefined, raw, NOW)).toBe(false);
    expect(verifyTelephonyCallback(SECRET, t, 'v1=abc', raw, NOW)).toBe(false);
    expect(verifyTelephonyCallback(SECRET, t, sig.replace('v1=', 'v2='), raw, NOW)).toBe(false);
    expect(verifyTelephonyCallback('', t, sig, raw, NOW)).toBe(false);
  });

  it('refuses a replay outside the window, and a new timestamp on an old signature', () => {
    const old = new Date(NOW.getTime() - (TELEPHONY_REPLAY_WINDOW_SECONDS + 5) * 1000);
    const h = signed(raw, SECRET, old);
    expect(
      verifyTelephonyCallback(
        SECRET,
        h[TELEPHONY_TIMESTAMP_HEADER],
        h[TELEPHONY_SIGNATURE_HEADER],
        raw,
        NOW,
      ),
    ).toBe(false);
    // The old signature with a fresh timestamp: the timestamp is part of what was signed.
    expect(verifyTelephonyCallback(SECRET, ts(NOW), h[TELEPHONY_SIGNATURE_HEADER], raw, NOW)).toBe(
      false,
    );
    expect(
      verifyTelephonyCallback(SECRET, 'abc', signed(raw)[TELEPHONY_SIGNATURE_HEADER], raw, NOW),
    ).toBe(false);
  });
});

describe('the generic provider', () => {
  const p = new GenericTelephonyProvider();

  it('turns the callback into one normalised call', () => {
    expect(p.parseWebhook(body())).toEqual([
      {
        eventId: 'evt-1',
        callId: 'CA1',
        direction: 'inbound',
        status: 'completed',
        customerNumber: '+919876543210',
        ourNumber: '+918012345678',
        startedAt: new Date('2026-10-17T09:50:00Z'),
        durationSec: 125,
        recordingRef: 'rec-1',
      },
    ]);
  });

  it('reads the customer from `to` on an outbound call', () => {
    const [e] = p.parseWebhook(body({ direction: 'outbound' }));
    expect(e!.customerNumber).toBe('+918012345678');
    expect(e!.ourNumber).toBe('+919876543210');
  });

  it('answers nothing for a payload that is not a finished call, and never throws', () => {
    expect(p.parseWebhook(Buffer.from('not json'))).toEqual([]);
    expect(p.parseWebhook(Buffer.from('{}'))).toEqual([]);
    expect(p.parseWebhook(body({ status: 'on-fire' }))).toEqual([]);
    expect(p.parseWebhook(body({ durationSec: -1 }))).toEqual([]);
  });

  it('cannot place a call', async () => {
    expect(p.supportsClickToCall).toBe(false);
    expect(
      await p.clickToCall({
        agentNumber: '+1',
        customerNumber: '+2',
        ourNumber: null,
        correlationId: 'x',
      }),
    ).toMatchObject({ ok: false, code: 'unsupported' });
  });
});

describe('the fake provider', () => {
  it('places calls that ring nobody, records them, and can be told to refuse', async () => {
    const f = new FakeTelephonyProvider();
    expect(f.supportsClickToCall).toBe(true);
    const a = await f.clickToCall({
      agentNumber: '+91111',
      customerNumber: '+91222',
      ourNumber: null,
      correlationId: 'c1',
    });
    const b = await f.clickToCall({
      agentNumber: '+91111',
      customerNumber: '+91333',
      ourNumber: null,
      correlationId: 'c2',
    });
    expect(a.ok && b.ok && a.callId !== b.callId).toBe(true);
    expect(f.placed.map((r) => r.customerNumber)).toEqual(['+91222', '+91333']);
    f.refuse = 'number blocked';
    expect(
      await f.clickToCall({
        agentNumber: '+1',
        customerNumber: '+2',
        ourNumber: null,
        correlationId: 'c3',
      }),
    ).toEqual({ ok: false, error: 'number blocked', code: 'refused' });
  });

  it('speaks the same signed contract as the generic provider', () => {
    const f = new FakeTelephonyProvider();
    const raw = body();
    const h = signed(raw);
    expect(f.verifyWebhook(raw, h, SECRET, NOW)).toBe(true);
    expect(f.parseWebhook(raw)).toHaveLength(1);
  });
});
