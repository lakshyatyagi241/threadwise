-- Marketplace listings for built features that are optional tools and already gated by a plan feature that is OFF by default
-- (marketplace listings audit; docs/threadwise-port/wiring/marketplace.md, "Listings audit").
-- Why this migration exists: each of these features has its own screens and its own plan flag that Reference hands to chosen plans only, but
-- none could be offered from the Marketplace. Each gets a first-party listing that is GATED BY INSTALL like Appointments, Forms and Email:
-- a workspace that buys and installs the app gets the plan feature.
--
-- Nothing is lost for anybody, by construction: the plan features below are already off in the registry, so a workspace has one only
-- through its PLAN or an override, and "the app adds on top of the plan" (app-grants.ts): a plan that grants the feature, or an override,
-- keeps working with no purchase and no install. So, unlike Appointments, there is nothing to flip and nothing to comp: no plan row is
-- changed, no permission key changes visibility. `grandfather_existing` is still set so the operator's "Comp existing users" action can
-- give a comped subscription to the workspaces that hold the feature through their plan, should the plans ever drop it.
--
--   slug              kind         category (Marketplace)   grants plan feature
--   ai-crm-copilot    mini_app     sales-tools              ai_crm_copilot
--   chatbot-widget    mini_app     inbox-and-chat           chatbot_widgets
--   help-assistant    mini_app     utilities                help_agent
--   whatsapp-catalog  mini_app     booking-and-payments     wa_storefront
--   whatsapp-groups   mini_app     inbox-and-chat           waba_groups
--   sms               integration  messaging-and-email      sms          (connector `client`, like Email)
--
-- Every listing is a DRAFT, `paid_monthly` with the price NOT set (the operator prices it in the console; publishing is refused with
-- `price_not_set` until then), first party, not in any plan. Re-seeding never overwrites an operator's edits (ON CONFLICT DO NOTHING).
-- Operator hint: set `includedPlanFeature` on the listing to the same feature key so that a workspace whose plan already has the feature
-- is shown the app as included instead of being asked to pay for it.

-- --- the five mini apps ----------------------------------------------------------------------------------------------------------------------

