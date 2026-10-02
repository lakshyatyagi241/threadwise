import { INVOICE_STATUSES, deriveInvoiceStatus, type InvoiceCountsResponse } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, dueFrom, termOf, todayKey } from './dates';
import {
  DISPLAY_STATUSES,
  TABS,
  TABS_COVER_STATUSES,
  allowedActions,
  hasRefundable,
  tabCount,
  type ActionContext,
  type ActionFacts,
} from './status';

const facts = (over: Partial<ActionFacts> = {}): ActionFacts => ({
  status: 'issued',
  paidMinor: 0,
  balanceMinor: 10_000,
  creditedMinor: 0,
  hasPublicLink: true,
  ...over,
});
const everything: ActionContext['can'] = {
  create: true,
  update: true,
  issue: true,
  void: true,
  remove: true,
  recordPayment: true,
  createCreditNote: true,
};
const none: ActionContext['can'] = {
  create: false,
  update: false,
  issue: false,
  void: false,
  remove: false,
  recordPayment: false,
  createCreditNote: false,
};
const actions = (f: ActionFacts, can = everything) => allowedActions(f, { can });

describe('dates', () => {
  it('adds days across month ends and leap years', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('counts whole days between two days', () => {
    expect(daysBetween('2026-10-01', '2026-10-15')).toBe(14);
    expect(daysBetween('2026-10-15', '2026-10-01')).toBe(-14);
  });
  it('knows a standard payment term', () => {
    expect(dueFrom('2026-10-01', 30)).toBe('2026-10-31');
    expect(termOf('2026-10-01', '2026-10-31')).toBe(30);
    expect(termOf('2026-10-01', '2026-10-04')).toBeNull();
  });
  it("cuts today on the workspace calendar, not the viewer's", () => {
    const t = new Date('2026-10-15T23:30:00Z');
    expect(todayKey(t, 'Asia/Dubai')).toBe('2026-10-16');
    expect(todayKey(t, 'America/Los_Angeles')).toBe('2026-10-15');
  });
});

describe('tabs and counts', () => {
  const counts: InvoiceCountsResponse = {
    all: 22,
    draft: 7,
    issued: 3,
    partiallyPaid: 6,
    paid: 1,
    overdue: 2,
    void: 3,
    outstanding: [],
    overdueAmount: [],
  };
  it('has one tab per status, after "all"', () => {
    expect(TABS[0]).toBe('all');
    expect([...TABS].slice(1).sort()).toEqual([...INVOICE_STATUSES].sort());
    expect(TABS_COVER_STATUSES).toBe(true);
    expect([...DISPLAY_STATUSES].sort()).toEqual([...INVOICE_STATUSES].sort());
  });
  it('reads every tab from the counts, partially_paid from the camel-case key', () => {
    expect(tabCount(counts, 'all')).toBe(22);
    expect(tabCount(counts, 'partially_paid')).toBe(6);
    expect(tabCount(counts, 'overdue')).toBe(2);
    expect(tabCount(counts, 'void')).toBe(3);
  });
  it('the statuses partition the invoices, so the tabs add up to "all"', () => {
    const sum = DISPLAY_STATUSES.reduce((n, s) => n + (tabCount(counts, s) ?? 0), 0);
    expect(sum).toBe(counts.all);
  });
  it('shows no count until the server has sent them', () => {
    expect(tabCount(undefined, 'all')).toBeUndefined();
  });
});

describe('the server status the screens trust', () => {
  it('is what the contract derives (the screens never re-derive it)', () => {
    expect(
      deriveInvoiceStatus({
        status: 'issued',
        paymentStatus: 'partially_paid',
        dueDate: '2026-10-01',
        today: '2026-10-15',
      }),
    ).toBe('overdue');
    expect(
      deriveInvoiceStatus({
        status: 'issued',
        paymentStatus: 'unpaid',
        dueDate: '2026-10-15',
        today: '2026-10-15',
      }),
    ).toBe('issued');
  });
});

describe('allowedActions', () => {
  it('a draft can be edited, issued and deleted, not paid, voided or credited', () => {
    const a = actions(facts({ status: 'draft', hasPublicLink: false, balanceMinor: 0 }));
    expect([...a].sort()).toEqual([
      'delete',
      'download',
      'duplicate',
      'edit',
      'issue',
      'print',
      'view',
    ]);
  });
  it('an unpaid issued invoice offers payment, mark paid, send, link, void and a credit note, but not edit or delete', () => {
    const a = actions(facts());
    for (const k of [
      'recordPayment',
      'markPaid',
      'send',
      'copyLink',
      'void',
      'creditNote',
      'duplicate',
      'download',
    ] as const) {
      expect(a.has(k), k).toBe(true);
    }
    for (const k of ['edit', 'issue', 'delete'] as const) expect(a.has(k), k).toBe(false);
  });
  it('voiding needs the money given back and no credit notes first (INV_HAS_PAYMENTS, INV_HAS_CREDITS)', () => {
    expect(
      actions(facts({ status: 'partially_paid', paidMinor: 4_000, balanceMinor: 6_000 })).has(
        'void',
      ),
    ).toBe(false);
    expect(actions(facts({ creditedMinor: 500, balanceMinor: 9_500 })).has('void')).toBe(false);
    expect(actions(facts({ status: 'overdue' })).has('void')).toBe(true);
  });
  it('a paid invoice takes no payment but can still be credited and shared', () => {
    const a = actions(facts({ status: 'paid', paidMinor: 10_000, balanceMinor: 0 }));
    expect(a.has('recordPayment')).toBe(false);
    expect(a.has('markPaid')).toBe(false);
    expect(a.has('creditNote')).toBe(true);
    expect(a.has('copyLink')).toBe(true);
  });
  it('a void invoice only offers to look at it, print it and copy it', () => {
    expect([...actions(facts({ status: 'void', balanceMinor: 0 }))].sort()).toEqual([
      'download',
      'duplicate',
      'print',
      'view',
    ]);
  });
  it('copying the link needs a link', () => {
    expect(actions(facts({ hasPublicLink: false })).has('copyLink')).toBe(false);
  });
  it('follows the permissions of the person', () => {
    const a = actions(facts(), none);
    expect([...a].sort()).toEqual(['copyLink', 'download', 'print', 'view']);
    expect(
      actions(facts({ status: 'draft', hasPublicLink: false }), { ...none, issue: true }).has(
        'issue',
      ),
    ).toBe(true);
    expect(actions(facts(), { ...none, recordPayment: true }).has('markPaid')).toBe(true);
  });
});

describe('hasRefundable', () => {
  it('is true for a payment with something left, never for a refund or a fully refunded payment', () => {
    expect(hasRefundable({ kind: 'payment', refundable: '150.00' })).toBe(true);
    expect(hasRefundable({ kind: 'payment', refundable: '0.00' })).toBe(false);
    expect(hasRefundable({ kind: 'refund', refundable: '0.00' })).toBe(false);
  });
});
