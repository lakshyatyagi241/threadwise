-- plans: the highest plan ("scale") gets the features whose plan-registry default is OFF and that its row never listed.
--
-- A plan row only stores the feature keys it was seeded with; a key it does not list falls back to the registry default. Three keys
-- default to false (WaDesk's column defaults: chatbot_widgets, wa_storefront, inbox_sla) and were added after the starter plans were
-- seeded, so a workspace on the top plan was shown "not in your plan" for the WhatsApp catalog, the chatbot widget builder and SLA
-- policies. The top plan should hold every feature.
--
-- Only keys the row does not already carry are added (the existing value wins, so an operator's choice is never overwritten), and only
-- the plan with the slug 'scale'. Other plans are left to the operator's plan editor.
--
-- `plans` is platform-owned with forced row-level security, so the statement runs with the privileged flag, like the permission
-- migrations.

SELECT set_config('app.privileged', 'on', true);

UPDATE plans
SET features = jsonb_build_object('chatbot_widgets', true, 'wa_storefront', true, 'inbox_sla', true) || features,
    updated_at = now()
WHERE slug = 'scale'
  AND (NOT features ? 'chatbot_widgets' OR NOT features ? 'wa_storefront' OR NOT features ? 'inbox_sla');
