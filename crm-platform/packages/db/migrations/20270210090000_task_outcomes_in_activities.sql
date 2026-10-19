-- Sales activities: the Task drawer edits the workspace's task outcomes inline, and its "Predict outcomes for this activity" switch is real.
-- Why this migration exists: the Task activity was seeded with that switch OFF because its outcomes lived on a separate screen. The outcome picker on a task
-- shows whenever the workspace has an outcome, so the switch must start ON to keep every workspace exactly as it is; a workspace that turns it off hides the
-- picker. The outcomes themselves stay in `task_outcomes` (20270126090000), edited through its own routes: no second table.

SELECT set_config('app.privileged', 'on', true);
UPDATE activity_types SET outcomes_enabled = true WHERE key = 'task' AND is_default AND NOT outcomes_enabled;

-- The seed for a workspace that has none yet starts the Task switch on (the same function, one value changed).
CREATE OR REPLACE FUNCTION seed_activity_types(p_org bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  a record;
  o record;
  tid bigint;
BEGIN
  FOR a IN
    SELECT * FROM (VALUES
      ('task',     0, 'task',    'task',     true,  true,  true),
      ('meeting',  1, 'meeting', 'meeting',  true,  true,  true),
      ('phone',    2, 'phone',   'phone',    false, true,  false),
      ('email',    3, 'other',   'email',    false, false, false),
      ('reminder', 4, 'other',   'reminder', false, false, false),
      ('sms',      5, 'other',   'sms',      false, false, false),
      ('chat',     6, 'other',   'chat',     false, false, false)
    ) AS d(key, pos, behaves_as, icon, in_calendar, outcomes, completable)
  LOOP
    INSERT INTO activity_types (org_id, key, name, is_default, behaves_as, icon, position, show_in_calendar, outcomes_enabled, allow_complete)
    VALUES (p_org, a.key, NULL, true, a.behaves_as, a.icon, a.pos, a.in_calendar, a.outcomes, a.completable)
    ON CONFLICT (org_id, key) DO NOTHING;
  END LOOP;

  FOR o IN
    SELECT * FROM (VALUES
      ('task',    'type',    'follow_up',      0),
      ('task',    'type',    'call_reminder',  1),
      ('meeting', 'outcome', 'interested',     0),
      ('meeting', 'outcome', 'not_interested', 1),
      ('meeting', 'outcome', 'needs_follow_up',2),
      ('meeting', 'outcome', 'rescheduled',    3),
      ('meeting', 'outcome', 'no_show',        4),
      ('phone',   'outcome', 'connected',      0),
      ('phone',   'outcome', 'no_answer',      1),
      ('phone',   'outcome', 'busy',           2),
      ('phone',   'outcome', 'left_voicemail', 3),
      ('phone',   'outcome', 'wrong_number',   4),
      ('phone',   'outcome', 'declined',       5),
      ('phone',   'outcome', 'failed',         6)
    ) AS d(activity, kind, key, pos)
  LOOP
    SELECT id INTO tid FROM activity_types WHERE org_id = p_org AND key = o.activity;
    INSERT INTO activity_type_options (org_id, activity_type_id, kind, key, name, is_system, position)
    VALUES (p_org, tid, o.kind, o.key, NULL, true, o.pos)
    ON CONFLICT (org_id, activity_type_id, kind, key) DO NOTHING;
  END LOOP;
END $$;
