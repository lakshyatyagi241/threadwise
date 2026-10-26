import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { paygwOrderKindSchema } from '@crm/contracts';
import { AddonPackService } from '../../../src/modules/addons-extension-registry/addon-pack.service';

/**
 * The wallet stays separate: a top-up is an ORDER of kind `wallet_topup` with no plan row behind it, so it can never be a pack in the
 * workspace add-on list or in the operator's add-on form. The operator list reads only plans of kind `addon` that sell no Marketplace app,
 * and the workspace list (see addon-ownership.spec.ts) the same.
 */
describe('wallet top-ups are never add-ons', () => {
  it('is its own order kind, next to (not inside) the add-on kind', () => {
    const kinds = paygwOrderKindSchema.options;
    expect(kinds).toContain('wallet_topup');
    expect(kinds).toContain('addon');
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('the operator add-on list selects only add-on plans (kind = addon, no Marketplace app)', async () => {
    const seen: string[] = [];
    const platform = {
      tx: async (fn: (t: unknown) => unknown) =>
        fn({
          execute: async (q: unknown) => {
            seen.push(new PgDialect().sqlToQuery(q as never).sql);
            return { rows: [] };
          },
        }),
    };
    const svc = new AddonPackService(platform as never, {} as never, {} as never);
    const out = await svc.list();
    expect(out.data).toEqual([]);
    // the packs, then how every plan offers them (plain packs only on both sides)
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("p.kind = 'addon'");
    expect(seen[0]).toContain('p.marketplace_app_id IS NULL');
    expect(seen[1]).toContain("ap.kind = 'addon' AND ap.marketplace_app_id IS NULL");
    expect(seen.join(' ')).not.toMatch(/wallet/i);
  });
});
