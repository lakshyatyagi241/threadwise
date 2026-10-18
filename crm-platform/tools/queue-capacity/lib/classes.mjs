// Workload class of every queue (QCAP-003, 010). Wait SLOs are the planning targets of the capacity standard, not measured values.
// kind: io | cpu | db | provider. A queue missing here is classed "unclassified" and fails `inventory.mjs --check` through the unit test.
const C = (cls, priority, waitSloMsP95, workload, kind, dependency) => ({ class: cls, priority, waitSloMsP95, workload, kind, dependency });
const CRIT = (w, k, d) => C('critical-inbound', 'P0', 100, w, k, d);
const INTER = (w, k, d) => C('interactive', 'P1', 250, w, k, d);
const AUTO = (w, k, d) => C('automation', 'P1', 1000, w, k, d);
const BULK = (w, k, d) => C('bulk', 'P2', 5000, w, k, d);
const MAINT = (w, k, d) => C('maintenance', 'P3', 60000, w, k, d);

export const CLASSES = {
  WABA_INGEST: CRIT('whatsapp-webhooks', 'db', 'postgres'),
  WEBHOOK_INGEST: CRIT('inbox-ingest', 'db', 'postgres'),
  WEBHOOK_RETRY: CRIT('inbound-retry', 'db', 'postgres'),
  TELEPHONY_INGEST: CRIT('call-logging', 'db', 'postgres'),
  MESSAGE_DISPATCH: INTER('outbound-one-to-one', 'provider', 'channel-providers'),
  WEB_PUSH: INTER('notifications', 'provider', 'push-services'),
  MEDIA_FETCH: INTER('inbox-media', 'provider', 'meta,media-store'),
  FLOW_RUN: AUTO('automations', 'db', 'postgres'),
  OUTBOX: AUTO('event-fanout', 'db', 'postgres'),
  ECOM_WEBHOOK: AUTO('ecommerce-webhooks', 'db', 'postgres,store-apis'),
  META_LEADGEN: AUTO('lead-ads', 'provider', 'meta'),
  MKT_INBOUND: AUTO('marketplace-inbound', 'db', 'postgres'),
  LEAD_SYNC: AUTO('lead-sync', 'provider', 'crm-integrations'),
  LSC_SCORE: AUTO('ai-lead-scoring', 'provider', 'openrouter'),
  WEBHOOK_DELIVER: AUTO('customer-webhooks', 'provider', 'customer-endpoints'),
  WEBHOOK_FORWARD: AUTO('webhook-forward', 'provider', 'platform-targets'),
  BILLING_POSTING: C('critical-inbound', 'P0', 1000, 'billing-usage', 'db', 'postgres'),
  CAMPAIGN: BULK('campaign-send', 'provider', 'channel-providers'),
  BCAST_DISPATCH: BULK('broadcast-recipients', 'provider', 'meta'),
  SCHED_RUN: BULK('scheduled-campaigns', 'provider', 'channel-providers'),
  TG_BROADCAST: BULK('telegram-broadcast', 'provider', 'telegram'),
  LINE_BROADCAST: BULK('line-broadcast', 'provider', 'line'),
  VIBER_BROADCAST: BULK('viber-broadcast', 'provider', 'viber'),
  FB_BROADCAST: BULK('messenger-broadcast', 'provider', 'meta'),
  WECHAT_BROADCAST: BULK('wechat-broadcast', 'provider', 'wechat'),
  BULK_JOBS: BULK('bulk-import-export', 'db', 'postgres'),
  CON_IMPORT: BULK('contacts-import', 'db', 'postgres'),
  SEGMENT_ACTIONS: BULK('segment-actions', 'db', 'postgres'),
  ECOM_IMPORT: BULK('store-import', 'provider', 'store-apis,postgres'),
  FB_BACKFILL: BULK('messenger-backfill', 'provider', 'meta'),
  IG_PULL: BULK('instagram-pull', 'provider', 'engine'),
  MKT_PULL: BULK('marketplace-pull', 'provider', 'marketplaces'),
  MAIL_SYNC: BULK('email-sync', 'provider', 'mail-providers'),
  WAB_MIGRATE: BULK('migration-run', 'db', 'postgres'),
  PINNACLE_CREDIT_LINE: MAINT('credit-line', 'provider', 'pinnacle,meta'),
  SLA_SWEEP: MAINT('sla-sweep', 'db', 'postgres'),
  COUNTER_FLUSH: MAINT('counter-flush', 'db', 'postgres'),
  PARTITION_MAINTENANCE: MAINT('partition-maintenance', 'db', 'postgres'),
  META_LEAD_SWEEP: MAINT('lead-ads-sweep', 'provider', 'meta'),
  TPL_SWEEP: MAINT('template-sweep', 'provider', 'meta'),
  CALLING_READINESS: MAINT('calling-readiness', 'provider', 'meta'),
  CALENDAR_RECONCILE: MAINT('calendar-reconcile', 'provider', 'google'),
  CALENDAR_BACKFILL: MAINT('calendar-backfill', 'provider', 'google'),
  MEETING_MIRROR_BACKFILL: MAINT('meeting-mirror', 'db', 'postgres'),
  CALENDAR_ICS_REFRESH: MAINT('ics-refresh', 'provider', 'ics-hosts'),
  MSG_LOG_EXPORT: MAINT('message-log-export', 'db', 'postgres,media-store'),
  CONSENT_EXPORT: MAINT('consent-export', 'db', 'postgres'),
  AUDIT_LOG_EXPORT: MAINT('audit-export', 'db', 'postgres'),
  REVENUE_EXPORT: MAINT('revenue-export', 'db', 'postgres'),
  PRIVACY_EXPORT: MAINT('privacy-export', 'cpu', 'postgres,media-store'),
  STORAGE_QUOTA: MAINT('storage-accounting', 'db', 'postgres,media-store'),
};

export function classify(constant) {
  return CLASSES[constant] ?? C('unclassified', 'P?', null, 'unclassified', 'io', 'unknown');
}
