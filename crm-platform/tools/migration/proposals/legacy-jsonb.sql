-- PROPOSAL P1 (NOT APPLIED, NOT in packages/db, NOT approved): one additive `legacy` jsonb column on the two campaign tables.
--
-- Why: the Waboo broadcast fields below have no column in wpcampaigns / wp_campaign_contacts, and the only jsonb columns that exist
-- (`wpcampaigns.wizard`, `template_overrides`, `custom_variable_map`) are READ BACK by the application (the wizard detail page and the
-- resend / mirror services), so foreign JSON in them would change behaviour. Without this column the fields live only in the raw
-- export archive (and, for the campaign-level ones, as text in migration.quarantine).
--
-- Who decides: the manager (README question Q2). Who writes the real migration: someone running the `add-migration` skill in
-- crm-platform (a numbered file in packages/db/migrations plus the Drizzle column in packages/db/src/schema/campaigns/tables.ts).
-- This file is only the text to approve; the migration tool never runs it.
--
-- Properties: nullable, no default, no index, no trigger, no RLS change (the tables already have FORCE RLS on org_id), no backfill.
-- ADD COLUMN with no default is a metadata-only change in PostgreSQL 11+ (no table rewrite), so it is safe on a live table.

ALTER TABLE wpcampaigns ADD COLUMN legacy jsonb;
ALTER TABLE wp_campaign_contacts ADD COLUMN legacy jsonb;

COMMENT ON COLUMN wpcampaigns.legacy IS
  'Fields of a migrated source campaign that have no column of their own (read-only history, never replayed by a send). Written once by tools/migration; NULL for campaigns made in the app.';
COMMENT ON COLUMN wp_campaign_contacts.legacy IS
  'Fields of a migrated source recipient row that have no column of their own (read-only history). NULL for rows made in the app.';

-- What the tool would write once the column exists (scrubbed with the tool's shared secret filter; money as exact decimal STRINGS):
--
-- wpcampaigns.legacy = {
--   "src": "waboo",
--   "template":   { "id": "<broadcast_template_id>", "name": "<broadcast_template_name>", "type": "<broadcast_template_type>", "category": "<MARKETING|UTILITY>" },
--   "senderNumber": "+<digits>",
--   "audience":   { "filterQuery": { ... }, "mongodbQuery": "<string>", "search": "<string>", "marketingListId": "<id>" },
--   "components": { ... },
--   "retry":      { "enabled": true|false, "count": <int>, "max": <int>, "last": <bool> },
--   "cost":       { "billableAmount": "12.5", "refundedAmount": "4", "resellerAmount": "3.25" },
--   "counters":   { "sent": <int>, "delivered": <int>, "seen": <int>, "replied": <int>, "failed": <int>, "processing": <int>, "queued": <int> },
--   "updatedBy":  { "id": "<waboo user id>", "email": "<email>" }
-- }
-- wp_campaign_contacts.legacy = {
--   "src": "waboo",
--   "template": { "id": "<template_id>", "metaTemplateId": "<digits>", "category": "marketing|utility|service" },
--   "cost":     { "amount": "0.35", "cost": "0.35", "resellerAmount": "0.05", "resellerMargin": "1" },
--   "refund":   { "revert": false, "revertedAt": "<iso>", "refundRunId": "<id>" }
-- }
--
-- The recipient `cost` / `refund` keys are the billing log of the SAME wamid that the later credits step will write as usage_charges
-- (join key: message_id = usage_charges.wamid). If the manager prefers one home for money, drop those two keys from the proposal and
-- leave them to the credits step: nothing else here depends on them.
--
-- Not proposed: a `template_id` link (the template sync + a `link-templates` step does that; templates are not migrated), a `device_id`
-- (the sender number is only a number until the channel is connected), and any change to `wizard` / `template_overrides`.
--
-- Rollback: ALTER TABLE wpcampaigns DROP COLUMN legacy; ALTER TABLE wp_campaign_contacts DROP COLUMN legacy;
