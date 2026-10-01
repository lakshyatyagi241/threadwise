-- api_keys: Reference keys record when they were revoked and which user they act as. `status` already carries revoked/active;
-- revoked_at says when. user_id is optional because partner and service keys act as nobody.
ALTER TABLE api_keys
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN user_id    bigint,
  ADD CONSTRAINT fk_api_keys_user_id FOREIGN KEY (org_id, user_id)
    REFERENCES users (org_id, id) ON DELETE SET NULL (user_id);
