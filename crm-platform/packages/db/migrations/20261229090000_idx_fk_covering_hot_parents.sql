-- idx: covering indexes for the foreign keys that point at the tables rows are deleted from most (QA task 40).
-- Why this migration exists: deleting a contact, a conversation, a WhatsApp template or a flow makes Postgres look for referencing
-- rows in every child table; with no index on the child column each of those lookups scans the whole child table, per deleted row.
-- Bulk contact delete, template delete and the account-erasure path all hit this. Each index leads with org_id (the tenant
-- column every FK here is composite on), so it also serves the join from the parent. IF NOT EXISTS: safe to rerun. These are plain
-- CREATE INDEX (not CONCURRENTLY) on purpose: every table here arrived in the 2026-10 schema wave and is still small, and one
-- transaction keeps the migration all-or-nothing. FKs to users/platform_operators (created_by-style audit columns) are not indexed:
-- users are deleted only by account erasure, see tools/qa-suite/data/baseline.json.
CREATE INDEX IF NOT EXISTS idx_flow_retry_logs_contact_id
  ON flow_retry_logs (org_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_shopify_integration_events_template_id
  ON shopify_integration_events (org_id, template_id);
CREATE INDEX IF NOT EXISTS idx_woocommerce_integration_events_template_id
  ON woocommerce_integration_events (org_id, template_id);
CREATE INDEX IF NOT EXISTS idx_leads_contact_id
  ON leads (org_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_incoming_webhook_events_lead_contact_id
  ON incoming_webhook_events (org_id, lead_contact_id);
CREATE INDEX IF NOT EXISTS idx_wa_link_clicks_template_id
  ON wa_link_clicks (org_id, template_id);
CREATE INDEX IF NOT EXISTS idx_wpcampaigns_template_id
  ON wpcampaigns (org_id, template_id);
CREATE INDEX IF NOT EXISTS idx_wpcampaigns_template_id_a
  ON wpcampaigns (org_id, template_id_a);
CREATE INDEX IF NOT EXISTS idx_wpcampaigns_template_id_b
  ON wpcampaigns (org_id, template_id_b);
CREATE INDEX IF NOT EXISTS idx_wpcampaigns_flow_id
  ON wpcampaigns (org_id, flow_id);
CREATE INDEX IF NOT EXISTS idx_wpcampaigns_flow_id_b
  ON wpcampaigns (org_id, flow_id_b);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_template_id
  ON scheduled_messages (org_id, template_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_message_contacts_contact_id
  ON scheduled_message_contacts (org_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_keyword_replies_target_contact_id
  ON keyword_replies (org_id, target_contact_id);
CREATE INDEX IF NOT EXISTS idx_keyword_reply_contents_template_id
  ON keyword_reply_contents (org_id, template_id);
CREATE INDEX IF NOT EXISTS idx_wa_calls_conversation_id
  ON wa_calls (org_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_deals_conversation_id
  ON deals (org_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_facebook_broadcasts_template_id
  ON facebook_broadcasts (org_id, template_id);
CREATE INDEX IF NOT EXISTS idx_facebook_broadcast_recipients_conversation_id
  ON facebook_broadcast_recipients (org_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_telegram_broadcasts_template_id
  ON telegram_broadcasts (org_id, template_id);
CREATE INDEX IF NOT EXISTS idx_telegram_broadcast_recipients_conversation_id
  ON telegram_broadcast_recipients (org_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_line_broadcasts_template_id
  ON line_broadcasts (org_id, template_id);
CREATE INDEX IF NOT EXISTS idx_line_broadcast_recipients_conversation_id
  ON line_broadcast_recipients (org_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_wechat_broadcasts_template_id
  ON wechat_broadcasts (org_id, template_id);
CREATE INDEX IF NOT EXISTS idx_wechat_broadcast_recipients_conversation_id
  ON wechat_broadcast_recipients (org_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_viber_broadcasts_template_id
  ON viber_broadcasts (org_id, template_id);
CREATE INDEX IF NOT EXISTS idx_viber_broadcast_recipients_conversation_id
  ON viber_broadcast_recipients (org_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_invoice_settings_template_id_whatsapp
  ON invoice_settings (org_id, template_id_whatsapp);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_contact_id
  ON recurring_invoices (org_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_camp_series_template_id
  ON camp_series (org_id, template_id);
CREATE INDEX IF NOT EXISTS idx_camp_test_sends_template_id
  ON camp_test_sends (org_id, template_id);
CREATE INDEX IF NOT EXISTS idx_faq_match_logs_flow_id
  ON faq_match_logs (org_id, flow_id);
CREATE INDEX IF NOT EXISTS idx_growth_actions_conversation_id
  ON growth_actions (org_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_flow_segment_state_contact_id
  ON flow_segment_state (org_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_telephony_click_calls_contact_id
  ON telephony_click_calls (org_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id
  ON user_roles (org_id, role_id);
CREATE INDEX IF NOT EXISTS idx_invoices_recurring_id
  ON invoices (org_id, recurring_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tax_rate_id
  ON invoice_items (org_id, tax_rate_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_items_tax_rate_id
  ON sales_order_items (org_id, tax_rate_id);
CREATE INDEX IF NOT EXISTS idx_payments_attempt_id
  ON payments (org_id, attempt_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payment_attempts_payment_id
  ON invoice_payment_attempts (org_id, payment_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payment_attempts_connection_id
  ON invoice_payment_attempts (org_id, connection_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoice_runs_invoice_id
  ON recurring_invoice_runs (org_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_ecom_invoice_handoffs_invoice_id
  ON ecom_invoice_handoffs (org_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_appointment_reminder_runs_reminder_id
  ON appointment_reminder_runs (org_id, reminder_id);
CREATE INDEX IF NOT EXISTS idx_call_log_entries_telephony_connection_id
  ON call_log_entries (org_id, telephony_connection_id);
CREATE INDEX IF NOT EXISTS idx_wa_calls_ai_call_log_id
  ON wa_calls (org_id, ai_call_log_id);
CREATE INDEX IF NOT EXISTS idx_conversations_sla_policy_id
  ON conversations (org_id, sla_policy_id);
CREATE INDEX IF NOT EXISTS idx_conversations_resolved_by_agent_id
  ON conversations (org_id, resolved_by_agent_id);
CREATE INDEX IF NOT EXISTS idx_deals_lost_reason_id
  ON deals (org_id, lost_reason_id);
CREATE INDEX IF NOT EXISTS idx_growth_actions_digest_id
  ON growth_actions (org_id, digest_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_stage_suggestions_digest_id
  ON lifecycle_stage_suggestions (org_id, digest_id);
CREATE INDEX IF NOT EXISTS idx_wa_pending_orders_order_id
  ON wa_pending_orders (org_id, order_id);
CREATE INDEX IF NOT EXISTS idx_wa_product_reviews_order_id
  ON wa_product_reviews (org_id, order_id);
CREATE INDEX IF NOT EXISTS idx_wa_product_reviews_storefront_id
  ON wa_product_reviews (org_id, storefront_id);
CREATE INDEX IF NOT EXISTS idx_wa_coupons_storefront_id
  ON wa_coupons (org_id, storefront_id);
CREATE INDEX IF NOT EXISTS idx_wa_orders_wa_payment_config_id
  ON wa_orders (org_id, wa_payment_config_id);
CREATE INDEX IF NOT EXISTS idx_privacy_erasure_files_request_id
  ON privacy_erasure_files (org_id, request_id);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_lead_id
  ON privacy_requests (org_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_contact_consent_state_last_event_id
  ON contact_consent_state (org_id, last_event_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_company_id
  ON recurring_invoices (org_id, company_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_deal_id
  ON recurring_invoices (org_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_company_id
  ON sales_orders (org_id, company_id);
CREATE INDEX IF NOT EXISTS idx_keyword_replies_target_catalog_id
  ON keyword_replies (org_id, target_catalog_id);
CREATE INDEX IF NOT EXISTS idx_wa_forms_provider_config_id
  ON wa_forms (org_id, provider_config_id);
CREATE INDEX IF NOT EXISTS idx_owner_reassign_batches_to_team_id
  ON owner_reassign_batches (org_id, to_team_id);
