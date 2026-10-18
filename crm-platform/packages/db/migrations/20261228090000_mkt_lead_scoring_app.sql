-- AI lead scoring (and the growth pilot built on it) becomes a first-party Marketplace app that is GATED BY INSTALL, like Appointments, Forms
-- and Email (marketplace listings audit; docs/threadwise-port/wiring/marketplace.md, "Listings audit").
-- Why this migration exists: scoring contacts with an AI model (`/lead-scoring`, `/growth`, the score card on a contact) was open to every
-- workspace that opted in. It sends contact facts to an AI vendor and spends platform money, so the owner wants it sold as an add-on. A
-- workspace that already uses it must lose nothing, so the rollout is the Appointments recipe PLUS an immediate grandfather in this file.
--
--  1. The listing `lead-scoring` is seeded as a DRAFT: first-party mini app, `paid_monthly`, price NOT set (the operator prices it in the
--     console; publishing is refused with `price_not_set` until then), not included in any plan, granting the NEW plan feature `lead_scoring`
--     (default off in the registry) and marked "comp existing users". Re-seeding never overwrites an operator's edits (ON CONFLICT DO NOTHING).
--  2. Every plan row gets `lead_scoring: false` explicitly (only where the key is absent), so no plan includes it.
--  3. GRANDFATHER, in this same migration, so there is no window in which a workspace that uses scoring is locked out (the Appointments
--     recipe leaves one between the deploy and the operator's comp, because a comp needs the add-on that exists only once the listing is
--     priced): every workspace that has the AI lead scoring switch on, has any scoring run in its log, or has a growth pilot row gets
--     `overrides.features.lead_scoring = true` on its plan state. An override beats the plan (resolveFeature), is invisible to the workspace,
--     and the operator's "Comp existing users" action later finds the same workspaces (it counts overrides) and gives them a comped
--     subscription; the override can then be removed in the console. A workspace whose override for the key was already set by an operator
--     (true or false) is never touched, so re-running this file changes nothing.
--  4. The permission keys of the feature (`lsc.%`: scoring log, score a contact, switch, stage review; the growth pilot uses the same keys)
--     name the plan feature and the app, so the Roles editor of a workspace without the app shows them locked with the `app` badge
--     instead of offering them. Enforcement is unchanged: routes check the key with @RequirePermission AND now @RequirePlanFeature.

-- --- 1. the listing (draft) ---------------------------------------------------------------------------------------------------------------

INSERT INTO marketplace_apps
  (slug, kind, category_id, name, tagline, status, first_party, featured, sort_order, listing,
   pricing_model, trial_days, purchasable, grants_plan_features, grandfather_existing)
SELECT 'lead-scoring', 'mini_app', c.id, 'AI lead scoring',
       'Score every contact with AI, see why, and let your team start with the hottest leads.',
       'draft', true, false, 80,
       $l${"longDescription":"AI lead scoring gives each contact a score from 0 to 100 and the reasons behind it, so your team knows who to call first. It scores a contact when it is created or changed, or when you press Score with AI, and it never overwrites a score a person typed. A log shows every scoring run and what it cost.\n\nThe growth pilot, where your workspace has been added to it, builds on the same scores: hot leads, audiences and campaign replies worth acting on. Paid per month; the price is set by the platform.","highlights":["A score from 0 to 100 with the reasons, on every contact","Scores new and changed contacts automatically, or on demand","Never overwrites a score your team typed","A log of every run with its tokens and cost"],"dataProcessing":{"summary":"The AI model sees an anonymised summary of the contact (stage, source, tags, deal counts, engagement numbers). It never receives the name, email address, phone number or message text. Scoring is off until a workspace admin switches it on.","regions":[],"deletion":"The score and its reasons are stored on the contact and the log of runs for a limited time; uninstalling stops scoring and keeps the scores already written."}}$l$::jsonb,
       'paid_monthly', 0, true, ARRAY['lead_scoring'], true
FROM marketplace_categories c WHERE c.kind = 'mini_app' AND c.slug = 'sales-tools'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO marketplace_app_versions (app_id, version, status, manifest, scopes, changelog)
SELECT a.id, '1.0.0', 'draft',
       $m${"manifestVersion":1,"id":"lead-scoring","name":"AI lead scoring","kind":"mini_app","category":"sales-tools","version":"1.0.0","description":"Scores contacts with AI, shows the reasons and the cost of every run, and powers the growth pilot.","scopes":["contacts.read","contacts.write"],"surfaces":[{"type":"settings_page","key":"lead_scoring","label":"AI lead scoring"}],"pricing":{"model":"addon","note":"Priced by the platform operator."},"support":{}}$m$::jsonb,
       ARRAY['contacts.read','contacts.write'], 'First version: the existing AI lead scoring, sold as an app. Workspaces that already use it keep it.'
FROM marketplace_apps a WHERE a.slug = 'lead-scoring'
  AND NOT EXISTS (SELECT 1 FROM marketplace_app_versions v WHERE v.app_id = a.id);

-- --- 2. no plan includes it ---------------------------------------------------------------------------------------------------------------

UPDATE plans SET features = features || '{"lead_scoring": false}'::jsonb
WHERE kind = 'plan' AND NOT (features ? 'lead_scoring');

-- --- 3. grandfather: the workspaces that already use scoring keep it -------------------------------------------------------------------------

SELECT set_config('app.privileged', 'on', true);

WITH users_of_scoring AS (
  SELECT org_id FROM lead_scoring_settings WHERE enabled
  UNION
  SELECT org_id FROM lead_scoring_runs
  UNION
  SELECT org_id FROM growth_settings
)
INSERT INTO org_plan_state (org_id, overrides)
SELECT u.org_id, '{"features": {"lead_scoring": true}}'::jsonb
FROM users_of_scoring u
JOIN organizations o ON o.id = u.org_id
ON CONFLICT (org_id) DO UPDATE
  SET overrides = jsonb_set(
        org_plan_state.overrides,
        '{features}',
        COALESCE(org_plan_state.overrides -> 'features', '{}'::jsonb) || '{"lead_scoring": true}'::jsonb,
        true)
  WHERE NOT (COALESCE(org_plan_state.overrides -> 'features', '{}'::jsonb) ? 'lead_scoring');

-- --- 4. the permission keys follow the app ---------------------------------------------------------------------------------------------------

UPDATE permission_defs SET plan_feature = 'lead_scoring', app_slug = 'lead-scoring'
WHERE key LIKE 'lsc.%' AND (plan_feature IS DISTINCT FROM 'lead_scoring' OR app_slug IS DISTINCT FROM 'lead-scoring');
