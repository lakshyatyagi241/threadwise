-- company properties: who may read the definitions by default.
-- Why this migration exists (BL-034): the company form and the company page draw the workspace's company properties (Settings, Company
-- properties), and the API holds every write to them (a value must fit its property, a required one must be answered). A person can only
-- fill in what they can see, so the front-line presets need to read the DEFINITIONS (`record.company-properties.read`, seeded by 0018).
-- Defining, editing and deactivating properties stays with the Owner and Admin presets, which hold every key; a workspace widens or
-- narrows this in its role editor. Contact properties are not changed here.
--
-- `workspace_preset_baseline` is the place a domain declares a grant every organization's preset should hold (see 20261014090000): new
-- organizations get it at provisioning, existing ones below. Manager is listed on its own because it copied the Agent's grants once, at
-- provisioning, and does not follow them afterwards.

INSERT INTO workspace_preset_baseline (preset_key, permission_key, record_scope) VALUES
  ('agent',   'record.company-properties.read', 'all'),
  ('manager', 'record.company-properties.read', 'all')
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
