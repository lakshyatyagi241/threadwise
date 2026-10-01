-- deal: pipelines, stages, deals and the timeline, reshaped from the WaDesk draft into a model the editor, the board and the
-- reports can rely on.
-- Why this migration exists: 20261001103800 drafted the four tables as a straight copy of WaDesk (no foreign keys, free-text
-- status/source/currency, deals that cascade away with their stage, no ordering, no limit on won/lost stages) and holds no
-- rows yet; WD-DEAL-041/042 and differences D-03, D-07, D-09, D-11, D-13 call those out. 20261001103800 is applied and
-- immutable, so this fixes forward. Nothing here relabels data: where an old row could break a new rule the UPDATEs below
-- make it valid first, so the migration also runs on a database that already has rows.

SELECT set_config('app.privileged', 'on', true);

-- --- pipelines -----------------------------------------------------------------------------------------------------------

UPDATE pipelines SET name = 'Pipeline ' || id WHERE btrim(name) = '' OR char_length(name) > 120;
UPDATE pipelines SET currency = upper(btrim(currency)) WHERE currency !~ '^[A-Z]{3}$';
UPDATE pipelines SET currency = 'INR' WHERE currency !~ '^[A-Z]{3}$';
-- Names that collide ignoring case: the oldest keeps its name, the rest get the id appended.
UPDATE pipelines p SET name = left(p.name, 100) || ' (' || p.id || ')'
 WHERE EXISTS (SELECT 1 FROM pipelines o
                WHERE o.org_id = p.org_id AND lower(btrim(o.name)) = lower(btrim(p.name)) AND o.id < p.id);
-- One default per workspace: the oldest default wins; with none, the oldest pipeline becomes it.
UPDATE pipelines p SET is_default = false
 WHERE p.is_default AND EXISTS (SELECT 1 FROM pipelines o WHERE o.org_id = p.org_id AND o.is_default AND o.id < p.id);
UPDATE pipelines p SET is_default = true
 WHERE NOT EXISTS (SELECT 1 FROM pipelines o WHERE o.org_id = p.org_id AND o.is_default)
   AND p.id = (SELECT min(o.id) FROM pipelines o WHERE o.org_id = p.org_id);

ALTER TABLE pipelines
  ADD CONSTRAINT chk_pipelines_name CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  ADD CONSTRAINT chk_pipelines_currency CHECK (currency ~ '^[A-Z]{3}$');
CREATE UNIQUE INDEX uq_pipelines_org_lower_name ON pipelines (org_id, lower(btrim(name)));
-- Exactly one default per workspace is a database fact, not a convention two simultaneous requests could break.
CREATE UNIQUE INDEX uq_pipelines_one_default ON pipelines (org_id) WHERE is_default;

-- --- pipeline_stages -----------------------------------------------------------------------------------------------------

UPDATE pipeline_stages SET is_lost = false WHERE is_won AND is_lost;
UPDATE pipeline_stages SET probability = 100 WHERE is_won;
UPDATE pipeline_stages SET probability = 0 WHERE is_lost;
UPDATE pipeline_stages SET probability = least(greatest(probability, 0), 100);
UPDATE pipeline_stages SET color = '#25D366' WHERE color !~ '^#[0-9A-Fa-f]{6}$';
UPDATE pipeline_stages SET name = 'Stage ' || id WHERE btrim(name) = '' OR char_length(name) > 120;
UPDATE pipeline_stages s SET name = left(s.name, 100) || ' (' || s.id || ')'
 WHERE EXISTS (SELECT 1 FROM pipeline_stages o
                WHERE o.org_id = s.org_id AND o.pipeline_id = s.pipeline_id
                  AND lower(btrim(o.name)) = lower(btrim(s.name)) AND o.id < s.id);
-- At most one won and one lost stage per pipeline (WaDesk allowed any number, and "Mark Won" then picked the first).
UPDATE pipeline_stages s SET is_won = false
 WHERE s.is_won AND EXISTS (SELECT 1 FROM pipeline_stages o
                             WHERE o.org_id = s.org_id AND o.pipeline_id = s.pipeline_id AND o.is_won
                               AND (o.sort_order, o.id) < (s.sort_order, s.id));
