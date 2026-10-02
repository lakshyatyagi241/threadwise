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
  /** One job per Telegram broadcast run: sends its pending chats at a pace under Telegram's limits (WD-TG-013). */
  TG_BROADCAST: 'tg-broadcast',
  /** One job per connected Facebook Page: imports its existing Messenger threads, storing only (WD-FB-010). */
  FB_BACKFILL: 'fb-backfill',
  /** One job per Messenger broadcast run: sends its pending recipients at a pace under Meta's limits (WD-FB-013). */
  FB_BROADCAST: 'fb-broadcast',
  /** Segment actions over more members than fit in a request (add a segment's contacts to a group, in chunks). Own queue: a huge segment must not delay an import. */
  SEGMENT_ACTIONS: 'segment-actions',
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
