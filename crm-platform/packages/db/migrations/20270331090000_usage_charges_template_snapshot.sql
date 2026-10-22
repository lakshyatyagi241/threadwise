-- wallet: keep the template and the campaign/broadcast/schedule name on each message charge, as they were sent.
-- Why this migration exists: the expense log shows which template each message cost. Reading the name back through the
-- campaign or broadcast recipient rows only works while those rows and the template still exist, works for no chat, flow or
-- scheduled send, and cannot be filtered or grouped on without joins on every page. A charge is an immutable record, so the
-- name is copied onto it when the message is settled. Nullable: charges written before this migration keep NULL.
-- Plain ADD COLUMN with no default is a catalog-only change, so it does not rewrite the partitions.

ALTER TABLE usage_charges ADD COLUMN template_name text;
ALTER TABLE usage_charges ADD COLUMN subject_name text;
