-- platform settings: drop the orphaned "Real-time (Pusher)" settings group.
-- Why this migration exists (TW-SET-041, owner decision 2026-10-07): the Pusher group is removed from the admin console because
-- nothing consumed it. Our real-time is Socket.IO (apps/api/src/realtime) and never read these values. The rows below can only have
-- been written by an operator saving that page (no migration or seed ever created them); this clears them so the dead credentials,
-- including the encrypted app secret, do not sit in the database.
--
-- `platform_settings` is platform-owned (no org_id; forced RLS, privileged-only policy), so this is a plain keyed delete run by the
-- migration role. Idempotent: a second run (or a database that never saved the page) deletes nothing.
-- The audit trail (`security_events` rows named platform.settings.realtime_*) is history and is left alone.

DELETE FROM platform_settings
WHERE key = 'set.realtime'
   OR key LIKE 'set.realtime.%';
