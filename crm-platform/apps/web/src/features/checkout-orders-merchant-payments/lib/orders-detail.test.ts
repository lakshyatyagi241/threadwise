import { describe, expect, it } from 'vitest';
import {
  buildStatusBody,
  defaultGateway,
  isHttpUrl,
  isStatusFormDirty,
  rtoTone,
  sortPayments,
  sortTimeline,
} from './orders-detail';

const order = { paymentLink: null as string | null, rowVersion: 4 };
const form = (over: Partial<{ status: string; notes: string; paymentLink: string }> = {}) => ({
  status: 'confirmed',
  notes: '',
  paymentLink: '',
  ...over,
});

describe('isHttpUrl', () => {
  it('accepts web links only', () => {
    expect(isHttpUrl('https://rzp.io/i/abc')).toBe(true);
    expect(isHttpUrl(' http://example.com ')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('rzp.io/i/abc')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});

describe('buildStatusBody', () => {
  it('carries the loaded row version and any status', () => {
    expect(buildStatusBody(order, form({ status: 'shipped' }))).toEqual({
      status: 'shipped',
      notes: null,
      rowVersion: 4,
    });
  });

  it('refuses a status it does not know and a link that is not a web link', () => {
    expect(buildStatusBody(order, form({ status: 'refunded' }))).toBeNull();
    expect(buildStatusBody(order, form({ paymentLink: 'ftp://x' }))).toBeNull();
  });

  it('sends a typed link, trims notes, and clears an emptied note with null', () => {
    expect(
      buildStatusBody(order, form({ notes: '  call first ', paymentLink: ' https://pay.test/x ' })),
    ).toEqual({
      status: 'confirmed',
      notes: 'call first',
      paymentLink: 'https://pay.test/x',
      rowVersion: 4,
    });
  });

  it('does not resend an unchanged link (the buyer would be messaged again)', () => {
    const body = buildStatusBody(
      { paymentLink: 'https://pay.test/x', rowVersion: 9 },
      form({ paymentLink: 'https://pay.test/x' }),
    );
    expect(body).not.toHaveProperty('paymentLink');
  });
});

describe('isStatusFormDirty', () => {
  const o = {
    status: 'new',
    notes: 'a',
    paymentLink: null,
  } as Parameters<typeof isStatusFormDirty>[0];
  it('is false until something changes, ignoring surrounding spaces', () => {
    expect(isStatusFormDirty(o, { status: 'new', notes: ' a ', paymentLink: '' })).toBe(false);
    expect(isStatusFormDirty(o, { status: 'paid', notes: 'a', paymentLink: '' })).toBe(true);
    expect(isStatusFormDirty(o, { status: 'new', notes: 'a', paymentLink: 'https://x.y' })).toBe(
      true,
    );
  });
});

describe('sorting', () => {
  it('puts the newest timeline entry first and keeps ties in order', () => {
    const t = (at: string, detail: string) => ({
      at,
      kind: 'note' as const,
      detail,
      actor: 'user',
    });
    const out = sortTimeline([
      t('2026-10-01T10:00:00.000Z', 'a'),
      t('2026-10-03T10:00:00.000Z', 'b'),
      t('2026-10-03T10:00:00.000Z', 'c'),
    ]);
    expect(out.map((e) => e.detail)).toEqual(['b', 'c', 'a']);
  });

  it('sorts payments newest first and sends the undated ones last', () => {
    const p = (at: string | null, reference: string) => ({
      kind: 'gateway' as const,
      gateway: null,
      status: 'paid' as const,
      amountMinor: 1,
      currencyCode: 'INR',
      reference,
      url: null,
      at,
    });
    expect(
      sortPayments([
        p(null, 'x'),
        p('2026-10-01T00:00:00.000Z', 'old'),
        p('2026-10-02T00:00:00.000Z', 'new'),
      ]).map((x) => x.reference),
    ).toEqual(['new', 'old', 'x']);
  });
});

describe('small helpers', () => {
  it('maps the RTO band to a tone', () => {
    expect(rtoTone('low')).toBe('success');
    expect(rtoTone('medium')).toBe('warning');
    expect(rtoTone('high')).toBe('danger');
    expect(rtoTone('weird')).toBe('neutral');
    expect(rtoTone(null)).toBe('neutral');
  });

  it('preselects the first available gateway, or nothing', () => {
    expect(defaultGateway({ availableGateways: [{ slug: 'stripe', name: 'Stripe' }] })).toBe(
      'stripe',
    );
    expect(defaultGateway({ availableGateways: [] })).toBe('');
  });
});
