-- A person can pick their own time zone for how dates and times are shown to them. NULL = follow the workspace's time zone
-- (organizations.settings.timezone), and UTC when the workspace has none. user_profiles already has RLS forced with a tenant
-- policy and the touch trigger, so a nullable column needs nothing more.
ALTER TABLE user_profiles
  ADD COLUMN timezone text;
