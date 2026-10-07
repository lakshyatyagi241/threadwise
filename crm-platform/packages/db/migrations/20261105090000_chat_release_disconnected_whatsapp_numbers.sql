-- chat: a disconnected WhatsApp channel lets go of its number.
-- Why this migration exists: a WhatsApp number belongs to one workspace's inbox at a time (the unique index `uq_channels_whatsapp_number`;
-- the first workspace to connect a number holds it). A workspace that disconnected or removed a number kept holding it on its dead channel,
-- so the next workspace to connect the same number (Meta's shared test number is the common case) got NO inbox channel: the WhatsApp screen
-- said Connected, the inbox said "Connect a channel", and nothing explained why.
--
-- From now on the application releases the number when a connection is disconnected or removed, and takes it back on reconnect (the channel,
-- its conversations and its history stay; reconnecting the same number in the same workspace re-adopts the channel by its display number).
-- This migration applies the same rule to what exists, then gives every connected number that was left without a channel its channel.
--
-- Nothing here is a secret. The migration role owns the tables and RLS is forced, so the statements run privileged.

SELECT set_config('app.privileged', 'on', true);

-- 1. Release the number of every disconnected WhatsApp channel.
UPDATE channels
   SET external_id = NULL
 WHERE kind = 'whatsapp_cloud'
   AND status = 'disconnected'
   AND external_id IS NOT NULL;

-- 2. A connected number that has no channel gets one (the same rule as the link migration: a number still held elsewhere is skipped).
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
