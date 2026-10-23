-- Add-ons: a stored kind for plain packs, and per-plan offers for Marketplace apps (mini apps and integrations), docs/specs/addons-plan-offers.md.
-- Why this migration exists:
--  1. A plain add-on is either a FEATURE add-on (unlocks a module, may also add capacity, like Teams +10) or a CAPACITY add-on (adds to a limit).
--     The kind was derived from what the pack grants, which breaks for a pack whose grants are empty (a draft, or one whose features were cleared):
--     it read as capacity and could not be included in a plan. The operator now chooses the kind; the column stores it. NULL (a pack written by
--     an older client or a test) falls back to the derived kind in code.
--  2. plan_addon_offers (Part D) took only plain add-ons. The operator wants the same Included / Paid / Hidden choice for mini apps and
--     integrations (add-ons with a marketplace_app_id). For an app, Paid and Hidden stay stored as today (plan_visible_addons: a row = visible);
--     only Included needs a row here, so the trigger now accepts an app's add-on, with no price (an app keeps its own price).
-- No plan's features, offers or visible apps change. Idempotent. Expand-only.
SELECT set_config('app.privileged', 'on', true);

ALTER TABLE plans ADD COLUMN IF NOT EXISTS addon_kind text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_plans_addon_kind') THEN
    ALTER TABLE plans ADD CONSTRAINT chk_plans_addon_kind CHECK (addon_kind IS NULL OR addon_kind IN ('feature', 'capacity'));
  END IF;
END $$;

-- Backfill: the two seeded feature packs are features even when their grants were cleared; any other plain pack is a capacity add-on only when
-- it adds limits and no feature, else a feature add-on (an empty pack is an unfinished feature add-on, not a capacity one).
UPDATE plans p SET addon_kind =
  CASE
    WHEN p.slug IN ('smart_routing', 'teams_permissions') THEN 'feature'
    WHEN NOT EXISTS (SELECT 1 FROM jsonb_each(coalesce(p.features, '{}'::jsonb)) f WHERE f.value = 'true'::jsonb)
         AND EXISTS (SELECT 1 FROM jsonb_each(coalesce(p.limits, '{}'::jsonb)) l WHERE jsonb_typeof(l.value) = 'number' AND l.value <> '0'::jsonb)
      THEN 'capacity'
    ELSE 'feature'
  END
WHERE p.kind = 'addon' AND p.marketplace_app_id IS NULL AND p.addon_kind IS NULL;

CREATE OR REPLACE FUNCTION plan_addon_offers_check() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  app_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plans WHERE id = NEW.plan_id AND kind = 'plan') THEN
    RAISE EXCEPTION 'plan_addon_offers.plan_id must be a plan, not an add-on' USING ERRCODE = '23514';
  END IF;
  SELECT marketplace_app_id INTO app_id FROM plans WHERE id = NEW.addon_id AND kind = 'addon';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_addon_offers.addon_id must be an add-on' USING ERRCODE = '23514';
  END IF;
  -- A Marketplace app keeps its own price: no plan price for it.
  IF app_id IS NOT NULL AND NEW.amount IS NOT NULL THEN
    RAISE EXCEPTION 'plan_addon_offers: an add-on of a Marketplace app has no plan price' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
