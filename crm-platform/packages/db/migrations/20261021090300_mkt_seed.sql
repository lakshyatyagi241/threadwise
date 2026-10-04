-- marketplace: the starting catalogue (spec section 6.1 categories, section 6.4 lead portals).
-- Why this migration exists: an empty Marketplace shows nothing, and a catalogue full of listings that do not work shows tenants things
-- that do not work. So: every category of both tabs, ONE real published listing (the generic Webhook lead source, a webhook relay that
-- is fully built), and the planned lead portals as DRAFT listings (visible to the operator only) so the build order and the manifests
-- are on record without a tenant ever seeing a non-functional entry.
--
-- Idempotent: every statement is ON CONFLICT DO NOTHING on the slug, so re-seeding by hand never overwrites an operator's edits.
-- The manifests and the recipe are validated against the contract by test/unit/marketplace/seed.spec.ts, which reads this file.
--
-- The mechanism of each portal below is the plan, not a verified fact: the real integration mechanism (push webhook, pull API, partner
-- API or email alert) and any partner agreement are checked per portal before a recipe is written (spec open question 3).

SELECT set_config('app.privileged', 'on', true);

-- --- categories -------------------------------------------------------------------------------------------------------------------------
INSERT INTO marketplace_categories (kind, slug, name, description, icon, sort_order) VALUES
  ('mini_app',    'sales-tools',           'Sales tools',            'Quotes, proposals and scoring that help close deals.',            'briefcase',  10),
  ('mini_app',    'contacts-and-data',     'Contacts and data',      'Clean, enrich and organise your contacts.',                       'users',      20),
  ('mini_app',    'inbox-and-chat',        'Inbox and chat',         'Extra tools inside the team inbox.',                              'inbox',      30),
  ('mini_app',    'automation',            'Automation',             'Triggers and actions for your flows.',                            'workflow',   40),
  ('mini_app',    'reporting',             'Reporting',              'Dashboards and reports.',                                         'chart',      50),
  ('mini_app',    'booking-and-payments',  'Booking and payments',   'Take bookings and payments.',                                     'calendar',   60),
  ('mini_app',    'industry-packs',        'Industry packs',         'Ready-made setups for real estate, education and trade.',         'package',    70),
  ('mini_app',    'utilities',             'Utilities',              'Small helpers, such as calculators and greeters.',                'wrench',     80),
  ('integration', 'lead-sources',          'Lead sources',           'Bring leads from portals, forms and ads into your workspace.',    'target',     10),
  ('integration', 'ads-and-social',        'Ads and social',         'Ad platforms and social networks.',                               'megaphone',  20),
  ('integration', 'telephony',             'Telephony',              'Cloud telephony and call tracking.',                              'phone',      30),
  ('integration', 'messaging-and-email',   'Messaging and email',    'Email, SMS and other messaging services.',                        'mail',       40),
  ('integration', 'payments',              'Payments',               'Payment gateways and payment links.',                             'credit-card',50),
  ('integration', 'accounting-and-finance','Accounting and finance', 'Accounting software and finance tools.',                         'receipt',    60),
  ('integration', 'e-commerce',            'E-commerce',             'Online stores and marketplaces.',                                 'shopping-cart',70),
  ('integration', 'calendar-and-meetings', 'Calendar and meetings',  'Calendars and video meetings.',                                   'calendar',   80),
  ('integration', 'productivity',          'Productivity',           'Docs, sheets, chat and project tools.',                           'layers',     90),
  ('integration', 'marketing',             'Marketing',              'Marketing automation and analytics.',                             'trending-up',100),
  ('integration', 'support',               'Support',                'Help desks and ticketing.',                                       'life-buoy',  110),
  ('integration', 'automation',            'Automation (Zapier, Make, webhooks)', 'Connect anything through automation tools and webhooks.', 'zap',     120),
  ('integration', 'developer-tools',       'Developer tools',        'APIs, webhooks and tooling for developers.',                      'code',       130)
ON CONFLICT (kind, slug) DO NOTHING;

-- --- the generic Webhook lead source (published) -----------------------------------------------------------------------------------------
INSERT INTO marketplace_apps
  (slug, kind, category_id, name, tagline, status, first_party, featured, connector_type, listing, published_at)
SELECT 'webhook', 'integration', c.id, 'Webhook',
       'Send leads from any tool that can post to a web address: Zapier, Make, your website form or your ad platform.',
       'draft', true, true, 'webhook_relay',
       $j${"longDescription":"Give your form, landing page, ad platform or automation tool a private web address and a secret. Every lead it posts there becomes a lead in your workspace, with a repeat of the same lead recognised and ignored.\n\nWorks with Zapier, Make, Google Ads lead form extensions, LinkedIn and TikTok lead forms through their automation tools, and any custom code that can send a POST request.","highlights":["Works with any tool that can post JSON","Repeats are recognised, never duplicated","Test it with a sample lead in one click","Rotate the secret at any time"],"screenshots":[],"dataProcessing":{"summary":"Each delivery is passed to your workspace's lead pipeline and stored there with your other leads. The platform keeps only a delivery id and a status for 30 days so you can see recent events.","regions":[],"deletion":"Uninstalling removes the address and the secret at once. Leads that already arrived stay in your workspace until you delete them."}}$j$::jsonb,
       now()
