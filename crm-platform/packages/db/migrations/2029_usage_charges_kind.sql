-- 2029_usage_charges_kind
-- Why this migration exists (not what it does — the SQL says that):
--
-- The wallet billed only WhatsApp messages (plus AI lead scoring, which wrote a ledger line and no charge row). SMS, email, calls, AI,
-- translation and the other channels now draw on the wallet too, and the customer's expense log has to show each of them next to the
-- messages. A charge row therefore says what kind of usage it is for and how many units were billed (an SMS has segments, a call has
-- minutes, an AI call has one). Charges written before this migration are WhatsApp messages of one unit each, which the defaults say.
-- Constant defaults are a catalog-only change on a partitioned table: no partition is rewritten.

ALTER TABLE usage_charges
  ADD COLUMN kind text NOT NULL DEFAULT 'whatsapp_message',
  ADD COLUMN units integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT chk_usage_charges_kind CHECK (
    kind IN ('whatsapp_message', 'sms', 'email', 'whatsapp_call', 'voice_call', 'ai', 'translation', 'enrichment', 'chat_message')),
  ADD CONSTRAINT chk_usage_charges_units CHECK (units >= 0);
