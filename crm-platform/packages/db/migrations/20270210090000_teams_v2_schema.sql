-- Teams v2 (BL-381, phase T1 of docs/specs/teams-unification.md): one team entity for chat and CRM, with a manager, an optional parent
-- team, a primary team per person and two capability switches.
--
-- Why this migration exists:
--   * a team had no manager and no hierarchy; `team_members.is_lead` was returned by the API and never edited or read;
--   * deactivating a member deleted their `team_members` rows, so reactivating them lost the teams (gap 4 of the spec).
--
-- What it adds
--   teams.parent_team_id          optional parent (same workspace, no cycles: enforced by a trigger, depth by the service)
--   teams.lead_user_id            the team's manager (the reporting line); a lead who is deactivated stays recorded, the API shows none
--   teams.receives_conversations  the team may be chosen as an inbox routing / assignment target (default true: nothing changes)
--   teams.receives_records        the team may be chosen as a contact / company / deal assignment pool (default true)
--   teams.is_scope_boundary       reserved for the `team_and_below` scope of phase T2 (default true; stored, not read yet)
--   team_members.role             'member' | 'lead' (replaces the unused is_lead)
--   team_members.is_primary       the person's main team for reporting; at most one per person (partial unique index)
--
-- Membership of a deactivated person is KEPT (decision D10) and invisible: the tenant policy of `team_members` now only shows rows whose
-- user is not inactive. Every scope query that joins `team_members` (contacts, companies, deals, tasks, invoices, appointments, forms,
-- call logs, the inbox visibility, routing) therefore ignores an inactive person on both sides of a peer join without a single
-- repository changing, and reactivating the user (users.status) brings the memberships back. The privileged role still sees every row.
--
-- Stored team columns nothing reads yet (business_hours, timezone, default_assignee_id, device_ids, assignment_strategy) are NOT
-- dropped: the Teams screen lists them as "not used yet" until phase T4 (spec decision D7).

-- `teams` and `team_members` are under FORCE ROW LEVEL SECURITY: the backfills below need the privileged flag.
SELECT set_config('app.privileged', 'on', true);

-- --- teams ---------------------------------------------------------------------------------------------------------------------------
ALTER TABLE teams
  ADD COLUMN parent_team_id         bigint,
  ADD COLUMN lead_user_id           bigint,
  ADD COLUMN receives_conversations boolean NOT NULL DEFAULT true,
  ADD COLUMN receives_records       boolean NOT NULL DEFAULT true,
  ADD COLUMN is_scope_boundary      boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT fk_teams_parent_team_id FOREIGN KEY (org_id, parent_team_id)
    REFERENCES teams (org_id, id) ON DELETE SET NULL (parent_team_id),
  ADD CONSTRAINT fk_teams_lead_user_id FOREIGN KEY (org_id, lead_user_id)
    REFERENCES users (org_id, id) ON DELETE SET NULL (lead_user_id),
  ADD CONSTRAINT chk_teams_parent_not_self CHECK (parent_team_id IS NULL OR parent_team_id <> id);
CREATE INDEX idx_teams_parent ON teams (org_id, parent_team_id) WHERE parent_team_id IS NOT NULL;
CREATE INDEX idx_teams_lead ON teams (org_id, lead_user_id) WHERE lead_user_id IS NOT NULL;

-- A team cannot become its own ancestor. The walk is bounded so a corrupt chain cannot loop the server.
CREATE OR REPLACE FUNCTION teams_guard_parent() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  cur  bigint := NEW.parent_team_id;
  hops integer := 0;
BEGIN
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'a team cannot be its own ancestor'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'chk_teams_parent_cycle';
    END IF;
    hops := hops + 1;
    IF hops > 50 THEN
      RAISE EXCEPTION 'team hierarchy is too deep'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'chk_teams_parent_depth';
    END IF;
    SELECT t.parent_team_id INTO cur FROM teams t WHERE t.org_id = NEW.org_id AND t.id = cur;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_teams_guard_parent BEFORE INSERT OR UPDATE OF parent_team_id ON teams
  FOR EACH ROW WHEN (NEW.parent_team_id IS NOT NULL) EXECUTE FUNCTION teams_guard_parent();

-- Deleting a team moves its children up to the deleted team's own parent (or to the top), so no branch is lost or orphaned.
CREATE OR REPLACE FUNCTION teams_reparent_children() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  UPDATE teams SET parent_team_id = OLD.parent_team_id
  WHERE org_id = OLD.org_id AND parent_team_id = OLD.id AND id <> OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_teams_reparent_children BEFORE DELETE ON teams
  FOR EACH ROW EXECUTE FUNCTION teams_reparent_children();

-- --- team_members --------------------------------------------------------------------------------------------------------------------
ALTER TABLE team_members
  ADD COLUMN role       text NOT NULL DEFAULT 'member',
  ADD COLUMN is_primary boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT chk_team_members_role CHECK (role IN ('member', 'lead'));

UPDATE team_members SET role = 'lead' WHERE is_lead;

-- A team that had exactly one flagged lead gets that person as its manager.
UPDATE teams t SET lead_user_id = one.user_id
FROM (
  SELECT org_id, team_id, min(user_id) AS user_id
  FROM team_members WHERE is_lead GROUP BY org_id, team_id HAVING count(*) = 1
) one
WHERE t.org_id = one.org_id AND t.id = one.team_id AND t.lead_user_id IS NULL;

ALTER TABLE team_members DROP COLUMN is_lead;

-- Primary team: a person on exactly one team has it as primary; a person on several has none until somebody chooses.
UPDATE team_members tm SET is_primary = true
FROM (
  SELECT org_id, user_id FROM team_members GROUP BY org_id, user_id HAVING count(*) = 1
) solo
WHERE tm.org_id = solo.org_id AND tm.user_id = solo.user_id;

CREATE UNIQUE INDEX uq_team_members_one_primary ON team_members (org_id, user_id) WHERE is_primary;
CREATE INDEX idx_team_members_team ON team_members (org_id, team_id);

-- --- membership of a deactivated person stays, and is invisible ---------------------------------------------------------------------
DROP POLICY tenant_isolation ON team_members;
CREATE POLICY tenant_isolation ON team_members FOR ALL
  USING (
    app_is_privileged()
    OR (org_id = current_org_id() AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.org_id = team_members.org_id AND u.id = team_members.user_id AND u.status <> 'inactive'))
  )
  WITH CHECK (
    app_is_privileged()
    OR (org_id = current_org_id() AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.org_id = team_members.org_id AND u.id = team_members.user_id AND u.status <> 'inactive'))
  );
COMMENT ON TABLE team_members IS
  'Team membership. Rows of an inactive user are kept (history, restored on reactivation) and hidden from tenant sessions by the tenant_isolation policy.';
