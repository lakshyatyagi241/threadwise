-- "Smart routing" add-on (docs/specs/packaging-teams-and-smart-routing.md). An optional pack that turns on automatic assignment for a
-- workspace whose plan does not include it: `inbox_routing` (the auto-assignment master switch, routing rules, Everyone else, waiting-queue
-- timers, offline/leave return) and `inbox_assignment_sticky` (sticky agent, owner modes, continuity window). The entry plan stays minimal
-- (inbox, manual assign, Waiting queue and Claim, Human handoff to a named person or team, Return to bot, leave, availability); people
-- expand by buying this add-on, or the same two flags are switched on per plan.
--
-- Seeded exactly like 20270220090000_teams_permissions_addon.sql: a DRAFT, inactive (appears in no catalogue or checkout), NO price (free flag
-- set only because a priced add-on cannot be saved at 0; the operator unticks it when setting the price), features only (no limits).
-- Nothing about any workspace or plan changes. Idempotent. Expand-only: one insert, no existing row touched.
SELECT set_config('app.privileged', 'on', true);

INSERT INTO plans (slug, name, subtitle, detail, kind, amount, currency, billing_unit, billing_duration, is_free, is_active,
                   sort_order, cta_label, limits, features)
VALUES ('smart_routing', 'Smart routing', 'Automatic assignment, routing rules and sticky agents for the inbox',
        'Adds automatic assignment of new chats (routing rules, Everyone else, round robin and least busy per team), waiting-queue timers, the sticky agent and the contact owner modes. Draft: set the price and switch it on in the operator console.',
        'addon', 0, 'USD', 'months', 1, true, false, 910, 'Add to my plan',
        '{}'::jsonb,
        '{"inbox_routing": true, "inbox_assignment_sticky": true}'::jsonb)
ON CONFLICT (slug) DO NOTHING;
