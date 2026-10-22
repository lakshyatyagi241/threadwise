-- 20270328090000_wa_templates_meta_edit_log
-- Why this migration exists (not what it does — the SQL says that):
--
-- Meta limits how often an approved template can be edited: one edit in 24 hours and ten in 30 days. The API has to count the
-- edits it sent, and the count cannot live only in Meta's answer, because a refused edit is not counted there. This column keeps the
-- times of the edits the API sent to Meta, as ISO timestamps, trimmed to the last 30 days on every write.
--
-- Defaults to an empty array so existing templates start with no edits on record.
-- No new policy or index: wa_templates already has ENABLE/FORCE RLS and tenant_isolation, and the column is read by primary key.

ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS meta_edit_log jsonb NOT NULL DEFAULT '[]'::jsonb;
