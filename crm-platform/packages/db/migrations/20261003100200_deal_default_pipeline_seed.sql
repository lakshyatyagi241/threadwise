-- deal: every workspace starts with the default pipeline "Sales Pipeline" and its six-stage ladder.
-- Why this migration exists (WD-DEAL-002): WaDesk created it lazily on the first GET of the board and ran a currency
-- "heal" on every later call. Here the pipeline exists from the moment the workspace does (a trigger on organizations), and
-- existing workspaces are backfilled once below, so reading never writes and there is no INR relabel (D-03).

CREATE FUNCTION seed_default_pipeline(p_org bigint, p_currency text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  prev text := current_setting('app.privileged', true);
  pid bigint;
BEGIN
  -- Runs for whichever role inserts the organization (the sign-up transaction is privileged, a seed script may not be), so
  -- it lifts RLS for its own few statements and puts the previous setting back.
  PERFORM set_config('app.privileged', 'on', true);
  SELECT id INTO pid FROM pipelines WHERE org_id = p_org ORDER BY is_default DESC, id LIMIT 1;
  IF pid IS NULL THEN
    INSERT INTO pipelines (org_id, name, is_default, currency, sort_order)
    VALUES (p_org, 'Sales Pipeline', true, p_currency, 0) RETURNING id INTO pid;
    INSERT INTO pipeline_stages (org_id, pipeline_id, name, sort_order, color, is_won, is_lost, probability) VALUES
      (p_org, pid, 'New Lead',    0, '#64748B', false, false, 10),
      (p_org, pid, 'Qualified',   1, '#0EA5E9', false, false, 25),
      (p_org, pid, 'Proposal',    2, '#6366F1', false, false, 50),
      (p_org, pid, 'Negotiation', 3, '#F59E0B', false, false, 75),
      (p_org, pid, 'Won',         4, '#16A34A', true,  false, 100),
      (p_org, pid, 'Lost',        5, '#DC2626', false, true,  0);
  END IF;
  PERFORM set_config('app.privileged', coalesce(prev, ''), true);
  RETURN pid;
END $$;

CREATE FUNCTION trg_organizations_seed_pipeline() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seed_default_pipeline(
    NEW.id,
    CASE WHEN upper(coalesce(NEW.settings ->> 'currency', '')) ~ '^[A-Z]{3}$'
         THEN upper(NEW.settings ->> 'currency') ELSE 'INR' END
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_organizations_seed_pipeline AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION trg_organizations_seed_pipeline();

SELECT set_config('app.privileged', 'on', true);
SELECT seed_default_pipeline(
         o.id,
         CASE WHEN upper(coalesce(o.settings ->> 'currency', '')) ~ '^[A-Z]{3}$'
              THEN upper(o.settings ->> 'currency') ELSE 'INR' END)
  FROM organizations o
 WHERE NOT EXISTS (SELECT 1 FROM pipelines p WHERE p.org_id = o.id);
