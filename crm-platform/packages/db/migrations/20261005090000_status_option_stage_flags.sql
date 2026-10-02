-- crm: won/lost semantics for contact lifecycle stages (follow-up to the Contact stages screen).
-- Why this migration exists: a lifecycle stage was only a label, so "moved to Lost" carried no meaning the product could act on
-- (ask why, stamp when). `is_won` / `is_lost` are opt-in flags an admin sets on a stage of the lifecycle_stage group (the API
-- refuses them on other groups); a stage is never both. Nothing is flagged by this migration: existing stages behave as before
-- until an admin flags them.
-- `contacts.won_at` / `lost_at` are stamped when a contact enters a flagged stage and cleared when it leaves, next to the
-- `lost_reason` / `other_lost_reason` columns that already exist.
-- It also makes "one default stage per group" a rule of the database: the service already cleared the old default on every
-- change, but two concurrent edits could leave two. Rows that already break it keep their lowest-id default.

ALTER TABLE status_options
  ADD COLUMN is_won  boolean NOT NULL DEFAULT false,
  ADD COLUMN is_lost boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT chk_status_options_won_xor_lost CHECK (NOT (is_won AND is_lost));

UPDATE status_options s SET is_default = false
WHERE s.is_default AND EXISTS (
  SELECT 1 FROM status_options o
  WHERE o.org_id = s.org_id AND o.module_key = s.module_key AND o.option_group = s.option_group
    AND o.is_default AND o.id < s.id
);
CREATE UNIQUE INDEX uq_status_options_one_default
  ON status_options (org_id, module_key, option_group) WHERE is_default;

ALTER TABLE contacts
  ADD COLUMN won_at  timestamptz,
  ADD COLUMN lost_at timestamptz;
