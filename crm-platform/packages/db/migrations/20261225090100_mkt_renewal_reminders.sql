-- marketplace: renewal reminders (BL-076).
-- Why: a paid app's period ends silently. The worker now tells the workspace's admins a few days before it ends (once per period), when a card
-- renewal fails and when the subscription ends. This migration adds only what that needs:
--   marketplace_subscriptions.reminded_period_end   the period end the last reminder was sent for; a reminder is due while it differs from
--                                                   current_period_end, so a renewal (which moves the end) earns a fresh one.
--   platform_settings 'marketplace.renewal_reminder_days'   how many days ahead (0 turns the reminders off), default 7.
-- Additive only.

ALTER TABLE marketplace_subscriptions ADD COLUMN reminded_period_end timestamptz;

INSERT INTO platform_settings (key, value) VALUES ('marketplace.renewal_reminder_days', '7'::jsonb)
ON CONFLICT (key) DO NOTHING;
