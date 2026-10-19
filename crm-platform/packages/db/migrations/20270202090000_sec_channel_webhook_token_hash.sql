-- 20270202090000_sec_channel_webhook_token_hash
-- Encryption audit E3: the routing token in a Telegram, LINE, Viber or WeChat webhook URL sat in plaintext in `webhook_token`, and the public
-- route found the channel by comparing it. Now the token is also kept as a SHA-256 hash (the lookup key) and as a sealed copy (the URL is shown to
-- the workspace again), and the four lookup functions match the hash as well as the old plaintext column.
--
-- Expand step only, so a blue-green switch never meets a value the live slot cannot read:
--  * two nullable columns are added and `webhook_token` becomes nullable (the live slot still inserts it; nothing it does changes);
--  * each lookup function keeps its name, argument and result, and still matches the plaintext column, so the live slot's calls work unchanged;
--  * nothing is blanked here. After the release that writes the hash is the only one running, set SECRETS_LEGACY_PLAINTEXT_MIRROR=off, run
--    `seal-plaintext-secrets.cli.ts` (fills the hash and sealed copy of old rows) and then with `--scrub` (sets `webhook_token` to NULL).
-- A URL that a provider already holds keeps resolving: the hash of the token in the URL is what the function compares.
-- An empty argument matches nothing (a scrubbed row has a NULL plaintext column).

ALTER TABLE telegram_bots
  ADD COLUMN IF NOT EXISTS webhook_token_hash text,
  ADD COLUMN IF NOT EXISTS webhook_token_enc text,
  ALTER COLUMN webhook_token DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_bots_webhook_token_hash
  ON telegram_bots (webhook_token_hash) WHERE webhook_token_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION tg_bot_lookup(p_token text)
RETURNS TABLE (bot_org_id bigint, bot_row_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT b.org_id, b.id FROM telegram_bots b
    WHERE p_token <> ''
      AND (b.webhook_token = p_token
           OR b.webhook_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex'));
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

ALTER TABLE line_channels
  ADD COLUMN IF NOT EXISTS webhook_token_hash text,
  ADD COLUMN IF NOT EXISTS webhook_token_enc text,
  ALTER COLUMN webhook_token DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_line_channels_webhook_token_hash
  ON line_channels (webhook_token_hash) WHERE webhook_token_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION line_channel_lookup(p_token text)
RETURNS TABLE (channel_org_id bigint, channel_row_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT c.org_id, c.id FROM line_channels c
    WHERE p_token <> ''
      AND (c.webhook_token = p_token
           OR c.webhook_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex'));
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

ALTER TABLE viber_channels
  ADD COLUMN IF NOT EXISTS webhook_token_hash text,
  ADD COLUMN IF NOT EXISTS webhook_token_enc text,
  ALTER COLUMN webhook_token DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_viber_channels_webhook_token_hash
  ON viber_channels (webhook_token_hash) WHERE webhook_token_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION vib_channel_lookup(p_token text)
RETURNS TABLE (channel_org_id bigint, channel_row_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT c.org_id, c.id FROM viber_channels c
    WHERE p_token <> ''
      AND (c.webhook_token = p_token
           OR c.webhook_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex'));
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

ALTER TABLE wechat_channels
  ADD COLUMN IF NOT EXISTS webhook_token_hash text,
  ADD COLUMN IF NOT EXISTS webhook_token_enc text,
  ALTER COLUMN webhook_token DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wechat_channels_webhook_token_hash
  ON wechat_channels (webhook_token_hash) WHERE webhook_token_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION wech_channel_lookup(p_token text)
RETURNS TABLE (channel_org_id bigint, channel_row_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  RETURN QUERY
    SELECT c.org_id, c.id FROM wechat_channels c
    WHERE p_token <> ''
      AND (c.webhook_token = p_token
           OR c.webhook_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex'));
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
END;
$$;

-- A channel connected by the previous release (during a blue-green switch) inserts only the plaintext token: the trigger gives it its hash at
-- once, so it resolves by hash from the moment the new release is live, same as the orders and store tables.
CREATE OR REPLACE FUNCTION chan_fill_webhook_token_hash() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.webhook_token IS NOT NULL AND NEW.webhook_token <> ''
     AND (NEW.webhook_token_hash IS NULL
          OR (TG_OP = 'UPDATE' AND NEW.webhook_token IS DISTINCT FROM OLD.webhook_token
              AND NEW.webhook_token_hash IS NOT DISTINCT FROM OLD.webhook_token_hash)) THEN
    NEW.webhook_token_hash := encode(sha256(convert_to(NEW.webhook_token, 'UTF8')), 'hex');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_telegram_bots_webhook_token_hash ON telegram_bots;
CREATE TRIGGER trg_telegram_bots_webhook_token_hash BEFORE INSERT OR UPDATE ON telegram_bots
  FOR EACH ROW EXECUTE FUNCTION chan_fill_webhook_token_hash();
DROP TRIGGER IF EXISTS trg_line_channels_webhook_token_hash ON line_channels;
CREATE TRIGGER trg_line_channels_webhook_token_hash BEFORE INSERT OR UPDATE ON line_channels
  FOR EACH ROW EXECUTE FUNCTION chan_fill_webhook_token_hash();
DROP TRIGGER IF EXISTS trg_viber_channels_webhook_token_hash ON viber_channels;
CREATE TRIGGER trg_viber_channels_webhook_token_hash BEFORE INSERT OR UPDATE ON viber_channels
  FOR EACH ROW EXECUTE FUNCTION chan_fill_webhook_token_hash();
DROP TRIGGER IF EXISTS trg_wechat_channels_webhook_token_hash ON wechat_channels;
CREATE TRIGGER trg_wechat_channels_webhook_token_hash BEFORE INSERT OR UPDATE ON wechat_channels
  FOR EACH ROW EXECUTE FUNCTION chan_fill_webhook_token_hash();
