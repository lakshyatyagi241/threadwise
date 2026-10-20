-- "Teams and permissions" add-on (BL-383, docs/specs/teams-unification.md 5.6 and decision D4). An optional pack that lifts a workspace
-- from flat teams (or solo) to parent teams with lead/manager scope (`team_hierarchy`), custom roles with per-key scopes (`custom_roles`)
-- and more teams (`teams`: a NUMBER OF EXTRA teams on top of the plan's cap, -1 = unlimited).
--
-- Seeded as a DRAFT: inactive, so it appears in no catalogue or checkout, and with NO price (the owner sets the price; a priced add-on
-- cannot be free, so the operator unticks "free" and enters the amount when switching it on). Nothing about any workspace changes. Idempotent.
-- Expand-only: one insert, no existing row touched.
SELECT set_config('app.privileged', 'on', true);

INSERT INTO plans (slug, name, subtitle, detail, kind, amount, currency, billing_unit, billing_duration, is_free, is_active,
                   sort_order, cta_label, limits, features)
VALUES ('teams_permissions', 'Teams and permissions', 'Parent teams, managers, custom roles and more teams',
        'Adds parent teams with lead and manager scope, custom roles with per-key scopes, and 10 more teams. Draft: set the price and switch it on in the operator console.',
        'addon', 0, 'USD', 'months', 1, true, false, 900, 'Add to my plan',
        '{"teams": 10}'::jsonb,
        '{"team_hierarchy": true, "custom_roles": true}'::jsonb)
ON CONFLICT (slug) DO NOTHING;
