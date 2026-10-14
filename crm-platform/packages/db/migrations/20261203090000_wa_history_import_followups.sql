-- wahist follow-ups (owner decisions 2026-10-14): the plan feature that gates the FULL history import, and the "imported" marker of a thread.
--
-- Plan feature `personal_history_full`: the `full` choice of the personal-number history import needs it; `recent` stays open to every
-- workspace that may use personal numbers. Every plan row says so explicitly (the registry default is false). It is switched on for the plans
-- that already get the most generous personal-number allowance: an unlimited (0) or a `devices` limit of 3 or more (the demo plans growth and
-- scale; starter allows one number and stays off). A plan of another name is judged by the same rule; the operator can change it in the plan editor.
--
-- conversations.imported_at: set once, when a thread is CREATED by an imported history message (personal-number import or Cloud API coexistence
-- history). It drives the small "Imported" marker in the inbox list and thread header. A thread that existed before is never marked, and a live
-- message does not clear it: it says how the chat started, not what its last message is.

UPDATE plans SET features = features || '{"personal_history_full": false}'::jsonb
 WHERE kind = 'plan' AND NOT (features ? 'personal_history_full');
UPDATE plans SET features = features || '{"personal_history_full": true}'::jsonb
 WHERE kind = 'plan'
   AND (NOT (limits ? 'devices') OR (limits ->> 'devices')::numeric <= 0 OR (limits ->> 'devices')::numeric >= 3);

ALTER TABLE conversations ADD COLUMN imported_at timestamptz;
