-- 2033_webbot_wallet_billing
-- Why this migration exists (not what it does, the SQL says that):
--
-- The owner's pricing model (2026-10-25) has three parts the wallet did not carry:
--   1. WhatsApp is Meta's cost plus a margin that shrinks as the plan goes up: free 40%, basic 30%, mid 20%, top 10%.
--      `plan_message_margins` already holds a margin per plan; only the platform default (20% for everyone) was seeded.
--   2. The website chatbot ("webbot") gives a plan a monthly number of free messages (10,000 / 20,000 / 50,000 by plan) and charges
--      the wallet beyond it. Needs a counter next to the WhatsApp one (`wallet_usage_months.webbot_messages`, bumped under the wallet row
--      lock like `messages`), a new charge kind, and the allowance on each plan (`plans.limits.webbot_messages`).
--   3. AI and translation are the vendor's cost plus 20% (was 10%), and an email costs 0.15 (was 0.10).
--
-- The margins and allowances are seeded by the plan's place on the price ladder, because the operator names plans freely (the slugs are
-- not known here): the free plan is the bottom, the dearest plan (a custom-quote plan counts as dearest) is the top, the cheapest paid
-- plan under the top is the second rung, anything else sits in the middle. Every insert is "only if nothing is set", so an operator's own
-- numbers are never overwritten, and each number stays editable on the plan editor and the margins page.

-- 1. The webbot counter. A constant default is a catalog-only change.
ALTER TABLE wallet_usage_months
  ADD COLUMN webbot_messages integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT chk_wallet_usage_months_webbot CHECK (webbot_messages >= 0);

-- 2. The new charge kind. NOT VALID: every old row already satisfies the longer list, so the table is not re-scanned.
ALTER TABLE usage_charges DROP CONSTRAINT chk_usage_charges_kind;
ALTER TABLE usage_charges ADD CONSTRAINT chk_usage_charges_kind CHECK (
  kind IN ('whatsapp_message', 'sms', 'email', 'whatsapp_call', 'voice_call', 'ai', 'translation', 'enrichment', 'chat_message',
           'webbot_message')) NOT VALID;

-- 3. Each plan's rung on the ladder.
CREATE TEMP TABLE tmp_plan_rungs ON COMMIT DROP AS
WITH paid AS (
  SELECT slug,
         row_number() OVER (ORDER BY is_custom_quote DESC, amount DESC, sort_order DESC, id DESC) AS from_top,
         row_number() OVER (ORDER BY is_custom_quote ASC, amount ASC, sort_order ASC, id ASC) AS from_bottom
  FROM plans
  WHERE kind = 'plan' AND NOT is_free
)
SELECT p.slug,
       CASE
         WHEN p.is_free THEN 'free'
         WHEN paid.from_top = 1 THEN 'top'
         WHEN paid.from_bottom = 1 THEN 'second'
         ELSE 'middle'
       END AS rung
FROM plans p
LEFT JOIN paid ON paid.slug = p.slug
WHERE p.kind = 'plan';

-- 4. WhatsApp margin over Meta's cost: free 40%, second rung (basic) 30%, middle 20%, top 10%.
INSERT INTO plan_message_margins (plan_slug, country_code, category, margin_bps)
SELECT slug, '', '',
       CASE rung WHEN 'free' THEN 4000 WHEN 'second' THEN 3000 WHEN 'middle' THEN 2000 ELSE 1000 END
FROM tmp_plan_rungs
ON CONFLICT (plan_slug, country_code, category) DO NOTHING;

-- 5. Free webbot messages a month: bottom 10,000, middle 20,000, top 50,000. Only where the plan does not carry the key yet.
UPDATE plans p
SET limits = jsonb_set(
      p.limits, '{webbot_messages}',
      to_jsonb(CASE r.rung WHEN 'top' THEN 50000 WHEN 'free' THEN 10000 ELSE 20000 END), true)
FROM tmp_plan_rungs r
WHERE r.slug = p.slug AND NOT (p.limits ? 'webbot_messages');

-- 6. Prices an operator saved at the old defaults move to the new ones; a price the operator changed is left alone.
UPDATE platform_settings
SET value = jsonb_set(value, '{markupBps}', '2000'::jsonb, false)
WHERE key = 'wallet.usage_rates' AND value ->> 'markupBps' = '1000';

UPDATE platform_settings
SET value = jsonb_set(value, '{prices,email,priceMinor}', '15'::jsonb, false)
WHERE key = 'wallet.usage_rates' AND value #>> '{prices,email,priceMinor}' = '10';
