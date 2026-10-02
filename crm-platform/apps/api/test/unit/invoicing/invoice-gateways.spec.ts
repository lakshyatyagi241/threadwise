import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  HmacGenericGateway,
  ManualTransferGateway,
  WEBHOOK_TOLERANCE_SECONDS,
} from '../../../src/infra/providers/invoice-payments/invoice-payment-gateways';

const SECRET = 'whsec_0123456789abcdef0123';
const NOW = new Date('2026-10-05T10:00:00Z');
const t = Math.floor(NOW.getTime() / 1000);
const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'payment.succeeded', data: { amount: '10.00' } }));
const sign = (secret: string, ts: number, raw: Buffer) =>
  createHmac('sha256', secret).update(`${ts}.`).update(raw).digest('hex');

describe('the generic HMAC webhook adapter (WD-PAY-009, D-18)', () => {
  const gw = new HmacGenericGateway();
  const verify = (header: string | undefined, raw = body, secret = SECRET, now = NOW) =>
    gw.verifyWebhookSignature(raw, { 'x-invoice-signature': header }, secret, now);

  it('accepts a correct signature over the raw body', () => {
    expect(verify(`t=${t},v1=${sign(SECRET, t, body)}`)).toBe(true);
  });

  it('rejects a wrong secret, a tampered body and a changed timestamp', () => {
    expect(verify(`t=${t},v1=${sign('another-secret-0123456789', t, body)}`)).toBe(false);
    expect(verify(`t=${t},v1=${sign(SECRET, t, body)}`, Buffer.from(body.toString().replace('10.00', '1000.00')))).toBe(false);
    expect(verify(`t=${t + 1},v1=${sign(SECRET, t, body)}`)).toBe(false);
  });

  it('WD-PAY-009 D-18: fails closed with no secret, a short secret, no header or a malformed one', () => {
    expect(verify(`t=${t},v1=${sign(SECRET, t, body)}`, body, '')).toBe(false);
    expect(verify(`t=${t},v1=${sign('short', t, body)}`, body, 'short')).toBe(false);
    expect(verify(undefined)).toBe(false);
    expect(verify('')).toBe(false);
    expect(verify('garbage')).toBe(false);
    expect(verify(`t=abc,v1=${sign(SECRET, t, body)}`)).toBe(false);
    expect(verify(`t=${t},v1=zz`)).toBe(false);
    expect(verify(`t=${t}`)).toBe(false);
    expect(verify(`v1=${sign(SECRET, t, body)}`)).toBe(false);
  });

  it('refuses a stale or future timestamp (a captured webhook cannot be replayed for ever; WaDesk had no tolerance)', () => {
    const old = t - WEBHOOK_TOLERANCE_SECONDS - 1;
    expect(verify(`t=${old},v1=${sign(SECRET, old, body)}`)).toBe(false);
    const ok = t - WEBHOOK_TOLERANCE_SECONDS + 1;
    expect(verify(`t=${ok},v1=${sign(SECRET, ok, body)}`)).toBe(true);
    const future = t + WEBHOOK_TOLERANCE_SECONDS + 1;
    expect(verify(`t=${future},v1=${sign(SECRET, future, body)}`)).toBe(false);
  });

  it('accepts any one of several v1 signatures (a rotating secret), still refusing when none matches', () => {
    expect(verify(`t=${t},v1=${'0'.repeat(64)},v1=${sign(SECRET, t, body)}`)).toBe(true);
    expect(verify(`t=${t},v1=${'0'.repeat(64)},v1=${'1'.repeat(64)}`)).toBe(false);
  });

  it('reads the header case-insensitively as Node lower-cases it, and takes the first of a repeated header', () => {
    const header = `t=${t},v1=${sign(SECRET, t, body)}`;
    expect(gw.verifyWebhookSignature(body, { 'x-invoice-signature': [header, 'x'] }, SECRET, NOW)).toBe(true);
  });

  it('has no hosted checkout: the buyer is shown instructions', async () => {
    const r = await gw.createCheckout({ attemptId: 'a', amountMinor: 100n, currency: 'USD', invoiceNumber: 'INV-1', description: 'd' });
    expect(r.kind).toBe('instructions');
  });
});

describe('the manual (bank transfer) adapter', () => {
  const gw = new ManualTransferGateway();

  it('can never verify a webhook: there is no such webhook, and a check that could pass would be a hole', () => {
    expect(gw.verifyWebhookSignature()).toBe(false);
  });

  it('shows instructions and hosts nothing', async () => {
    const r = await gw.createCheckout({ attemptId: 'a', amountMinor: 100n, currency: 'USD', invoiceNumber: 'INV-1', description: 'd' });
    expect(r).toEqual({ kind: 'instructions' });
  });
});
