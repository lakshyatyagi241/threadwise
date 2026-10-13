-- help_agent: the Help assistant costs AI tokens on every task, so it is a Growth and Scale feature, not a Starter one (owner
-- decision 2026-10-12). 20261119090000_help_agent turned it on for the three demo plans; Starter goes back to off. It is still a plan
-- feature the owner can switch per plan in the plan editor; this only changes the seeded default of the starter demo plan.
UPDATE plans SET features = features || '{"help_agent": false}'::jsonb
 WHERE kind = 'plan' AND slug = 'starter';
