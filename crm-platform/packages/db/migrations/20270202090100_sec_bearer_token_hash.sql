-- 20270202090100_sec_bearer_token_hash
-- Encryption audit E8: two bearer links were kept in plaintext and found by comparing them.
--   * orders.return_token       the opaque token in the return URL handed to a payment provider (platform checkout);
--   * wa_orders.recovery_token  the order-tracking token in a storefront link sent to the buyer.
-- Each gets a SHA-256 hash (what a lookup compares) and, where the link must be shown again (the tracking link on the admin order screen),
-- a sealed copy. The return URL is only ever built when the order is created, so it needs no sealed copy.
--
-- Expand step only (blue-green): columns are added, `orders.return_token` becomes nullable (its default stays, the live slot's INSERT still
-- relies on it), lookups keep matching the plaintext column too, and nothing is blanked here. A BEFORE INSERT trigger fills the hash for a
-- writer that still inserts only the plaintext (the live slot, seeds, tests), so such a row is found by hash the moment the next release is
-- live. After that release is the only one running: set SECRETS_LEGACY_PLAINTEXT_MIRROR=off, run `seal-plaintext-secrets.cli.ts`, then with
-- `--scrub` (sets the plaintext columns to NULL).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS return_token_hash text,
  ALTER COLUMN return_token DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_return_token_hash
  ON orders (return_token_hash) WHERE return_token_hash IS NOT NULL;

ALTER TABLE wa_orders
  ADD COLUMN IF NOT EXISTS recovery_token_hash text,
  ADD COLUMN IF NOT EXISTS recovery_token_enc text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_orders_recovery_token_hash
  ON wa_orders (org_id, recovery_token_hash) WHERE recovery_token_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION orders_fill_return_token_hash() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.return_token_hash IS NULL AND NEW.return_token IS NOT NULL AND NEW.return_token <> '' THEN
    NEW.return_token_hash := encode(sha256(convert_to(NEW.return_token, 'UTF8')), 'hex');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_orders_return_token_hash ON orders;
CREATE TRIGGER trg_orders_return_token_hash BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_fill_return_token_hash();

CREATE OR REPLACE FUNCTION wa_orders_fill_recovery_token_hash() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recovery_token_hash IS NULL AND NEW.recovery_token IS NOT NULL AND NEW.recovery_token <> '' THEN
    NEW.recovery_token_hash := encode(sha256(convert_to(NEW.recovery_token, 'UTF8')), 'hex');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_wa_orders_recovery_token_hash ON wa_orders;
CREATE TRIGGER trg_wa_orders_recovery_token_hash BEFORE INSERT ON wa_orders
  FOR EACH ROW EXECUTE FUNCTION wa_orders_fill_recovery_token_hash();
