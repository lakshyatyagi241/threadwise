# Database column analysis

> **Note, 2026-10-16.** Migration `packages/db/migrations/20261216090000_drop_dormant_tables.sql` dropped 15 tables that this analysis lists as dormant or unused: `line_flow_sessions`, `telegram_flow_sessions`, `viber_flow_sessions`, `wechat_flow_sessions`, `sla_breaches`, `support_agents`, `support_assignments`, `team_chat_reads`, `google_form_sessions`, `invoice_webhook_events`, `chat_templates`, `flow_connected_devices`, `playbooks`, `package_features`, `packages` (the reason for each is in the migration header and in `docs/threadwise-port/schema/README.md`, "Dropped after the port"). The per-domain files and `all-columns.csv` below are generated from the schema as it stood at commit `21ffc10dc` and still list them; they were not regenerated. The columns `subscriptions.package_id` and `orders.package_id` stay (unused, no foreign key any more).
>
> The earlier claim in this README that the line, telegram, viber and wechat `*_broadcast_recipients` tables are dormant is stale: each has a writer (`apps/api/src/modules/channel-*/*-broadcasts.repository.ts`) and a queue processor (`*-broadcast.processor.ts`), so they are **not** dropped. The same holds for the matching `*_broadcasts` tables.

Every table and column in the Threadwise Postgres schema: what it is for, what can go in it, best practice, which features use it, and whether anything in the code actually uses it.

**Coverage: 374 tables, 6140 columns, 0 missing** (checked by script against `pg_catalog` after applying all 332 migrations in `packages/db/migrations` to a clean database, at commit `21ffc10dc`). Partition children are folded into their parent (`event_outbox`, `audit_log`, ...).

## How to read it

- One file per schema domain (list at the bottom). Each table has: purpose, linked features, facts (RLS, partitioning, migration, Drizzle file), design notes, then one row per column.
- `all-columns.csv` has every column in one sheet (filter by `usage`, `useful`, `domain`).
- Boilerplate columns (`id`, `org_id`, `uuid`, `created_at`, `updated_at`, `row_version`: 1,874 columns) are filled by rule from the table's real usage evidence. Every other column (4,266) was analysed by reading its migration, Drizzle file, CHECK/FK, and the code that touches it.

### Usage verdict

| Value | Meaning | Columns |
|---|---|---|
| USED | Production code (API, worker, web) reads or writes it | 4559 |
| PARTIAL | Written but never read, or read but never written | 290 |
| TEST_ONLY | Only tests or seeds touch it | 7 |
| PLANNED | No code yet, but Reference uses it or the port backlog needs it | 596 |
| UNUSED | No code, and no Reference or backlog need found | 387 |
| DB_ONLY | Maintained only inside the DB (trigger, default, generated, RLS) | 301 |

### Useful verdict

| Value | Meaning | Columns |
|---|---|---|
| YES | Needed by a real feature, current or planned | 4975 |
| MAYBE | Redundant, derivable or speculative: decide | 857 |
| NO | Dead weight: candidate to drop | 308 |

**Caveat on evidence.** Usage comes from a static scan (SQL strings, Drizzle references, contracts) plus manual grep of every column the scan could not tie to code. Columns reached only through dynamic SQL (column names built at runtime) or `SELECT *` can be misjudged: re-grep before dropping anything. PLANNED is not waste: the Reference feature exists, the port has not built it.

## Key findings

### Tables with no production code at all (drop or decide)

- `packages`, `package_features` — replaced by `plans`; dropped by `20261216090000_drop_dormant_tables.sql`. `subscriptions.package_id` and `orders.package_id` remain as unused columns with no foreign key (never written).
- `invoice_webhook_events` — superseded by `ecom_invoice_handoffs`; dropped by `20261216090000_drop_dormant_tables.sql`.
- `telegram_flow_sessions`, `wechat_flow_sessions`, `line_flow_sessions` (and `viber_flow_sessions`) — `flow_runs` serves every channel; dropped by `20261216090000_drop_dormant_tables.sql`. `flow_connected_devices` dead in Reference too; dropped by the same migration.
- `chat_templates`, `team_chat_reads`, `sla_breaches` (dup of `support_sla_breaches`), `playbooks`, `support_agents`, `support_assignments` — replaced or never written; dropped by `20261216090000_drop_dormant_tables.sql`. `google_form_sessions` is dropped by it too (the waiting flow run is the session).
- `outbound_webhooks` — only a plan-limit COUNT uses it; the port uses `webhooks`. `notifications` overlaps `inbox_notifications`: merge or drop.
- `workspace_email_accounts` — legacy; `mail_mailboxes` is the chosen design.

