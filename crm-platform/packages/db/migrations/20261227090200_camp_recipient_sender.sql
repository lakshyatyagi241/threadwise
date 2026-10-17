-- A recipient's own sending number (TW-BCAST-006 / TW-BCAST-014 carried into the Campaign wizard).
--
-- Why. Reference let an admin tick several numbers on a broadcast and give each a share weight; the audience was split across them and
-- every contact was messaged from exactly one. The guided wizard picked one number only. A campaign row carries one (provider, device_id),
-- so a split send needs the number per RECIPIENT: the run, the 131049 retry and the follow-up steps read it from the recipient and fall
-- back to the campaign's own number when it is null. A send with one number (every row written before this migration, and every new
-- single-number send) leaves both columns null and behaves exactly as before.
--
--   sender_provider   the engine of the number this recipient is sent from (`waba`).
--   sender_device_id  that number's id in the engine's own table (wa_provider_configs.id for `waba`). No foreign key: the id lives in a
--                     different table per engine, the same reason wp_campaigns.device_id has none.
--
-- Both set or both null. The index serves the run's "which numbers still have recipients to send" lookup, only over the rows that have one.

ALTER TABLE wp_campaign_contacts
  ADD COLUMN sender_provider text,
  ADD COLUMN sender_device_id bigint;

ALTER TABLE wp_campaign_contacts
  ADD CONSTRAINT ck_wp_campaign_contacts_sender
  CHECK ((sender_provider IS NULL) = (sender_device_id IS NULL));

CREATE INDEX idx_wp_campaign_contacts_sender
  ON wp_campaign_contacts (org_id, campaign_id, sender_provider, sender_device_id)
  WHERE sender_provider IS NOT NULL;
