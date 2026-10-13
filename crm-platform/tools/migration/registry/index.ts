/**
 * Every Waboo collection seen in the pilot discovery (iskm, karma), what we do with it, and why.
 * A collection that is not here (and matches no pattern) resolves to UNKNOWN, which is an alarm: coverage, run and reconcile fail on it.
 *
 * MIGRATE        phase 1, has a handler
 * MIGRATE_LATER  will be migrated, handler is a 'todo' (phase 2)
 * EXCLUDE        deliberately not migrated (log, derived, temp, backup, catalogue, decided out of scope)
 * GAP            real data with no table in crm-platform; needs a product/schema decision (nothing is invented here)
 * OPEN           undecided: not migrated, reported on every run until someone decides
 */
export type Disposition = 'MIGRATE' | 'MIGRATE_LATER' | 'EXCLUDE' | 'GAP' | 'OPEN';
export type Handler =
  | 'field_sections'
  | 'field_defs'
  | 'field_options'
  | 'field_deps'
  | 'field_option_deps'
  | 'lifecycle'
  | 'tags'
  | 'contacts'
  | 'groups'
  | 'group_members'
  | 'notes'
  | 'contact_files'
  | 'roles'
  | 'users'
  | 'inbox'
  | 'campaigns'
  | 'recipients'
  | 'credit_wallet'
  | 'credit_tokens'
  | 'usage_charges'
  | 'flow_bots'
  | 'flow_chatbots'
  | 'flow_headers'
  | 'flow_versions'
  | 'flow_nodes'
  | 'flow_workspace'
  | 'faq_replies'
  | 'faq_knowledge'
  | 'widget_assistants'
  | 'widgets'
  | 'widget_config'
  | 'widget_theme'
  | 'lead_sources'
  | 'lead_events'
  | 'lead_events_leads'
  | 'attributions'
  | 'automation_flows'
  | 'automation_nodes'
  | 'segments'
  | 'saved_views'
  | 'templates'
  | 'wa_forms'
  | 'api_library'
  | 'outbound_webhooks'
  | 'chat_labels'
  | 'knowledge_sources'
  | 'todo';

export interface RegistryEntry {
  collection: string;
  disposition: Disposition;
  targets: string[];
  reason: string;
  handler?: Handler;
}

const m = (
  collection: string,
  targets: string[],
  reason: string,
  handler: Handler,
): RegistryEntry => ({ collection, disposition: 'MIGRATE', targets, reason, handler });
const later = (collection: string, targets: string[], reason: string): RegistryEntry => ({
  collection,
  disposition: 'MIGRATE_LATER',
  targets,
  reason,
  handler: 'todo',
});
const ex = (collection: string, reason: string): RegistryEntry => ({
  collection,
  disposition: 'EXCLUDE',
  targets: [],
  reason,
});
const gap = (collection: string, reason: string): RegistryEntry => ({
  collection,
  disposition: 'GAP',
  targets: [],
  reason,
});
const open = (collection: string, reason: string): RegistryEntry => ({
  collection,
  disposition: 'OPEN',
  targets: [],
  reason,
});

const NOT_IMPORTED =
  'not imported as data: the organization comes from --org-name / --org-slug / --org-plan (and --owner-email / --owner-name)';

