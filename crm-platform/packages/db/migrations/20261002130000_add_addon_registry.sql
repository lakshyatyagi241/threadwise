-- 20261002130000_add_addon_registry
-- Why this migration exists (TW-ADD-005/007/031/032): the add-on domain runs on three tables that already exist
-- (extensions, workspace_addons, plans) but their shape was only a mechanical translation of Reference. Three of those
-- translations are wrong for how the port works, and a fourth rule belongs in the database, not only in the service:
--
-- 1. workspace_addons.package_id pointed at the dormant Reference `packages` table. The live catalogue is `plans`
--    (kind = 'addon' is reserved for this domain, plan_core.sql), so the purchase row now references plans(id).
--    ON DELETE RESTRICT replaces Reference's "no foreign key at all": deleting a purchased add-on used to strip the
--    grants from every buyer while the orphan rows stayed (TW-ADD-030 QUIRK); here the database refuses it.
-- 2. workspace_addons let a tenant write its own rows (tenant_isolation FOR ALL). A workspace must not be able to
--    grant itself an add-on, exactly as it cannot extend its own trial (org_plan_state), so tenants read their rows
--    and only a privileged transaction (order fulfilment) writes them.
-- 3. One purchase is one row: a second finalisation of the same order must not stack a second grant (TW-ADD-032
--    rule 1). The unique index makes the replay a no-op the service can rely on.
-- 4. Value rules Reference left to the PHP layer: extension slug shape (it is also a folder name, TW-ADD-004 rule 3),
--    status vocabulary, add-on rows are never the signup default and never "custom quote".

-- extensions ------------------------------------------------------------------------------------------------------
ALTER TABLE extensions
  ADD CONSTRAINT chk_extensions_slug CHECK (slug ~ '^[a-z0-9_-]{1,64}$'),
  ADD CONSTRAINT chk_extensions_status CHECK (status IN ('active', 'disabled')),
  ADD CONSTRAINT chk_extensions_files CHECK (files IS NULL OR jsonb_typeof(files) = 'array'),
  ADD CONSTRAINT chk_extensions_manifest CHECK (manifest IS NULL OR jsonb_typeof(manifest) = 'object');

-- workspace_addons ------------------------------------------------------------------------------------------------
ALTER TABLE workspace_addons DROP CONSTRAINT fk_workspace_addons_package_id;
ALTER TABLE workspace_addons
  ADD CONSTRAINT fk_workspace_addons_package_id FOREIGN KEY (package_id) REFERENCES plans (id) ON DELETE RESTRICT,
  ADD CONSTRAINT chk_workspace_addons_status CHECK (status IN ('active', 'cancelled', 'expired')),
  ADD CONSTRAINT chk_workspace_addons_period CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at);

CREATE UNIQUE INDEX uq_workspace_addons_order ON workspace_addons (org_id, order_id, package_id)
  WHERE order_id IS NOT NULL;

DROP POLICY tenant_isolation ON workspace_addons;
CREATE POLICY tenant_read ON workspace_addons FOR SELECT
  USING (org_id = current_org_id() OR app_is_privileged());
CREATE POLICY platform_insert ON workspace_addons FOR INSERT WITH CHECK (app_is_privileged());
CREATE POLICY platform_update ON workspace_addons FOR UPDATE
  USING (app_is_privileged()) WITH CHECK (app_is_privileged());
CREATE POLICY platform_delete ON workspace_addons FOR DELETE USING (app_is_privileged());

-- plans (add-on rows) ---------------------------------------------------------------------------------------------
ALTER TABLE plans
  ADD CONSTRAINT chk_plans_addon_shape CHECK (kind = 'plan' OR (NOT is_default AND NOT is_custom_quote));
