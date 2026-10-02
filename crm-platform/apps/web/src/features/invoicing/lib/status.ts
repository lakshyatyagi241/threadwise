import { INVOICE_STATUSES, type InvoiceCountsResponse, type InvoiceStatus } from '@crm/contracts';

/**
 * Invoice status. The server derives it (draft, issued, partially_paid, overdue, paid, void: `deriveInvoiceStatus` in the
 * contracts) from the stored status, the payment ledger and the due date in the workspace calendar, and sends it on every row
 * with the tab counts computed the same way, so a chip, a tab count and a filter always agree. The screens never re-derive it.
 */
export type DisplayStatus = InvoiceStatus;

/** The order the tabs and filters show them in (the contracts list `issued` before `partially_paid` too). */
export const DISPLAY_STATUSES: readonly DisplayStatus[] = [
  'draft',
  'issued',
  'partially_paid',
  'overdue',
  'paid',
  'void',
];
export const TABS = ['all', ...DISPLAY_STATUSES] as const;
export type InvoiceTab = (typeof TABS)[number];

/** The count a tab shows, from `GET /invoices/counts` (which names `partiallyPaid` in camel case). */
export function tabCount(counts: InvoiceCountsResponse | undefined, tab: InvoiceTab): number | undefined {
  if (!counts) return undefined;
  return tab === 'partially_paid' ? counts.partiallyPaid : counts[tab];
}

/** Every status the contracts know is a tab (a status added to the API without a tab fails this in a test). */
export const TABS_COVER_STATUSES = INVOICE_STATUSES.every((s) => (DISPLAY_STATUSES as readonly string[]).includes(s));

export type InvoiceAction =
  | 'view'
  | 'edit'
  | 'issue'
  | 'send'
  | 'copyLink'
  | 'recordPayment'
  | 'markPaid'
  | 'void'
  | 'duplicate'
  | 'delete'
  | 'download'
  | 'print'
  | 'creditNote';

export interface ActionContext {
  can: {
    create: boolean;
    update: boolean;
    issue: boolean;
    void: boolean;
    remove: boolean;
    recordPayment: boolean;
    createCreditNote: boolean;
  };
}

/** What an invoice row offers, in minor units, as the screens read it. */
export interface ActionFacts {
  status: DisplayStatus;
  paidMinor: number;
  balanceMinor: number;
  creditedMinor: number;
  hasPublicLink: boolean;
}

/**
 * What an invoice offers, for the row menu, the detail bar and the bulk bar. The server answers 409 for anything else; this keeps
 * the screens from showing a button that can only fail. Voiding needs the money given back first (INV_HAS_PAYMENTS) and no
 * credit notes against it (INV_HAS_CREDITS).
 */
export function allowedActions(inv: ActionFacts, ctx: ActionContext): Set<InvoiceAction> {
  const out = new Set<InvoiceAction>(['view', 'download', 'print']);
  const { can } = ctx;
  if (can.create) out.add('duplicate');
  if (inv.status === 'draft') {
    if (can.update) out.add('edit');
    if (can.issue) out.add('issue');
    if (can.remove) out.add('delete');
    return out;
  }
  if (inv.status === 'void') return out;
  if (inv.hasPublicLink) out.add('copyLink');
  if (can.update) out.add('send');
  if (can.void && inv.paidMinor <= 0 && inv.creditedMinor <= 0) out.add('void');
  if (can.recordPayment && inv.balanceMinor > 0) {
    out.add('recordPayment');
    out.add('markPaid');
  }
  if (can.createCreditNote) out.add('creditNote');
  return out;
}

/** What may still be refunded of a payment (the API sends it as `refundable`, in major units). */
export const hasRefundable = (p: { kind: string; refundable: string }): boolean =>
  p.kind === 'payment' && Number(p.refundable) > 0;
