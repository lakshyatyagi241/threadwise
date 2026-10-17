import { describe, expect, it } from 'vitest';
import { ANALYTICS_EVENT } from '@crm/contracts';
import { toEventRow } from '../../../src/kernel/analytics/analytics-events.service';

const NOW = new Date('2026-10-16T10:00:00.000Z');

describe('toEventRow', () => {
  it('fills the defaults: organization from the request, business time now, qty 1, no props', () => {
    const row = toEventRow({ type: ANALYTICS_EVENT.MSG_DELIVERED }, 7, NOW);
    expect(row).toMatchObject({ type: 3, orgId: 7, occurredAt: NOW, qty: 1, props: null });
  });

  it('lets the caller name the organization, the time and the measures', () => {
    const at = new Date('2026-10-15T08:30:00.000Z');
    const row = toEventRow(
      {
        type: ANALYTICS_EVENT.AI_TOKENS,
        orgId: 9,
        occurredAt: at,
        tokens: 1200,
        amountMinor: 15,
        durationMs: 800,
        qty: 2,
        campaignId: 44,
      },
      7,
      NOW,
    );
    expect(row).toMatchObject({
      orgId: 9,
      occurredAt: at,
      tokens: 1200,
      amountMinor: 15,
      durationMs: 800,
      qty: 2,
      campaignId: 44,
    });
  });

  it('leaves dimensions that were not given out of the row', () => {
    const row = toEventRow({ type: ANALYTICS_EVENT.MSG_SENT }, 7, NOW);
    expect(row.campaignId).toBeUndefined();
    expect(row.contactId).toBeUndefined();
  });

  it('rejects an id that is not an integer instead of storing a rounded value', () => {
    expect(() => toEventRow({ type: 1, contactId: 1.5 }, 7, NOW)).toThrow(/must be an integer/);
    expect(() => toEventRow({ type: 1, campaignId: Number.NaN }, 7, NOW)).toThrow(
      /must be an integer/,
    );
  });

  it('rejects props that look like personal data', () => {
    expect(() => toEventRow({ type: 1, props: { phone: '123' } }, 7, NOW)).toThrow(/personal data/);
  });
});
