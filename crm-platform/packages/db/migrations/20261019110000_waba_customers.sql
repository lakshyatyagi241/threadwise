-- waba: capability keys for the saved customer profiles (TW-WABA-055, 056).
-- Why this migration exists: Reference gated the shop's Customers page behind the workspace role `admin` (and the plan's storefront
-- path). The role gate becomes two keys a workspace can hand out; the presets hold them as Reference's roles did: Owner and Admin.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('waba.customers.read',   'View saved WhatsApp customers (name, company, delivery address)', 'whatsapp', false),
  ('waba.customers.manage', 'Save and remove saved WhatsApp customers',                        'whatsapp', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
CROSS JOIN (VALUES ('waba.customers.read'), ('waba.customers.manage')) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;

-- The Customers page orders by name then phone.
CREATE INDEX idx_wa_customer_profiles_name ON wa_customer_profiles (org_id, name, phone);
