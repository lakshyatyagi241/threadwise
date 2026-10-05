/**
 * Every queue in the system, in one place.
 *
 * Queues are split by failure domain, not by convenience: a stuck WhatsApp
 * provider must not delay wallet postings, and a slow LLM call must not hold
 * up delivery-receipt ingestion.
 */
export const QUEUES = {
  /** Drains event_outbox and fans events out to workflows/automations. */
  OUTBOX: 'outbox',
  /** Throttled campaign sending — rate limited per campaign (throttle_per_min). */
  CAMPAIGN: 'campaign',
  /** Single outbound message dispatch to a channel provider. */
  MESSAGE_DISPATCH: 'message-dispatch',
  /** Inbound webhooks (delivery receipts, inbound messages) — ack fast, process here. */
  WEBHOOK_INGEST: 'webhook-ingest',
  /** Rolls unposted usage_charges into one wallet transaction per org (~60s). */
  BILLING_POSTING: 'billing-posting',
  /** SLA due-date sweeper — marks breaches, emits escalation events. */
  SLA_SWEEP: 'sla-sweep',
  /** Flushes in-memory metric counters to metric_counters (2–5s). */
  COUNTER_FLUSH: 'counter-flush',
  /** Creates next month's partitions well ahead of time. */
  PARTITION_MAINTENANCE: 'partition-maintenance',
  /** Bulk import/export jobs — long-running, off the OLTP path. */
  BULK_JOBS: 'bulk-jobs',
  /** Contact CSV imports above the synchronous size (WD-CON-027). Own queue: a huge file must not delay another bulk job. */
  CON_IMPORT: 'con-import',
  /** One job per broadcast: sends its pending recipients (WD-BCAST-016). Own queue so a slow provider cannot hold campaigns. */
  BCAST_DISPATCH: 'bcast-dispatch',
  /** WhatsApp Cloud API / Interakt webhook payloads (messages, receipts, template and account events). Acked first, processed here. */
  WABA_INGEST: 'waba-ingest',
  /** One job per Telegram broadcast run: sends its pending chats at a pace under Telegram's limits (WD-TG-013). */
  TG_BROADCAST: 'tg-broadcast',
  /** One job per connected Facebook Page: imports its existing Messenger threads, storing only (WD-FB-010). */
  FB_BACKFILL: 'fb-backfill',
  /** One job per Messenger broadcast run: sends its pending recipients at a pace under Meta's limits (WD-FB-013). */
  FB_BROADCAST: 'fb-broadcast',
  /** One job per organization with a linked Instagram account: pulls its new conversations and messages from the engine (WD-IG-009). */
  IG_PULL: 'ig-pull',
  /** One job per connected store: imports its products, orders and customers into the mirror (WD-ECOM-011). */
  ECOM_IMPORT: 'ecom-import',
  /** One job per verified store webhook: the event message, the order-status automation and the mirror upkeep (WD-ECOM-008, 010, 027). */
  ECOM_WEBHOOK: 'ecom-webhook',
  /** One job per run of a scheduled message (WD-NODE-030, 031): sends its pending recipients with the pacing rules. Own queue so a long run cannot hold a broadcast. */
  SCHED_RUN: 'sched-run',
  /** Segment actions over more members than fit in a request (add a segment's contacts to a group, in chunks). Own queue: a huge segment must not delay an import. */
  SEGMENT_ACTIONS: 'segment-actions',
  /** Copies a customer's WhatsApp file from the provider into the media store: downloads can be large and slow, and a provider outage must not hold message ingest. */
  MEDIA_FETCH: 'media-fetch',
  /** One job per step of a flow run (WD-FLR-015, 016): the node to run next, a Delay waking, a halted run trying again. Own queue so a long flow cannot hold a send. */
  FLOW_RUN: 'flow-run',
  /** Re-reads WhatsApp templates stuck PENDING on Meta (WD-TPL-027). Own queue: a Meta outage must not hold anything else. */
  TPL_SWEEP: 'tpl-sweep',
  /** One job per due pull connection of the Marketplace (M-05): fetches the portal's new leads and hands them to the lead pipeline. Own queue: a slow portal must not hold a lead from another door. */
  MKT_PULL: 'mkt-pull',
  /** One job per delivery a portal pushed to a Marketplace connection that answers at once: maps it and hands the leads to the pipeline, retrying from the stored copy. Own queue: a slow pipeline must not hold a poll. */
  MKT_INBOUND: 'mkt-inbound',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Default job options.
 *
 * `removeOnComplete` is bounded rather than `true`: keeping the last few
 * thousand completions is what makes "did that campaign actually send?"
 * answerable at 2am, without letting Redis grow without limit.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { count: 5_000, age: 24 * 3600 },
  removeOnFail: { count: 20_000, age: 7 * 24 * 3600 },
};
