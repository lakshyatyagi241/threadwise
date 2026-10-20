-- inbox.conversation.read_unassigned (BL-382, phase T2 of docs/specs/teams-unification.md, decision D2).
--
-- Why this migration exists: a role that read conversations at scope `team` also saw every UNASSIGNED conversation (assigned to no person
-- and to no team). That rule made the shared inbox work, but it hid inside the word "team": the same word meant "my team's records" for
-- contacts, deals and tasks and "my team's records plus the unassigned queue" for conversations. The unassigned queue is now its own
-- permission, so a workspace can give an agent their team's conversations WITHOUT the open queue, and the Roles matrix says so.
--
-- What it does
--   1. registers the key (Owner and Admin receive it through the trigger on permission_defs);
--   2. gives it to every role that holds `inbox.conversation.read` as an allow at scope `team`: those roles saw the unassigned queue
--      before, and the resolver now asks for the permission, so NOBODY'S VISIBILITY CHANGES on the day this ships. Roles that read at `all`
--      do not need it (they see everything), roles that read at `own` never saw the queue and do not get it;
--   3. adds it to the Viewer preset's baseline, so a workspace created from now on has a Viewer that sees what Viewers always saw.
--
-- The key carries no scope of its own (`supports_scope` false): it is a switch that extends the `team` and `team_and_below` scopes of the
-- read permission. `own` and `all` ignore it.
--
-- Acting rights are unchanged: reply, note, assign, resolve and the other inbox actions are only asked about after the conversation is
-- known to be visible, and a team-scoped action grant still covers the unassigned queue (see viewerReadsUnassigned in the API).
--
-- An operator can list, before and after, which roles would see a different set: `pnpm --filter @crm/api report:unassigned-visibility`
-- (apps/api/src/modules/team-inbox-conversations/cli/unassigned-visibility-report.ts).

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('inbox.conversation.read_unassigned', 'See conversations that nobody has taken yet', 'inbox', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- A workspace created from now on: its Viewer reads its team's conversations and the open queue, as before.
INSERT INTO workspace_preset_baseline (preset_key, permission_key, record_scope)
VALUES ('viewer', 'inbox.conversation.read_unassigned', 'all')
ON CONFLICT (preset_key, permission_key) DO NOTHING;

-- `role_grants` and `organizations` are under FORCE ROW LEVEL SECURITY: the statements below need the privileged flag.
SELECT set_config('app.privileged', 'on', true);
-- The trigger that protects a locked role reads this flag; no locked role has a team-scoped read, but a future preset might.
SELECT set_config('app.rbac_preset_sync', 'on', true);

-- Every role, preset or custom, that read conversations at scope `team` keeps seeing the unassigned queue.
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
SELECT DISTINCT g.org_id, g.role_id, 'inbox.conversation.read_unassigned', 'allow'::perm_effect, 'all'::record_scope
FROM role_grants g
WHERE g.permission_key = 'inbox.conversation.read'
  AND g.effect = 'allow'
  AND g.record_scope = 'team'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

SELECT set_config('app.rbac_preset_sync', 'off', true);

UPDATE organizations SET roles_version = roles_version + 1;
