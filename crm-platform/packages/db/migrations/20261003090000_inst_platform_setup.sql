-- 20261003090000_inst_platform_setup
-- First-run lock for the platform (TW-INST-001, -008, -014, -015).
--
-- Reference marks "installed" with a file on disk. A container has no durable
-- filesystem, so the lock is a singleton row written in the SAME transaction
-- that creates the first operator and organization: either all three exist or
-- none does, and a second setup attempt can claim nothing (see the claim in
-- setup.repository.ts).
--
-- Platform-wide data (no org_id), so it follows platform_operators: forced RLS
-- with a privileged-only policy, reachable only through PlatformStore /
-- TenantDirectory.

CREATE TABLE platform_setup (
  id                smallint PRIMARY KEY DEFAULT 1,
  completed_at      timestamptz,
  completed_version text,
  first_operator_id bigint REFERENCES platform_operators (id) ON DELETE SET NULL,
  first_org_id      bigint REFERENCES organizations (id) ON DELETE SET NULL,
  app_url           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  row_version       integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_platform_setup_singleton CHECK (id = 1),
  CONSTRAINT chk_platform_setup_complete CHECK ((completed_at IS NULL) = (completed_version IS NULL))
);

ALTER TABLE platform_setup ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_setup FORCE  ROW LEVEL SECURITY;
CREATE POLICY privileged_only ON platform_setup FOR ALL
  USING      (app_is_privileged())
  WITH CHECK (app_is_privileged());
GRANT SELECT, INSERT, UPDATE ON platform_setup TO crm_app, crm_worker;

CREATE TRIGGER trg_platform_setup_touch BEFORE UPDATE ON platform_setup
  FOR EACH ROW EXECUTE FUNCTION touch_row();

-- _migrations is created by the runner before any role grants exist, so the
-- restricted application role cannot read it. The system page and the setup
-- prerequisites need to know which migrations ran; this exposes exactly that
-- (id, checksum, time) read-only and nothing else.
CREATE FUNCTION platform_migration_ledger()
  RETURNS TABLE (id text, checksum text, applied_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$ SELECT m.id, m.checksum, m.applied_at FROM _migrations m ORDER BY m.id $$;

REVOKE ALL ON FUNCTION platform_migration_ledger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_migration_ledger() TO crm_app, crm_worker;
