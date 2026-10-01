-- contacts: WaDesk contact fields that have no column yet. WaDesk `mobile` is `phone`, `custom_attributes` is `data`,
-- `user_id` is `owner_id` and `contact_group` becomes contact_group_members (below); `mobile_hash` is not needed because
-- PII is stored plain under RLS here (see docs/wadesk-port/schema/README.md, decision P1).
ALTER TABLE contacts
  ADD COLUMN title           text,
  ADD COLUMN middle_name     text,
  ADD COLUMN language        text,
  ADD COLUMN address         text,
  ADD COLUMN country_code    text,
  ADD COLUMN channel         text,
  ADD COLUMN channel_uid     text,
  ADD COLUMN image_url       text,
  ADD COLUMN subject         text,
  ADD COLUMN message         text,
  ADD COLUMN is_unsubscribed boolean NOT NULL DEFAULT false,
  ADD COLUMN unsubscribed_at timestamptz;
-- A channel user (telegram chat, line user, ...) is one contact per org. Partial: phone-only contacts have neither column.
CREATE UNIQUE INDEX uq_contacts_org_channel_uid ON contacts (org_id, channel, channel_uid)
  WHERE channel IS NOT NULL AND channel_uid IS NOT NULL;
CREATE INDEX idx_contacts_org_unsubscribed ON contacts (org_id) WHERE is_unsubscribed;