WITH l (slug, category, name, tagline, sort_order, feature, scopes, description, long_desc, highlights, disclosure) AS (
  VALUES
    ('ai-crm-copilot', 'sales-tools', 'AI CRM Copilot',
     'Chat with an AI assistant that finds and creates contacts and deals, moves stages and runs sales reports.',
     90, 'ai_crm_copilot',
     ARRAY['contacts.read','contacts.write','deals.read','deals.write','tasks.read','tasks.write','messages.send','analytics.read']::text[],
     'A chat assistant that looks up and changes contacts, deals, tasks and invoices for you, and asks before it changes anything.',
     E'The AI CRM Copilot is a chat assistant that runs your CRM in plain language. Ask it to find a contact, create a deal, move a deal to another stage, write an invoice, chase what is outstanding, create a task or put together a proposal.\n\nAnything that changes data is described first and only done after you reply YES. Every action it takes, read or write, is recorded in a Recent actions panel. Paid per month; the price is set by the platform.',
     '["Plain-language lookups and changes across your CRM","Asks you to confirm before it changes anything","A trail of every action the AI took"]',
     'Your messages and the CRM data the assistant looks up for an answer are sent to the AI provider whose key your workspace or the platform uses. Nothing is sent until someone writes to the assistant.'),
    ('chatbot-widget', 'inbox-and-chat', 'Chat widget',
     'Put a floating chat bubble on your website; visitor chats land in your team inbox.',
     100, 'chatbot_widgets',
     ARRAY['contacts.read','contacts.write','conversations.read']::text[],
     'A floating chat bubble for your website, answered by a smart agent, by WhatsApp or both, with visitor chats in your team inbox.',
     E'A chat widget is a round bubble that floats on your website. Visitors open it to chat with a smart agent, to jump into WhatsApp, or to pick between the two. Conversations that need a person land in your team inbox.\n\nYou design the look and the opening line, choose which details visitors fill in first, and paste one snippet into your pages. Paid per month; the price is set by the platform.',
     '["Smart agent, WhatsApp deep-link, or both","Your colours, your opening line, a live preview","One snippet to embed it","Visitor chats arrive in the team inbox"]',
     'Visitors to your site type into the widget; those messages and any details they give are stored in your workspace as contacts and conversations. The page the widget is on sends them to this platform.'),
    ('help-assistant', 'utilities', 'Help assistant',
     'An in-app assistant that finds the right guide, shows where to click or does the steps for you.',
     110, 'help_agent',
     ARRAY[]::text[],
     'An in-app assistant that answers how-to questions and can click through a task on the person''s own session, asking before anything important.',
     E'The Help assistant answers "how do I..." questions and can do the clicking for you. It works inside the app with the account of the person using it, so it can do nothing that person could not, and it never leaves the app.\n\nIt is off until a workspace admin switches it on, and each step it takes uses AI tokens from your monthly allowance. Paid per month; the price is set by the platform.',
     '["Answers how-to questions from the guides","Can do the clicks for you, with your permissions","Off until an admin switches it on"]',
     'What the person asks and the screen content the assistant needs for the task are sent to the AI provider. It is off until a workspace admin turns it on.'),
    ('whatsapp-catalog', 'booking-and-payments', 'WhatsApp catalog and orders',
     'Sell on WhatsApp: your product catalog, the store orders it creates and the coupons for them.',
     120, 'wa_storefront',
     ARRAY['catalog.read','catalog.write']::text[],
     'A WhatsApp product catalog with the store orders and coupons that go with it.',
     E'Keep your products in one catalog, share them in WhatsApp and take the orders they create. The store area lists the orders and the coupons you offer on them.\n\nPaid per month; the price is set by the platform.',
     '["One product catalog for WhatsApp","Store orders in one place","Coupons for your orders"]',
     'Products, orders and coupons are stored in your workspace. Customers'' order details are kept with the order.'),
    ('whatsapp-groups', 'inbox-and-chat', 'WhatsApp groups',
     'Create and manage WhatsApp groups on your Cloud API number: invite links, join requests and members.',
     130, 'waba_groups',
     ARRAY['conversations.read','messages.send']::text[],
     'Create and manage groups on a WhatsApp Business (Cloud API) number: invite links, join requests, members and group messages.',
     E'Manage the groups of a connected WhatsApp Business number from your workspace: create a group, refresh its invite link, review join requests and message the group.\n\nIt works on a Cloud API number you have already connected. Paid per month; the price is set by the platform.',
     '["Create and manage groups from the CRM","Invite links and join requests","Group messages from your connected number"]',
     'Group names, members and messages are fetched from WhatsApp through your connected business number and stored in your workspace.')
)
INSERT INTO marketplace_apps
  (slug, kind, category_id, name, tagline, status, first_party, featured, sort_order, listing,
   pricing_model, trial_days, purchasable, grants_plan_features, grandfather_existing)
SELECT l.slug, 'mini_app', c.id, l.name, l.tagline, 'draft', true, false, l.sort_order,
       jsonb_build_object(
         'longDescription', l.long_desc,
         'highlights', l.highlights::jsonb,
         'dataProcessing', jsonb_build_object('summary', l.disclosure, 'regions', '[]'::jsonb,
                                              'deletion', 'Uninstalling the app stops it; the data it created stays in your workspace until you delete it.')),
       'paid_monthly', 0, true, ARRAY[l.feature]::text[], true
FROM l JOIN marketplace_categories c ON c.kind = 'mini_app' AND c.slug = l.category
ON CONFLICT (slug) DO NOTHING;

