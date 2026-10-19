-- 20270201090000_wa_templates_header_media_key
-- Why this migration exists (not what it does — the SQL says that):
--
-- An uploaded header image (IMAGE/VIDEO/DOCUMENT) was sent to Meta only; the row kept just Meta's handle (attachment_file), which
-- is not viewable. So the template could not be shown again on open, nor in the phone preview. Reference keeps the uploaded file
-- in storage and shows it from there. This column holds the object-storage key of that copy. attachment_file stays the Meta handle
-- (it is what a submit needs), and header_sample_url stays Meta's sample URL.
--
-- Nullable: templates made before this change, and imports, have no stored copy and keep the old behaviour.
-- No new policy or index: wa_templates already has ENABLE/FORCE RLS and tenant_isolation, and the column is read by primary key.

ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS header_media_key text;
