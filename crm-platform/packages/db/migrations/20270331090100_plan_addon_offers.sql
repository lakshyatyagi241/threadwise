-- plans: how each plan offers each plain add-on: Included, Paid (optionally at the plan's own price) or Hidden (docs/specs/addons-plan-offers.md).
-- Why this migration exists: the operator could not tell, per plan, whether an add-on is included, sold or not offered, and could not price or hide
-- one per plan. "Included" was only derivable from feature keys (Part A) and every paid plan saw every add-on at one price.
--
-- A join table, like plan_visible_addons, and not keys inside `plans.features`: the registry strips unknown keys from `features`, and a mode or a
-- price is not a flag. `addon_id` is a kind='addon' row WITHOUT a marketplace_app_id (mini apps keep plan_visible_addons and their listing's own
-- inclusion rules); a trigger holds that. Both sides cascade.
--
-- No row = Paid at the add-on's own price, which is today's behaviour, so a plan nobody edits is unchanged.
--
-- Platform catalogue conventions, the same as `plans`: no org_id, every transaction may READ (a workspace's add-on list and checkout ask), only the
-- privileged flag (operator console, seeds, this migration) may write.
--
-- BACKFILL: a row with mode 'included' for every plan whose features already grant EVERY feature of a feature add-on, so the editor shows what the
-- plans already do. A plan row that does not store a key reads the catalogue default (true only for team_hierarchy and custom_roles). Nothing else is
-- written and no plan's features change.

CREATE TABLE plan_addon_offers (
  plan_id     bigint NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  addon_id    bigint NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  mode        text NOT NULL,
  amount      numeric(12, 2),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, addon_id),
  CONSTRAINT chk_plan_addon_offers_distinct CHECK (plan_id <> addon_id),
  CONSTRAINT chk_plan_addon_offers_mode CHECK (mode IN ('included', 'paid', 'hidden')),
  -- A price only means something for a paid offer; a free paid offer is not a thing (use Included).
  CONSTRAINT chk_plan_addon_offers_amount CHECK (amount IS NULL OR (mode = 'paid' AND amount > 0))
);
-- "which plans offer this add-on, and how" (the add-on list's Plans column, the pack editor) walks the other side of the key.
CREATE INDEX idx_plan_addon_offers_addon ON plan_addon_offers (addon_id);

CREATE FUNCTION plan_addon_offers_check() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plans WHERE id = NEW.plan_id AND kind = 'plan') THEN
    RAISE EXCEPTION 'plan_addon_offers.plan_id must be a plan, not an add-on' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM plans WHERE id = NEW.addon_id AND kind = 'addon' AND marketplace_app_id IS NULL) THEN
    RAISE EXCEPTION 'plan_addon_offers.addon_id must be a plain add-on (no Marketplace app)' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_plan_addon_offers_check BEFORE INSERT OR UPDATE ON plan_addon_offers
  FOR EACH ROW EXECUTE FUNCTION plan_addon_offers_check();

ALTER TABLE plan_addon_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_addon_offers FORCE  ROW LEVEL SECURITY;
-- One policy per command so the read side can stay `true` without opening the write side.
CREATE POLICY catalogue_read ON plan_addon_offers FOR SELECT USING (true);
CREATE POLICY catalogue_insert ON plan_addon_offers FOR INSERT WITH CHECK (app_is_privileged());
CREATE POLICY catalogue_update ON plan_addon_offers FOR UPDATE
  USING (app_is_privileged()) WITH CHECK (app_is_privileged());
CREATE POLICY catalogue_delete ON plan_addon_offers FOR DELETE USING (app_is_privileged());
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_addon_offers TO crm_app, crm_worker;

-- --- backfill: Included where the plan already grants every feature of the add-on ---------------------------------------------------------

SELECT set_config('app.privileged', 'on', true);
INSERT INTO plan_addon_offers (plan_id, addon_id, mode)
SELECT p.id, ap.id, 'included'
FROM plans p
CROSS JOIN plans ap
WHERE p.kind = 'plan'
  AND ap.kind = 'addon' AND ap.marketplace_app_id IS NULL
  AND EXISTS (SELECT 1 FROM jsonb_each(coalesce(ap.features, '{}'::jsonb)) f WHERE f.value = 'true'::jsonb)
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(coalesce(ap.features, '{}'::jsonb)) f
    WHERE f.value = 'true'::jsonb
      AND NOT (
        coalesce(p.features -> f.key, 'null'::jsonb) = 'true'::jsonb
        OR (NOT coalesce(p.features, '{}'::jsonb) ? f.key AND f.key IN ('team_hierarchy', 'custom_roles'))
      )
  )
ON CONFLICT DO NOTHING;
