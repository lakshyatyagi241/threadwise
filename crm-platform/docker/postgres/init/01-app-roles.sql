-- Runs once, on first container start, as the superuser.
--
-- Creates the NON-SUPERUSER login roles the application actually connects as.
-- This exists because a superuser bypasses Row-Level Security completely —
-- connecting the app as POSTGRES_USER would leave every policy in place and
-- every one of them inert.
--
-- Migrations keep running as the superuser (they need CREATE EXTENSION and
-- table ownership); the app and worker do not.
--
-- Development passwords only. Production provisions these roles separately,
-- with real credentials, and grants membership the same way:
--   CREATE ROLE crm_app_user LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE;
--   GRANT crm_app TO crm_app_user;   -- after migrations have created crm_app

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    CREATE ROLE crm_app_user LOGIN PASSWORD 'crm_app_dev'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_worker_user') THEN
    CREATE ROLE crm_worker_user LOGIN PASSWORD 'crm_worker_dev'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
