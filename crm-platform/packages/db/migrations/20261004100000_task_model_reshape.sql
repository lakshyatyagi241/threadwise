-- task: the tasks table reshaped from the Reference draft into a model the list, the counts and the reminder sweep can rely on.
-- Why this migration exists: 20261001103900 drafted `tasks` as a straight copy of Reference (an untyped related_type/related_id
-- pointer with no foreign key, free-text status and priority, no done-stamp invariant, indexes that cannot serve a keyset page)
-- and holds no rows yet; TW-TASK-008 and differences D-05, D-06, D-09, D-14, D-15 call those out. 20261001103900 is applied
-- and immutable, so this fixes forward. Where an old row could break a new rule the UPDATEs below make it valid first, so the
-- migration also runs on a database that already has rows.

SELECT set_config('app.privileged', 'on', true);

-- --- typed links --------------------------------------------------------------------------------------------------------------

ALTER TABLE tasks
  ADD COLUMN contact_id bigint,
  ADD COLUMN deal_id bigint,
  ADD COLUMN company_id bigint,
  ADD COLUMN source text NOT NULL DEFAULT 'manual';

-- A Reference-style pointer becomes a typed link when the object is in the same workspace; anything else is dropped (it was a
-- dangling or cross-workspace id, which is exactly what the foreign keys below now refuse).
UPDATE tasks t SET contact_id = c.id FROM contacts c
 WHERE t.related_type = 'contact' AND c.org_id = t.org_id AND c.id = t.related_id;
UPDATE tasks t SET deal_id = d.id FROM deals d
 WHERE t.related_type = 'deal' AND d.org_id = t.org_id AND d.id = t.related_id;
UPDATE tasks t SET company_id = c.id FROM companies c
 WHERE t.related_type = 'company' AND c.org_id = t.org_id AND c.id = t.related_id;

DROP INDEX IF EXISTS idx_tasks_related_type_related_id;
ALTER TABLE tasks DROP COLUMN related_type, DROP COLUMN related_id;

-- The links are SET NULL (the task is the assignee's to-do, it must outlive a deleted deal or contact), composite so a task can
-- never point into another workspace.
ALTER TABLE tasks
  ADD CONSTRAINT fk_tasks_contact_id FOREIGN KEY (org_id, contact_id)
    REFERENCES contacts (org_id, id) ON DELETE SET NULL (contact_id),
  ADD CONSTRAINT fk_tasks_deal_id FOREIGN KEY (org_id, deal_id)
    REFERENCES deals (org_id, id) ON DELETE SET NULL (deal_id),
  ADD CONSTRAINT fk_tasks_company_id FOREIGN KEY (org_id, company_id)
    REFERENCES companies (org_id, id) ON DELETE SET NULL (company_id);

-- --- value rules --------------------------------------------------------------------------------------------------------------

UPDATE tasks SET title = left(btrim(title), 255) WHERE btrim(title) <> '' AND (title <> btrim(title) OR char_length(title) > 255);
UPDATE tasks SET title = 'Task ' || id WHERE btrim(title) = '';
UPDATE tasks SET priority = 'medium' WHERE priority NOT IN ('low', 'medium', 'high');
UPDATE tasks SET status = 'open' WHERE status NOT IN ('open', 'done');
-- status and done_at always agree.
UPDATE tasks SET done_at = coalesce(done_at, updated_at) WHERE status = 'done';
UPDATE tasks SET done_at = NULL WHERE status = 'open';

ALTER TABLE tasks
  ADD CONSTRAINT chk_tasks_title CHECK (btrim(title) <> '' AND char_length(title) <= 255),
  ADD CONSTRAINT chk_tasks_priority CHECK (priority IN ('low', 'medium', 'high')),
  ADD CONSTRAINT chk_tasks_status CHECK (status IN ('open', 'done')),
  ADD CONSTRAINT chk_tasks_source CHECK (source IN ('manual', 'deal', 'ai', 'api', 'flow')),
  -- A report that counts done_at and a list that filters on status can never disagree.
  ADD CONSTRAINT chk_tasks_done_stamp CHECK ((status = 'done') = (done_at IS NOT NULL));
-- notes is encrypted at rest (AES-GCM, base64), so its stored length is not its text length: the 5000-character cap is the
-- contract's, not a CHECK.

-- --- indexes --------------------------------------------------------------------------------------------------------------------

DROP INDEX IF EXISTS idx_tasks_status_due_at;
DROP INDEX IF EXISTS idx_tasks_due_at;
DROP INDEX IF EXISTS idx_tasks_assignee_id;

-- The lists page open tasks soonest-due first, undated last, on (due key, id); the same expression is in the query so the
-- planner can walk these indexes instead of sorting.
CREATE INDEX idx_tasks_open_due ON tasks (org_id, (coalesce(due_at, 'infinity'::timestamptz)), id) WHERE status = 'open';
CREATE INDEX idx_tasks_assignee_open_due ON tasks (org_id, assignee_id, (coalesce(due_at, 'infinity'::timestamptz)), id) WHERE status = 'open';
CREATE INDEX idx_tasks_created_by ON tasks (org_id, created_by) WHERE created_by IS NOT NULL;
CREATE INDEX idx_tasks_org_created ON tasks (org_id, created_at DESC, id DESC);
CREATE INDEX idx_tasks_done_at ON tasks (org_id, done_at DESC, id DESC) WHERE status = 'done';
CREATE INDEX idx_tasks_contact_id ON tasks (org_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX idx_tasks_deal_id ON tasks (org_id, deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX idx_tasks_company_id ON tasks (org_id, company_id) WHERE company_id IS NOT NULL;
-- The due-reminder sweep (TW-TASK-010): open, dated, never reminded.
CREATE INDEX idx_tasks_reminder_sweep ON tasks (org_id, due_at) WHERE status = 'open' AND reminded_at IS NULL AND due_at IS NOT NULL;

-- --- the deal timeline's tasks ----------------------------------------------------------------------------------------------------

-- A task added on a deal's timeline is mirrored into `tasks` (D-14); the activity keeps its history row and points at the task,
-- one to one. Deleting the task leaves the history row (task_id becomes NULL).
ALTER TABLE deal_activities
  ADD COLUMN task_id bigint,
  ADD CONSTRAINT fk_deal_activities_task_id FOREIGN KEY (org_id, task_id)
    REFERENCES tasks (org_id, id) ON DELETE SET NULL (task_id);
CREATE UNIQUE INDEX uq_deal_activities_task ON deal_activities (org_id, task_id) WHERE task_id IS NOT NULL;
