-- Email (Gmail) becomes the third PAID first-party Marketplace app, after Appointments and Forms (owner-requested deviation from Reference,
-- whose email is a MailTrixy bridge; docs/threadwise-port/plan/channel-email-build.md, parity/product-extensions.md).
-- Why this migration exists: the Gmail channel is sold as a monthly subscription from the Marketplace; nothing in the workspace is visible
-- or reachable until it is owned. Same recipe as 20261031100200_mkt_forms_app.sql: the app is new, so there is nothing to comp
-- (`grandfather_existing = false`, no dry-run, no usage probe).
--
--  1. The listing `email` is seeded as a DRAFT: first-party mini app, `paid_monthly`, price NOT set (the operator prices it in the console;
--     publishing is refused with `price_not_set` until then), not included in any plan, granting `email_channel`. Re-seeding never overwrites
--     an operator's edits (ON CONFLICT DO NOTHING).
--  2. Version 1.0.0 is a draft manifest. Scopes: `email.read` and `email.write` (new, mapped onto `mail.mailboxes.read` and
--     `mail.mailboxes.manage` in packages/contracts/src/marketplace/scopes.ts). Those permission keys are created by the channel-email
--     migration. A first-party app is checked against the installer's own keys (MKT_SCOPE_EXCEEDS_INSTALLER).
--  3. Every plan row gets `email_channel: false` explicitly (the registry default is false), so no plan includes it.
--  4. Every plan row gets the add-on's default cap: 3 connected mailboxes (`email_mailboxes`, DEFAULT_EMAIL_MAILBOXES; 0 = unlimited). It applies
--     only to a workspace that owns the app (without it the routes are locked), and is editable per plan and per workspace.

INSERT INTO marketplace_apps
  (slug, kind, category_id, name, tagline, status, first_party, featured, sort_order, listing,
   pricing_model, trial_days, purchasable, grants_plan_features, grandfather_existing)
SELECT 'email', 'mini_app', c.id, 'Email (Gmail)',
       'Connect your Gmail or Google Workspace mailboxes and answer customer email from the team inbox.',
       'draft', true, false, 70,
       $l${"longDescription":"Connect one or more Gmail or Google Workspace mailboxes with a sign-in popup. Every customer email becomes a conversation in the team inbox, grouped by Gmail thread and linked to the contact by email address, so your team can reply, assign, resolve and follow up without leaving the CRM. Replies go out from the connected mailbox in the same Gmail thread. Paid per month; the price is set by the platform.","highlights":["Several mailboxes per workspace, one inbox channel each","One conversation per Gmail thread, linked to the contact","Replies sent from your own mailbox, in the same thread","Disconnect any time: the conversations stay"]}$l$::jsonb,
       'paid_monthly', 0, true, ARRAY['email_channel'], false
FROM marketplace_categories c WHERE c.kind = 'mini_app' AND c.slug = 'inbox-and-chat'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO marketplace_app_versions (app_id, version, status, manifest, scopes, changelog)
SELECT a.id, '1.0.0', 'draft',
       $m${"manifestVersion":1,"id":"email","name":"Email (Gmail)","kind":"mini_app","category":"inbox-and-chat","version":"1.0.0","description":"Gmail and Google Workspace mailboxes connected to the team inbox.","scopes":["email.read","email.write"],"surfaces":[{"type":"settings_page","key":"email","label":"Email"}],"pricing":{"model":"addon","note":"Priced by the platform operator."},"support":{}}$m$::jsonb,
       ARRAY['email.read','email.write'], 'First version: Gmail mailboxes in the team inbox, with replies sent from the mailbox.'
FROM marketplace_apps a WHERE a.slug = 'email'
  AND NOT EXISTS (SELECT 1 FROM marketplace_app_versions v WHERE v.app_id = a.id);

UPDATE plans SET features = features || '{"email_channel": false}'::jsonb WHERE kind = 'plan';

UPDATE plans
SET limits = limits || '{"email_mailboxes": 3}'::jsonb
WHERE kind = 'plan';
