import { describe, expect, it } from 'vitest';
import { checkAddonRules, createAddonRequestSchema } from '@crm/contracts';

const pack = {
  name: 'Extra seat',
  amount: '499',
  currency: 'INR',
  billingUnit: 'months' as const,
  billingDuration: 1,
};

describe('add-on billing mode', () => {
  it('a new priced pack defaults to recurring; lifetime and zero-priced shapes of an older client stay one-time', () => {
    expect(createAddonRequestSchema.parse(pack).billingMode).toBe('recurring');
    expect(createAddonRequestSchema.parse({ ...pack, isLifetime: true }).billingMode).toBe(
      'one_time',
    );
    expect(createAddonRequestSchema.parse({ ...pack, amount: '0' }).billingMode).toBe('one_time');
    expect(createAddonRequestSchema.parse({ ...pack, billingMode: 'one_time' }).billingMode).toBe(
      'one_time',
    );
  });

  it('accepts a recurring pack', () => {
    expect(createAddonRequestSchema.parse({ ...pack, billingMode: 'recurring' }).billingMode).toBe(
      'recurring',
    );
  });

  it('refuses recurring for a lifetime or a free pack', () => {
    expect(
      createAddonRequestSchema.safeParse({ ...pack, billingMode: 'recurring', isLifetime: true })
        .success,
    ).toBe(false);
    expect(
      createAddonRequestSchema.safeParse({ ...pack, amount: '0', billingMode: 'recurring' })
        .success,
    ).toBe(false);
    expect(checkAddonRules({ amount: '0', offerAmount: null, billingMode: 'recurring' })).toEqual([
      { path: 'billingMode', message: 'A free or lifetime add-on cannot renew automatically.' },
    ]);
  });

  it('rejects an unknown mode', () => {
    expect(createAddonRequestSchema.safeParse({ ...pack, billingMode: 'weekly' }).success).toBe(
      false,
    );
  });
});