UPDATE pipeline_stages s SET is_lost = false
 WHERE s.is_lost AND EXISTS (SELECT 1 FROM pipeline_stages o
                              WHERE o.org_id = s.org_id AND o.pipeline_id = s.pipeline_id AND o.is_lost
                                AND (o.sort_order, o.id) < (s.sort_order, s.id));

ALTER TABLE pipeline_stages
  ADD CONSTRAINT chk_pipeline_stages_name CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  ADD CONSTRAINT chk_pipeline_stages_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT chk_pipeline_stages_probability CHECK (probability BETWEEN 0 AND 100),
  ADD CONSTRAINT chk_pipeline_stages_kind CHECK (NOT (is_won AND is_lost)),
  -- A won stage is certain and a lost stage is not: WaDesk left both to convention and let the forecast drift.
  ADD CONSTRAINT chk_pipeline_stages_terminal_probability
    CHECK ((NOT is_won OR probability = 100) AND (NOT is_lost OR probability = 0));
CREATE UNIQUE INDEX uq_pipeline_stages_one_won ON pipeline_stages (org_id, pipeline_id) WHERE is_won;
CREATE UNIQUE INDEX uq_pipeline_stages_one_lost ON pipeline_stages (org_id, pipeline_id) WHERE is_lost;
CREATE UNIQUE INDEX uq_pipeline_stages_pipeline_lower_name ON pipeline_stages (org_id, pipeline_id, lower(btrim(name)));
-- The target of the deals foreign key below: a deal's stage must belong to the deal's own pipeline, which a
-- single-column reference to the stage could not say (difference D-11: a stage from another pipeline, rejected everywhere).
ALTER TABLE pipeline_stages ADD CONSTRAINT uq_pipeline_stages_org_pipeline_id UNIQUE (org_id, pipeline_id, id);

-- --- deals ---------------------------------------------------------------------------------------------------------------

UPDATE deals SET currency = upper(btrim(currency));
UPDATE deals SET value_minor = 0 WHERE value_minor < 0;
UPDATE deals SET title = left(btrim(title), 191) WHERE btrim(title) <> '' AND (title <> btrim(title) OR char_length(title) > 191);
UPDATE deals SET title = 'Deal ' || id WHERE btrim(title) = '';
UPDATE deals SET lost_reason = left(lost_reason, 191) WHERE char_length(lost_reason) > 191;
UPDATE deals SET source = 'manual' WHERE source NOT IN ('manual','inbox','order','shopify','woo','form','api','flow','facebook','ai');
-- status and its stamps always follow the stage (the model hook WaDesk relied on, now also a constraint).
UPDATE deals d SET status = CASE WHEN s.is_won THEN 'won' WHEN s.is_lost THEN 'lost' ELSE 'open' END,
                   won_at = CASE WHEN s.is_won THEN coalesce(d.won_at, d.updated_at) END,
                   lost_at = CASE WHEN s.is_lost THEN coalesce(d.lost_at, d.updated_at) END
  FROM pipeline_stages s WHERE s.org_id = d.org_id AND s.id = d.stage_id;
UPDATE deals SET lost_reason = NULL WHERE status <> 'lost';
-- A deal whose stage sits in a different pipeline than the deal: follow the stage.
UPDATE deals d SET pipeline_id = s.pipeline_id FROM pipeline_stages s
 WHERE s.org_id = d.org_id AND s.id = d.stage_id AND s.pipeline_id <> d.pipeline_id;

