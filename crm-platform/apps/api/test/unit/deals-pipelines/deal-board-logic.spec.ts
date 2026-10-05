import { describe, expect, it } from 'vitest';
import { between, onTop, ORDER_STEP } from '../../../src/modules/crm/deals/deal-ordering';
import {
  monthStart,
  monthWindow,
  resolveTimezone,
  shiftMonth,
  todayIn,
} from '../../../src/modules/crm/deals/deal-calendar';
import {
  decodeStageCursor,
  encodeStageCursor,
} from '../../../src/modules/crm/deals/deals.repository';
import { normaliseLadder } from '../../../src/modules/crm/pipelines/pipelines.service';
import { DEFAULT_LADDER } from '../../../src/modules/crm/pipelines/pipelines.repository';
import { salesPipelineEnabled } from '../../../src/modules/crm/deals/deals-plan';
import type { Entitlements } from '../../../src/modules/plans-subscriptions-trials';
import { AppError } from '../../../src/common/errors/app-error';

describe('order inside a board column (TW-DEAL-007, D-07)', () => {
  it('TW-DEAL-007: a drop on top takes one step below the smallest sort_order; an empty column starts at 0', () => {
    expect(onTop(null)).toBe(0n);
    expect(onTop(-2048n)).toBe(-2048n - ORDER_STEP);
    expect(onTop(5n)).toBe(5n - ORDER_STEP);
  });

  it('TW-DEAL-007: a drop between two cards takes the midpoint, so the card stays where it was dropped', () => {
    expect(between(1024n, 3072n)).toEqual({ kind: 'value', order: 2048n });
    expect(between(0n, 3n)).toEqual({ kind: 'value', order: 1n });
  });

  it('TW-DEAL-007: a drop above the first or below the last card makes room', () => {
    expect(between(null, 0n)).toEqual({ kind: 'value', order: -ORDER_STEP });
    expect(between(2048n, null)).toEqual({ kind: 'value', order: 2048n + ORDER_STEP });
    expect(between(null, null)).toEqual({ kind: 'value', order: 0n });
  });

  it('TW-DEAL-007: neighbours with no integer between them ask for the column to be renumbered', () => {
    expect(between(5n, 6n)).toEqual({ kind: 'rebalance' });
    expect(between(5n, 5n)).toEqual({ kind: 'rebalance' });
    expect(between(5n, 7n)).toEqual({ kind: 'value', order: 6n });
  });

  it('TW-DEAL-003 #1: the per-column cursor round-trips a (sort_order, id) pair, negatives included, and rejects junk', () => {
    const c = encodeStageCursor(-3072n, 42);
    expect(decodeStageCursor(c)).toEqual([-3072n, 42]);
    expect(() => decodeStageCursor('not-a-cursor')).toThrow(AppError);
    expect(() => decodeStageCursor(Buffer.from('1|x', 'utf8').toString('base64url'))).toThrow(
      AppError,
    );
  });
});

