-- 0013_add_status_options_uuid
-- Same gap as 0012, missed on the first pass: status_options.id is
-- returned on the wire too (statusOptionResponseSchema.id: uuidSchema),
-- so it needs the same uuid column every other field-metadata table has.

ALTER TABLE status_options ADD COLUMN uuid uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE status_options ADD CONSTRAINT status_options_org_id_uuid_key UNIQUE (org_id, uuid);
