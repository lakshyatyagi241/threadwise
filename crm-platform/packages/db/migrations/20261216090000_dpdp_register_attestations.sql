-- 20261216090000_dpdp_register_attestations
-- Why this migration exists: the DPDP compliance register (super admin console) shows which DPDP Act and Rules obligations the platform
-- follows. Most of its checks are read from the code and the database, but some facts only a person can vouch for (a vendor contract is
-- signed, the incident runbook was rehearsed, the notice was published). A super admin records that as an attestation, with a note, an
-- optional evidence link and an expiry, so a stale claim stops counting on its own.
--
--  * Platform table, not tenant data: no org_id, privileged transactions only (same shape as org_lifecycle_log).
--  * Append-only for every role, the table owner and privileged transactions included. A correction or a withdrawal is a new row; the
--    register reads the newest row per check. Unlike audit_log there is no privileged DELETE exception: nothing prunes this table,
--    because it is the durable record (security_events, which also gets a row per attestation, is pruned by the audit retention window).
--  * The only personal data is the operator id that attested.

CREATE TABLE dpdp_register_attestations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  check_key    text        NOT NULL,
  result       text        NOT NULL CHECK (result IN ('pass', 'fail')),
  note         text        NOT NULL CHECK (length(note) >= 10),
  evidence_url text,
  attested_by  bigint      NOT NULL REFERENCES platform_operators (id),
  attested_at  timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

-- "Newest attestation for a check" and "history of a check, newest first".
CREATE INDEX idx_dpdp_register_attestations_key ON dpdp_register_attestations (check_key, attested_at DESC);

-- Platform table, not tenant data: privileged transactions only.
ALTER TABLE dpdp_register_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dpdp_register_attestations FORCE  ROW LEVEL SECURITY;
CREATE POLICY platform_only ON dpdp_register_attestations FOR ALL
  USING (app_is_privileged()) WITH CHECK (app_is_privileged());

-- First line of defence: the application roles hold no UPDATE or DELETE grant at all.
REVOKE UPDATE, DELETE ON dpdp_register_attestations FROM crm_app, crm_worker;

-- Second line: a row trigger that refuses UPDATE and DELETE for every role, including the table owner and privileged transactions.
-- (A REVOKE does not bind the owner, and app_is_privileged() is set by the application itself, so neither is enough alone.)
CREATE OR REPLACE FUNCTION dpdp_register_attestations_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'dpdp_register_attestations is append-only (% refused)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER dpdp_register_attestations_append_only
  BEFORE UPDATE OR DELETE ON dpdp_register_attestations
  FOR EACH ROW EXECUTE FUNCTION dpdp_register_attestations_guard();

COMMENT ON TABLE dpdp_register_attestations IS
  'Append-only super admin attestations for the DPDP compliance register. Holds no personal data beyond the id of the operator who attested.';
