-- lead handling, step 1: the "uncontacted" marker on a contact, and the per-workspace settings that drive it (BL-290).
-- Why: a lead that nobody has reached yet needs a quiet marker the team can filter on, and the workspace decides which actions count
-- as reaching out. `uncontacted_since` is null for every existing contact (no backfill: nothing changes until a workspace opts in);
-- a timestamp means "uncontacted, waiting since then". The three settings sections (uncontacted, follow_ups, duplicates) share one
-- table, one row per (workspace, section), so the three Settings screens never overwrite each other's version.
-- docs/specs/lead-followup-settings.md

ALTER TABLE contacts ADD COLUMN uncontacted_since timestamptz;

CREATE INDEX idx_contacts_org_uncontacted ON contacts (org_id, uncontacted_since)
  WHERE uncontacted_since IS NOT NULL;

-- contacts_touch(): an UPDATE that changes nothing but `last_activity_at` and/or `uncontacted_since` keeps `updated_at` and
-- `row_version`. A colleague's reply clears the marker; that must not 409 the next save of someone who has the contact open.
-- (Same pattern as 20261121090000_contacts_activity_touch.sql; the jsonb comparison only runs when one of the two columns moved.)
CREATE OR REPLACE FUNCTION contacts_touch() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.last_activity_at IS DISTINCT FROM OLD.last_activity_at
      OR NEW.uncontacted_since IS DISTINCT FROM OLD.uncontacted_since)
     AND (to_jsonb(NEW) - ARRAY['last_activity_at', 'uncontacted_since', 'updated_at', 'row_version'])
       = (to_jsonb(OLD) - ARRAY['last_activity_at', 'uncontacted_since', 'updated_at', 'row_version']) THEN
    NEW.updated_at := OLD.updated_at;
    NEW.row_version := OLD.row_version;
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- settings: one row per (workspace, section); a missing row means the defaults in @crm/contracts (lead-handling/settings.ts)
-- ---------------------------------------------------------------------------------------------------------------------------

CREATE TABLE lead_followup_settings (
  org_id bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  section text NOT NULL,
  -- The section's document, validated by the contract on write and merged over the defaults on read.
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, section),
  FOREIGN KEY (org_id, updated_by) REFERENCES users (org_id, id) ON DELETE SET NULL (updated_by),
  CONSTRAINT ck_lead_followup_settings_section CHECK (section IN ('uncontacted', 'follow_ups', 'duplicates')),
  CONSTRAINT ck_lead_followup_settings_config CHECK (jsonb_typeof(config) = 'object' AND pg_column_size(config) <= 8192)
);
ALTER TABLE lead_followup_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_followup_settings FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lead_followup_settings FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
CREATE TRIGGER trg_lead_followup_settings_touch BEFORE UPDATE ON lead_followup_settings
  FOR EACH ROW EXECUTE FUNCTION touch_row();
