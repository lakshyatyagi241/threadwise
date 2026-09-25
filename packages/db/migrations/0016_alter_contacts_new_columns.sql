-- 0016_alter_contacts_new_columns
-- docs/global-schema-design.dbml's NEW contacts columns. Additive only —
-- `name` stays as-is; first_name/last_name are new columns alongside it,
-- not a replacement (no frontend exists yet to migrate off `name`, and
-- rewriting the reference vertical slice's stable contract for it now would
-- be a breaking change with nothing on the other end to catch it).
--
-- contacts already has RLS from 0007_rls_policies.sql — ALTER TABLE ADD
-- COLUMN needs no new RLS statements, the existing policy already covers
-- these rows.

ALTER TABLE contacts
  ADD COLUMN first_name text,
  ADD COLUMN last_name text,
  ADD COLUMN lifecycle_stage_date timestamptz,
  ADD COLUMN previous_lifecycle_stage text,
  ADD COLUMN previous_lifecycle_stage_date timestamptz,
  ADD COLUMN lost_reason text,
  ADD COLUMN other_lost_reason text,
  ADD COLUMN lead_score integer,
  ADD COLUMN whatsapp_subscription_status text,
  ADD COLUMN sms_subscription_status text,
  ADD COLUMN email_subscription_status text,
  ADD COLUMN email_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN fax_number text,
  ADD COLUMN last_activity_at timestamptz;

-- Backs the detail page's "Last Activity" column and any future
-- most-recently-active sort/filter.
CREATE INDEX idx_contacts_org_last_activity ON contacts (org_id, last_activity_at DESC);
