import { sql } from './db';
import type { Database, TenantTx } from './db';
import { q } from './db';

/**
 * A digest of everything the organization's provisioning left behind (roles, grants, users, plan state, pipelines, settings, counters ...)
 * and of every table the migration must leave EMPTY (outbox, audit, notifications, identities, templates ...): one md5 per row, per table,
 * for every org-scoped table that the bulk steps do not own. It is recorded when the organization is created; reconcile recomputes it,
 * so a changed, deleted or added row in any of those tables is noticed without the verifier having to know each column.
 */
export type Baseline = Record<string, string[]>;

/** Tables the bulk steps own: they are verified row by row against the source instead. */
export const BULK_TABLES = new Set([
  'contacts',
  'fields',
  'field_sections',
  'field_options',
  'field_dependencies',
  'field_option_dependencies',
  'status_options',
  'tags',
  'contact_groups',
  'contact_group_members',
  'contact_notes',
  // stage 2 inbox: the chat tables are verified by reconcile/chat.ts against the independent oracle, not by a digest
  'channels',
  'conversations',
  'messages',
  'message_ledger',
  // stage 2 broadcasts: verified by reconcile/campaigns.ts against the independent oracle
  'wpcampaigns',
  'wp_campaign_contacts',
  // stage 2 credits: verified by reconcile/credits.ts against the independent oracle (the ledger, the wallet, the token counters, the
  // usage charges and their keys); wallet_events, wallet_usage_months and everything else money-related stay in the baseline (empty)
  'wallet_transactions',
  'wallets',
  'ai_token_usage',
  'usage_charges',
  'usage_charge_keys',
  // stage 2 flows and widgets: verified by reconcile/flows.ts against the independent oracle; flow_runs, flow_subscribers, flow_run_steps,
  // keyword_reply_logs, auto_reply_lookups, chatbot_widget_visitors and everything else stay in the baseline (empty)
  'flows',
  'keyword_replies',
  'keyword_reply_contents',
  'chatbot_widgets',
  'ai_chat_assistants',
  // the FAQ feature (step faq_knowledge): verified by reconcile/faq.ts; faq_match_logs stays in the baseline (empty)
  'faqs',
  'faq_variations',
  'faq_settings',
  // stage 2 lead data: verified by reconcile/leads.ts against the independent oracle (reconcile/oracle-leads.ts); the outbox and notifications stay in the baseline (empty)
  'lead_sources',
  'lead_events',
  'contact_attributions',
  // the later bulk steps (templates, segments and saved views, knowledge sources, forms, the API library, outbound webhooks, chat labels):
  // every row is compared column by column through the generic fingerprint of reconcile/index.ts, so the baseline digest must not flag them
  'wa_templates',
  'segments',
  'contact_views',
  'ai_training_sources',
  'wa_forms',
  'api_library_apis',
  'webhooks',
  'conversation_tag',
]);

export async function orgTables(tx: TenantTx | Database): Promise<string[]> {
  const r = await tx.execute(sql`
    SELECT c.relname AS t FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
    WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
    ORDER BY 1`);
  return (r.rows as Array<{ t: string }>).map((x) => x.t).filter((t) => !BULK_TABLES.has(t));
}

/** A user the tool migrated carries settings.legacy.waboo.sourceUserId; the owner and every other row of the organization do not. */
const MIGRATED_USER = (alias: string): string =>
  `coalesce(jsonb_exists(${alias}.settings->'legacy'->'waboo', 'sourceUserId'), false)`;
const OF_PROVISIONED_USER = (col: string): string =>
  ` AND EXISTS (SELECT 1 FROM users u WHERE u.org_id = x.org_id AND u.id = x.${col} AND NOT ${MIGRATED_USER('u')})`;

/**
 * The roles and users steps own SOME rows of these tables (custom roles and their grants, migrated users and their profile, security
 * and role rows); the baseline holds only what provisioning left, so the other rows are verified by the access verifier instead.
 */
const BASELINE_FILTER: Record<string, string> = {
  users: ` AND NOT ${MIGRATED_USER('x')}`,
  roles: ' AND x.system_key IS NOT NULL',
  role_grants:
    ' AND EXISTS (SELECT 1 FROM roles r WHERE r.org_id = x.org_id AND r.id = x.role_id AND r.system_key IS NOT NULL)',
  user_roles: OF_PROVISIONED_USER('user_id'),
  user_security: OF_PROVISIONED_USER('user_id'),
  user_profiles: OF_PROVISIONED_USER('user_id'),
};

/** md5 of every row of the org in `tables`. `organizations` is keyed by id, the contacts display-id counter is checked elsewhere. */
export async function digest(
  tx: TenantTx | Database,
  orgId: number,
  tables: string[],
): Promise<Baseline> {
  const out: Baseline = {};
  for (const t of tables) {
    const extra =
      t === 'sequence_counters'
        ? sql` AND module_key <> 'contacts'`
        : BASELINE_FILTER[t]
          ? sql.raw(BASELINE_FILTER[t]!)
          : sql``;
    const r = await tx.execute(
      sql`SELECT md5(to_jsonb(x)::text) AS h FROM ${sql.raw(q(t))} x WHERE org_id = ${orgId}${extra}`,
    );
    const hs = (r.rows as Array<{ h: string }>).map((x) => x.h).sort();
    if (hs.length > 0) out[t] = hs;
  }
  const o = await tx.execute(
    sql`SELECT md5(to_jsonb(x)::text) AS h FROM organizations x WHERE id = ${orgId}`,
  );
  out.organizations = (o.rows as Array<{ h: string }>).map((x) => x.h).sort();
  return out;
}

/** md5 per quarantine row of a client (the `at` timestamp excluded: a re-run re-stamps unchanged rows). Sorted. */
export async function quarantineDigest(tx: TenantTx | Database, client: string): Promise<string[]> {
  const r = await tx.execute(
    sql`SELECT md5((to_jsonb(q) - 'at')::text) AS h FROM migration.quarantine q WHERE source_client = ${client}`,
  );
  return (r.rows as Array<{ h: string }>).map((x) => x.h).sort();
}

export async function recordQuarantineDigest(
  tx: TenantTx | Database,
  client: string,
  collection: string,
): Promise<void> {
  const rows = await quarantineDigest(tx, client);
  await tx.execute(sql`
    INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
    VALUES (${client}, ${collection}, 'quarantine-digest', 'run', 0, 'done', ${JSON.stringify({ rows })}::jsonb)
    ON CONFLICT (source_client, collection, step) DO UPDATE SET counts = EXCLUDED.counts, updated_at = now()`);
}
