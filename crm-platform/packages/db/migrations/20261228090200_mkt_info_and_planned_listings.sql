-- Marketplace listings for (a) built features that must NOT be gated by install, as information listings, and (b) features that are not built,
-- as DRAFT placeholders that cannot be published (marketplace listings audit; docs/threadwise-port/wiring/marketplace.md, "Listings audit").
--
-- (a) INFORMATION LISTINGS: connector `client`, free, first party, grants nothing, no plan feature, no permission key hidden or shown by them.
--     Installing one records the workspace's consent and changes nothing else; the feature keeps its existing gates exactly as they are.
--       whatsapp-devices   Personal WhatsApp numbers (Settings > Channels > "Unofficial WhatsApp API", /devices). NOT gated by install: it
--                          is already off for every workspace unless a platform super admin switches the engine on AND the operator allows
--                          the workspace (the synthetic entitlement `unofficial_whatsapp`, owner decision 2026-10-05). Replacing that
--                          allow-list with a purchase would change who has the feature today, so it is left alone.
--       meta-lead-forms    Meta lead forms (Settings > Channels > "Social leads", /lead-sources). Its plan features `lead_sources` and
--                          `extra_channels` are on for every plan by default (core lead capture), so there is nothing to gate or comp.
--
-- (b) PLANNED LISTINGS: features Reference has (or a request names) that do not exist in this build. Each is a DRAFT integration whose
--     connector type is `oauth`, a framework-only type, so `publish` answers 409 MKT_CONNECTOR_NOT_AVAILABLE; it has no recipe, so a version
--     cannot be approved either (an integration needs one). They are free and grant nothing. "Coming soon, not built" is written only in
--     the version's changelog (operator-facing); nothing about them is shown to a workspace, because nothing can publish them. Each carries
--     its backlog id, recorded as `blocked` in docs/threadwise-port/wiring/marketplace.md and docs/backlog.md (section V).
--       BL-259 lead-finder        BL-260 ai-call-assistant   BL-261 openai-ads          BL-262 meta-ads         BL-263 tiktok
--       BL-264 hubspot            BL-265 slack               BL-266 trello              BL-267 linkedin-lead-gen  BL-268 google-ads-leads
--
-- Idempotent: ON CONFLICT DO NOTHING on the slug and NOT EXISTS on the version, so an operator's edits are never overwritten.

-- --- (a) information listings ------------------------------------------------------------------------------------------------------------------

WITH l (slug, category, name, tagline, long_desc, highlights, notice, scopes, sort_order) AS (
  VALUES
    ('whatsapp-devices', 'messaging-and-email', 'Personal WhatsApp numbers',
     'Link a personal or business-app WhatsApp number to your workspace with a QR code or pairing code.',
     E'Link a personal WhatsApp number, or one used in the WhatsApp Business app, by scanning a QR code or typing a pairing code. Messages on the number arrive in your team inbox and you can send from it in chats, broadcasts and campaigns.\n\nThis uses WhatsApp''s unofficial connection, which WhatsApp does not endorse and can restrict, so it is off by default. It is available only to workspaces the platform has approved, and it keeps working exactly as it does today: this listing only describes it. Open it from Settings, then Channels.',
     '["Link a number by QR code or pairing code","Chats arrive in the team inbox","Import the existing chats of a number, where allowed"]',
     'Available only to workspaces the platform has approved. Using an unofficial connection can get a number restricted by WhatsApp.',
     ARRAY[]::text[], 400),
    ('meta-lead-forms', 'lead-sources', 'Meta lead forms',
     'Read the leads of a Facebook or Instagram lead form straight from your Facebook Page.',
     E'Connect a Facebook Page and choose a lead form: each new lead becomes a contact with its source recorded, an owner, an optional deal and a notification. It works beside the generic Webhook source, from Settings, then Channels, then Social leads.\n\nIt is part of Social leads and is available on every plan that has it; this listing only describes it.',
     '["Leads from Facebook and Instagram lead forms","Fields mapped to your contact properties","An owner, a tag and an optional deal for each lead"]',
     NULL,
     ARRAY['leads.write']::text[], 410)
)
INSERT INTO marketplace_apps
  (slug, kind, category_id, name, tagline, status, first_party, featured, sort_order, connector_type, listing)
