-- 20261211090000_add_user_profiles_phone_index
-- Why this migration exists (not what it does — the SQL says that):
--
-- TenantDirectory.identityExists() (signup-verification-redesign) looks up a phone number across
-- every org to block a second signup for an already-registered identity. With no index on
-- phone_e164, that query's OR branch forces a full LEFT JOIN scan of user_profiles joined to users,
-- run under privileged() (no RLS narrowing), on a public, unauthenticated endpoint — cost grows with
-- total user count. idx_users_email already covers the email side (see 20261001090000_auth_core.sql);
-- this gives the phone side the same shape. Partial (WHERE phone_e164 IS NOT NULL) because the column
-- is nullable and most rows may have no phone on file.

CREATE INDEX idx_user_profiles_phone_e164 ON user_profiles (phone_e164)
  WHERE phone_e164 IS NOT NULL;