WITH l (slug, category, name, description, scopes) AS (
  VALUES
    ('ai-crm-copilot', 'sales-tools', 'AI CRM Copilot',
     'A chat assistant that looks up and changes contacts, deals, tasks and invoices for you, and asks before it changes anything.',
     ARRAY['contacts.read','contacts.write','deals.read','deals.write','tasks.read','tasks.write','messages.send','analytics.read']::text[]),
    ('chatbot-widget', 'inbox-and-chat', 'Chat widget',
     'A floating chat bubble for your website, answered by a smart agent, by WhatsApp or both, with visitor chats in your team inbox.',
     ARRAY['contacts.read','contacts.write','conversations.read']::text[]),
    ('help-assistant', 'utilities', 'Help assistant',
     'An in-app assistant that answers how-to questions and can click through a task on the person''s own session.',
     ARRAY[]::text[]),
    ('whatsapp-catalog', 'booking-and-payments', 'WhatsApp catalog and orders',
     'A WhatsApp product catalog with the store orders and coupons that go with it.',
     ARRAY['catalog.read','catalog.write']::text[]),
    ('whatsapp-groups', 'inbox-and-chat', 'WhatsApp groups',
     'Create and manage groups on a WhatsApp Business (Cloud API) number: invite links, join requests, members and group messages.',
     ARRAY['conversations.read','messages.send']::text[])
)
INSERT INTO marketplace_app_versions (app_id, version, status, manifest, scopes, changelog)
SELECT a.id, '1.0.0', 'draft',
       jsonb_build_object('manifestVersion', 1, 'id', l.slug, 'name', l.name, 'kind', 'mini_app', 'category', l.category,
         'version', '1.0.0', 'description', l.description, 'scopes', to_jsonb(l.scopes), 'surfaces', '[]'::jsonb,
         'pricing', jsonb_build_object('model', 'addon', 'note', 'Priced by the platform operator.'),
         'support', '{}'::jsonb),
       l.scopes, 'First version: the existing feature, sold as an app. Workspaces whose plan already has the feature keep it.'
FROM l JOIN marketplace_apps a ON a.slug = l.slug
WHERE NOT EXISTS (SELECT 1 FROM marketplace_app_versions v WHERE v.app_id = a.id);

-- --- SMS: an integration, like Email -----------------------------------------------------------------------------------------------------------

INSERT INTO marketplace_apps
  (slug, kind, category_id, name, tagline, status, first_party, featured, sort_order, connector_type, listing,
   pricing_model, trial_days, purchasable, grants_plan_features, grandfather_existing)
SELECT 'sms', 'integration', c.id, 'SMS (Twilio and MSG91)',
       'Send text messages from broadcasts and campaigns through your own Twilio number or MSG91 sender.',
       'draft', true, false, 140, 'client',
       $l${"longDescription":"Connect a Twilio number or an MSG91 sender (with the DLT details India requires) from Settings, then pick it as the sender of a broadcast or a campaign. The provider checks the credentials before anything is saved, and a delivery report address lets delivered and failed texts be recorded.\n\nSMS here is send only: replies are not received in the app. Paid per month; the price is set by the platform.","highlights":["Twilio for most countries, MSG91 with DLT for India","Several senders at once, switched on and off without losing credentials","Pick the sender on a broadcast or a campaign","Delivered and failed texts recorded from the delivery report"],"dataProcessing":{"summary":"The text of each message and the recipient's phone number are sent to your SMS provider (Twilio or MSG91) to deliver it. Your provider credentials are stored encrypted.","regions":[],"deletion":"Disconnecting a sender removes its credentials; the log of messages already sent stays in your workspace."}}$l$::jsonb,
       'paid_monthly', 0, true, ARRAY['sms'], true
FROM marketplace_categories c WHERE c.kind = 'integration' AND c.slug = 'messaging-and-email'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO marketplace_app_versions (app_id, version, status, manifest, recipe, scopes, changelog)
SELECT a.id, '1.0.0', 'draft',
       $m${"manifestVersion":1,"id":"sms","name":"SMS (Twilio and MSG91)","kind":"integration","category":"messaging-and-email","version":"1.0.0","description":"Twilio and MSG91 SMS senders for broadcasts and campaigns.","scopes":["messages.send"],"surfaces":[],"pricing":{"model":"addon","note":"Priced by the platform operator."},"support":{},"connector":{"type":"client"}}$m$::jsonb,
       $r${"schemaVersion":1,"key":"sms","name":"SMS (Twilio and MSG91)","category":"messaging-and-email","logo":null,"connector":{"type":"client","stores":[]},"authFields":[],"mapping":{"mode":"auto"},"setupInstructions":[{"title":"Subscribe","body":"Subscribe to SMS from this page. The price is set by the platform and the subscription is billed monthly."},{"title":"Connect a sender","body":"Open Settings, then SMS, and connect a Twilio number or an MSG91 sender with the credentials from your provider. Then pick it when you create a broadcast or a campaign."}]}$r$::jsonb,
       ARRAY['messages.send'], 'First version: the existing SMS channel, sold as an app. Workspaces whose plan already has SMS keep it.'
FROM marketplace_apps a WHERE a.slug = 'sms'
  AND NOT EXISTS (SELECT 1 FROM marketplace_app_versions v WHERE v.app_id = a.id);
