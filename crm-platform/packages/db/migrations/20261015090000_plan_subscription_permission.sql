-- plan: the workspace-side capability key for changing the plan (WD-PLAN-011, 012, 016).
-- Why this migration exists: choosing, switching or downgrading a workspace's plan is a billing action, so it is gated by a key
-- rather than by "any signed-in member" (WaDesk's plans page let any user view it, and only buying and cancelling were role-checked).
-- Viewing the plans and the usage panel needs no key. The key is NOT owner-only (rbac_is_owner_only), so the
-- grant_new_permission_to_presets trigger gives it to both the Owner and the Admin preset of every existing organization;
-- Manager, Agent and Viewer do not get it.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('plan.subscription.manage', 'Change the workspace plan (switch, downgrade, cancel auto-renew)', 'billing', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

SELECT set_config('app.privileged', 'on', true);
UPDATE organizations SET roles_version = roles_version + 1;
