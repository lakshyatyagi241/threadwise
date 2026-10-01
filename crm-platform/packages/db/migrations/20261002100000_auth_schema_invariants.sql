-- Brings the AUTH and PLAN tables in line with the schema invariants suite
-- (apps/api/test/integration/schema-invariants.spec.ts), which landed after the
-- first AUTH migrations were written.
--
-- 1. org_plan_state: the suite wants one policy that names the tenant function
--    in both USING and WITH CHECK. A tenant must still not write its own plan
--    state (it must not extend its own trial), so the standard tenant policy is
--    paired with RESTRICTIVE write policies that demand the privileged flag.
--    Restrictive policies are ANDed with the permissive one: reads stay
--    tenant-scoped, every write needs privilege.
--
-- 2. plans: "at most one default" was a unique index on the constant (true).
--    The same rule, stated on the real column, is `UNIQUE (is_default) WHERE
--    is_default`: two rows cannot both be true. Drizzle can mirror this one.
--
-- 3. security_events: the organization is the SUBJECT of an event, not its
--    tenant. Events outlive organizations (no FK), may have no organization at
--    all, and are written by transactions with no tenant context, so the table
--    is a platform-wide stream and not a tenant table. Naming the column
--    `org_id` made tooling treat it as one; `subject_org_id` says what it is.

-- 1 -------------------------------------------------------------------------
DROP POLICY tenant_read ON org_plan_state;
DROP POLICY platform_insert ON org_plan_state;
DROP POLICY platform_update ON org_plan_state;
DROP POLICY platform_delete ON org_plan_state;

CREATE POLICY tenant_isolation ON org_plan_state
  USING (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
CREATE POLICY platform_only_insert ON org_plan_state AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_is_privileged());
CREATE POLICY platform_only_update ON org_plan_state AS RESTRICTIVE FOR UPDATE
  USING (app_is_privileged()) WITH CHECK (app_is_privileged());
CREATE POLICY platform_only_delete ON org_plan_state AS RESTRICTIVE FOR DELETE
  USING (app_is_privileged());

-- 2 -------------------------------------------------------------------------
DROP INDEX uq_plans_single_default;
CREATE UNIQUE INDEX uq_plans_single_default ON plans (is_default) WHERE is_default;

-- 3 -------------------------------------------------------------------------
ALTER TABLE security_events RENAME COLUMN org_id TO subject_org_id;
