-- deal: the default-pipeline seeding is reachable only as the trigger on organizations, not as a callable function.
-- Why this migration exists: 20261003100200 defined seed_default_pipeline(org, currency), which lifts row-level security for its own
-- few statements so it can run for whichever role inserts an organization. A function like that is callable by every role
-- that can reach the database, including a tenant's request, with any org id. A function that RETURNS trigger cannot be
-- called from SQL at all, so the logic moves into one and the callable function is dropped. 20261003100200 is applied and
-- immutable, so this fixes forward. The backfill for existing organizations already ran in that migration.

DROP TRIGGER trg_organizations_seed_pipeline ON organizations;
DROP FUNCTION trg_organizations_seed_pipeline();
DROP FUNCTION seed_default_pipeline(bigint, text);

CREATE FUNCTION trg_organizations_seed_pipeline() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prev text := current_setting('app.privileged', true);
  pid bigint;
  cur text := CASE WHEN upper(coalesce(NEW.settings ->> 'currency', '')) ~ '^[A-Z]{3}$'
                   THEN upper(NEW.settings ->> 'currency') ELSE 'INR' END;
BEGIN
  -- The organization's insert was already authorized by the caller; this lifts RLS only for the two statements that seed its
  -- own pipeline and puts the previous setting back.
  PERFORM set_config('app.privileged', 'on', true);
  INSERT INTO pipelines (org_id, name, is_default, currency, sort_order)
  VALUES (NEW.id, 'Sales Pipeline', true, cur, 0) RETURNING id INTO pid;
  INSERT INTO pipeline_stages (org_id, pipeline_id, name, sort_order, color, is_won, is_lost, probability) VALUES
    (NEW.id, pid, 'New Lead',    0, '#64748B', false, false, 10),
    (NEW.id, pid, 'Qualified',   1, '#0EA5E9', false, false, 25),
    (NEW.id, pid, 'Proposal',    2, '#6366F1', false, false, 50),
    (NEW.id, pid, 'Negotiation', 3, '#F59E0B', false, false, 75),
    (NEW.id, pid, 'Won',         4, '#16A34A', true,  false, 100),
    (NEW.id, pid, 'Lost',        5, '#DC2626', false, true,  0);
  PERFORM set_config('app.privileged', coalesce(prev, ''), true);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_organizations_seed_pipeline AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION trg_organizations_seed_pipeline();
