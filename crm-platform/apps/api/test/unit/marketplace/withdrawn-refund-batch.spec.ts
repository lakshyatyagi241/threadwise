import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { ProrationService } from '../../../src/modules/marketplace/proration.service';

/**
 * #1271: a withdrawn app's bulk refund reads its page together. The number of reads for a dry run must not grow with the number of
 * subscriptions (the old path read the subscription, its payment and its refunds again for each one). The provider is asked once per
 * provider subscription, as before. Fakes route the SQL by its text; the amounts come from the real proration rules.
 */

/** The SQL text of a drizzle query, with parameters shown as `?`. */
function sqlText(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (Array.isArray(node)) return node.map(sqlText).join('');
  if (typeof node !== 'object') return '';
  const o = node as Record<string, unknown>;
  if ('queryChunks' in o) return (o.queryChunks as unknown[]).map(sqlText).join('');
  if ('encoder' in o) return ' ? ';
  if ('value' in o) return Array.isArray(o.value) ? (o.value as string[]).join('') : '';
  return '';
}

const KILLED_AT = new Date('2026-10-01T00:00:00Z');

function fixture(n: number) {
  const subs = Array.from({ length: n }, (_, i) => ({
    org_id: 100 + i,
    id: 1000 + i,
    uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    source: 'purchase',
    billing_period: 'monthly',
    current_period_end: '2026-10-20T00:00:00Z',
    app_slug: 'quote-panel',
    app_name: 'Quote panel',
    org_uuid: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    org_name: `Workspace ${i}`,
    pack_slug: 'quote-panel',
    pack_id: 7,
  }));
  return subs;
}

function build(n: number) {
  const subs = fixture(n);
  const reads: string[] = [];
  const chargesFor = vi.fn(async (provider: string) => [
    {
      status: 'paid',
      paymentId: `pay_${provider}`,
      amountMinor: '120000',
      currency: 'INR',
      paidAt: '2026-09-01T00:00:00Z',
    },
  ]);
  const tx = {
    execute: async (q: unknown) => {
      const text = sqlText(q);
      reads.push(text);
      if (text.includes('AS provider'))
        return { rows: subs.map((s) => ({ id: s.id, provider: `prov-${s.id}` })) };
      if (text.includes('LEFT JOIN LATERAL')) return { rows: [] };
      if (text.includes('FROM order_refunds')) return { rows: [] };
      if (text.includes('SELECT s.org_id')) return { rows: subs };
      throw new Error(`unexpected read: ${text.slice(0, 80)}`);
    },
  };
  const store = {
    tx: async (fn: (t: unknown) => unknown) => fn(tx),
    app: async () => ({
      id: 1,
      slug: 'quote-panel',
      status: 'killed',
      killedAt: KILLED_AT,
    }),
  };
  const refunds = { chargesFor };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new ProrationService(
    store as never,
    refunds as never,
    {} as never,
    {} as never,
    audit as never,
  );
  return { service, reads, chargesFor };
}

const run = <T>(fn: () => Promise<T>) =>
  RequestContextStore.run(
    {
      requestId: 'r',
      orgId: 0,
      actorType: 'platform_operator',
      actorId: 1,
      userId: null,
      operatorRole: 'super_admin',
    },
    fn,
  );

describe('#1271 withdrawn-app bulk refund reads its page together', () => {
  it('a dry run makes the same number of reads for 3 subscriptions as for 60', async () => {
    const small = build(3);
    const large = build(60);
    await run(() =>
      small.service.refundWithdrawnApp('quote-panel', { dryRun: true, reason: 'x' } as never, 1),
    );
    await run(() =>
      large.service.refundWithdrawnApp('quote-panel', { dryRun: true, reason: 'x' } as never, 1),
    );
    expect(large.reads.length).toBe(small.reads.length);
    expect(large.reads.length).toBeLessThanOrEqual(6);
  });

  it('asks the provider once per provider subscription, and counts every subscription as refundable', async () => {
    const { service, chargesFor } = build(12);
    const out = await run(() =>
      service.refundWithdrawnApp('quote-panel', { dryRun: true, reason: 'x' } as never, 1),
    );
    expect(chargesFor).toHaveBeenCalledTimes(12);
    expect(out.considered).toBe(12);
    expect(out.refundable).toBe(12);
    expect(out.refunded).toBe(0);
    expect(out.failed).toBe(0);
  });
});
