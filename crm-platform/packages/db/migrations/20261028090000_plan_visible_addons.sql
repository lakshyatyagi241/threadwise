-- plans: which Marketplace add-ons a plan makes visible to the workspaces on it.
-- Why this migration exists: until now every published Marketplace listing was visible to every workspace and a plan could hide nothing.
-- The owner wants the super admin to enable, per plan, the paid apps (billing add-ons, `plans` rows of kind 'addon' that carry a
-- `marketplace_app_id`) its workspaces may see and buy. This is OUR addition: WaDesk has no plan-gated add-on visibility
-- (docs/wadesk-port/parity/intended-differences.md).
--
-- It is deliberately a join table and not a key inside `plans.features`:
--   - `features` only holds the registry's flags; a key the registry does not know is stripped when a plan is saved, and a `mkt_` key in it
--     is read as a GRANT of the app (AddonEntitlementService), which would hand the app out instead of showing it.
--   - Visible is not usable. A workspace USES a paid app only once it has bought it (an active `workspace_addons` row on the pack, i.e. the
--     Marketplace subscription). Nothing here grants an entitlement; the Marketplace and checkout read it only to decide what to LIST.
--
-- `plan_id` is a kind='plan' row and `addon_plan_id` a kind='addon' row with a marketplace_app_id; a trigger holds that (a CHECK cannot look
-- at another row). Both cascade, so deleting a plan or an app's pack never leaves a dangling row.
--
-- Platform catalogue conventions, the same as `plans`: no org_id, every transaction may READ it (a workspace's own plan page and the
-- Marketplace list ask), only the privileged flag (operator console, seeds, this migration) may write it.
--
-- BACKFILL: so nothing disappears for an existing customer, every existing plan gets a row for EVERY published Marketplace add-on pack.
-- That is exactly today's behaviour (all published paid apps are visible to everyone). The operator then narrows it per plan. A pack
-- created after this migration is visible to no plan until a plan enables it.

CREATE TABLE plan_visible_addons (
  plan_id        bigint NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  addon_plan_id  bigint NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, addon_plan_id),
  CONSTRAINT chk_plan_visible_addons_distinct CHECK (plan_id <> addon_plan_id)
);
-- "which plans show this add-on" (the operator's selector, the pack's removal) walks the other side of the key.
CREATE INDEX idx_plan_visible_addons_addon ON plan_visible_addons (addon_plan_id);

CREATE FUNCTION plan_visible_addons_check() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plans WHERE id = NEW.plan_id AND kind = 'plan') THEN
    RAISE EXCEPTION 'plan_visible_addons.plan_id must be a plan, not an add-on' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM plans WHERE id = NEW.addon_plan_id AND kind = 'addon' AND marketplace_app_id IS NOT NULL) THEN
    RAISE EXCEPTION 'plan_visible_addons.addon_plan_id must be the add-on of a Marketplace app' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_plan_visible_addons_check BEFORE INSERT OR UPDATE ON plan_visible_addons
  FOR EACH ROW EXECUTE FUNCTION plan_visible_addons_check();

ALTER TABLE plan_visible_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_visible_addons FORCE  ROW LEVEL SECURITY;
-- One policy per command so the read side can stay `true` without opening the write side (FOR ALL with USING (true) would).
CREATE POLICY catalogue_read ON plan_visible_addons FOR SELECT USING (true);
CREATE POLICY catalogue_insert ON plan_visible_addons FOR INSERT WITH CHECK (app_is_privileged());
CREATE POLICY catalogue_update ON plan_visible_addons FOR UPDATE
  USING (app_is_privileged()) WITH CHECK (app_is_privileged());
CREATE POLICY catalogue_delete ON plan_visible_addons FOR DELETE USING (app_is_privileged());
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_visible_addons TO crm_app, crm_worker;

-- --- backfill: every existing plan shows every published Marketplace add-on (today's behaviour) ---------------------------------------

SELECT set_config('app.privileged', 'on', true);
INSERT INTO plan_visible_addons (plan_id, addon_plan_id)
SELECT p.id, ap.id
FROM plans p
CROSS JOIN plans ap
JOIN marketplace_apps a ON a.id = ap.marketplace_app_id AND a.status = 'published'
WHERE p.kind = 'plan' AND ap.kind = 'addon'
ON CONFLICT DO NOTHING;
