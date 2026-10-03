-- chat: what a connected WhatsApp Cloud channel knows about its own health (plan-inbox-chat.md Phase 2).
-- Why this migration exists: a Cloud channel stops working in ways nobody asked for (Meta stops accepting the access token, the number
-- is flagged, the quality rating drops) and the inbox has to say so. The status needs a value for "the provider refused our credentials
-- and a person must paste new ones" (`needs_reauth`, a cure, unlike the catch-all `error`), the last health snapshot and the last
-- system-recorded failure need a place, and so does the account id (WABA) that is not a secret and that the screen shows back.
--
-- Nothing here is a secret: the access token and app secret stay inside the sealed `credentials_enc`. `business_account_id` is a Meta
-- id shown in the settings page; `health` is the last answer of a health check (names, ratings, issues); `last_error` is a code and a
-- sentence. Existing rows keep their values (all new columns are nullable).

ALTER TABLE channels DROP CONSTRAINT chk_channels_status;
ALTER TABLE channels ADD CONSTRAINT chk_channels_status
  CHECK (status IN ('connected', 'disconnected', 'error', 'needs_reauth'));

ALTER TABLE channels
  ADD COLUMN business_account_id text,
  ADD COLUMN health             jsonb,
  ADD COLUMN health_checked_at  timestamptz,
  ADD COLUMN last_error         jsonb;

ALTER TABLE channels
  ADD CONSTRAINT chk_channels_business_account_id CHECK (business_account_id IS NULL OR business_account_id ~ '^[0-9]{5,32}$'),
  ADD CONSTRAINT chk_channels_health CHECK (health IS NULL OR jsonb_typeof(health) = 'object'),
  ADD CONSTRAINT chk_channels_last_error CHECK (last_error IS NULL OR jsonb_typeof(last_error) = 'object');

-- --- one WhatsApp number, one channel ---------------------------------------------------------------------------------------------------
-- A provider-level webhook (one URL for every number of the platform's Meta app or BSP account) names the number, not the workspace, so a
-- number id must lead to exactly one channel. Until now only (org, kind, external_id) was unique, which let two workspaces connect the same
-- number; with a platform credential doing the sending, that would let one workspace read another's customers' messages. The first
-- workspace to connect a number holds it.
CREATE UNIQUE INDEX uq_channels_whatsapp_number ON channels (external_id)
  WHERE kind = 'whatsapp_cloud' AND external_id IS NOT NULL;

-- The lookup the provider-level webhook route makes: phone number id -> its channel and tenant, nothing else (same SECURITY DEFINER
-- pattern as chat_channel_lookup). After it answers, the channel is read under its own tenant and the delivery goes through the normal path.
CREATE OR REPLACE FUNCTION chat_channel_by_external(p_kind text, p_external_id text)
RETURNS TABLE (channel_id bigint, channel_org_id bigint, channel_uuid uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT c.id, c.org_id, c.uuid FROM channels c WHERE c.kind = p_kind AND c.external_id = p_external_id;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

REVOKE ALL ON FUNCTION chat_channel_by_external(text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION chat_channel_by_external(text, text) TO crm_app_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_worker_user') THEN
    GRANT EXECUTE ON FUNCTION chat_channel_by_external(text, text) TO crm_worker_user;
  END IF;
END
$$;
