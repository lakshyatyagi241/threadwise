# Schema review notes

Generated. Everything a person has to look at after the mechanical translation: references without a foreign key, secrets, JSON shapes,
global uniques, and what the reviewers found by reading WaDesk's code. Domain owners work through their own tables.

## Loose references (no foreign key)

A numeric `*_id` column that stays a plain `bigint`: polymorphic, a provider id, a stream (no FKs in streams), a platform table pointing at a tenant table, or a target that is not a table here.

| table                          | column                     | domain | why                                                                                                       |
| ------------------------------ | -------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| `extensions`                   | `installed_by`             | add    | users (override): no FK, target is a stream, dropped, or not reachable from this scope                    |
| `ai_crm_actions`               | `user_id`                  | aicrm  | users (convention): no FK, target is a stream, dropped, or not reachable from this scope                  |
| `ai_crm_actions`               | `subject_id`               | aicrm  | no target table found: loose reference                                                                    |
| `crm_briefs`                   | `subject_id`               | aicrm  | no target table found: loose reference                                                                    |
| `appointments`                 | `staff_id`                 | appt   | no target table found: loose reference                                                                    |
| `booking_availability_rules`   | `staff_id`                 | appt   | no target table found: loose reference                                                                    |
| `auto_reply_lookups`           | `matched_keyword_reply_id` | ar     | keyword_replies (override): no FK, target is a stream, dropped, or not reachable from this scope          |
| `auto_reply_lookups`           | `device_id`                | ar     | no target table found: loose reference                                                                    |
| `keyword_replies`              | `device_id`                | ar     | no target table found: loose reference                                                                    |
| `keyword_reply_logs`           | `keyword_reply_id`         | ar     | keyword_replies (override): no FK, target is a stream, dropped, or not reachable from this scope          |
| `keyword_reply_logs`           | `content_id`               | ar     | keyword_reply_contents (override): no FK, target is a stream, dropped, or not reachable from this scope   |
| `broadcasts`                   | `device_id`                | bcast  | no target table found: loose reference                                                                    |
| `wa_link_clicks`               | `message_id`               | bcast  | messages (convention): no FK, target is a stream, dropped, or not reachable from this scope               |
| `wa_call_events`               | `wa_call_id`               | call   | wa_calls (override): no FK, target is a stream, dropped, or not reachable from this scope                 |
| `wa_calls`                     | `handler_agent_id`         | call   | no target table found: loose reference                                                                    |
| `wpcampaigns`                  | `device_id`                | camp   | no target table found: loose reference                                                                    |
| `conversation_events`          | `conversation_id`          | chat   | conversations (model): no FK, target is a stream, dropped, or not reachable from this scope               |
| `conversation_events`          | `actor_user_id`            | chat   | users (model): no FK, target is a stream, dropped, or not reachable from this scope                       |
| `conversations`                | `device_id`                | chat   | no target table found: loose reference                                                                    |
| `messages`                     | `conversation_id`          | chat   | conversations (db): no FK, target is a stream, dropped, or not reachable from this scope                  |
| `messages`                     | `user_id`                  | chat   | users (convention): no FK, target is a stream, dropped, or not reachable from this scope                  |
| `messages`                     | `agent_id`                 | chat   | ai_agents (override): no FK, target is a stream, dropped, or not reachable from this scope                |
| `messages`                     | `contact_id`               | chat   | contacts (model): no FK, target is a stream, dropped, or not reachable from this scope                    |
| `messages`                     | `template_id`              | chat   | wa_templates (model): no FK, target is a stream, dropped, or not reachable from this scope                |
| `tasks`                        | `related_id`               | ctp    | no target table found: loose reference                                                                    |
| `referral_codes`               | `user_id`                  | cpn    | no target table found: loose reference                                                                    |
| `referrals`                    | `referrer_user_id`         | cpn    | users (db): no FK, target is a stream, dropped, or not reachable from this scope                          |
| `referrals`                    | `referred_user_id`         | cpn    | users (db): no FK, target is a stream, dropped, or not reachable from this scope                          |
| `referrals`                    | `award_transaction_id`     | cpn    | wallet_transactions (model): no FK, target is a stream, dropped, or not reachable from this scope         |
| `deals`                        | `owner_team_id`            | deal   | no target table found: loose reference                                                                    |
| `flow_templates`               | `created_by`               | flb    | users (override): no FK, target is a stream, dropped, or not reachable from this scope                    |
| `flows`                        | `trigger_device_id`        | flb    | no target table found: loose reference                                                                    |
| `flows`                        | `instaflow_flow_id`        | flb    | no target table found: loose reference                                                                    |
| `hubspot_integration_logs`     | `integration_id`           | intg   | hubspot_integrations (override): no FK, target is a stream, dropped, or not reachable from this scope     |
| `slack_integration_logs`       | `integration_id`           | intg   | slack_integrations (override): no FK, target is a stream, dropped, or not reachable from this scope       |
| `trello_integration_logs`      | `integration_id`           | intg   | trello_integrations (override): no FK, target is a stream, dropped, or not reachable from this scope      |
| `webhook_deliveries`           | `webhook_id`               | intg   | webhooks (override): no FK, target is a stream, dropped, or not reachable from this scope                 |
| `invoice_logs`                 | `invoice_id`               | inv    | invoices (override): no FK, target is a stream, dropped, or not reachable from this scope                 |
| `frontend_content`             | `updated_by`               | cms    | users (override): no FK, target is a stream, dropped, or not reachable from this scope                    |
| `notifications`                | `source_id`                | notif  | no target table found: loose reference                                                                    |
| `scheduled_messages`           | `device_id`                | sched  | no target table found: loose reference                                                                    |
| `warmer_daily_sends`           | `device_id`                | sched  | no target table found: loose reference                                                                    |
| `shopify_integration_logs`     | `integration_id`           | ecom   | shopify_integrations (override): no FK, target is a stream, dropped, or not reachable from this scope     |
| `woocommerce_integration_logs` | `integration_id`           | ecom   | woocommerce_integrations (override): no FK, target is a stream, dropped, or not reachable from this scope |
| `inbox_messages`               | `conversation_id`          | tib1   | conversations (db): no FK, target is a stream, dropped, or not reachable from this scope                  |
| `inbox_messages`               | `user_id`                  | tib1   | users (model): no FK, target is a stream, dropped, or not reachable from this scope                       |
| `inbox_messages`               | `agent_id`                 | tib1   | ai_agents (model): no FK, target is a stream, dropped, or not reachable from this scope                   |
| `inbox_messages`               | `contact_id`               | tib1   | contacts (convention): no FK, target is a stream, dropped, or not reachable from this scope               |
| `inbox_messages`               | `template_id`              | tib1   | wa_templates (override): no FK, target is a stream, dropped, or not reachable from this scope             |
| `inbox_messages`               | `ai_reply_id`              | tib1   | inbox_messages (override): no FK, target is a stream, dropped, or not reachable from this scope           |
| `usage_charges`                | `user_id`                  | wallet | users (convention): no FK, target is a stream, dropped, or not reachable from this scope                  |
| `usage_charges`                | `wallet_tx_id`             | wallet | no target table found: loose reference                                                                    |
| `wallet_transactions`          | `subject_id`               | wallet | no target table found: loose reference                                                                    |
| `impersonation_sessions`       | `admin_user_id`            | wsp    | users (override): no FK, target is a stream, dropped, or not reachable from this scope                    |
| `workspace_email_accounts`     | `mailtrixy_account_id`     | wsp    | no target table found: loose reference                                                                    |
| `workspace_email_accounts`     | `mtx_workspace_id`         | wsp    | no target table found: loose reference                                                                    |
| `workspace_email_accounts`     | `mtx_last_message_id`      | wsp    | no target table found: loose reference                                                                    |

## Streams (monthly partitions)

Add each to `PARTITIONED_TABLES` in `apps/api/src/workers/partition-maintenance.service.ts` (or make that list discover `pg_partitioned_table`): until then they only have the bootstrap partitions and `_default`.

- `ai_crm_actions` (partition key `created_at`, domain aicrm)
- `ai_token_usage` (partition key `created_at`, domain aiadm)
- `auto_reply_lookups` (partition key `created_at`, domain ar)
- `conversation_events` (partition key `created_at`, domain chat)
- `hubspot_integration_logs` (partition key `created_at`, domain intg)
- `inbox_messages` (partition key `created_at`, domain tib1)
- `invoice_logs` (partition key `created_at`, domain inv)
- `keyword_reply_logs` (partition key `fired_at`, domain ar)
- `messages` (partition key `created_at`, domain chat)
- `shopify_integration_logs` (partition key `created_at`, domain ecom)
- `slack_integration_logs` (partition key `created_at`, domain intg)
- `translation_usage` (partition key `created_at`, domain i18n)
- `trello_integration_logs` (partition key `created_at`, domain intg)
- `usage_charges` (partition key `created_at`, domain wallet)
- `wa_call_events` (partition key `received_at`, domain call)
- `webhook_deliveries` (partition key `fired_at`, domain intg)
- `woocommerce_integration_logs` (partition key `created_at`, domain ecom)

## Secret columns (ciphertext, never plain)

Stored as `text`. The application encrypts and decrypts through the credential pattern (AES-GCM); the database cannot check it.

- `admin_ai_keys`: `api_key`
- `ai_call_assistants`: `ai_api_key_encrypted`, `voice_api_key_encrypted`
- `ai_provider_keys`: `api_key`
- `devices`: `proxy_password`
- `facebook_pages`: `access_token`
- `hubspot_integrations`: `access_token`, `refresh_token`
- `line_channels`: `channel_access_token`, `channel_secret`, `assertion_private_key`, `rotating_token`, `rotating_token_key_id`
- `outbound_webhooks`: `secret`
- `payment_gateways`: `credentials`
- `shopify_cart_recoveries`: `checkout_token`
- `shopify_integrations`: `access_token`
- `slack_integrations`: `bot_token`, `signing_secret`
- `telegram_bots`: `bot_token`, `secret_token`, `payment_provider_token`
- `tiktok_accounts`: `access_token`, `refresh_token`
- `tiktok_shops`: `access_token`, `refresh_token`
- `translation_providers`: `credentials`
- `trello_integrations`: `api_key`, `api_secret`, `token`
- `user_device_tokens`: `fcm_token`
- `viber_channels`: `auth_token`
- `wa_catalogs`: `access_token_enc`
- `wa_merchant_gateways`: `credentials`
- `wa_provider_configs`: `credentials_json`
- `webhooks`: `secret`
- `wechat_channels`: `app_secret`, `verify_token`, `cached_access_token`
- `woocommerce_cart_recoveries`: `checkout_token`
- `woocommerce_integrations`: `consumer_secret`

## JSON columns (shape still to be defined)

`jsonb` is storage only. WaDesk never validated these. Each needs a Zod schema in `@crm/contracts` before a feature relies on its shape.

- `agent_statuses`: `preferences`
- `ai_agents`: `handoff_keywords`, `device_ids`
- `ai_call_assistant_tools`: `trigger_keywords_json`, `headers_json`, `parameters_json`
- `ai_call_assistants`: `voice_settings_json`, `stt_settings_json`, `exit_keywords_json`, `meta_json`, `device_ids`
- `ai_call_logs`: `transcript_json`, `tool_calls_json`, `meta_json`
- `ai_crm_actions`: `params`
- `appointments`: `meta`, `answers`, `reminders_sent`
- `blog_posts`: `tags`
- `booking_questions`: `options`
- `booking_templates`: `variable_map`
- `booking_types`: `meta`
- `broadcasts`: `template_overrides`, `messages_log`, `button_text`
- `chatbot_widgets`: `allowed_domains`
- `conversation_events`: `payload`
- `conversation_notes`: `mentions`
- `conversations`: `routing_meta`, `escalation_action`
- `coupons`: `applicable_package_ids`
- `crm_briefs`: `meta_json`
- `deal_activities`: `meta`
- `deals`: `meta`
- `devices`: `warmer_config`
- `extensions`: `files`, `manifest`
- `facebook_broadcasts`: `buttons`
- `facebook_pages`: `scopes`, `tasks`, `meta_json`
- `facebook_posts`: `media_json`, `meta_json`
- `flow_templates`: `flow_data`
- `flows`: `flow_data`
- `google_form_sessions`: `answers_json`
- `hubspot_integration_logs`: `payload`, `response`
- `hubspot_integrations`: `metadata`
- `inbox_messages`: `meta`
- `inbox_notifications`: `data`
- `incoming_webhook_events`: `headers`
- `incoming_webhooks`: `lead_config`, `template_config`
- `invoice_items`: `meta_json`
- `invoice_logs`: `meta_json`
- `invoice_settings`: `meta_json`, `seller_extra_json`
- `invoices`: `billing_json`, `shipping_json`, `seller_snapshot_json`, `meta_json`
- `keyword_replies`: `keyword_translations`, `working_hours`, `excluded_numbers`, `excluded_group_ids`
- `keyword_reply_contents`: `content_translations`
- `leads`: `raw`
- `legal_pages`: `sections`
- `line_broadcasts`: `buttons`
- `line_flow_sessions`: `await_options`, `vars`
- `line_rich_menus`: `size`, `areas`
- `messages`: `meta`
- `meta_campaigns`: `targeting`, `special_ad_categories`, `insights`
- `orders`: `gateway_payload`
- `outbound_webhooks`: `events`
- `packages`: `grants_json`
- `payment_gateways`: `extra_config`, `supported_currencies`
- `payments`: `meta_json`
- `playbooks`: `steps`
- `routing_rules`: `conditions`, `actions`
- `sales_docs`: `items_json`
- `saved_replies`: `attachments`
- `scheduled_messages`: `template_overrides`, `days_of_week`, `target_queues`, `target_groups`, `target_numbers`
- `shopify_cart_recoveries`: `scheduled_ids`
- `shopify_integration_events`: `var_map`
- `shopify_integration_logs`: `payload`, `response`
- `shopify_integrations`: `metadata`, `sync_stats`
- `sla_policies`: `device_ids`, `priority_overrides`
- `slack_integrations`: `metadata`
- `storefront_cart_recoveries`: `items_json`, `scheduled_ids`
- `subscriptions`: `meta`
- `support_messages`: `attachments`
- `support_tickets`: `tags`, `meta`
- `team_chat_messages`: `mentions`
- `telegram_flow_sessions`: `await_options`
- `tiktok_accounts`: `scopes`, `meta_json`
- `tiktok_posts`: `media_json`, `meta_json`
- `tiktok_shops`: `meta_json`
- `translation_providers`: `extra_config`
- `trello_integrations`: `events`, `member_map`, `metadata`
- `user_device_tokens`: `device_info`
- `user_settings`: `quick_access`
- `viber_broadcasts`: `buttons`
- `viber_flow_sessions`: `await_options`, `vars`
- `wa_call_events`: `payload`
- `wa_calls`: `error_payload`, `meta_payload`
- `wa_catalogs`: `meta_json`
- `wa_form_submissions`: `answers_json`, `meta_payload`
- `wa_forms`: `definition_json`
- `wa_groups`: `meta_json`
- `wa_merchant_gateways`: `meta`
- `wa_order_items`: `meta_json`
- `wa_orders`: `items_json`, `tax_lines_json`, `meta_json`
- `wa_pending_orders`: `items_json`, `unavailable_json`
- `wa_product_sets`: `product_ids`
- `wa_products`: `tags_json`, `aliases_json`, `gallery_json`
- `wa_provider_configs`: `calling_enabled_meta`, `meta_json`, `warmer_config`
- `wa_storefronts`: `settings_json`, `shipping_json`, `payment_config_json`
- `wa_templates`: `header_location`, `buttons`, `carousel_data`, `variable_map`
- `waba_groups`: `meta_json`
- `wallet_transactions`: `meta`
- `webhook_deliveries`: `payload`
- `webhooks`: `events`
- `wechat_broadcasts`: `buttons`
- `wechat_flow_sessions`: `await_options`, `vars`
- `woocommerce_cart_recoveries`: `scheduled_ids`
- `woocommerce_integration_events`: `var_map`
- `woocommerce_integration_logs`: `payload`, `response`
- `woocommerce_integrations`: `metadata`, `sync_stats`
- `workspace_payment_configs`: `meta_json`
- `wpcampaigns`: `custom_buttons`, `custom_quick_replies`, `custom_variable_map`, `template_overrides`, `template_overrides_b`

## Uniqueness that is not per tenant

A WaDesk unique key without `workspace_id` stays global (it is stricter, and some are looked up before a tenant is known).

