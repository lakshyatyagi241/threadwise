-- wgt: resolve an embed token to its organization (WD-WGT-008, 009, 010, 014, 018, 020).
--
-- Why this exists: every public widget route (embed script, chat page, config, message, history) arrives with only the
-- 48-character token, so there is no tenant yet, and the row that names the tenant is itself behind row-level security.
-- Lifting RLS in application code for a public route is exactly what the tenancy rules forbid, so the lookup is a
-- SECURITY DEFINER function that returns two ids for one token and nothing else. After it answers, the widget is read
-- and every write happens under the normal tenant context.
--
-- Also adds the value checks WaDesk only enforced in its controller, so a row written any other way cannot hold a mode
-- or position the widget script does not understand.

CREATE OR REPLACE FUNCTION wgt_widget_lookup(p_token text)
RETURNS TABLE (widget_id bigint, widget_org_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT w.id, w.org_id FROM chatbot_widgets w WHERE w.embed_token = p_token;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

REVOKE ALL ON FUNCTION wgt_widget_lookup(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION wgt_widget_lookup(text) TO crm_app_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_worker_user') THEN
    GRANT EXECUTE ON FUNCTION wgt_widget_lookup(text) TO crm_worker_user;
  END IF;
END
$$;

ALTER TABLE chatbot_widgets
  ADD CONSTRAINT chk_chatbot_widgets_mode CHECK (mode IN ('ai', 'whatsapp', 'both')),
  ADD CONSTRAINT chk_chatbot_widgets_position CHECK (position IN ('bottom_right', 'bottom_left')),
  ADD CONSTRAINT chk_chatbot_widgets_body_bg_kind CHECK (body_bg_kind IN ('color', 'image')),
  ADD CONSTRAINT chk_chatbot_widgets_status CHECK (status IN ('active', 'paused'));

-- One visitor row per browser per widget: the replay guard (a uuid from widget A never resolves on widget B) is a lookup
-- on this pair, so the pair gets the index that serves it.
CREATE INDEX idx_chatbot_widget_visitors_uuid_widget ON chatbot_widget_visitors (org_id, widget_id, visitor_uuid);
