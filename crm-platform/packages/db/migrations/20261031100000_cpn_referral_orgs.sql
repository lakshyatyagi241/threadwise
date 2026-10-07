-- cpn: referrals learn which workspace each side belongs to; a referral code is one per user
-- Why this migration exists: WaDesk's wallet belongs to the referrer's USER, ours belongs to the workspace (organization). The
-- reward (WD-CPN-033) must credit the referrer's workspace wallet, and the referee's first paid order arrives as an event
-- carrying the REFEREE'S workspace, so both orgs have to live on the row next to the user ids. `referrals` is platform-only
-- (privileged writes, 0 rows in every environment so far), and users are keyed (org_id, id), hence the columns instead of
-- a lookup through `users` on every payout and every list. The backfill below makes the NOT NULL safe even on a database that
-- already holds rows. One code per user is what makes "ensure my code" idempotent (WD-CPN-029): the unique index turns a race
-- between the sign-up consumer and the first read into one row, not two.

ALTER TABLE referrals
  ADD COLUMN referrer_org_id bigint,
  ADD COLUMN referred_org_id bigint;

UPDATE referrals r
   SET referrer_org_id = (SELECT u.org_id FROM users u WHERE u.id = r.referrer_user_id),
       referred_org_id = (SELECT u.org_id FROM users u WHERE u.id = r.referred_user_id);
-- No DELETE of rows the backfill could not resolve: SET NOT NULL below fails loudly instead, which beats silently losing a payout.

ALTER TABLE referrals
  ALTER COLUMN referrer_org_id SET NOT NULL,
  ALTER COLUMN referred_org_id SET NOT NULL,
  ADD CONSTRAINT fk_referrals_referrer_org_id FOREIGN KEY (referrer_org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_referrals_referred_org_id FOREIGN KEY (referred_org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  ADD CONSTRAINT chk_referrals_not_self CHECK (referrer_user_id <> referred_user_id),
  ADD CONSTRAINT chk_referrals_credits_nonneg CHECK (credits_awarded >= 0);

-- The history list, the counters and the CSV all read "my referrals, newest first".
CREATE INDEX idx_referrals_referrer_history ON referrals (referrer_org_id, referrer_user_id, created_at DESC, id DESC);
-- The reward looks a referral up by the workspace that just paid.
CREATE INDEX idx_referrals_referred_org_unpaid ON referrals (referred_org_id) WHERE award_transaction_id IS NULL;

ALTER TABLE referral_codes
  ADD CONSTRAINT uq_referral_codes_owner_user UNIQUE (owner_org_id, user_id);
