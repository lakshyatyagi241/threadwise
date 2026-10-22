import { describe, expect, it } from 'vitest';
import { NAV } from './nav.generated';

describe('sales plan gates (BL-380, gap 17)', () => {
  it('locks the Deals entry with the plan feature the API checks, and keeps it in the menu', () => {
    const deals = NAV.find((n) => n.id === 'deals');
    expect(deals?.gates?.permission).toBe('record.deals.read');
    expect(deals?.gates?.planFeature).toBe('sales_pipeline');
    // Locked means paywalled, not hidden: the entry is still drawn so the plan can be upsold.
    expect(deals?.inMenu).not.toBe(false);
  });

  it('gates Deals the way the entries beside it are gated (Companies, CRM dashboard)', () => {
    for (const id of ['companies', 'crm-dashboard']) {
      expect(NAV.find((n) => n.id === id)?.gates?.planFeature, id).toBe('sales_pipeline');
    }
  });

  it('leaves Tasks without the sales gate: the tasks API does not check sales_pipeline', () => {
    const tasks = NAV.find((n) => n.id === 'tasks');
    expect(tasks?.gates?.planFeature).toBeUndefined();
  });
});
