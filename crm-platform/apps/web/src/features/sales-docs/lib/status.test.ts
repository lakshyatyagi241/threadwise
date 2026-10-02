import { describe, expect, it } from 'vitest';
import {
  STATUSES,
  allowedActions,
  buyerCanDecide,
  effectiveStatus,
  isLapsed,
  normalizeStatus,
  serverActions,
  todayKey,
  type ActionContext,
  type DocAction,
  type DocStatus,
} from './status';

const everything: ActionContext = {
  can: { update: true, create: true, delete: true, send: true, convert: true },
  hasDeal: false,
};
const nothing = {
  can: { update: false, create: false, delete: false, send: false, convert: false },
  hasDeal: false,
};

describe('create sales order', () => {
  const withOrder: ActionContext = { ...everything, can: { ...everything.can, order: true } };
  it('is offered for an accepted offer to someone who may create sales orders, and for nothing else', () => {
    expect(allowedActions('accepted', withOrder).has('createSalesOrder')).toBe(true);
    expect(allowedActions('accepted', everything).has('createSalesOrder')).toBe(false);
    for (const status of STATUSES.filter((s) => s !== 'accepted')) {
      expect(allowedActions(status, withOrder).has('createSalesOrder')).toBe(false);
    }
  });
});

describe('status vocabulary', () => {
  it('knows the older WaDesk words', () => {
    expect(normalizeStatus('rejected')).toBe('declined');
    expect(normalizeStatus('invoiced')).toBe('converted');
    expect(normalizeStatus('SENT')).toBe('sent');
  });

  it('an unknown status reads as a draft, the safest thing to show', () => {
    expect(normalizeStatus('mystery')).toBe('draft');
  });

  it('round-trips every status', () => {
    for (const s of STATUSES) expect(normalizeStatus(s)).toBe(s);
  });
});

describe('expiry', () => {
  it('"valid until today" is still valid today', () => {
    expect(isLapsed('2026-10-02', '2026-10-02')).toBe(false);
    expect(isLapsed('2026-10-01', '2026-10-02')).toBe(true);
    expect(isLapsed(null, '2026-10-02')).toBe(false);
  });

  it('an open document past its date reads as expired; a draft and decided ones never do', () => {
    const past = { validUntil: '2026-09-01' };
    for (const s of ['sent', 'viewed'] as const) {
      expect(effectiveStatus({ status: s, ...past }, '2026-10-02'), s).toBe('expired');
    }
    for (const s of ['draft', 'accepted', 'declined', 'converted', 'expired'] as const) {
      expect(effectiveStatus({ status: s, ...past }, '2026-10-02'), s).toBe(s);
    }
    expect(effectiveStatus({ status: 'sent', validUntil: null }, '2026-10-02')).toBe('sent');
  });

  it("believes the server's own overdue flag even before the date test agrees", () => {
    expect(
      effectiveStatus({ status: 'viewed', validUntil: '2026-12-01', overdue: true }, '2026-10-02'),
    ).toBe('expired');
  });

  it('cuts the day in the workspace zone', () => {
    const instant = new Date('2026-10-02T22:30:00Z');
    expect(todayKey(instant, 'UTC')).toBe('2026-10-02');
    expect(todayKey(instant, 'Asia/Dubai')).toBe('2026-10-03');
  });
});

/**
 * The same table as the API's state machine (sales-doc-rules.ts `NEXT`): which of the server's actions each status allows. If
 * the API changes its machine, this table is the place the web is told.
 */
describe('the status machine, as the API has it', () => {
  const table: Record<
    DocStatus,
    Partial<
      Record<'edit' | 'send' | 'decide' | 'revise' | 'extend' | 'convertInvoice' | 'delete', true>
    >
  > = {
    draft: { edit: true, send: true, decide: true, delete: true },
    sent: { send: true, decide: true, revise: true, extend: true, delete: true },
    viewed: { send: true, decide: true, revise: true, extend: true, delete: true },
    accepted: { convertInvoice: true },
    declined: { revise: true, delete: true },
    expired: { revise: true, extend: true, delete: true },
    converted: {},
  };
  for (const status of STATUSES) {
    it(status, () => {
      const a = serverActions(status, false);
      const want = table[status];
      expect({
        edit: a.edit,
        send: a.send,
        decide: a.decide,
        revise: a.revise,
        extend: a.extend,
        convertInvoice: a.convertInvoice,
        delete: a.delete,
      }).toEqual({
        edit: want.edit ?? false,
        send: want.send ?? false,
        decide: want.decide ?? false,
        revise: want.revise ?? false,
        extend: want.extend ?? false,
        convertInvoice: want.convertInvoice ?? false,
        delete: want.delete ?? false,
      });
    });
  }

  it('a deal can be created while none is linked, in any status', () => {
    for (const s of STATUSES) {
      expect(serverActions(s, false).convertDeal, s).toBe(true);
      expect(serverActions(s, true).convertDeal, s).toBe(false);
    }
  });

  it('the buyer decides only while the document is out', () => {
    expect(STATUSES.filter(buyerCanDecide)).toEqual(['sent', 'viewed']);
  });
});