export const REGISTRY: RegistryEntry[] = [
  // --- phase 1: migrated ---------------------------------------------------------------------------------------------------------
  m(
    'contact_properties_fields',
    ['field_sections', 'fields'],
    'contact property definitions (type "section" becomes a field section); credential-named properties are excluded',
    'field_defs',
  ),
  m(
    'contact_properties_field_options',
    ['field_options'],
    'option lists of dropdown/radio/multiselect properties',
    'field_options',
  ),
  m(
    'contact_properties_field_dependancy_mapping',
    ['field_dependencies'],
    'field-depends-on-field pairs',
    'field_deps',
  ),
  m(
    'contact_properties_field_options_dependancy_mapping',
    ['field_option_dependencies'],
    'option-to-option dependencies',
    'field_option_deps',
  ),
  m(
    'contact_lifecycle_stages',
    ['status_options'],
    'lifecycle stages and stage statuses. OPEN QUESTION: the status/stage mapping (which rows are stages, which are statuses) needs manager confirmation',
    'lifecycle',
  ),
  m(
    'contact_tag',
    ['tags'],
    'tag dictionary (no source of contact-tag links was found in the sampled contact documents)',
    'tags',
  ),
  m(
    'contact_list',
    ['contacts', 'contact_group_members'],
    'core contacts; custom flat keys go to contacts.data with matching fields rows; embedded marketing_list ids become group members; credential-looking keys are never copied',
    'contacts',
  ),
  m(
    'marketing_list',
    ['contact_groups'],
    'static contact lists (membership is embedded in contact_list.marketing_list)',
    'groups',
  ),
  m('contact_notes', ['contact_notes'], 'notes on a contact', 'notes'),

  // --- stage 2: roles and users ------------------------------------------------------------------------------------------------------
  m(
    'roles',
    ['roles', 'role_grants'],
    'Waboo roles become custom roles (grants from the REVIEWED access/permission-map.json only: an unmapped permission grants nothing, admin-class keys are withheld, keys outside the org plan are filtered) or point at a preset named in access/role-map.json (approver required, never Owner). Role names and is_staff are never privilege. UNREVIEWED until the manager signs the maps (OQ-9)',
    'roles',
  ),
  m(
    'user',
    ['users', 'user_profiles', 'user_security', 'user_roles'],
    'Waboo users without a password (password_hash NULL, no invite, no token, no mail); role through role-map (default Viewer); only the --owner-email user holds Owner; deleted users excluded, inactive ones load inactive. No Waboo password field is ever read, stored or printed',
    'users',
  ),

  // --- stage 2: chat history = inbox ---------------------------------------------------------------------------------------------------
  m(
    'chathistory',
    ['channels', 'conversations', 'messages', 'message_ledger'],
    'team decision "chathistory = inbox": one document is ONE TURN; the turns of a phone number become ONE conversation (not one per Waboo session) on a channel made from the operator channel-map.json (never from chatbot_misc_config), messages written as quiet history (backdated, outbound always sent, no unread / events / outbox / usage). Website chat is quarantined (WEBCHAT_NO_CHANNEL), threads of deleted contacts excluded (--keep-deleted-contact-chats). chathistory_view is a derived copy and stays excluded. The shapes of bot_response.response[] are UNVERIFIED on a real dump',
    'inbox',
  ),

  // --- stage 2: simple flows -> chatbot flows, chatbot widgets, FAQ phrases ---------------------------------------------------------
  m(
    'chatbots',
    ['flows', 'chatbot_widgets'],
    'one bot_id = one chatbot flow (a WhatsApp bot) and, for a website bot (or a bot with a whatsapp_number), one widget. The document is adopted into its flow / widget (id_map points at it) or excluded with a counted reason: WEB_BOT_NO_FLOW, SOFT_DELETED, BOT_INACTIVE, NO_NODES. Team decisions "flows (Simple->Chatbot)", "No version history", "chatbot"',
    'flow_chatbots',
  ),
  m(
    'bot_flow_version',
    ['flows'],
    'version headers: the latest version only (--flow-version published|draft|newest, default published, else the newest version, else the draft); the selected header is adopted into the flow, every other version is excluded OLDER_VERSION',
    'flow_versions',
  ),
  m(
    'bot_flow_version_data',
    ['flows'],
    'node-per-record steps of the latest version, converted by the vendored web importer (flows/wabo-convert.ts, exact mode) into flows.flow_data. Imported flows are is_published=false AND is_active=false, always. Lost and counted per flow (CONVERSION_LOSS): quick actions, API actions, template variables, extra responses, other languages, link and live-agent buttons; header images/texts are kept raw; steps of an unsupported subType (karma: button, phone-number) are excluded UNSUPPORTED_STEP',
    'flow_nodes',
  ),
  m(
    'bot_workspace',
    ['flows'],
    'the draft copy: Intent / FAQ records name the journeys and give the trigger words (a string or a list); Flow records are the steps only when the policy picks the draft or no version exists',
    'flow_workspace',
  ),
  m(
    'flows',
    ['flows'],
    "journey headers of a bot: cross-check only (JOURNEY_MAIN_DIVERGES); adopted into the bot's flow",
    'flow_headers',
  ),
  m(
    'faq_variations',
    ['keyword_replies', 'faqs', 'faq_variations', 'faq_settings'],
    'extra FAQ phrases of a journey -> keyword_replies (reply_type flow, status FALSE, no contents, matching exact), one row per 255 characters of comma-joined phrases. A journey inside a flow cannot be addressed: the reply starts the whole flow (QID_NOT_ADDRESSABLE). SECOND CONSUMER of the same collection: the derived step faq_knowledge (own id_map collection, virtual, like flow_bots) builds the FAQ-feature rows from these phrases plus the question and answer in the Intent / FAQ records -> faqs (PAUSED) + faq_variations (source import, embedding pending) + faq_settings (enabled false). The registry model has one handler per collection, so only faq_replies is named here',
    'faq_replies',
  ),
  m(
    'chatbot_configuration',
    ['chatbot_widgets', 'ai_chat_assistants'],
    'widget behaviour: folded with the bot and the theme into ONE chatbot_widgets row (PAUSED, closed allow-list, a freshly generated embed token) and, when the AI part is on, a PAUSED ai_chat_assistants row (model, prompt, temperature). API keys (normalKey, openRouterKey) are never copied; the other settings with no column are named in CONFIG_NOT_PRESENT',
    'widget_config',
  ),
  m(
    'chatbot_theme',
    ['chatbot_widgets'],
    'widget colours (hex values of primary / button); folded into the widget row',
    'widget_theme',
  ),

  // --- stage 2: lead data -----------------------------------------------------------------------------------------------------------
  m(
    'leadrepo',
    ['lead_sources', 'lead_events'],
    'team decision (user, 2026-10-09: "lead repo and all others are on hold ... make this remaining part as well"): one row per lead capture -> lead_events (status created = finished, contact from contact_id, the form answers with dynamic per-client keys scrubbed in payload.fields, campaign / device keys in payload.attribution / payload.device) under ONE paused connector lead_sources row "Waboo import: leadrepo" (no token, no hook, never ingested). Imported as history: no contact is created, no deal, no outbox, no notification, no flow enrolment. A lead whose contact is not migrated is quarantined (nothing is created for it). Shapes UNVERIFIED: leadrepo was NOT exported yet (masked profile only)',
    'lead_events',
  ),
  m(
    'leads',
    ['lead_events'],
    'lead events of bot sessions (WhatsApp, 300 sampled: all channel whatsapp, botid + module_id, same visitor / campaign / device keys as leadrepo). Decided from the profile that it overlaps leadrepo (the whatsapp part of leadrepo carries botid + module_id): a leads document whose session_id exists in leadrepo is excluded DUPLICATE_OF_LEADREPO, every other one loads like a leadrepo document under its own paused source "Waboo import: leads". UNVERIFIED: the overlap rate is only known once both are exported',
    'lead_events_leads',
  ),
  m(
    'contact_attribution',
    ['contact_attributions'],
    'first-touch attribution, one document per contact (real ISKM 4,542 / Rhythm 2,253): first_touch.platform / .source / .raw_utm_campaign / .module_name / .captured_at -> contact_attributions (platform, source_label, campaign, form, captured_at). lead_event_id and source_id stay NULL (the touch did not come through a lead source). The current top-level touch, when it differs, is recorded as the soft issue LATEST_TOUCH_DIFFERS and not imported (first touch only). Append-only table: rows are never updated',
    'attributions',
  ),

  // --- phase 2: will be migrated, not yet --------------------------------------------------------------------------------------------
  later(
    'visitor_logs',
    ['conversations', 'chatbot_widget_visitors'],
    'one row per chat session (phase 2)',
  ),
  later(
    'visitor_logs_view',
    ['conversations'],
    'derived projection of visitor_logs; migrate with visitor_logs or drop then (phase 2)',
  ),
  m(
    'broadcasting',
    ['wpcampaigns'],
    'broadcast campaigns -> wpcampaigns (history under Campaigns, always a TERMINAL status, retry off: an imported campaign never sends). Templates are NOT migrated: template_id stays NULL and the Waboo template name / sender number / costs have no column (NOT PRESENT, listed in every report; proposal tools/migration/proposals/legacy-jsonb.sql awaits approval). test=true campaigns are excluded',
    'campaigns',
  ),
  m(
    'whatsapp_broadcasting_data',
    ['wp_campaign_contacts'],
    'per-recipient rows with source = broadcast and a broadcast_id -> wp_campaign_contacts (failed rows carry no sent_at; no money is written). Every other row is a billing / delivery log of automation, inbox or test sends: excluded NON_BROADCAST_SOURCE by this step (counted) and migrated by the credits step, handler usage_charges: usage_charges + usage_charge_keys keyed by message_id = wamid, written as free, no wallet debit',
    'recipients',
  ),

  // --- stage 2: credits ----------------------------------------------------------------------------------------------------------------
  m(
    'credit_logs',
    ['wallet_transactions', 'wallets', 'ai_token_usage'],
    'team decision "credit-logs should migrate all": EVERY row. Token counters -> ai_token_usage (idempotent through migration.id_map); money rows that round to at least 0.01 -> wallet_transactions (immutable ledger, text amounts, the rounding residual is summed and reported), anchored by an opening admin_adjust entry computed from an operator-supplied, externally CONFIRMED balance (credit-opening.json: the wallet part is refused without it; credit_logs.new_balance is never used as the balance); the wallet row is created last with balance = sum(ledger). Spec B section 3',
    'credit_wallet',
  ),
  m(
    'automation_journey',
    ['flows'],
    'advanced flows, the runtime copy (one row per node, plus the event triggers the runtime adds under a send / delay): the definition is automation_metadata, so each row is ADOPTED into the flow of its automation (id_map points at it) when the definition holds the node, EXCLUDED DERIVED_EVENT_NODE for the event triggers, quarantined NO_DEFINITION / NOT_IN_DEFINITION / JOURNEY_DIVERGES otherwise. Imported automations are unpublished AND inactive, always',
    'automation_nodes',
  ),
  later(
    'file_manager',
    ['OPEN'],
    'GAP note: crm-platform has no file-library table, and the files themselves must be copied into our object store; migrate later with a storage plan',
  ),
  later(
    'chatbot_misc_config',
    ['channels', 'wa_provider_configs'],
    "HIGH RISK: holds the WhatsApp token, phone-number id and WABA id plus Google OAuth and OpenAI keys. Target is the channel tables (channels / wa_provider_configs), NOT chatbot_widgets. Secrets may only go through the app's encrypted-credential path, never through this tool's SQL and never into logs",
  ),
  m(
    'automation_metadata',
    ['flows'],
    'advanced flows (one document per automation, node map + UI layout): one flows row per automation (category "Waboo automation"), converted by automation/convert.ts. Nodes WaDesk has no equivalent for become inert placeholders that keep their type and scrubbed config; every loss is a counted soft issue. is_published false AND is_active false, always (nothing is armed). Latest document per automationId; empty drafts excluded NO_NODES. Manager to confirm automations are in scope (spec C Q4)',
    'automation_flows',
  ),
  m(
    'whatsapp_flow',
    ['wa_forms'],
    'Meta WhatsApp Flows -> wa_forms, ALWAYS draft: no provider config, no meta_flow_id (a form with a Meta id could be sent by flow nodes or edited at Meta), never published. No WaDesk code builds definition_json from Meta Flow JSON yet, so template_flow / mapping_object / categories / meta_id / clone_id are kept RAW (scrubbed) under definition_json.legacyWaboo and the loss is the counted soft issue FORM_DEFINITION_RAW (PUBLISHED forms also FORM_NOT_PUBLISHED). Slug = slugified name + last 6 of the id',
    'wa_forms',
  ),
  m(
    'segments',
    ['segments'],
    'dynamic segments: the Waboo rule-builder filter is converted to the WaDesk rule tree by field kind; a filter that cannot be said exactly (negated group, unknown field or operator, more than 3 levels) is quarantined RULE_UNSUPPORTED, never guessed. Shared with the workspace; owner = the migrated creator',
    'segments',
  ),
  m(
    'contact_saved_views',
    ['contact_views'],
    'saved contact views: custom views only (the 3 system views exist natively in WaDesk: excluded SYSTEM_VIEW); filter converted like a segment',
    'saved_views',
  ),
  m(
    'webhooks',
    ['webhooks'],
    'outbound webhooks: NOT loadable by this tool. webhooks.webhook_url is NOT NULL and the app stores AND decrypts it as a CryptoService blob (a plain value would break the whole list screen), as is the secret; the tool has no crypto, so every document is quarantined WEBHOOK_URL_NEEDS_ENCRYPTION (secret / headers lost: WEBHOOK_SECRET_NOT_CARRIED). Empty on iskm, rhythm and karma. webhook_logs is never imported',
    'outbound_webhooks',
  ),
  later(
    'api_library',
    ['api_library_apis'],
    'saved API definitions. Target is now api_library_apis (alib_core migration); headers marked secret and function code need the encrypted-credential path, so a later builder owns it. Until then the flow converter keeps Waboo API actions as a counted loss (CONVERSION_LOSS apiActions + the apiLibraryIds they pointed at): the api_library flow node needs the uuid of a migrated library API and has success/error ports that a Waboo side-action does not have',
  ),
  later(
    'attachments',
    ['conversation_media_uploads'],
    'uploaded files; objects must be copied. The rows whose id is a contact_files id are consumed by the contact_files step (they hold the address of the file); the rest (import logs, knowledge-base files, message media) has no target yet',
  ),
  m(
    'contact_files',
    ['contact_files'],
    'files attached to a contact. The document is only the label (name, rounded size, extension, uploader, date); the address is the attachments row with the same id (read together, shipped as _attachment). Rows load with storage_key = the Waboo https address; pilot/files/copy-files.cjs downloads it into the documents bucket as contact-files/<org id>/waboo/<hash>/<name>, rewrites storage_key and fills file_size_bytes / mime_type. No address in the dump = quarantined NO_FILE_URL. Soft-deleted files and files of deleted contacts are excluded',
    'contact_files',
  ),
  m(
    'chatlabels',
    ['tags', 'conversation_tag'],
    'conversation labels: every document is quarantined LABEL_LINK_UNVERIFIED. The collection is empty on iskm, rhythm and karma (no shape seen), and the inbox step keys conversations by phone number, not by Waboo id, so a label cannot be tied to a conversation exactly; nothing is guessed. When data appears: reuse tags by case-insensitive name, then link through the inbox thread key',
    'chat_labels',
  ),

  m(
    'document_col',
    ['ai_training_sources'],
    'AI knowledge base (RAG): Waboo keeps metadata only (no text, no vectors in Mongo). Website sources -> ai_training_sources kind url, workspace-wide (assistant_id NULL), status failed + "Not fetched yet: re-ingest" (deduped by address; deleting/deleted excluded). File sources are not loaded: quarantined NEEDS_REUPLOAD with the file name. Vectors are never copied. Pages are read by WaDesk itself through the separate operator command kb-reingest (outbound requests to the client site)',
    'knowledge_sources',
  ),

  // --- undecided ----------------------------------------------------------------------------------------------------------------------
  open('openchat_logs', 'AI open-chat Q&A log: undecided (not migrated, reported on every run)'),

  // --- excluded by decision ---------------------------------------------------------------------------------------------------------
  ex('project', NOT_IMPORTED),
  ex('project_configuration', NOT_IMPORTED),
  ex('workspace_settings', NOT_IMPORTED),
  m(
    'broadcast_templates',
    ['wa_templates'],
    'WhatsApp message templates (team decision "Template yes"): loaded as they are at Meta, keeping meta_template_id and the Meta status; nothing is re-submitted. A component WaDesk cannot place exactly quarantines the template. Broadcast campaigns are linked to their template by exact match (broadcast/template-link.ts; load order templates -> campaigns; campaign-link repairs campaigns loaded earlier)',
    'templates',
  ),
  ex(
    'credits_mapping',
    'team decision "credit-mapping dont need to migrate": the older shape of credits_mapping_new',
  ),
  ex(
    'credits_mapping_new',
    'team decision "credit-mapping new need to migrate", done by the SEPARATE operator command `pricing-seed` (dry-run by default, owner connection, typed confirmation, never overwrites) and NEVER by a client run: message_rates / plan_message_margins are GLOBAL platform tables and the collection has no client key (it is a platform rate card copied into each Waboo database). Email / SMS prices, dial codes, country names and AI model prices have no table (NOT PRESENT, counted in every report; proposal proposals/pricing-extras.sql, not applied). The models[] array holds provider keys and is never read',
  ),
  ex('entry_points', 'lead entry point dictionary'),
  ex(
    'source_registry',
    'UTM source dictionary (26 rows). Not imported: crm-platform lead_sources are ingest doors (webhook / connector), not a dictionary of UTM values, and nothing references it (first_touch.source_registry_id is null on every ISKM and Rhythm attribution). The source NAME travels as text in contact_attributions.source_label',
  ),
  ex(
    'medium_registry',
    'UTM medium dictionary (24 rows, identical on ISKM and Rhythm: a platform seed list). Not imported for the same reason as source_registry: no table for a value dictionary, and first_touch.medium_registry_id is null on every attribution. The earlier plan to put it in lead_sources was wrong: lead_sources are doors, not mediums',
  ),
  ex('company_properties_fields', 'companies are out of scope'),
  ex('company_properties_field_options', 'companies are out of scope'),
  ex('company_properties_field_dependancy_mapping', 'companies are out of scope'),
  ex('company_properties_field_options_dependancy_mapping', 'companies are out of scope'),
  ex('deals', 'deals are out of scope'),
  ex('deal_pipelines', 'deals are out of scope'),
  ex('deal_properties', 'deals are out of scope'),
  ex(
    'credits_expenses',
    'credit purchase log (1 document on karma, none on iskm): the direction is unknown ("credit" may mean money in), there is no balance and no currency. A purchase is already inside the confirmed opening balance. Excluded and kept in the raw archive; if the client says it is a top-up, post it as type topup BEFORE the opening balance is computed (README OQ-5)',
  ),
  ex(
    'journey',
    'legacy duplicate of bot_workspace (same node shape), NOT automation_journey; use it only as a cross-check of bot_workspace',
  ),
  ex('auth_logs', 'login/logout event log'),
  ex(
    'available_permissions',
    'permission catalogue: READ-ONLY input of the `permission-catalogue` command (lists the Waboo keys that access/permission-map.json does not map yet); never loaded as data',
  ),
  ex('shapes', 'automation builder UI shape library'),
  ex('node_execution_history', 'automation run log'),
  ex('company_saved_views', 'companies are out of scope (company* is excluded by team decision)'),
  ex('sms_broadcasting_data', 'no SMS broadcast table in crm-platform; excluded by team decision'),
  ex(
    'email_broadcasting_data',
    'no email broadcast table in crm-platform; excluded by team decision',
  ),
  ex('automation_version', 'version history: flows keep the latest version only (team decision)'),
  ex(
    'automation_node_version',
    'version history: flows keep the latest version only (team decision)',
  ),
  ex(
    'flows_version',
    'version history of the journey headers: flows keep the latest version only (team decision "No version history"); still read by nothing, the selected bot_flow_version names the latest version',
  ),
  ex(
    'field_history',
    'audit of every field change (2.4M on karma); pilot default is exclude, product decision pending',
  ),
  ex('import_contacts_progress', 'temporary import progress counters'),
  ex('import_history', 'import job history, operational'),
  ex('export_history', 'export job log, operational'),
  ex('meta_callbacks', 'raw Meta webhook payload log'),
  ex('meta_callbacks_error', 'raw Meta webhook payloads that errored'),
  ex('webhook_logs', 'outbound webhook call log'),
  ex('chathistory_view', 'derived projection of chathistory'),
  ex(
    'contact_list_dummy',
    'looks like a dummy/test copy of contact_list (karma only): CONFIRM with the client before cutover',
  ),
  ex('contact_attribution_audit_log', 'history of attribution changes; optional, no clean target'),
  ex('system.profile', 'MongoDB system collection'),
  {
    collection: '/^temp_/',
    disposition: 'EXCLUDE',
    targets: [],
    reason: 'temporary import scratch collection',
  },
  {
    collection: '/(_bak|_bkp|_backup)(_\\d+)?$/',
    disposition: 'EXCLUDE',
    targets: [],
    reason: 'backup copy of another collection',
  },

  // --- real data with no table in crm-platform --------------------------------------------------------------------------------------
  gap(
    'contact_task_config',
    'task/reminder action configuration; no matching table. no team decision: ask manager',
  ),
];

const exact = new Map(
  REGISTRY.filter((e) => !e.collection.startsWith('/')).map((e) => [e.collection, e]),
);
const patterns = REGISTRY.filter((e) => e.collection.startsWith('/')).map((e) => ({
  re: new RegExp(e.collection.slice(1, -1)),
  e,
}));

export type Resolved =
  | (RegistryEntry & { known: true })
  | { collection: string; disposition: 'UNKNOWN'; targets: string[]; reason: string; known: false };

/** The catch-all: anything unlisted is UNKNOWN, never silently skipped. */
export function resolve(collection: string): Resolved {
  const hit = exact.get(collection) ?? patterns.find((p) => p.re.test(collection))?.e;
  if (hit) return { ...hit, collection, known: true };
  return {
    collection,
    disposition: 'UNKNOWN',
    targets: [],
    reason: 'not in the registry: decide MIGRATE / EXCLUDE / GAP / OPEN and add it',
    known: false,
  };
}
