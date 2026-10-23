-- 2032_wa_templates_limited_offer
-- Why this migration exists (not what it does — the SQL says that):
--
-- A limited-time-offer template carries one extra part that no other template has: the offer's heading ("Expiring offer!", at most 16
-- characters) and whether the offer counts down to an expiry time. It is sent to Meta as the LIMITED_TIME_OFFER component. It is
-- one small object per template, read and written with the template, so it is one nullable jsonb column like carousel_data.

ALTER TABLE wa_templates ADD COLUMN limited_offer jsonb;