SELECT l.slug, 'integration', c.id, l.name, l.tagline, 'draft', true, false, l.sort_order, 'client',
       jsonb_strip_nulls(jsonb_build_object(
         'longDescription', l.long_desc,
         'highlights', l.highlights::jsonb,
         'notice', l.notice,
         'dataProcessing', jsonb_build_object('summary',
           CASE l.slug
             WHEN 'whatsapp-devices' THEN 'Messages of the linked number are stored in your workspace. The pairing session is stored encrypted until you unlink the number.'
             ELSE 'Each lead''s form answers are stored as a contact in your workspace. The Page access token is stored encrypted.' END,
           'regions', '[]'::jsonb,
           'deletion', 'Unlinking or disconnecting stops it and removes the stored session or token; contacts and chats already created stay until you delete them.')))
FROM l JOIN marketplace_categories c ON c.kind = 'integration' AND c.slug = l.category
ON CONFLICT (slug) DO NOTHING;

WITH l (slug, category, name, description, scopes, steps) AS (
  VALUES
    ('whatsapp-devices', 'messaging-and-email', 'Personal WhatsApp numbers',
     'Personal and business-app WhatsApp numbers linked by QR code or pairing code, for workspaces the platform has approved.',
     ARRAY[]::text[],
     '[{"title":"Check that it is available","body":"The feature is available only to workspaces the platform has approved. If Settings, then Channels, shows Unofficial WhatsApp API, it is on for you."},{"title":"Link a number","body":"Open Settings, then Channels, then Unofficial WhatsApp API, choose Link a number and scan the QR code or type the pairing code in WhatsApp."}]'),
    ('meta-lead-forms', 'lead-sources', 'Meta lead forms',
     'Leads from Facebook and Instagram lead forms, read from your Facebook Page into your contacts.',
     ARRAY['leads.write']::text[],
     '[{"title":"Open Social leads","body":"Open Settings, then Channels, then Social leads, and choose New source."},{"title":"Connect your Page","body":"Choose Meta lead forms, sign in with Facebook, pick the Page and the form, then map the fields."}]')
)
INSERT INTO marketplace_app_versions (app_id, version, status, manifest, recipe, scopes, changelog)
SELECT a.id, '1.0.0', 'draft',
       jsonb_build_object('manifestVersion', 1, 'id', l.slug, 'name', l.name, 'kind', 'integration', 'category', l.category,
         'version', '1.0.0', 'description', l.description, 'scopes', to_jsonb(l.scopes), 'surfaces', '[]'::jsonb,
         'pricing', jsonb_build_object('model', 'free'), 'support', '{}'::jsonb,
         'connector', jsonb_build_object('type', 'client')),
       jsonb_build_object('schemaVersion', 1, 'key', l.slug, 'name', l.name, 'category', l.category, 'logo', null,
         'connector', jsonb_build_object('type', 'client', 'stores', '[]'::jsonb),
         'authFields', '[]'::jsonb, 'mapping', jsonb_build_object('mode', 'auto'),
         'setupInstructions', l.steps::jsonb),
       l.scopes, 'First version: an information listing of the existing feature. It changes nothing about who can use the feature.'
FROM l JOIN marketplace_apps a ON a.slug = l.slug
WHERE NOT EXISTS (SELECT 1 FROM marketplace_app_versions v WHERE v.app_id = a.id);

-- --- (b) planned listings: DRAFT, unpublishable ------------------------------------------------------------------------------------------------

