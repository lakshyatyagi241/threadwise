/** The quote events that notify someone: a decision made by the buyer on the public page (WD-PROP-017). */
export const SALESDOC_NOTIFY_EVENTS = ['salesdoc.accepted', 'salesdoc.declined'] as const;
export type SalesDocNotifyEvent = (typeof SALESDOC_NOTIFY_EVENTS)[number];

/** WaDesk named it `sales_doc_decided`; one type for both outcomes, the outcome is in `data.status`. */
export const SALESDOC_NOTIFICATION_TYPE = 'sales_doc_decided';

/** What the outbox event says (ids are the uuids its payload carries), reduced to what the rules need. */
export interface SalesDocEventFacts {
  eventType: SalesDocNotifyEvent;
  docUuid: string;
  kind: 'proposal' | 'estimate';
  number: string;
  /** Who recorded the decision: the buyer on the public page, or staff on the buyer's behalf. */
  by: string | null;
  ownerUuid: string | null;
  createdByUuid: string | null;
}

/**
 * Who is told: the document's owner and its creator, once each (WaDesk: the owner and the creator, de-duplicated). Only the buyer's
 * own decision notifies; a staff member recording an acceptance or a decline already knows (WaDesk did not notify for those either).
 */
export function recipientsFor(f: SalesDocEventFacts): string[] {
  if (f.by !== 'buyer') return [];
  return [...new Set([f.ownerUuid, f.createdByUuid].filter((v): v is string => !!v))];
}

const kindWord = (k: SalesDocEventFacts['kind']): string =>
  k === 'estimate' ? 'Estimate' : 'Proposal';

/** Plain text, at most `max` characters. */
const clip = (value: string, max: number): string => {
  const text = value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** The server's English wording, stored as the fallback a client shows for a type it has no message for. */
export function copyFor(
  f: SalesDocEventFacts,
  title: string | null,
): { title: string; body: string } {
  const outcome = f.eventType === 'salesdoc.accepted' ? 'accepted' : 'declined';
  const name = title ? `${f.number} ${clip(title, 120)}` : f.number;
  return {
    title: `${kindWord(f.kind)} ${outcome}`,
    body: clip(`${name}: the buyer ${outcome} it`, 200),
  };
}

/** The document's own page (WaDesk linked the list). */
export const linkFor = (f: SalesDocEventFacts): string =>
  `/${f.kind === 'estimate' ? 'estimates' : 'proposals'}/${f.docUuid}`;

/** One key per event and person: a redelivery of the same event collides, a later real decision does not. */
export const dedupeKeyFor = (eventType: string, eventId: string): string =>
  `${eventType}:${eventId}`;
