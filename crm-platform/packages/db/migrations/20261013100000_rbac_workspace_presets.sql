-- rbac: the five WaDesk workspace roles as per-organization presets, the keys behind them, and the rules that keep them honest.
-- Why this migration exists (WD-RBAC-004, 024, 026, 034, 037; decisions D-RBAC-05..08 in docs/wadesk-port/parity/roles-permissions.md):
-- WaDesk fixes five workspace roles (Owner, Admin, Manager, Agent, Viewer) and a role to permission matrix in code. Here every
-- organization gets five preset rows in `roles` whose `role_grants` reproduce that matrix, so the same machinery (guard, cache, merge
-- rules, record scopes) serves them and custom roles stay possible.
--
--   system_key 'admin'            -> displayed "Owner": locked, every key. The key keeps its old name because every domain migration
--                                    already grants its new keys to `system_key = 'admin'` and the account service already treats it as
--                                    "the organization's top role".
--   system_key 'workspace_admin'  -> "Admin": every key except the owner-only ones (billing, plan purchase, deleting the organization).
--   system_key 'manager' / 'agent' / 'viewer' -> the three lower presets.
--
-- Also here: new permission keys are granted to the top presets by a trigger (decision D4 of the port README: a new key no longer
-- depends on each domain remembering to unlock, grant and relock the Admin role), and the last Owner of an organization cannot be removed.

