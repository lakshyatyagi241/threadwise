import { describe, expect, it } from 'vitest';
import {
  createDealSchema,
  dealReportsQuerySchema,
  isRealCalendarDate,
  updateDealSchema,
} from '@crm/contracts';

/**
 * Parity run (WD-DEAL-009, 011): `expected_close_date` is a calendar day. A string such as 2026-02-31 matches the YYYY-MM-DD
 * shape but is not a day, and used to reach the database, which refused it with a 500. It is a 422 at the contract now.
 */
describe('deal calendar dates', () => {
  it.each([
    ['2026-02-31', false],
    ['2026-13-01', false],
    ['2026-00-10', false],
    ['2026-04-31', false],
    ['2025-02-29', false],
    ['2026-02-28', true],
    ['2028-02-29', true],
    ['2026-12-31', true],
  ])('%s is a real day: %s', (value, ok) => {
    expect(isRealCalendarDate(value)).toBe(ok);
  });

  it('rejects an impossible expected close date on create and on update', () => {
    expect(
      createDealSchema.safeParse({ title: 'A', expectedCloseDate: '2026-02-31' }).success,
    ).toBe(false);
    expect(
      updateDealSchema.safeParse({ expectedCloseDate: '2026-02-31', rowVersion: 1 }).success,
    ).toBe(false);
    expect(
      createDealSchema.safeParse({ title: 'A', expectedCloseDate: '2026-02-28' }).success,
    ).toBe(true);
    expect(createDealSchema.safeParse({ title: 'A', expectedCloseDate: null }).success).toBe(true);
  });

  it('rejects an impossible report range date', () => {
    expect(dealReportsQuerySchema.safeParse({ from: '2026-02-30' }).success).toBe(false);
    expect(dealReportsQuerySchema.safeParse({ from: '2026-02-01', to: '2026-02-28' }).success).toBe(
      true,
    );
  });
});
