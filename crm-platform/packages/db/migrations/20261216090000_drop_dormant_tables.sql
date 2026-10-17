-- 20261216090000_drop_dormant_tables
-- Fifteen tables the port created from the Reference schema that nothing writes and nothing needs. Each was checked for a
-- writer in every form (SQL, Drizzle, dynamic table-name maps, queue processors, seeds, the Waboo importer, triggers and
-- functions), for a built product path that reads it, and for a Reference feature that is not yet ported and would need it.
-- Tables that failed any of those checks stay (TikTok, LINE rich menus, Telegram accounts, user_device_tokens, HubSpot, Slack,
-- Trello, Meta Ads, the AI call and agent tables, auto-reply, the stock waitlists, csat_responses and others); they are
-- recorded as blocked on their feature, not dropped.
--
-- Why each one goes:
--   line_flow_sessions, telegram_flow_sessions, viber_flow_sessions, wechat_flow_sessions
--       Reference keeps these sessions in Node memory and never writes the table; here `flow_runs` serves every channel (TW-FLR-070).
--   sla_breaches          the workspace SLA sweep flags conversations.sla_breached; the helpdesk SLA ledger is support_sla_breaches.
--   support_agents        replaced by support_agent_roster, keyed by platform operator.
--   support_assignments   never written, not in Reference either; assignment history would need an operator-keyed table.
--   team_chat_reads       dead in Reference (TW-TCHAT-031); read state is team_chat_channel_members.last_read_message_id.
--   google_form_sessions  the waiting flow run is the session (TW-FLR-046).
--   invoice_webhook_events replaced by ecom_invoice_handoffs, which is tenant data.
--   chat_templates        dead in Reference (TW-TPL-049); the chat picker reads wa_templates.
--   flow_connected_devices dead in Reference (TW-FLB-078); the sender binding is flows.trigger_channel_id.
--   playbooks             the helpdesk playbooks are support_playbooks.
--   package_features, packages
--       Reference's plan catalogue; plans replaced it (workspace_addons was repointed to plans in add_addon_registry). The only
--       foreign keys into packages are subscriptions.package_id and orders.package_id, which no code reads or writes; both
--       columns are dropped with it (dropping a column takes its foreign key and index with it).
--
-- Safety: static analysis cannot see production rows, so the first block refuses to drop anything that is not empty. If it
-- fires, a writer exists that nobody found: stop and find it, do not weaken the check. The privileged flag is only there so
-- forced row-level security does not hide rows from the count; it is transaction-local and switched off again right after.

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  PERFORM set_config('app.privileged', 'on', true);

  FOREACH t IN ARRAY ARRAY[
    'line_flow_sessions', 'telegram_flow_sessions', 'viber_flow_sessions', 'wechat_flow_sessions',
    'sla_breaches', 'support_agents', 'support_assignments', 'team_chat_reads',
    'google_form_sessions', 'invoice_webhook_events', 'chat_templates', 'flow_connected_devices',
    'playbooks', 'package_features', 'packages'
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'drop_dormant_tables: % holds % row(s). It was verified as never written, so something wrote to it. Find the writer before dropping.', t, n;
      END IF;
    END IF;
  END LOOP;

  -- The two columns that pointed at packages: same rule, a value in either means something wrote it.
  FOREACH t IN ARRAY ARRAY['subscriptions', 'orders'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t AND column_name = 'package_id') THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE package_id IS NOT NULL', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'drop_dormant_tables: %.package_id is set on % row(s). It was verified as never written, so something wrote to it. Find the writer before dropping.', t, n;
      END IF;
    END IF;
  END LOOP;

  PERFORM set_config('app.privileged', 'off', true);
END $$;

-- packages is the only one with foreign keys pointing into it: subscriptions.package_id and orders.package_id. Nothing reads or
-- writes them (checked above for data, and in code), so they go; the foreign key and idx_orders_package_id go with the column.
ALTER TABLE subscriptions DROP COLUMN IF EXISTS package_id;
ALTER TABLE orders DROP COLUMN IF EXISTS package_id;

-- No CASCADE on purpose: an unexpected dependent object makes this fail loudly instead of disappearing with the table.
DROP TABLE IF EXISTS line_flow_sessions;
DROP TABLE IF EXISTS telegram_flow_sessions;
DROP TABLE IF EXISTS viber_flow_sessions;
DROP TABLE IF EXISTS wechat_flow_sessions;
DROP TABLE IF EXISTS sla_breaches;
DROP TABLE IF EXISTS support_assignments;
DROP TABLE IF EXISTS support_agents;
DROP TABLE IF EXISTS team_chat_reads;
DROP TABLE IF EXISTS google_form_sessions;
DROP TABLE IF EXISTS invoice_webhook_events;
DROP TABLE IF EXISTS chat_templates;
DROP TABLE IF EXISTS flow_connected_devices;
DROP TABLE IF EXISTS playbooks;
DROP TABLE IF EXISTS package_features;
DROP TABLE IF EXISTS packages;