-- --- keys ---------------------------------------------------------------------------------------------------------------------------
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('inbox.conversation.note',       'Write and delete internal notes',                    'inbox', true),
  ('inbox.conversation.assign_self','Claim a conversation for yourself',                  'inbox', true),
  ('inbox.conversation.snooze',     'Snooze conversations',                               'inbox', true),
  ('inbox.conversation.bulk',       'Run bulk actions on conversations',                  'inbox', false),
  ('inbox.conversation.tag',        'Add and remove conversation labels',                 'inbox', true),
  ('inbox.conversation.priority',   'Change conversation priority',                       'inbox', true),
  ('inbox.settings.read',           'View inbox configuration (teams, routing, SLA)',     'inbox', false),
  ('inbox.team.manage',             'Create, edit and delete teams',                      'inbox', false),
  ('inbox.tag.manage',              'Create and delete workspace labels',                 'inbox', false),
  ('inbox.routing.manage',          'Manage routing rules and business hours',            'inbox', false),
  ('inbox.sla.manage',              'Manage SLA policies',                                'inbox', false),
  ('inbox.savedreply.manage',       'Manage saved replies',                               'inbox', false),
  ('inbox.integration.manage',      'Manage inbox webhooks, AI agents and AI keys',       'inbox', false),
  ('org.member.invite',             'Invite, remove and reset the password of members',   'admin', false),
  ('org.member.role_assign',        'Change a member''s workspace role',                  'admin', false),
  ('org.owner_settings.manage',     'Owner-only settings: branding, notifications, AI keys, data export and residency', 'admin', false),
  ('org.delete',                    'Delete the workspace',                               'admin', false),
  ('billing.manage',                'Manage billing, plan and payment methods',           'billing', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- --- owner-only keys ------------------------------------------------------------------------------------------------------------------
-- WD-RBAC-037: WaDesk documents "Owner has billing, Admin does not" but never enforced it. These are the keys the Admin preset never gets.
-- A later migration may CREATE OR REPLACE this function when a new owner-only key appears.
CREATE OR REPLACE FUNCTION rbac_is_owner_only(p_key text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
    SELECT p_key LIKE 'billing.%' OR p_key LIKE 'paygw.%' OR p_key IN ('org.delete', 'org.owner_settings.manage')
  $$;

-- --- the locked-role trigger gets one bypass --------------------------------------------------------------------------------------------
-- Preset provisioning and the auto-grant trigger below change the grants of the locked Owner preset. They set `app.rbac_preset_sync`
-- for the length of that statement block only; the application never does.
CREATE OR REPLACE FUNCTION protect_locked_role() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  locked boolean;
BEGIN
  IF coalesce(current_setting('app.rbac_preset_sync', true), 'off') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT r.is_locked INTO locked
  FROM roles r
  WHERE r.org_id = COALESCE(NEW.org_id, OLD.org_id)
    AND r.id     = COALESCE(NEW.role_id, OLD.role_id);

  IF locked THEN
    RAISE EXCEPTION 'role is locked: grants of a platform preset role cannot be modified'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- --- a new key reaches the top presets by itself ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION grant_new_permission_to_presets() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  prev_priv text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  PERFORM set_config('app.rbac_preset_sync', 'on', true);
  INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
    SELECT r.org_id, r.id, NEW.key, 'allow', 'all'
    FROM roles r
    WHERE r.system_key = 'admin' OR (r.system_key = 'workspace_admin' AND NOT rbac_is_owner_only(NEW.key))
  ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
  PERFORM set_config('app.rbac_preset_sync', 'off', true);
  PERFORM set_config('app.privileged', coalesce(prev_priv, 'off'), true);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_permission_defs_grant_presets AFTER INSERT ON permission_defs
  FOR EACH ROW EXECUTE FUNCTION grant_new_permission_to_presets();

-- --- the presets -------------------------------------------------------------------------------------------------------------------------
-- One function, used by this migration for every existing organization and by sign-up and the dev seed for a new one, so the matrix
-- lives in one place. Idempotent: it adopts a role that already has a preset's name (the sign-up Agent) and never overwrites grants.
-- Returns the Owner role's id.
CREATE OR REPLACE FUNCTION provision_workspace_presets(p_org bigint) RETURNS bigint
  LANGUAGE plpgsql AS $$
DECLARE
  prev_priv   text := current_setting('app.privileged', true);
  owner_id    bigint;
  admin_id    bigint;
  manager_id  bigint;
  agent_id    bigint;
  viewer_id   bigint;
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  PERFORM set_config('app.rbac_preset_sync', 'on', true);

  -- Owner: the existing top preset, renamed; a fresh organization gets it created.
  SELECT id INTO owner_id FROM roles WHERE org_id = p_org AND system_key = 'admin';
  IF owner_id IS NULL THEN
    INSERT INTO roles (org_id, name, system_key, is_locked) VALUES (p_org, 'Owner', 'admin', false) RETURNING id INTO owner_id;
  ELSE
    UPDATE roles SET name = 'Owner' WHERE org_id = p_org AND id = owner_id AND name <> 'Owner';
  END IF;

  INSERT INTO roles (org_id, name, system_key) VALUES (p_org, 'Admin', 'workspace_admin')
    ON CONFLICT (org_id, name) DO UPDATE SET system_key = coalesce(roles.system_key, 'workspace_admin');
  INSERT INTO roles (org_id, name, system_key) VALUES (p_org, 'Manager', 'manager')
    ON CONFLICT (org_id, name) DO UPDATE SET system_key = coalesce(roles.system_key, 'manager');
  INSERT INTO roles (org_id, name, system_key) VALUES (p_org, 'Agent', 'agent')
    ON CONFLICT (org_id, name) DO UPDATE SET system_key = coalesce(roles.system_key, 'agent');
  INSERT INTO roles (org_id, name, system_key) VALUES (p_org, 'Viewer', 'viewer')
    ON CONFLICT (org_id, name) DO UPDATE SET system_key = coalesce(roles.system_key, 'viewer');

  SELECT id INTO admin_id   FROM roles WHERE org_id = p_org AND system_key = 'workspace_admin';
  SELECT id INTO manager_id FROM roles WHERE org_id = p_org AND system_key = 'manager';
  SELECT id INTO agent_id   FROM roles WHERE org_id = p_org AND system_key = 'agent';
  SELECT id INTO viewer_id  FROM roles WHERE org_id = p_org AND system_key = 'viewer';

  -- Owner: every key. Admin: every key but the owner-only ones.
  INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
    SELECT p_org, owner_id, key, 'allow', 'all' FROM permission_defs
  ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
  INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
    SELECT p_org, admin_id, key, 'allow', 'all' FROM permission_defs WHERE NOT rbac_is_owner_only(key)
  ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

  -- Agent: the front-line grants the product shipped with (own scope on records) plus the WaDesk inbox rights. WaDesk deliberately gave
  -- Agents view_all_teams, so conversations are read and answered at scope `all`.
  INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
    SELECT p_org, agent_id, k.key, 'allow', k.scope::record_scope
    FROM (VALUES
      ('record.contacts.read', 'own'), ('record.contacts.create', 'all'), ('record.contacts.update', 'own'),
      ('inbox.conversation.read', 'all'), ('inbox.conversation.reply', 'all'),
      ('inbox.conversation.note', 'all'), ('inbox.conversation.assign_self', 'all'), ('inbox.conversation.resolve', 'all'),
      ('inbox.conversation.snooze', 'all'), ('inbox.conversation.tag', 'all'), ('inbox.settings.read', 'all'),
      ('record.deals.read', 'own'), ('record.deals.create', 'all'), ('record.deals.update', 'own'), ('record.pipelines.read', 'all'),
      ('record.tasks.read', 'own'), ('record.tasks.create', 'all'), ('record.tasks.update', 'own'), ('record.tasks.delete', 'own'),
      ('record.segments.read', 'all'), ('record.segments.create', 'all'), ('record.segments.update', 'own'), ('record.segments.delete', 'own'),
      ('record.sales-docs.read', 'own'), ('record.sales-docs.create', 'all'), ('record.sales-docs.update', 'own'), ('record.sales-docs.send', 'own'),
      ('record.invoices.read', 'own'), ('record.invoices.create', 'all'), ('record.invoices.update', 'own'),
      ('record.payments.read', 'own'), ('record.payments.create', 'own'), ('record.tax-rates.read', 'all'),
      ('record.booking-types.read', 'all'), ('record.appointments.read', 'own'), ('record.appointments.create', 'all'),
      ('record.appointments.update', 'own')
    ) AS k(key, scope)
    JOIN permission_defs d ON d.key = k.key
  ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

  -- Manager: everything an Agent does, at scope `all`, plus the manager-only inbox rights, contacts and companies in full, the dashboards,
  -- templates, labels and saved replies (WD-RBAC-004 and the manager-gated areas of WD-RBAC-025).
  INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
    SELECT p_org, manager_id, g.permission_key, 'allow', 'all'
    FROM role_grants g WHERE g.org_id = p_org AND g.role_id = agent_id AND g.effect = 'allow'
  ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
  INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
    SELECT p_org, manager_id, d.key, 'allow', 'all'
    FROM permission_defs d
    WHERE d.key IN (
      'inbox.conversation.assign', 'inbox.conversation.bulk', 'inbox.conversation.priority',
      'inbox.tag.manage', 'inbox.savedreply.manage', 'dash.dashboard.read', 'dash.analytics.read', 'broadcast.template.manage'
    ) OR d.key LIKE 'record.contacts.%' OR d.key LIKE 'record.companies.%'
  ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

  -- Viewer: reads the conversations of its own teams and nothing else (WaDesk: inbox.view_team and inbox.view_assigned).
  INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
    SELECT p_org, viewer_id, 'inbox.conversation.read', 'allow', 'team'
    WHERE EXISTS (SELECT 1 FROM permission_defs WHERE key = 'inbox.conversation.read')
  ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

  UPDATE roles SET is_locked = true WHERE org_id = p_org AND id = owner_id AND NOT is_locked;

  PERFORM set_config('app.rbac_preset_sync', 'off', true);
  PERFORM set_config('app.privileged', coalesce(prev_priv, 'off'), true);
  RETURN owner_id;
END $$;

-- Existing organizations. An Agent that sign-up created before this migration keeps its own-scope grants; only the inbox rights WaDesk
-- gives every Agent are moved to scope `all` (the inbox itself is not built yet, so nobody relies on the old value).
SELECT set_config('app.privileged', 'on', true);
SELECT provision_workspace_presets(id) FROM organizations;
SELECT set_config('app.rbac_preset_sync', 'on', true);
UPDATE role_grants g SET record_scope = 'all'
  FROM roles r
  WHERE r.org_id = g.org_id AND r.id = g.role_id AND r.system_key = 'agent'
    AND g.permission_key IN ('inbox.conversation.read', 'inbox.conversation.reply') AND g.record_scope <> 'all';
SELECT set_config('app.rbac_preset_sync', 'off', true);
UPDATE organizations SET roles_version = roles_version + 1;

-- --- the presets cannot be deleted, an organization always has an Owner ---------------------------------------------------------------
-- Deleting a preset would leave no rank to compare a role against. The cascade of an organization delete is allowed: by then the
-- organization row is already gone in the same statement, which the check reads.
CREATE OR REPLACE FUNCTION protect_preset_roles() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.system_key IS NOT NULL AND EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RAISE EXCEPTION 'a preset role cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_roles_protect_preset BEFORE DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION protect_preset_roles();

-- The last Owner of an organization cannot lose the role. Deferred to commit, so a role swap done in one transaction (remove, then
-- add another Owner) passes, and skipped when the organization itself is being deleted.
CREATE OR REPLACE FUNCTION ensure_organization_has_owner() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  owner_role bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN RETURN NULL; END IF;
  SELECT id INTO owner_role FROM roles WHERE org_id = OLD.org_id AND system_key = 'admin';
  IF owner_role IS NULL OR OLD.role_id <> owner_role THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE org_id = OLD.org_id AND role_id = owner_role) THEN
    RAISE EXCEPTION 'an organization must keep at least one Owner' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_user_roles_keep_owner AFTER DELETE ON user_roles
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ensure_organization_has_owner();
