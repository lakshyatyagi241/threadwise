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
  /** Contact CSV imports above the synchronous size (TW-CON-027). Own queue: a huge file must not delay another bulk job. */
  CON_IMPORT: 'con-import',
  /** One job per broadcast: sends its pending recipients (TW-BCAST-016). Own queue so a slow provider cannot hold campaigns. */
  BCAST_DISPATCH: 'bcast-dispatch',
  /** WhatsApp Cloud API / Interakt webhook payloads (messages, receipts, template and account events). Acked first, processed here. */
  WABA_INGEST: 'waba-ingest',
  /** One delayed job per Pinnacle client: shares the Meta credit line a few minutes after its embedded details arrive. Own queue: a slow partner must not hold WhatsApp ingest. */
  PINNACLE_CREDIT_LINE: 'pinnacle-credit-line',
  /** One job per (webhook, target): the raw Meta body POSTed unchanged to a platform-configured target. Own queue: a dead target must not delay WhatsApp ingest. */
  WEBHOOK_FORWARD: 'webhook-forward',
  /** One job per (event, workspace webhook): a signed POST to the customer's own endpoint, retried with backoff (TW-API-147). Own queue: a dead customer endpoint must not delay anything else. */
  WEBHOOK_DELIVER: 'webhook-deliver',
  /** One job per Telegram broadcast run: sends its pending chats at a pace under Telegram's limits (TW-TG-013). */
  TG_BROADCAST: 'tg-broadcast',
  /** One job per LINE broadcast run: pushes to its pending people in batches of 40, paced under LINE's rate limits. */
  LINE_BROADCAST: 'line-broadcast',
  /** One job per Viber broadcast run: sends its pending users in calls of up to 300 (TW-VIB-013). */
  VIBER_BROADCAST: 'viber-broadcast',
  /** One job per connected Facebook Page: imports its existing Messenger threads, storing only (TW-FB-010). */
  FB_BACKFILL: 'fb-backfill',
  /** One job per `leadgen` webhook event of a Facebook Page (BL-011): fetches the lead from Meta and hands it to the lead pipeline. Own queue: a slow Meta must not hold a Messenger message. */
  META_LEADGEN: 'meta-leadgen',
  /** One job per Page with Meta lead ads on: re-reads its forms' recent leads so a missed webhook never loses one (BL-011). Own queue: a long read must not hold a live lead. */
  META_LEAD_SWEEP: 'meta-lead-sweep',
  /** One job per Messenger broadcast run: sends its pending recipients at a pace under Meta's limits (TW-FB-013). */
  FB_BROADCAST: 'fb-broadcast',
  /** One job per organization with a linked Instagram account: pulls its new conversations and messages from the engine (TW-IG-009). */
  IG_PULL: 'ig-pull',
  /** One job per connected store: imports its products, orders and customers into the mirror (TW-ECOM-011). */
  ECOM_IMPORT: 'ecom-import',
  /** One job per verified store webhook: the event message, the order-status automation and the mirror upkeep (TW-ECOM-008, 010, 027). */
  ECOM_WEBHOOK: 'ecom-webhook',
  /** One job per run of a scheduled message (TW-NODE-030, 031): sends its pending recipients with the pacing rules. Own queue so a long run cannot hold a broadcast. */
  SCHED_RUN: 'sched-run',
  /** Segment actions over more members than fit in a request (add a segment's contacts to a group, in chunks). Own queue: a huge segment must not delay an import. */
  SEGMENT_ACTIONS: 'segment-actions',
  /** Copies a customer's WhatsApp file from the provider into the media store: downloads can be large and slow, and a provider outage must not hold message ingest. */
  MEDIA_FETCH: 'media-fetch',
  /** One job per step of a flow run (TW-FLR-015, 016): the node to run next, a Delay waking, a halted run trying again. Own queue so a long flow cannot hold a send. */
  FLOW_RUN: 'flow-run',
  /** Re-reads WhatsApp templates stuck PENDING on Meta (TW-TPL-027). Own queue: a Meta outage must not hold anything else. */
  TPL_SWEEP: 'tpl-sweep',
  /** One job per due pull connection of the Marketplace (M-05): fetches the portal's new leads and hands them to the lead pipeline. Own queue: a slow portal must not hold a lead from another door. */
  MKT_PULL: 'mkt-pull',
  /** One job per delivery a portal pushed to a Marketplace connection that answers at once: maps it and hands the leads to the pipeline, retrying from the stored copy. Own queue: a slow pipeline must not hold a poll. */
  MKT_INBOUND: 'mkt-inbound',
  /** One job per bell row that may deserve a browser (Web Push) notification (BL-097). Own queue: a slow push service must not hold the outbox consumers or any other job. */
  WEB_PUSH: 'web-push',
  /** One job per connected Gmail mailbox (TW-MAIL-021): reads what arrived since the last sync and stores it in the inbox. Own queue: a slow Google must not hold any other job. */
  MAIL_SYNC: 'mail-sync',
  /** One job per requested export of the message delivery log: reads up to a year of events (live and archived) into a CSV and mails the requester. Own queue: a year-long export must not hold a send or a receipt. */
  MSG_LOG_EXPORT: 'msg-log-export',
  /** One job per contact to score with AI (LSC): the vendor call and the score write. Own queue: a slow AI vendor must not hold any other job. */
  LSC_SCORE: 'lsc-score',
  /** One job per requested export of the consent proof above the direct download's 50,000 rows: reads the ledger into a CSV and mails the requester. Own queue: a large export must not hold a send or a receipt. */
  CONSENT_EXPORT: 'consent-export',
  /** One job per requested export of the tenant audit log: reads the filtered window into a masked CSV and mails the requester. Own queue: a year of audit rows must not hold a send or a receipt. */
  AUDIT_LOG_EXPORT: 'audit-log-export',
  /** One job per requested file of the revenue report (CSV or PDF): reads the payments of the window or renders the report and mails the requester. Own queue: a year of payments must not hold a send or a receipt. */
  REVENUE_EXPORT: 'revenue-report-export',
  /** One job per Waboo -> WaDesk migration run started from the operator panel. Own queue: a run lasts up to an hour and must hold nothing else. */
  /** One job per requested export of a data-subject request: reads everything the workspace holds about one person into a ZIP kept 7 days. Own queue: a heavy subject must not hold a send or a receipt. */
  PRIVACY_EXPORT: 'privacy-export',
  WAB_MIGRATE: 'wab-migrate',
  /** One job per WhatsApp number to check for calling readiness (EXT-CALL-007): after a connect and on a schedule. Own queue: a slow Meta must not hold WhatsApp ingest. */
  CALLING_READINESS: 'calling-readiness',
  /** One job per workspace whose upcoming appointments are compared with their Google events (TW-GACC-011). Own queue: a slow Google must not hold a booking message. */
  CALENDAR_RECONCILE: 'calendar-reconcile',
  /** One job per workspace that just (re)connected a calendar or changed where bookings go: writes the events its upcoming bookings are missing (BL-035). Own queue: a slow calendar must not hold a booking message. */
  CALENDAR_BACKFILL: 'calendar-backfill',
  /** One job per iCal feed that is due: reads the subscribed calendar's busy time (BL-035). Own queue: somebody else's slow server must not hold a booking message. */
  CALENDAR_ICS_REFRESH: 'calendar-ics-refresh',
  /** One job per WeChat broadcast: makes its one mass-send call (all followers, a tag or the picked OpenIDs) and ends it done or failed (WECH). */
  WECHAT_BROADCAST: 'wechat-broadcast',
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