describe('allowed actions (what the menus offer)', () => {
  const has = (s: DocStatus, a: DocAction, ctx = everything) => allowedActions(s, ctx).has(a);

  it('a draft can be edited, sent, marked sent, decided, duplicated and deleted', () => {
    for (const a of [
      'edit',
      'send',
      'markSent',
      'accept',
      'decline',
      'duplicate',
      'delete',
      'copyLink',
    ] as const) {
      expect(has('draft', a), a).toBe(true);
    }
    expect(has('draft', 'convertInvoice')).toBe(false);
    expect(has('draft', 'revise')).toBe(false);
  });

  it('only a draft is editable', () => {
    for (const s of STATUSES.filter((x) => x !== 'draft')) expect(has(s, 'edit'), s).toBe(false);
  });

  it('marking as sent is for a draft only; a sent document is re-sent', () => {
    for (const s of STATUSES) expect(has(s, 'markSent'), s).toBe(s === 'draft');
    expect(has('sent', 'send')).toBe(true);
    expect(has('accepted', 'send')).toBe(false);
  });

  it('only an accepted document converts to an invoice', () => {
    for (const s of STATUSES) expect(has(s, 'convertInvoice'), s).toBe(s === 'accepted');
  });

  it('accepted and converted documents are a record: never deleted', () => {
    expect(has('accepted', 'delete')).toBe(false);
    expect(has('converted', 'delete')).toBe(false);
    expect(has('declined', 'delete')).toBe(true);
  });

  it('a converted document is locked: it can only be duplicated, printed and looked at', () => {
    expect([...allowedActions('converted', everything)].sort()).toEqual([
      'activity',
      'convertDeal',
      'duplicate',
      'print',
    ]);
  });

  it('declined and expired documents are revised; an expired one can also be extended', () => {
    expect(has('declined', 'revise')).toBe(true);
    expect(has('declined', 'extend')).toBe(false);
    expect(has('expired', 'revise')).toBe(true);
    expect(has('expired', 'extend')).toBe(true);
    expect(has('expired', 'accept')).toBe(false);
  });

  it('a deal is offered once', () => {
    expect(has('sent', 'convertDeal')).toBe(true);
    expect(has('sent', 'convertDeal', { ...everything, hasDeal: true })).toBe(false);
  });

  it('follows the person: read-only sees nothing that writes', () => {
    expect([...allowedActions('sent', nothing)].sort()).toEqual(['activity', 'print']);
  });

  it('each permission unlocks only its own actions', () => {
    const only = (key: keyof typeof everything.can) => ({
      can: { ...nothing.can, [key]: true },
      hasDeal: false,
    });
    expect(has('sent', 'send', only('send'))).toBe(true);
    expect(has('sent', 'copyLink', only('send'))).toBe(true);
    expect(has('sent', 'accept', only('send'))).toBe(false);
    expect(has('sent', 'accept', only('update'))).toBe(true);
    expect(has('sent', 'convertDeal', only('update'))).toBe(false);
    expect(has('accepted', 'convertInvoice', only('convert'))).toBe(true);
    expect(has('sent', 'delete', only('delete'))).toBe(true);
    expect(has('sent', 'duplicate', only('create'))).toBe(true);
  });

  it('an empty draft cannot be sent', () => {
    expect(allowedActions('draft', { ...everything, empty: true }).has('send')).toBe(false);
  });

  it("the server's own answer wins over the status table", () => {
    const server = { ...serverActions('sent', false), revise: false };
    expect(has('sent', 'revise')).toBe(true);
    expect(has('sent', 'revise', { ...everything, server })).toBe(false);
  });
});