describe('time zones and months for the reports (TW-DEAL-005, 019)', () => {
  it('TW-DEAL-019 port decision: an unknown or missing zone falls back to UTC', () => {
    expect(resolveTimezone(null)).toBe('UTC');
    expect(resolveTimezone('Mars/Olympus')).toBe('UTC');
    expect(resolveTimezone('Asia/Kolkata')).toBe('Asia/Kolkata');
  });

  it('TW-DEAL-005 #3: "this month" starts on the first of the month in the workspace zone, not the server zone', () => {
    // 2026-10-31 20:00 UTC is already 1 November in Kolkata (UTC+5:30).
    const now = new Date('2026-10-31T20:00:00Z');
    expect(todayIn('UTC', now)).toBe('2026-10-31');
    expect(todayIn('Asia/Kolkata', now)).toBe('2026-11-01');
    expect(monthStart(todayIn('Asia/Kolkata', now))).toBe('2026-11-01');
  });

  it('TW-DEAL-019 #4: the monthly trend is the last six months, oldest first, and crosses a year end', () => {
    expect(monthWindow('2026-10-17')).toEqual({
      months: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
      firstDay: '2026-05-01',
      endExclusive: '2026-11-01',
    });
    expect(monthWindow('2026-02-03').months).toEqual([
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('pipeline ladders (TW-DEAL-002, 041)', () => {
  it('TW-DEAL-002 #1: the standard ladder is New Lead 10, Qualified 25, Proposal 50, Negotiation 75, Won 100, Lost 0', () => {
    expect(DEFAULT_LADDER.map((s) => [s.name, s.probability, s.kind])).toEqual([
      ['New Lead', 10, 'open'],
      ['Qualified', 25, 'open'],
      ['Proposal', 50, 'open'],
      ['Negotiation', 75, 'open'],
      ['Won', 100, 'won'],
      ['Lost', 0, 'lost'],
    ]);
  });

  it('TW-DEAL-041: a won stage is 100% and a lost stage 0% whatever probability was sent', () => {
    const out = normaliseLadder([
      { name: 'Open', probability: 20 },
      { name: 'Closed', kind: 'won', probability: 30 },
      { name: 'Dead', kind: 'lost', probability: 90 },
    ]);
    expect(out.map((s) => s.probability)).toEqual([20, 100, 0]);
  });

  it('TW-DEAL-041: names are trimmed and compared ignoring case', () => {
    expect(normaliseLadder([{ name: ' Qualified ' }])[0]!.name).toBe('Qualified');
    expect(() => normaliseLadder([{ name: 'Qualified' }, { name: 'qualified ' }])).toThrow(
      AppError,
    );
  });

  it('TW-DEAL-041 port decision: at most one won and one lost stage', () => {
    expect(() =>
      normaliseLadder([
        { name: 'A', kind: 'won' },
        { name: 'B', kind: 'won' },
      ]),
    ).toThrow(/already has a won stage/);
    expect(() =>
      normaliseLadder([
        { name: 'A', kind: 'lost' },
        { name: 'B', kind: 'lost' },
      ]),
    ).toThrow(/already has a lost stage/);
    expect(() =>
      normaliseLadder([{ name: 'A', kind: 'won' }, { name: 'B', kind: 'lost' }, { name: 'C' }]),
    ).not.toThrow();
  });
});

describe('the sales-pipeline plan flag (TW-DEAL-001, D-01)', () => {
  const ent = (over: Partial<Entitlements> = {}): Entitlements => ({
    orgId: 1,
    planSlug: 'growth',
    planKnown: true,
    planName: 'Growth',
    trialEndsAt: null,
    planEndsAt: null,
    billingCycle: 'monthly',
    platformOwned: false,
    overrides: {},
    planLimits: {},
    planFeatures: {},
    state: 'paid_active',
    visibleApps: { all: false, appIds: new Set() },
    ...over,
  });

  it('TW-DEAL-001: a plan that carries no such key is not locked (every existing plan)', () => {
    expect(salesPipelineEnabled(ent())).toBe(true);
  });

  it('TW-DEAL-001 #1: a plan with sales_pipeline false locks the area, and an organization override can open it again', () => {
    expect(salesPipelineEnabled(ent({ planFeatures: { sales_pipeline: false } }))).toBe(false);
    expect(
      salesPipelineEnabled(
        ent({
          planFeatures: { sales_pipeline: false },
          overrides: { features: { sales_pipeline: true } },
        }),
      ),
    ).toBe(true);
    expect(salesPipelineEnabled(ent({ overrides: { features: { sales_pipeline: false } } }))).toBe(
      false,
    );
  });

  it('TW-DEAL-001: platform-owned organizations and organizations on a plan with no catalogue row are never locked out', () => {
    expect(
      salesPipelineEnabled(ent({ platformOwned: true, planFeatures: { sales_pipeline: false } })),
    ).toBe(true);
    expect(salesPipelineEnabled(ent({ planKnown: false }))).toBe(true);
    expect(salesPipelineEnabled(null)).toBe(false);
  });
});