### Split-brain and wrong-source reads (real bugs, not just dead columns)

- `timezone`, `business_hours`, `inbox_away`, `currency`, `last_active_at` are READ from `workspace_settings` by SLA / routing / flow code but nothing writes them there; Settings UI writes `organizations.settings`. SLA clocks therefore run on UTC.
- `agent_statuses` has no production writer, so every agent reads offline.
- `wp_campaign_contacts.clicked*` and `click_count` have no writer, so `wpcampaigns.clicked_count` stays 0 for Threadwise-sent campaigns.
- `invoice_tax_summary.base_minor/amount_minor` lost their `>= 0` CHECK in migration `20261008100000`.
- `ai_voice_usage_daily` unique key does not dedupe a NULL `ai_agent_id`.
- `marketplace_connections.connector_type` CHECK lacks `'client'` that `marketplace_apps` allows.

### Design smells that repeat

- Money stored two ways: `numeric` major units (`wallets`, `wallet_transactions`, `orders`, `coupons`, `meta_campaigns`) vs `bigint` minor units (`payments`, `usage_charges`, `credit_packages`, `deals`). Pick minor units.
- Status / type / provider columns as free text with no CHECK or FK: most of Shopify/Woo, TikTok, Viber, `wa_forms`, `wa_chat_links`, `wa_orders`, `wa_templates`, `subscriptions`, `organizations.status/plan`, `event_outbox.status`, many more.
- Secrets in plaintext: `incoming_webhooks.token`, `google_form_sessions.webhook_token` (table since dropped), `wa_provider_configs.meta_json` (`dlr_secret`), `line_channels.webhook_token`, Meta ad tokens in `meta_campaigns`.
- Binary files in Postgres `bytea` (`team_chat_attachment_blobs`, `contact_exports`, up to 20 MB each).
- JSON in `text` columns (`admin_ai_keys.extra_config`, `usage_charges.meta`, several `workspace_settings` fields): use `jsonb`.
- Nullable column inside a unique key (`user_id` in several team-chat and `agent_statuses` keys): NULLs never collide.
- Redundant indexes: `sales_order_items (org_id, order_id, sort)` twice, `sales_doc_items` unique + plain, `chatbot_widget_visitors.visitor_uuid`.
- `contacts` (58 cols) carries duplicate groups: `is_archived` vs `lifecycle_state`, `is_unsubscribed` vs three `*_subscription_status`, `name` vs first/middle/last, `phone` vs `country_code` vs `normalized_phone`; `search_vector` is maintained but never queried.
- Drizzle drift: `audit_log.ip` exists in SQL but not in `ops.ts`; `appointments` Drizzle omits the GiST exclusion constraint and CHECKs.

### Unbuilt clusters (PLANNED, not waste)

HubSpot / Slack / Trello / incoming webhooks (INTG), LINE, Telegram, WeChat, Viber, TikTok channels, Meta Ads, AI call assistants and call logs, AI copilot / lead finder, auto-reply keywords, forms-links-groups authoring, projects (Google-form sessions are not one of them any more: `google_form_sessions` was dropped, the waiting flow run is the session). Their tables exist because the Reference data model was ported first.

## Dormant tables (scan found no production reference to any column)

`ai_call_assistant_tools`, `ai_crm_actions`, `ai_voice_usage_daily`, `chat_templates`, `crm_briefs`, `hubspot_integration_logs`, `invoice_number_sequences`, `invoice_webhook_events`, `line_broadcast_recipients`, `line_broadcasts`, `line_flow_sessions`, `line_rich_menus`, `meta_campaigns`, `package_features`, `sla_breaches`, `slack_integration_logs`, `support_agents`, `support_assignments`, `team_chat_reads`, `telegram_accounts`, `telegram_flow_sessions`, `tiktok_posts`, `tiktok_shops`, `trello_integration_logs`, `user_device_tokens`, `viber_broadcast_recipients`, `viber_broadcasts`, `viber_flow_sessions`, `wechat_broadcast_recipients`, `wechat_broadcasts`, `wechat_flow_sessions`, `workspace_preset_baseline`

