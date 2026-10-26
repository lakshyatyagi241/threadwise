-- Checks 20270327090100_repair_migrated_view_share_mode on a real database, the way the migrator runs it.
-- Run as a superuser on a scratch database only. Everything runs in one transaction that is rolled back.
--   psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/checks/repair_migrated_view_share_mode.check.sql
-- The role below is NOLOGIN and has no data of its own. Drop it when done: DROP ROLE repair_view_check;

-- Superusers bypass RLS, so the check runs as a role without BYPASSRLS, like the migration role in production.
DO $$ BEGIN
  CREATE ROLE repair_view_check NOLOGIN NOSUPERUSER NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

BEGIN;

INSERT INTO organizations (id, slug, name) VALUES (1, 'repair-check', 'repair-check') ON CONFLICT DO NOTHING;
INSERT INTO contact_views (org_id, uuid, name, filter, is_shared, share_mode) VALUES
  (1, gen_random_uuid(), 'loader-shared', '{}', true, 'me'),
  (1, gen_random_uuid(), 'private', '{}', false, 'me'),
  (1, gen_random_uuid(), 'already-shared', '{}', true, 'everyone');
GRANT SELECT, UPDATE ON contact_views TO repair_view_check;
SET LOCAL ROLE repair_view_check;

-- Without a tenant or the privileged setting, the row policy hides every row from this role.
DO $$ BEGIN
  IF (SELECT count(*) FROM contact_views) <> 0 THEN
    RAISE EXCEPTION 'check setup: rows visible without a tenant context';
  END IF;
END $$;

-- The migration itself. It sets app.privileged, so the rows become visible and the UPDATE applies.
\ir ../migrations/20270327090100_repair_migrated_view_share_mode.sql

-- Exactly one row changes: the loader-shared view. The private view and the already-shared view keep their share_mode.
DO $$ BEGIN
  IF (SELECT share_mode FROM contact_views WHERE name = 'loader-shared') IS DISTINCT FROM 'everyone' THEN
    RAISE EXCEPTION 'repair did not change loader-shared: row count 0, the RLS context is missing';
  END IF;
  IF (SELECT share_mode FROM contact_views WHERE name = 'private') IS DISTINCT FROM 'me' THEN
    RAISE EXCEPTION 'repair changed the private view';
  END IF;
  IF (SELECT share_mode FROM contact_views WHERE name = 'already-shared') IS DISTINCT FROM 'everyone' THEN
    RAISE EXCEPTION 'repair changed the already-shared view';
  END IF;
  RAISE NOTICE 'repair_migrated_view_share_mode: OK (1 row changed)';
END $$;

ROLLBACK;
