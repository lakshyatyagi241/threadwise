-- 2031_groups_segments_updated_by
-- Why this migration exists (not what it does — the SQL says that):
--
-- The contact groups and segments listings show who created each row and who last modified it. Groups already kept their creator
-- (created_by); a segment's creator is its owner, which is set once when the segment is made and never changed afterwards. Neither
-- table kept who made the last change, so each row gets an updated_by written in the same transaction as the change it records.
-- Rows that existed before this migration keep updated_by NULL ("not modified since the feature shipped") and get created_by from owner.

ALTER TABLE contact_groups
  ADD COLUMN updated_by bigint,
  ADD CONSTRAINT fk_contact_groups_updated_by FOREIGN KEY (org_id, updated_by)
    REFERENCES users (org_id, id) ON DELETE SET NULL (updated_by);
CREATE INDEX idx_contact_groups_updated_by ON contact_groups (org_id, updated_by);

ALTER TABLE segments
  ADD COLUMN created_by bigint,
  ADD COLUMN updated_by bigint,
  ADD CONSTRAINT fk_segments_created_by FOREIGN KEY (org_id, created_by)
    REFERENCES users (org_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT fk_segments_updated_by FOREIGN KEY (org_id, updated_by)
    REFERENCES users (org_id, id) ON DELETE SET NULL (updated_by);
CREATE INDEX idx_segments_created_by ON segments (org_id, created_by);
CREATE INDEX idx_segments_updated_by ON segments (org_id, updated_by);

-- The backfill must not look like an edit: segments_touch() would bump updated_at and row_version on every segment, and every open
-- editor would then get a 409. The trigger is off for this one statement only.
ALTER TABLE segments DISABLE TRIGGER trg_segments_touch;
UPDATE segments SET created_by = owner_id WHERE created_by IS NULL AND owner_id IS NOT NULL;
ALTER TABLE segments ENABLE TRIGGER trg_segments_touch;