(32 tables; some are PLANNED, see their notes. Update 2026-10-16: 11 of them are dropped by `20261216090000_drop_dormant_tables.sql` (`chat_templates`, `invoice_webhook_events`, `line_flow_sessions`, `package_features`, `sla_breaches`, `support_agents`, `support_assignments`, `team_chat_reads`, `telegram_flow_sessions`, `viber_flow_sessions`, `wechat_flow_sessions`); the six line, viber and wechat `*_broadcasts` and `*_broadcast_recipients` tables are not dormant, they have writers and queue processors. The rest stay, blocked on their feature: see "Looked dormant but kept" in `docs/threadwise-port/schema/README.md`.)

## Columns to review for removal (usage UNUSED and useful NO or MAYBE)

Only analyst-judged columns shown; boilerplate columns excluded (see CSV). Grouped by table.

| Table | Columns |
|---|---|
| `agent_statuses` | `current_load`, `today_replies`, `today_resolutions`, `counters_date`, `preferences` |
| `ai_voice_usage_daily` | `call_seconds`, `llm_input_tokens`, `llm_output_tokens` |
| `appointments` | `meta`, `reminder_sent_at` |
| `blog_categories` | `description`, `sort_order` |
| `booking_reminders` | `template_event` |
| `booking_templates` | `coupon_code`, `coupon_id` |
| `booking_types` | `meta` |
| `chat_templates` | `user_id`, `title`, `category`, `tone`, `body`, `media_path`, `media_type`, `status` |
| `companies` | `lifecycle_state`, `status`, `is_archived` |
| `contacts` | `legacy_id`, `subject` |
| `crm_briefs` | `meta_json` |
| `csat_responses` | `agent_user_id`, `comment`, `sent_at` |
| `deals` | `owner_team_id` |
| `devices` | `warm_day`, `warm_day_count` |
| `facebook_pages` | `meta_json` |
| `facebook_posts` | `meta_json` |
| `fields` | `replaces_field_id` |
| `flow_connected_devices` | `flow_id`, `device_number`, `device_name`, `status`, `connected_at`, `last_active_at` |
| `flows` | `flow_file_path` |
| `invoice_items` | `meta_json` |
| `invoice_settings` | `enabled`, `tax_inclusive_default`, `hsn_default`, `meta_json` |
| `invoice_webhook_events` | `source`, `delivery_id`, `topic`, `external_order_id`, `received_at` |
| `invoices` | `external_order_id`, `external_order_number`, `trigger`, `shipping_json` |
| `orders` | `package_id`, `credit_package_id`, `base_amount_usd`, `exchange_rate` |
| `package_features` | `name`, `icon`, `status` |
| `packages` | `plan_id`, `type`, `grants_json`, `pname`, `pfeatures_id`, `plan_unit`, `plan_duration`, `plan_amount`, `offer_price`, `currency`, `free`, `lifetime`, `data_retention_days`, `status`, `is_default`, `is_highlighted`, `is_custom_quote`, `sort_order`, `detail`, `cta_label`, `cta_url`, `subtitle`, `device_limit`, `monthly_messages_limit`, `contacts_limit`, `broadcast_limit`, `template_limit`, `groups_limit`, `campaign_messages_limit`, `automation_messages_limit`, `broadcast_size_limit`, `total_campaigns_limit`, `active_campaign_limit`, `user_seat_limit`, `workspaces_per_owner_limit`, `routing_rules_limit`, `drip_campaigns_limit`, `appointments_limit`, `ai_agents_limit`, `saved_replies_limit`, `webhooks_limit`, `api_rate_limit_per_minute`, `allow_byok_ai_keys`, `ai_token_limit_monthly`, `integration_shopify`, `integration_woocommerce`, `integration_hubspot`, `integration_slack`, `integration_trello`, `integration_google_calendar`, `integration_google_sheets`, `access_kanban_view`, `access_appointment_booking`, `access_edit_messages`, `access_internal_notes`, `access_message_reactions`, `access_routing_rules`, `access_business_hours`, `access_team_performance`, `access_outbound_webhooks`, `access_keyword_replies`, `access_ai_agents`, `tags_limit`, `flow_limit`, `flow_steps_limit`, `autoreply_limit`, `chatbot_limit`, `scheduled_campaign_limit`, `daily_media_size_allowance`, `autoreply`, `bulkmessage`, `schedulemessage`, `ads`, `campaign`, `autoflow`, `broadcast`, `chatgpt_suggestion`, `template`, `access_carousel_templates`, `role_based_permissions`, `access_drip_campaigns`, `access_ctwa`, `access_analytics`, `remove_branding`, `multipledevice`, `file_type_restrictions`, `access_waba_calling`, `access_call_recording`, `access_ai_voice_agent`, `access_ai_chat_assistant`, `access_ai_training`, `access_ai_generate`, `access_wa_storefront`, `access_flows_commerce`, `access_chatbot_widgets`, `access_sla_policies`, `access_translation`, `access_data_residency`, `waba_calling_minutes_monthly`, `ai_voice_minutes_monthly`, `ai_chat_messages_monthly`, `ai_training_sources_limit`, `chatbot_widgets_limit`, `storefronts_limit`, `sla_policies_limit`, `translation_chars_monthly`, `access_sales_pipeline`, `pipelines_limit`, `access_whatsapp_pay`, `access_proxy_isolation`, `access_facebook`, `facebook_inbox`, `facebook_posts`, `facebook_comments`, `facebook_ai_agent`, `facebook_pages_limit`, `facebook_scheduled_posts_limit`, `access_tiktok`, `tiktok_inbox`, `tiktok_posts`, `tiktok_comments`, `tiktok_accounts_limit`, `tiktok_scheduled_posts_limit`, `access_telegram`, `telegram_broadcasts`, `telegram_bots_limit`, `access_sms`, `sms_monthly_limit`, `auto_invoice`, `auto_invoice_max_monthly`, `auto_invoice_branding`, `access_lead_finder`, `access_line`, `line_broadcasts`, `line_channels_limit`, `access_wechat`, `wechat_broadcasts`, `wechat_channels_limit`, `access_viber`, `viber_broadcasts`, `viber_channels_limit`, `access_email`, `email_monthly_limit` |
| `partner_agents` | `settings` |
| `payment_gateways` | `extra_config` |
| `payments` | `wa_order_id` |
| `platform_notes` | `admin_user_id` |
| `platform_operators` | `force_password_change` |
| `playbooks` | `name`, `slug`, `trigger_type`, `trigger_value`, `steps`, `is_active`, `use_count` |
| `saved_replies` | `attachments` |
| `scheduled_messages` | `charged_sent` |
| `sla_breaches` | `ticket_id`, `sla_policy_id`, `breach_type`, `breached_at`, `severity`, `over_by_minutes` |
| `storefront_cart_recoveries` | `scheduled_ids` |
| `subscriptions` | `package_id` |
| `support_agents` | `user_id`, `is_active`, `specialty`, `current_load` |
| `support_assignments` | `ticket_id`, `agent_user_id`, `assigned_at`, `released_at`, `outcome` |
| `support_tickets` | `sla_policy_id`, `meta` |
| `team_chat_reads` | `user_id`, `last_read_message_id`, `last_read_at` |
| `teams` | `default_assignee_id`, `business_hours`, `timezone` |
| `telegram_flow_sessions` | `conversation_id`, `telegram_bot_id`, `chat_id`, `flow_id`, `node_id`, `status`, `await_var`, `await_options`, `vars`, `last_error`, `expires_at`, `last_message_id`, `poll_id`, `invoice_payload`, `payment_link_id`, `payment_ref` |
| `translation_providers` | `extra_config` |
| `wa_calls` | `recording_started_at`, `transcript` |
| `wa_device_groups` | `meta_json` |
| `wa_groups` | `meta_json` |
| `wa_order_items` | `meta_json` |
| `wa_product_reviews` | `order_id` |
| `wa_product_sets` | `meta_set_id` |
| `wa_provider_configs` | `warm_day`, `warm_day_count` |
| `wallets` | `reserved` |
| `wechat_flow_sessions` | `conversation_id`, `wechat_channel_id`, `openid`, `flow_id`, `node_id`, `status`, `await_var`, `await_options`, `vars`, `last_error`, `expires_at`, `last_message_id` |
| `workspace_email_accounts` | `synced_at` |
| `workspace_flags` | `flagged_by_user_id`, `cleared_by_user_id` |
| `workspace_settings` | `custom_domain`, `enabled_engines`, `billing_cycle`, `trial_ends_at`, `plan_ends_at`, `plan_overrides`, `brand_primary`, `brand_accent`, `brand_background`, `brand_logo_path`, `brand_favicon_path`, `branding_footer`, `notification_prefs`, `voicemail_delay_sec`, `locale`, `brand_color`, `country`, `data_wiped_at` |
| `wp_campaign_contacts` | `tracking_id` |
| `wpcampaigns` | `scheduled_message_id`, `node_schedule_id` |

