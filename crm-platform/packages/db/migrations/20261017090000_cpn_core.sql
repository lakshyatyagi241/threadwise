-- cpn: rules the Reference-shaped coupons / referrals / currencies tables need before code can sit on them.
-- Why: 20261001100500_cpn_threadwise_schema.sql is a literal translation. Three things in it cannot carry the feature as it is:
--   * coupons.applicable_package_ids is untyped JSON of Reference package ids; our plans and add-on packs are addressed by slug, so the
--     restriction becomes a real text[] the API validates against plans (and an empty list means "any plan", which the Reference edit
--     form could never express, TW-CPN-003);
--   * referrals / referral_codes name users by bare ids, with no org and no foreign key, so a referral could point at nobody and the
--     tenant cannot read its own rows through RLS. Users are (org_id, id) here, so both tables carry the org of each side and
--     composite foreign keys;
--   * nothing guarded the shape of a coupon, a currency or a code, so a malformed value would only surface in a checkout.
-- Seed data (the 30 currencies, the demo coupons) is NOT inserted here: other suites assume an empty currencies table, and the
-- installer seeds platform defaults (packages/db/src/seeds/coupons-credits-referral-currency.ts).

-- ============================================================ coupons
ALTER TABLE coupons DROP COLUMN applicable_package_ids;
ALTER TABLE coupons ADD COLUMN applicable_plan_slugs text[] NOT NULL DEFAULT '{}';

-- Stored upper-case and trimmed: the unique constraint on `code` is then case-insensitive without citext (TW-CPN-002 rule 1).
ALTER TABLE coupons
  ADD CONSTRAINT chk_coupons_code CHECK (code = upper(btrim(code)) AND char_length(code) BETWEEN 1 AND 64),
  ADD CONSTRAINT chk_coupons_type CHECK (type IN ('percent', 'fixed')),
  ADD CONSTRAINT chk_coupons_amount CHECK (amount >= 0),
  ADD CONSTRAINT chk_coupons_max_discount CHECK (max_discount_amount IS NULL OR max_discount_amount >= 0),
  ADD CONSTRAINT chk_coupons_min_order CHECK (min_order_amount IS NULL OR min_order_amount >= 0),
  ADD CONSTRAINT chk_coupons_max_uses CHECK (max_uses IS NULL OR max_uses >= 1),
  ADD CONSTRAINT chk_coupons_per_user CHECK (per_user_limit IS NULL OR per_user_limit >= 1),
  ADD CONSTRAINT chk_coupons_uses CHECK (uses_count >= 0),
  ADD CONSTRAINT chk_coupons_window CHECK (starts_at IS NULL OR expires_at IS NULL OR expires_at >= starts_at),
  ADD CONSTRAINT chk_coupons_description CHECK (description IS NULL OR char_length(description) <= 255),
  ADD CONSTRAINT chk_coupons_note CHECK (admin_note IS NULL OR char_length(admin_note) <= 1000);

-- A buyer's redemptions of one code: paid orders carrying its snapshot code (TW-CPN-006 rules 6 and 7). Keyed on the code, not the
-- coupon row, so deleting a coupon and re-creating the same code no longer resets everyone's history (TW-CPN-005 rule 1).
CREATE INDEX idx_orders_buyer_coupon_code ON orders (org_id, user_id, coupon_code)
  WHERE coupon_code IS NOT NULL AND status = 'paid';
CREATE INDEX idx_orders_buyer_paid ON orders (org_id, user_id) WHERE status = 'paid';

-- ============================================================ credit packages / currencies
ALTER TABLE credit_packages
  ADD CONSTRAINT chk_credit_packages_price CHECK (price_minor >= 0),
  ADD CONSTRAINT chk_credit_packages_credits CHECK (credits >= 1);

