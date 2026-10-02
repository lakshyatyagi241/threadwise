-- wsp: workspace members and teams (TW-WSP-015..022, 046).
-- Why this migration exists: Reference's five workspace roles (owner, admin, manager, agent, viewer) and the member / team
-- permission matrix become data here. (1) Five capability keys gate the member and team screens. (2) Manager and Viewer
-- become system preset roles next to Admin and Agent, for every organization, created by one function so existing
-- organizations (this file) and new ones (tenant-directory provisioning, the dev seed) get identical grants. (3) Inviting by
-- single-use token needs a third user_tokens kind. (4) The organization owner is `organizations.settings.ownerUserId`; older
-- organizations created before sign-up recorded it get their earliest Admin as owner so the "only the owner grants Admin"
-- rule has someone to apply to.

-- 1. Capability keys. The Admin preset is locked (protect_locked_role), so existing organizations get the keys by unlocking,
-- granting and relocking, as the tchat migration does. New organizations get every key in permission_defs at provisioning.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('member.invite',        'Invite, remove and reset the password of workspace members', 'workspace', false),
  ('member.role.assign',   'Change a workspace member''s role',                           'workspace', false),
  ('team.manage',          'Create, edit and delete teams',                               'workspace', false),
  ('workspace.settings',   'Edit the workspace''s general settings',                      'workspace', false),
  ('workspace.export',     'Export the workspace''s data',                                'workspace', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES ('member.invite'), ('member.role.assign'), ('team.manage'), ('workspace.settings'), ('workspace.export')) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';

-- 2. Manager and Viewer presets. Idempotent per organization: a role already carrying the system key is left alone; an
-- organization that already made its own role called Manager or Viewer keeps that role and its grants (only the key is
-- set, so the rank model recognises it), because rewriting an admin's own role would be worse than a label.
-- Manager = the Agent preset widened to every record of the workspace (scope 'all') plus delete on the records an Agent can
-- use, the whole inbox and the dashboards. No member.*, team.manage or workspace.* key. Viewer = read-only everywhere.
CREATE OR REPLACE FUNCTION wsp_seed_role_presets(p_org bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_role bigint;
BEGIN
  SELECT id INTO v_role FROM roles WHERE org_id = p_org AND system_key = 'manager';
  IF v_role IS NULL THEN
    UPDATE roles SET system_key = 'manager'
      WHERE org_id = p_org AND name = 'Manager' AND system_key IS NULL
      RETURNING id INTO v_role;
    IF v_role IS NULL THEN
      INSERT INTO roles (org_id, name, system_key) VALUES (p_org, 'Manager', 'manager') RETURNING id INTO v_role;
      INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
        SELECT p_org, v_role, d.key, 'allow', 'all'
        FROM permission_defs d
        WHERE d.key = ANY (ARRAY[
          'record.contacts.read', 'record.contacts.create', 'record.contacts.update', 'record.contacts.delete',
          'record.deals.read', 'record.deals.create', 'record.deals.update', 'record.deals.delete',
          'record.pipelines.read',
          'record.tasks.read', 'record.tasks.create', 'record.tasks.update', 'record.tasks.delete',
          'record.segments.read', 'record.segments.create', 'record.segments.update', 'record.segments.delete',
          'record.sales-docs.read', 'record.sales-docs.create', 'record.sales-docs.update', 'record.sales-docs.delete',
          'record.sales-docs.send',
          'record.invoices.read', 'record.invoices.create', 'record.invoices.update', 'record.invoices.delete',
          'record.payments.read', 'record.payments.create',
          'record.tax-rates.read', 'record.booking-types.read',
          'record.appointments.read', 'record.appointments.create', 'record.appointments.update', 'record.appointments.delete',
          'record.tags.read', 'record.tags.create', 'record.tags.update', 'record.tags.delete',
          'inbox.conversation.read', 'inbox.conversation.reply', 'inbox.conversation.assign', 'inbox.conversation.resolve',
          'dash.dashboard.read', 'dash.analytics.read'
        ]);
    END IF;
  END IF;

  v_role := NULL;
  SELECT id INTO v_role FROM roles WHERE org_id = p_org AND system_key = 'readonly';
  IF v_role IS NULL THEN
    UPDATE roles SET system_key = 'readonly'
      WHERE org_id = p_org AND name = 'Viewer' AND system_key IS NULL
      RETURNING id INTO v_role;
    IF v_role IS NULL THEN
      INSERT INTO roles (org_id, name, system_key) VALUES (p_org, 'Viewer', 'readonly') RETURNING id INTO v_role;
      INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
        SELECT p_org, v_role, d.key, 'allow', 'all'
        FROM permission_defs d
        WHERE d.key LIKE 'record.%.read' OR d.key = 'inbox.conversation.read';
    END IF;
  END IF;
END
$$;

DO $$
DECLARE
  o record;
BEGIN
  FOR o IN SELECT id FROM organizations LOOP
    PERFORM wsp_seed_role_presets(o.id);
  END LOOP;
END
$$;

-- 3. The organization owner for organizations that predate ownerUserId: the earliest Admin.
UPDATE organizations o
SET settings = o.settings || jsonb_build_object('ownerUserId', x.uuid::text)
FROM (
  SELECT DISTINCT ON (u.org_id) u.org_id, u.uuid
  FROM users u
  JOIN user_roles ur ON ur.org_id = u.org_id AND ur.user_id = u.id
  JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
  WHERE r.system_key = 'admin'
  ORDER BY u.org_id, u.created_at, u.id
) x
WHERE o.id = x.org_id AND NOT (o.settings ? 'ownerUserId');

-- 4. A member invitation is a user_tokens row of kind 'invite' (token hash only, single use, expiry).
ALTER TABLE user_tokens DROP CONSTRAINT chk_user_tokens_kind;
ALTER TABLE user_tokens ADD CONSTRAINT chk_user_tokens_kind
  CHECK (kind IN ('email_verify', 'password_reset', 'email_change', 'invite'));

-- Roles changed for every organization: cached grant sets are stale.
UPDATE organizations SET roles_version = roles_version + 1;
