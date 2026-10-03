-- chat: a WhatsApp channel is a view of a connected WABA number (one WhatsApp stack).
-- Why this migration exists: connecting, credentials, the public webhook and the Meta/Interakt client for WhatsApp numbers belong to the
-- WABA domain (`wa_provider_configs`, provider 'waba'). The inbox keeps its own `channels` row per number because a conversation, a send
-- and a receipt all name a channel, but the row no longer holds credentials or receives webhooks: it points at the connection that does.
--
--  1. `waba_config_id` links a channel to its `wa_provider_configs` row. Composite foreign key (org_id, id) so a channel can never point
--     at another workspace's number; removing the number detaches the channel (SET NULL on the link column only: `org_id` is part of
--     the key and the channel row, with its conversations, outlives the connection).
--  2. One connection, one channel per workspace.
--  3. Existing `whatsapp_cloud` channels are linked to the connected number with the same phone number id, and a connected number that
--     has no channel gets one, so the inbox lists it without waiting for the first inbound message.
--  4. `chat_channel_by_external` (the lookup of the removed provider-level webhook route) is dropped: the WABA webhook routes by
--     `waba_route_lookup` and hands the inbox its connection id.
--
-- Nothing here is a secret. A linked channel's credentials stay encrypted in `wa_provider_configs.credentials_json`; the channel's own
-- `credentials_enc` (the pre-link way of pasting a token into the inbox) is left in place and ignored.

ALTER TABLE channels ADD COLUMN waba_config_id bigint;

ALTER TABLE channels
  ADD CONSTRAINT fk_channels_waba_config
  FOREIGN KEY (org_id, waba_config_id) REFERENCES wa_provider_configs (org_id, id) ON DELETE SET NULL (waba_config_id);

CREATE UNIQUE INDEX uq_channels_waba_config ON channels (org_id, waba_config_id) WHERE waba_config_id IS NOT NULL;

-- --- backfill ---------------------------------------------------------------------------------------------------------------------------
-- The migration role owns both tables and RLS is forced, so run privileged for the duration of this statement block.
SELECT set_config('app.privileged', 'on', true);

-- Link what already exists: the same workspace's WhatsApp channel for the same phone number id.
UPDATE channels ch
   SET waba_config_id = w.id,
       business_account_id = CASE WHEN w.meta_json ->> 'waba_id' ~ '^[0-9]{5,32}$' THEN w.meta_json ->> 'waba_id' ELSE ch.business_account_id END
  FROM wa_provider_configs w
 WHERE ch.kind = 'whatsapp_cloud'
   AND w.provider = 'waba'
   AND w.org_id = ch.org_id
   AND ch.external_id IS NOT NULL
   AND w.meta_json ->> 'phone_number_id' = ch.external_id
   AND ch.waba_config_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM channels other
      WHERE other.org_id = w.org_id AND other.waba_config_id = w.id);

-- Give every other connected number a channel. A number id already held by a channel of another workspace is skipped (the global unique
-- index on the number id decides: the first workspace to connect a number holds it).
INSERT INTO channels (org_id, kind, name, status, external_id, display_address, business_account_id, waba_config_id, settings)
SELECT w.org_id,
       'whatsapp_cloud',
       left(btrim(coalesce(nullif(btrim(w.display_label), ''), nullif(btrim(w.phone_number), ''), 'WhatsApp')), 120),
       'connected',
       w.meta_json ->> 'phone_number_id',
       left(nullif(btrim(w.phone_number), ''), 40),
       CASE WHEN w.meta_json ->> 'waba_id' ~ '^[0-9]{5,32}$' THEN w.meta_json ->> 'waba_id' ELSE NULL END,
       w.id,
       '{"metered": true}'::jsonb
  FROM wa_provider_configs w
 WHERE w.provider = 'waba'
   AND w.status = 'connected'
   AND w.meta_json ->> 'phone_number_id' ~ '^[0-9]{5,32}$'
   AND NOT EXISTS (SELECT 1 FROM channels c WHERE c.org_id = w.org_id AND c.waba_config_id = w.id)
ON CONFLICT DO NOTHING;

-- --- the removed provider-level webhook's lookup --------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS chat_channel_by_external(text, text);
