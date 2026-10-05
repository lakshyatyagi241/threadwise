import type {
  StoreOrderDetail,
  StoreOrderPayment,
  StoreOrderTimelineEntry,
  UpdateStoreOrderStatusInput,
} from '@crm/contracts';
import { isOrderStatus } from './status';

/** Only web links can be sent to a buyer: a payment link must be http or https. */
export function isHttpUrl(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface StatusFormValues {
  status: string;
  notes: string;
  paymentLink: string;
}

export const initialStatusForm = (o: StoreOrderDetail): StatusFormValues => ({
  status: o.status,
  notes: o.notes ?? '',
  paymentLink: o.paymentLink ?? '',
});

/**
 * The PATCH body of the status form. The loaded `rowVersion` rides along so a concurrent edit is refused instead of overwritten.
 * A payment link is sent only when it was typed or changed (an unchanged link would message the buyer again); notes are sent
 * trimmed, and an emptied note is sent as null so it can be cleared. Returns null when the form is not valid yet.
 */
export function buildStatusBody(
  order: Pick<StoreOrderDetail, 'paymentLink' | 'rowVersion'>,
  form: StatusFormValues,
): UpdateStoreOrderStatusInput | null {
  if (!isOrderStatus(form.status)) return null;
  const link = form.paymentLink.trim();
  if (link && !isHttpUrl(link)) return null;
  const body: UpdateStoreOrderStatusInput = {
    status: form.status,
    notes: form.notes.trim() ? form.notes.trim() : null,
    rowVersion: order.rowVersion,
  };
  if (link && link !== (order.paymentLink ?? '').trim()) body.paymentLink = link;
  return body;
}

/** Has the operator changed anything the form can send? */
export function isStatusFormDirty(order: StoreOrderDetail, form: StatusFormValues): boolean {
  const base = initialStatusForm(order);
  return (
    form.status !== base.status ||
    form.notes.trim() !== base.notes.trim() ||
    form.paymentLink.trim() !== base.paymentLink.trim()
  );
}

/** Newest first, as a feed reads. The sort is stable for equal times. */
export function sortTimeline(
  entries: readonly StoreOrderTimelineEntry[],
): StoreOrderTimelineEntry[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => Date.parse(b.e.at) - Date.parse(a.e.at) || a.i - b.i)
    .map((x) => x.e);
}

/** The kinds the screen has a label for (an unknown one from a newer server is shown as it came). */
export const TIMELINE_KINDS = [
  'created',
  'status_changed',
  'payment_link',
  'paid',
  'invoice',
  'note',
  'updated',
] as const;
export const TIMELINE_ACTORS = ['user', 'system', 'customer'] as const;
export const PAYMENT_KINDS = ['gateway', 'payment_link', 'whatsapp_pay', 'cod', 'manual'] as const;

export const isKnown = (list: readonly string[], v: string): boolean => list.includes(v);

const time = (iso: string | null): number => {
  const n = Date.parse(iso ?? '');
  return Number.isNaN(n) ? Number.NEGATIVE_INFINITY : n;
};

export function sortPayments(payments: readonly StoreOrderPayment[]): StoreOrderPayment[] {
  return payments
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const ta = time(a.p.at);
      const tb = time(b.p.at);
      if (ta === tb) return a.i - b.i;
      return tb > ta ? 1 : -1;
    })
    .map((x) => x.p);
}

/** The RTO band decides the colour of the risk pill. An unknown band is shown plain. */
export function rtoTone(band: string | null): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (band) {
    case 'low':
      return 'success';
    case 'medium':
      return 'warning';
    case 'high':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** The gateway to preselect in the picker: the first the order can be paid with, or '' when there is none. */
export const defaultGateway = (order: Pick<StoreOrderDetail, 'availableGateways'>): string =>
  order.availableGateways[0]?.slug ?? '';