### Boilerplate columns with no reference (`uuid`/`row_version`/`updated_at`)

`uuid` never referenced by app code on 44 tables (public id not exposed anywhere yet): `ai_call_assistant_tools`, `ai_voice_usage_daily`, `chat_templates`, `conversation_participants`, `coupon_redemptions`, `crm_briefs`, `ecom_invoice_handoffs`, `flb_geta_publish_settings`, `flb_geta_publish_syncs`, `flow_connected_devices`, `frontend_content`, `google_form_sessions`, `incoming_webhook_events`, `invoice_number_sequences`, `invoice_webhook_events`, `line_broadcast_recipients`, `line_broadcasts`, `line_flow_sessions`, `line_rich_menus`, `meta_campaigns`, `package_features`, `shopify_cart_recoveries`, `shopify_stock_waitlist`, `sla_breaches`, `storefront_cart_recoveries`, `support_agents`, `support_assignments`, `team_chat_reads`, `telegram_accounts`, `telegram_flow_sessions`, `tiktok_posts`, `tiktok_shops`, `usage_charge_keys`, `user_device_tokens`, `viber_broadcast_recipients`, `viber_broadcasts`, `viber_flow_sessions`, `wa_chat_links`, `wa_group_members`, `wechat_broadcast_recipients`, `wechat_broadcasts`, `wechat_flow_sessions`, `woocommerce_cart_recoveries`, `woocommerce_stock_waitlist`

