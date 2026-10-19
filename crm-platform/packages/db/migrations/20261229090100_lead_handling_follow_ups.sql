-- lead handling, step 2: a contact's next follow-up is a task of kind `follow_up` (BL-291).
-- Why: the tasks module already has the due date, the assignee, the reminder sweep (`task.due`), notifications, scopes and audit, so a
-- follow-up that is a task needs no second reminder system. `kind` tells a contact's follow-up from any other task, and the partial unique
-- index says there is at most ONE open follow-up per contact: its "next follow-up". A follow-up without a date ("someday") is an open
-- task with a null due date; the reminder sweep only claims dated tasks, so it is never reminded. Existing tasks are all `task`.
-- docs/specs/lead-followup-settings.md

ALTER TABLE tasks
  ADD COLUMN kind text NOT NULL DEFAULT 'task',
  ADD CONSTRAINT chk_tasks_kind CHECK (kind IN ('task', 'follow_up'));

-- Tasks made by the follow-up rules say so: `auto` joins manual, deal, ai, api and flow.
ALTER TABLE tasks DROP CONSTRAINT chk_tasks_source;
ALTER TABLE tasks
  ADD CONSTRAINT chk_tasks_source CHECK (source IN ('manual', 'deal', 'ai', 'api', 'flow', 'auto'));

-- At most one open follow-up per contact; also the lookup behind "next follow-up" on the contact list and record.
CREATE UNIQUE INDEX uq_tasks_open_follow_up ON tasks (org_id, contact_id)
  WHERE kind = 'follow_up' AND status = 'open' AND contact_id IS NOT NULL;
