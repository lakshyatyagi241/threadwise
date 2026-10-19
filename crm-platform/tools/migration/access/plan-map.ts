/**
 * What a migrated workspace's plan holds, from the Waboo plan (geta_core business.subscription_data.config: a list of
 * { code, status, limit }). The plan is built CLOSED: a Threadwise feature is on only when one of the Waboo codes listed for it is on in the
 * Waboo plan, and every limit is unlimited (0) unless the Waboo plan states a number. Nothing the Waboo plan does not say is invented,
 * so the plan page shows what the old plan allowed and nothing more. Drafted 2026-10-18 from the real Pro-Whatsapp plan; please re-check.
 */

/** Threadwise plan feature -> the Waboo plan codes that give it (any one on is enough). A feature not listed here is closed. */
export const FEATURE_FROM_WABOO: Record<string, string[]> = {
  automation: ['automation_builder', 'automation_settings'],
  ai_assistants: ['smart_ai'],
  analytics: ['analytics_dashboard'],
  team_performance: ['analytics_dashboard'],
  sales_pipeline: ['deal'],
  outbound_webhooks: ['webhook'],
  marketplace: ['apps'],
  inbox_routing: ['chat_settings'],
  inbox_kanban: ['conversation_inbox'],
  scheduled_messages: ['broadcast', 'whatsapp_broadcast'],
  form_builder: ['forms'],
  forms_and_links: ['forms', 'application_forms'],
  extra_channels: ['channels'],
  sms: ['sms_broadcast'],
  email_channel: ['email_broadcast'],
};

/** Threadwise limit -> the Waboo plan code whose `limit` it takes. A Waboo limit that is absent or Infinity leaves the limit unlimited. */
export const LIMIT_FROM_WABOO: Record<string, string> = {
  users: 'user_limit',
  segments: 'segments',
  monthly_messages: 'monthly_conversation_limit',
};

/** Limits that do not mean "unlimited" at 0 (0 = the platform default): they keep the base plan's value. */
export const LIMITS_KEPT_FROM_BASE: ReadonlySet<string> = new Set(['api_rate_limit_per_minute']);
