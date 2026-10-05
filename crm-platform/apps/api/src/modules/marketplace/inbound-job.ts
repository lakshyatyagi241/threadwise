/** One delivery of a portal connection waiting in the inbox (`marketplace_inbound_events`) for the worker to map and hand to the lead pipeline. */
export interface InboundJob {
  orgId: number;
  eventId: number;
}

/** The job id is the delivery, so a delivery the door queued and the sweep queued again is processed once at a time. */
export const inboundJobId = (orgId: number, eventId: number): string =>
  `mkt-inbound-${orgId}-${eventId}`;