FROM marketplace_categories c WHERE c.kind = 'integration' AND c.slug = 'lead-sources'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO marketplace_app_versions (app_id, version, status, manifest, recipe, scopes, changelog, published_at, reviewed_at)
SELECT a.id, '1.0.0', 'published',
       $j${"manifestVersion":1,"id":"webhook","name":"Webhook","kind":"integration","category":"lead-sources","version":"1.0.0","description":"Receive leads from any tool that can post to a web address, such as Zapier, Make, a website form or an ad platform.","scopes":["leads.write"],"surfaces":[{"type":"webhook_in","key":"leads","label":"Incoming leads"}],"pricing":{"model":"free"},"support":{},"connector":{"type":"webhook_relay"}}$j$::jsonb,
       $j${"schemaVersion":1,"key":"webhook","name":"Webhook","category":"lead-sources","logo":null,"connector":{"type":"webhook_relay","auth":"either"},"authFields":[],"mapping":{"mode":"auto"},"rateLimits":{"perMinute":120},"errorMapping":[],"setupInstructions":[{"title":"Copy the address","body":"Copy the webhook address below into the tool that sends your leads. It accepts POST requests with a JSON body."},{"title":"Add the secret","body":"Send the secret in the X-Marketplace-Token header, or sign the body with it (HMAC SHA-256) and send the signature in X-Marketplace-Signature. The secret is shown once, when you install; you can create a new one at any time."},{"title":"Send a sample lead","body":"Press Send sample lead to check the whole path. Name, phone and email are recognised by their usual names (name, phone, mobile, email); every other field is kept as it came."}],"testPayloads":[{"name":"Sample lead","payload":{"id":"sample-1","name":"Asha Verma","phone":"+919876543210","email":"asha@example.com","message":"Interested in a 2 BHK, please call","utm_source":"landing-page"}}]}$j$::jsonb,
       ARRAY['leads.write']::text[], 'First version.', now(), now()
FROM marketplace_apps a WHERE a.slug = 'webhook'
ON CONFLICT (app_id, version) DO NOTHING;

-- Published only the first time: an operator who later hides or kills the listing is never overridden by a re-run.
UPDATE marketplace_apps a SET current_version_id = v.id, status = 'published'
FROM marketplace_app_versions v
WHERE a.slug = 'webhook' AND v.app_id = a.id AND v.version = '1.0.0' AND a.status = 'draft' AND a.current_version_id IS NULL;

-- --- planned lead portals: DRAFT listings, never shown to a workspace -----------------------------------------------------------------------
-- (slug, name, tagline, planned connector type, category). Each gets a draft version 0.1.0 with a valid manifest and no recipe.
WITH planned (slug, name, tagline, connector, note) AS (
  VALUES
    ('indiamart', 'IndiaMART', 'Bring IndiaMART buyer enquiries into your workspace as leads.', 'pull',
     'Planned mechanism: pull with the CRM key. Verify against IndiaMART documentation before writing the recipe.'),
    ('justdial', 'JustDial', 'Bring JustDial enquiries into your workspace as leads.', 'push',
     'Planned mechanism: push to our webhook, mechanism and any partner agreement to be confirmed with JustDial.'),
    ('acres99', '99acres', 'Bring 99acres property enquiries into your workspace as leads.', 'email_parse',
     'Planned mechanism: email alert parsing until a partner API is confirmed. Needs the Email channel.'),
    ('magicbricks', 'MagicBricks', 'Bring MagicBricks property enquiries into your workspace as leads.', 'email_parse',
     'Planned mechanism: email alert parsing until a partner API is confirmed. Needs the Email channel.'),
    ('housing-com', 'Housing.com', 'Bring Housing.com enquiries into your workspace as leads.', 'email_parse',
     'Planned mechanism: email alert parsing until a partner API is confirmed. Needs the Email channel.'),
    ('shiksha', 'Shiksha', 'Bring Shiksha admission enquiries into your workspace as leads.', 'email_parse',
     'Planned mechanism: email alert parsing until a partner API is confirmed. Needs the Email channel.')
), apps AS (
  INSERT INTO marketplace_apps (slug, kind, category_id, name, tagline, status, first_party, connector_type, sort_order)
  SELECT p.slug, 'integration', c.id, p.name, p.tagline, 'draft', true, p.connector, 200
  FROM planned p CROSS JOIN marketplace_categories c
  WHERE c.kind = 'integration' AND c.slug = 'lead-sources'
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug
)
INSERT INTO marketplace_app_versions (app_id, version, status, manifest, scopes, changelog)
SELECT apps.id, '0.1.0', 'draft',
       jsonb_build_object(
         'manifestVersion', 1, 'id', p.slug, 'name', p.name, 'kind', 'integration', 'category', 'lead-sources', 'version', '0.1.0',
         'description', p.tagline, 'scopes', jsonb_build_array('leads.write'),
         'pricing', jsonb_build_object('model', 'free'), 'connector', jsonb_build_object('type', p.connector)),
       ARRAY['leads.write']::text[], p.note
FROM apps JOIN planned p ON p.slug = apps.slug
ON CONFLICT (app_id, version) DO NOTHING;
