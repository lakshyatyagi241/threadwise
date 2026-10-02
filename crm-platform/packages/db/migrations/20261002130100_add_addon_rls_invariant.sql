-- 20261002130100_add_addon_rls_invariant
-- 20261002130000 split workspace_addons into per-command policies, so no single policy named the tenant function in
-- both USING and WITH CHECK, which schema-invariants.spec.ts requires of every table with an org_id column.
-- Same behaviour, stated the way org_plan_state already does it (20261002100000): one tenant_isolation policy that
-- the suite recognises, plus RESTRICTIVE write policies that demand the privileged flag. Restrictive policies are
-- ANDed with the permissive one, so reads stay tenant-scoped and a workspace still cannot grant itself an add-on.
DROP POLICY tenant_read ON workspace_addons;
DROP POLICY platform_insert ON workspace_addons;
DROP POLICY platform_update ON workspace_addons;
DROP POLICY platform_delete ON workspace_addons;

CREATE POLICY tenant_isolation ON workspace_addons
  USING (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
CREATE POLICY platform_only_insert ON workspace_addons AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_is_privileged());
CREATE POLICY platform_only_update ON workspace_addons AS RESTRICTIVE FOR UPDATE
  USING (app_is_privileged()) WITH CHECK (app_is_privileged());
CREATE POLICY platform_only_delete ON workspace_addons AS RESTRICTIVE FOR DELETE
  USING (app_is_privileged());
