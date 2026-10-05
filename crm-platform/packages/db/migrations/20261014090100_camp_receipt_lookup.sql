-- camp: find the campaign recipient a provider message id belongs to, and the campaign of a callback.
-- Why this migration exists (TW-CAMP-021, 022): a delivery report from the provider and a callback from the Node bridge arrive without
-- a tenant. They name a message id or a campaign uuid, and this narrow SECURITY DEFINER lookup says which organization it belongs to;
-- everything after that runs under the normal tenant context. Same shape as `bcast_receipt_lookup` (broadcasts).

CREATE INDEX IF NOT EXISTS idx_wp_campaign_contacts_whatsapp_message_id
  ON wp_campaign_contacts (whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION camp_receipt_lookup(p_message_id text)
RETURNS TABLE (receipt_org_id bigint, receipt_campaign_id bigint, receipt_contact_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT r.org_id, r.campaign_id, r.contact_id
    FROM wp_campaign_contacts r
    WHERE r.whatsapp_message_id = p_message_id
    ORDER BY r.id DESC LIMIT 1;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

CREATE OR REPLACE FUNCTION camp_campaign_lookup(p_campaign uuid)
RETURNS TABLE (campaign_org_id bigint, campaign_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY SELECT c.org_id, c.id FROM wpcampaigns c WHERE c.uuid = p_campaign LIMIT 1;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

REVOKE ALL ON FUNCTION camp_receipt_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION camp_campaign_lookup(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION camp_receipt_lookup(text) TO crm_app_user;
    GRANT EXECUTE ON FUNCTION camp_campaign_lookup(uuid) TO crm_app_user;
  END IF;
END
$$;