`row_version` bumped by trigger but compared by no app code on 90 tables: optimistic locking is not wired there, so the counter is dead weight until it is.

## Files by domain

| Domain | Tables | Columns |
|---|---|---|
| [addons-extension-registry](addons-extension-registry.md) | 2 | 25 |
| [admin-console-shell](admin-console-shell.md) | 1 | 6 |
| [ai-agents-training](ai-agents-training.md) | 3 | 73 |
| [ai-copilot-lead-finder](ai-copilot-lead-finder.md) | 3 | 51 |
| [ai-keys-usage-admin](ai-keys-usage-admin.md) | 3 | 32 |
| [api-library](api-library.md) | 2 | 41 |
| [appointments-booking](appointments-booking.md) | 12 | 205 |
| [auth-registration-security](auth-registration-security.md) | 13 | 156 |
| [auto-reply-keywords](auto-reply-keywords.md) | 4 | 72 |
| [broadcasts](broadcasts.md) | 3 | 69 |
| [bsp-billing-engine](bsp-billing-engine.md) | 1 | 15 |
| [calling-voice](calling-voice.md) | 7 | 137 |
| [campaigns](campaigns.md) | 7 | 172 |
| [catalog-products](catalog-products.md) | 6 | 109 |
| [channel-email](channel-email.md) | 4 | 61 |
| [channel-facebook](channel-facebook.md) | 4 | 74 |
| [channel-line](channel-line.md) | 5 | 95 |
| [channel-telegram](channel-telegram.md) | 5 | 94 |
| [channel-tiktok](channel-tiktok.md) | 3 | 65 |
| [channel-viber](channel-viber.md) | 4 | 69 |
| [channel-wechat](channel-wechat.md) | 4 | 75 |
| [chat-conversations](chat-conversations.md) | 10 | 181 |
| [chatbot-widget](chatbot-widget.md) | 2 | 56 |
| [checkout-orders-merchant-payments](checkout-orders-merchant-payments.md) | 5 | 109 |
| [companies-projects-tasks](companies-projects-tasks.md) | 2 | 37 |
| [contact-detail](contact-detail.md) | 4 | 43 |
| [contact-views](contact-views.md) | 5 | 35 |
| [contacts-attributes-tags](contacts-attributes-tags.md) | 5 | 65 |
| [coupons-credits-referral-currency](coupons-credits-referral-currency.md) | 6 | 78 |
| [crm](crm.md) | 3 | 87 |
| [deals-pipelines](deals-pipelines.md) | 6 | 81 |
| [faq-knowledge](faq-knowledge.md) | 4 | 67 |
| [field-metadata](field-metadata.md) | 6 | 75 |
| [flow-builder-editor](flow-builder-editor.md) | 5 | 77 |
| [flow-runtime-engine](flow-runtime-engine.md) | 5 | 96 |
| [forms-builder](forms-builder.md) | 6 | 86 |
| [forms-links-groups](forms-links-groups.md) | 5 | 78 |
| [foundation](foundation.md) | 12 | 126 |
| [help-agent](help-agent.md) | 2 | 25 |
| [install-update-licensing](install-update-licensing.md) | 1 | 10 |
| [integrations-hubspot-slack-trello-google-webhooks](integrations-hubspot-slack-trello-google-webhooks.md) | 10 | 150 |
| [invoicing](invoicing.md) | 17 | 408 |
| [lead-scoring](lead-scoring.md) | 2 | 27 |
| [leads](leads.md) | 3 | 58 |
| [localization-translation](localization-translation.md) | 3 | 35 |
| [marketing-site-cms](marketing-site-cms.md) | 7 | 92 |
| [marketplace](marketplace.md) | 11 | 200 |
| [message-templates](message-templates.md) | 2 | 51 |
| [meta-ads](meta-ads.md) | 1 | 37 |
| [no-drizzle-file](no-drizzle-file.md) | 14 | 143 |
| [node-bridge-runtime](node-bridge-runtime.md) | 3 | 31 |
| [notifications-activity-audit](notifications-activity-audit.md) | 4 | 67 |
| [ops](ops.md) | 2 | 23 |
| [partner](partner.md) | 3 | 40 |
| [plans-subscriptions-trials](plans-subscriptions-trials.md) | 7 | 229 |
| [platform-payment-gateways](platform-payment-gateways.md) | 6 | 127 |
| [platform-support-desk](platform-support-desk.md) | 10 | 125 |
| [roles-permissions](roles-permissions.md) | 4 | 18 |
| [sales-docs-proposals](sales-docs-proposals.md) | 7 | 116 |
| [scheduled-queue-warmer](scheduled-queue-warmer.md) | 4 | 90 |
| [segments](segments.md) | 2 | 24 |
| [shopify-woocommerce](shopify-woocommerce.md) | 13 | 180 |
| [storefront-builder](storefront-builder.md) | 3 | 43 |
| [team-chat](team-chat.md) | 7 | 83 |
| [team-inbox-conversations](team-inbox-conversations.md) | 4 | 55 |
| [team-inbox-routing-sla](team-inbox-routing-sla.md) | 4 | 57 |
| [waboo-migration](waboo-migration.md) | 2 | 34 |
| [wallet-message-billing](wallet-message-billing.md) | 11 | 141 |
| [webhook-fanout](webhook-fanout.md) | 2 | 31 |
| [whatsapp-cloud-api-waba](whatsapp-cloud-api-waba.md) | 2 | 29 |
| [whatsapp-devices-baileys](whatsapp-devices-baileys.md) | 4 | 96 |
| [whatsapp-providers](whatsapp-providers.md) | 2 | 39 |
| [workspaces-teams-tenancy](workspaces-teams-tenancy.md) | 8 | 153 |
