-- Marketplace: the Zoom and Microsoft Teams integrations (BL-360).
-- Why this migration exists: the Add meeting form offers "Add Zoom link" and "Add Teams link" only AFTER the workspace has installed the
-- integration and the person has connected their own account (owner rule). So the two listings exist in the catalogue, in Calendar and meetings.
--
-- Connector type `client`, like Email (Gmail): the sign-in and the meeting calls are built into the product itself (Settings, Video meetings),
-- so installing records the workspace's consent and issues nothing; each person then connects their own account. A client is always publishable.
-- New scope `meetings.write` (contracts/marketplace/scopes.ts) is what the consent screen shows.
--
-- Seeded as DRAFT, free, like the other first-party listings whose provider needs the operator's own app registration: the operator registers
-- the OAuth app (Zoom Marketplace app; the Microsoft Entra app already used for the calendar, with the OnlineMeetings.ReadWrite permission),
-- sets the environment values in docs/runbooks/video-conferencing-setup.md, then approves and publishes the listing from the catalogue. Until
-- then no workspace sees a listing that cannot connect. The real providers were NOT reachable when this was written.
--
-- Idempotent: every statement is ON CONFLICT DO NOTHING / NOT EXISTS, so a re-run never overwrites an operator's edits.

SELECT set_config('app.privileged', 'on', true);

WITH l (slug, name, tagline, long_desc, highlights, sort_order) AS (
  VALUES
    ('zoom', 'Zoom',
     'Add a Zoom meeting link to the meetings you schedule with your contacts.',
     'Install Zoom for your workspace, then each person connects their own Zoom account from Settings, Video meetings. After that, the Add meeting form on a contact offers "Add Zoom link": the meeting is created in the scheduler''s Zoom account, the join link is saved on the meeting with a Join button, and the Zoom meeting is moved or removed when you move or delete the meeting.',
     '["Each person connects their own Zoom account","Join link and Join button on the meeting","Moved or removed with the meeting"]', 40),
    ('microsoft-teams', 'Microsoft Teams',
     'Add a Microsoft Teams meeting link to the meetings you schedule with your contacts.',
     'Install Microsoft Teams for your workspace, then each person connects their own Microsoft work or school account from Settings, Video meetings. After that, the Add meeting form on a contact offers "Add Teams link": the Teams meeting is created in the scheduler''s account, the join link is saved on the meeting with a Join button, and it is updated or removed with the meeting.',
     '["Each person connects their own Microsoft account","Join link and Join button on the meeting","Moved or removed with the meeting"]', 41)
)
INSERT INTO marketplace_apps (slug, kind, category_id, name, tagline, status, first_party, featured, sort_order, connector_type, listing)
SELECT l.slug, 'integration', c.id, l.name, l.tagline, 'draft', true, false, l.sort_order, 'client',
       jsonb_build_object('longDescription', l.long_desc, 'highlights', l.highlights::jsonb)
FROM l, marketplace_categories c WHERE c.kind = 'integration' AND c.slug = 'calendar-and-meetings'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO marketplace_app_versions (app_id, version, status, manifest, recipe, scopes, changelog)
SELECT a.id, '1.0.0', 'draft',
       jsonb_build_object('manifestVersion', 1, 'id', a.slug, 'name', a.name, 'kind', 'integration', 'category', 'calendar-and-meetings',
         'version', '1.0.0', 'description', a.tagline, 'scopes', jsonb_build_array('meetings.write'),
         'surfaces', '[]'::jsonb, 'pricing', jsonb_build_object('model', 'free'), 'support', '{}'::jsonb,
         'connector', jsonb_build_object('type', 'client')),
       jsonb_build_object('schemaVersion', 1, 'key', a.slug, 'name', a.name, 'category', 'calendar-and-meetings', 'logo', null,
         'connector', jsonb_build_object('type', 'client', 'stores', '[]'::jsonb),
         'authFields', '[]'::jsonb, 'mapping', jsonb_build_object('mode', 'auto'),
         'setupInstructions', jsonb_build_array(
           jsonb_build_object('title', 'Install it', 'body', 'Install the app for your workspace.'),
           jsonb_build_object('title', 'Connect your account', 'body', 'Open Settings, Video meetings and connect your own account. Each person connects theirs.'))),
       ARRAY['meetings.write']::text[], 'First version: video links for meetings scheduled on a contact.'
FROM marketplace_apps a WHERE a.slug IN ('zoom', 'microsoft-teams')
  AND NOT EXISTS (SELECT 1 FROM marketplace_app_versions v WHERE v.app_id = a.id);
