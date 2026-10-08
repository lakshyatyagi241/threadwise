-- 20261108090000_ext_sheets_addon
-- Google Sheets add-on (EXT). No new table: the member's personal key lives in the columns WaDesk's `users` carried and the auth schema
-- already ported to `user_settings` (sheets_key_hash / _suffix / _created_at / _last_used_at). The dashboard's integrations panel reads the
-- same columns, so they stay where they are. This migration adds two things around them.
--
--  1. The add-on authenticates with a bearer key and nothing else, so the tenant is only known AFTER the key is found. The existing index
--     is (org_id, hash), which cannot answer that. A unique partial index on the hash alone does, and makes a duplicate key impossible
--     (a key is 128 random bits, so a collision would be a bug, not luck). It holds only rows that have a key.
--  2. The `google-sheets` listing (seeded as a draft by 20261027090100) asked for contacts scopes only, but the add-on also writes the shop
--     and its products (WaDesk's behaviour), so its draft version also asks for the new `catalog.read` and `catalog.write` scopes. Only a
--     draft version is changed: a published version is immutable and an installation consented to it as it was.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_settings_sheets_key_hash
  ON user_settings (sheets_key_hash) WHERE sheets_key_hash IS NOT NULL;

SELECT set_config('app.privileged', 'on', true);

UPDATE marketplace_app_versions v
SET scopes = ARRAY['contacts.read', 'contacts.write', 'catalog.read', 'catalog.write']::text[],
    manifest = jsonb_set(v.manifest, '{scopes}',
      jsonb_build_array('contacts.read', 'contacts.write', 'catalog.read', 'catalog.write'))
FROM marketplace_apps a
WHERE a.id = v.app_id AND a.slug = 'google-sheets' AND v.status = 'draft';