ALTER TABLE currencies
  ADD CONSTRAINT chk_currencies_code CHECK (code = upper(btrim(code)) AND char_length(code) BETWEEN 1 AND 10),
  ADD CONSTRAINT chk_currencies_precision CHECK ("precision" BETWEEN 0 AND 6),
  ADD CONSTRAINT chk_currencies_rate CHECK (exchange_rate >= 0.000001);

-- ============================================================ referral codes
-- One code per user; the code is the thing people share. Alphabet and length are Reference's (TW-CPN-029): ABCDEFGHJKMNPQRSTUVWXYZ23456789 x 10.
DELETE FROM referral_codes;  -- the table had no writer before this migration
-- The draft's foreign key to the organization was ON DELETE RESTRICT: deleting a workspace would have failed for as long as any
-- member had a code. A code belongs to its user, and goes with them.
ALTER TABLE referral_codes DROP CONSTRAINT fk_referral_codes_owner_org_id;
ALTER TABLE referral_codes
  ADD CONSTRAINT fk_referral_codes_owner_org_id FOREIGN KEY (owner_org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  ADD CONSTRAINT chk_referral_codes_code CHECK (code ~ '^[A-Z0-9]{4,16}$'),
  ADD CONSTRAINT uq_referral_codes_user UNIQUE (owner_org_id, user_id),
  ADD CONSTRAINT fk_referral_codes_user FOREIGN KEY (owner_org_id, user_id)
    REFERENCES users (org_id, id) ON DELETE CASCADE;

-- Everyone who already exists gets a code (Reference's migration did not backfill; its mobile endpoint generated one lazily).
DO $$
DECLARE
  u RECORD;
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  bytes bytea;
  i int;
BEGIN
  FOR u IN SELECT org_id, id FROM users LOOP
    LOOP
      bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
      candidate := '';
      FOR i IN 0..9 LOOP
        candidate := candidate || substr(alphabet, 1 + (get_byte(bytes, i) % length(alphabet)), 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM referral_codes WHERE code = candidate);
    END LOOP;
    INSERT INTO referral_codes (owner_org_id, user_id, code) VALUES (u.org_id, u.id, candidate);
  END LOOP;
END $$;

-- A tenant reads its own user's code; every write is the platform's (privileged).
CREATE POLICY tenant_read ON referral_codes FOR SELECT USING (owner_org_id = current_org_id());

-- ============================================================ referrals
-- Attribution: one row per referred user (unique), who referred them, and the payout state (TW-CPN-032, 033).
DELETE FROM referrals;  -- no writer existed before this migration
ALTER TABLE referrals
  ADD COLUMN referrer_org_id bigint NOT NULL,
  ADD COLUMN referred_org_id bigint NOT NULL,
  ALTER COLUMN credits_awarded TYPE bigint,
  ADD CONSTRAINT chk_referrals_awarded CHECK (credits_awarded >= 0),
  ADD CONSTRAINT chk_referrals_distinct CHECK (referrer_org_id <> referred_org_id OR referrer_user_id <> referred_user_id),
  ADD CONSTRAINT fk_referrals_referrer FOREIGN KEY (referrer_org_id, referrer_user_id)
    REFERENCES users (org_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_referrals_referred FOREIGN KEY (referred_org_id, referred_user_id)
    REFERENCES users (org_id, id) ON DELETE CASCADE;

-- The referee is unique by user id AND org, not by the bare id: user ids repeat across orgs.
ALTER TABLE referrals DROP CONSTRAINT uq_referrals_referred_user_id;
ALTER TABLE referrals ADD CONSTRAINT uq_referrals_referred UNIQUE (referred_org_id, referred_user_id);
DROP INDEX idx_referrals_referrer_user_id;
CREATE INDEX idx_referrals_referrer ON referrals (referrer_org_id, referrer_user_id, created_at DESC);

-- The referrer reads their own rows (the affiliate pages); the referee's row is theirs to see only as the attribution itself.
CREATE POLICY tenant_read ON referrals FOR SELECT USING (referrer_org_id = current_org_id());
