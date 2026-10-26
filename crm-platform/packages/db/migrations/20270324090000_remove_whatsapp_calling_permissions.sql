-- remove_whatsapp_calling_permissions: WhatsApp calling has been removed from Desk, so its four capability keys go.
-- Why this migration exists: the roles editor still listed "Place and answer WhatsApp calls", "Turn WhatsApp calling on or off for a
-- number", "Play WhatsApp call recordings" and "Set the call recording rules and delete a call recording" under the calling group.
-- Every WhatsApp route still checks these keys (@RequirePermission), so until this runs a role that holds one can reach them; after
-- it no role holds them and those routes answer 403.
--
--   call.calls.use          place and answer WhatsApp calls, read the recordings of WhatsApp calls
--   call.calling.manage     turn WhatsApp calling on or off for a number
--   call.recordings.play    play a WhatsApp call recording
--   call.recordings.manage  set the recording rules and delete a recording
--
-- Stays: the call-log keys (call.logs.read, call.logs.create, call.logging.manage). The Call logs, manual logging and the mobile app's
-- reports are not WhatsApp-gated (BL-257, docs/specs/call-logging.md section 5). Its label drops the word WhatsApp.
--
-- The locked preset roles refuse any change to their grants (protect_locked_role), so they are unlocked, cleaned and relocked exactly
-- as the other permission migrations do. Expand-only does not apply here: the keys go, so their grants go with them.

SELECT set_config('app.privileged', 'on', true);

CREATE TEMP TABLE _calling_locked_roles ON COMMIT DROP AS
  SELECT org_id, id FROM roles WHERE is_locked AND org_id IS NOT NULL;

UPDATE roles r SET is_locked = false
  FROM _calling_locked_roles l WHERE r.org_id = l.org_id AND r.id = l.id;

CREATE TEMP TABLE _calling_keys ON COMMIT DROP AS
  SELECT unnest(ARRAY['call.calls.use', 'call.calling.manage', 'call.recordings.play', 'call.recordings.manage']) AS key;

DELETE FROM role_grants WHERE permission_key IN (SELECT key FROM _calling_keys);
DELETE FROM workspace_preset_baseline WHERE permission_key IN (SELECT key FROM _calling_keys);
DELETE FROM permission_defs WHERE key IN (SELECT key FROM _calling_keys);

UPDATE permission_defs SET label = 'View the call log and call analytics' WHERE key = 'call.logs.read';

UPDATE roles r SET is_locked = true
  FROM _calling_locked_roles l WHERE r.org_id = l.org_id AND r.id = l.id;

UPDATE organizations SET roles_version = roles_version + 1;
