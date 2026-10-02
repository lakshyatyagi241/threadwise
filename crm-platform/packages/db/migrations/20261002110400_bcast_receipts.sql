-- bcast: find the broadcast recipient a delivery receipt is about (TW-BCAST-024, 027).
--
-- A receipt arrives with a provider message id and no tenant. The recipient row carries that id, so the lookup is by it. The
-- lookup is a SECURITY DEFINER function that returns three ids and nothing else, for the same reason as bcast_link_lookup:
-- no tenant exists yet, and lifting row-level security in application code is not allowed. The receipt itself is then applied
-- under the normal tenant context.

CREATE INDEX IF NOT EXISTS idx_broadcast_contacts_provider_message_id
  ON broadcast_contacts (whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION bcast_receipt_lookup(p_message_id text)
RETURNS TABLE (receipt_org_id bigint, receipt_broadcast_id bigint, receipt_contact_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT c.org_id, c.broadcast_id, c.contact_id
    FROM broadcast_contacts c
    WHERE c.whatsapp_message_id = p_message_id
    ORDER BY c.id DESC LIMIT 1;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

REVOKE ALL ON FUNCTION bcast_receipt_lookup(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION bcast_receipt_lookup(text) TO crm_app_user;
  END IF;
END
$$;
