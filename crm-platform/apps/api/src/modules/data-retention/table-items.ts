import type { RetentionItemId } from '@crm/contracts';

/**
 * The plain-table retention items: which table the nightly job deletes from, which column holds the row's age, and an extra condition
 * when one table serves two items (the bell feed: read and unread rows). The names are constants chosen here, never from input, so
 * they are safe to put into a statement with `sql.raw`. The delete statements themselves stay with the module that owns the table;
 * this map exists only so the dashboard can size an item and count what the next run would delete.
 */
export interface TableItem {
  table: string;
  /** Timestamp column the age is read from. */
  at: string;
  /** Extra condition, without `WHERE`. */
  where?: string;
}

export const TABLE_ITEMS: Partial<Record<RetentionItemId, TableItem>> = {
  security_events: { table: 'security_events', at: 'at' },
  notifications_read: {
    table: 'inbox_notifications',
    at: 'created_at',
    where: 'read_at IS NOT NULL',
  },
  notifications_unread: {
    table: 'inbox_notifications',
    at: 'created_at',
    where: 'read_at IS NULL',
  },
  push_devices_revoked: { table: 'push_subscriptions', at: 'revoked_at' },
  faq_match_log: { table: 'faq_match_logs', at: 'created_at' },
  assignment_runs: { table: 'assignment_runs', at: 'created_at' },
  form_events: { table: 'web_form_events', at: 'created_at' },
  lead_sync_runs: { table: 'lead_sync_runs', at: 'finished_at', where: 'finished_at IS NOT NULL' },
  lead_scoring_runs: { table: 'lead_scoring_runs', at: 'created_at' },
  api_library_logs: { table: 'api_library_logs', at: 'created_at' },
  flow_run_logs: { table: 'flow_runs', at: 'ended_at', where: 'ended_at IS NOT NULL' },
  webhook_forward_failures: { table: 'webhook_forward_failures', at: 'created_at' },
  click_calls: { table: 'telephony_click_calls', at: 'created_at' },
};