WITH p (slug, category, name, tagline, scopes, bl, note) AS (
  VALUES
    ('lead-finder', 'lead-sources', 'Lead finder',
     'Find businesses by category and city and add them to your contacts.', ARRAY['leads.write']::text[], 'BL-259',
     'Reference has it (Lead Finder, plan flag access_lead_finder). The menu entry /lead-finder is a placeholder in apps/web/src/features/_registry/planned.ts.'),
    ('ai-call-assistant', 'telephony', 'AI call assistant',
     'A voice AI that answers your WhatsApp calls.', ARRAY[]::text[], 'BL-260',
     'Reference has it (AI Call Assistant, plan flag access_ai_voice_agent). Needs a server-side WebRTC peer in the Node bridge; WhatsApp calling and call logs are built, the assistant is not.'),
    ('openai-ads', 'ads-and-social', 'OpenAI Ads',
     'Placeholder: this listing has no definition yet.', ARRAY[]::text[], 'BL-261',
     'Named in a request. No feature called OpenAI Ads exists in this build or in Reference, so nothing is described or built. Ask the owner what it is (Reference has Meta Ads, see BL-262) before anything else is written.'),
    ('meta-ads', 'ads-and-social', 'Meta Ads (Click-to-WhatsApp)',
     'Create Click-to-WhatsApp ad campaigns on Facebook and Instagram.', ARRAY[]::text[], 'BL-262',
     'Reference has it (Meta Ads, plan flags ads and access_ctwa). Only the capture of the ad referral on an incoming chat is built.'),
    ('tiktok', 'ads-and-social', 'TikTok',
     'Connect a TikTok account for insights, posts and its inbox.', ARRAY[]::text[], 'BL-263',
     'Reference has it (TikTok accounts and posts, plan flag access_tiktok). The Settings tile is a Soon entry in apps/web/src/features/_registry/settings-planned.ts.'),
    ('hubspot', 'marketing', 'HubSpot',
     'Sync your contacts with HubSpot CRM.', ARRAY[]::text[], 'BL-264',
     'Reference has it (Integrations page, plan flag integration_hubspot). The integrations tables exist in the schema; there is no module.'),
    ('slack', 'productivity', 'Slack',
     'Send alerts to a Slack channel.', ARRAY[]::text[], 'BL-265',
     'Reference has it (Integrations page, plan flag integration_slack). No module in this build.'),
    ('trello', 'productivity', 'Trello',
     'Connect Trello to your workspace.', ARRAY[]::text[], 'BL-266',
     'Reference has it (Integrations page, plan flag integration_trello). No module in this build.'),
    ('linkedin-lead-gen', 'lead-sources', 'LinkedIn lead gen',
     'Bring LinkedIn lead gen form leads into your workspace.', ARRAY['leads.write']::text[], 'BL-267',
     'Shown as Coming soon on the Social leads screen. Until then the generic Webhook source carries LinkedIn leads.'),
    ('google-ads-leads', 'lead-sources', 'Google Ads leads',
     'Bring Google Ads lead form leads into your workspace.', ARRAY['leads.write']::text[], 'BL-268',
     'Shown as Coming soon on the Social leads screen. Until then the generic Webhook source carries Google Ads leads.')
), apps AS (
  INSERT INTO marketplace_apps (slug, kind, category_id, name, tagline, status, first_party, featured, sort_order, connector_type)
  SELECT p.slug, 'integration', c.id, p.name, p.tagline, 'draft', true, false, 900, 'oauth'
  FROM p JOIN marketplace_categories c ON c.kind = 'integration' AND c.slug = p.category
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug
)
INSERT INTO marketplace_app_versions (app_id, version, status, manifest, scopes, changelog)
SELECT apps.id, '0.1.0', 'draft',
       jsonb_build_object('manifestVersion', 1, 'id', p.slug, 'name', p.name, 'kind', 'integration', 'category', p.category,
         'version', '0.1.0', 'description', p.tagline || ' (planned)', 'scopes', to_jsonb(p.scopes),
         'pricing', jsonb_build_object('model', 'free'), 'connector', jsonb_build_object('type', 'oauth')),
       p.scopes,
       'COMING SOON, NOT BUILT (' || p.bl || ', blocked). ' || p.note || ' This draft cannot be published: its connector type is framework-only.'
FROM apps JOIN p ON p.slug = apps.slug
ON CONFLICT (app_id, version) DO NOTHING;
