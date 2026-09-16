-- 0007_rls_policies
-- Row-Level Security: the tenant isolation guarantee.
--
-- RLS does ONE job here — tenant isolation. It does not do permissions.
-- Who may read which rows *within* a tenant is RBAC, enforced at the
-- middleware layer (ADR-0006). Mixing the two into policies produces
-- unreadable SQL and unpredictable plans.
--
-- FORCE ROW LEVEL SECURITY matters: without it, the table owner (which is the
-- role that ran these migrations, and in development the same role the app
-- connects as) silently bypasses every policy, and all your isolation tests
-- pass against an app that has no isolation in production.

-- Dedicated runtime roles.
--
-- THIS IS NOT OPTIONAL. A superuser bypasses RLS entirely — FORCE does not
-- apply to them — so an application connecting as the postgres superuser has
-- no isolation at all, while every policy above still looks correct. The
-- default docker-compose POSTGRES_USER is a superuser, which is exactly the
-- trap this guards against.
--
-- crm_app / crm_worker are GROUP roles (no login). The actual login users are
-- created outside migrations (docker/postgres/init/01-app-roles.sql locally,
-- your provisioning tool in production) and granted membership below.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_worker') THEN
    CREATE ROLE crm_worker NOLOGIN;
  END IF;
END $$;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'users', 'teams', 'team_members', 'roles', 'user_roles', 'role_grants',
    'sequence_counters', 'companies', 'contacts', 'contact_identities',
    'partner_agents', 'partner_agent_leads', 'api_keys',
    'event_outbox', 'audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);

    -- One policy, all commands. USING gates what is visible; WITH CHECK gates
    -- what may be written — both must be present, or a tenant can INSERT a row
    -- into another tenant that it then cannot see (silent data corruption).
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        FOR ALL
        USING      (org_id = current_org_id() OR app_is_privileged())
        WITH CHECK (org_id = current_org_id() OR app_is_privileged())
    $p$, t);

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO crm_app, crm_worker', t);
  END LOOP;
END $$;

-- organizations is keyed by `id`, not `org_id`.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
  FOR ALL
  USING      (id = current_org_id() OR app_is_privileged())
  WITH CHECK (id = current_org_id() OR app_is_privileged());
GRANT SELECT, INSERT, UPDATE ON organizations TO crm_app, crm_worker;

-- permission_defs is the global capability registry: readable by everyone,
-- writable only by migrations.
GRANT SELECT ON permission_defs TO crm_app, crm_worker;

GRANT USAGE ON SCHEMA public TO crm_app, crm_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app, crm_worker;

-- Future tables and sequences created by the migration role inherit these, so
-- a new domain migration does not have to remember a GRANT. It still has to
-- remember ENABLE + FORCE ROW LEVEL SECURITY and a policy — that part cannot
-- be defaulted, and it is on the PR checklist.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO crm_app, crm_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app, crm_worker;

-- Attach the login users if they already exist. Ordering is not guaranteed:
-- the compose init script runs before migrations, a production provisioning
-- step may run after, so both paths are handled — this block here, and a
-- GRANT in the provisioning script.
DO $$
DECLARE
  login_role text;
BEGIN
  FOREACH login_role IN ARRAY ARRAY['crm_app_user', 'crm_worker_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = login_role) THEN
      EXECUTE format('GRANT %I TO %I',
        CASE WHEN login_role = 'crm_app_user' THEN 'crm_app' ELSE 'crm_worker' END,
        login_role);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Privileged mode
--
-- `app.privileged = on` lifts the tenant predicate. It exists for genuinely
-- cross-tenant work: draining the outbox, rolling up usage charges, partition
-- maintenance, and the API-key prefix lookup that has to happen *before* the
-- org is known.
--
-- Rules, enforced by review and by the integration test in
-- apps/api/test/integration/rls.spec.ts:
--   1. Only the worker bootstrap and the API-key resolver may set it.
--   2. It is always SET LOCAL — it dies with the transaction.
--   3. No HTTP request handler may ever set it.
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION app_is_privileged() IS
  'Cross-tenant escape hatch for workers. SET LOCAL app.privileged = ''on'' only from worker bootstrap or the API-key resolver. Never from a request handler.';
