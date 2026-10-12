-- Email (Gmail) is a Marketplace INTEGRATION, not a mini app (owner change request after 20261118100100_mkt_email_app.sql, which seeded it as a
-- mini app). It connects an outside service (Google mailboxes), so it is listed under the Integrations tab, category "Messaging and email",
-- and its Settings tile is in Settings > Integrations (docs/specs/menu-apps-and-integrations.md: connections are not in the sidebar).
-- Everything else is unchanged: first party, `paid_monthly` with the price decided by the operator per listing, not included in any plan,
-- granting the plan feature `email_channel`, scopes `email.read` and `email.write`, and the plan cap `email_mailboxes`.
--
-- Connector type: `client`. The Google sign-in and the mailbox sync are built into the Email screen itself, so the listing issues and
-- receives nothing in the Marketplace: installing it records the workspace's consent (like the Chrome extension listing), and the other
-- connector types are for the lead-portal recipes. A client is always publishable (ConnectorRegistry.isImplemented).
--
-- Idempotent and safe on any database:
--  1. The listing and its version are inserted as an integration when they do not exist (ON CONFLICT DO NOTHING / NOT EXISTS), so the
--     migration does not depend on the earlier one having run.
--  2. A listing seeded as a mini app is converted in place: kind, category, connector type, and the listing text only while it still
--     reads as the text that migration seeded (an operator's edits are never overwritten). Status, price, pricing model, purchasable and
--     the add-on pack are not touched. A second run matches nothing.
--  3. Every version of the listing gets the integration manifest (kind, category, connector, no surfaces) and, when it has none, the
--     client recipe, so a draft or an already published version stays valid for its new kind.

INSERT INTO marketplace_apps
  (slug, kind, category_id, name, tagline, status, first_party, featured, sort_order, connector_type, listing,
   pricing_model, trial_days, purchasable, grants_plan_features, grandfather_existing)
SELECT 'email', 'integration', c.id, 'Email (Gmail)',
       'Connect your Gmail or Google Workspace mailboxes and answer customer email from the team inbox.',
       'draft', true, false, 70, 'client',
       $l${"longDescription":"Connect one or more Gmail or Google Workspace mailboxes to your workspace with a Google sign-in popup, from Settings > Integrations. Every customer email becomes a conversation in the team inbox, grouped by Gmail thread and linked to the contact by email address, so your team can reply, assign, resolve and follow up without leaving the CRM. Replies go out from the connected mailbox in the same Gmail thread. Paid per month; the price is set by the platform.","highlights":["Connect several Google mailboxes, one inbox channel each","One conversation per Gmail thread, linked to the contact","Replies sent from your own mailbox, in the same thread","Disconnect any time: the conversations stay"]}$l$::jsonb,
       'paid_monthly', 0, true, ARRAY['email_channel'], false
FROM marketplace_categories c WHERE c.kind = 'integration' AND c.slug = 'messaging-and-email'
ON CONFLICT (slug) DO NOTHING;

-- A listing seeded as a mini app becomes an integration. The listing text is replaced only when it is still the seeded text.
UPDATE marketplace_apps a
SET kind = 'integration',
    category_id = c.id,
    connector_type = 'client',
    tagline = CASE
      WHEN a.tagline = 'Connect your Gmail or Google Workspace mailboxes and answer customer email from the team inbox.'
        THEN 'Connect your Gmail or Google Workspace mailboxes and answer customer email from the team inbox.'
      ELSE a.tagline END,
    listing = CASE
      WHEN a.listing->>'longDescription' LIKE 'Connect one or more Gmail or Google Workspace mailboxes with a sign-in popup.%'
        THEN $l${"longDescription":"Connect one or more Gmail or Google Workspace mailboxes to your workspace with a Google sign-in popup, from Settings > Integrations. Every customer email becomes a conversation in the team inbox, grouped by Gmail thread and linked to the contact by email address, so your team can reply, assign, resolve and follow up without leaving the CRM. Replies go out from the connected mailbox in the same Gmail thread. Paid per month; the price is set by the platform.","highlights":["Connect several Google mailboxes, one inbox channel each","One conversation per Gmail thread, linked to the contact","Replies sent from your own mailbox, in the same thread","Disconnect any time: the conversations stay"]}$l$::jsonb
      ELSE a.listing END
FROM marketplace_categories c
WHERE a.slug = 'email' AND a.kind = 'mini_app'
  AND c.kind = 'integration' AND c.slug = 'messaging-and-email';

INSERT INTO marketplace_app_versions (app_id, version, status, manifest, recipe, scopes, changelog)
SELECT a.id, '1.0.0', 'draft',
       $m${"manifestVersion":1,"id":"email","name":"Email (Gmail)","kind":"integration","category":"messaging-and-email","version":"1.0.0","description":"Gmail and Google Workspace mailboxes connected to the team inbox.","scopes":["email.read","email.write"],"surfaces":[],"pricing":{"model":"addon","note":"Priced by the platform operator."},"support":{},"connector":{"type":"client"}}$m$::jsonb,
       $r${"schemaVersion":1,"key":"email","name":"Email (Gmail)","category":"messaging-and-email","logo":null,"connector":{"type":"client","stores":[]},"authFields":[],"mapping":{"mode":"auto"},"setupInstructions":[{"title":"Subscribe","body":"Subscribe to Email from this page. The price is set by the platform and the subscription is billed monthly."},{"title":"Connect your mailboxes","body":"Open Settings, then Integrations, then Email, and choose Connect Gmail. Sign in with the Google account that owns the mailbox and allow reading and sending mail. Add more mailboxes the same way, up to the number your plan allows."}]}$r$::jsonb,
       ARRAY['email.read','email.write'], 'First version: Gmail mailboxes in the team inbox, with replies sent from the mailbox.'
FROM marketplace_apps a WHERE a.slug = 'email'
  AND NOT EXISTS (SELECT 1 FROM marketplace_app_versions v WHERE v.app_id = a.id);

-- Every version of the listing carries the integration manifest, and the client recipe when it has none.
UPDATE marketplace_app_versions v
SET manifest = (v.manifest - 'surfaces' - 'module')
               || '{"kind":"integration","category":"messaging-and-email","surfaces":[],"connector":{"type":"client"}}'::jsonb,
    recipe = COALESCE(v.recipe,
      $r${"schemaVersion":1,"key":"email","name":"Email (Gmail)","category":"messaging-and-email","logo":null,"connector":{"type":"client","stores":[]},"authFields":[],"mapping":{"mode":"auto"},"setupInstructions":[{"title":"Subscribe","body":"Subscribe to Email from this page. The price is set by the platform and the subscription is billed monthly."},{"title":"Connect your mailboxes","body":"Open Settings, then Integrations, then Email, and choose Connect Gmail. Sign in with the Google account that owns the mailbox and allow reading and sending mail. Add more mailboxes the same way, up to the number your plan allows."}]}$r$::jsonb)
FROM marketplace_apps a
WHERE v.app_id = a.id AND a.slug = 'email' AND a.kind = 'integration'
  AND (v.manifest->>'kind' IS DISTINCT FROM 'integration' OR v.recipe IS NULL);
