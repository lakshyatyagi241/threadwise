-- api: developer-rest-api-v1 data model, ported from WaDesk
-- Why this migration exists: the tables WaDesk's developer rest api v1 features read and write, translated to this
-- repo's tenancy shape (org_id first, composite FKs, forced RLS, hard delete, touch_row) so the port starts from a
-- complete schema instead of each feature inventing its own. Translation rules and every judgement call:
-- docs/wadesk-port/schema/README.md and docs/wadesk-port/schema/decisions.toml.
--
-- Tables: (none: overlay only)

-- --- additions to tables this repo already has ----------------------------------------
-- api_keys: WaDesk keys record when they were revoked and which user they act as. `status` already carries revoked/active;
-- revoked_at says when. user_id is optional because partner and service keys act as nobody.
ALTER TABLE api_keys
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN user_id    bigint,
  ADD CONSTRAINT fk_api_keys_user_id FOREIGN KEY (org_id, user_id)
    REFERENCES users (org_id, id) ON DELETE SET NULL (user_id);
