-- 20261006100000_add_extension_token_rules
-- WD-ADD-034. Two rules the port keeps in the database instead of trusting every caller:
--   1. A browser-extension token always expires. WaDesk had a nullable expires_at and its login never set it, so in
--      practice tokens lived forever; the column is now NOT NULL (the table is empty, nothing to backfill).
--   2. Deleting a user deletes their tokens (WaDesk: ON DELETE CASCADE). The first port made it SET NULL, which left
--      token rows that belong to nobody. With a composite (org_id, user_id) key CASCADE removes the child rows only,
--      and only inside the same organisation.
DELETE FROM extension_api_tokens WHERE expires_at IS NULL OR user_id IS NULL;
ALTER TABLE extension_api_tokens ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE extension_api_tokens DROP CONSTRAINT fk_extension_api_tokens_user_id;
ALTER TABLE extension_api_tokens
  ADD CONSTRAINT fk_extension_api_tokens_user_id FOREIGN KEY (org_id, user_id)
  REFERENCES users (org_id, id) ON DELETE CASCADE;
