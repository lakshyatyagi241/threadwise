-- api: Reference-style bearer keys beside the signed partner keys.
-- Why this migration exists (TW-API-001, 005): `api_keys` was built for the signed partner scheme (`ApiKey <prefix>.<secret>` plus an HMAC
-- over the request, so every row carries an encrypted signing secret). Reference's customer API uses a plain bearer key (`wsk_` + 40 random
-- characters, sha256-hashed, no signature), minted by a workspace member in the Developers console. Both live in one table so the plan limit
-- `api_keys`, the active-key meter, `last_used_at` and revocation stay one thing; `kind` says which scheme authenticates the row.
--
-- A bearer key has no signing secret, so the column becomes nullable with a CHECK that keeps it required for signed keys.
-- `rate_limit_per_minute` of 0 means "no cap of its own": the plan and the platform ceiling decide (TW-API-006). The old default (120)
-- stays for signed keys, which is what partners were given.

ALTER TABLE api_keys
  ADD COLUMN kind text NOT NULL DEFAULT 'signed',
  ADD CONSTRAINT chk_api_keys_kind CHECK (kind IN ('signed', 'bearer')),
  ALTER COLUMN signing_secret_enc DROP NOT NULL,
  ADD CONSTRAINT chk_api_keys_signing_secret CHECK (kind = 'bearer' OR signing_secret_enc IS NOT NULL);

-- Console list: a workspace's keys newest first, filtered by kind.
CREATE INDEX idx_api_keys_org_kind_created ON api_keys (org_id, kind, created_at DESC, id DESC);
