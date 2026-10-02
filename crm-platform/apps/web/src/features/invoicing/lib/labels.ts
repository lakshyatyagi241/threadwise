import type { InvoiceSource } from '@crm/contracts';

/**
 * The timeline event types the screens word (`invoicing.activity.events.<type>`). The contracts' `INVOICE_EVENT_TYPES` is the list
 * the API documents; it lacks `partially_paid`, which the API also writes, so it is listed here too. A type outside this list
 * is shown by its raw name instead of failing.
 */
export const TIMELINE_EVENTS = [
  'created',
  'edited',
  'issued',
  'sent',
  'viewed',
  'payment_recorded',
  'payment_refunded',
  'paid',
  'partially_paid',
  'overdue',
  'voided',
  'link_regenerated',
  'link_revoked',
  'pay_attempt',
  'credit_note_issued',
] as const;
export type TimelineEvent = (typeof TIMELINE_EVENTS)[number];
export const isTimelineEvent = (type: string): type is TimelineEvent => (TIMELINE_EVENTS as readonly string[]).includes(type);

/** Who an event is attributed to when it was not a person (`invoicing.activity.actors.<kind>`). */
export const SYSTEM_ACTORS = ['buyer', 'gateway', 'system'] as const;

/** Where an invoice came from (`invoicing.detail.sources.<source>`): every source the contracts know. */
export const SOURCE_LABELS = ['manual', 'quote', 'order', 'woocommerce', 'shopify', 'own', 'api', 'ai', 'recurring', 'sales_order'] as const satisfies readonly InvoiceSource[];
export const isKnownSource = (source: string): boolean => (SOURCE_LABELS as readonly string[]).includes(source);
