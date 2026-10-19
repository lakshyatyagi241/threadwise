-- Product release history: the blue-green releases of desk-api and desk-web (deploy/hostinger/ci-entry.sh) and the build-side steps that
-- lead to them (deploy/build-server/deploy-main.sh) write one row per attempt; the operator console reads it.
-- Platform data with no tenant, so no RLS (same as permission_defs). Only the deploy scripts write it, as the database owner; the
-- application roles can read it. A new table: expand-only, it does not touch the live slot.
CREATE TABLE IF NOT EXISTS platform_releases (
  attempt     text PRIMARY KEY CHECK (attempt ~ '^[0-9a-f-]{36}$'),
  tag         text NOT NULL CHECK (tag ~ '^[a-f0-9]{7,40}$'),
  state       text NOT NULL CHECK (state IN ('building', 'shipping', 'releasing', 'ok', 'failed', 'rolled_back')),
  step        text CHECK (step ~ '^[a-z_]{0,40}$'),
  error       text CHECK (char_length(error) <= 500),
  started_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_platform_releases_started ON platform_releases (started_at DESC);
GRANT SELECT ON platform_releases TO crm_app, crm_worker;
