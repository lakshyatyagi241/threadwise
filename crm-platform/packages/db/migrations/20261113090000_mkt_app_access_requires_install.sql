-- Marketplace apps that grant plan features (Appointments, Forms) need the app INSTALLED, not only subscribed (owner decision 2026-10-08).
-- Why this migration exists: until now a workspace that subscribed to Forms (or was comped) got the menu entry, the screens, the API routes and
-- every Forms permission in the Roles editor straight away, while the Marketplace page still said "Installed (0)" with an Install button.
-- From now on the plan features an app grants are on only while the app is installed and running in the workspace; the entitlement
-- computation (apps/api/src/modules/plans-subscriptions-trials/app-grants.ts) holds that rule for every consumer, so this migration changes
-- DATA only, no table:
--
--  1. `permission_defs.app_slug` is set for the keys of the two apps. The Roles editor then shows them locked with the `app` badge ("install
--     the app") instead of the plan upgrade lock while the workspace is subscribed but has not installed the app. `plan_feature` stays: a
--     workspace whose PLAN carries the feature (no app involved) keeps the keys open without any installation.
--  2. Backfill, so a workspace that already uses the apps does not lose them silently: every workspace that holds a live subscription to the
--     app (the add-on that sells it is active, which is what granted the feature until now) and already HAS data created with the app
--     (booking types or appointments; web forms) and has no installation gets one, active, on the app's newest version, with the
--     permissions of that version and a consent row with no person behind it (a system backfill). A subscribed workspace with no data is left
--     alone: it installs the app from the Marketplace like any new customer. Re-running changes nothing.

UPDATE permission_defs SET app_slug = 'appointments'
WHERE plan_feature = 'appointment_booking' AND app_slug IS DISTINCT FROM 'appointments';

UPDATE permission_defs SET app_slug = 'forms'
WHERE plan_feature = 'form_builder' AND app_slug IS DISTINCT FROM 'forms';

SELECT set_config('app.privileged', 'on', true);

WITH holders AS (
  SELECT DISTINCT wa.org_id, a.id AS app_id, a.slug
  FROM workspace_addons wa
  JOIN plans ap ON ap.id = wa.package_id AND ap.marketplace_app_id IS NOT NULL
  JOIN marketplace_apps a ON a.id = ap.marketplace_app_id AND a.slug IN ('appointments', 'forms')
  WHERE wa.status = 'active' AND (wa.ends_at IS NULL OR wa.ends_at > now())
),
users_of_app AS (
  SELECT h.*
  FROM holders h
  WHERE (h.slug = 'appointments'
         AND (EXISTS (SELECT 1 FROM booking_types b WHERE b.org_id = h.org_id)
              OR EXISTS (SELECT 1 FROM appointments x WHERE x.org_id = h.org_id)))
     OR (h.slug = 'forms' AND EXISTS (SELECT 1 FROM web_forms f WHERE f.org_id = h.org_id))
),
newest AS (
  SELECT DISTINCT ON (v.app_id) v.app_id, v.id AS version_id, v.scopes
  FROM marketplace_app_versions v
  ORDER BY v.app_id, (v.status = 'published') DESC, v.id DESC
),
made AS (
  INSERT INTO workspace_app_installations (org_id, app_id, installed_version_id, status, granted_scopes)
  SELECT u.org_id, u.app_id, n.version_id, 'active', n.scopes
  FROM users_of_app u
  JOIN newest n ON n.app_id = u.app_id
  ON CONFLICT (org_id, app_id) DO NOTHING
  RETURNING org_id, id, app_id, installed_version_id, granted_scopes
)
INSERT INTO marketplace_consents (org_id, installation_id, app_id, version_id, action, scopes, previous_scopes)
SELECT org_id, id, app_id, installed_version_id, 'install', granted_scopes, '{}'::text[]
FROM made;