- `ai_call_logs`: `uq_ai_call_logs_twilio_call_sid` on (twilio_call_sid)
- `appointments`: `uq_appointments_manage_token` on (manage_token)
- `chatbot_widget_visitors`: `uq_chatbot_widget_visitors_visitor_uuid` on (visitor_uuid)
- `chatbot_widgets`: `uq_chatbot_widgets_embed_token` on (embed_token)
- `crm_briefs`: `uq_crm_briefs_public_token` on (public_token)
- `google_form_sessions`: `uq_google_form_sessions_webhook_token` on (webhook_token)
- `incoming_webhooks`: `uq_incoming_webhooks_token` on (token)
- `invoices`: `uq_invoices_public_token` on (public_token)
- `line_channels`: `uq_line_channels_webhook_token` on (webhook_token)
- `orders`: `uq_orders_order_number` on (order_number)
- `push_subscriptions`: `uq_push_subscriptions_endpoint_hash` on (endpoint_hash)
- `sales_docs`: `uq_sales_docs_public_token` on (public_token)
- `slack_integrations`: `uq_slack_integrations_team_id` on (team_id)
- `support_tickets`: `uq_support_tickets_ticket_number` on (ticket_number)
- `telegram_bots`: `uq_telegram_bots_webhook_token` on (webhook_token)
- `user_device_tokens`: `uq_user_device_tokens_token_hash` on (token_hash)
- `viber_channels`: `uq_viber_channels_webhook_token` on (webhook_token)
- `wa_calls`: `uq_wa_calls_correlation_id` on (correlation_id)
- `wa_calls`: `uq_wa_calls_meta_call_id` on (meta_call_id)
- `wa_chat_links`: `uq_wa_chat_links_slug` on (slug)
- `wa_link_clicks`: `uq_wa_link_clicks_token` on (token)
- `wa_storefronts`: `uq_wa_storefronts_custom_domain` on (custom_domain)
- `wa_storefronts`: `uq_wa_storefronts_slug` on (slug)
- `wa_templates`: `uq_wa_templates_meta_template_id` on (meta_template_id)
- `wechat_channels`: `uq_wechat_channels_webhook_token` on (webhook_token)

## Soft deletes dropped

WaDesk soft-deletes these tables; here a delete is a hard delete plus an audit row (ADR-0009). If a feature needs restore, add `is_archived` for that table.

- `ai_call_assistants`
- `ai_chat_assistants`
- `ai_training_sources`
- `appointments`
- `booking_types`
- `chatbot_widgets`
- `conversation_notes`
- `flows`
- `inbox_messages`
- `keyword_replies`
- `messages`
- `scheduled_messages`
- `support_tickets`
- `team_chat_channels`
- `team_chat_messages`
- `wa_chat_links`
- `wa_forms`
- `wa_products`
- `workspaces` (mapped to an existing table)
- `teams` (mapped to an existing table)
- `users` (mapped to an existing table)

## Reviewer findings from reading WaDesk's code

Verified against the WaDesk source by reading models, controllers, services and the Node bridge. Facts only.

### Enum-like columns (closed value sets found in code)

Not enforced by a CHECK: values were gathered from validation rules and constants, and WaDesk's own data may hold others. Add a CHECK when the feature is ported and the set is confirmed.

- `admin_ai_keys.provider`: openai, anthropic, gemini, mistral, openrouter, deepseek, xai, perplexity, groq, qwen, moonshot, zai, cohere, nvidia, llama, huggingface, baidu, ai21, reka, yi, elevenlabs, deepgram
- `agent_statuses.status`: online, away, busy, offline
- `ai_agents.asr_provider`: openai, whisper
- `ai_agents.provider`: openai, anthropic, gemini, mistral, deepseek, xai, perplexity, groq, qwen, moonshot, zai, cohere, nvidia, llama, huggingface, baidu, ai21, reka, yi, openrouter
- `ai_agents.tone`: friendly, professional, concise, empathetic
- `ai_agents.voice_provider`: openai, elevenlabs
- `ai_call_assistant_tools.http_method`: GET, POST, PUT, PATCH, DELETE
- `ai_call_assistants.ai_provider`: gemini, openai, anthropic
- `ai_call_assistants.status`: live, draft, paused
- `ai_call_assistants.voice_provider`: elevenlabs, openai, deepgram
- `ai_call_logs.direction`: inbound, outbound
- `ai_call_logs.status`: in-progress, completed, no-answer, failed, busy, declined
- `ai_chat_assistants.ai_provider`: openai, anthropic, gemini, mistral, deepseek, xai, perplexity, groq, qwen, moonshot, zai, cohere, nvidia, llama, huggingface, baidu, ai21, reka, yi, openrouter
- `ai_chat_assistants.status`: active, paused
- `ai_crm_actions.channel`: dashboard, whatsapp
- `ai_crm_actions.kind`: read, write
- `ai_crm_actions.status`: ok, error, needs_confirm, confirmed, cancelled
- `ai_provider_keys.provider`: openai, anthropic, gemini, mistral, deepseek, xai, perplexity, groq, qwen, moonshot, zai, cohere, nvidia, llama, huggingface, baidu, ai21, reka, yi, openrouter, elevenlabs, deepgram
- `ai_token_usage.billed_against`: admin, workspace
- `ai_training_sources.kind`: url, text, qa, file
- `ai_training_sources.status`: pending, ready, failed
- `announcements.tone`: info, promo, warning, success
- `appointments.status`: pending, confirmed, cancelled, completed, no_show
- `blog_posts.status`: draft, published
- `booking_questions.map_to_contact_field`: email, name, mobile
- `broadcast_contacts.status`: pending, sent, delivered, read, failed
- `broadcasts.status`: scheduled, processing, completed, completed_with_errors, failed
- `bsp_credit_allocations.credit_source`: meta, aggregator
- `bsp_credit_allocations.status`: attached, revoked, failed
- `chat_templates.category`: marketing, utility, authentication
- `chat_templates.status`: approved, pending, rejected, public
- `chatbot_widgets.body_bg_kind`: color, image
- `chatbot_widgets.mode`: ai, whatsapp, both
- `chatbot_widgets.position`: bottom_right, bottom_left
- `chatbot_widgets.status`: active, paused
- `contact_messages.topic`: sales, support, partnership, other
- `conversation_events.actor_type`: user, human, system, rule, flow, platform_admin
- `conversation_participants.role`: assignee, watcher, mentioned, follower
- `conversations.channel`: whatsapp, chatbot_widget, instagram, facebook, tiktok, telegram, line, wechat, viber, sms, email
- `conversations.inbox_status`: open, pending, snoozed, resolved, closed, spam
- `conversations.priority`: low, normal, high, urgent
- `coupons.type`: percent, fixed
- `crm_briefs.subject_type`: contact, company, deal
- `deal_activities.type`: note, stage_change, call, message, task
- `deals.source`: manual, inbox, order, shopify, woo, form, api, flow, facebook
- `deals.status`: open, won, lost
- `devices.proxy_status`: ok, unreachable
- `devices.proxy_type`: http, socks5
- `devices.status`: connected, disconnected, needs_pair, failed
- `extensions.status`: active, disabled
- `facebook_broadcast_recipients.status`: pending, sent, failed, blocked
- `facebook_broadcasts.status`: draft, sending, done, failed
- `facebook_pages.connect_method`: oauth, embedded, manual
- `facebook_pages.status`: connected, disconnected, expired, error
- `facebook_posts.status`: draft, scheduled, published, failed
- `facebook_posts.type`: text, link, photo, multi_photo, video, reel
- `flow_connected_devices.status`: active, disconnected
- `flow_retry_logs.outcome`: queued, succeeded, failed
- `flow_subscribers.status`: active, paused, completed, failed
- `flow_templates.flow_type`: chat, call, instagram
- `flows.flow_type`: chat, call, instagram, facebook, tiktok, telegram, line, wechat, viber, email
- `flows.trigger_kind`: keyword, tag_added, group_join, manual_enroll, contact_created, opt_in, order_placed, appointment_booked, deal_stage_changed, away, out_of_hours, comment_to_dm
- `frontend_content.type`: text, json, image
- `hubspot_integration_logs.status`: sent, failed
- `hubspot_integrations.status`: active, error
- `inbox_messages.direction`: out, in
- `inbox_messages.status`: pending, sent, delivered, read, failed
- `invoice_settings.trigger_own`: on_placed, on_paid, on_fulfilled
- `invoice_settings.trigger_shopify`: on_placed, on_paid, on_fulfilled
- `invoice_settings.trigger_woocommerce`: on_placed, on_paid, on_fulfilled
- `invoices.doc_type`: tax_invoice, receipt, proforma, credit_note
- `invoices.send_status`: pending, rendering, ready, sending, sent, send_failed, skipped
- `invoices.source`: woocommerce, shopify, own, manual
- `invoices.status`: issued, paid, void, credited
- `invoices.trigger`: on_placed, on_paid, on_fulfilled, manual
- `keyword_replies.ig_trigger`: dm_keyword, comment_to_dm, story_reply, story_mention, mention
- `keyword_replies.matching_method`: exact, fuzzy, contains, regex
- `keyword_replies.message_type`: text, image, video, document, template
- `keyword_replies.reply_type`: custom, flow, share_contact, send_catalog, request_location
- `keyword_replies.resend_unit`: minutes, hours, days
- `keyword_replies.resume_unit`: minutes, hours, days
- `keyword_replies.trigger_type`: keyword, welcome, out_of_hours, away
- `keyword_reply_contents.content_type`: text, image, video, document, template
- `keyword_reply_contents.variant_role`: primary, outside_hours
- `leads.source`: osm, google
- `legal_pages.slug`: terms, privacy, refund, cookies, acceptable-use
- `line_broadcast_recipients.status`: pending, sent, failed, blocked
- `line_broadcasts.media_kind`: image, video, audio
- `line_broadcasts.status`: draft, sending, done, failed
- `line_flow_sessions.status`: running, waiting, sleeping, done, failed
- `line_rich_menus.layout`: full, large-2col, large-3col, large-2x2, large-2x3, compact-1, compact-2col, compact-3col
- `message_charges.provider`: waba, baileys, twilio
- `message_charges.source`: chat, campaign, broadcast, flow, scheduled, autoreply, api
- `message_rates.category`: , marketing, utility, authentication, service
- `messages.direction`: out, in
- `messages.status`: pending, scheduled, sent, delivered, read, failed
- `meta_campaigns.bid_strategy`: LOWEST_COST_WITHOUT_CAP, LOWEST_COST_WITH_BID_CAP, COST_CAP
- `meta_campaigns.budget_level`: adset, campaign
- `meta_campaigns.ctwa_cta`: WHATSAPP_MESSAGE, LEARN_MORE, SHOP_NOW, SIGN_UP, BOOK_TRAVEL, GET_QUOTE, CONTACT_US
- `meta_campaigns.optimization_goal`: MESSAGES, LINK_CLICKS, CONVERSIONS, LEAD_GENERATION, REACH, BRAND_AWARENESS, VIDEO_VIEWS
- `meta_campaigns.status`: ACTIVE, PAUSED, SCHEDULED, DRAFT, FAILED
- `notifications.severity`: info, success, warning, danger
- `orders.billing_period`: monthly, yearly
- `orders.status`: pending, paid, failed, refunded
- `packages.plan_unit`: days, weeks, months, years
- `packages.type`: plan, addon
- `payment_gateways.mode`: sandbox, live
- `payments.method`: manual, cash, bank, card, upi, gateway, wa_pay, storefront
- `payments.source`: manual, gateway, wa_pay, storefront
- `platform_notes.severity`: info, warn, critical
- `playbooks.trigger_type`: manual, status_change, tag_added
- `pricing_faqs.placement`: pricing, home, both
- `projects.status`: in_progress, completed
- `sales_docs.doc_type`: proposal, estimate
- `sales_docs.status`: draft, sent, accepted, rejected, expired, invoiced
- `scheduled_messages.provider`: baileys, waba, twilio
- `scheduled_messages.recipient_type`: group, queue, number, tag
- `scheduled_messages.repeat_interval`: daily, weekly, monthly
- `scheduled_messages.status`: scheduled, running, paused, completed, failed, cancelled
- `shopify_cart_recoveries.status`: active, recovered, done
- `shopify_cod_confirmations.status`: pending, confirmed, cancelled
- `shopify_integration_events.event_type`: orders/create, orders/updated, orders/paid, orders/fulfilled, orders/cancelled, fulfillments/update, refunds/create, products/update, customers/create, customers/update, checkouts/create, app/uninstalled, cod/confirm, cod/prepaid, stock/back, order/delivered, cart/step2, cart/step3
- `shopify_integration_events.send_to`: customer, admin, both
- `shopify_integration_logs.status`: received, processed, sent, failed, skipped
- `shopify_integrations.status`: active, inactive, error
- `shopify_stock_waitlist.status`: waiting, notified
- `sla_breaches.breach_type`: first_response, resolution
- `sla_breaches.severity`: warn, breach, hard_breach
- `slack_integration_logs.status`: ok, error, no_match
- `storefront_cart_recoveries.status`: active, recovered, expired
- `subscriptions.billing_cycle`: monthly, yearly
- `subscriptions.status`: pending, active, past_due, canceled, expired
- `support_messages.author_role`: admin, customer, system
- `support_tickets.priority`: low, normal, high, urgent
- `support_tickets.reason`: bug, delivery, template, billing, integration, account, other
- `support_tickets.status`: open, in_progress, pending, resolved, closed
- `tasks.priority`: low, medium, high
- `tasks.related_type`: contact, deal, company
- `tasks.status`: open, done
- `telegram_broadcast_recipients.kind`: private, group
- `telegram_broadcast_recipients.status`: pending, sent, failed, blocked
- `telegram_broadcasts.media_kind`: image, animation, video, audio, document
- `telegram_broadcasts.status`: draft, sending, done, failed
- `telegram_flow_sessions.status`: running, waiting, sleeping, done, failed
- `tiktok_accounts.status`: connected, needs_reconnect, expired, error
- `tiktok_posts.status`: draft, processing, scheduled, published, failed
- `tiktok_posts.type`: video, photo
- `translation_providers.slug`: mymemory, google_gtx, libretranslate, deepl, google_cloud
- `translation_usage.provider_slug`: mymemory, google_gtx, libretranslate, deepl, google_cloud
- `trello_integration_logs.status`: ok, error
- `trello_integrations.notify_mode`: assignee, fixed
- `user_device_tokens.platform`: android, ios
- `viber_broadcast_recipients.status`: pending, sent, failed
- `viber_broadcasts.media_kind`: image, video
- `viber_broadcasts.status`: draft, sending, done, failed
- `viber_flow_sessions.status`: running, waiting, sleeping, done, failed
- `wa_catalogs.provider`: meta_cloud, dialog_360
- `wa_chat_links.status`: active, paused
- `wa_coupons.type`: percent, flat
- `wa_forms.status`: draft, published, paused
- `wa_merchant_gateways.mode`: live, test
- `wa_orders.rto_band`: low, medium, high
- `wa_orders.source`: waba, storefront, twilio, manual, shopify, woocommerce, whatsapp_ai
- `wa_orders.status`: new, pending, confirmed, paid, processing, completed, shipped, cancelled
- `wa_orders.wa_payment_status`: pending, captured, failed, refunded
- `wa_pending_orders.status`: pending, confirmed, cancelled
- `wa_product_reviews.status`: pending, approved, rejected
- `wa_products.meta_sync_status`: pending, synced, failed
- `wa_products.status`: active, draft, archived
- `wa_provider_configs.provider`: waba, baileys, twilio, sms, meta_ads
- `wa_provider_configs.status`: pending, connected, disconnected, failed
- `wa_stock_reservations.status`: held, committed, released
- `wa_storefronts.currency_code`: INR, USD, EUR, GBP, AED, KES, NGN, ZAR, BRL, MXN, CRC, PHP, IDR, SGD, MYR, THB, VND, EGP, PKR, BDT, LKR
- `wa_storefronts.payment_provider`: upi, razorpay_link, razorpay_api, stripe_link, paypal_me, bank_transfer
- `wa_storefronts.theme_key`: aurora, meridian, verdure, bazaar, noir, kraft, mercato, studio
- `wa_templates.attachment_type`: none, image, video, document, location
- `wa_templates.channel`: baileys, waba, twilio, instagram, facebook, telegram, line, wechat, viber
- `wa_templates.meta_category`: marketing, authentication, utility
- `wa_templates.meta_status`: PENDING, APPROVED, REJECTED, IN_APPEAL, PENDING_DELETION, DELETED, DISABLED, PAUSED, LIMIT_EXCEEDED, FLAGGED
- `wa_templates.parameter_format`: POSITIONAL, NAMED
- `wa_templates.quality_score`: UNKNOWN, GREEN, YELLOW, RED
- `wa_templates.status`: pending, approved, rejected, public
- `wa_templates.template_type`: standard, carousel, media, auth, catalog
- `waba_groups.join_approval_mode`: approval_required, auto_approve
- `wallet_transactions.kind`: credit, currency
- `wallet_transactions.type`: earn, spend, refund, admin_adjust, topup
- `warmer_daily_sends.engine`: baileys, waba, twilio
- `webhooks.http_method`: POST, PUT
- `wechat_broadcast_recipients.status`: pending, sent, failed
- `wechat_broadcasts.audience`: all, tag, list
- `wechat_broadcasts.status`: draft, sending, done, failed
- `wechat_channels.enc_mode`: plain, compat, safe
- `wechat_flow_sessions.status`: running, waiting, sleeping, done, failed
- `woocommerce_cart_recoveries.status`: active, recovered, done
- `woocommerce_cod_confirmations.status`: pending, confirmed, cancelled
- `woocommerce_integration_events.event_type`: order.created, order.updated, order.deleted, customer.created, customer.updated, product.created, product.updated, order.processing, order.completed, order.on-hold, order.cancelled, order.refunded, order.failed, cod/confirm, cod/prepaid, stock/back, checkout.created, cart/step2, cart/step3, subscription.payment_failed, review/reward
- `woocommerce_integration_events.send_to`: customer, admin, both
- `woocommerce_integration_logs.status`: received, processed, sent, failed, skipped
- `woocommerce_integrations.status`: active, inactive, error
- `woocommerce_stock_waitlist.status`: waiting, notified
- `workspace_flags.flag`: spam, abuse, fraud, billing_overdue, tos_violation, frozen
- `workspace_ig_accounts.status`: connected, disconnected
- `workspace_payment_configs.payment_type`: razorpay, payu, billdesk, zaakpay
- `wp_campaign_contacts.status`: queued, pending, sent, delivered, read, responded, failed, unsubscribed
- `wp_campaign_contacts.variant`: A, B
- `wpcampaigns.campaign_type`: text, template, button, flow, media, custom
- `wpcampaigns.repeat_interval`: daily, weekly, monthly
- `wpcampaigns.schedule_type`: now, scheduled, recurring