ALTER TABLE deals DROP CONSTRAINT fk_deals_pipeline_id, DROP CONSTRAINT fk_deals_stage_id;
-- NO ACTION, not CASCADE: deleting a stage or a pipeline that still holds deals must fail loudly (the service moves or
-- refuses first, WD-DEAL-041); CASCADE silently destroyed every deal in it. NO ACTION is checked at the end of the
-- statement, so deleting a whole organization (which cascades to deals and stages together) still works.
ALTER TABLE deals
  ADD CONSTRAINT fk_deals_pipeline_id FOREIGN KEY (org_id, pipeline_id)
    REFERENCES pipelines (org_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT fk_deals_stage_id FOREIGN KEY (org_id, pipeline_id, stage_id)
    REFERENCES pipeline_stages (org_id, pipeline_id, id) ON DELETE NO ACTION;

-- Manual order inside a column: gap-spaced, new deals go on top (sort_order descending below the current minimum), so a
-- bigint rather than WaDesk's int that was always 0.
ALTER TABLE deals ALTER COLUMN sort_order TYPE bigint;
-- Existing deals keep their WaDesk order (newest first) by spacing them out per stage.
UPDATE deals d SET sort_order = r.rn * 1024
  FROM (SELECT org_id, id, row_number() OVER (PARTITION BY org_id, stage_id ORDER BY id DESC) AS rn FROM deals) r
 WHERE r.org_id = d.org_id AND r.id = d.id;

ALTER TABLE deals
  ADD CONSTRAINT chk_deals_title CHECK (btrim(title) <> '' AND char_length(title) <= 191),
  ADD CONSTRAINT chk_deals_value CHECK (value_minor >= 0),
  ADD CONSTRAINT chk_deals_currency CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT chk_deals_status CHECK (status IN ('open', 'won', 'lost')),
  ADD CONSTRAINT chk_deals_source
    CHECK (source IN ('manual','inbox','order','shopify','woo','form','api','flow','facebook','ai')),
  ADD CONSTRAINT chk_deals_lost_reason CHECK (lost_reason IS NULL OR char_length(lost_reason) <= 191),
  -- The stamps are a function of the status, so a report that counts won_at can never disagree with one that counts status.
  ADD CONSTRAINT chk_deals_status_stamps CHECK (
    (status = 'won'  AND won_at IS NOT NULL AND lost_at IS NULL AND lost_reason IS NULL) OR
    (status = 'lost' AND lost_at IS NOT NULL AND won_at IS NULL) OR
    (status = 'open' AND won_at IS NULL AND lost_at IS NULL AND lost_reason IS NULL)
  );

ALTER TABLE deals ADD COLUMN lost_reason_id bigint;

-- The board reads one stage at a time in manual order; reports read closed deals by month.
CREATE INDEX idx_deals_board ON deals (org_id, stage_id, sort_order, id DESC);
CREATE INDEX idx_deals_org_created ON deals (org_id, created_at DESC, id DESC);
CREATE INDEX idx_deals_won_at ON deals (org_id, won_at) WHERE status = 'won';
CREATE INDEX idx_deals_lost_at ON deals (org_id, lost_at) WHERE status = 'lost';
-- The board's per-stage totals and the open-pipeline metrics group by currency inside the open set.
CREATE INDEX idx_deals_open_currency ON deals (org_id, pipeline_id, currency) WHERE status = 'open';

-- --- deal_activities -----------------------------------------------------------------------------------------------------

UPDATE deal_activities SET type = 'note' WHERE type NOT IN ('note','stage_change','call','message','email','meeting','task');
UPDATE deal_activities SET due_at = NULL, done_at = NULL, reminded_at = NULL WHERE type <> 'task';

ALTER TABLE deal_activities
  ADD COLUMN assignee_user_id bigint,
  ADD CONSTRAINT fk_deal_activities_assignee_user_id FOREIGN KEY (org_id, assignee_user_id)
    REFERENCES users (org_id, id) ON DELETE SET NULL (assignee_user_id),
  ADD CONSTRAINT chk_deal_activities_type
    CHECK (type IN ('note','stage_change','call','message','email','meeting','task')),
  -- Only a task has a due date and a done stamp (WaDesk silently dropped them for other types).
  ADD CONSTRAINT chk_deal_activities_task_fields
    CHECK (type = 'task' OR (due_at IS NULL AND done_at IS NULL AND reminded_at IS NULL));

CREATE INDEX idx_deal_activities_timeline ON deal_activities (org_id, deal_id, created_at DESC, id DESC);
-- The reminder sweep (WD-DEAL-017) looks for open, unreminded, due tasks; WaDesk had no index shaped for it.
CREATE INDEX idx_deal_activities_task_sweep ON deal_activities (org_id, due_at)
  WHERE type = 'task' AND done_at IS NULL AND reminded_at IS NULL;
CREATE INDEX idx_deal_activities_assignee ON deal_activities (org_id, assignee_user_id)
  WHERE type = 'task' AND done_at IS NULL;
