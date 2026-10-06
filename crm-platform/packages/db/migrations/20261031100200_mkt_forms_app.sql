-- Forms becomes the second PAID first-party Marketplace app, after Appointments (docs/specs/forms-builder-app.md 12.1; backlog BL-093).
-- Why this migration exists: the Forms add-on is sold as a monthly subscription from the Marketplace; nothing in the workspace is visible
-- or reachable until it is owned. Same recipe as 20261023090200_mkt_appointments_app.sql, with one difference: Forms has no existing users,
-- so there is nothing to comp (`grandfather_existing = false`, no dry-run, no usage probe).
--
--  1. The listing `forms` is seeded as a DRAFT: first-party mini app, `paid_monthly`, price NOT set (the operator prices it in the console;
--     publishing is refused with `price_not_set` until then), not included in any plan, granting `form_builder`. Re-seeding never overwrites
--     an operator's edits (ON CONFLICT DO NOTHING).
--  2. Version 1.0.0 is a draft manifest. Scopes: the existing contact keys plus `forms.read` and `forms.write` (new, mapped onto the
--     `record.forms.*` and `record.form-submissions.*` keys in packages/contracts/src/marketplace/scopes.ts). A first-party app is checked
--     against the installer's own keys (MKT_SCOPE_EXCEEDS_INSTALLER).
--  3. Every plan row gets `form_builder: false` explicitly (the registry default is false), so no plan includes it.
--  4. Every plan row gets the add-on's default caps (decision D1): 10 forms, 500 submissions a month, 50 AI generations a month. They apply
--     only to a workspace that owns the app (without it the routes are locked), and are editable per plan and per workspace.

INSERT INTO marketplace_apps
  (slug, kind, category_id, name, tagline, status, first_party, featured, sort_order, listing,
   pricing_model, trial_days, purchasable, grants_plan_features, grandfather_existing)
SELECT 'forms', 'mini_app', c.id, 'Forms',
       'Build web forms, host or embed them, and land every submission in your CRM.',
       'draft', true, false, 60,
       $l${"longDescription":"Build a form in minutes from a template, style it with your colours, and share a link or embed it on your own site. Every submission becomes a contact (and a company) in your CRM with the right owner, tags and a notification, with spam protection built in. Paid per month; the price is set by the platform.","highlights":["Hosted page and embeddable form","Fields mapped to your contact and company properties","Owner assignment, tags and notifications","Spam protection, consent and data retention controls"]}$l$::jsonb,
       'paid_monthly', 0, true, ARRAY['form_builder'], false
FROM marketplace_categories c WHERE c.kind = 'mini_app' AND c.slug = 'sales-tools'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO marketplace_app_versions (app_id, version, status, manifest, scopes, changelog)
SELECT a.id, '1.0.0', 'draft',
       $m${"manifestVersion":1,"id":"forms","name":"Forms","kind":"mini_app","category":"sales-tools","version":"1.0.0","description":"Hosted and embedded web forms that create contacts and companies in your CRM.","scopes":["contacts.read","contacts.write","forms.read","forms.write"],"surfaces":[{"type":"settings_page","key":"forms","label":"Forms"}],"pricing":{"model":"addon","note":"Priced by the platform operator."},"support":{}}$m$::jsonb,
       ARRAY['contacts.read','contacts.write','forms.read','forms.write'], 'First version: web forms, hosted and embedded, with CRM mapping.'
FROM marketplace_apps a WHERE a.slug = 'forms'
  AND NOT EXISTS (SELECT 1 FROM marketplace_app_versions v WHERE v.app_id = a.id);

UPDATE plans SET features = features || '{"form_builder": false}'::jsonb WHERE kind = 'plan';

UPDATE plans
SET limits = limits || '{"forms": 10, "form_submissions_monthly": 500, "ai_form_generations_monthly": 50}'::jsonb
WHERE kind = 'plan';
