-- wap: a partner program on a registry provider.
-- Why this migration exists: Pinnacle is a BSP whose messaging API is Meta-shaped (the registry already covers it) but whose
-- onboarding is a partner flow: after Embedded Signup the platform creates a Pinnacle client account (which returns that client's own
-- apikey, the channel token for every send), sends the embedded details, then shares the Meta credit line. The registry needs to know
-- that a provider takes this flow and which Pinnacle solution it belongs to. `partner_solution_id` is public (it ships in the signup
-- flow); the partner key itself is the provider's sealed `providerToken`, never a column here.

ALTER TABLE whatsapp_providers
  ADD COLUMN partner_program text,
  ADD COLUMN partner_solution_id text,
  ADD CONSTRAINT chk_whatsapp_providers_partner_program CHECK (partner_program IS NULL OR partner_program IN ('pinnacle')),
  ADD CONSTRAINT chk_whatsapp_providers_partner_solution CHECK (
    (partner_program IS NULL AND partner_solution_id IS NULL) OR (partner_program IS NOT NULL AND partner_solution_id ~ '^[0-9]{5,32}$')
  );
