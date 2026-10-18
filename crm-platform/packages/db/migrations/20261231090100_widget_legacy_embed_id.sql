-- The id an existing customer's website embed still carries. A widget migrated from the old product keeps the bot id its pages were
-- published with (`<script src=".../output.js">` plus that id), so the old snippet keeps loading the right widget after cutover
-- without every customer re-pasting a new one. NULL for every widget created here.
--
-- Public lookup follows the embed-token pattern: the request arrives with no tenant, so a narrow SECURITY DEFINER function returns
-- the one widget's token for one id. The id is unique across the whole table (a clash is a loud insert error, never a quiet
-- cross-tenant pick), and the token it returns is the same credential the normal embed uses, so the allow-list, the paused state
-- and the rotation of a widget behave exactly as they do for a new embed.

ALTER TABLE chatbot_widgets
  ADD COLUMN legacy_embed_id text,
  ADD CONSTRAINT ck_chatbot_widgets_legacy_embed_id CHECK (legacy_embed_id IS NULL OR legacy_embed_id ~ '^[A-Za-z0-9_-]{1,64}$');

CREATE UNIQUE INDEX uq_chatbot_widgets_legacy_embed_id ON chatbot_widgets (legacy_embed_id) WHERE legacy_embed_id IS NOT NULL;

CREATE OR REPLACE FUNCTION wgt_legacy_lookup(p_legacy text)
RETURNS TABLE (widget_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT w.embed_token FROM chatbot_widgets w WHERE w.legacy_embed_id = p_legacy;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

REVOKE ALL ON FUNCTION wgt_legacy_lookup(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION wgt_legacy_lookup(text) TO crm_app_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_worker_user') THEN
    GRANT EXECUTE ON FUNCTION wgt_legacy_lookup(text) TO crm_worker_user;
  END IF;
END
$$;
