-- owning_team_id on contacts, companies, deals and tasks (BL-382, phase T2 of docs/specs/teams-unification.md, decision D8).
--
-- Why this migration exists: a record has a PERSON owner and no team, so every "by team" report joined the owner to `team_members` and a
-- person on two teams was counted for both. The record now carries the team that owned it at the moment its owner was set: the owner's
-- PRIMARY team (`team_members.is_primary`, T1), or NULL when the owner has none. Reports, filters and the team picker in lists read it, and
-- a record is counted once. It is NOT an access rule: what a person may open is still decided by the owner and the role's scope.
--
-- What it adds
--   <table>.owning_team_id        nullable, composite FK (org_id, owning_team_id) -> teams (org_id, id), ON DELETE SET NULL (owning_team_id)
--   stamp_owning_team()           a BEFORE trigger on each table: sets the column when the row is inserted with an owner or when the owner
--                                 changes (single edit, bulk edit, the record assignment engine, owner-reassign batches, imports, the API,
--                                 flows, anything). One trigger instead of a change in every writer, and it also stamps rows written by the
--                                 release that is still running while the new one is being switched in.
--   owner_primary_team(org, user) the lookup, one index probe (uq_team_members_one_primary)
--
-- Owner columns: contacts.owner_id, companies.owner_id, deals.owner_user_id, tasks.assignee_id (a task's "owner" is its assignee).
--
-- Existing rows are NOT stamped here: a table-wide UPDATE would hold row locks on a large table for the length of the transaction and
-- move updated_at and row_version of every record. The worker job `owning-team-backfill` (apps/api/src/modules/workspaces-teams-tenancy)
-- stamps them in small batches after the release is live; the trigger keeps updated_at and row_version still for that job only
-- (session setting `app.owning_team_backfill`).
--
-- Expand-only (blue-green): `deals.owner_team_id`, an orphan column nothing reads or writes (no foreign key), stays untouched for the slot
-- that is still running. A later migration drops it (follow-up recorded in BL-382). The foreign keys are added NOT VALID (a brief lock) and
-- validated by the next migration (which does not block writes); the indexes are built CONCURRENTLY by the migrations after that.

-- --- the lookup ------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION owner_primary_team(p_org bigint, p_user bigint) RETURNS bigint
  LANGUAGE sql STABLE AS $$
  SELECT tm.team_id FROM team_members tm
  WHERE tm.org_id = p_org AND tm.user_id = p_user AND tm.is_primary
  LIMIT 1
$$;

-- --- the columns -----------------------------------------------------------------------------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN owning_team_id bigint,
  ADD CONSTRAINT fk_contacts_owning_team_id FOREIGN KEY (org_id, owning_team_id)
    REFERENCES teams (org_id, id) ON DELETE SET NULL (owning_team_id) NOT VALID;
ALTER TABLE companies
  ADD COLUMN owning_team_id bigint,
  ADD CONSTRAINT fk_companies_owning_team_id FOREIGN KEY (org_id, owning_team_id)
    REFERENCES teams (org_id, id) ON DELETE SET NULL (owning_team_id) NOT VALID;
ALTER TABLE deals
  ADD COLUMN owning_team_id bigint,
  ADD CONSTRAINT fk_deals_owning_team_id FOREIGN KEY (org_id, owning_team_id)
    REFERENCES teams (org_id, id) ON DELETE SET NULL (owning_team_id) NOT VALID;
ALTER TABLE tasks
  ADD COLUMN owning_team_id bigint,
  ADD CONSTRAINT fk_tasks_owning_team_id FOREIGN KEY (org_id, owning_team_id)
    REFERENCES teams (org_id, id) ON DELETE SET NULL (owning_team_id) NOT VALID;

COMMENT ON COLUMN contacts.owning_team_id IS
  'The owner''s primary team when the owner was set or last changed (NULL: no owner or no primary team). Reporting and filters only, never access. Stamped by trg_contacts_zz_owning_team.';
COMMENT ON COLUMN companies.owning_team_id IS
  'The owner''s primary team when the owner was set or last changed (NULL: no owner or no primary team). Reporting and filters only, never access. Stamped by trg_companies_zz_owning_team.';
COMMENT ON COLUMN deals.owning_team_id IS
  'The owner''s primary team when the owner was set or last changed (NULL: no owner or no primary team). Replaces the orphan deals.owner_team_id, which stays unused until a later migration drops it. Stamped by trg_deals_zz_owning_team.';
COMMENT ON COLUMN tasks.owning_team_id IS
  'The assignee''s primary team when the assignee was set or last changed (NULL: no assignee or no primary team). Reporting and filters only, never access. Stamped by trg_tasks_zz_owning_team.';

-- --- the stamp -------------------------------------------------------------------------------------------------------------------------
-- TG_ARGV[0] names the owner column. to_jsonb(NEW) keeps one function for the four tables whose owner columns are named differently; the
-- triggers fire only when the owner column or the stamp is in the SET list, so an ordinary update of a record never pays for it.
-- The trigger names start with `trg_<table>_zz_` so they run AFTER `trg_<table>_touch` (triggers fire in name order): that is how the
-- back-fill can undo the touch for its own updates.
CREATE OR REPLACE FUNCTION stamp_owning_team() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  owner_col text := TG_ARGV[0];
  new_owner bigint := nullif(to_jsonb(NEW) ->> owner_col, '')::bigint;
  old_owner bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.owning_team_id := CASE WHEN new_owner IS NULL THEN NULL ELSE owner_primary_team(NEW.org_id, new_owner) END;
    RETURN NEW;
  END IF;

  old_owner := nullif(to_jsonb(OLD) ->> owner_col, '')::bigint;
  IF new_owner IS DISTINCT FROM old_owner THEN
    -- The owner changed (or was cleared): the team follows the new owner.
    NEW.owning_team_id := CASE WHEN new_owner IS NULL THEN NULL ELSE owner_primary_team(NEW.org_id, new_owner) END;
  ELSIF NEW.owning_team_id IS DISTINCT FROM OLD.owning_team_id
        AND coalesce(current_setting('app.owning_team_backfill', true), 'off') = 'on' THEN
    -- The back-fill stamping an existing record: the record did not change, so neither do its version and its change time.
    NEW.updated_at := OLD.updated_at;
    NEW.row_version := OLD.row_version;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_contacts_zz_owning_team BEFORE INSERT OR UPDATE OF owner_id, owning_team_id ON contacts
  FOR EACH ROW EXECUTE FUNCTION stamp_owning_team('owner_id');
CREATE TRIGGER trg_companies_zz_owning_team BEFORE INSERT OR UPDATE OF owner_id, owning_team_id ON companies
  FOR EACH ROW EXECUTE FUNCTION stamp_owning_team('owner_id');
CREATE TRIGGER trg_deals_zz_owning_team BEFORE INSERT OR UPDATE OF owner_user_id, owning_team_id ON deals
  FOR EACH ROW EXECUTE FUNCTION stamp_owning_team('owner_user_id');
CREATE TRIGGER trg_tasks_zz_owning_team BEFORE INSERT OR UPDATE OF assignee_id, owning_team_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION stamp_owning_team('assignee_id');
