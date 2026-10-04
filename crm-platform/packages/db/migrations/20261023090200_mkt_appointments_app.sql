-- Appointments becomes the first PAID first-party Marketplace app (owner requirement of 2026-10-04; see docs/api/marketplace.md
-- "Apps that own existing plan features" and docs/wadesk-port/parity/product-extensions.md item 21).
-- Why this migration exists: booking types, appointments and the public booking pages were gated by the plan feature `appointment_booking`
-- that every plan granted by default (WaDesk's column default). The owner wants it sold as a monthly subscription from the Marketplace.
--
--  1. The listing `appointments` is seeded as a DRAFT: first-party mini app, `paid_monthly`, the price NOT set (the operator sets it in the
--     console; nothing is hard-coded and publishing is refused until it is set), not included in any plan, granting `appointment_booking`
--     and marked "comp existing users". Re-seeding never overwrites an operator's edits (ON CONFLICT DO NOTHING).
--  2. Every plan row gets `appointment_booking: false` explicitly (the registry default is false now), so no plan includes it. The
--     workspaces that already use booking are NOT touched here: a comp needs the add-on that sells the app, which exists only once the
--     operator has priced the listing, so they keep the feature through the operator's "Comp existing users" action (it finds every workspace
--     with booking types or appointments, and workspaces whose plan or override grants the feature, and comps them). Run it BEFORE publishing.
--     Until a workspace is comped or subscribes, a workspace on a catalogue plan has no booking, so schedule this deployment with that step
--     (docs/api/marketplace.md describes the order).

INSERT INTO marketplace_apps
  (slug, kind, category_id, name, tagline, status, first_party, featured, sort_order, listing,
   pricing_model, trial_days, purchasable, grants_plan_features, grandfather_existing)
SELECT 'appointments', 'mini_app', c.id, 'Appointments',
       'Booking types, appointments and your public booking pages.', 'draft', true, false, 50,
       $l${"longDescription":"Let customers book time with your team from a public page, manage booking types and availability, and keep every appointment on the contact. Paid per month; the price is set by the platform.","highlights":["Booking types and availability","Public booking pages","Reminders and the appointments calendar"]}$l$::jsonb,
       'paid_monthly', 0, true, ARRAY['appointment_booking'], true
FROM marketplace_categories c WHERE c.kind = 'mini_app' AND c.slug = 'booking-and-payments'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO marketplace_app_versions (app_id, version, status, manifest, scopes, changelog)
SELECT a.id, '1.0.0', 'draft',
       $m${"manifestVersion":1,"id":"appointments","name":"Appointments","kind":"mini_app","category":"booking-and-payments","version":"1.0.0","description":"Booking types, appointments and the public booking pages, with reminders and a calendar.","scopes":["appointments.read","appointments.write","contacts.read"],"surfaces":[{"type":"settings_page","key":"booking","label":"Booking"}],"pricing":{"model":"addon","note":"Priced by the platform operator."},"support":{}}$m$::jsonb,
       ARRAY['appointments.read','appointments.write','contacts.read'], 'First version: the existing booking feature, sold as an app.'
FROM marketplace_apps a WHERE a.slug = 'appointments'
  AND NOT EXISTS (SELECT 1 FROM marketplace_app_versions v WHERE v.app_id = a.id);

UPDATE plans SET features = features || '{"appointment_booking": false}'::jsonb WHERE kind = 'plan';
