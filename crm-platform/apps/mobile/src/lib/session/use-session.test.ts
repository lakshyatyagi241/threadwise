import type { SessionResponse } from '@crm/contracts';
import { session } from '@/test/dashboard-fixtures';
import { can } from './use-session';

describe('can', () => {
  it('is true for a granted permission and false for an absent one', () => {
    expect(can(session, 'wallet.balance.read')).toBe(true);
    expect(can(session, 'billing.wallet.topup')).toBe(false);
  });

  it('is false while the session is not loaded', () => {
    expect(can(undefined, 'wallet.balance.read')).toBe(false);
  });

  it('does not confuse a permission with an inherited object property', () => {
    const plain: SessionResponse = { ...session, permissions: {} };
    expect(can(plain, 'toString')).toBe(false);
  });
});