### Uniqueness the application enforces without a database key

- `sla_breaches` (ticket_id, breach_type): The SLA scan does an exists() check on (ticket_id, breach_type) before inserting so each ticket gets at most one breach row per type, but WaDesk only has a plain index.
- `sla_policies` (workspace_id, is_default): Partial unique where is_default is true: code clears every other default in the same scope on save (workspace_id NULL is the platform-wide scope), but no DB constraint exists.
- `keyword_replies` (workspace_id, device_id, keyword): CSV import updateOrCreate and the edit fan-out firstOrNew both key on this triple with no DB unique key, and device_id is polymorphic by provider so provider belongs in the key too.
- `broadcast_contacts` (broadcast_id, contact_id): Contact ids are de-duplicated before being attached and Node status callbacks UPDATE by (broadcast_id, contact_id), but WaDesk has no DB unique key for the pair.
- `bsp_credit_allocations` (workspace_id, waba_id): CreditAllocationService attaches idempotently with updateOrCreate on this pair (retrying failed or revoked rows in place) but the table has no unique key.
- `contact_groups` (workspace_id, user_group): Group creation and CSV import look up an existing group by trimmed, case-insensitive name per workspace in PHP (the name is encrypted, so WaDesk has no DB key) and reuse it instead of creating a duplicate.
- `devices` (workspace_id, country_code, phone_number): DevicesController::store rejects a device whose digits-only country_code plus phone_number already exists in the workspace, checked in PHP because both columns are encrypted.
- `conversations` (workspace_id, contact_digits): ConversationResolver enforces one thread per customer digits per workspace (and per receiving business number only when the workspace has 2+ numbers), so it is an app-level rule rather than a plain unique key.
- `inbox_messages` (conversation_id, meta->>wa_message_id): InboxMirror and the inbound endpoint check for an existing row with the same provider message id in the conversation before inserting (InboxMirror also de-dupes on meta src_key), as the id has no column.
- `wa_provider_configs` (workspace_id, provider): Connecting baileys, twilio or meta_ads uses firstOrNew on (workspace_id, provider), so each workspace has at most one row per those providers (WABA and sms allow many).
- `wa_provider_configs` (workspace_id, provider, phone_number): SMS connect uses firstOrNew on workspace, provider='sms' and phone_number, so re-connecting the same number updates the row while a different number adds a sender.
- `wa_provider_configs` (workspace_id, meta_json->>waba_id, meta_json->>phone_number_id): For provider='waba' the connect flow matches an existing row on the waba_id and phone_number_id stored in meta_json and updates it in place instead of adding a duplicate.
- `wa_provider_configs` (workspace_id, is_primary): setAsPrimary demotes every sibling row in one transaction, so at most one row per workspace is primary (a partial unique index WHERE is_primary).
- `wa_templates` (workspace_id, channel, template_name): The Instagram template sync upserts on this key for channel='instagram' only, and name is encrypted in WaDesk so no DB key exists; WABA names are unique per language instead.
- `flow_connected_devices` (flow_id): Partial (status = 'active'): connectDevice marks every earlier row of the flow 'disconnected' before inserting the new active one, so at most one active row per flow.
- `google_form_sessions` (flow_session_id, google_form_id): Partial (submitted_at IS NULL): GoogleFlowNodeController deletes stale unsubmitted rows for the same session and form before creating a fresh one.
- `facebook_broadcast_recipients` (facebook_broadcast_id, psid): FacebookBroadcastController de-duplicates the picked PSIDs (collection unique()) before bulk-inserting the recipient snapshot, so each PSID appears once per broadcast.
- `impersonation_sessions` (admin_user_id): Code closes any open session of the same admin before inserting a new one, so at most one row per admin with ended_at IS NULL (partial unique).
- `translation_providers` (is_default): Setting a default first clears is_default on every row then sets one, so at most one row with is_default true (partial unique).
- `line_rich_menus` (line_channel_id, is_default): Setting a default clears is_default on all other menus of the same channel, so at most one default per channel (partial unique where is_default).
- `line_channels` (workspace_id, basic_id): Re-pasting the same OA credentials updates the existing row matched on (workspace, basic_id) instead of inserting.
- `workspace_email_accounts` (mailtrixy_account_id): Link flow rejects a mailbox already linked to another workspace (exists check), so the account id is unique across all workspaces, which a tenant-scoped unique cannot express.
- `line_broadcast_recipients` (line_broadcast_id, line_user_id): Recipient ids are de-duplicated in code before the snapshot insert, so each LINE user appears once per broadcast.
- `sales_docs` (workspace_id, doc_type, seq): Both SalesDocsController and the AI toolkit compute seq as max(seq)+1 per workspace and doc_type and derive number from it, with no DB unique key.
- `support_agents` (user_id): Code always inserts workspace_id NULL and uses firstOrCreate on user_id, so the DB unique (user_id, workspace_id) never fires because NULLs do not collide.
- `scheduled_message_contacts` (scheduled_message_id, phone): Rows are de-duplicated by phone digits before the bulk insert and the status callback finds-or-creates by (scheduled_message_id, phone), but the DB only has a plain index.
- `meta_campaigns` (workspace_id, facebook_id): The Meta import looks up an existing row by facebook_id within the workspace before creating, with no DB unique key; facebook_id is NULL for locally drafted campaigns.
- `wallet_transactions` (user_id, source, subject_type, subject_id): WalletService::refund uses an exists() check for refund idempotency, so this would be a partial unique only where source = 'refund' (other rows legitimately repeat a subject).
- `shopify_stock_waitlist` (shopify_product_id, customer_phone, status): Opt-in uses firstOrCreate on workspace + product + phone + status='waiting' with no DB key, so enforce one waiting row per phone per product as a partial unique where status='waiting'.
- `woocommerce_stock_waitlist` (woo_product_id, customer_phone, status): Opt-in uses firstOrCreate on workspace + product + phone + status='waiting' with no DB key, so enforce one waiting row per phone per product as a partial unique where status='waiting'.
- `storefront_cart_recoveries` (storefront_id, customer_phone, status): scheduleRecovery checks exists() for an active row per storefront and phone before inserting, so enforce a partial unique where status='active'.
- `telegram_bots` (bot_id): adoptToken looks up an existing bot by workspace + Telegram bot_id and updates it instead of inserting, so (org, bot_id) is unique in practice though WaDesk only indexes bot_id.
- `telegram_broadcast_recipients` (telegram_broadcast_id, chat_id): The composer de-duplicates the picked chat ids before snapshotting recipients, so each chat appears once per broadcast without a DB key.
- `viber_channels` (workspace_id, viber_id): Reconnecting a bot looks up the existing row by workspace and viber_id before creating one (only when viber_id is non-empty).
- `wechat_channels` (workspace_id, app_id): Re-pasting the same Official Account matches the existing row on workspace and app_id and reuses its webhook_token.
- `tiktok_posts` (publish_id): The publish webhook finds the post by publish_id alone and takes the first match (TikTok's publish handle is unique; nullable).
- `viber_broadcast_recipients` (viber_broadcast_id, viber_user_id): Recipient ids are de-duplicated in code before the bulk insert, so a user appears once per broadcast.
- `wechat_broadcast_recipients` (wechat_broadcast_id, openid): OpenIDs are de-duplicated in code before the bulk insert, so a user appears once per broadcast.
- `wa_products` (workspace_id, shopify_product_id): The Shopify importer uses updateOrCreate on this pair; WaDesk only has a plain index (nullable column).
- `wa_products` (workspace_id, woo_product_id): The WooCommerce importer uses updateOrCreate on this pair; WaDesk only has a plain index (nullable column).
- `wa_orders` (workspace_id, shopify_order_id): The Shopify importer uses updateOrCreate on this pair; WaDesk only has a plain index (nullable column).
- `wa_orders` (workspace_id, woo_order_id): The WooCommerce importer uses updateOrCreate on this pair; WaDesk only has a plain index (nullable column).
- `wa_orders` (workspace_id, wa_payment_reference_id): The WhatsApp Pay webhook resolves the order by this pair and takes the first match; the reference id is built to be unique per order.
- `wa_orders` (recovery_token): Public order tracking and checkout-return pages look the order up by this random token alone (nullable).
- `wp_campaign_contacts` (campaign_id, contact_id): SMS and email runners look the recipient row up by this pair and create one only if missing, assuming a single row per contact per campaign.

### Notes per table

**`admin_ai_keys`**

- Platform-wide table with no workspace_id; one row per provider slug (unique), auto-created by the admin api-keys page for all 22 slugs as inactive until a key is saved.
- api_key is encrypted with the Laravel APP_KEY via a custom accessor, so existing ciphertext cannot be read after migration and keys must be re-entered; a failed decrypt reads as null.
- extra_config holds a JSON object of provider-specific fields (for example organization or project ids) squeezed into varchar(500); use jsonb without the length cap.
- Used by AiKeyResolver as the fallback key when the workspace plan lacks BYOK or has no own key for that provider; is_active flips to true automatically when a key is saved.

**`agent_statuses`**

- user_id is NOT NULL and (user_id, workspace_id) is unique in WaDesk, so ON DELETE SET NULL cannot apply; the row is meaningless without its user and should cascade.
- Rows are created lazily by firstOrCreate in the RecordAgentActivity middleware, which also touches last_seen_at on every authenticated request, so this is a hot row-update table.
- current_load is the count of open conversations assigned to the user, and today_replies and today_resolutions reset when counters_date is not today.
- preferences is a JSON blob of per-agent notification settings such as sounds and desktop push.

**`ai_agents`**

- temperature is stored as an integer in tenths (0 to 10) and divided by 10 when calling the LLM, unlike ai_chat_assistants.temperature which is a real decimal.
- device_ids is a JSON array of devices.id (unofficial devices) with null or empty meaning any device, whereas ai_call_assistants.device_ids holds wa_provider_configs ids.
- asr_provider and asr_language are not accepted by the create or update validation, so they stay null and the voice factory defaults the ASR provider to openai.
- knowledge_assistant_id optionally links the agent to an ai_chat_assistants row whose training sources are added to its prompt.
- ai_agents.id is referenced from inside JSON and from other tables without FKs: conversations.assignee_agent_id, the workspace default_voice_ai_agent_id and routing rule assign_agent actions.
- messages_sent is an incrementing counter updated on every AI reply.

**`ai_call_assistant_tools`**

- Every wizard save deletes all tools of the assistant and re-inserts them, so row ids are not stable; sort_order is the array index and (assistant_id, function_name) is unique in WaDesk.
- headers_json is a list of key and value pairs and parameters_json is a list of objects with id, label, description and required.

**`ai_call_assistants`**

- device_ids is a JSON array of wa_provider_configs.id (WABA numbers) and NOT devices.id, and code rejects saving a number that already belongs to another assistant in the same workspace.
- ai_api_key_encrypted and voice_api_key_encrypted are optional BYOK overrides encrypted with APP_KEY (Laravel encrypted cast); blank means use the admin global key.
- Only rows with is_active true and status live answer calls; empty device_ids means catch-all for the workspace.
- meta_json holds wizard extras such as persona, languages, greeting_variations, personality, noise_suppression, voicemail_behavior (leave_message or silent_log) and human_handoff_team.
- Soft-deleted in WaDesk (deleted_at) and unique on (workspace_id, slug); the port hard-deletes.
- The Node call bridge reads assistant config and tools through Laravel internal endpoints, not by direct SQL.

**`ai_call_logs`**

- Holds both Twilio-style call logs and mirror rows created from WABA wa_calls by WaCallToAiLogBridge (meta_json.source is waba with meta_json.wa_call_id), so the table mixes two call sources.
- twilio_call_sid is unique and stores Meta's call id for WABA calls; the column name is legacy.
- direction is mapped down to inbound or outbound (WABA's USER_INITIATED and BUSINESS_INITIATED are not stored here).
- recording_url_* hold app-local URLs under /call-logs/{id}/audio/... or public storage URLs rather than provider URLs.
- transcript_json is a list of role, text and t (milliseconds) objects and tool_calls_json a list of name, args, response and t objects, both rebuilt from wa_call_events on terminate.
- cost_minor is in minor units of currency_code and the status column is also used as in-progress while the call is live.

**`ai_chat_assistants`**

- Soft-deleted in WaDesk (deleted_at) and the unique (workspace_id, slug) counted soft-deleted rows; the port hard-deletes so that slug-collision workaround is not needed.
- temperature is a real decimal from 0 to 2 here, while tone is free text (default helpful) with no enforced value set.
- Deleting an assistant also deletes its own ai_training_sources rows in code but leaves workspace-wide sources (assistant_id NULL) alone.
- chatbot_widgets.assistant_id points at this table.

**`ai_crm_actions`**

- Insert-only audit of every AI copilot tool run; params are stored already masked for phones and emails and result_summary is truncated to 500 characters.
- subject_id is paired with subject_type in free labels of mixed case (Contact, Deal, Company, invoice, payment, task, brief, project, sales_doc), so it is polymorphic and has no single FK target.
- user_id is the staff member who issued the command and is null when none was resolved; tokens is a combined count.

**`ai_provider_keys`**

- Per-workspace BYOK key with a unique (workspace_id, provider) in WaDesk, written by updateOrCreate; api_key uses the same APP_KEY encryption as admin_ai_keys and reads as null if undecryptable.
- Saving is gated by the package flag allow_byok_ai_keys (platform admins bypass it) and the provider list also includes the voice providers elevenlabs and deepgram.

**`ai_token_usage`**

- Insert-only ledger written by AiTokenMeter after every AI provider call; it has created_at only and total_tokens is computed in code as prompt plus completion.
- The monthly plan cap sums total_tokens where billed_against is admin since the start of the calendar month (index on workspace_id, created_at); BYOK spend is recorded but not counted.
- The AI CRM copilot records only a combined token count and splits it roughly 60/40 into prompt and completion, so those two columns are approximate for that source.

**`ai_training_sources`**

- assistant_id is nullable on purpose: NULL means workspace-wide knowledge shared by every chat assistant, so the FK must stay nullable.
- kind url, text and qa come from the add-source endpoint and file comes from the upload endpoint, which keeps the original upload on local storage at file_path.
- content holds the extracted plain text (capped at 200k chars) for url, text and file rows, while qa rows use question and answer instead; tokens_estimate is ceil(characters / 4).
- Soft-deleted in WaDesk (deleted_at); the port hard-deletes.

**`ai_voice_usage_daily`**

- Only voice_notes_processed, asr_seconds and tts_chars are ever written (atomic increments via updateOrCreate in AiVoiceReplyService); call_seconds, llm_input_tokens and llm_output_tokens are never written or read.
- (workspace_id, ai_agent_id, date) is unique in WaDesk, but after an agent is deleted ai_agent_id becomes NULL and a Postgres unique will not dedupe those rows.
- The per-agent daily cap check reads voice_notes_processed for today against ai_agents.max_voice_notes_per_day.

**`announcements`**

- Public marquee shows rows where is_active is true and now falls inside the optional starts_at/expires_at window, ordered by sort_order then id.

**`appointments`**

- active_slot_key is the hard double-booking guard (DB unique) formatted booking_type_id:utc_epoch:seat_ordinal and set to NULL unless status is pending or confirmed, so freed slots reopen.
- manage_token is a unique random 48-char public capability token for the guest manage page, so treat it like a secret.
- order_id points at the plan-purchase orders table (a BK- prefixed order created to collect the deposit), not wa_orders.
- staff_id is a reserved placeholder never written by any code, and reminder_sent_at, reminders_sent and checked_in_at are never written by app or node code in this version (reminders are scheduled in Node by a synthetic id).
- contact_id may be null for chat bookings, in which case meta carries customer_name, customer_phone and customer_email, and the sweeper adds meta.needs_review.
- user_id is the workspace owner (owner_user_id), not the invitee or a staff member.

**`auto_reply_lookups`**

- contact_phone and query_text are Laravel-encrypted ciphertext at rest in WaDesk, which is why they are text.
- device_id holds a devices id for Baileys numbers or a wa_provider_configs id for WABA and Twilio numbers with no discriminator column, and is NULL when no sender matched.
- A row is written for every inbound the bot asks about, matched or not (matched_keyword_reply_id is NULL when nothing matched), and rows are never updated.

**`blog_categories`**

- Slug is made unique by a name, name-2, name-3 suffix helper in addition to a DB unique key.

**`blog_posts`**

- tags is a JSON array of trimmed strings parsed from a comma-separated admin input, null when empty.
- featured_image and og_image hold relative paths on the active media disk (not URLs), and og_image falls back to featured_image when empty.
- A post is public only when status is published and published_at is null or not in the future, so a future published_at acts as scheduling.
- views is incremented on every public post view via a direct UPDATE.

**`booking_availability_overrides`**

- One row per booking type and date (DB unique on booking_type_id plus date), and the slot engine only reads rows with is_closed true, so special-hours overrides (start_time/end_time) are stored but never applied.

**`booking_availability_rules`**

- weekday is 0 for Sunday through 6 for Saturday, multiple rows per weekday mean multiple intervals, and times are in the booking type's timezone.
- staff_id is a reserved nullable placeholder with no staff table, no UI and no code that sets it.

**`booking_financials`**

- Strictly one row per booking type (DB unique on booking_type_id) and all amounts are minor currency units.
- gateway_slug refers to payment_gateways.slug by slug, not by id.

**`booking_integrations`**

- Strictly one row per booking type (DB unique on booking_type_id) holding only non-secret Google targeting, with OAuth tokens kept elsewhere.

**`booking_questions`**

- The question label is used as the key inside appointments.answers, and only email, name and mobile are applied to the contact via map_to_contact_field.
- options is a JSON array of choices used when type is select.

**`booking_reminders`**

- offset_index is a stable slot handle 0 to 7 (DB unique with booking_type_id) and offset_minutes means minutes before starts_at, which must be distinct per type.
- template_event defaults to reminder and no other value is written.

**`booking_templates`**

- One row per booking type, event and channel (DB unique); whatsapp, instagram and facebook rows use wa_template_id while telegram and plain sends use plain_body.
- coupon_code and coupon_id are stored but never read by booking code and no screen sets them, and coupon_id targets the platform plan coupons table, not wa_coupons.

**`booking_types`**

- Saving a type deletes and recreates all its child rows (availability rules, overrides, templates, reminders, questions), so child ids are not stable references.
- Slug is unique per workspace (DB unique on workspace_id plus slug), user_id is the creating user, and WaDesk soft-deletes this table.

**`broadcast_contacts`**

- status only moves forward (pending, sent, delivered, read) and failed is terminal, enforced in code, and Twilio's undelivered is mapped to failed.
- Provider webhooks find rows by whatsapp_message_id, so that column needs an index.
- error_message is Laravel-encrypted via a tolerant cast, so legacy rows may hold plaintext.

**`broadcasts`**

- device_id is polymorphic and must be read with provider (devices for baileys, wa_provider_configs for waba, twilio and sms), because a multi-sender send creates one broadcast row per sender with the name suffixed by the sender label.
- name and timezone are Laravel-encrypted ciphertext (hence text) and template_overrides is encrypted JSON, so the port can store plain varchar and jsonb.
- success_count, delivered_count, read_count and fail_count are cumulative rollups recomputed from broadcast_contacts (success = sent+delivered+read, delivered = delivered+read), while clicked_count is incremented by the link-redirect route on a contact's first unique click.
- status, node_schedule_id and the counters are updated by the Node bridge callbacks and status webhooks, not only by the web app.
- temp_caption, temp_image, button_text, latitude, longitude, template_type and messages_log are used only by the mobile-app custom queue API, where template_type is inferred as Plane-Text, Text-With-Media, Image-Only or Text-With-Location and messages_log is capped at 200 entries.
- latitude and longitude are stored as strings (varchar 32), not numbers.

**`bsp_credit_allocations`**

- The model lives in the BSP add-on at app/Bsp/Models/BspCreditAllocation.php (hence model none), has a workspace_id column, and is the only bsp_* table that survives the merge into core wallet tables.
- waba_id and allocation_config_id are external Meta ids kept as strings, and waba_id is read from the workspace's WABA provider credentials rather than from any column, so there is no foreign key.
- Only the meta credit source is implemented (aggregator is documented but unbuilt), a failed attach keeps last_error and can be retried in place, and revoke needs allocation_config_id.

**`chat_templates`**

- No controller or service reads or writes this table; only ChatSeeder inserts the 8 demo rows (user_id stays NULL) and the pickers read wa_templates instead, so porting it is optional.
- It has no workspace_id, so its rows are not tenant data.

**`chatbot_widget_visitors`**

- One row per anonymous browser, identified by a cookie visitor_uuid that is always looked up together with widget_id, and last_seen_at is bumped on every widget request.
- conversation_id is filled when the visitor's first message creates a conversation with channel 'chatbot_widget', and a contacts row keyed by channel_uid = visitor_uuid is created or linked at the same moment.
- ip, user_agent and referrer_url are anonymous-visitor data captured once at first sight.

**`chatbot_widgets`**

- embed_token is the public bearer in the /widget/{token}/* URLs (rotatable, globally unique, looked up by value), so it must stay queryable rather than being stored as an encrypted secret.
- allowed_domains empty or NULL means every origin is allowed; non-empty entries are lowercase bare host[:port] with scheme and path stripped and no wildcard support.
- mode ai or both requires assistant_id (validated to an ai_chat_assistants row in the same workspace) and mode whatsapp or both uses target_whatsapp_cc plus target_whatsapp_number to build a click-to-chat link.
- Only widgets with status 'active' are served publicly, and WaDesk soft-deletes widgets.

**`contact_groups`**

- user_group (the group name) and note are encrypted at rest, so name uniqueness is checked in PHP rather than by a DB key.
- Contacts reference groups through contacts.contact_group, an encrypted JSON array of group ids with no join table, while conversations.contact_group_id is a separate single-group link.

**`contact_messages`**

- Written by the unauthenticated public /contact form (no user or workspace), so ip and user_agent are visitor PII and the insert has no tenant context.

**`conversation_events`**

- Append-only audit timeline written only through ConversationEvent::record (created_at only, no updated_at); the sole mutation is the duplicate-thread merger bulk re-pointing conversation_id.
- actor_user_id is NULL for system, rule and flow actions, and actor_type values seen in code are user, human, system, rule, flow and platform_admin.
- type is an open-ended event name (assigned, reassigned, resolved, reopened, snoozed, tag_added, note_added, priority_changed, sla_breach, routing_rule_fired, first_response, ai_handoff, agent_assigned, spam_flagged and more) and the payload JSON shape varies per type.

**`conversation_notes`**

- body is encrypted at rest, and mentions is a JSON array of objects holding user_id, name and offset (user ids inside JSON, not a relation).
- WaDesk soft-deletes notes and supports editing (edited_at) and pinning (is_pinned).

**`conversation_participants`**

- One row per (conversation, user) pair holding that user's unread counters, created as a 'watcher' when a user opens a thread and as 'mentioned' when they are @mentioned; opening the thread resets both counters.
- WaDesk has a DB unique key on (conversation_id, user_id) for this table.

**`conversation_tag`**

- Pivot with a DB unique key on (conversation_id, tag_id); added_by is NULL when a flow added the tag, and contact_tag is a separate pivot for contacts.

**`conversations`**

- device_id is polymorphic: it holds devices.id for provider baileys (or NULL provider) and wa_provider_configs.id for waba, twilio and sms, and is NULL for web and social channels, so it cannot be one foreign key.
- title and preview are encrypted at rest so search and name-sort happen in PHP, and contact_digits (digits of raw_jid or alt_jid, 'g:<id>' for WhatsApp groups, NULL for widget visitors) is the normalized thread identity set by a model hook on save.
- status is the legacy send-queue lifecycle (pending, sent, failed, scheduled, plus received or open written by inbound and widget threads) and inbox_status is the real inbox lifecycle, so the two must stay separate columns.
- provider is the canonical engine and follows the latest message, platform (W, WB, T, WIDGET, EMAIL, SMS and others) is a legacy column that was mis-stamped and should not be trusted, and channel names the surface.
- user_id only records who started the thread (visibility is workspace-wide), resolved_by is the human who resolved it, and resolved_by_agent_id is the ai_agents id that was assigned at that moment (the same source as assignee_agent_id).
- interested_sku, interested_product_id and interested_seen_at are stamped when a buyer replies to a catalog product card, and interested_product_id is the wa_products row matched by meta_retailer_id or sku (NULL when no product matches).

**`coupons`**

- type percent means amount is a 0 to 100 percentage (max_discount_amount caps it) and type fixed means amount is a value in currency_code (NULL currency_code means any currency).
- code has a DB unique key, is stored upper-case and is matched case-insensitively at checkout.
- applicable_package_ids is a JSON array of packages.id (NULL means any plan), uses_count is incremented by CheckoutController when an order is paid, and per_user_limit counts that user's paid orders with this coupon_id.

**`credit_packages`**

- price_minor and credits are integers in minor currency units for one-time wallet top-up bundles, distinct from subscription packages, and slug has a DB unique key.
- currency_code is a code string that references currencies.code and not an id.

**`crm_briefs`**

- public_token (40 random characters, unique) is served without authentication at /b/{token} as HTML and as a PDF, so token lookup must bypass tenant RLS.
- subject_id is paired with subject_type contact, company or deal, so it is polymorphic with no single FK target.
- html is the full rendered self-contained deck (large longtext); meta_json is never written by any code path.
- created_by is the staff user who generated the brief and is nullable.

**`csat_responses`**

- No code path writes this table (no CSAT sender or recorder exists); the analytics page only reads it as a CSAT proxy, so the feature is effectively unimplemented.
- rating is 1 to 5 and NULL until the customer responds, and comment is encrypted at rest.

**`currencies`**

- code is unique and normalized to upper-case, and exchange_rate is the value of one unit in USD (the system base).
- Other tables reference a currency by this code string (coupons.currency_code, credit_packages.currency_code, deals.currency, pipelines.currency), never by id.

**`deal_activities`**

- A timeline entry whose type is note, stage_change, call, message or task, with body encrypted at rest and meta holding stage ids for stage_change rows.
- Task rows use due_at and done_at, and reminded_at is stamped by the reminder command so each task notifies only once.

**`deals`**

- value_minor is in minor units (cents) and currency is a code string defaulting from the pipeline or workspace currency, not a foreign key to currencies.
- status, won_at and lost_at are derived from the target stage's is_won or is_lost by a model hook on save, and a stage change also writes a deal_activities 'stage_change' row and fires a flow trigger.
- owner_team_id is declared but never read or written by any code, so its target (likely teams) is unconfirmed and it can stay a plain unreferenced column.
- source records which writer created the deal, and every writer must use one of the nine constant values because the board's source filter is built from that list.
- conversation_id links the inbox thread the deal came from and powers the Open in inbox deep link.

**`devices`**

- device_name, country_code, phone_number, proxy_username and proxy_password are encrypted at rest (lookups scan in PHP); country_code is stored as bare digits without a plus sign and phone_number as the local part.
- The Node bridge never touches the database: it reports pairing and connection state, a 30-second heartbeat (last_seen_at, stale devices marked disconnected) and proxy health (proxy_status, proxy_egress_ip, proxy_checked_at) through authenticated Laravel callbacks.
- sent_24h and failed_24h are read by dashboards but never written at runtime (only demo seeders set them), so live 24-hour counts must be computed from messages.
- active (enabled for sending) is separate from status, and the proxy_* columns apply to Baileys numbers only (per-number IP isolation, fail-closed when unreachable; proxy_status is NULL when the proxy is off).
- user_id is who paired the device and assigned_user_id is the operator it is assigned to (defaults to the pairer); neither limits visibility, which is workspace-wide.
- warmer_config, warm_day and warm_day_count hold the WhatsApp Warmer ramp state, with the same shape as on wa_provider_configs.

**`extension_api_tokens`**

- There is no workspace_id: the bearer token is resolved to a user before any tenant context exists, so the token_hash lookup must work outside tenant RLS.
- Only the sha256 hex of a 60-character random token is stored (token_hash is unique); the plaintext is returned once at login.
- expires_at NULL means a legacy token that never expires.

**`extensions`**

- purchase_code is the licence key and is encrypted at rest (cast 'encrypted'), so treat it as SECRET even though it is not tagged.
- The table has no workspace_id: one global row per slug (slug is unique in WaDesk) and a re-install is an upgrade of the same row via firstOrNew.
- files lists the paths written under addon/<slug>/ on disk and manifest is the extension.json content; the row only records that the code is installed, while plan features decide which tenant may use it.
- installed_by is a real FK to users, nullable, with ON DELETE SET NULL in WaDesk's own migration.

**`facebook_broadcast_recipients`**

- psid is plaintext on purpose so it stays queryable, and conversation_id is the inbox thread used to re-check the 24h window and to mirror the sent message into the inbox.
- 'blocked' is permanent (outside the 24h window or unreachable PSID) while 'failed' is retryable, and the retry action flips failed rows back to 'pending'.
- There is no workspace_id column in WaDesk, so tenant scope comes through facebook_broadcasts, and rows are deleted explicitly with the broadcast rather than by DB cascade.

**`facebook_broadcasts`**

- body is app-encrypted text (input capped at 2000 chars) and buttons is an app-encrypted JSON array of generic template buttons (only the first 3 are sent).
- template_id points at wa_templates (the controller only accepts a template whose engineKey() is 'facebook') and is just a prefill source, nullable.
- total/sent/failed/blocked are counters incremented per recipient inside sendBatch, and blocked counts as done in the progress percentage.
- Sending is driven by the browser repeatedly calling sendBatch with no queue, status 'sending' only means that loop is active, and pause sets status back to 'draft'.
- The recipient list is a snapshot of Messenger conversations still inside Meta's 24h window at creation time.

**`facebook_pages`**

- access_token is a Page token encrypted at rest and token_expires_at is normally NULL because Page tokens derived from a long-lived user token do not expire.
- The same Meta page_id can be connected in several workspaces (unique key is workspace_id + page_id) and the Meta webhook fans out to every workspace that connected it, so that lookup by page_id alone runs without a tenant context.
- Disconnect hard-deletes the row after unsubscribing webhooks, so 'disconnected' appears in the schema comment but is never written.
- scopes holds the Meta-granted scope list and tasks the Page task list (MANAGE, CREATE_CONTENT, MODERATE, MESSAGING, ANALYZE) as JSON arrays.
- Flows, keyword triggers and the Node bridge refer to a Page by this row's id (flows.trigger_device_id), never by the Meta page_id.

**`facebook_posts`**

- media_json holds {photos: [urls], video: url} style data for the composer and meta_json is free-form extra data.
- A post that never finished its first publish attempt stays 'draft' and the UI groups draft with failed as retryable.
- Rows are also created by the cross-channel social scheduler (SocialPostsController) with status 'scheduled', not only by the Facebook composer.
- fb_post_id is only filled once Meta returns the published post id.

**`flow_connected_devices`**

- device_number and device_name are client-supplied free text encrypted at rest, not references to the devices table.
- connectDevice sets all earlier rows of the flow to 'disconnected' and inserts a new 'active' row, so history accumulates one row per connect.
- The table has no workspace_id and is only used for the per-flow active-device count and the connect/disconnect endpoints.

**`flow_retry_logs`**

- The row is inserted with outcome 'queued' and then updated once with the final outcome and reason, so it is not strictly append-only.
- retried_by_user_id NULL means a system-initiated retry and contact_id is nullable.
- previous_failure_reason copies flow_subscribers.failure_reason before re-enrolment clears it, and workspace_id is stamped from the flow at write time.
- flow_id, flow_subscriber_id, contact_id and retried_by_user_id are all real references (flows, flow_subscribers, contacts, users) although WaDesk declares no DB foreign keys here.

**`flow_subscribers`**

- Unique (flow_id, contact_id) exists in WaDesk and FlowEnrollmentService enrolls with firstOrCreate, so re-enrollment is idempotent.
- enrolled_at must be written only on insert: WaDesk had a MySQL implicit ON UPDATE CURRENT_TIMESTAMP bug that rewrote it on every update and had to be repaired, so the port must not auto-update it.
- This row is the flow execution-history record (no separate run table) and retry_count/last_retried_at are denormalised counters for flow_retry_logs.
- Re-enrolling a 'failed' subscriber resets status to 'active' and clears failed_at and failure_reason, and the table has no workspace_id (scope through flows).

**`flow_templates`**

- flow_data is plain unencrypted JSON because these are global admin-authored blueprints, unlike flows.flow_data which is encrypted.
- created_by is the admin user id and clone_count is incremented each time a tenant clones the template.
- The admin form only accepts flow_type chat, call or instagram even though flows accept more types.
- Tenants only read this table; it has no workspace_id.

**`flows`**

- flow_data is JSON ({flowNodes, flowEdges, vars}) stored encrypted and flow_name is encrypted text; flow_file_path is only a legacy disk mirror that the Node runtime does not need because it reads flows through a token-gated API.
- trigger_value has no single target: it is a tag id for tag_added, a contact group id for group_join, a deal stage id for deal_stage_changed, and 0 for value-less event triggers.
- trigger_device_id is polymorphic: the builder stores a composite 'engine:id' sender and the id names a devices, wa_provider_configs, instagram_accounts, facebook_pages, telegram bot or similar row depending on provider and flow_type, so no single FK exists.
- instaflow_flow_id is an id inside the separately linked external Instaflow install, not a WaDesk table.
- trigger_keywords holds comma-separated keywords, the literal 'any' for the default route, or for comment_to_dm a CSV of keyword_replies ids.
- Saving a keyword flow regenerates a managed keyword_replies row (is_flow_trigger) or an instagram_automations row, and deleting the flow hard-deletes those rows too; legacy rows may have NULL workspace_id and fall back to user_id ownership.

**`frontend_content`**

- draft and published hold plain text for most rows but a JSON-encoded string when type is json (e.g. keys ending .__hidden and .__order hold JSON arrays), so keep them as text and decode by type.
- Only text, json and image are ever written to type because the editor normalises richtext and color to text; theme.* keys hold hex colour strings.
- A null or empty value means use the hardcoded default, and publishing copies draft to published per key prefix such as home.
- Rows are keyed by the dotted ckey (DB unique), and the whole small table is cached and read on every public page.

**`google_form_sessions`**

- flow_session_id is the Node bridge's in-memory flow session key (a string, not a WaDesk table), so it has no FK.
- Rows are created by GoogleFlowNodeController when Node's Google Form node fires and are answered by an Apps Script webhook authenticated with the per-row webhook_token (unique), after which Laravel calls Node's /api/flow-resume.
- contact_phone is stored digits-only, resume_port defaults to 'submitted' and save_variable defaults to 'form_response'.
- expires_at defaults to now plus 86400 seconds and an expired response still stamps submitted_at to consume the row.

**`guidebook_articles`**

- category is free text (distinct values are listed back as the sidebar groups), not a closed set.
- views_count, helpful_count and not_helpful_count are bumped by direct increments from the public article view and vote endpoints.

**`hubspot_integration_logs`**

- Insert-only with only created_at (no updated_at); event_type values written are deal.created and deal.updated.
- object_id is the HubSpot deal id as an external string, not a WaDesk reference.
- There is no workspace_id in WaDesk, so org_id must be copied from the parent integration when inserting.

**`hubspot_integrations`**

- access_token and refresh_token are encrypted at rest and the refresh token may rotate on each token refresh.
- scopes is a plain scope string from a system setting, not JSON.
- Unique (workspace_id, portal_id) exists in WaDesk and connect uses updateOrCreate; disconnect hard-deletes the row.
- user_id is NOT NULL in WaDesk (the connecting user), which conflicts with ON DELETE SET NULL unless the column is made nullable.
- status becomes 'error' when a token refresh fails and 'active' otherwise.

**`impersonation_sessions`**

- admin_user_id is the platform admin (users) and target_workspace_id is the customer workspace being viewed; original_workspace_id is the admin's own current_workspace_id at start and is used on stop to restore it.
- ended_at NULL means the session is active; the session id is also kept in the admin's browser session so only that browser is switched to the target workspace.
- Rows are only written by the admin ImpersonationController (create on start, set ended_at on stop or when a new one starts).

**`inbox_messages`**

- WaDesk has no workspace_id column on this table (the tenant is derived through conversations), so the target must populate org_id from the parent conversation.
- The provider message id (wamid or Twilio SID) is stored only inside meta under wa_message_id, and status callbacks look rows up by that JSON path and never demote status.
- to_number, from_number, body, translated_body and failure_reason are encrypted at rest with a tolerant cast that returns raw text on decrypt failure, so legacy rows may be plaintext.
- detected_language, translated_body and is_translated are filled asynchronously after an inbound insert, and voice_transcript, voice_transcript_lang, ai_processed_at and ai_reply_id track the voice-AI pipeline.
- ai_reply_id points at the outbound inbox_messages row the voice agent created in answer to this inbound row (a self-reference into a stream, so it cannot be a database foreign key).
- template_id is only ever copied from messages.template_id by the mirror observer, so it is a wa_templates id.

**`inbox_notifications`**

- In-app feed row addressed to one user within one workspace; type is an open string (assigned, mentioned, resolved, sla_breach, new_lead, snooze_wake, task_assigned, task_due, deal_assigned, deal_lost, deal_task_due, sales_doc_decided, ai_handoff), not a closed set.
- data is a small context object (conversation id, contact name, actor id and similar); body is stripped text cut to 200 characters.
- AiAgentService creates ai_handoff rows with conversation_id, severity, message and action_url, which are not columns here and are silently discarded, so those rows keep a NULL body and link.

**`incoming_webhook_events`**

- Rows are inserted and then updated in the same request and the receiver prunes all but the newest 100 events per hook by id.
- payload is the raw request body capped at 64 KB with a truncation marker, so it is not guaranteed to be valid JSON, while headers is a JSON map with cookie and authorization headers stripped.
- template_send_status is free text ('sent', 'failed:<reason>', 'failed:exception', 'skipped:config', 'skipped:no_number'), not a closed set.
- lead_contact_id is the contacts.id of the lead created from the payload when lead capture is on.
- There is no workspace_id in WaDesk, so org_id must be copied from the parent incoming_webhooks row.

**`incoming_webhooks`**

- The public /hooks/in/{token} receiver finds the hook by token alone (token is unique) with no tenant context.
- forward_url is app-encrypted and re-validated by an SSRF guard at save time and at relay time.
- lead_config JSON holds enabled, phone, name, email, country_code, tag and flow_id (a flows.id inside the JSON).
- template_config JSON holds enabled, sender ('device:ID', 'waba:ID' or 'twilio:ID'), template_id (a wa_templates.id), to_field, country_code, header_field and var_map.
- received_count and last_received_at are counters updated on every received request.

**`invoice_items`**

- Lines are read ordered by sort; qty is decimal(12,3), tax_rate is a percent, and amounts are minor units in the invoice's currency (currency duplicates invoices.currency).
- Rows are written once at issue time together with the invoice and never edited.

**`invoice_logs`**

- No code in WaDesk reads or writes this table; it is created by a migration only and the event names (issued, rendered, sent, send_failed, resent, viewed, voided) exist only in a comment, so treat it as unused.
- It has created_at only (no updated_at) and also carries a workspace_id column not shown in the packet.

**`invoice_number_sequences`**

- One counter row per (workspace, series) allocated inside a short lockForUpdate transaction that commits before rendering, which keeps numbers gap-free; unique (workspace_id, series) exists in WaDesk.
- A missing row is seeded as max(seq)+1 of the invoices already issued for that series, so the port needs the same atomic row-locked increment.

**`invoice_settings`**

- One row per workspace created lazily with firstOrCreate; unique (workspace_id) exists in WaDesk.
- send_sender is a composite string 'waba:<wa_provider_configs id>' or 'device:<devices id>', not a foreign key.
- template_id_whatsapp points at wa_templates and is only set for WABA senders; device (Baileys) senders keep it NULL with template_status 'approved'.
- seller_extra_json is a list of {label,value} pairs for extra statutory ids such as PAN or CIN; logo_path and signature_path are media-disk paths, never remote URLs.
- template_status is written as none (default), pending or approved by code; 'rejected' appears only in the migration comment.

**`invoice_tax_summary`**

- Aggregated tax rows for the PDF footer (CGST/SGST/IGST split or one VAT line) written once at issue; rate is a nullable percent.

**`invoice_webhook_events`**

- Idempotency ledger for WooCommerce and Shopify webhook retries: firstOrCreate on (source, delivery_id) and processing is skipped when the row already existed; the unique key exists in WaDesk.
- Rows are insert-only and grow per webhook delivery, but the unique (source, delivery_id) lookup makes it a poor fit for a partitioned stream; keep it a regular table, optionally with a retention purge.
- delivery_id comes from the X-WC-Webhook-Delivery-ID or X-Shopify-Webhook-Id header and external_order_id is the platform's order id as a string; the table has no workspace_id.

**`invoices`**

- Frozen document: number, amounts and rendered PDF never change after issue; only status, send_status, sent_at, send_attempts, send_reason, send_error, delivered_at, wa_message_id and pdf_* fields move afterwards.
- Amounts are integer minor units in the invoice's own currency_exponent, which is not always 2.
- external_order_id is the WooCommerce or Shopify order id for those sources but the local wa_orders id as a string for source 'own', so wa_order_id is the real link; the DB unique (source, external_order_id, doc_type) is not workspace-scoped in WaDesk.
- user_id is the workspace owner for auto-issued invoices and the acting user for manual ones; wa_message_id is a WhatsApp provider message id string.
- trigger is an SQL keyword and needs quoting; credit_note is listed in comments but no code creates it, and void/credited are defined constants that no code sets.
- Existing DB uniques are public_token, (workspace_id, invoice_number) and (workspace_id, series, seq).

**`keyword_replies`**

- device_id is polymorphic and must be read together with provider (baileys is devices, waba/twilio/sms are wa_provider_configs, instagram/facebook/telegram/email are those channels' own ids), and WaDesk's own code warns these ids can collide.
- status is a boolean active flag (not a status string), and NULL or empty provider on legacy rows is treated as matching every engine.
- keyword holds one or more comma-separated phrases (the whole field is one pattern when matching_method is regex) and is empty for catch-all rows.
- cooldown, timeout and resume_after are stored in seconds while resend_unit and resume_unit only remember the UI display unit.
- Rows with is_flow_trigger true are managed by the flows table and are deleted and recreated on every flow save, so their ids are not stable.
- excluded_group_ids is a JSON array of contact_groups ids and excluded_numbers a JSON array of digit-only phone strings, both with no FK.

**`keyword_reply_contents`**

- content is Laravel-encrypted at rest and file_path is a relative path on the active media disk.
- Outside-hours reply variants live in the same table with variant_role outside_hours and is_selected false, and the normal lookup picks the first is_selected row by sort_order.
- template_id has no DB FK in WaDesk, is only set when content_type is template, and a deleted template leaves a dangling id, so SET NULL fits better than CASCADE.

**`keyword_reply_logs`**

- contact_phone and matched_text are Laravel-encrypted, so WaDesk's per-rule cooldown query that filters this column by plaintext phone cannot match and the port should key cooldown on a contact or conversation id.
- Rows come from two writers: the Baileys lookup endpoint (fills content_id, matched_variant, detected_language) and the dispatcher for other engines (leaves those three NULL).
- matched_variant actually stores the lowercased inbound text truncated to 64 chars, not the matched keyword token.

**`languages`**

- The default language is stored as a code in the system setting 'default_language', not as a flag on this table, and other tables reference languages by code string rather than id.
- The controller refuses to delete the default language; the active list is cached for 10 minutes and flushed on toggle; unique code exists in WaDesk.

**`leads`**

- Unique (workspace_id, source, external_id) in WaDesk is what makes re-scans idempotent (updateOrCreate), and a NULL external_id would not dedupe.
- external_id is the OpenStreetMap or Google Places id, not a local reference; raw is a copy of the whole normalized lead payload.
- in_crm and contact_id are set when a lead is added to Contacts, which creates or updates the contact by mobile (phone_e164) or else email.
- user_id is the staff member whose latest search wrote the row; the clear-all action hard-deletes every lead in the workspace.

**`legal_pages`**

- sections is a JSON array of objects with n, title and body (HTML), auto-numbered 01, 02 and so on when n is blank.
- Admin screen self-heals by firstOrCreate on the five fixed slugs, and the display order column is sort.

**`line_broadcast_recipients`**

- Snapshot of the audience at creation: line_user_id is a LINE user id string kept plaintext on purpose so it stays queryable, and conversation_id links the inbox thread.
- Rows are updated per recipient (pending to sent, failed or blocked; failed rows are reset to pending on retry), so this is not append-only; provider_message_id is LINE's message id string.

**`line_broadcasts`**

- body uses the encrypted cast and buttons uses encrypted:array, so MySQL holds Laravel ciphertext for both (decrypt on import); buttons is logically a JSON array.
- template_id points at a wa_templates row whose engine key is 'line' and is only used to prefill body and buttons at creation time.
- Recipients are snapshotted into line_broadcast_recipients at creation; total, sent, failed and blocked are denormalised counters updated while sending.
- user_id is the creating user and media_kind is derived from the uploaded file extension (default image).

**`line_channels`**

- channel_access_token, channel_secret, assertion_private_key and rotating_token use the encrypted cast (ciphertext in MySQL), while assertion_kid and rotating_token_key_id are plain identifiers and are not secrets.
- The line_channel_id column here is a LINE-side id string (code stores the bot userId from /v2/bot/info and uses it as the JWT iss/sub for token rotation), unlike line_channel_id on other tables which is the local primary key.
- The local row id is encoded in conversations.raw_jid as 'line:<rowId>:<userId>' and in flows.trigger_device_id for flows with flow_type 'line', so ids must survive the migration or those values must be rewritten.
- webhook_token is unique and is the routing token in the inbound URL /api/line/inbound/{token}; connected_by is the user who connected the channel.

**`line_flow_sessions`**

- No PHP or Node code in WaDesk reads or writes this table (the Node flow engine keeps sessions in memory), so it is a dormant mirror and a candidate to skip.
- vars uses encrypted:array (ciphertext in MySQL) while await_options is a plain JSON array; unique (conversation_id) exists in WaDesk (one session per thread).
- line_user_id and last_message_id are LINE-side id strings.

**`line_rich_menus`**

- size and areas hold the exact LINE rich-menu payload as JSON, and rich_menu_id is LINE's own id string once the menu is registered with LINE.
- is_default is maintained in app code by clearing the flag on the channel's other menus when a default is set (mirrored LINE-side); created_by is the creating user.
- layout is one of a fixed set of preset keys defined in the model.

**`message_charges`**

- user_id is the workspace owner whose prepaid wallet was charged (workspaces.owner_user_id), not the sending agent, and wallet_tx_id is the debit wallet_transactions row and stays NULL for free rows.
- wamid is a global idempotency key (DB unique, looked up before every insert) and the row is later updated to status refunded, so the table is not append-only.
- WaDesk counts this workspace's rows since the start of the month as free-quota usage, so every delivered message must produce a row even when status is free.
- category stores the lowercased category string the caller passed (or NULL), not a value normalised to the four rate categories.
- meta is never written by any code path and is always NULL.
- Rows are written by MessageBillingService on delivery confirmation (Meta status webhook, Baileys and Twilio callbacks, flow mirror) plus one campaign send-time path; amounts are platform-currency minor units.

**`message_rates`**

- country_code and category use the empty string as an any-country or any-category wildcard (not NULL), resolved most-specific-first, and the DB already has a unique key on (country_code, category).
- The unit of credits is inconsistent: the creating migration seeds whole credits while the admin re-seed action stores the whole-currency figure multiplied by 100.
- meta_cost_minor and currency describe Meta's wholesale cost only (NULL meta_cost_minor means unknown, 0 means free), while credits is the customer price with no currency.

**`messages`**

- Holds campaign, broadcast, scheduled and legacy chat rows, and an Eloquent observer mirrors every created row into inbox_messages (skipped when the caller writes both), so the same bubble can exist in both tables.
- to_number, from_number, body and failure_reason are encrypted at rest (ciphertext, not searchable), and for chatbot_widget threads the number fields hold visitor_uuid or 'widget-<id>' instead of phone numbers.
- The provider message id (wamid or Twilio SID) is stored only inside meta under wa_message_id; delivery receipts find rows by that JSON path and only move status forward.
- Rows are updated after insert (status, delivered_at, read_at, pinned, starred, reaction) and the duplicate-thread merger bulk re-points conversation_id, so the stream design must allow keyed updates.
- Monthly plan usage is computed by counting direction='out' rows since the start of the month in messages (matched through workspace members' user_id) plus inbox_messages, so rows must stay countable per workspace.
- agent_id was added with conversations.assignee_agent_id for AI-agent attribution and was backfilled into inbox_messages, which now holds the live AI replies, so it is an ai_agents id and not a users id.

**`meta_campaigns`**

- name, creative_title, creative_body, creative_link_url, ctwa_phone, ctwa_message, meta_last_error and targeting hold Laravel-encrypted ciphertext in the source DB, and targeting decrypts to a JSON array.
- facebook_id, meta_adset_id, meta_creative_id, meta_ad_id and meta_image_hash are Meta Graph ids (strings), not references to local tables.
- daily_budget and lifetime_budget are major currency units (decimal) while bid_amount is in minor units (cents), and insights JSON carries account_currency plus spend, impressions, clicks, reach, conversions, ctr, cpc, revenue.
- Model and controller also write ad_type, publisher_platforms, instagram_positions and instagram_user_id (Instagram ads) but no migration in this release creates those columns, so they are absent from the source schema.
- workspace_id is nullable for legacy rows, which are then scoped by user_id alone.

**`notifications`**

- notification_title and notification_msg use the encrypted cast, so MySQL holds Laravel ciphertext (decrypt on import) and they are plain text, not JSON.
- status is an inverted legacy flag where 1 means unread and 0 means read (read_at is also set); is_urgent is separate.
- source_type holds a model class name such as App\Models\Device and source_id that model's key, so the pair is polymorphic with no single target table.
- user_id NULL means addressed to the whole workspace; legacy rows with NULL workspace_id are only visible to their own user_id.
- category is an open string (system, campaign, billing, chat, mention, contact, template, device, webhook, broadcast plus model-derived values) and verb is free text such as created, updated, deleted, failed, triggered.

**`orders`**

- The table serves four flows: plan purchases (package_id), add-on purchases (package_id is the add-on package), wallet or credit top-ups (package_id NULL plus credit_package_id or gateway_payload.wallet_topup_minor) and booking payments (order_number prefix BK- with gateway_payload.booking).
- For booking orders user_id is the workspace owner, not the payer, and the buyer is in customer_name and customer_email.
- reviewed_by, reviewed_at and review_note are set by a platform admin when approving, rejecting or cancelling an offline bank-transfer order.
- amount is the final amount sent to the gateway (equal to total_amount after discount and tax), while discount_amount, tax_amount and total_amount keep the breakdown.
- failure_reason is free text from the gateway or the markers cancelled_by_admin and rejected_by_admin, so it is not a closed set.
- order_number (WSN-yymmdd-XXXXXX) already has a DB unique key.

**`outbound_webhooks`**

- events is a JSON array of event names or ['*']; fired names are conversation.created, .received, .replied, .assigned, .resolved and .outbound_synced, while conversation.reopened and note.added are documented in the model but never fired.
- secret is an optional HMAC-SHA256 signing key encrypted at rest and hidden from API output, and the signature header is sent only when it is set.
- fired_count, failed_count, last_fired_at and last_error are delivery counters the dispatcher updates after every POST attempt (4 second timeout).

**`package_features`**

- Referenced only through the comma-separated packages.pfeatures_id (no FK or join table) and seeded by name with updateOrCreate.

**`packages`**

- plan_id is a unique slug string (for example starter) and not a numeric id, whereas subscriptions.plan_id stores the numeric package id as a string.
- pfeatures_id is a comma-separated list of package_features ids with no join table, read by Package::features().
- multipledevice is varchar(255) in the DB but is cast and used as a boolean flag.
- type is plan or addon (NULL means a legacy plan), and an add-on lists only what it grants in grants_json as features (flag keys) and limits (per-key deltas).
- Numeric limit columns treat 0 or NULL as unlimited rather than zero allowance, and the many access__, integration__, autoreply-style columns are plain boolean plan flags.
- offer_price is both the discounted price that overrides plan_amount at checkout and the discounted per-month price used for yearly billing.

**`payment_gateways`**

- credentials holds Laravel Crypt ciphertext (keyed by APP_KEY) of a JSON object, so source values cannot be copied as-is and must be decrypted and re-encrypted or re-entered.
- Rows mirror the code-defined driver catalog (32 slugs), are auto-created inactive in sandbox mode when a driver is added, and slug already has a DB unique key.
- extra_config is declared and cast to array but no controller or driver reads or writes it.
- supported_currencies is a whitelist where NULL or an empty array means every currency is accepted.

**`payments`**

- This is the CRM money-in ledger against invoices, deals, contacts and companies, not the SaaS plan purchase table orders, and wa_order_id refers to wa_orders (WhatsApp storefront orders).
- The DB unique (workspace_id, source, gateway_payment_id) is the idempotency key for auto-bridged gateway and WhatsApp-pay rows, while manual rows leave gateway_payment_id NULL.
- recorded_by NULL means the system or a gateway recorded it, and amount_minor is clamped to zero or more (no negative or refund rows).
- method and source silently fall back to manual when the supplied value is outside the allowed lists.

**`pipeline_stages`**

- Stages are only seeded as a fixed six-step ladder (New Lead, Qualified, Proposal, Negotiation, Won, Lost) and no controller edits them.
- is_won and is_lost mark terminal columns and probability is a 0 to 100 percentage.

**`pipelines`**

- Rows are created only by Pipeline::ensureDefaultForWorkspace (one 'Sales Pipeline' per workspace on first /deals visit); no controller creates or edits pipelines.
- currency defaults to the workspace currency (not INR), and a heal step relabels stale 'INR' pipelines and deals in place without converting values.

**`plan_usage`**

- There is no model: the table is touched only through App Services PlanUsage with raw queries, as an increment-only counter that deletes never decrement and that is seeded once from the live count.
- period is a string key of the form package-id then a pipe then plan_ends_at as Ymd (or 0 when there is no end date), so a new plan or renewal starts a fresh row at zero and old period rows remain.
- Only the metric campaign (wpcampaigns against total_campaigns_limit) is metered in this release.
- A DB unique key on (workspace_id, metric, period) already exists and counts are bumped with an atomic update of count plus n.

**`platform_notes`**

- body is encrypted at rest (Laravel ciphertext) and the notes are platform-staff only, never shown in the workspace UI.
- admin_user_id is the platform admin who wrote the note, and workspace_id is copied from the conversation's workspace while conversation_id and workspace_id are both nullable.
- DuplicateConversationMerger re-points conversation_id to the surviving thread when two conversations are merged.

**`playbooks`**

- workspace_id is always NULL in code, so these are platform-wide support macros managed only by platform admins.
- steps is a JSON array of objects with action and value, where action is one of set_status, set_priority, add_tag, reply, assign, note.
- Only manual execution (runOnTicket) exists: trigger_type and trigger_value are stored but nothing evaluates them automatically, and use_count is incremented per run.
- slug is the name slug plus six random hex characters and has a DB unique key.

**`pricing_faqs`**

- placement decides whether an FAQ shows on the pricing page, the home page or both.

**`projects`**

- description is encrypted at rest (Laravel ciphertext).
- contact_id and deal_id are never set by any code path (only company_id, owner_id and created_by are).
- status is stored only as in_progress or completed, overdue is derived from due_date, and progress of 100 forces completed.

**`push_subscriptions`**

- Browser Web Push subscription for the Team-Inbox PWA; endpoint is TEXT and endpoint_hash = sha256(endpoint) is the upsert key, so re-subscribing the same browser updates user_id and workspace_id in place.
- p256dh and auth are the subscription's Web Push key material and auth is a secret, yet both are stored unencrypted and not tagged SECRET.
- channel is always 'team-inbox' in code and push queries filter on that value.

**`referrals`**

- Created at signup with credits_awarded 0 and award_transaction_id NULL, then updated in place when the referee makes their first paid purchase; the DB unique key on referred_user_id guarantees one attribution per referee.
- referrer_user_id and referred_user_id are WaDesk platform account users (workspace owners), and code_used is the referrer's referral_code at signup.

**`routing_rules`**

- conditions and actions JSON embed foreign ids (team_id to teams, user_id to users, sla_policy_id to sla_policies, agent_id to ai_agents, flow_id to flows, template_id to wa_templates, nested inside then_action too) that no FK covers and that must be remapped on import.
- Action types stored in actions[].type are assign_team, assign_user, set_priority, add_tag, mark_spam, set_sla, assign_agent, auto_reply, trigger_flow and set_escalation (which nests a then_action).
- Evaluation runs non-fallback rules by sort then id, and fallback rules only run when no primary rule fired; a fallback rule may legitimately have empty conditions.
- fired_count and last_fired_at are updated row by row each time a rule fires, so they are mutable counters.

**`sales_docs`**

- buyer_name, buyer_email, buyer_phone and notes are encrypted at rest (Laravel ciphertext in text columns).
- contact_id and deal_id are never set by any code path, and the live links are company_id, owner_id, created_by and invoice_id (set on convert-to-invoice).
- number is the PRO- or EST- prefix plus a four-digit seq, and money is in the doc's own currency minor units with currency_exponent and tax_rate_bp in basis points.
- discount_minor is always written as 0 by current code, and public_token already has a DB unique key.

**`saved_replies`**

- user_id NULL means a workspace-wide reply and non-NULL means a personal one, and the AI agent prompt uses only the workspace-wide replies.
- shortcut is stored slugified with underscores, body is encrypted at rest, and used_count is incremented by a dedicated 'use' endpoint.
- attachments is cast as a JSON array but no controller or service writes it, so it is always NULL in practice.

**`scheduled_message_contacts`**

- scheduled_message_id has two meanings: ScheduledController seeds rows against scheduled_messages.id, but WaWebhookController and BroadcastsController read the same column as broadcasts.id when recomputing broadcast aggregates (legacy schema).
- Rows are pre-seeded as pending at schedule time, updated by the Node bridge callback and Meta status webhooks (matched by wa_message_id), created on the fly for unknown phones, and reset in place to pending on reschedule.
- phone is digits only with no plus sign, contact_id is NULL for number-only sends, and statuses only advance pending, sent, delivered, read while failed is terminal.

**`scheduled_messages`**

- device_id is polymorphic by provider: devices.id for baileys and wa_provider_configs.id for waba and twilio, and from_number is the sender's full digit string.
- campaign_id was added to link wpcampaigns (not meta_campaigns, mirrored by wpcampaigns.scheduled_message_id) but no code writes or reads it.
- target_queues is a JSON array of broadcasts.id, target_groups is a JSON array of contact-group strings or 'tag:' plus a tags.id for tag audiences, and target_numbers is an encrypted JSON array of phone numbers, with only the one matching recipient_type populated.
- schedule_name, message_content, target_numbers and template_overrides are Laravel-encrypted in the source DB.
- template_type and schedule_type are open strings in practice: cart-recovery services write standard or plain and later in addition to the form values.
- node_schedule_id is the Node bridge's schedule handle (NULL if the bridge was unreachable, cleared on reschedule), and rows are also created by the Shopify, WooCommerce and storefront cart-recovery services and the mobile QueueController.

**`shopify_cart_recoveries`**

- scheduled_ids is a JSON array of scheduled_messages ids (one per follow-up step) with no FK; on order creation each id is loaded, cancelled on the Node scheduler and flipped to cancelled.
- checkout_token is the public Shopify checkout identifier, written once and never read or queried, so the SECRET tag is a false positive.
- All lookups use workspace + customer_phone (digits only) + status='active', never integration_id or checkout_token.
- status 'done' exists only in the migration comment; code writes just active and recovered.
- Rows are inserted once per checkouts/create webhook with no dedupe, so duplicate active rows for one phone are possible.

**`shopify_cod_confirmations`**

- An inbound WhatsApp Yes/No reply updates the newest pending row (highest id) for workspace + customer_phone and then updates wa_orders.status where wa_orders.shopify_order_id matches.
- shopify_order_id is Shopify's numeric order id kept as a string (matches wa_orders.shopify_order_id), not a reference to a local table.
- customer_phone is stored digits only.

**`shopify_integration_events`**

- event_type is a closed set enforced by an allow-list in saveEvents, and WaDesk has unique (integration_id, event_type) because rows are written with updateOrCreate.
- var_map is an ordered JSON list of context field names (for example name, order_name, total) bound to template positions {{1}}, {{2}}; null means the default order.
- delay_seconds is ignored for inline webhook sends and only used for cart/step2 and cart/step3 follow-ups (minimum 60 s, default 3600 s).
- admin_number is only used when send_to is admin or both.
- The table has no workspace_id; tenancy comes from integration_id.

**`shopify_integration_logs`**

- The table has no workspace_id, so org_id must be denormalised from the integration.
- A row is inserted and then UPDATEd in the same request (status, recipient, response, error) after the template send, so the stream cannot be strictly insert-only.
- recipient mixes meanings: a customer phone, a comma-joined phone list, or summary text such as '40 contacts' or '3 waiting'.
- The GDPR customers/redact and shop/redact webhooks hard-delete rows by integration_id and optionally recipient.
- The dashboard filters by (integration_id, created_at) and (integration_id, status) and groups counts by event_type; created_at is set explicitly and there is no updated_at.
- event_type holds webhook topics plus pseudo events such as cod/confirm, cod/reply, offer/broadcast, winback/broadcast and stock/back.

**`shopify_integrations`**

- access_token is Laravel-encrypted and the app/uninstalled handler sets it to NULL even though the WaDesk column is NOT NULL (that update fails silently), so make it nullable in the port.
- webhook_secret is deliberately not encrypted: it is the routing token in the public /shopify/webhook/{secret} URL and is looked up by equality across all workspaces, so it needs an index and a tenant-bypass lookup.
- WaDesk has unique (workspace_id, store_url), so one workspace can connect several stores but not the same store twice.
- scopes is a comma-separated string such as read_products,read_orders, not JSON.
- metadata holds webhook_ids (registered Shopify webhook ids) and sender_key; sync_stats holds importer counters.
- user_id is the connecting user and is reused as the sender identity for template sends and scheduled messages; WaDesk declares it NOT NULL with no FK.

**`shopify_stock_waitlist`**

- shopify_product_id is Shopify's numeric product id as a string and matches wa_products.shopify_product_id; it is not a local FK.
- Rows flip from waiting to notified (setting notified_at) when a products/update webhook shows an out-of-stock to in-stock transition.
- integration_id is set to the workspace's most recent integration at opt-in time.

**`sla_breaches`**

- Written only by the platform support:sla-scan command (SlaCalculator::scanAndPersist) for support_tickets, never for inbox conversations, which keep their SLA flags on the conversations table.
- sla_policy_id is nullable and declared ON DELETE SET NULL in the WaDesk migration, so the packet's CASCADE would wipe breach history whenever a policy is deleted.
- severity is only ever written as warn or breach, but the admin SLA view also renders hard_breach; over_by_minutes is nullable.

**`sla_policies`**

- workspace_id is NULLABLE: NULL rows are platform-wide policies for admin support tickets (support_tickets.sla_policy_id), while non-NULL rows are inbox policies referenced by conversations.sla_policy_id, so org_id cannot be NOT NULL without splitting the two uses.
- device_ids is a JSON array of devices.id (unofficial devices); null or empty means the policy applies to every device, and device-scoped policies win over the default.
- priority_overrides is an object keyed by low, normal, high or urgent, each holding optional first_response_minutes and resolution_minutes that override the base targets.
- first_response_minutes and resolution_minutes are nullable in WaDesk and the inbox forms accept blanks.

**`slack_integration_logs`**

- Insert-only rows written after the Slack response is sent; event values are command, reply and error and detail is capped at 500 chars.
- integration_id is always set by the code (nullable in the schema) and WaDesk also stores a workspace_id here.

**`slack_integrations`**

- bot_token and signing_secret are encrypted at rest; the signing secret verifies the inbound slash-command signature.
- Both workspace_id and team_id are unique in WaDesk (one Slack team per workspace and per team) and the slash-command endpoint resolves the row by team_id with no tenant context.
- metadata JSON stores send_from, a composite 'engine:id' sender key.
- user_id is NOT NULL in WaDesk, which conflicts with ON DELETE SET NULL unless the column is made nullable; slash_command defaults to '/wa'.

**`slot_reservations`**

- Short-lived soft hold (about 10 minutes) on seats while a chat booker finishes; the row is deleted when the booking commits and expired rows are swept inline.
- session_ref is a conversation id or a flow session id as a string, so it is not a foreign key.

**`storefront_cart_recoveries`**

- scheduled_ids always holds a single scheduled_messages id (the plain-text nudge) and has no FK.
- Lookups go through storefront_id + customer_phone + status='active' (phone digits only), not through workspace_id.
- items_json is the cart snapshot array and subtotal_minor is in minor currency units.
- status 'expired' exists only in the migration comment; code writes just active and recovered.
- Recovery only runs when wa_storefronts.settings_json.cart_recovery_enabled is true.

**`subscriptions`**

- plan_id is a stringified copy of package_id taken at creation (not the packages.plan_id slug) and is redundant.
- gateway is the payment gateway slug string (not an id), and gateway_subscription_id is the join key for renewal webhooks, looked up by gateway plus id with the latest row winning.
- meta JSON holds the originating order_id and order_number and is queried by meta->order_id to reuse a pending row on retry.
- billing_cycle is derived from the package plan_unit (yearly for years, else monthly), and renewals_count and current_period_end are advanced by gateway renewal webhooks which also extend workspaces.plan_ends_at.

**`support_agents`**

- workspace_id is always NULL in code (platform-wide agents), which is why uniqueness must be enforced on user_id alone.
- current_load is never updated by code, and live open counts are computed from support_tickets.assigned_agent_id.
- support_tickets.assigned_agent_id and support_assignments.agent_user_id point at users.id, not at support_agents.id.

**`support_assignments`**

- Unused: there is no model and no code reads or writes the table, since assignment lives in support_tickets.assigned_agent_id.
- The schema comment lists outcome values resolved, abandoned and reassigned but nothing ever sets them.

**`support_messages`**

- attachments is never written by any code path and is always NULL.
- author_role is admin or customer in practice (the schema comment also lists system), and author_user_id is the replying admin or customer user.
- Only created_at exists (no updated_at), and the customer-facing view hides rows where is_internal_note is true.

**`support_tickets`**

- tags and meta are JSON columns in the migration with no model cast, and only the playbook add_tag action touches tags.
- Legacy statuses awaiting_support and awaiting_user were remapped to pending and in_progress by a migration, but the model statusLabel() still handles the legacy values.
- assigned_agent_id is a users.id, and sla_policy_id is never assigned by code, so SlaCalculator falls back to the default sla_policies row.
- first_response_at is stamped on the first non-internal admin reply, and resolved_at is stamped only on the first resolution and cleared on reopen.
- message holds the customer's opening text while the later thread lives in support_messages, and WaDesk soft-deletes tickets (deleted_at).
- workspace_id is nullable and is the submitter's current workspace at creation.

**`tasks`**

- notes is encrypted at rest (Laravel ciphertext) while title stays plaintext.
- related_type plus related_id is a polymorphic link to a contact, deal or company.
- reminded_at is stamped by the scheduled CRM reminder commands so each task is reminded once, and done_at is set when status becomes done.

**`team_chat_channel_members`**

- last_read_message_id is a read watermark (default 0 means nothing read) compared with message id > watermark for unread counts, and markRead accepts any integer >= 0 without checking the message exists.
- Rows are created lazily by updateOrCreate when a user posts or marks read, so public-channel rows only track read state while private-channel rows mean membership.
- Because WaDesk soft-deletes messages but the port hard-deletes them, make the watermark nullable or FK-less so deleting a message does not reset unread counts.
- WaDesk has unique (channel_id, user_id).

**`team_chat_channels`**

- A public channel named general (slug 'general') is auto-created per workspace on first access and cannot be deleted.
- type 'dm' exists in the enum and in queries but no code ever creates a DM channel.
- WaDesk has unique (workspace_id, slug), and last_message_at is bumped on every posted message.
- Public channels have no required membership rows (every workspace member is implicitly in), while private channels require a team_chat_channel_members row.

**`team_chat_invitations`**

- invitee_user_id is NULL when the invited email has no account, and in that case approval cannot auto-join anyone (an admin must send a signup link).
- Invitations created by workspace admins are inserted already approved without decided_by_user_id or decided_at; those are only set by an explicit approve or decline.
- channel_id NULL means a workspace-level invite; approval inserts into workspace_user and, when channel_id is set, into team_chat_channel_members.
- status 'expired' is never written by any code.

**`team_chat_messages`**

- body is Laravel-encrypted at rest and WaDesk's search runs LIKE against that ciphertext, so search effectively never matches; the port must decide between plain text, app-level encryption or no body search.
- mentions is a JSON array of mentioned user ids.
- Rows are mutable (edit within 15 minutes sets edited_at, pin sets pinned_at and pinned_by_user_id, delete is a soft delete), so this is not an append-only stream.
- WaDesk's channel_id is nullable only for backfill; every new message sets it.
- pinned_by_user_id has no DB FK in WaDesk but always holds the pinning user's id.

**`team_chat_reactions`**

- WaDesk has unique (message_id, user_id, emoji); the react endpoint toggles by deleting the existing row or inserting a new one.

**`team_chat_reads`**

- No code ever reads or writes this table (the controller only imports the model); read state lives in team_chat_channel_members, so this is a legacy per-workspace pointer that can be dropped.
- last_read_message_id defaults to 0 meaning nothing read, and WaDesk has unique (workspace_id, user_id).

**`telegram_accounts`**

- session is the encrypted MTProto user-session string and the most sensitive credential in the app, so tag it SECRET (the packet only says LONGTEXT-not-json).
- WaDesk has unique (workspace_id, tg_user_id) and connect uses updateOrCreate on that pair, so one workspace can hold several Telegram user accounts.
- tg_user_id is Telegram's own user id (external, no relation) and connected_by is the Laravel user who scanned or logged in.
- These accounts are used only to drive @BotFather through the Node bridge to create bots.

**`telegram_bots`**

- bot_token and payment_provider_token are Laravel-encrypted; secret_token is regenerated on every re-paste of the token.
- webhook_token is unique in WaDesk and is the routing token in /api/telegram/inbound/{token}, resolved globally, so inbound needs a tenant-bypass lookup.
- bot_id is Telegram's numeric bot id kept as a string (external, no relation) and is used with the workspace to find the existing row when a token is re-pasted.
- conversations.raw_jid encodes this table's own id as 'tg:<botId>:<chatId>', so replies find their bot by parsing the jid and imported ids must stay consistent.
- active=false means paused, which blocks broadcasts and the 'is Telegram usable' presence check.

**`telegram_broadcast_recipients`**

- Recipients are a snapshot of the audience taken when the broadcast is created, not resolved at send time.
- chat_id is Telegram's chat id as a string (negative for groups and channels) and is deliberately not encrypted so it stays queryable.
- kind channel chats are stored as 'group'; blocked marks unreachable chats and is never retried, while failed rows flip back to pending on retry.
- conversation_id points at the conversations row where a copy of the sent message is mirrored as an outbound inbox message.
- The destroy action deletes the recipients explicitly before the broadcast (there is no DB FK).

**`telegram_broadcasts`**

- body and buttons are encrypted at rest (casts encrypted and encrypted:array), so legacy data holds Laravel ciphertext that has to be decrypted on import.
- template_id references a wa_templates row whose engine is telegram and is kept for display only; buttons are copied from it at creation.
- status 'draft' also means paused: pause sets it back to draft and Start flips it to sending.
- sent, failed and blocked are counters incremented per recipient, and retry decrements failed when failed recipients return to pending.
- media_file_id is Telegram's own file id captured after the first successful send and reused for later recipients.

**`telegram_flow_sessions`**

- No PHP or Node code writes or reads this table (the Node flow runtime keeps sessions in an in-memory map and the model has no callers), so it is dead or legacy in the reference.
- WaDesk has unique (conversation_id), meaning at most one live session per thread.
- vars is an encrypted:array cast, so legacy data holds Laravel ciphertext rather than JSON, while await_options is a plain JSON array.
- chat_id, last_message_id, poll_id, invoice_payload, payment_link_id and payment_ref are Telegram or payment-provider identifiers with no local relation.

**`tiktok_accounts`**

- access_token and refresh_token are Laravel-encrypted at rest, and meta_json.business also holds the TikTok DM business_id, region and a plaintext access_token, so meta_json contains a secret.
- WaDesk has a DB unique key (workspace_id, open_id) and the connect flow uses updateOrCreate on it.
- The inbound webhook resolves an account by open_id alone (status connected, no workspace filter), so the same TikTok account connected in two workspaces resolves ambiguously.
- status flips from connected to needs_reconnect when the refresh token lapses or a refresh fails; a sweeper re-checks connected, expired and error rows on page load.

**`tiktok_posts`**

- Every post the code creates is sent straight to the user's TikTok inbox (media_json.target is 'inbox', status processing); draft and scheduled statuses and scheduled_at are never written by any code.
- publish_id is TikTok's async publish handle and the only key the post.publish.* webhook uses to find the row; tiktok_post_id is filled when publishing completes.
- media_json holds {video_url, target} for a video or {photos:[urls], target} for a photo post.

**`tiktok_shops`**

- access_token and refresh_token are Laravel-encrypted at rest; WaDesk has a DB unique key (workspace_id, shop_id) and connect uses updateOrCreate on it.
- shop_id can be the placeholder 'pending-<workspace_id>' when the Partner API shop list is not yet available, and last_error then carries an explanatory message.
- shop_cipher is required on every signed TikTok Shop API call, and the row is hard-deleted on disconnect.

**`translation_providers`**

- Seeded catalog of five drivers whose slug must match the code registry (mymemory, google_gtx, libretranslate, deepl, google_cloud); unique slug exists in WaDesk.
- credentials holds Laravel Crypt ciphertext of a JSON object (hidden from serialisation), so it is a secret blob and not JSON itself.
- Only one provider is default at a time, maintained in app code by clearing is_default on all rows before setting one.

**`translation_usage`**

- Insert-only ledger with one row per API call that actually hit a provider; dictionary and cache hits are not logged, and there is no updated_at.
- workspace_id is nullable (NULL when there is no authenticated user) and provider_slug is a soft reference to translation_providers.slug, not an id.
- cost_micros is millionths of a USD computed from a fixed per-character rate table in code (deepl and google_cloud 20 micros per char, others 0).

**`trello_integration_logs`**

- Insert-only; event is the Trello action type or 'error', detail is capped at 480 chars, and WaDesk also stores a workspace_id here.

**`trello_integrations`**

- api_key, api_secret, token and notify_number are encrypted at rest and api_secret verifies the X-Trello-Webhook HMAC.
- Unique (workspace_id, board_id) exists but the public webhook resolves the integration by board_id alone with first() and no tenant context.
- events is a JSON array limited to addMemberToCard, createCard, updateCard and deleteCard (defaults apply when null) and member_map is a JSON object {trelloMemberId: contacts.id}.
- notify_number is only used when notify_mode is 'fixed' and is stored as digits.
- user_id is NOT NULL in WaDesk, which conflicts with ON DELETE SET NULL unless the column is made nullable; webhook_id and board_id are Trello external string ids.

**`user_device_tokens`**

- Upsert key is token_hash = sha256(trim(fcm_token)); re-registering a known token reassigns user_id, workspace_id and device_id on the existing row.
- device_id NULL means the token receives pushes for every device of the workspace; device_id is validated to belong to the workspace via the X-Device-Id header; workspace_id is also nullable.
- fcm_token is stored in plaintext in WaDesk (no encrypted cast) although it is a secret; device_info is a free-form object such as model and os_version.
- A unique key on token_hash already exists in WaDesk.

**`viber_broadcast_recipients`**

- viber_user_id is Viber's string user id kept plaintext so it is queryable; title is a snapshot of the conversation title.
- conversation_id is always set at creation (recipients are picked from the channel's existing viber conversations) and is used to mirror the sent message into the inbox.

**`viber_broadcasts`**

- body is Laravel-encrypted plain text and buttons is an encrypted JSON array, so neither is readable in WaDesk's DB.
- template_id is only saved when the picked wa_templates row belongs to the workspace and has engine key 'viber'; body and buttons are then copied from the template.
- Created as 'draft' with all recipients pre-inserted as 'pending', then drained in batches from the browser session; sent and failed are updated in place.
- media_path is a stored upload (jpg, png, gif or mp4) and media_kind is derived from the extension.

**`viber_channels`**

- auth_token is static (no expiry), encrypted at rest, and doubles as the HMAC key for the X-Viber-Content-Signature check on inbound webhooks.
- The row id is embedded in conversations.raw_jid as 'viber:<channelRowId>:<viberUserId>' to route replies, so channel ids or those raw_jid values must stay consistent after migration.
- webhook_token is the random 48-char routing token in /api/viber/inbound/{token} and has a DB unique key; viber_id is the bot's external 'pa:...' account id.
- A workspace can hold several channels and reconnecting the same bot updates the existing row and keeps its webhook_token.

**`viber_flow_sessions`**

- No PHP or Node code reads or writes this table; the Node flow engine keeps sessions in an in-memory map keyed by channel and user, so the table is an unused durable mirror.
- vars is a Laravel-encrypted JSON array and await_options is plain JSON; WaDesk has a DB unique key on conversation_id (one session per conversation).

**`wa_call_events`**

- WaDesk has no workspace_id on this table, so the tenant (org_id) must be derived from the parent wa_calls row.
- Insert-only forensic ledger with received_at only (no created_at or updated_at); event types include connect, terminate, the *_sent actions, permission_update, bridge_accepted, bridge_error, ai_voicemail_triggered, ai_callback_requested, transcript_turn and tool_call.
- transcript_turn and tool_call events are read back by wa_call_id in id order to build ai_call_logs.transcript_json and tool_calls_json.

**`wa_call_permissions`**

- Local cache of Meta's call-permission grant (Meta keeps it about 7 days) keyed by wa_provider_config_id plus contact_phone, which is unique in WaDesk; it is not keyed by contacts.id.
- A permission is usable only when status is granted and expires_at is empty or in the future; expired is also a stored status.

**`wa_calls`**

- handler_agent_id has mixed meaning: the voicemail fallback stores ai_agents.id while the Node AI bridge accepted-callback stores ai_call_assistants.id, so it cannot have a single FK.
- ai_call_log_id is declared varchar(255) but always holds a numeric ai_call_logs.id, so the port should make it a bigint reference.
- transcript is never written (dead column); transcripts live in wa_call_events transcript_turn rows and ai_call_logs.transcript_json.
- meta_payload stores the WebRTC session (SDP) under a session key plus Meta payloads, and error_payload stores failure details.
- Status moves ringing, connecting or active, then ended or failed under a row lock (operator accept races the AI voicemail fallback and the Node bridge); end_reason is not a closed set because Meta statuses and BRIDGE_ERROR are also stored.
- meta_call_id and correlation_id are unique in WaDesk, and provider is an engine stamp set on create that defaults to baileys even though calls are WABA-only.

**`wa_catalogs`**

- At most one row per (workspace_id, provider), enforced by a WaDesk DB unique key.
- access_token_enc is Laravel-encrypted and for dialog_360 it carries the 360dialog API key rather than a Meta bearer token.
- waba_id, phone_number_id and catalog_id are Meta string ids with no local table.

**`wa_chat_links`**

- WaDesk uses SoftDeletes here (deleted_at, not shown in the packet).
- slug is globally unique across all workspaces (public /l/{slug} namespace) via a DB unique key that soft-deleted rows also occupy.
- click_count and last_clicked_at are bumped atomically on every public redirect; there is no per-click table, so it is a hot counter row.
- Paused links and links past expires_at return HTTP 410.

**`wa_coupons`**

- WaDesk has a DB unique key (workspace_id, code); storefront_id NULL means the coupon applies to all storefronts of the workspace.
- amount is a percent (1 to 100) when type is 'percent' and minor currency units when type is 'flat'; used_count is incremented in place at checkout.

**`wa_customer_profiles`**

- phone is stored as canonical digits-only and matched by digits against orders and groups; WaDesk has a DB unique key (workspace_id, phone) and no link to contacts.
- Read by the ordering flow to pre-fill the ship-to before falling back to the customer's last order.

**`wa_form_submissions`**

- flow_token has the shape 'form-<form_id>-<session_key>' and is what routes a submission back to the paused flow.
- contact_id and conversation_id are resolved by phone match at ingest and may be NULL; the duplicate-conversation merger later re-points conversation_id.
- meta_payload is the raw webhook kept for debugging.

**`wa_forms`**

- Meta calls these Flows: meta_flow_id is set on publish and provider_config_id records which WABA it was published on (no DB FK in WaDesk).
- WaDesk uses SoftDeletes here (deleted_at, not shown in the packet) and has a DB unique key (workspace_id, slug).
- submission_count is a denormalised counter and submission_cap 0 means unlimited.
- definition_json holds screens (each with fields), theme and post_submit settings.
- audience_type is validated only for length; known values lead_capture, survey, appointment, feedback, onboarding and support map to Meta categories, anything else to OTHER, so it is not a closed set.

**`wa_group_members`**

- Joins to wa_groups by (workspace_id, group_jid) text rather than by id; the member sync deletes and re-inserts per workspace and WaDesk has a DB unique key (workspace_id, group_jid, phone).
- phone is digits-only and powers the reverse lookup of which group a customer is in when an order is confirmed.

**`wa_groups`**

- Mirror of the WhatsApp groups the Baileys bot number is in, keyed by group_jid and device_phone (digits, not a devices FK); WaDesk has a DB unique key (workspace_id, group_jid).
- group_code is an optional code baked into wa.me links so an order can be pinned to a group (matched by wa_pending_orders.group_code and wa_orders.meta_json.group_code).

**`wa_link_clicks`**

- Looked up by token on the public unauthenticated /r/{token} redirect (no tenant context, expired rows answer 410), so the port needs a lookup path that works outside tenant scope.
- campaign_id points at wpcampaigns (the Campaigns feature), not meta_campaigns, and the row has a workspace_id used for scoping.
- message_id is never populated by any caller in this version, so treat it as reserved.
- A row is reused for the same URL, broadcast, campaign, message and contact until it expires (default 90 days, setting wa_link_tracking_ttl_days with a 7-day minimum), and known bot user agents are redirected without counting.
- unique_clicks is a best-effort distinct-IP-per-hour tally kept via cache, not a true distinct count.

**`wa_merchant_gateways`**

- storefront_id is NOT NULL DEFAULT 0 in WaDesk where 0 means workspace-wide default (no storefront), so the port should map 0 to NULL; a real FK with RESTRICT would reject the 0 rows.
- credentials is Laravel-encrypted JSON of gateway-specific keys (ciphertext, not queryable JSON) while meta is plain JSON.
- slug is the payment driver slug (razorpay, stripe, paystack, flutterwave and others), shared with the platform payment gateways but not a FK; WaDesk has a DB unique key (workspace_id, storefront_id, slug).

**`wa_order_items`**

- price_minor and name are copied per unit at order time; retailer_id is the SKU as Meta sees it (string, not a FK) and product_id is NULL when the buyer ordered an unknown SKU.
- Coexists with wa_orders.items_json, which is also written for catalog orders.

**`wa_orders`**

- This is the commerce order table; WaDesk's separate orders table is SaaS plan-purchase billing, so order_id columns elsewhere that mean commerce orders must point here.
- items_json is a denormalised snapshot whose shape varies by source (native: name, qty, price_minor; shopify and woo importers: title, qty, price, sku) and wa_order_items rows exist only for catalog and AI orders.
- payment_method mixes prepaid or cod (storefront checkout), whatsapp_pay, and a merchant gateway driver slug, so it is not a closed set.
- rto_score (0 to 100) and rto_band are computed only for COD storefront orders; low below 30, medium below 60, else high.
- shopify_order_id and woo_order_id are external id strings; wa_payment_reference_id is the WhatsApp Pay join key (35 chars max) and recovery_token is the public tracking key.
- customer_phone is nullable (importers may lack a phone) and a status change to paid or completed triggers invoice and HubSpot side effects.

**`wa_pending_orders`**

- One open cart per customer: WaDesk has a DB unique key (workspace_id, customer_phone) and ref ('ord:<workspace_id>:<digits>') links to wa_stock_reservations.ref.
- On confirm the row becomes 'confirmed' with order_id set and a wa_orders row is created; cancel sets 'cancelled'; expires_at lets abandoned carts lapse.
- group_code softly matches wa_groups.group_code, and ship_* and order_media_* hold the captured ship-to and the original voice note or photo with its transcript.

**`wa_product_reviews`**

- Reviews are created by the public storefront as 'pending' with customer_name, rating (1 to 5) and body only; order_id (verified-purchase link) is never written by any code.
- order_id means a commerce order, so it points to wa_orders, not the SaaS billing orders table.

**`wa_product_sets`**

- product_ids is an ordered JSON array of wa_products ids with no FK; members are resolved at send time, filtered to active products and capped at 30 (Meta's multi-product limit).
- meta_set_id is reserved for a future Meta product_set sync and is never written; WaDesk has a DB unique key (workspace_id, slug).

**`wa_products`**

- WaDesk uses SoftDeletes here (deleted_at, not shown in the packet); the port hard-deletes, so wa_order_items.product_id SET NULL and wa_product_sets.product_ids must tolerate vanished products.
- price_minor is always price x100 regardless of currency (even zero-decimal ones like IDR); conversion to Meta's unit happens only when pushing to the Meta catalog.
- stock_qty NULL means unlimited and sellable quantity is stock_qty minus reserved_qty, where reserved_qty is maintained by wa_stock_reservations holds.
- user_id is only the creating user (importers set it to the integration owner) yet WaDesk cascades product deletion with the user.
- shopify_product_id and woo_product_id are external id strings used with workspace_id as importer upsert keys.
- meta_retailer_id falls back to sku then 'wsn-<id>' and must never change once pushed to Meta.

**`wa_provider_configs`**

- credentials_json is a Laravel Crypt-encrypted PHP array (ciphertext, not JSON) whose keys depend on provider: waba has app_id, app_secret, waba_id, business_id, phone_number_id, access_token, webhook_verify_token, catalog_id and register_pin; baileys has server_url, device_id and qr_paired_at; twilio has account_sid, auth_token, from_number and sandbox.
- provider holds waba, baileys (a pointer row), twilio, sms and meta_ads; meta_ads rows keep Click-to-WhatsApp ad credentials and are never a messaging sender, and a workspace may hold many rows (the unique on workspace_id was dropped).
- meta_json carries per-provider details such as waba_id and phone_number_id (Meta ids, not relations), inbound_wired, inbound_checked_at and wa_username_status.
- calling_enabled_meta is the raw body of Meta's calling-settings response, with calling_enabled and calling_enabled_at as the local mirror.
- is_primary marks the default sender, chosen by is_primary, then connected_at, then id, and always excluding meta_ads.
- conversations.device_id and wa_templates.provider_config_id point at this table for the official engines.

**`wa_stock_reservations`**

- Hold ledger: hold creates a 'held' row and raises wa_products.reserved_qty, commit flips it to 'committed' and decrements stock_qty, release flips it to 'released', and a heartbeat sweep releases held rows past expires_at.
- ref groups all holds of one customer's cart and equals wa_pending_orders.ref; order_id is filled on commit and points to wa_orders, not the billing orders table.

**`wa_storefront_views`**

- The table has no workspace_id and is written by unauthenticated public storefront traffic using insert-then-increment, equivalent to an upsert on unique (storefront_id, day) that adds 1 to views.
- The dashboard sums views for the last 30 days across the workspace's storefront ids.

**`wa_storefronts`**

- slug and custom_domain are globally unique in WaDesk because the public storefront resolves a tenant from the URL slug or host, so they cannot be unique per org only.
- payment_config_json holds key_id in plain text but key_secret and webhook_secret as Crypt-encrypted strings (razorpay_api), or just {handle} for the other providers, so it contains secrets.
- device_id is NULL by design for stores sending over WABA or Twilio; the sender is then resolved from the workspace's provider config.
- settings_json keys are logo_url, brand_color, hero_text, footer_text, cart_recovery_enabled, cart_recovery_delay_min and cart_recovery_message; shipping_json keys are flat_minor, free_above_minor and note (minor units).
- A workspace can own several storefronts (the old unique(workspace_id) was dropped); slug is auto-generated from the workspace name when empty.
- custom_domain_verified is reset to false whenever custom_domain changes and is set by a DNS lookup.

**`wa_templates`**

- template_name, header, template_body, footer, rejection_reason and the JSON columns header_location, buttons, carousel_data and variable_map are Laravel-encrypted at rest, so reference-DB values are ciphertext and cannot be searched or uniquely indexed in SQL.
- Rows with workspace_id NULL and user_id NULL are the admin-seeded global starter library shown to every tenant, which a NOT NULL org_id cannot represent.
- category is overloaded (some writers store a WhatsApp category, others a business vertical such as travel or finance), while meta_category (lower-case marketing, utility, authentication) is the real WhatsApp category and meta_status and quality_score are stored upper-case.
- channel selects the engine; provider_config_id and meta_template_id are set only for waba, twilio_content_sid only for twilio, and meta_template_id is globally unique in WaDesk.
- status is the local lifecycle while meta_status mirrors Meta, and a WABA template is sendable only when meta_status is APPROVED, paused_until is not in the future and quality_score is not RED.
- code_expiration_minutes applies to authentication templates only (1 to 90, NULL means 10), and header_location holds the location header as JSON when attachment_type is location.

**`waba_groups`**

- Separate from wa_groups (Baileys groups keyed by @g.us jid): group_id here is Meta's opaque base64 id and identity is (provider_config_id, group_id), enforced by a WaDesk DB unique key.
- invite_link arrives later via the group_lifecycle_update webhook, so it is legitimately empty right after creation.
- suspended is set and cleared by group_status_update webhooks; meta_json holds a participants sample, raw webhook payloads and the last error.
- creation_timestamp is Meta's group creation time, not the row's.

**`wallet_transactions`**

- There is no workspace_id: the wallet is per user (the workspace owner), and users.wallet_credits and users.wallet_currency_minor mirror the running balances inside the same DB transaction.
- kind separates two parallel balances (credit = message credits, currency = money top-ups), and a top-up writes a currency row plus a paired credit earn row whose subject_id points at the currency row.
- amount sign is inconsistent: WalletService::chargeForSend writes negative spend amounts while MessageBillingService and OverflowBilling write positive spend amounts, and refunds are positive.
- subject_type stores PHP class names (for example CreditPackage, MessageCharge, WalletTransaction) with a numeric subject_id, so it is polymorphic and needs mapping on import.
- Rows are insert-only (only created_at, no updated_at) and are referenced by id from referrals.award_transaction_id and message_charges.wallet_tx_id.

**`warmer_daily_sends`**

- device_id is polymorphic by engine: devices.id when engine is baileys and wa_provider_configs.id for waba and twilio, which is why engine is part of the unique key (engine, device_id, day).
- It is a mutable per-day counter updated by atomic increment or upsert, not an event log, and count includes sends reserved for future days; day is the date in the number's own timezone.

**`webhook_deliveries`**

- Insert-only, one row per dispatch that summarises up to 3 inline attempts (attempts holds the count and is_retry is attempts greater than 1), including event_name 'test_fire' rows.
- payload is JSON text (json_encode of the event envelope) encrypted at rest, response_body is the raw HTTP body encrypted at rest, and error is plain text.
- status_code is NULL when the request failed at transport level.
- There is no workspace_id in WaDesk, so org_id must be copied from the parent webhook when inserting.

**`webhooks`**

- webhook_url, secret and events are app-encrypted, and events is a JSON array of event names or '*'.
- http_method is validated as POST or PUT but WebhookService::deliver always sends a POST.
- retry_count is never read or written by the code (attempts are recorded on webhook_deliveries), so it is effectively unused.
- status is a boolean (active or paused) and is_failing is set on a failed delivery once the cumulative failure_count reaches 3.
- success_count, failure_count and the last_* columns are denormalised values updated on every delivery; legacy rows may have NULL workspace_id and fall back to user_id ownership.

**`wechat_broadcast_recipients`**

- openid is WeChat's plaintext user id and rows exist only for audience 'list'; all are marked sent together after the single mass-send call.
- conversation_id is the inbox thread that gets the mirrored outbound message.

**`wechat_broadcasts`**

- template_id is validated but never saved by the controller and buttons is never written either, so both columns are effectively unused for WeChat.
- Only audience 'list' pre-inserts recipient rows (at least 2); 'all' and 'tag' are a single mass-send API call, so total stays 0 for them and sent is set to total on success.
- body is Laravel-encrypted at rest; mass_msg_id is WeChat's returned msg_id and tag_id is WeChat's numeric tag id stored as a string.
- WeChat caps Service Accounts at about 4 mass sends per month.

**`wechat_channels`**

- app_secret, encoding_aes_key and cached_access_token are Laravel-encrypted at rest (encoding_aes_key is a secret even though the packet leaves it plain text); verify_token is stored plaintext because it is the webhook signature Token.
- cached_access_token is a shared 7200s token refreshed under a lock because fetching a new one invalidates the old one; token_expires_at drives refresh when under 5 minutes remain.
- The row id is embedded in conversations.raw_jid as 'wechat:<channelRowId>:<openid>' to route replies, so channel ids or those raw_jid values must stay consistent after migration.
- webhook_token has a DB unique key and is the routing token in /api/wechat/inbound/{token}; reconnecting the same app_id in a workspace updates the existing row and keeps it.

**`wechat_flow_sessions`**

- No PHP or Node code reads or writes this table; the Node flow engine keeps sessions in an in-memory map, so the table is an unused durable mirror.
- vars is a Laravel-encrypted JSON array and await_options is plain JSON; WaDesk has a DB unique key on conversation_id (one session per conversation).

**`woocommerce_cart_recoveries`**

- scheduled_ids is a JSON array of scheduled_messages ids with no FK, cancelled when the order is placed.
- checkout_token is a Woo cart or checkout identifier that is written once and never queried, so it is not a secret.
- customer_phone is normalised to E.164 digits using the billing country before storing.
- status 'done' exists only in the migration comment; code writes just active and recovered.

**`woocommerce_cod_confirmations`**

- An inbound Yes/No reply updates the newest pending row for workspace + customer_phone, pushes processing or cancelled to the remote Woo order, and updates wa_orders.status where wa_orders.woo_order_id matches.
- woo_order_id is WooCommerce's numeric order id kept as a string, not a local FK.

**`woocommerce_integration_events`**

- event_type is a closed set enforced by automationTypes(), including order.<status> events fired from order.updated and review/reward.
- WaDesk has unique (integration_id, event_type) because rows are written with updateOrCreate.
- var_map is an ordered JSON list of context field names bound to template positions; null means the default order.
- delay_seconds is only honoured for cart/step2 and cart/step3 follow-ups.
- The table has no workspace_id; tenancy comes from integration_id.

**`woocommerce_integration_logs`**

- The table has no workspace_id, so org_id must be denormalised from the integration.
- A row is inserted and then UPDATEd in the same request (status, recipient, response, error), so the stream cannot be strictly insert-only.
- The review/reward automation reads this table as a dedupe check (event_type='review/reward', recipient=phone, last 30 days), so keep an index on (integration_id, event_type, recipient, created_at).
- recipient mixes meanings: a phone, a comma-joined phone list, or summary text such as '40 contacts'.
- event_type holds webhook topics plus pseudo events such as cod/confirm, cod/reply, cod/risk, review/reward, offer/broadcast, winback/broadcast and stock/back.

**`woocommerce_integrations`**

- consumer_key is Laravel-encrypted just like consumer_secret, so it is a credential even though the packet leaves it untagged.
- webhook_secret doubles as the routing token in /woocommerce/webhook/{secret} (looked up by equality across workspaces) and as the HMAC key for verifying WooCommerce webhook signatures, so treat it as SECRET.
- WaDesk has unique (workspace_id, store_url), allowing several stores per workspace.
- metadata holds webhook_ids and sender_key (the chosen 'Send from' sender, engine:id, blank means Auto).
- user_id is the connecting user and the sender identity for sends; WaDesk declares it NOT NULL with no FK.

**`woocommerce_stock_waitlist`**

- woo_product_id is WooCommerce's numeric product id as a string and matches wa_products.woo_product_id; it is not a local FK.
- Rows flip from waiting to notified (setting notified_at) when a product.updated webhook shows an out-of-stock to in-stock transition.

**`workspace_addons`**

- Created by CheckoutController after a paid order for a packages row with type='addon'; the add-on's limits and feature flags are merged onto the base plan while the row is active.
- Active means status 'active' and (ends_at NULL or in the future); ends_at NULL is a lifetime add-on and expiry is evaluated from ends_at, not by updating status.
- Code only ever writes status 'active'; 'cancelled' and 'expired' appear only in the migration comment.

**`workspace_email_accounts`**

- Mirror of an account that lives on the external MailTrixy install: mailtrixy_account_id, mtx_workspace_id and mtx_last_message_id are ids on that other system, not local references, so they must not become foreign keys.
- mtx_workspace_id is informational (the MailTrixy-side workspace), and mtx_last_message_id is the sync cursor holding the highest MailTrixy message id already imported.
- Conversations encode this row's local id inside conversations.raw_jid as 'email:<rowId>:<mtxConversationId>', so row ids must survive the migration or raw_jid must be rewritten.
- Inbound MailTrixy pushes find the workspace by looking up mailtrixy_account_id across all workspaces, so that lookup has to run outside a tenant context.
- Only status 'connected' is ever written and every read treats anything else as not connected; a unique key on (workspace_id, mailtrixy_account_id) exists in WaDesk.

**`workspace_flags`**

- Rows are never edited except to set cleared_at and cleared_by_user_id; an active flag is cleared_at IS NULL and several active rows of the same flag per workspace are allowed.
- Suspending a workspace writes a 'frozen' flag and also sets workspaces.status to false; unsuspending clears the active frozen flags.

**`workspace_ig_accounts`**

- Mirror of an Instagram account that lives on the external Instaflow install: instaflow_account_id is the Instagram user id held by Instaflow, kept as an opaque string and never a local id.
- status NULL is treated as connected by the connected() scope; code writes only 'connected' or 'disconnected'.
- A unique key on (workspace_id, instaflow_account_id) already exists in WaDesk.

**`workspace_payment_configs`**

- WhatsApp Pay Direct Pay Method name created on the Meta side; provider_config_id points at the workspace's wa_provider_configs row with provider='waba'.
- meta_json is cast encrypted:array, so MySQL holds Laravel ciphertext rather than JSON (decrypt on import); the only key code writes is auto_charge.
- Controller always writes country 'IN' and currency 'INR'; the migration default payment_type 'upi' is legacy because validation only allows razorpay, payu, billdesk, zaakpay.
- A unique key on (workspace_id, config_name) already exists in WaDesk and store() upserts on it.

**`wp_campaign_contacts`**

- Also the recipient log of the SMS and email campaign runners, so whatsapp_message_id holds the provider message id (SMS sid or email message id) for those campaigns.
- status is written by Laravel and Node callbacks; 'responded' comes from the inbound-reply webhook and 'skipped' is only counted as terminal by the aggregates and never written.
- unsubscribed and is_unsubscribed are redundant flags: a STOP sets both plus unsubscribed_at, while compliance-skipped rows set only is_unsubscribed; STOP also flips contacts.is_unsubscribed.
- phone_number and recipient_name are encrypted at rest; error_message is encrypted by Eloquent writes but written plaintext by raw webhook updates.
- response holds the first inbound reply text truncated to 500 chars and tracking_id is only set by the mobile app API campaigns.
- WaDesk has no DB FK on purpose, rows are updated per webhook (not append-only), and send_attempts and next_attempt_at drive the retry sweeper.

**`wpcampaigns`**

- device_id is polymorphic by the provider column: devices.id for baileys, wa_provider_configs.id for waba and twilio, and local row ids of other channel tables (facebook pages, telegram bots) or Instaflow account ids for those engines, so it cannot be a single FK.
- Most text columns are Laravel-encrypted at rest (campaign_name, custom_message, custom_message_b, custom_header, custom_footer, custom_variable_map, custom_buttons, custom_quick_replies, template_overrides, template_overrides_b), so the JSON columns are ciphertext in WaDesk.
- status is free text written by both Laravel and the Node bridge (draft, scheduled, running, sending, active, paused, cancelled, completed, failed, error), so it is not a closed set.
- scheduled_message_id (and the reverse scheduled_messages.campaign_id) is added by a migration but never read or written by any code, so treat it as dead.
- delivered, read, responded and clicked counters are derived from wp_campaign_contacts by recomputeAggregates, and meta_clicked_count is Meta's template_analytics count (the UI shows the larger of clicked_count and meta_clicked_count).
- workspace_id can be NULL on legacy rows that are scoped via created_by, and SMS and email engines also use this table and wp_campaign_contacts.
