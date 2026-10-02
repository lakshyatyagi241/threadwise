import { describe, expect, it } from 'vitest';
import type { BoardResponse } from '@crm/contracts';
import { mapBoard, pickTotal, toMinorUnits } from './mappers';

describe('wire money to minor units', () => {
  it('reads decimal strings by currency', () => {
    expect(toMinorUnits('100.50', 'USD')).toBe(10050);
    expect(toMinorUnits('500', 'JPY')).toBe(500);
    expect(toMinorUnits('1.234', 'KWD')).toBe(1234);
    expect(toMinorUnits('garbage', 'USD')).toBe(0);
  });

  it('prefers the converted total, else the entry in the wanted currency, else zero', () => {
    const byCurrency = [
      { currency: 'INR', amount: '33876.00' },
      { currency: 'USD', amount: '120.50' },
    ];
    expect(
      pickTotal({ byCurrency, converted: { currency: 'INR', amount: '40000.00' } }, 'INR'),
    ).toBe(4_000_000);
    // a missing exchange rate leaves converted null: only the pipeline's own currency counts
    expect(pickTotal({ byCurrency, converted: null, unconverted: ['USD'] }, 'INR')).toBe(3_387_600);
    expect(pickTotal({ byCurrency }, 'EUR')).toBe(0);
    expect(pickTotal({ byCurrency: [] }, 'USD')).toBe(0);
    expect(pickTotal(undefined, 'USD')).toBe(0);
  });
});

describe('the board names the currencies it could not convert', () => {
  const totals = (unconverted?: string[]) => ({
    byCurrency: [
      { currency: 'INR', amount: '100.00' },
      { currency: 'USD', amount: '5.00' },
    ],
    converted: null,
    unconverted,
  });
  const empty = { byCurrency: [] };
  const column = (id: string, unconverted?: string[]) => ({
    stage: { id, name: id, color: '#000000', probability: 10, kind: 'open' as const, sortOrder: 0 },
    count: 1,
    total: totals(unconverted),
    weighted: empty,
    deals: [],
    page: { nextCursor: null, hasMore: false, limit: 25 },
  });

  it('collects each missing-rate currency once, so the screen can say those deals are left out', () => {
    const board = mapBoard({
      pipeline: { id: 'p1', name: 'Sales', currency: 'INR', isDefault: true },
      stages: [column('a', ['USD']), column('b', ['USD', 'EUR'])],
      kpis: {
        openCount: 2,
        openValue: empty,
        forecast: empty,
        wonThisMonthCount: 0,
        wonThisMonthValue: empty,
        winRate: 0,
      },
    } as unknown as BoardResponse);
    expect([...board.unconverted].sort()).toEqual(['EUR', 'USD']);
    // the column total counts the pipeline's own currency only (never a guess at the missing rate)
    expect(board.columns[0]?.summary.valueMinor).toBe(10_000);
  });
});
