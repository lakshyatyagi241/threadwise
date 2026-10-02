-- crm: link a contact's Status to its Lifecycle stage (follow-up to the Contact stages screen).
-- Why this migration exists: the two were independent option lists, so "Quote sent" could sit on a contact that is New or Lost.
-- A status option may now be scoped to ONE lifecycle stage (`stage_option_id`, a row of the same table in the lifecycle_stage
-- group); a NULL scope means "valid in every stage", which is what every existing status is, so nothing changes until an admin
-- scopes one. The service keeps a contact's status valid for its stage (reset on a stage move, 422 on a mismatch).
-- The scope is a composite foreign key (org_id, stage_option_id) -> status_options (org_id, id): it cannot point at another
-- workspace's stage. That the target is a lifecycle_stage row (and the scoped row a contact status) is checked by the service,
-- because a foreign key cannot look at the group of the row it points to. Deleting a stage clears the scope of its statuses
-- (they become "all stages"); the service clears their defaults first so the one-default-per-scope index below holds.
-- "One default per group" becomes "one default per scope": the default status of a stage is the one a contact gets when it enters
-- that stage without a valid status. For the lifecycle_stage group (never scoped) the rule is exactly what it was.

ALTER TABLE status_options
  ADD COLUMN stage_option_id bigint,
  ADD CONSTRAINT fk_status_options_stage
    FOREIGN KEY (org_id, stage_option_id) REFERENCES status_options (org_id, id)
    ON DELETE SET NULL (stage_option_id),
  ADD CONSTRAINT chk_status_options_stage_scope CHECK (
    stage_option_id IS NULL
    OR (module_key = 'contacts' AND option_group IN ('status', 'contact_status'))
  ),
  ADD CONSTRAINT chk_status_options_not_own_stage CHECK (stage_option_id IS NULL OR stage_option_id <> id);

CREATE INDEX idx_status_options_stage ON status_options (org_id, stage_option_id) WHERE stage_option_id IS NOT NULL;

DROP INDEX uq_status_options_one_default;
CREATE UNIQUE INDEX uq_status_options_one_default
  ON status_options (org_id, module_key, option_group, COALESCE(stage_option_id, 0)) WHERE is_default;
