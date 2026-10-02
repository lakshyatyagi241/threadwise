import type { SalesDocActions } from '@crm/contracts';

/**
 * Statuses and what may be done in each. The server is the authority (it answers 409 SALESDOC_INVALID_TRANSITION and sends
 * `actions` with every document); this module mirrors its machine so the list's row menu, which only has the summary, offers
 * exactly what the server accepts, and so a person is not shown a button that can only fail. `status.test.ts` pins the table.
 *
 * The machine (sales-doc-rules.ts in the API):
 *   draft    -> send (sent), accept, decline, edit, delete
 *   sent     -> send again, accept, decline, expire, revise (back to draft), extend
 *   viewed   -> the same as sent (set by the buyer's first visit, never by hand)
 *   accepted -> convert to an invoice only (evidence: never edited, never deleted)
 *   declined -> revise
 *   expired  -> revise, extend (the document is open again)
 *   converted-> nothing
 */
export const STATUSES = [
  'draft',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'expired',
  'converted',
] as const;
export type DocStatus = (typeof STATUSES)[number];

export const TABS = ['all', ...STATUSES] as const;
export type DocTab = (typeof TABS)[number];

const WIRE_ALIASES: Record<string, DocStatus> = { rejected: 'declined', invoiced: 'converted' };

/** A wire status as a screen status; anything unknown is shown as a draft (safe: only editing is offered). */
export function normalizeStatus(wire: string): DocStatus {
  const s = wire.toLowerCase();
  if ((STATUSES as readonly string[]).includes(s)) return s as DocStatus;
  return WIRE_ALIASES[s] ?? 'draft';
}

/** `YYYY-MM-DD` of an instant on the calendar of `timeZone` (the viewer's zone when absent). */
export function todayKey(now: Date, timeZone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return timeZone ? todayKey(now) : now.toISOString().slice(0, 10);
  }
}

/** A document is valid through its last day: "valid until today" is still valid today. */
export const isLapsed = (validUntil: string | null | undefined, today: string): boolean =>
  !!validUntil && validUntil.slice(0, 10) < today;

/**
 * The status to show. The server sweeps lapsed documents to `expired` once a day, but an open one (sent, viewed) can lapse
 * between sweeps, so it reads as expired right away (TW-PROP-004, D-05). `overdue` is the server's own reading of the same
 * thing; either is enough. A draft never expires.
 */
export function effectiveStatus(
  doc: { status: DocStatus; validUntil: string | null; overdue?: boolean },
  today: string,
): DocStatus {
  if (
    (doc.status === 'sent' || doc.status === 'viewed') &&
    (doc.overdue || isLapsed(doc.validUntil, today))
  ) {
    return 'expired';
  }
  return doc.status;
}

/**
 * The status-changing actions the buttons name. `accept` and `decline` are staff recording the buyer's answer (a signed copy,
 * a phone call); the buyer's own decision comes through the public page. `revise` takes a document back to a draft (revision
 * + 1); `extend` gives it a new valid-until date and reopens an expired one.
 */
export type DocAction =
  | 'edit'
  | 'send'
  | 'markSent'
  | 'accept'
  | 'decline'
  | 'revise'
  | 'extend'
  | 'convertInvoice'
  | 'createSalesOrder'
  | 'convertDeal'
  | 'duplicate'
  | 'delete'
  | 'print'
  | 'copyLink'
  | 'activity';

/** What the buyer may do on the public page: decide only while the document is out (the server also checks the date). */
export function buyerCanDecide(status: DocStatus): boolean {
  return status === 'sent' || status === 'viewed';
}

/** The server's machine, as the actions a status allows (mirrors `actionsOf`). */
export function serverActions(status: DocStatus, hasDeal: boolean): SalesDocActions {
  const open = status === 'sent' || status === 'viewed';
  return {
    edit: status === 'draft',
    send: status === 'draft' || open,
    decide: status === 'draft' || open,
    revise: open || status === 'declined' || status === 'expired',
    extend: open || status === 'expired',
    convertInvoice: status === 'accepted',
    convertDeal: !hasDeal,
    delete: status !== 'accepted' && status !== 'converted',
  };
}

export interface ActionContext {
  /** What the signed-in person may do (from their permissions). */
  can: {
    update: boolean;
    create: boolean;
    delete: boolean;
    send: boolean;
    convert: boolean;
    order?: boolean;
  };
  /** The document already has a deal linked, so "create deal" would duplicate it. */
  hasDeal: boolean;
  /** Draft with nothing to send yet (no line). */
  empty?: boolean;
  /** The server's own answer for this document (the document page has it): wins over the status table. */
  server?: SalesDocActions;
}

/** The actions a document offers, for the row menu, the document bar and the keyboard. */
export function allowedActions(status: DocStatus, ctx: ActionContext): Set<DocAction> {
  const a = ctx.server ?? serverActions(status, ctx.hasDeal);
  const { can } = ctx;
  const out = new Set<DocAction>(['print', 'activity']);
  if (can.create) out.add('duplicate');
  if (can.send && status !== 'converted') out.add('copyLink');
  if (can.update) {
    if (a.edit) out.add('edit');
    if (a.decide) {
      out.add('accept');
      out.add('decline');
    }
    if (a.revise) out.add('revise');
    if (a.extend) out.add('extend');
  }
  if (can.send && a.send && !ctx.empty) {
    out.add('send');
    // Marking a draft as sent (the link was shared by hand) is the send dialog's "link" channel; it has its own menu entry.
    if (status === 'draft') out.add('markSent');
  }
  if (can.convert) {
    if (a.convertInvoice) out.add('convertInvoice');
    if (a.convertDeal) out.add('convertDeal');
  }
  // An accepted offer can become a sales order (the order screen checks again and the server refuses anything else).
  if (can.order && status === 'accepted') out.add('createSalesOrder');
  if (can.delete && a.delete) out.add('delete');
  return out;
}

/** Statuses that count as "open value": waiting for a decision, or decided but not yet invoiced. */
export const OPEN_VALUE_STATUSES: readonly DocStatus[] = ['sent', 'viewed', 'accepted'];
